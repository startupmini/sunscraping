"""Dashboard tables and the API must agree on the fields they share.

The dashboard is plain ES5 with no build step: when the API renames a column, or
a table gains a column that no renderer fills, nothing raises — the cell is just
empty. ``post_date`` was collected for months and never appeared in Aktivitas for
exactly that reason.

These tests pin each data surface to the payload it is rendered from, and pin the
header/cell counts so an added column cannot ship without its value.

Run from the project root:

    python -m unittest tests.test_dashboard_contract -v
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

_TMP = tempfile.TemporaryDirectory(prefix='sa_contract_')
os.environ.setdefault('SA_DB_PATH', str(Path(_TMP.name) / 'contract.db'))

import app as app_module  # noqa: E402
import database  # noqa: E402

TEST_API_KEY = 'test-key-not-a-secret'
API_HEADERS = {'X-API-Key': TEST_API_KEY}
JS_PATH = ROOT / 'backend' / 'static' / 'dashboard.js'
TEMPLATE_PATH = ROOT / 'backend' / 'templates' / 'dashboard.html'

# Fields buildRow() reads from GET /api/latest.
LATEST_FIELDS = (
    'id', 'target_id', 'platform', 'username', 'tema', 'audit_name', 'likes',
    'comments', 'views', 'shares', 'follower_count', 'post_date', 'caption',
    'scraped_at', 'prev_likes', 'prev_comments', 'prev_views', 'prev_shares',
    'prev_follower_count',
)
# Fields buildTargetRow() reads from GET /api/targets.
TARGET_FIELDS = (
    'target_id', 'platform', 'url', 'username', 'tema', 'audit_name',
    'snapshot_at', 'task_scraped_at', 'post_date', 'follower_count', 'likes',
    'comments', 'views', 'engagement_rate', 'status', 'error_code', 'retry_count',
)
# Fields the history modal reads from GET /api/history.
HISTORY_FIELDS = (
    'scraped_at', 'status', 'error_code', 'error_message', 'likes', 'comments',
    'views', 'shares', 'follower_count', 'post_date', 'caption',
)
# Fields the search tables read from GET /api/search.
SEARCH_POST_FIELDS = ('platform', 'username', 'posted_at', 'views', 'likes',
                      'comments', 'caption')
SEARCH_TARGET_FIELDS = ('platform', 'username', 'url', 'period', 'status',
                        'last_scraped_at')
SEARCH_ACCOUNT_FIELDS = ('platform', 'username', 'follower_count', 'post_count',
                         'fetched_at')
# Sorts the activity table computes by reading a plain numeric payload field.
NUMERIC_SORTS = {'followers', 'likes', 'comments', 'views', 'shares'}
TARGET_SORTS = {'username', 'followers', 'likes', 'comments', 'views', 'er', 'recent'}


def function_body(js, name, end_marker):
    start = js.index('function %s' % name)
    return js[start:js.index(end_marker, start)]


def header_block(html, head_id):
    start = html.index('id="%s"' % head_id)
    return html[start:html.index('</thead>', start)]


class DashboardTableShapeTest(unittest.TestCase):
    """Static checks: the markup and the renderer must describe the same table."""

    @classmethod
    def setUpClass(cls):
        cls.js = JS_PATH.read_text(encoding='utf-8')
        cls.html = TEMPLATE_PATH.read_text(encoding='utf-8')

    def test_activity_header_and_row_have_the_same_cell_count(self):
        head = header_block(self.html, 'activityHead')
        columns = len(re.findall(r'<th\b', head))
        row = function_body(self.js, 'buildRow', 'function metricCell')
        self.assertGreater(columns, 0)
        self.assertEqual(row.count('tr.appendChild('), columns)

    def test_target_header_and_row_have_the_same_cell_count(self):
        head = header_block(self.html, 'targetHead')
        columns = len(re.findall(r'<th\b', head))
        row = function_body(self.js, 'buildTargetRow', 'function metricValueCell')
        self.assertGreater(columns, 0)
        self.assertEqual(row.count('tr.appendChild('), columns)

    def test_activity_upload_column_is_painted_from_post_date(self):
        head = header_block(self.html, 'activityHead')
        self.assertIn('data-activity-sort="upload"', head)
        self.assertIn('unggah', head.lower())
        row = function_body(self.js, 'buildRow', 'function metricCell')
        self.assertIn('item.post_date', row)

    def test_target_upload_column_is_painted_from_post_date(self):
        head = header_block(self.html, 'targetHead')
        self.assertIn('Tgl. unggah', head)
        row = function_body(self.js, 'buildTargetRow', 'function metricValueCell')
        self.assertIn('item.post_date', row)

    def test_every_activity_sort_header_has_a_comparator(self):
        head = header_block(self.html, 'activityHead')
        emitted = set(re.findall(r'data-activity-sort="([^"]+)"', head))
        comparator = function_body(self.js, 'activityValue', 'function sortedRows')
        handled = set(re.findall(r"key === '([a-z]+)'", comparator)) | NUMERIC_SORTS
        self.assertTrue(emitted, 'no sort headers found — the regex is wrong')
        self.assertEqual(emitted - handled, set())

    def test_every_target_sort_header_is_one_the_api_can_order(self):
        head = header_block(self.html, 'targetHead')
        emitted = set(re.findall(r'data-target-sort="([^"]+)"', head))
        self.assertTrue(emitted, 'no sort headers found — the regex is wrong')
        self.assertEqual(emitted - TARGET_SORTS, set())


def _csv_file(rows):
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(['Link', 'Username', 'Tema'])
    writer.writerows(rows)
    return io.BytesIO(buffer.getvalue().encode('utf-8'))


class DashboardPayloadContractTest(unittest.TestCase):
    """The seeded payload must expose every field its table renders."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_contract_case_')
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'contract.db')
        database.init_db()
        app_module.API_KEY = TEST_API_KEY
        app_module.app.config.update(TESTING=True)
        app_module.UPLOAD_FOLDER = str(Path(self.tmp.name) / 'uploads')
        app_module.EXPORT_FOLDER = str(Path(self.tmp.name) / 'uploads' / 'exports')
        os.makedirs(app_module.EXPORT_FOLDER, exist_ok=True)
        self.client = app_module.app.test_client()
        self.addCleanup(self._restore)
        self.seed()

    def _restore(self):
        database.DB_PATH = self.saved_path
        self.tmp.cleanup()

    def upload(self, rows):
        return self.client.post(
            '/api/upload',
            data={'file': (_csv_file(rows), 'targets.csv'), 'audit_name': 'Kontrak'},
            headers=API_HEADERS,
            content_type='multipart/form-data',
        )

    def seed(self):
        upload = self.upload([
            ['https://www.instagram.com/p/AAA111/', 'alice', 'Kampanye A'],
            ['https://www.tiktok.com/@bob/video/1234567890123', '@bob', 'Kampanye B'],
        ])
        self.assertEqual(upload.status_code, 200, upload.get_data(as_text=True))
        self.audit_id = upload.get_json()['audit_id']
        self.posted = {
            'instagram': '2026-10-01T03:00:00Z',
            'tiktok': '2026-10-02T07:30:00Z',
        }
        metrics = {
            'instagram': {'likes': 100, 'comments': 10, 'views': 0, 'shares': 0,
                          'followerCount': 1000},
            'tiktok': {'likes': 500, 'comments': 20, 'views': 9000, 'shares': 3,
                       'followerCount': 4000},
        }
        for _ in range(2):
            task = self.client.get('/api/task/next', headers=API_HEADERS).get_json()['task']
            platform = task['platform']
            result = {'status': 'OK', 'platform': platform,
                      'username': 'bob' if platform == 'tiktok' else 'alice',
                      'postDate': self.posted[platform],
                      'caption': 'unggahan %s' % platform}
            result.update(metrics[platform])
            stored = self.client.post('/api/task/result',
                                      json={'taskId': task['id'], 'result': result},
                                      headers=API_HEADERS)
            self.assertEqual(stored.status_code, 200, stored.get_data(as_text=True))

        # A profile visit also feeds the search-post table.
        database.record_account_profile({
            'platform': 'tiktok', 'username': 'bob', 'followerCount': 4000,
            'postCount': 12,
            'posts': [{
                'id': '1234567890123',
                'url': 'https://www.tiktok.com/@bob/video/1234567890123',
                'postedAt': self.posted['tiktok'],
                'likes': 500, 'comments': 20, 'shares': 3, 'views': 9000,
                'caption': 'unggahan tiktok',
            }],
        })

    def get_json(self, path):
        response = self.client.get(path, headers=API_HEADERS)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()

    def test_latest_rows_carry_every_field_the_activity_table_renders(self):
        rows = self.get_json('/api/latest?limit=10')
        self.assertTrue(rows, 'no snapshot rows — seeding failed')
        for item in rows:
            for field in LATEST_FIELDS:
                self.assertIn(field, item)
            self.assertIn(item['platform'], self.posted)

        by_handle = {(row['platform'], row['username']): row for row in rows}
        for platform, handle in (('instagram', 'alice'), ('tiktok', 'bob')):
            row = by_handle.get((platform, handle))
            self.assertIsNotNone(row, 'target %s@%s missing from /api/latest' % (platform, handle))
            self.assertEqual(row['post_date'], self.posted[platform])

    def test_target_rows_carry_every_field_the_target_table_renders(self):
        data = self.get_json('/api/targets?audit_id=%s&limit=50' % self.audit_id)
        self.assertEqual(data['total'], 2)
        for item in data['items']:
            for field in TARGET_FIELDS:
                self.assertIn(field, item)

        by_handle = {row['username']: row for row in data['items']}
        self.assertEqual(by_handle['bob']['post_date'], self.posted['tiktok'])
        self.assertEqual(by_handle['bob']['views'], 9000)
        self.assertIsNotNone(by_handle['bob']['snapshot_at'])

    def test_history_snapshots_expose_upload_time_and_metrics(self):
        targets = self.get_json('/api/targets?audit_id=%s&limit=50' % self.audit_id)
        bob = [row for row in targets['items'] if row['username'] == 'bob'][0]
        data = self.get_json('/api/history?target_id=%s' % bob['target_id'])
        snapshots = data['snapshots']
        self.assertTrue(snapshots)
        for snapshot in snapshots:
            for field in HISTORY_FIELDS:
                self.assertIn(field, snapshot)
        self.assertEqual(snapshots[0]['post_date'], self.posted['tiktok'])

    def test_search_tables_expose_the_columns_they_print(self):
        data = self.get_json('/api/search?q=bob')
        self.assertIn('posts', data)
        self.assertTrue(data['posts'], 'profile posts are not searchable')
        for post in data['posts']:
            for field in SEARCH_POST_FIELDS:
                self.assertIn(field, post)
        self.assertEqual(data['posts'][0]['posted_at'], self.posted['tiktok'])

        for row in data['targets']:
            for field in SEARCH_TARGET_FIELDS:
                self.assertIn(field, row)
        for row in data['accounts']:
            for field in SEARCH_ACCOUNT_FIELDS:
                self.assertIn(field, row)


if __name__ == '__main__':
    unittest.main(verbosity=2)
