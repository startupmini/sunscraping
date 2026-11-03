"""Profile-visit queue and run finalisation, on a throwaway database.

Run from the project root:

    python -m unittest tests.test_profile_queue -v
"""

import os
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

_TMP = tempfile.TemporaryDirectory(prefix='sa_profile_queue_')
os.environ['SA_DB_PATH'] = str(Path(_TMP.name) / 'test.db')

import database  # noqa: E402

TARGETS = [
    {'platform': 'instagram', 'url': 'https://www.instagram.com/reel/AAA111/', 'username': None, 'tema': None},
    {'platform': 'tiktok', 'url': 'https://www.tiktok.com/@akun.tt/video/1234567890', 'username': 'akun.tt', 'tema': None},
]


@contextmanager
def connection():
    """sqlite3's own context manager commits but never closes; on Windows the
    open handle blocks the temp directory from being removed."""
    conn = database.get_db_connection()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


class ProfileQueueTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.init_db()

    def setUp(self):
        database.clear_all_tasks()
        with connection() as conn:
            conn.execute('DELETE FROM accounts')
            conn.execute('DELETE FROM account_posts')
            conn.execute('DELETE FROM account_history')

        created = database.create_audit_with_tasks(TARGETS, name='Uji profil', period='2026-11')
        self.audit_id = created['audit_id']

        # Stand in for the post run having already finished: the profile queue
        # refuses to add work while anything is PENDING/RUNNING.
        with connection() as conn:
            conn.execute(
                "UPDATE targets SET username = 'akun.ig' "
                "WHERE audit_id = ? AND platform = 'instagram'",
                (self.audit_id,),
            )
            conn.execute(
                "UPDATE tasks SET status = 'OK', likes = 10, views = 100 WHERE audit_id = ?",
                (self.audit_id,),
            )
            conn.execute(
                "UPDATE runs SET status = 'DONE', finished_at = datetime('now') WHERE audit_id = ?",
                (self.audit_id,),
            )

    def _settle_profile_task(self, task):
        return database.update_task_result(task['id'], {
            'status': 'OK',
            'kind': 'PROFILE',
            'platform': task['platform'],
            'username': task['username'],
        })

    def test_profile_visits_are_queued_once_and_served_first(self):
        first = database.enqueue_profile_visits(self.audit_id)
        self.assertEqual(first['created'], 2, 'both handles should get one visit')

        again = database.enqueue_profile_visits(self.audit_id)
        self.assertEqual(again['created'], 0, 'a second request must not duplicate work')
        self.assertTrue(again.get('pending'))

        task = database.get_next_task()
        self.assertEqual(task['kind'], 'PROFILE')
        self.assertIn(task['username'], ('akun.ig', 'akun.tt'))

    def test_measured_account_is_skipped_and_settling_closes_the_run(self):
        database.record_account_profile({
            'platform': 'instagram',
            'username': 'akun.ig',
            'followerCount': 5200,
            'displayName': 'Akun IG',
            'bio': 'Media partner',
            'posts': [],
        })

        queued = database.enqueue_profile_visits(self.audit_id, only_missing=True)
        self.assertEqual(queued['created'], 1, 'only the unmeasured account needs a visit')

        task = database.get_next_task()
        self.assertEqual(task['username'], 'akun.tt')
        self.assertTrue(self._settle_profile_task(task))

        with connection() as conn:
            run = conn.execute(
                'SELECT status, finished_at FROM runs WHERE id = ?', (queued['run_id'],)
            ).fetchone()
            self.assertEqual(run['status'], 'DONE')
            self.assertIsNotNone(run['finished_at'])

            account = conn.execute(
                "SELECT needs_visit FROM accounts "
                "WHERE platform = 'tiktok' AND username = 'akun.tt'"
            ).fetchone()
            self.assertIsNone(account, 'settling a task must not invent an account row')

            task_row = conn.execute(
                'SELECT status, kind FROM tasks WHERE id = ?', (task['id'],)
            ).fetchone()
            self.assertEqual(task_row['status'], 'OK')
            self.assertEqual(task_row['kind'], 'PROFILE')

    def test_profile_visits_are_queued_while_the_post_queue_is_still_busy(self):
        # The observed failure: 33 posts pending meant no visit was ever queued,
        # so accounts without a follower count stayed unmeasured for the season.
        with connection() as conn:
            conn.execute(
                "UPDATE tasks SET status = 'PENDING' WHERE audit_id = ?",
                (self.audit_id,),
            )

        queued = database.enqueue_profile_visits(self.audit_id)
        self.assertEqual(queued['created'], 2)
        self.assertFalse(queued.get('pending'))

        task = database.get_next_task()
        self.assertEqual(task['kind'], 'PROFILE')

        again = database.enqueue_profile_visits(self.audit_id)
        self.assertEqual(again['created'], 0, 'a waiting visit already exists')
        self.assertTrue(again.get('pending'))

    def test_open_run_with_no_pending_tasks_is_closed_on_next_poll(self):
        with connection() as conn:
            run_id = conn.execute(
                'SELECT id FROM runs WHERE audit_id = ? ORDER BY id DESC LIMIT 1',
                (self.audit_id,),
            ).fetchone()['id']
            conn.execute(
                "UPDATE runs SET status = 'RUNNING', finished_at = NULL WHERE id = ?", (run_id,)
            )

        self.assertIsNone(database.get_next_task())

        with connection() as conn:
            run = conn.execute(
                'SELECT status, finished_at FROM runs WHERE id = ?', (run_id,)
            ).fetchone()
            self.assertEqual(run['status'], 'DONE')
            self.assertIsNotNone(run['finished_at'])


if __name__ == '__main__':
    unittest.main()
