import os
import sqlite3
from datetime import datetime, timedelta, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get('SA_DB_PATH') or os.path.join(BASE_DIR, 'social_auditor.db')
TASK_LOCK_MINUTES = 5
CACHE_TTL_MINUTES = 7 * 24 * 60
MAX_RETRIES = 3
SCHEMA_VERSION = 2

TASK_COLUMNS = {
    'claimed_at': 'TEXT',
    'locked_until': 'TEXT',
    'retry_count': 'INTEGER DEFAULT 0',
    'likes': 'INTEGER',
    'comments': 'INTEGER',
    'views': 'INTEGER',
    'shares': 'INTEGER',
    'follower_count': 'INTEGER',
    'post_date': 'TEXT',
    'caption': 'TEXT',
    'error_message': 'TEXT',
    'error_code': 'TEXT',
    'scraped_at': 'TEXT',
    'created_at': 'TEXT DEFAULT CURRENT_TIMESTAMP',
    'audit_id': 'INTEGER',
    'run_id': 'INTEGER',
    'target_id': 'INTEGER',
}

TARGET_COLUMNS = {
    'last_scraped_at': 'TEXT',
    'last_status': 'TEXT',
    'last_error': 'TEXT',
}

ERROR_CODES = ('PERMANENT', 'TRANSIENT', 'THROTTLED', 'AUTH')


def _utc_now():
    return datetime.now(timezone.utc)


def _iso_now():
    return _utc_now().isoformat(timespec='seconds').replace('+00:00', 'Z')


def _sql_now():
    return _utc_now().strftime('%Y-%m-%d %H:%M:%S')


def _parse_utc(value):
    if not value:
        return None
    text = str(value).strip()
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        try:
            parsed = datetime.strptime(text, '%Y-%m-%d %H:%M:%S')
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _clean_text(value, max_len=None):
    """Drop lone surrogates (broken emoji from JS substring) before SQLite binding."""
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    value = value.encode('utf-8', 'ignore').decode('utf-8', 'ignore').strip()
    if not value:
        return None
    if max_len is not None and len(value) > max_len:
        value = value[:max_len]
    return value


def _clean_int(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = int(float(value))
    except (TypeError, ValueError, OverflowError):
        return None
    return number if number >= 0 else None


def _clean_error_code(value):
    code = _clean_text(value, 24)
    if not code:
        return None
    code = code.upper()
    return code if code in ERROR_CODES else None


def _infer_error_code(status, message, explicit=None):
    code = _clean_error_code(explicit)
    if code:
        return code
    if status != 'FAILED':
        return None
    text = (message or '').lower()
    if any(token in text for token in ('login', 'session', 'auth', 'kedaluwarsa')):
        return 'AUTH'
    if any(token in text for token in ('private', 'tidak tersedia', 'not available', 'deleted', 'tidak ditemukan')):
        return 'PERMANENT'
    if any(token in text for token in ('timeout', 'network', 'terlalu lambat', 'tidak dapat dihubungi')):
        return 'TRANSIENT'
    return 'TRANSIENT'


def init_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    cursor = conn.cursor()

    cursor.execute('''
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        platform TEXT,
        username TEXT,
        tema TEXT,
        status TEXT DEFAULT 'PENDING',
        likes INTEGER,
        comments INTEGER,
        views INTEGER,
        shares INTEGER,
        follower_count INTEGER,
        post_date TEXT,
        caption TEXT,
        error_message TEXT,
        error_code TEXT,
        scraped_at TEXT,
        claimed_at TEXT,
        locked_until TEXT,
        retry_count INTEGER DEFAULT 0,
        audit_id INTEGER,
        run_id INTEGER,
        target_id INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    cursor.execute('''
    CREATE TABLE IF NOT EXISTS audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        source_filename TEXT,
        repeat_days INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_run_at TEXT
    )
    ''')

    cursor.execute('''
    CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id INTEGER NOT NULL,
        trigger TEXT DEFAULT 'upload',
        status TEXT DEFAULT 'RUNNING',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        finished_at TEXT
    )
    ''')

    cursor.execute('''
    CREATE TABLE IF NOT EXISTS targets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id INTEGER NOT NULL,
        platform TEXT NOT NULL,
        url TEXT NOT NULL,
        username TEXT,
        tema TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_scraped_at TEXT,
        last_status TEXT,
        last_error TEXT,
        UNIQUE(audit_id, url)
    )
    ''')

    cursor.execute('''
    CREATE TABLE IF NOT EXISTS snapshots (
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
    ''')

    cursor.execute('''
    CREATE TABLE IF NOT EXISTS accounts (
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        follower_count INTEGER,
        fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (platform, username)
    )
    ''')

    # Legacy cache table kept so older databases migrate without data loss.
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS account_cache (
        username TEXT PRIMARY KEY,
        platform TEXT,
        follower_count INTEGER,
        fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    ensure_schema(cursor)
    ensure_indexes(cursor)
    migrate_legacy(cursor)
    cursor.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()
    conn.close()


def _ensure_columns(cursor, table, columns):
    cursor.execute(f"PRAGMA table_info({table})")
    existing = {row[1] for row in cursor.fetchall()}
    for column, definition in columns.items():
        if column not in existing:
            try:
                cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
            except sqlite3.OperationalError:
                pass


def ensure_schema(cursor):
    _ensure_columns(cursor, 'tasks', TASK_COLUMNS)
    _ensure_columns(cursor, 'targets', TARGET_COLUMNS)


def ensure_indexes(cursor):
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status_platform ON tasks(status, platform)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_scraped_at ON tasks(scraped_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks(run_id, status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_audit ON tasks(audit_id, status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_targets_audit ON targets(audit_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_runs_audit ON runs(audit_id, id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_target ON snapshots(target_id, id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_run ON snapshots(run_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_scraped ON snapshots(scraped_at)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_accounts_fetched ON accounts(fetched_at)")

    # Re-auditing the same URL is a core feature now, so the old global
    # uniqueness constraint on tasks(url) must go. Dedupe is per audit target.
    cursor.execute("DROP INDEX IF EXISTS idx_tasks_url_unique")


def migrate_legacy(cursor):
    """Attach pre-audit tasks to a default audit/run and backfill snapshots."""
    cursor.execute("SELECT COUNT(*) AS count FROM tasks WHERE audit_id IS NULL")
    row = cursor.fetchone()
    pending_legacy = row['count'] if row else 0

    if pending_legacy:
        cursor.execute("SELECT id FROM audits WHERE name = 'Audit Awal' ORDER BY id LIMIT 1")
        audit_row = cursor.fetchone()
        if audit_row:
            audit_id = audit_row['id']
        else:
            cursor.execute(
                "INSERT INTO audits (name, source_filename, repeat_days, created_at, last_run_at) "
                "VALUES (?, ?, 0, ?, ?)",
                ('Audit Awal', 'legacy', _sql_now(), _sql_now()),
            )
            audit_id = cursor.lastrowid

        cursor.execute(
            "SELECT id FROM runs WHERE audit_id = ? AND trigger = 'migration' ORDER BY id LIMIT 1",
            (audit_id,),
        )
        run_row = cursor.fetchone()
        if run_row:
            run_id = run_row['id']
        else:
            cursor.execute(
                "INSERT INTO runs (audit_id, trigger, status, created_at) VALUES (?, 'migration', 'DONE', ?)",
                (audit_id, _sql_now()),
            )
            run_id = cursor.lastrowid

        cursor.execute(
            "SELECT * FROM tasks WHERE audit_id IS NULL ORDER BY id ASC"
        )
        legacy_tasks = cursor.fetchall()

        for task in legacy_tasks:
            url = task['url']
            platform = task['platform']
            cursor.execute(
                "SELECT id FROM targets WHERE audit_id = ? AND url = ?",
                (audit_id, url),
            )
            target_row = cursor.fetchone()
            if target_row:
                target_id = target_row['id']
                cursor.execute(
                    "UPDATE targets SET username = COALESCE(username, ?), tema = COALESCE(tema, ?) WHERE id = ?",
                    (task['username'], task['tema'], target_id),
                )
            else:
                cursor.execute(
                    "INSERT INTO targets (audit_id, platform, url, username, tema, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (audit_id, platform, url, task['username'], task['tema'],
                     task['created_at'] or _sql_now()),
                )
                target_id = cursor.lastrowid

            error_code = _infer_error_code(task['status'], task['error_message'], task['error_code'])
            status = task['status'] or 'PENDING'
            scraped_at = task['scraped_at']
            if status in ('OK', 'PARTIAL', 'FAILED'):
                if not scraped_at:
                    scraped_at = task['created_at'] or _iso_now()
                _record_snapshot(
                    cursor,
                    target_id=target_id,
                    run_id=run_id,
                    task_id=task['id'],
                    status=status,
                    error_code=error_code,
                    error_message=task['error_message'],
                    likes=task['likes'],
                    comments=task['comments'],
                    views=task['views'],
                    shares=task['shares'],
                    follower_count=task['follower_count'],
                    post_date=task['post_date'],
                    caption=task['caption'],
                    scraped_at=scraped_at,
                )

            cursor.execute(
                "UPDATE tasks SET audit_id = ?, run_id = ?, target_id = ?, error_code = COALESCE(error_code, ?) WHERE id = ?",
                (audit_id, run_id, target_id, error_code, task['id']),
            )

        cursor.execute(
            "UPDATE audits SET last_run_at = COALESCE((SELECT MAX(created_at) FROM tasks WHERE audit_id = ?), ?) "
            "WHERE id = ?",
            (audit_id, _sql_now(), audit_id),
        )
        _finalize_run(cursor, run_id)

    # Copy the legacy username-only cache into the platform-aware table.
    cursor.execute('''
        INSERT OR IGNORE INTO accounts (platform, username, follower_count, fetched_at)
        SELECT COALESCE(NULLIF(platform, ''), 'unknown'), username, follower_count, fetched_at
        FROM account_cache
        WHERE username IS NOT NULL AND username <> ''
    ''')


def get_db_connection():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def _record_snapshot(cursor, target_id, run_id, task_id, status, error_code,
                     error_message, likes, comments, views, shares,
                     follower_count, post_date, caption, scraped_at):
    if not target_id or not run_id:
        return
    cursor.execute('''
        INSERT INTO snapshots (
            target_id, run_id, task_id, scraped_at, status, error_code, error_message,
            likes, comments, views, shares, follower_count, post_date, caption
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_id, run_id) DO UPDATE SET
            task_id = excluded.task_id,
            scraped_at = excluded.scraped_at,
            status = excluded.status,
            error_code = excluded.error_code,
            error_message = excluded.error_message,
            likes = excluded.likes,
            comments = excluded.comments,
            views = excluded.views,
            shares = excluded.shares,
            follower_count = excluded.follower_count,
            post_date = excluded.post_date,
            caption = excluded.caption
    ''', (
        target_id, run_id, task_id, scraped_at, status, error_code, error_message,
        likes, comments, views, shares, follower_count, post_date, caption,
    ))
    cursor.execute(
        "UPDATE targets SET last_scraped_at = ?, last_status = ?, last_error = ? WHERE id = ?",
        (scraped_at, status, error_message, target_id),
    )


def _finalize_run(cursor, run_id):
    if not run_id:
        return
    cursor.execute(
        "SELECT COUNT(*) AS count FROM tasks WHERE run_id = ? AND status IN ('PENDING', 'RUNNING')",
        (run_id,),
    )
    row = cursor.fetchone()
    if row and row['count'] == 0:
        cursor.execute(
            "UPDATE runs SET status = 'DONE', finished_at = COALESCE(finished_at, ?) WHERE id = ? AND status <> 'DONE'",
            (_sql_now(), run_id),
        )


def _reclaim_expired(cursor):
    cursor.execute(
        "SELECT * FROM tasks WHERE status = 'RUNNING' AND locked_until IS NOT NULL AND locked_until < CURRENT_TIMESTAMP"
    )
    expired = cursor.fetchall()
    if not expired:
        return

    for task in expired:
        next_retry = (task['retry_count'] or 0) + 1
        if next_retry >= MAX_RETRIES:
            message = 'Worker tidak melapor 3x; task dihentikan'
            cursor.execute(
                "UPDATE tasks SET retry_count = ?, status = 'FAILED', error_code = 'TRANSIENT', "
                "error_message = ?, claimed_at = NULL, locked_until = NULL WHERE id = ?",
                (next_retry, message, task['id']),
            )
            _record_snapshot(
                cursor,
                target_id=task['target_id'],
                run_id=task['run_id'],
                task_id=task['id'],
                status='FAILED',
                error_code='TRANSIENT',
                error_message=message,
                likes=task['likes'],
                comments=task['comments'],
                views=task['views'],
                shares=task['shares'],
                follower_count=task['follower_count'],
                post_date=task['post_date'],
                caption=task['caption'],
                scraped_at=_iso_now(),
            )
        else:
            cursor.execute(
                "UPDATE tasks SET retry_count = ?, status = 'PENDING', error_code = 'TRANSIENT', "
                "error_message = 'Worker tidak melapor; task dikembalikan ke antrean', "
                "claimed_at = NULL, locked_until = NULL WHERE id = ?",
                (next_retry, task['id']),
            )

    for run_id in {task['run_id'] for task in expired if task['run_id']}:
        _finalize_run(cursor, run_id)


def _create_run(cursor, audit_id, trigger='manual'):
    cursor.execute(
        "INSERT INTO runs (audit_id, trigger, status, created_at) VALUES (?, ?, 'RUNNING', ?)",
        (audit_id, trigger, _sql_now()),
    )
    run_id = cursor.lastrowid
    cursor.execute(
        "SELECT id, platform, url, username, tema FROM targets WHERE audit_id = ? ORDER BY id ASC",
        (audit_id,),
    )
    targets = cursor.fetchall()
    created = 0
    for target in targets:
        cursor.execute('''
            INSERT INTO tasks (url, platform, username, tema, audit_id, run_id, target_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            target['url'], target['platform'], target['username'], target['tema'],
            audit_id, run_id, target['id'],
        ))
        created += 1
    cursor.execute("UPDATE audits SET last_run_at = ? WHERE id = ?", (_sql_now(), audit_id))
    if created == 0:
        cursor.execute(
            "UPDATE runs SET status = 'DONE', finished_at = ? WHERE id = ?",
            (_sql_now(), run_id),
        )
    return run_id, created


def _auto_enqueue_due(cursor, limit=5):
    cursor.execute("SELECT id, repeat_days, last_run_at, created_at FROM audits WHERE repeat_days > 0")
    now = _utc_now()
    created_total = 0
    for audit in cursor.fetchall():
        if created_total >= limit:
            break
        base = _parse_utc(audit['last_run_at'] or audit['created_at'])
        if not base:
            continue
        if base + timedelta(days=int(audit['repeat_days'])) > now:
            continue
        cursor.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE audit_id = ? AND status IN ('PENDING', 'RUNNING')",
            (audit['id'],),
        )
        row = cursor.fetchone()
        if row and row['count'] > 0:
            continue
        _, created = _create_run(cursor, audit['id'], 'schedule')
        created_total += created
    return created_total


def _audit_row_to_dict(row):
    data = dict(row)
    repeat_days = int(data.get('repeat_days') or 0)
    data['repeat_days'] = repeat_days
    base = _parse_utc(data.get('last_run_at') or data.get('created_at'))
    if repeat_days > 0 and base:
        data['next_due_at'] = (base + timedelta(days=repeat_days)).isoformat(
            timespec='seconds'
        ).replace('+00:00', 'Z')
    else:
        data['next_due_at'] = None
    return data


def get_audits():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT a.*,
                (SELECT COUNT(*) FROM targets t WHERE t.audit_id = a.id) AS target_count,
                (SELECT COUNT(*) FROM tasks tk WHERE tk.audit_id = a.id AND tk.status = 'PENDING') AS pending_count,
                (SELECT COUNT(*) FROM tasks tk WHERE tk.audit_id = a.id AND tk.status = 'RUNNING') AS running_count,
                (SELECT status FROM runs r WHERE r.audit_id = a.id ORDER BY r.id DESC LIMIT 1) AS latest_run_status
            FROM audits a
            ORDER BY a.created_at DESC, a.id DESC
        ''')
        rows = cursor.fetchall()
    finally:
        conn.close()
    return [_audit_row_to_dict(row) for row in rows]


def get_audit(audit_id):
    try:
        audit_id = int(audit_id)
    except (TypeError, ValueError):
        return None
    for audit in get_audits():
        if audit['id'] == audit_id:
            return audit
    return None


def create_audit_with_tasks(tasks_list, name=None, repeat_days=0, source_filename=None):
    if not tasks_list:
        return {'audit_id': None, 'run_id': None, 'inserted': 0, 'duplicates': 0}

    name = _clean_text(name, 120) or f"Audit {datetime.now().strftime('%d-%m-%Y %H:%M')}"
    try:
        repeat_days = max(0, min(365, int(repeat_days or 0)))
    except (TypeError, ValueError):
        repeat_days = 0

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute(
            "INSERT INTO audits (name, source_filename, repeat_days, created_at, last_run_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (name, _clean_text(source_filename, 200), repeat_days, _sql_now(), _sql_now()),
        )
        audit_id = cursor.lastrowid
        cursor.execute(
            "INSERT INTO runs (audit_id, trigger, status, created_at) VALUES (?, 'upload', 'RUNNING', ?)",
            (audit_id, _sql_now()),
        )
        run_id = cursor.lastrowid

        inserted = 0
        duplicates = 0
        seen = set()
        for task in tasks_list:
            url = _clean_text(task.get('url'), 2048)
            platform = _clean_text(task.get('platform'), 32)
            if not url or platform not in ('instagram', 'tiktok'):
                continue
            if url in seen:
                duplicates += 1
                continue
            seen.add(url)

            username = _clean_text(task.get('username'), 100)
            tema = _clean_text(task.get('tema'), 150)
            cursor.execute(
                "INSERT OR IGNORE INTO targets (audit_id, platform, url, username, tema, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (audit_id, platform, url, username, tema, _sql_now()),
            )
            if cursor.rowcount == 0:
                duplicates += 1
                continue
            target_id = cursor.lastrowid

            cursor.execute('''
                INSERT INTO tasks (url, platform, username, tema, audit_id, run_id, target_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (url, platform, username, tema, audit_id, run_id, target_id))
            inserted += 1

        conn.commit()
        return {
            'audit_id': audit_id,
            'run_id': run_id,
            'inserted': inserted,
            'duplicates': duplicates,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def insert_tasks(tasks_list):
    """Backward-compatible wrapper: each upload is now its own audit cycle."""
    result = create_audit_with_tasks(tasks_list)
    return result['inserted'], result['duplicates']


def enqueue_run(audit_id, trigger='manual'):
    try:
        audit_id = int(audit_id)
    except (TypeError, ValueError):
        return None

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute("SELECT id FROM audits WHERE id = ?", (audit_id,))
        if not cursor.fetchone():
            conn.rollback()
            return None

        cursor.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE audit_id = ? AND status IN ('PENDING', 'RUNNING')",
            (audit_id,),
        )
        if cursor.fetchone()['count'] > 0:
            conn.commit()
            return {'run_id': None, 'created': 0, 'pending': True}

        cursor.execute("SELECT COUNT(*) AS count FROM targets WHERE audit_id = ?", (audit_id,))
        if cursor.fetchone()['count'] == 0:
            conn.commit()
            return {'run_id': None, 'created': 0, 'empty': True}

        run_id, created = _create_run(cursor, audit_id, trigger)
        conn.commit()
        return {'run_id': run_id, 'created': created, 'pending': False, 'empty': False}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def append_targets_to_audit(audit_id, tasks_list, source_filename=None):
    """Add new targets to an existing audit and enqueue one fresh run."""
    if not tasks_list:
        return None
    try:
        audit_id = int(audit_id)
    except (TypeError, ValueError):
        return None

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute("SELECT id, name FROM audits WHERE id = ?", (audit_id,))
        audit = cursor.fetchone()
        if not audit:
            conn.rollback()
            return None

        inserted = 0
        duplicates = 0
        seen = set()
        pending = []
        for task in tasks_list:
            url = _clean_text(task.get('url'), 2048)
            platform = _clean_text(task.get('platform'), 32)
            if not url or platform not in ('instagram', 'tiktok'):
                continue
            if url in seen:
                duplicates += 1
                continue
            seen.add(url)

            username = _clean_text(task.get('username'), 100)
            tema = _clean_text(task.get('tema'), 150)
            cursor.execute(
                "INSERT OR IGNORE INTO targets (audit_id, platform, url, username, tema, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (audit_id, platform, url, username, tema, _sql_now()),
            )
            if cursor.rowcount == 0:
                duplicates += 1
                continue
            pending.append((cursor.lastrowid, url, platform, username, tema))
            inserted += 1

        run_id = None
        if pending:
            cursor.execute(
                "INSERT INTO runs (audit_id, trigger, status, created_at) "
                "VALUES (?, 'append', 'RUNNING', ?)",
                (audit_id, _sql_now()),
            )
            run_id = cursor.lastrowid
            for target_id, url, platform, username, tema in pending:
                cursor.execute('''
                    INSERT INTO tasks (url, platform, username, tema, audit_id, run_id, target_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (url, platform, username, tema, audit_id, run_id, target_id))
            cursor.execute(
                "UPDATE audits SET last_run_at = ?, source_filename = COALESCE(?, source_filename) "
                "WHERE id = ?",
                (_sql_now(), _clean_text(source_filename, 200), audit_id),
            )

        conn.commit()
        return {
            'audit_id': audit_id,
            'audit_name': audit['name'],
            'run_id': run_id,
            'inserted': inserted,
            'duplicates': duplicates,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def retry_failed_targets(audit_id):
    """Queue a fresh run for targets whose latest task ended in FAILED."""
    try:
        audit_id = int(audit_id)
    except (TypeError, ValueError):
        return None

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute("SELECT id, name FROM audits WHERE id = ?", (audit_id,))
        audit = cursor.fetchone()
        if not audit:
            conn.rollback()
            return None

        cursor.execute('''
            WITH latest AS (
                SELECT tk.target_id, tk.status,
                       ROW_NUMBER() OVER (PARTITION BY tk.target_id ORDER BY tk.id DESC) AS rn
                FROM tasks tk
                WHERE tk.audit_id = ?
            )
            SELECT t.id, t.url, t.platform, t.username, t.tema
            FROM targets t
            JOIN latest l ON l.target_id = t.id AND l.rn = 1
            WHERE t.audit_id = ?
              AND l.status = 'FAILED'
              AND NOT EXISTS (
                  SELECT 1 FROM tasks x
                  WHERE x.target_id = t.id AND x.status IN ('PENDING', 'RUNNING')
              )
            ORDER BY t.id ASC
        ''', (audit_id, audit_id))
        targets = cursor.fetchall()

        run_id = None
        if targets:
            cursor.execute(
                "INSERT INTO runs (audit_id, trigger, status, created_at) "
                "VALUES (?, 'retry', 'RUNNING', ?)",
                (audit_id, _sql_now()),
            )
            run_id = cursor.lastrowid
            for target in targets:
                cursor.execute('''
                    INSERT INTO tasks (url, platform, username, tema, audit_id, run_id, target_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    target['url'], target['platform'], target['username'], target['tema'],
                    audit_id, run_id, target['id'],
                ))
            cursor.execute("UPDATE audits SET last_run_at = ? WHERE id = ?", (_sql_now(), audit_id))

        conn.commit()
        return {
            'audit_id': audit_id,
            'audit_name': audit['name'],
            'run_id': run_id,
            'created': len(targets),
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_next_task(prefer_platform=None):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        _reclaim_expired(cursor)

        def pick_task():
            nonlocal cursor
            if prefer_platform in ('instagram', 'tiktok'):
                cursor.execute('''
                    SELECT * FROM tasks
                    WHERE status = 'PENDING' AND platform = ?
                    ORDER BY id ASC
                    LIMIT 1
                ''', (prefer_platform,))
                found = cursor.fetchone()
                if found:
                    return found
            cursor.execute('''
                SELECT * FROM tasks
                WHERE status = 'PENDING'
                ORDER BY id ASC
                LIMIT 1
            ''')
            return cursor.fetchone()

        task = pick_task()
        if not task:
            # Periodic audits are activated only when the queue is empty, so a
            # large campaign can never be flooded by several runs at once.
            _auto_enqueue_due(cursor)
            task = pick_task()

        if task:
            cursor.execute('''
                UPDATE tasks
                SET status = 'RUNNING',
                    claimed_at = CURRENT_TIMESTAMP,
                    locked_until = datetime('now', ?)
                WHERE id = ?
            ''', (f'+{TASK_LOCK_MINUTES} minutes', task['id']))
            conn.commit()
            return dict(task)

        conn.commit()
        return None
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_task_result(task_id, result):
    """Persist a scraper result. Returns False when the task does not exist."""
    try:
        task_id = int(task_id)
    except (TypeError, ValueError):
        return False
    if not isinstance(result, dict):
        return False

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, retry_count, audit_id, run_id, target_id, platform, url "
            "FROM tasks WHERE id = ?",
            (task_id,),
        )
        row = cursor.fetchone()
        if not row:
            return False

        status = str(result.get('status') or 'OK').upper()
        if status not in ('OK', 'PARTIAL', 'FAILED'):
            status = 'FAILED'

        platform = _clean_text(result.get('platform'), 32) or row['platform']
        error_message = _clean_text(result.get('error'), 500) or ''
        error_code = _infer_error_code(status, error_message, result.get('errorCode'))

        retry_count = row['retry_count'] or 0
        if status == 'FAILED' and error_code == 'TRANSIENT':
            retry_count += 1
            if retry_count < MAX_RETRIES:
                status = 'PENDING'

        username = _clean_text(result.get('username'), 100)
        likes = _clean_int(result.get('likes'))
        comments = _clean_int(result.get('comments'))
        views = _clean_int(result.get('views'))
        shares = _clean_int(result.get('shares'))
        follower_count = _clean_int(result.get('followerCount'))
        post_date = _clean_text(result.get('postDate'), 32)
        caption = _clean_text(result.get('caption'), 500)
        scraped_at = _iso_now()

        cursor.execute('''
            UPDATE tasks SET
                status = ?,
                platform = COALESCE(?, platform),
                username = COALESCE(?, username),
                likes = COALESCE(?, likes),
                comments = COALESCE(?, comments),
                views = COALESCE(?, views),
                shares = COALESCE(?, shares),
                follower_count = COALESCE(?, follower_count),
                post_date = COALESCE(?, post_date),
                caption = COALESCE(?, caption),
                error_message = ?,
                error_code = ?,
                scraped_at = ?,
                claimed_at = NULL,
                locked_until = NULL,
                retry_count = ?
            WHERE id = ?
        ''', (
            status, platform, username, likes, comments, views, shares,
            follower_count, post_date, caption, error_message, error_code,
            scraped_at, retry_count, task_id,
        ))

        if status in ('OK', 'PARTIAL', 'FAILED'):
            _record_snapshot(
                cursor,
                target_id=row['target_id'],
                run_id=row['run_id'],
                task_id=task_id,
                status=status,
                error_code=error_code,
                error_message=error_message,
                likes=likes,
                comments=comments,
                views=views,
                shares=shares,
                follower_count=follower_count,
                post_date=post_date,
                caption=caption,
                scraped_at=scraped_at,
            )

        if username and follower_count is not None:
            cache_platform = platform or 'unknown'
            cursor.execute('''
                INSERT INTO accounts (platform, username, follower_count, fetched_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(platform, username) DO UPDATE SET
                    follower_count = excluded.follower_count,
                    fetched_at = excluded.fetched_at
            ''', (cache_platform, username, follower_count, scraped_at))

        _finalize_run(cursor, row['run_id'])
        conn.commit()
        return True
    finally:
        conn.close()


def get_account_cache(username, platform=None, max_age_minutes=CACHE_TTL_MINUTES):
    if not username:
        return None
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if platform:
            cursor.execute(
                "SELECT follower_count, fetched_at FROM accounts WHERE username = ? AND platform = ?",
                (username, platform),
            )
        else:
            cursor.execute(
                "SELECT follower_count, fetched_at FROM accounts WHERE username = ? ORDER BY fetched_at DESC LIMIT 1",
                (username,),
            )
        row = cursor.fetchone()
    finally:
        conn.close()

    if not row:
        return None

    fetched_at = row['fetched_at']
    if fetched_at and max_age_minutes is not None:
        parsed = _parse_utc(fetched_at)
        if parsed and _utc_now() - parsed > timedelta(minutes=max_age_minutes):
            return None

    return row['follower_count']


def get_latest_tasks(limit=10, audit_id=None):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        where = ''
        params = []
        if audit_id:
            where = 'WHERE t.audit_id = ?'
            params.append(int(audit_id))
        params.append(int(limit))
        cursor.execute(f'''
            WITH ordered AS (
                SELECT s.id, s.target_id, s.run_id, s.scraped_at, s.status,
                       s.error_code, s.error_message, s.likes, s.comments,
                       s.views, s.shares, s.follower_count, s.post_date, s.caption,
                       t.platform, t.username, t.tema, t.url, t.audit_id,
                       a.name AS audit_name,
                       LAG(s.likes) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_likes,
                       LAG(s.comments) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_comments,
                       LAG(s.views) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_views,
                       LAG(s.shares) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_shares,
                       LAG(s.follower_count) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_follower_count,
                       LAG(s.scraped_at) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_scraped_at
                FROM snapshots s
                JOIN targets t ON t.id = s.target_id
                JOIN audits a ON a.id = t.audit_id
                {where}
            ),
            ranked AS (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY target_id ORDER BY id DESC) AS rn
                FROM ordered
            )
            SELECT * FROM ranked WHERE rn = 1 ORDER BY id DESC LIMIT ?
        ''', params)
        rows = cursor.fetchall()
    finally:
        conn.close()

    results = []
    for row in rows:
        item = dict(row)
        item.pop('rn', None)
        results.append(item)
    return results


def get_target_history(target_id, limit=50):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM snapshots WHERE target_id = ? ORDER BY id DESC LIMIT ?",
            (int(target_id), int(limit)),
        )
        rows = cursor.fetchall()
    finally:
        conn.close()
    return [dict(row) for row in rows]


def get_target_with_audit(target_id):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT t.*, a.name AS audit_name
            FROM targets t
            JOIN audits a ON a.id = t.audit_id
            WHERE t.id = ?
        ''', (int(target_id),))
        row = cursor.fetchone()
    finally:
        conn.close()
    return dict(row) if row else None


def get_targets(audit_id=None, status=None, platform=None, query=None,
                sort='recent', direction='desc', limit=50, offset=0):
    """Target-level rows with latest task status and latest snapshot metrics."""
    limit = max(1, min(200, int(limit or 50)))
    offset = max(0, int(offset or 0))

    base = '''
        WITH latest_tasks AS (
            SELECT tk.id, tk.target_id, tk.status, tk.error_code, tk.error_message,
                   tk.retry_count, tk.claimed_at, tk.scraped_at,
                   ROW_NUMBER() OVER (PARTITION BY tk.target_id ORDER BY tk.id DESC) AS rn
            FROM tasks tk
            WHERE tk.target_id IS NOT NULL
        ),
        latest_snapshots AS (
            SELECT s.id, s.target_id, s.likes, s.comments, s.views, s.shares,
                   s.follower_count, s.scraped_at,
                   ROW_NUMBER() OVER (PARTITION BY s.target_id ORDER BY s.id DESC) AS rn
            FROM snapshots s
        )
    '''
    conditions = ['1 = 1']
    params = []
    if audit_id:
        conditions.append('t.audit_id = ?')
        params.append(int(audit_id))
    if platform in ('instagram', 'tiktok'):
        conditions.append('t.platform = ?')
        params.append(platform)
    if status:
        status = str(status).lower()
        if status == 'done':
            conditions.append("COALESCE(lt.status, 'PENDING') IN ('OK', 'PARTIAL')")
        elif status in ('failed', 'pending', 'running'):
            conditions.append("COALESCE(lt.status, 'PENDING') = ?")
            params.append(status.upper())
    if query:
        like = '%' + str(query).strip() + '%'
        conditions.append(
            "(t.username LIKE ? OR t.url LIKE ? OR COALESCE(t.tema, '') LIKE ? OR a.name LIKE ?)"
        )
        params.extend([like, like, like, like])
    where = 'WHERE ' + ' AND '.join(conditions)

    order_map = {
        'followers': 'COALESCE(ls.follower_count, -1)',
        'likes': 'COALESCE(ls.likes, -1)',
        'comments': 'COALESCE(ls.comments, -1)',
        'views': 'COALESCE(ls.views, -1)',
        'recent': 'COALESCE(lt.id, 0)',
    }
    direction = 'ASC' if str(direction).lower() == 'asc' else 'DESC'
    if sort == 'er':
        order = (f'CASE WHEN engagement_rate IS NULL THEN 1 ELSE 0 END ASC, '
                 f'engagement_rate {direction}, t.id DESC')
    elif sort == 'username':
        order = f"LOWER(COALESCE(t.username, '')) {direction}, t.id ASC"
    else:
        expr = order_map.get(sort, order_map['recent'])
        order = f'{expr} {direction}, t.id DESC'

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(base + '''
            SELECT COUNT(*) AS count
            FROM targets t
            JOIN audits a ON a.id = t.audit_id
            LEFT JOIN latest_tasks lt ON lt.target_id = t.id AND lt.rn = 1
            ''' + where, params)
        total = cursor.fetchone()['count']

        cursor.execute(base + '''
            SELECT t.id AS target_id, t.audit_id, a.name AS audit_name,
                   t.platform, t.url, t.username, t.tema, t.created_at,
                   lt.id AS task_id, COALESCE(lt.status, 'PENDING') AS status,
                   lt.error_code, lt.error_message, COALESCE(lt.retry_count, 0) AS retry_count,
                   lt.claimed_at, lt.scraped_at AS task_scraped_at,
                   ls.id AS snapshot_id, ls.likes, ls.comments, ls.views, ls.shares,
                   ls.follower_count, ls.scraped_at AS snapshot_at,
                   CASE
                       WHEN t.platform = 'tiktok' AND COALESCE(ls.views, 0) > 0
                           THEN (COALESCE(ls.likes, 0) + COALESCE(ls.comments, 0)
                                 + COALESCE(ls.shares, 0)) * 100.0 / ls.views
                       WHEN t.platform = 'instagram' AND COALESCE(ls.follower_count, 0) > 0
                           THEN (COALESCE(ls.likes, 0) + COALESCE(ls.comments, 0))
                                 * 100.0 / ls.follower_count
                       ELSE NULL
                   END AS engagement_rate
            FROM targets t
            JOIN audits a ON a.id = t.audit_id
            LEFT JOIN latest_tasks lt ON lt.target_id = t.id AND lt.rn = 1
            LEFT JOIN latest_snapshots ls ON ls.target_id = t.id AND ls.rn = 1
            ''' + where + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?', params + [limit, offset])
        rows = cursor.fetchall()
    finally:
        conn.close()

    items = []
    for row in rows:
        item = dict(row)
        if item.get('engagement_rate') is not None:
            item['engagement_rate'] = round(item['engagement_rate'], 2)
        items.append(item)
    return {'items': items, 'total': total, 'limit': limit, 'offset': offset}


def get_export_rows(audit_id=None, status=None):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        conditions = []
        params = []
        if audit_id:
            conditions.append('t.audit_id = ?')
            params.append(int(audit_id))
        if status:
            conditions.append('s.status = ?')
            params.append(status)
        where = ('WHERE ' + ' AND '.join(conditions)) if conditions else ''
        cursor.execute(f'''
            WITH ordered AS (
                SELECT s.id, s.target_id, s.run_id, s.task_id, s.scraped_at,
                       s.status, s.error_code, s.error_message, s.likes,
                       s.comments, s.views, s.shares, s.follower_count,
                       s.post_date, s.caption,
                       t.platform, t.username, t.tema, t.url, t.audit_id,
                       a.name AS audit_name,
                       COALESCE(tk.retry_count, 0) AS retry_count,
                       LAG(s.likes) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_likes,
                       LAG(s.comments) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_comments,
                       LAG(s.views) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_views,
                       LAG(s.shares) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_shares,
                       LAG(s.follower_count) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_follower_count,
                       LAG(s.scraped_at) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_scraped_at
                FROM snapshots s
                JOIN targets t ON t.id = s.target_id
                JOIN audits a ON a.id = t.audit_id
                LEFT JOIN tasks tk ON tk.id = s.task_id
                {where}
            )
            SELECT * FROM ordered ORDER BY audit_id ASC, target_id ASC, id ASC
        ''', params)
        rows = cursor.fetchall()
    finally:
        conn.close()
    return [dict(row) for row in rows]


def get_dashboard_stats(audit_id=None, reclaim=True):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if reclaim:
            cursor.execute("BEGIN IMMEDIATE")
            _reclaim_expired(cursor)
            conn.commit()

        where = ''
        params = []
        if audit_id:
            where = 'WHERE t.audit_id = ?'
            params.append(int(audit_id))
        cursor.execute(f'''
            WITH latest_tasks AS (
                SELECT tk.target_id, tk.status,
                       ROW_NUMBER() OVER (PARTITION BY tk.target_id ORDER BY tk.id DESC) AS rn
                FROM tasks tk
                JOIN targets t ON t.id = tk.target_id
                {where}
            )
            SELECT status, COUNT(*) AS count
            FROM latest_tasks
            WHERE rn = 1
            GROUP BY status
        ''', params)
        rows = cursor.fetchall()

        target_where = 'WHERE audit_id = ?' if audit_id else ''
        target_params = [int(audit_id)] if audit_id else []
        cursor.execute(f"SELECT COUNT(*) AS count FROM targets {target_where}", target_params)
        target_count = cursor.fetchone()['count']

        cursor.execute(f'''
            SELECT COUNT(*) AS count FROM snapshots s
            JOIN targets t ON t.id = s.target_id
            {('WHERE t.audit_id = ?' if audit_id else '')}
        ''', target_params)
        snapshot_count = cursor.fetchone()['count']
    finally:
        conn.close()

    stats = {
        'TOTAL': 0, 'PENDING': 0, 'RUNNING': 0, 'OK': 0,
        'PARTIAL': 0, 'FAILED': 0,
        'TARGETS': target_count, 'SNAPSHOTS': snapshot_count,
    }
    for row in rows:
        stats[row['status']] = row['count']
        stats['TOTAL'] += row['count']
    return stats


def update_audit(audit_id, name=None, repeat_days=None):
    try:
        audit_id = int(audit_id)
    except (TypeError, ValueError):
        return None

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM audits WHERE id = ?", (audit_id,))
        if not cursor.fetchone():
            return None

        if name is not None:
            clean_name = _clean_text(name, 120)
            if clean_name:
                cursor.execute("UPDATE audits SET name = ? WHERE id = ?", (clean_name, audit_id))
        if repeat_days is not None:
            try:
                repeat_days = max(0, min(365, int(repeat_days)))
            except (TypeError, ValueError):
                repeat_days = 0
            cursor.execute("UPDATE audits SET repeat_days = ? WHERE id = ?", (repeat_days, audit_id))
        conn.commit()
    finally:
        conn.close()
    return get_audit(audit_id)


def delete_audit(audit_id):
    try:
        audit_id = int(audit_id)
    except (TypeError, ValueError):
        return False

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute("SELECT id FROM audits WHERE id = ?", (audit_id,))
        if not cursor.fetchone():
            conn.rollback()
            return False
        cursor.execute(
            "DELETE FROM snapshots WHERE target_id IN (SELECT id FROM targets WHERE audit_id = ?)",
            (audit_id,),
        )
        cursor.execute("DELETE FROM tasks WHERE audit_id = ?", (audit_id,))
        cursor.execute("DELETE FROM targets WHERE audit_id = ?", (audit_id,))
        cursor.execute("DELETE FROM runs WHERE audit_id = ?", (audit_id,))
        cursor.execute("DELETE FROM audits WHERE id = ?", (audit_id,))
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def clear_all_tasks():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute("DELETE FROM snapshots")
        cursor.execute("DELETE FROM tasks")
        cursor.execute("DELETE FROM targets")
        cursor.execute("DELETE FROM runs")
        cursor.execute("DELETE FROM audits")
        cursor.execute("DELETE FROM accounts")
        cursor.execute("DELETE FROM account_cache")
        try:
            cursor.execute(
                "DELETE FROM sqlite_sequence WHERE name IN "
                "('snapshots', 'tasks', 'targets', 'runs', 'audits')"
            )
        except sqlite3.OperationalError:
            pass
        conn.commit()
    finally:
        conn.close()


def get_all_tasks():
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM tasks ORDER BY id ASC")
        rows = cursor.fetchall()
    finally:
        conn.close()
    return [dict(row) for row in rows]


def get_export_tasks():
    """Compatibility shim; export now reads snapshots with delta history."""
    return get_export_rows()
