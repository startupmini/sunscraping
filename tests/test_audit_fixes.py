"""Regressions for the issues found in the project audit.

Each test pins one fix. Every test gets its own database and folder, so queue
order never leaks between cases and the live data is never touched.

Run from the project root:

    python -m unittest tests.test_audit_fixes -v
"""

import csv
import io
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

_TMP = tempfile.TemporaryDirectory(prefix='sa_audit_fixes_')
os.environ['SA_DB_PATH'] = str(Path(_TMP.name) / 'fixes.db')

import app as app_module  # noqa: E402
import database  # noqa: E402

TEST_API_KEY = 'test-key-not-a-secret'
API_HEADERS = {'X-API-Key': TEST_API_KEY}
EXTENSION = ROOT / 'chrome-extension'
JS_DIR = ROOT / 'tests' / 'js'


def _csv_file(rows):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(['Link', 'Username', 'Tema'])
    writer.writerows(rows)
    return io.BytesIO(buffer.getvalue().encode('utf-8'))


class _TempDatabaseTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app_module.API_KEY = TEST_API_KEY
        app_module.app.config.update(TESTING=True)
        app_module.UPLOAD_FOLDER = str(Path(_TMP.name) / 'uploads')
        app_module.EXPORT_FOLDER = str(Path(_TMP.name) / 'uploads' / 'exports')
        os.makedirs(app_module.EXPORT_FOLDER, exist_ok=True)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_fix_case_')
        self.addCleanup(self.tmp.cleanup)
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'fixes.db')
        database.init_db()
        self.addCleanup(self._restore_path)
        self.client = app_module.app.test_client()

    def _restore_path(self):
        database.DB_PATH = self.saved_path

    def upload(self, rows, **fields):
        data = {'file': (_csv_file(rows), 'targets.csv')}
        data.update(fields)
        return self.client.post(
            '/api/upload',
            data=data,
            headers=API_HEADERS,
            content_type='multipart/form-data',
        )


class UploadPathTest(_TempDatabaseTest):
    def test_profile_links_are_rejected_but_short_links_survive(self):
        """A profile URL has no metrics; importing it used to invent a task."""
        response = self.upload([
            ['https://www.instagram.com/koki.asli/', 'koki', 'profil'],
            ['https://www.tiktok.com/@ternak.satu', 'ternak', 'profil'],
            ['https://vm.tiktok.com/ZMabc123/', 'short', 'short link'],
            ['https://www.instagram.com/p/POST111/', 'koki', 'post'],
            ['https://www.tiktok.com/@ternak.satu/video/7777777777', 'ternak', 'post'],
        ], audit_name='Hanya Postingan', repeat_days='0')

        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()
        self.assertEqual(payload['inserted'], 3)
        self.assertEqual(payload['invalid_urls'], 2)

    def test_invalid_repeat_days_is_reported_not_stored_as_manual(self):
        response = self.upload(
            [['https://www.instagram.com/p/POST222/', 'koki', 'x']],
            repeat_days='tiap minggu',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('repeat_days', response.get_json()['error'])
        self.assertEqual(
            self.client.get('/api/audits', headers=API_HEADERS).get_json(),
            [],
            'a rejected upload must not leave an audit behind',
        )


class EmptyResultTest(_TempDatabaseTest):
    def test_ok_without_a_single_metric_is_recorded_as_partial(self):
        upload = self.upload(
            [['https://www.tiktok.com/@kosong.akun/video/9090909090', 'kosong', 'x']],
            audit_name='Tanpa Metrik',
            repeat_days='0',
        ).get_json()

        task = self.client.get('/api/task/next', headers=API_HEADERS).get_json()['task']
        self.assertEqual(
            task['url'], 'https://www.tiktok.com/@kosong.akun/video/9090909090',
        )

        response = self.client.post(
            '/api/task/result',
            json={
                'taskId': task['id'],
                'result': {'status': 'OK', 'platform': 'tiktok', 'username': 'kosong'},
            },
            headers=API_HEADERS,
        )
        self.assertEqual(response.status_code, 200)

        stats = self.client.get(
            '/api/stats?audit_id=%d' % upload['audit_id'], headers=API_HEADERS,
        ).get_json()
        self.assertEqual(stats['OK'], 0)
        self.assertEqual(stats['PARTIAL'], 1)

        targets = self.client.get(
            '/api/targets?audit_id=%d' % upload['audit_id'], headers=API_HEADERS,
        ).get_json()['items']
        self.assertEqual(targets[0]['status'], 'PARTIAL')
        self.assertIn('postingan', targets[0]['error_message'])


class HealthExposureTest(_TempDatabaseTest):
    def test_queue_counts_need_a_paired_caller(self):
        self.upload([['https://www.instagram.com/p/POST333/', 'a', 'x']])

        public = self.client.get('/api/health')
        self.assertEqual(public.status_code, 200)
        body = public.get_json()
        self.assertEqual(body['status'], 'healthy')
        self.assertNotIn('tasks', body)
        self.assertNotIn('audits', body)

        paired = self.client.get('/api/health', headers=API_HEADERS).get_json()
        self.assertIn('tasks', paired)
        self.assertEqual(paired['tasks']['PENDING'], 1)
        self.assertEqual(paired['audits'], 1)


class HeaderAndStatsTest(_TempDatabaseTest):
    def test_dashboard_ships_a_content_security_policy(self):
        response = self.client.get('/')
        policy = response.headers.get('Content-Security-Policy', '')
        self.assertIn("default-src 'self'", policy)
        self.assertIn("script-src 'self'", policy)
        self.assertNotIn("script-src 'self' 'unsafe-inline'", policy)
        self.assertEqual(response.headers['X-Frame-Options'], 'DENY')

    def test_stats_never_keys_a_bucket_by_none(self):
        conn = database.get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO audits (id, name, created_at) "
                "VALUES (1, 'Status Null', '2026-01-01 00:00:00')"
            )
            cursor.execute(
                "INSERT INTO targets (audit_id, platform, url) "
                "VALUES (1, 'instagram', 'https://www.instagram.com/p/NULLSTAT/')"
            )
            target_id = cursor.lastrowid
            cursor.execute(
                "INSERT INTO tasks (url, platform, status, audit_id, target_id) "
                "VALUES ('https://www.instagram.com/p/NULLSTAT/', 'instagram', NULL, 1, ?)",
                (target_id,),
            )
            conn.commit()
        finally:
            conn.close()

        stats = self.client.get('/api/stats', headers=API_HEADERS).get_json()
        self.assertNotIn(None, stats)
        self.assertEqual(stats['PENDING'], 1)


class ExtensionContractTest(unittest.TestCase):
    """The worker mirrors three backend numbers; a drift is silent, so pin it."""

    def read(self, *parts):
        return EXTENSION.joinpath(*parts).read_text(encoding='utf-8')

    def test_visit_budget_matches_the_backend(self):
        match = re.search(r'VISIT_BUDGET:\s*(\d+)', self.read('utils', 'rate-limiter.js'))
        self.assertIsNotNone(match, 'VISIT_BUDGET not found in rate-limiter.js')
        self.assertEqual(int(match.group(1)), database.VISIT_BUDGET_PER_CYCLE)

    def test_cached_post_ttl_matches_the_backend(self):
        text = self.read('utils', 'task-cache.js')
        match = re.search(
            r'MAX_AGE_MS:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)', text,
        )
        self.assertIsNotNone(match, 'MAX_AGE_MS not found in task-cache.js')
        millis = 1
        for group in match.groups():
            millis *= int(group)
        self.assertEqual(millis, database.POST_CACHE_TTL_MINUTES * 60 * 1000)

    def test_profile_post_cap_matches_the_backend(self):
        text = self.read('content', 'common.js')
        match = re.search(r'RECENT_POST_LIMIT\s*=\s*(\d+)', text)
        self.assertIsNotNone(match, 'RECENT_POST_LIMIT not found in common.js')
        self.assertEqual(int(match.group(1)), database.MAX_PROFILE_POSTS)

    def test_instagram_timeline_reads_the_real_timestamp_key(self):
        scraper = self.read('content', 'ig-scraper.js')
        self.assertIn('media.taken_at', scraper)
        self.assertNotIn('taken_at_at', scraper)
        fixture = (JS_DIR / 'fixtures' / 'profile-dom.html').read_text(encoding='utf-8')
        self.assertNotIn(
            'taken_at_at', fixture,
            'the fixture must mirror the real payload, not the typo',
        )

    def test_tiktok_post_scrape_separates_post_from_profile_payload(self):
        scraper = self.read('content', 'tk-scraper.js')
        self.assertIn("kind: 'post'", scraper)
        self.assertIn("kind: 'profile'", scraper)
        self.assertIn('hasAnyPostMetric', scraper)


def tearDownModule():
    _TMP.cleanup()


if __name__ == '__main__':
    unittest.main(verbosity=2)
