"""Visit budget, cached-post reuse and the cheap rerun.

Covers the three cost fixes:
  * a profile visit can answer the post's own task (no navigation)
  * the audit row carries a pre-flight visit estimate against the cycle budget
  * rerun defaults to "only what is not verified yet"

Run from the project root:

    python -m unittest tests.test_visit_budget -v
"""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

_TMP = tempfile.TemporaryDirectory(prefix='sa_budget_')
os.environ.setdefault('SA_DB_PATH', str(Path(_TMP.name) / 'budget.db'))

import app as app_module  # noqa: E402
import database  # noqa: E402

TEST_API_KEY = 'test-key-not-a-secret'
API_HEADERS = {'X-API-Key': TEST_API_KEY}

VIDEO_URL = 'https://www.tiktok.com/@salsaabl.f_/video/1234567890'
OTHER_URL = 'https://www.tiktok.com/@salsaabl.f_/video/9999999999'
IG_URL = 'https://www.instagram.com/p/CODEabc/'


def harvested_posts():
    return [{
        'id': '1234567890',
        'url': VIDEO_URL,
        'postedAt': '2026-10-27T03:33:20Z',
        'likes': 18200,
        'comments': 234,
        'shares': 12,
        'views': 90000,
        'caption': 'iklan kopi #ad',
        'isVideo': True,
    }]


class VisitCacheTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_cache_')
        self.addCleanup(self.tmp.cleanup)
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'cache.db')
        database.init_db()
        app_module.API_KEY = TEST_API_KEY
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()
        self.addCleanup(self._restore_path)

    def _restore_path(self):
        database.DB_PATH = self.saved_path

    def make_audit(self, rows=None, name='Budget'):
        rows = rows if rows is not None else [
            {'url': VIDEO_URL, 'platform': 'tiktok', 'username': 'salsaabl.f_', 'tema': 'kopi'},
            {'url': OTHER_URL, 'platform': 'tiktok', 'username': 'salsaabl.f_', 'tema': 'kopi'},
            {'url': IG_URL, 'platform': 'instagram', 'username': 'alice', 'tema': 'ig'},
        ]
        return database.create_audit_with_tasks(rows, name=name)

    def store_profile(self, username='salsaabl.f_', platform='tiktok', posts=None):
        return database.record_account_profile({
            'platform': platform,
            'username': username,
            'followerCount': 7400,
            'posts': harvested_posts() if posts is None else posts,
        })

    def age_posts(self, minutes):
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes))
        conn = database.get_db_connection()
        try:
            conn.execute(
                "UPDATE account_posts SET fetched_at = ?",
                (cutoff.strftime('%Y-%m-%dT%H:%M:%SZ'),),
            )
            conn.commit()
        finally:
            conn.close()

    def test_profile_visit_answers_the_posts_own_task(self):
        self.make_audit()
        self.store_profile()

        cached = database.get_cached_post_metrics(VIDEO_URL, 'tiktok')
        self.assertIsNotNone(cached, 'the harvest must be reusable')
        self.assertEqual(cached['likes'], 18200)
        self.assertEqual(cached['views'], 90000)
        self.assertEqual(cached['shares'], 12)
        self.assertEqual(cached['username'], 'salsaabl.f_')
        self.assertEqual(cached['followerCount'], 7400)
        self.assertEqual(cached['postDate'], '2026-10-27T03:33:20Z')

    def test_a_post_that_was_never_harvested_still_needs_a_visit(self):
        self.make_audit()
        self.store_profile()
        self.assertIsNone(database.get_cached_post_metrics(OTHER_URL, 'tiktok'))
        self.assertIsNone(database.get_cached_post_metrics('not a url', 'tiktok'))

    def test_a_row_without_numbers_is_not_evidence(self):
        self.make_audit()
        self.store_profile(posts=[{'id': '1234567890', 'url': VIDEO_URL}])
        self.assertIsNone(database.get_cached_post_metrics(VIDEO_URL, 'tiktok'))

    def test_an_old_row_is_not_reused(self):
        self.make_audit()
        self.store_profile()
        self.age_posts(database.POST_CACHE_TTL_MINUTES + 60)
        self.assertIsNone(database.get_cached_post_metrics(VIDEO_URL, 'tiktok'))

    def test_task_next_hands_the_cached_numbers_to_the_worker(self):
        self.make_audit()
        self.store_profile()

        # The tiktok queue is id-ordered, so VIDEO_URL (the harvested post) is first.
        payload = self.client.get('/api/task/next', headers=API_HEADERS).get_json()
        self.assertTrue(payload['hasTask'])
        self.assertEqual(payload['task']['url'], VIDEO_URL)
        self.assertEqual(payload['task']['cachedPost']['views'], 90000)

        second = self.client.get('/api/task/next', headers=API_HEADERS).get_json()
        self.assertTrue(second['hasTask'])
        self.assertIsNone(second['task']['cachedPost'],
                          'an unhaversted post must not look cached')

    def test_reporting_cached_metrics_settles_one_snapshot(self):
        self.make_audit()
        self.store_profile()
        task = database.get_next_task(prefer_platform='tiktok')

        ok = database.update_task_result(task['id'], {
            'status': 'OK',
            'platform': 'tiktok',
            'username': 'salsaabl.f_',
            'likes': 18200,
            'comments': 234,
            'views': 90000,
            'shares': 12,
            'followerCount': 7400,
        })
        self.assertTrue(ok)

        conn = database.get_db_connection()
        try:
            snapshots = conn.execute(
                "SELECT COUNT(*) FROM snapshots WHERE task_id = ?", (task['id'],)
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(snapshots, 1, 'a cache answer is still exactly one visit of evidence')


class VisitEstimateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_estimate_')
        self.addCleanup(self.tmp.cleanup)
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'estimate.db')
        database.init_db()
        self.addCleanup(self._restore_path)

    def _restore_path(self):
        database.DB_PATH = self.saved_path

    def test_estimate_counts_one_visit_per_account_plus_unmeasured_posts(self):
        database.create_audit_with_tasks([
            {'url': VIDEO_URL, 'platform': 'tiktok', 'username': 'salsaabl.f_', 'tema': 'kopi'},
            {'url': OTHER_URL, 'platform': 'tiktok', 'username': 'salsaabl.f_', 'tema': 'kopi'},
            {'url': IG_URL, 'platform': 'instagram', 'username': 'alice', 'tema': 'ig'},
        ], name='Estimate')

        audit = database.get_audits()[0]
        self.assertEqual(audit['account_count'], 2)
        self.assertEqual(audit['target_count'], 3)
        self.assertEqual(audit['cached_targets'], 0)
        self.assertEqual(audit['visit_estimate'], 5)
        self.assertEqual(audit['visit_budget'], database.VISIT_BUDGET_PER_CYCLE)
        self.assertFalse(audit['over_budget'])

        database.record_account_profile({
            'platform': 'tiktok', 'username': 'salsaabl.f_',
            'posts': harvested_posts(),
        })

        after = database.get_audits()[0]
        self.assertEqual(after['cached_targets'], 1)
        self.assertEqual(after['visit_estimate'], 4,
                         'the harvested post should no longer cost a visit')

    def test_over_budget_is_flagged_for_a_large_cycle(self):
        rows = [
            {'url': f'https://www.tiktok.com/@big/video/{1000 + index}',
             'platform': 'tiktok', 'username': 'big', 'tema': 'spam'}
            for index in range(database.VISIT_BUDGET_PER_CYCLE + 1)
        ]
        database.create_audit_with_tasks(rows, name='Huge')
        audit = database.get_audits()[0]
        self.assertTrue(audit['over_budget'])
        self.assertGreater(audit['visit_estimate'], audit['visit_budget'])


class RerunScopeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_rerun_')
        self.addCleanup(self.tmp.cleanup)
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'rerun.db')
        database.init_db()
        app_module.API_KEY = TEST_API_KEY
        app_module.app.config.update(TESTING=True)
        self.client = app_module.app.test_client()
        self.addCleanup(self._restore_path)

    def _restore_path(self):
        database.DB_PATH = self.saved_path

    def seed(self):
        created = database.create_audit_with_tasks([
            {'url': VIDEO_URL, 'platform': 'tiktok', 'username': 'salsaabl.f_', 'tema': 'kopi'},
            {'url': OTHER_URL, 'platform': 'tiktok', 'username': 'salsaabl.f_', 'tema': 'kopi'},
            {'url': IG_URL, 'platform': 'instagram', 'username': 'alice', 'tema': 'ig'},
        ], name='Scope')
        return created['audit_id']

    def settle(self, audit_id, results):
        """Claim every pending task of the audit and answer with `results`."""
        conn = database.get_db_connection()
        try:
            order = [row['url'] for row in conn.execute(
                "SELECT url FROM targets WHERE audit_id = ? ORDER BY id ASC", (audit_id,))]
        finally:
            conn.close()
        by_url = dict(zip(order, results))
        for url, result in by_url.items():
            task = database.get_next_task()
            self.assertIsNotNone(task)
            self.assertEqual(task['url'], url, 'tasks should be handed out in target order')
            if result is not None:
                database.update_task_result(task['id'], result)

    def test_rerun_skips_targets_that_already_have_numbers(self):
        audit_id = self.seed()
        self.settle(audit_id, [
            {'status': 'OK', 'platform': 'tiktok', 'likes': 100, 'views': 5000},
            {'status': 'FAILED', 'platform': 'tiktok', 'error': 'rate limit', 'errorCode': 'THROTTLED'},
            {'status': 'OK', 'platform': 'instagram', 'likes': None, 'views': None, 'comments': None},
        ])

        result = database.enqueue_run(audit_id, trigger='manual')
        self.assertEqual(result['created'], 2,
                         'the throttled post and the metric-less post must run again')
        self.assertEqual(result['skipped_verified'], 1)

    def test_full_rerun_recycles_every_target(self):
        audit_id = self.seed()
        self.settle(audit_id, [
            {'status': 'OK', 'platform': 'tiktok', 'likes': 100, 'views': 5000},
            {'status': 'OK', 'platform': 'tiktok', 'likes': 120, 'views': 6000},
            {'status': 'OK', 'platform': 'instagram', 'likes': 70, 'views': None},
        ])

        cheap = database.enqueue_run(audit_id, trigger='manual')
        self.assertEqual(cheap['created'], 0)

        full = database.enqueue_run(audit_id, trigger='manual', full=True)
        self.assertEqual(full['created'], 3)
        self.assertEqual(full['skipped_verified'], 0)

    def test_api_passes_the_full_flag(self):
        audit_id = self.seed()
        self.settle(audit_id, [
            {'status': 'OK', 'platform': 'tiktok', 'likes': 100, 'views': 5000},
            {'status': 'OK', 'platform': 'tiktok', 'likes': 120, 'views': 6000},
            {'status': 'OK', 'platform': 'instagram', 'likes': 70, 'views': None},
        ])

        cheap = self.client.post(
            f'/api/audits/{audit_id}/rerun', json={}, headers=API_HEADERS).get_json()
        self.assertEqual(cheap['created'], 0)
        self.assertIn('dilewati', cheap['message'])

        full = self.client.post(
            f'/api/audits/{audit_id}/rerun', json={'full': True}, headers=API_HEADERS).get_json()
        self.assertEqual(full['created'], 3)

    def test_scheduled_repeat_re_measures_everything(self):
        """A periodic audit exists to refresh numbers, so it must not inherit
        the cheap default."""
        created = database.create_audit_with_tasks([
            {'url': VIDEO_URL, 'platform': 'tiktok', 'username': 'salsaabl.f_', 'tema': 'kopi'},
            {'url': IG_URL, 'platform': 'instagram', 'username': 'alice', 'tema': 'ig'},
        ], name='Recurring', repeat_days=7)
        audit_id = created['audit_id']
        self.settle(audit_id, [
            {'status': 'OK', 'platform': 'tiktok', 'likes': 100, 'views': 5000},
            {'status': 'OK', 'platform': 'instagram', 'likes': 70, 'views': None},
        ])

        conn = database.get_db_connection()
        try:
            long_ago = (datetime.now(timezone.utc) - timedelta(days=30))
            conn.execute(
                "UPDATE audits SET last_run_at = ? WHERE id = ?",
                (long_ago.strftime('%Y-%m-%d %H:%M:%S'), audit_id),
            )
            conn.commit()
        finally:
            conn.close()

        queued = database.get_next_task()
        self.assertIsNotNone(queued, 'the due schedule should have created a run')

        conn = database.get_db_connection()
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE audit_id = ? AND run_id IN "
                "(SELECT id FROM runs WHERE trigger = 'schedule')",
                (audit_id,),
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 2, 'a scheduled cycle re-measures verified targets too')


if __name__ == '__main__':
    unittest.main()
