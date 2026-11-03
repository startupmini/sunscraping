"""Account profile harvesting: one visit fills the fingerprint + recent posts.

Run from the project root:

    python -m unittest tests.test_account_profile -v
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

_TMP = tempfile.TemporaryDirectory(prefix='sa_profile_')
os.environ.setdefault('SA_DB_PATH', str(Path(_TMP.name) / 'profile.db'))

import app as app_module  # noqa: E402
import database  # noqa: E402

TEST_API_KEY = 'test-key-not-a-secret'
API_HEADERS = {'X-API-Key': TEST_API_KEY}


def profile_payload(username='Salsaabl.f_ (Tiktok)', platform='tiktok', posts=None):
    if posts is None:
        posts = [
            {
                'id': f'123456789{i}',
                'url': f'https://www.tiktok.com/@salsaabl.f_/video/123456789{i}',
                'postedAt': f'2026-10-{i + 1:02d}T03:0{i}:00Z',
                'likes': 100 + i,
                'comments': 5,
                'shares': 2,
                'views': 9000 + i,
                'caption': f'iklan ke-{i} #ad',
                'isVideo': True,
            }
            for i in range(12)
        ]
    return {
        'platform': platform,
        'username': username,
        'followerCount': 7400,
        'followingCount': 12,
        'postCount': 214,
        'accountId': '6789012345678',
        'externalId': 'MS4wLjABAAAAsecuid',
        'displayName': 'Salsaabl F',
        'bio': 'Endorse: WA 0812-3456-7890',
        'region': 'ID',
        'isVerified': False,
        'posts': posts,
    }


class UsernameCanonicalTest(unittest.TestCase):
    def test_dirty_sheet_handles_become_joinable_keys(self):
        cases = [
            ('@salsaabl.f_ (Tiktok)', 'salsaabl.f_'),
            ('Alice', 'alice'),
            ('  @Bob [IG] ', 'bob'),
            ('noreply.99', 'noreply.99'),
            ('', None),
            (None, None),
            ('(bu akun)', None),
        ]
        for raw, expected in cases:
            self.assertEqual(database.clean_username(raw), expected, raw)

    def test_post_reference_is_taken_from_the_link(self):
        self.assertEqual(
            database.post_ref_from_url('https://www.tiktok.com/@x/video/1234567890?u=1'),
            '1234567890',
        )
        self.assertEqual(
            database.post_ref_from_url('https://www.instagram.com/p/CaFeC0de/?igsh=abc'),
            'cafec0de',
        )
        self.assertIsNone(database.post_ref_from_url(None))


class AccountProfileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_profile_case_')
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'profile.db')
        database.init_db()
        app_module.API_KEY = TEST_API_KEY
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()
        self.addCleanup(self._restore)

    def _restore(self):
        database.DB_PATH = self.saved_path
        self.tmp.cleanup()

    def rows(self, sql, params=()):
        conn = database.get_db_connection()
        try:
            return [dict(row) for row in conn.execute(sql, params)]
        finally:
            conn.close()

    def test_one_visit_stores_account_and_trims_posts_to_the_cap(self):
        result = database.record_account_profile(profile_payload())
        self.assertEqual(result['username'], 'salsaabl.f_')
        self.assertEqual(result['posts_seen'], 12)
        self.assertEqual(result['posts_stored'], database.MAX_PROFILE_POSTS)
        self.assertTrue(result['truncated'])

        accounts = self.rows("SELECT * FROM accounts WHERE username = 'salsaabl.f_'")
        self.assertEqual(len(accounts), 1)
        account = accounts[0]
        self.assertEqual(account['platform'], 'tiktok')
        self.assertEqual(account['follower_count'], 7400)
        self.assertEqual(account['post_count'], 214)
        self.assertEqual(account['external_id'], 'MS4wLjABAAAAsecuid')
        self.assertEqual(account['bio'], 'Endorse: WA 0812-3456-7890')

        posts = self.rows("SELECT * FROM account_posts WHERE username = 'salsaabl.f_'")
        self.assertEqual(len(posts), database.MAX_PROFILE_POSTS)
        self.assertEqual({row['post_ref'] for row in posts},
                         {f'123456789{i}' for i in range(database.MAX_PROFILE_POSTS)})
        self.assertEqual(posts[0]['views'], 9000)

    def test_second_visit_updates_without_erasing_and_accumulates_posts(self):
        database.record_account_profile(profile_payload())

        partial = profile_payload(posts=[{
            'url': 'https://www.tiktok.com/@salsaabl.f_/video/1234567890',
            'views': 15000,
        }])
        partial.pop('bio')
        partial.pop('followerCount')
        result = database.record_account_profile(partial)
        self.assertEqual(result['posts_stored'], 1)

        account = self.rows("SELECT * FROM accounts") [0]
        self.assertEqual(account['bio'], 'Endorse: WA 0812-3456-7890')
        self.assertEqual(account['follower_count'], 7400)

        posts = self.rows("SELECT views FROM account_posts WHERE post_ref = '1234567890'")
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0]['views'], 15000)
        self.assertEqual(
            self.rows("SELECT COUNT(*) AS c FROM account_posts")[0]['c'],
            database.MAX_PROFILE_POSTS,
        )

    def test_invalid_payloads_are_rejected(self):
        self.assertIsNone(database.record_account_profile(None))
        self.assertIsNone(database.record_account_profile({'username': 'x'}))
        self.assertIsNone(database.record_account_profile({'platform': 'twitter', 'username': 'x'}))
        self.assertIsNone(database.record_account_profile({'platform': 'tiktok', 'username': '  '}))

        result = database.record_account_profile(
            {'platform': 'tiktok', 'username': 'ok', 'posts': 'not-a-list'}
        )
        self.assertEqual(result['posts_stored'], 0)

    def test_api_round_trip(self):
        stored = self.client.post(
            '/api/account/profile', json=profile_payload(platform='instagram',
                                                          username='Alice'),
            headers=API_HEADERS,
        )
        self.assertEqual(stored.status_code, 200, stored.get_data(as_text=True))
        body = stored.get_json()
        self.assertTrue(body['success'])
        self.assertEqual(body['username'], 'alice')
        self.assertEqual(body['posts_stored'], database.MAX_PROFILE_POSTS)

        read = self.client.get('/api/account/profile?platform=instagram&username=@Alice',
                               headers=API_HEADERS).get_json()
        self.assertEqual(read['account']['platform'], 'instagram')
        self.assertEqual(len(read['posts']), database.MAX_PROFILE_POSTS)

        self.assertEqual(self.client.post('/api/account/profile', json={}).status_code, 401)
        missing = self.client.get('/api/account/profile?username=nobody', headers=API_HEADERS)
        self.assertEqual(missing.status_code, 404)

    def test_targets_from_a_dirty_sheet_share_the_canonical_handle(self):
        payload = profile_payload(posts=[])
        payload['username'] = '@Alice (Tiktok)'
        database.record_account_profile(payload)

        row = self.rows("SELECT username FROM accounts")[0]
        self.assertEqual(row['username'], 'alice')


class AccountHistoryTest(unittest.TestCase):
    """The monthly series is what makes "don't scrape it again" and "followers
    never move" answerable; accounts alone only ever holds the latest number."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_history_')
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'history.db')
        database.init_db()
        self.addCleanup(self._restore)

    def _restore(self):
        database.DB_PATH = self.saved_path
        self.tmp.cleanup()

    def rows(self, sql, params=()):
        conn = database.get_db_connection()
        try:
            return [dict(row) for row in conn.execute(sql, params)]
        finally:
            conn.close()

    def history(self, username='salsaabl.f_'):
        return self.rows(
            "SELECT * FROM account_history WHERE username = ? ORDER BY month", (username,))

    def test_profile_visit_starts_the_monthly_series(self):
        database.record_account_profile(profile_payload())
        rows = self.history()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['platform'], 'tiktok')
        self.assertEqual(rows[0]['month'], database._utc_now().strftime('%Y-%m'))
        self.assertEqual(rows[0]['follower_count'], 7400)
        self.assertEqual(rows[0]['post_count'], 214)
        self.assertEqual(rows[0]['visits'], 1)

    def test_repeat_visits_in_one_month_do_not_stack_rows(self):
        database.record_account_profile(profile_payload())
        database.record_account_profile(profile_payload())
        rows = self.history()
        self.assertEqual(len(rows), 1, 'one row per account per month, or the series lies')
        self.assertEqual(rows[0]['visits'], 2)

    def test_month_rollover_keeps_the_previous_point(self):
        conn = database.get_db_connection()
        try:
            cursor = conn.cursor()
            database.record_account_month(cursor, 'tiktok', 'salsaabl.f_',
                                          captured_at='2026-09-14T03:00:00Z',
                                          follower_count=7000, post_count=190)
            database.record_account_month(cursor, 'tiktok', 'salsaabl.f_',
                                          captured_at='2026-10-02T03:00:00Z',
                                          follower_count=7010, post_count=240)
            conn.commit()
        finally:
            conn.close()

        rows = self.history()
        self.assertEqual([row['month'] for row in rows], ['2026-09', '2026-10'])
        self.assertEqual([row['follower_count'] for row in rows], [7000, 7010])
        self.assertEqual(rows[1]['post_count'], 240)

    def test_later_visit_in_the_same_month_refines_the_point(self):
        conn = database.get_db_connection()
        try:
            cursor = conn.cursor()
            database.record_account_month(cursor, 'tiktok', 'x', captured_at='2026-10-01T01:00:00Z',
                                          follower_count=7000)
            database.record_account_month(cursor, 'tiktok', 'x', captured_at='2026-10-29T01:00:00Z',
                                          follower_count=7300)
            conn.commit()
        finally:
            conn.close()
        rows = self.history('x')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['follower_count'], 7300)
        self.assertEqual(rows[0]['first_seen_at'], '2026-10-01T01:00:00Z')
        self.assertEqual(rows[0]['last_seen_at'], '2026-10-29T01:00:00Z')
        self.assertEqual(rows[0]['visits'], 2)

    def test_task_result_follower_is_recorded_without_a_profile_visit(self):
        database.create_audit_with_tasks([{
            'url': 'https://www.tiktok.com/@bob/video/1234567890',
            'platform': 'tiktok',
            'username': 'bob',
            'tema': 'kopi',
        }], name='Riwayat')
        task = database.get_next_task()
        self.assertIsNotNone(task)
        settled = database.update_task_result(task['id'], {
            'status': 'OK',
            'likes': 500,
            'comments': 20,
            'views': 30000,
            'followerCount': 12000,
            'username': 'bob',
            'platform': 'tiktok',
        })
        self.assertTrue(settled)

        rows = self.history('bob')
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['month'], database._utc_now().strftime('%Y-%m'))
        self.assertEqual(rows[0]['follower_count'], 12000)

    def test_legacy_accounts_get_a_first_month(self):
        conn = database.get_db_connection()
        try:
            conn.execute("DELETE FROM account_history")
            conn.execute(
                "INSERT INTO accounts (platform, username, follower_count, fetched_at) "
                "VALUES ('tiktok', 'lama', 5000, '2026-07-19T10:00:00Z')")
            conn.commit()
        finally:
            conn.close()
        self.assertEqual(self.rows("SELECT COUNT(*) AS c FROM account_history")[0]['c'], 0)

        conn = database.get_db_connection()
        try:
            inserted = database.backfill_account_history(conn.cursor())
            conn.commit()
        finally:
            conn.close()
        self.assertEqual(inserted, 1)
        rows = self.history('lama')
        self.assertEqual(rows[0]['month'], '2026-07')
        self.assertEqual(rows[0]['follower_count'], 5000)

        conn = database.get_db_connection()
        try:
            self.assertEqual(database.backfill_account_history(conn.cursor()), 0,
                             'backfill must not run twice over a live series')
        finally:
            conn.close()

    def test_clear_all_removes_the_series(self):
        database.record_account_profile(profile_payload())
        self.assertEqual(len(self.history()), 1)
        database.clear_all_tasks()
        self.assertEqual(self.rows("SELECT COUNT(*) AS c FROM account_history")[0]['c'], 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
