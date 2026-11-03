"""Regressions for the data-quality findings of the audit.

Each test pin one fix: empty-string errors, the needs_visit flag drift, and the
month-named audit period. Every test gets its own database, so the live data is
never touched.

Run from the project root:

    python -m unittest tests.test_data_audit_fixes -v
"""

import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
os.environ.setdefault('SA_DB_PATH', str(Path(tempfile.mkdtemp(prefix='sa_data_')) / 'data.db'))

import database  # noqa: E402


def _full_profile():
    return {
        'platform': 'instagram',
        'username': 'salsaabl.f_',
        'followerCount': 7400,
        'followingCount': 12,
        'postCount': 214,
        'displayName': 'Salsaabl F',
        'bio': 'Endorse: WA 0812-3456-7890',
        'isVerified': False,
        'posts': [
            {
                'id': 'CODE0',
                'url': 'https://www.instagram.com/p/CODE0/',
                'postedAt': '2026-10-01T03:00:00Z',
                'likes': 200,
                'comments': 7,
                'views': 5000,
                'caption': 'caption ke-0',
            }
        ],
    }


class _TempDbTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_data_fix_')
        self.addCleanup(self.tmp.cleanup)
        self.saved = database.DB_PATH
        database.DB_PATH = str(Path(self.tmp.name) / 'data.db')
        database.init_db()
        self.addCleanup(self._restore)

    def _restore(self):
        database.DB_PATH = self.saved

    def rows(self, sql, params=()):
        conn = database.get_db_connection()
        try:
            return [dict(row) for row in conn.execute(sql, params)]
        finally:
            conn.close()

    def seed_audit(self, name='Kampanye'):
        return database.create_audit_with_tasks([{
            'url': 'https://www.tiktok.com/@a/video/1234567890',
            'platform': 'tiktok',
            'username': 'a',
            'tema': 'x',
        }], name=name)


class MonthNameTest(unittest.TestCase):
    def test_month_names_parse(self):
        self.assertEqual(database.month_from_name('Juni'), '06')
        self.assertEqual(database.month_from_name('mei'), '05')
        self.assertEqual(database.month_from_name('Nov 2025'), '11')
        self.assertEqual(database.month_from_name('Agustus-2026'), '08')
        self.assertEqual(database.month_from_name('september (batch 2)'), '09')
        self.assertIsNone(database.month_from_name('Kampanye A'))
        self.assertIsNone(database.month_from_name(''))

    def test_infer_period_uses_current_year(self):
        year = datetime.now().strftime('%Y')
        self.assertEqual(database.infer_period_from_name('Juni'), f'{year}-06')
        self.assertIsNone(database.infer_period_from_name('Promosi Lebaran'))


class ErrorMessageTest(_TempDbTest):
    def test_ok_result_stores_null_error_not_empty_string(self):
        self.seed_audit()
        task = database.get_next_task()
        self.assertIsNotNone(task)
        database.update_task_result(task['id'], {
            'status': 'OK',
            'likes': 100,
            'views': 9000,
            'username': 'a',
            'platform': 'tiktok',
        })
        row = self.rows("SELECT error_message FROM tasks WHERE id = ?", (task['id'],))[0]
        self.assertIsNone(row['error_message'])
        self.assertNotEqual(row['error_message'], '')

    def test_empty_error_backfill_clears_old_rows(self):
        self.seed_audit()
        task = database.get_next_task()
        database.update_task_result(task['id'], {'status': 'OK', 'likes': 1})
        conn = database.get_db_connection()
        try:
            conn.execute("UPDATE tasks SET error_message = '' WHERE id = ?", (task['id'],))
            conn.commit()
        finally:
            conn.close()

        conn = database.get_db_connection()
        try:
            database.backfill_empty_errors(conn.cursor())
            conn.commit()
        finally:
            conn.close()

        row = self.rows("SELECT error_message FROM tasks WHERE id = ?", (task['id'],))[0]
        self.assertIsNone(row['error_message'])


class NeedsVisitTest(_TempDbTest):
    def test_counts_only_profile_visit_keeps_needs_visit(self):
        payload = {
            'platform': 'instagram',
            'username': 'only.counts',
            'followerCount': 18000,
            'postCount': 14000,
            'posts': [],
        }
        database.record_account_profile(payload)
        account = self.rows(
            "SELECT needs_visit FROM accounts WHERE username = 'only.counts'")[0]
        self.assertEqual(account['needs_visit'], 1,
                         'a bare follower count is not a finished visit')

    def test_full_visit_clears_needs_visit(self):
        database.record_account_profile(_full_profile())
        account = self.rows(
            "SELECT needs_visit FROM accounts WHERE username = 'salsaabl.f_'")[0]
        self.assertEqual(account['needs_visit'], 0)

    def test_fresh_posts_clear_a_stale_flag_on_init(self):
        # A post task filled the follower count; the flag stayed 1.
        conn = database.get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO accounts (platform, username, follower_count, needs_visit) "
                "VALUES ('tiktok', 'potret.jember', 31800, 1)")
            cursor.execute(
                "INSERT INTO account_posts (platform, username, post_ref, post_url, "
                "posted_at, fetched_at) VALUES ('tiktok', 'potret.jember', '123', "
                "'https://www.tiktok.com/@potret.jember/video/123', "
                "'2026-11-02T08:00:00Z', ?)", (database._iso_now(),))
            conn.commit()
        finally:
            conn.close()

        database.init_db()

        account = self.rows(
            "SELECT needs_visit FROM accounts WHERE username = 'potret.jember'")[0]
        self.assertEqual(account['needs_visit'], 0,
                         'recent posts already on file, the visit is settled')

    def test_stale_posts_do_not_clear_the_flag(self):
        conn = database.get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO accounts (platform, username, needs_visit) "
                "VALUES ('tiktok', 'lama.tidak.visit', 1)")
            cursor.execute(
                "INSERT INTO account_posts (platform, username, post_ref, post_url, "
                "fetched_at) VALUES ('tiktok', 'lama.tidak.visit', '9', "
                "'https://www.tiktok.com/@x/video/9', '2026-01-01T00:00:00Z')")
            conn.commit()
        finally:
            conn.close()

        database.init_db()

        account = self.rows(
            "SELECT needs_visit FROM accounts WHERE username = 'lama.tidak.visit'")[0]
        self.assertEqual(account['needs_visit'], 1,
                         'posts older than the cache window still need a visit')


class AuditPeriodTest(_TempDbTest):
    def test_month_named_audit_gets_that_month(self):
        self.seed_audit(name='Juni')
        audit = database.get_audits()[0]
        year = datetime.now().strftime('%Y')
        self.assertEqual(audit['period'], f'{year}-06')

    def test_unnamed_month_keeps_current_month(self):
        self.seed_audit(name='Promosi Produk A')
        audit = database.get_audits()[0]
        self.assertEqual(audit['period'], datetime.now().strftime('%Y-%m'))

    def test_explicit_period_wins_over_the_name(self):
        database.create_audit_with_tasks([{
            'url': 'https://www.tiktok.com/@b/video/333',
            'platform': 'tiktok',
        }], name='mei', period='2026-08')
        audit = database.get_audits()[0]
        self.assertEqual(audit['period'], '2026-08')

    def test_migration_refiles_a_month_named_audit(self):
        self.seed_audit(name='Juni')
        conn = database.get_db_connection()
        try:
            conn.execute("UPDATE audits SET period = '2026-11'")
            conn.commit()
        finally:
            conn.close()

        conn = database.get_db_connection()
        try:
            database.infer_audit_periods_from_names(conn.cursor())
            conn.commit()
        finally:
            conn.close()

        audit = self.rows("SELECT period FROM audits")[0]
        self.assertEqual(audit['period'], '2026-06')
        self.assertNotEqual(audit['period'], '2026-11')


if __name__ == '__main__':
    unittest.main(verbosity=2)