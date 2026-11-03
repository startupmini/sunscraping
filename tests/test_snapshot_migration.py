"""Append-only snapshots: migration from the old UNIQUE constraint, and reports.

Never touches the live database — every test builds its own file in a temp dir.

Run from the project root:

    python -m unittest tests.test_snapshot_migration -v
"""

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))

import database  # noqa: E402

LEGACY_SNAPSHOTS = '''
CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_id INTEGER NOT NULL,
    run_id INTEGER NOT NULL,
    task_id INTEGER,
    scraped_at TEXT,
    status TEXT,
    error_code TEXT,
    error_message TEXT,
    likes INTEGER,
    comments INTEGER,
    views INTEGER,
    shares INTEGER,
    follower_count INTEGER,
    post_date TEXT,
    caption TEXT,
    UNIQUE(target_id, run_id)
)
'''


class SnapshotMigrationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='sa_snap_')
        self.db_path = str(Path(self.tmp.name) / 'mig.db')
        self.saved_path = database.DB_PATH
        database.DB_PATH = self.db_path
        database.init_db()
        self.addCleanup(self._restore)

    def _restore(self):
        database.DB_PATH = self.saved_path
        self.tmp.cleanup()

    def connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def downgrade(self):
        """Recreate the snapshots table the way pre-v3 databases defined it."""
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute("DROP TABLE snapshots")
        cursor.execute(LEGACY_SNAPSHOTS)
        conn.commit()
        return conn

    def unique_index_count(self):
        conn = self.connect()
        try:
            return sum(1 for row in conn.execute("PRAGMA index_list(snapshots)") if row[2])
        finally:
            conn.close()

    def test_v2_database_migrates_without_losing_rows(self):
        conn = self.downgrade()
        cursor = conn.cursor()
        rows = [
            (1, 10, 1, 'FAILED', 0, '2026-10-01T01:00:00Z'),
            (2, 10, 2, 'OK', 120, '2026-10-05T01:00:00Z'),
            (3, 11, 1, 'PARTIAL', 7, '2026-10-01T02:00:00Z'),
        ]
        for row in rows:
            cursor.execute(
                "INSERT INTO snapshots (id, target_id, run_id, status, likes, scraped_at)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                row,
            )
        conn.commit()
        conn.close()
        self.assertEqual(self.unique_index_count(), 1)

        database.init_db()

        self.assertEqual(self.unique_index_count(), 0)
        conn = self.connect()
        try:
            stored = [tuple(r) for r in conn.execute(
                "SELECT id, target_id, run_id, status, likes, scraped_at"
                " FROM snapshots ORDER BY id"
            )]
            version = conn.execute("PRAGMA user_version").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(stored, [tuple(row) for row in rows])
        self.assertEqual(version, database.SCHEMA_VERSION)

        # Re-running init_db must not duplicate or re-migrate anything.
        database.init_db()
        self.assertEqual(self.unique_index_count(), 0)
        conn = self.connect()
        try:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0], 3)
        finally:
            conn.close()

    def test_second_attempt_appends_instead_of_overwriting(self):
        audit_id, run_id, target_id = self._seed_run()

        conn = self.connect()
        cursor = conn.cursor()
        for status, likes in (('FAILED', 0), ('OK', 120)):
            database._record_snapshot(
                cursor, target_id=target_id, run_id=run_id, task_id=None,
                status=status, error_code=None, error_message=None,
                likes=likes, comments=1, views=2, shares=3, follower_count=400,
                post_date='2026-10-01T00:00:00Z', caption=None,
                scraped_at='2026-10-01T0%d:00:00Z' % likes,
            )
        conn.commit()
        try:
            stored = [dict(r) for r in cursor.execute(
                "SELECT status, likes FROM snapshots WHERE target_id = ? ORDER BY id",
                (target_id,),
            )]
        finally:
            conn.close()

        self.assertEqual(stored, [{'status': 'FAILED', 'likes': 0},
                                  {'status': 'OK', 'likes': 120}])

    def _seed_run(self, urls=1):
        conn = self.connect()
        cursor = conn.cursor()
        now = database._sql_now()
        cursor.execute(
            "INSERT INTO audits (name, source_filename, repeat_days, created_at) VALUES (?, ?, 0, ?)",
            ('Migrasi', 'mig.csv', now),
        )
        audit_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO runs (audit_id, trigger, status, created_at) VALUES (?, 'manual', 'DONE', ?)",
            (audit_id, now),
        )
        run_id = cursor.lastrowid
        target_ids = []
        for index in range(urls):
            cursor.execute(
                "INSERT INTO targets (audit_id, platform, url, username, tema, created_at)"
                " VALUES (?, 'instagram', ?, 'mig', 'T', ?)",
                (audit_id, f'https://www.instagram.com/p/MIG{index}/', now),
            )
            target_ids.append(cursor.lastrowid)
        conn.commit()
        conn.close()
        return audit_id, run_id, target_ids[0]

    def test_reports_show_the_last_attempt_of_every_run(self):
        audit_id, run_one, target_id = self._seed_run()
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO runs (audit_id, trigger, status, created_at) VALUES (?, 'retry', 'DONE', ?)",
            (audit_id, database._sql_now()),
        )
        run_two = cursor.lastrowid

        attempts = [
            (run_one, 'FAILED', 0, 900),
            (run_one, 'OK', 100, 900),
            (run_two, 'OK', 150, 980),
        ]
        for run_id, status, likes, followers in attempts:
            database._record_snapshot(
                cursor, target_id=target_id, run_id=run_id, task_id=None,
                status=status, error_code=None, error_message=None,
                likes=likes, comments=1, views=2, shares=3,
                follower_count=followers, post_date='2026-10-01T00:00:00Z',
                caption=None, scraped_at=f'2026-10-0{run_id}T00:00:00Z',
            )
        conn.commit()
        conn.close()

        export = database.get_export_rows(audit_id=audit_id)
        self.assertEqual([row['run_id'] for row in export], [run_one, run_two])
        self.assertEqual([row['likes'] for row in export], [100, 150])
        self.assertEqual([row['follower_count'] for row in export], [900, 980])
        # Deltas compare runs, never the discarded first attempt of the same run.
        self.assertIsNone(export[0]['prev_likes'])
        self.assertEqual(export[1]['prev_likes'], 100)

        # A target that failed then succeeded in the same run is no longer a
        # FAILED row in the failure report.
        self.assertEqual(database.get_export_rows(audit_id=audit_id, status='FAILED'), [])
        self.assertEqual(len(database.get_export_rows(audit_id=audit_id, status='OK')), 2)

        history = database.get_target_history(target_id, limit=50)
        self.assertEqual([row['likes'] for row in history], [150, 100])

        latest = database.get_latest_tasks(limit=10, audit_id=audit_id)
        self.assertEqual(len(latest), 1)
        self.assertEqual(latest[0]['likes'], 150)
        self.assertEqual(latest[0]['prev_likes'], 100)

        targets = database.get_targets(audit_id=audit_id)['items']
        self.assertEqual([row['likes'] for row in targets], [150])


    def test_duplicate_report_does_not_append_a_second_visit(self):
        audit_id, run_id, target_id = self._seed_run()
        conn = self.connect()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO tasks (url, platform, username, tema, status, audit_id, run_id, target_id)"
            " VALUES ('https://www.instagram.com/p/MIG0/', 'instagram', 'mig', 'T', 'RUNNING', ?, ?, ?)",
            (audit_id, run_id, target_id),
        )
        task_id = cursor.lastrowid
        conn.commit()
        conn.close()

        report = {'status': 'OK', 'platform': 'instagram', 'likes': 100, 'comments': 1,
                  'views': 2, 'shares': 3, 'followerCount': 900}
        self.assertTrue(database.update_task_result(task_id, report))
        self.assertFalse(database.update_task_result(task_id, report))

        conn = self.connect()
        try:
            count = conn.execute(
                "SELECT COUNT(*) FROM snapshots WHERE target_id = ?", (target_id,)
            ).fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(count, 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
