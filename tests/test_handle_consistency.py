"""A displayed name and its link must describe the same account.

Sheets arrive with a claimed handle; the link (and the page the worker opens)
are evidence. These tests pin the two places where a claim could win: the
importer and the visit result.
"""

import io
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

_TMP = tempfile.TemporaryDirectory(prefix='sa_handle_')
os.environ.setdefault('SA_DB_PATH', str(Path(_TMP.name) / 'handle.db'))

import app as app_module  # noqa: E402
import database  # noqa: E402

TEST_API_KEY = 'test-key-not-a-secret'
API_HEADERS = {'X-API-Key': TEST_API_KEY}

TT_URL = 'https://www.tiktok.com/@benar/video/1234567890'
IG_URL = 'https://www.instagram.com/reel/DYcE78dB8D7/'


class HandleConsistencyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_handle_db_')
        self.addCleanup(self.tmp.cleanup)
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'handle.db')
        database.init_db()
        app_module.API_KEY = TEST_API_KEY
        app_module.app.config.update(TESTING=True)
        # The app keeps the upload folder in a module global, so every test that
        # uploads must own it; otherwise it points at a deleted temp directory.
        app_module.UPLOAD_FOLDER = str(Path(self.tmp.name) / 'uploads')
        app_module.EXPORT_FOLDER = str(Path(self.tmp.name) / 'uploads' / 'exports')
        os.makedirs(app_module.EXPORT_FOLDER, exist_ok=True)
        self.client = app_module.app.test_client()
        self.addCleanup(self._restore_path)

    def _restore_path(self):
        database.DB_PATH = self.saved_path

    def upload(self, rows):
        csv = 'Link,Username,Tema\r\n' + '\r\n'.join(rows) + '\r\n'
        return self.client.post(
            '/api/upload',
            data={'file': (io.BytesIO(csv.encode('utf-8')), 'targets.csv'),
                  'audit_name': 'Konsistensi'},
            headers=API_HEADERS,
            content_type='multipart/form-data',
        )

    def stored_username(self, url):
        conn = database.get_db_connection()
        try:
            row = conn.execute('SELECT username FROM targets WHERE url = ?', (url,)).fetchone()
            return row['username'] if row else None
        finally:
            conn.close()

    def test_import_keeps_the_handle_the_link_carries(self):
        response = self.upload([TT_URL + ',salah,kopi'])
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(self.stored_username(TT_URL), 'benar',
                         'the link names its owner; the sheet column must not win')

    def test_import_still_trusts_the_sheet_when_the_link_is_anonymous(self):
        response = self.upload([IG_URL + ',alice,kopi'])
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(self.stored_username(IG_URL), 'alice',
                         'an Instagram short link carries no handle to compare with')

    def test_a_visit_corrects_a_label_the_page_contradicts(self):
        database.create_audit_with_tasks([
            {'url': TT_URL, 'platform': 'tiktok', 'username': 'salah', 'tema': 'kopi'},
        ], name='Kunjungan')
        task = database.get_next_task()
        self.assertIsNotNone(task)

        self.assertTrue(database.update_task_result(task['id'], {
            'status': 'OK',
            'platform': 'tiktok',
            'username': 'benar',
            'likes': 10,
            'comments': 1,
            'views': 100,
            'shares': 0,
        }))
        self.assertEqual(self.stored_username(TT_URL), 'benar')

    def test_a_visit_without_a_handle_leaves_the_label_alone(self):
        database.create_audit_with_tasks([
            {'url': IG_URL, 'platform': 'instagram', 'username': 'alice', 'tema': 'kopi'},
        ], name='Tanpa handle')
        task = database.get_next_task()
        self.assertIsNotNone(task)

        self.assertTrue(database.update_task_result(task['id'], {
            'status': 'OK',
            'platform': 'instagram',
            'likes': 10,
            'comments': 1,
        }))
        self.assertEqual(self.stored_username(IG_URL), 'alice')


if __name__ == '__main__':
    unittest.main()
