"""Database backup and restore endpoints.

Every case gets its own database, upload folder and backup folder, so the live
data is never touched.

Run from the project root:

    python -m unittest tests.test_database_transfer -v
"""

import io
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

_TMP = tempfile.TemporaryDirectory(prefix='sa_db_transfer_')
os.environ.setdefault('SA_DB_PATH', str(Path(_TMP.name) / 'transfer.db'))

import app as app_module  # noqa: E402
import database  # noqa: E402

TEST_API_KEY = 'test-key-not-a-secret'
API_HEADERS = {'X-API-Key': TEST_API_KEY}


class DatabaseTransferTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app_module.API_KEY = TEST_API_KEY
        app_module.app.config.update(TESTING=True)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_db_case_')
        self.addCleanup(self.tmp.cleanup)
        self.saved = {
            'db': database.DB_PATH,
            'upload': app_module.UPLOAD_FOLDER,
            'export': app_module.EXPORT_FOLDER,
            'backup': app_module.BACKUP_FOLDER,
        }
        root = Path(self.tmp.name)
        database.DB_PATH = str(root / 'live.db')
        app_module.UPLOAD_FOLDER = str(root / 'uploads')
        app_module.EXPORT_FOLDER = str(root / 'uploads' / 'exports')
        app_module.BACKUP_FOLDER = str(root / 'backups')
        os.makedirs(app_module.EXPORT_FOLDER, exist_ok=True)
        os.makedirs(app_module.BACKUP_FOLDER, exist_ok=True)
        database.init_db()
        self.client = app_module.app.test_client()
        self.addCleanup(self._restore)

    def _restore(self):
        database.DB_PATH = self.saved['db']
        app_module.UPLOAD_FOLDER = self.saved['upload']
        app_module.EXPORT_FOLDER = self.saved['export']
        app_module.BACKUP_FOLDER = self.saved['backup']

    def seed(self, name='Batch Cadangan', rows=2):
        tasks = [
            {
                'url': f'https://www.instagram.com/p/DBTEST{index}/',
                'platform': 'instagram',
                'username': f'akun{index}',
                'tema': 'uji',
            }
            for index in range(rows)
        ]
        return database.create_audit_with_tasks(
            tasks,
            name=name,
            repeat_days=0,
            source_filename='uji.csv',
            period='2026-11',
        )

    def export_bytes(self):
        response = self.client.get('/api/database/export', headers=API_HEADERS)
        self.assertEqual(
            response.status_code, 200,
            'export failed: ' + response.data[:200].decode('utf-8', 'replace'),
        )
        self.assertTrue(response.data.startswith(b'SQLite format 3\x00'))
        return response.data

    def write_backup(self, name='cadangan.db'):
        path = Path(self.tmp.name) / name
        database.backup_database(str(path))
        return path

    def post_backup(self, payload, filename='cadangan.db'):
        return self.client.post(
            '/api/database/import',
            data={'file': (io.BytesIO(payload), filename)},
            headers=API_HEADERS,
            content_type='multipart/form-data',
        )

    def test_info_reports_counts_and_size(self):
        self.seed(rows=2)

        info = self.client.get('/api/database/info', headers=API_HEADERS)
        self.assertEqual(info.status_code, 200)
        body = info.get_json()
        self.assertGreater(body['size_bytes'], 0)
        self.assertEqual(body['counts']['audits'], 1)
        self.assertEqual(body['counts']['targets'], 2)
        self.assertEqual(body['schema_version'], database.SCHEMA_VERSION)
        self.assertTrue(body['updated_at'])

    def test_export_is_a_usable_sqlite_copy(self):
        self.seed(rows=2)
        payload = self.export_bytes()

        copy_path = Path(self.tmp.name) / 'copy.db'
        copy_path.write_bytes(payload)
        conn = sqlite3.connect(copy_path)
        try:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM audits').fetchone()[0], 1)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM targets').fetchone()[0], 2)
        finally:
            conn.close()

    def test_restore_replaces_data_and_keeps_a_safety_copy(self):
        self.seed(rows=2)
        payload = self.export_bytes()

        conn = database.get_db_connection()
        try:
            conn.execute('DELETE FROM targets')
            conn.execute('DELETE FROM audits')
            conn.commit()
        finally:
            conn.close()

        response = self.post_backup(payload)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertTrue(body['success'])
        self.assertEqual(body['restored']['counts']['targets'], 2)
        self.assertTrue(body['safety_backup'].startswith('pre_restore_'))

        safety_path = Path(app_module.BACKUP_FOLDER) / body['safety_backup']
        self.assertTrue(safety_path.exists())

        info = self.client.get('/api/database/info', headers=API_HEADERS).get_json()
        self.assertEqual(info['counts']['audits'], 1)
        self.assertEqual(info['counts']['targets'], 2)

    def test_restore_rejects_a_non_sqlite_file(self):
        self.seed()
        response = self.post_backup(b'x' * 2048, 'rusak.db')
        self.assertEqual(response.status_code, 400)
        self.assertIn('SQLite', response.get_json()['error'])
        # The rejected upload must not have replaced anything.
        self.assertEqual(
            self.client.get('/api/database/info', headers=API_HEADERS)
            .get_json()['counts']['targets'],
            2,
        )

    def test_restore_rejects_the_wrong_extension(self):
        response = self.post_backup(b'x' * 2048, 'cadangan.txt')
        self.assertEqual(response.status_code, 400)
        self.assertIn('.db', response.get_json()['error'])

    def test_restore_rejects_a_newer_schema(self):
        self.seed()
        path = self.write_backup()
        conn = sqlite3.connect(path)
        try:
            conn.execute(f'PRAGMA user_version = {database.SCHEMA_VERSION + 1}')
            conn.commit()
        finally:
            conn.close()

        response = self.post_backup(path.read_bytes())
        self.assertEqual(response.status_code, 400)
        self.assertIn('skema', response.get_json()['error'])

    def test_restore_rejects_a_database_without_the_main_tables(self):
        self.seed()
        path = self.write_backup()
        conn = sqlite3.connect(path)
        try:
            conn.execute('DROP TABLE snapshots')
            conn.commit()
        finally:
            conn.close()

        response = self.post_backup(path.read_bytes())
        self.assertEqual(response.status_code, 400)
        self.assertIn('snapshots', response.get_json()['error'])

    def test_backup_keeps_the_previous_audit_name(self):
        self.seed(name='Batch Lama')
        path = self.write_backup()
        conn = sqlite3.connect(path)
        try:
            names = [row[0] for row in conn.execute('SELECT name FROM audits')]
        finally:
            conn.close()
        self.assertEqual(names, ['Batch Lama'])


def tearDownModule():
    _TMP.cleanup()


if __name__ == '__main__':
    unittest.main(verbosity=2)
