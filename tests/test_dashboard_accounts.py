"""Dashboard account tab: template, script and API must agree on one contract.

The tab is plain ES5 with no build step, so a renamed field or a missing id
fails silently in the browser instead of raising. These tests pin the three
sides together: the ids the script looks up, the sort/filter values the
controls emit, and the fields the row and detail renderers read.

Run from the project root:

    python -m unittest tests.test_dashboard_accounts -v
"""

import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

_TMP = tempfile.TemporaryDirectory(prefix='sa_dash_accounts_')
os.environ.setdefault('SA_DB_PATH', str(Path(_TMP.name) / 'dash.db'))

import app as app_module  # noqa: E402
import database  # noqa: E402

TEST_API_KEY = 'test-key-not-a-secret'
API_HEADERS = {'X-API-Key': TEST_API_KEY}
JS_PATH = ROOT / 'backend' / 'static' / 'dashboard.js'
TEMPLATE_PATH = ROOT / 'backend' / 'templates' / 'dashboard.html'

ROW_FIELDS = (
    'key', 'platform', 'username', 'display_name', 'bio', 'region', 'is_verified',
    'followers', 'following', 'post_count', 'fetched_at', 'data_age_minutes',
    'needs_refresh', 'in_ternak_band', 'audits_seen', 'targets_seen', 'months_seen',
    'follower_delta_pct', 'flags', 'score', 'level', 'peers',
)
METRIC_FIELDS = (
    'posts_seen', 'videos_seen', 'median_views', 'median_likes', 'median_comments',
    'view_reach_pct', 'like_reach_pct', 'posts_per_week', 'upload_burst',
)
FLAG_FIELDS = ('key', 'label', 'detail', 'points')
SORT_KEYS = ('username', 'followers', 'reach', 'posts', 'audits', 'age', 'risk')
LEVEL_NAMES = {name for name, _ in database.RISK_LEVELS}


def js_object(text, marker):
    start = text.index(marker)
    return text[start:text.index('\n  };', start)]


def select_options(text, control_id):
    start = text.index('id="%s"' % control_id)
    return re.findall(r'<option value="([^"]*)"', text[start:text.index('</select>', start)])


class DashboardMarkupTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.js = JS_PATH.read_text(encoding='utf-8')
        cls.html = TEMPLATE_PATH.read_text(encoding='utf-8')

    def test_script_only_looks_up_ids_the_template_defines(self):
        wanted = set(re.findall(r"document\.getElementById\('([^']+)'", self.js))
        self.assertTrue(wanted, 'no element lookups found — the regex is wrong')
        missing = wanted - set(re.findall(r'id="([^"]+)"', self.html))
        self.assertEqual(missing, set())

    def test_accounts_tab_is_a_real_panel_of_the_tablist(self):
        # The dashboard is split into menu pages; Akun is a view of the Data page,
        # so it must still be a real tab with a panel the router can show.
        pages = re.search(r'var PAGES = \[([^\]]+)\]', self.js)
        self.assertIsNotNone(pages, 'router halaman tidak ditemukan')
        self.assertLessEqual({'summary', 'targets', 'accounts'},
                             set(re.findall(r"'([a-z]+)'", pages.group(1))))
        subnav = re.search(r'<div class="subnav" role="tablist"[^>]*>(.*?)\n      </div>',
                           self.html, re.S)
        self.assertIsNotNone(subnav, 'halaman Data harus punya tablist')
        self.assertIn('id="tabAccounts"', subnav.group(1))

        button = re.search(r'id="tabAccounts"[^>]*aria-controls="([^"]+)"', self.html)
        self.assertIsNotNone(button)
        panel = re.search(
            r'<div id="%s"[^>]*role="tabpanel"[^>]*aria-labelledby="tabAccounts"' % button.group(1),
            self.html)
        self.assertIsNotNone(panel)

    def test_risk_labels_cover_exactly_the_backend_levels(self):
        named = set(re.findall(r'^    (\w+): \{ cls:', js_object(self.js, 'var ACCOUNT_LEVELS = {'), re.M))
        self.assertEqual(named, LEVEL_NAMES)

    def test_level_filter_offers_every_level_plus_the_suspicious_shortcut(self):
        self.assertEqual(set(select_options(self.html, 'accountLevel')) - {''},
                         LEVEL_NAMES | {'curiga'})

    def test_band_filter_uses_the_bands_the_query_understands(self):
        self.assertEqual(set(select_options(self.html, 'accountBand')) - {''},
                         {'ternak', 'kecil', 'besar'})

    def test_sort_buttons_are_the_columns_the_api_can_order(self):
        self.assertEqual(set(re.findall(r'data-account-sort="([^"]+)"', self.html)), set(SORT_KEYS))

    def test_reach_explanation_is_wired_to_its_button(self):
        button = re.search(r'id="reachInfoBtn"[^>]*aria-controls="([^"]+)"', self.html)
        self.assertIsNotNone(button)
        self.assertIn('id="%s"' % button.group(1), self.html)


class AccountApiContractTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_dash_case_')
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'dash.db')
        database.init_db()
        app_module.API_KEY = TEST_API_KEY
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()
        self.current_month = database._utc_now().strftime('%Y-%m')
        self.seed()
        self.addCleanup(self._restore)

    def _restore(self):
        database.DB_PATH = self.saved_path
        self.tmp.cleanup()

    def profile(self, username, followers, views, comments, bio, refs, uploaded_at):
        return {
            'platform': 'tiktok',
            'username': username,
            'followerCount': followers,
            'followingCount': 40,
            'postCount': 90,
            'bio': bio,
            'displayName': username.title(),
            'region': 'ID',
            'posts': [{
                'id': ref,
                'url': 'https://www.tiktok.com/@%s/video/%s' % (username, ref),
                'postedAt': uploaded_at,
                'likes': 200,
                'comments': comments,
                'shares': 1,
                'views': views,
                'caption': 'iklan %s nomor %d' % (username, index),
            } for index, ref in enumerate(refs)],
        }

    def seed(self):
        shared = ['900000000001', '900000000002', '900000000003', '900000000004']
        database.record_account_profile(self.profile(
            'ternak.satu', 9000, 120, 0, 'Endorse: WA 0812-3456-7890',
            shared, '2026-10-05T03:00:00Z'))
        database.record_account_profile(self.profile(
            'ternak.dua', 11000, 140, 0, 'endorse: wa 0812 3456 7890',
            shared, '2026-10-05T03:02:00Z'))
        database.record_account_profile(self.profile(
            'koki.asli', 60000, 40000, 320, 'resep baru setiap hari',
            ['700000000001', '700000000002', '700000000003', '700000000004'],
            '2026-10-06T09:00:00Z'))

        conn = database.get_db_connection()
        try:
            cursor = conn.cursor()
            database.record_account_month(
                cursor, 'tiktok', 'ternak.satu',
                captured_at='2026-09-14T03:00:00Z',
                follower_count=8900, following_count=40, post_count=70)
            cursor.execute(
                'INSERT INTO targets (audit_id, platform, url, username, last_scraped_at) '
                'VALUES (1, ?, ?, ?, ?)',
                ('tiktok', 'https://www.tiktok.com/@ternak.satu/video/900000000001',
                 '@ternak.satu (Tiktok)', '2026-10-05 03:05:00'))
            conn.commit()
        finally:
            conn.close()

    def list_accounts(self, **params):
        query = {'limit': '50'}
        query.update(params)
        response = self.client.get('/api/accounts', headers=API_HEADERS, query_string=query)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()

    def test_list_requires_the_api_key(self):
        self.assertEqual(self.client.get('/api/accounts').status_code, 401)

    def test_row_fields_the_table_renders_are_all_present(self):
        data = self.list_accounts()
        self.assertEqual(data['total'], 3)
        for item in data['items']:
            for field in ROW_FIELDS:
                self.assertIn(field, item)
            for field in METRIC_FIELDS:
                self.assertIn(field, item['metrics'])
            for flag in item['flags']:
                for field in FLAG_FIELDS:
                    self.assertIn(field, flag)

    def test_farm_pair_outranks_the_real_account_and_forms_one_cluster(self):
        data = self.list_accounts()
        by_name = {item['username']: item for item in data['items']}
        self.assertGreater(by_name['ternak.satu']['score'], by_name['koki.asli']['score'])
        self.assertEqual(
            {item['username'] for item in data['items'] if item['level'] == 'pola_kembar'},
            {'ternak.satu', 'ternak.dua'})
        self.assertEqual(len(data['clusters']), 1)
        self.assertTrue(data['clusters'][0]['strong'])
        self.assertEqual(data['clusters'][0]['members'],
                         ['tiktok:ternak.dua', 'tiktok:ternak.satu'])

    def test_flag_details_are_readable_text_not_placeholders(self):
        top = self.list_accounts(sort='risk', dir='desc')['items'][0]
        self.assertEqual(top['level'], 'pola_kembar')
        seen = {flag['key']: flag for flag in top['flags']}
        self.assertIn('konten_kembar', seen)
        self.assertIn('kontak_bio_sama', seen)
        self.assertIn('followers_datar', seen)
        self.assertIn('@ternak.dua', seen['konten_kembar']['detail'])
        self.assertIn('dari 9.000 followers', seen['reach_rendah']['detail'])
        for flag in seen.values():
            self.assertNotIn('{', flag['detail'])
            self.assertGreater(flag['points'], 0)

    def test_dirty_sheet_handle_still_counts_as_the_same_account(self):
        item = [row for row in self.list_accounts()['items'] if row['username'] == 'ternak.satu'][0]
        self.assertEqual(item['audits_seen'], 1)
        self.assertEqual(item['targets_seen'], 1)
        self.assertIsNotNone(item['last_verified_at'])

    def test_summary_and_thresholds_feed_the_panel_note(self):
        data = self.list_accounts()
        summary = data['summary']
        for field in ('accounts', 'shown', 'flagged', 'in_band', 'needs_refresh', 'clusters'):
            self.assertIn(field, summary)
        self.assertEqual(summary['accounts'], 3)
        self.assertEqual(summary['in_band'], 2)
        self.assertEqual(summary['clusters'], 1)

        thresholds = data['thresholds']
        for field in ('band', 'view_reach_floor', 'like_reach_floor', 'upload_burst',
                      'flat_follower_tolerance', 'cache_ttl_minutes', 'levels'):
            self.assertIn(field, thresholds)
        self.assertEqual(thresholds['band'],
                         [database.TERNAK_BAND_MIN, database.TERNAK_BAND_MAX])
        self.assertEqual(set(thresholds['levels']), LEVEL_NAMES)

    def test_every_filter_the_controls_emit_is_accepted(self):
        for level in ('curiga',) + tuple(sorted(LEVEL_NAMES)):
            self.assertIn('items', self.list_accounts(level=level))
        self.assertEqual(self.list_accounts(level='curiga')['total'], 2)
        self.assertEqual(self.list_accounts(band='ternak')['total'], 2)
        self.assertEqual(self.list_accounts(band='besar')['total'], 1)
        self.assertEqual(self.list_accounts(platform='instagram')['total'], 0)
        self.assertEqual(self.list_accounts(q='resep')['total'], 1)

    def test_every_sort_column_the_headers_emit_is_accepted(self):
        for sort in SORT_KEYS:
            for direction in ('asc', 'desc'):
                data = self.list_accounts(sort=sort, dir=direction)
                self.assertEqual(len(data['items']), 3, '%s %s' % (sort, direction))

        scores = [item['score'] for item in self.list_accounts(sort='risk', dir='desc')['items']]
        self.assertEqual(scores, sorted(scores, reverse=True))
        names = [item['username'] for item in self.list_accounts(sort='username', dir='asc')['items']]
        self.assertEqual(names, sorted(names))

    def test_detail_modal_gets_identity_evidence_series_and_posts(self):
        response = self.client.get('/api/accounts/tiktok/' + quote('@Ternak.satu (Tiktok)'),
                                   headers=API_HEADERS)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        account = response.get_json()['account']
        self.assertEqual(account['username'], 'ternak.satu')
        for field in ('siblings', 'history', 'posts', 'clusters', 'flags'):
            self.assertIn(field, account)

        self.assertEqual([sibling['username'] for sibling in account['siblings']], ['ternak.dua'])
        self.assertIn('konten', account['siblings'][0]['reasons'])
        self.assertEqual([row['month'] for row in account['history']],
                         ['2026-09', self.current_month])
        self.assertEqual(account['history'][0]['follower_count'], 8900)
        self.assertGreaterEqual(len(account['posts']), 4)
        for field in ('posted_at', 'views', 'likes', 'comments', 'caption'):
            self.assertIn(field, account['posts'][0])
        for member in account['clusters'][0]['members']:
            self.assertTrue(member.startswith('tiktok:'))

    def test_unknown_account_says_so_instead_of_rendering_an_empty_card(self):
        missing = self.client.get('/api/accounts/tiktok/belum.ada', headers=API_HEADERS)
        self.assertEqual(missing.status_code, 404)
        self.assertIn('error', missing.get_json())

    def test_dashboard_page_renders_with_the_account_tab(self):
        page = self.client.get('/').get_data(as_text=True)
        self.assertIn('id="tabAccounts"', page)
        self.assertIn('id="accountBody"', page)


if __name__ == '__main__':
    unittest.main(verbosity=2)
