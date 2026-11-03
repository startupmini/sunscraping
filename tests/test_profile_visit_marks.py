"""A profile visit that measured nothing must stay queued.

TikTok answered a handful of live profile visits with an empty payload (anti-bot
wall) and those accounts were still stamped ``needs_visit = 0``, so no later
visit was ever queued for them and their follower count stayed null for good.

Run from the project root:

    python -m unittest tests.test_profile_visit_marks -v
"""

import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

_TMP = tempfile.TemporaryDirectory(prefix='sa_visit_marks_')
os.environ.setdefault('SA_DB_PATH', str(Path(_TMP.name) / 'visit.db'))

import database  # noqa: E402


class ProfileVisitMarkTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_visit_case_')
        self.saved_path = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'visit.db')
        database.init_db()
        self.addCleanup(self._restore)

    def _restore(self):
        database.DB_PATH = self.saved_path
        self.tmp.cleanup()

    def visit(self, username, **fields):
        payload = {'platform': 'tiktok', 'username': username, 'posts': []}
        payload.update(fields)
        return database.record_account_profile(payload)

    def row(self, username):
        conn = database.get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT username, follower_count, needs_visit, last_visit_at '
                'FROM accounts WHERE platform = ? AND username = ?',
                ('tiktok', username),
            )
            return dict(cursor.fetchone())
        finally:
            conn.close()

    def test_empty_visit_stays_queued_for_another_attempt(self):
        self.visit('kena.antibot')
        stored = self.row('kena.antibot')
        self.assertEqual(stored['needs_visit'], 1)
        self.assertIsNone(stored['follower_count'])
        self.assertIsNotNone(stored['last_visit_at'])

    def test_counts_only_visit_stays_queued_for_another_attempt(self):
        # A bare follower/post count comes from the meta description, not from a
        # real profile read. Instagram always renders those totals there, so the
        # old rule stamped the account "done" while its biography and recent
        # posts were still missing — and the queue never asked again.
        self.visit('hanya.meta', followerCount=12000, postCount=40)
        stored = self.row('hanya.meta')
        self.assertEqual(stored['needs_visit'], 1)
        self.assertEqual(stored['follower_count'], 12000)

    def test_later_empty_visit_does_not_requeue_a_measured_account(self):
        # A blocked visit after a real one must not reset the flag (MIN keeps 0).
        self.visit('terukur', posts=[{
            'id': '7700000000000000001',
            'url': 'https://www.tiktok.com/@terukur/video/7700000000000000001',
            'postedAt': '2026-10-01T03:00:00Z',
        }], followerCount=12000)
        self.visit('terukur')
        stored = self.row('terukur')
        self.assertEqual(stored['needs_visit'], 0)
        self.assertEqual(stored['follower_count'], 12000)

    def test_identity_without_posts_clears_the_flag(self):
        self.visit('bio.doang', displayName='Bio Doang', bio='WhatsApp 0812-3456-7890')
        self.assertEqual(self.row('bio.doang')['needs_visit'], 0)

    def test_posts_alone_count_as_a_measurement(self):
        self.visit('punya.post', posts=[{
            'id': '7700000000000000001',
            'url': 'https://www.tiktok.com/@punya.post/video/7700000000000000001',
            'postedAt': '2026-10-01T03:00:00Z',
        }])
        self.assertEqual(self.row('punya.post')['needs_visit'], 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
