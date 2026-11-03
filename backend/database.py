import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get('SA_DB_PATH') or os.path.join(BASE_DIR, 'sunscraping.db')
TASK_LOCK_MINUTES = 5
CACHE_TTL_MINUTES = 7 * 24 * 60
MAX_RETRIES = 3
SCHEMA_VERSION = 5

# A cycle is one account plus its posts; the worker stops after this many page
# loads in a cycle. Mirrored by RateLimiter.VISIT_BUDGET in the extension.
VISIT_BUDGET_PER_CYCLE = 500

TASK_COLUMNS = {
    'kind': "TEXT DEFAULT 'POST'",
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

ACCOUNT_COLUMNS = {
    'account_id': 'TEXT',
    'external_id': 'TEXT',
    'display_name': 'TEXT',
    'bio': 'TEXT',
    'region': 'TEXT',
    'following_count': 'INTEGER',
    'post_count': 'INTEGER',
    'is_verified': 'INTEGER',
    # A profile visit is the expensive step; these two columns are what let the
    # queue ask for it exactly once per account instead of guessing.
    'last_visit_at': 'TEXT',
    'needs_visit': 'INTEGER DEFAULT 1',
}

# One profile visit yields this many recent posts; the scraper trims the same
# number so the budget and the table stay predictable.
MAX_PROFILE_POSTS = 10

# A post row harvested minutes ago by the profile visit can answer the post's
# own task. Beyond this window the numbers have drifted enough to re-visit.
POST_CACHE_TTL_MINUTES = 12 * 60

# ---- Farmed / twin account patterns -------------------------------------
# Farmed accounts we watch sit between 5K and 20K followers and are run from a
# single phone. These thresholds are deliberately conservative: one signal
# never convicts, it only moves the score, and the dashboard shows the evidence
# behind every flag so a wrong number can be argued with.
TERNAK_BAND_MIN = 5000
TERNAK_BAND_MAX = 20000
# Median views divided by followers. A real 5K-20K account reaches 10-40% of its
# followers; bought followers almost never pass 3%.
VIEW_REACH_FLOOR = 3.0
IG_LIKE_REACH_FLOOR = 1.0
# Ratios may not judge an account before this many posts were actually seen.
MIN_POSTS_FOR_RATIO = 3
MIN_POSTS_FOR_COMMENT_RATIO = 4
LIKE_FLOOR_WITHOUT_COMMENTS = 50
COMMENT_TO_LIKE_FLOOR = 0.005
# Several uploads inside one short window is the queue of one phone publishing
# a batch, not a person posting when they feel like it.
UPLOAD_BURST_WINDOW_MINUTES = 10
UPLOAD_BURST_MIN_COUNT = 3
# Uploads of two accounts landing in the same short window, counted per pair.
SIBLING_SYNC_WINDOW_MINUTES = 5
SIBLING_SYNC_MIN_HITS = 2
BIO_CONTACT_MIN_DIGITS = 8
CAPTION_TEMPLATE_PREFIX = 40
# Followers either grow or bleed. Flat for months while uploads keep climbing is
# the shape of a number that was bought once and never maintained.
FLAT_FOLLOWER_BANDS = ((TERNAK_BAND_MIN, TERNAK_BAND_MAX), (20000, 100000))
FLAT_FOLLOWER_TOLERANCE = 0.03
FLAT_FOLLOWER_MIN_POST_GROWTH = 5

RISK_LEVELS = (
    ('pola_kembar', 10),
    ('pola_ternak', 6),
    ('amati', 2),
    ('bersih', 0),
)

RISK_FLOORS = dict(RISK_LEVELS)

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


USERNAME_JUNK = re.compile(r'\s*[\(\[\{].*$')


def clean_username(value):
    """Canonical account handle so profile data joins across rows and platforms.

    Upload sheets arrive dirty ("@salsaabl.f_ (Tiktok)") while the scrapers
    report bare handles; without one form, account-level grouping silently misses.
    """
    text = _clean_text(value, 100)
    if not text:
        return None
    text = USERNAME_JUNK.sub('', text.lstrip('@')).strip()
    return text.lower() or None


def post_ref_from_url(url):
    """Stable id for a post taken from its link (video id, shortcode, or the path tail)."""
    text = _clean_text(url, 300)
    if not text:
        return None
    path = re.split(r'[?#]', text, maxsplit=1)[0].rstrip('/')
    tail = path.rsplit('/', 1)[-1] if '/' in path else path
    return tail.lower() or None


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
    if any(token in text for token in ('too many requests', 'rate limit', 'throttl', '429', 'try again later', 'coba lagi nanti', 'temporarily blocked')):
        return 'THROTTLED'
    if any(token in text for token in ('private', 'tidak tersedia', 'not available', 'deleted', 'tidak ditemukan')):
        return 'PERMANENT'
    return 'TRANSIENT'


def parse_repeat_days(value):
    """Repeat interval clamped to 0-365 days, or None when the value is not a number."""
    try:
        return max(0, min(365, int(value)))
    except (TypeError, ValueError):
        return None


def clamp_limit(value, lo, hi, default):
    """Page size clamped to [lo, hi]; blank or zero falls back to default."""
    return max(lo, min(hi, int(value or default)))


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
        caption TEXT
    )
    ''')

    cursor.execute('''
    CREATE TABLE IF NOT EXISTS accounts (
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        follower_count INTEGER,
        fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
        account_id TEXT,
        external_id TEXT,
        display_name TEXT,
        bio TEXT,
        region TEXT,
        following_count INTEGER,
        post_count INTEGER,
        is_verified INTEGER,
        PRIMARY KEY (platform, username)
    )
    ''')

    # Fingerprints of the last posts seen on a profile visit. One profile page
    # costs one visit and yields up to MAX_PROFILE_POSTS rows here, which is how
    # upload-cadence and twin-account patterns become queryable later.
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS account_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        post_ref TEXT NOT NULL,
        post_url TEXT,
        posted_at TEXT,
        likes INTEGER,
        comments INTEGER,
        shares INTEGER,
        views INTEGER,
        caption TEXT,
        is_video INTEGER,
        fetched_at TEXT,
        UNIQUE(platform, username, post_ref)
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

    # One row per account per month. The accounts table only keeps the newest
    # number, but the farmed-account pattern lives in the difference between
    # months: followers flat for a long stretch while uploads keep climbing.
    # This series is also what lets next month's audit skip accounts that have
    # nothing new to learn.
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS account_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT NOT NULL,
        username TEXT NOT NULL,
        month TEXT NOT NULL,
        follower_count INTEGER,
        following_count INTEGER,
        post_count INTEGER,
        first_seen_at TEXT,
        last_seen_at TEXT,
        visits INTEGER DEFAULT 0,
        UNIQUE (platform, username, month)
    )
    ''')

    ensure_schema(cursor)
    migrate_snapshot_uniqueness(cursor)
    ensure_indexes(cursor)
    migrate_legacy(cursor)
    backfill_target_usernames(cursor)
    backfill_audit_periods(cursor)
    infer_audit_periods_from_names(cursor)
    backfill_empty_errors(cursor)
    backfill_account_history(cursor)
    cursor.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    conn.commit()
    conn.close()


AUDIT_COLUMNS = {'period': 'TEXT', 'received_at': 'TEXT'}


def clean_period(value):
    """Month key (YYYY-MM), or None when the input is not a month.

    The campaign is monthly, so a batch without a month is not a batch: the
    caller either supplies one or the current month is used.
    """
    text = str(value or '').strip()
    if len(text) == 10 and text[4] == '-' and text[7] == '-':
        text = text[:7]
    if len(text) != 7 or text[4] != '-' or not text[:4].isdigit() or not text[5:].isdigit():
        return None
    if not 1 <= int(text[5:]) <= 12:
        return None
    return text


# Month names a campaign is commonly titled after ("Juni", "mei", "Nov 2025").
# The monthly audit is filed under the month it names, not the month it was
# uploaded in, otherwise a June batch imported in November pollutes the trend.
MONTH_NAMES = {
    'januari': '01', 'februari': '02', 'maret': '03', 'april': '04',
    'mei': '05', 'juni': '06', 'juli': '07', 'agustus': '08',
    'september': '09', 'oktober': '10', 'november': '11', 'desember': '12',
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05',
    'jun': '06', 'jul': '07', 'aug': '08', 'ago': '08', 'agt': '08',
    'sep': '09', 'sept': '09', 'okt': '10', 'oct': '10',
    'nov': '11', 'dec': '12', 'des': '12',
}


def month_from_name(name):
    """Month number (01-12) parsed from a campaign title, or None."""
    text = _clean_text(name, 60)
    if not text:
        return None
    # "Juni", "juni-2026", "Nov (batch 2)" -> the leading token names the month.
    first = re.split(r'[\s\-/.,]+', text.lower())[0]
    return MONTH_NAMES.get(first)


def infer_period_from_name(name):
    """YYYY-MM inferred from a month-named audit, or None when it is not one."""
    month = month_from_name(name)
    if not month:
        return None
    return f'{datetime.now().strftime("%Y")}-{month}'


def backfill_audit_periods(cursor):
    """Give older audits the month they were created in, and a receipt date."""
    cursor.execute('''
        UPDATE audits
        SET period = COALESCE(NULLIF(period, ''), strftime('%Y-%m', created_at))
        WHERE period IS NULL OR period = ''
    ''')
    cursor.execute('''
        UPDATE audits
        SET received_at = COALESCE(received_at, created_at)
        WHERE received_at IS NULL
    ''')


def infer_audit_periods_from_names(cursor):
    """File a month-named audit under that month.

    Audits uploaded before the period field existed defaulted to the current
    month, so "Juni" imported in November was filed under 2026-11. The name is
    the operator's own label and wins over the accidental default. The year is
    kept from the existing period so only the month is corrected.
    """
    rows = cursor.execute(
        "SELECT id, name, period FROM audits WHERE name IS NOT NULL AND name <> ''"
    ).fetchall()
    for row in rows:
        month = month_from_name(row['name'])
        if not month:
            continue
        current = (row['period'] or '').strip()
        year = current[:4] if len(current) >= 7 and current[:4].isdigit() \
            else datetime.now().strftime('%Y')
        target = f'{year}-{month}'
        if current != target:
            cursor.execute("UPDATE audits SET period = ? WHERE id = ?", (target, row['id']))


def backfill_empty_errors(cursor):
    """'' is not an error. Older runs stored it on every OK row, which made the
    failure filters read those rows as carrying a message they must ignore."""
    cursor.execute("UPDATE tasks SET error_message = NULL WHERE error_message = ''")
    cursor.execute("UPDATE snapshots SET error_message = NULL WHERE error_message = ''")


def backfill_target_usernames(cursor):
    """A target keeps the handle its scraped task learned.

    The write path updates a target when a result arrives, but rows visited
    before that existed still hold an empty username, so the dashboard showed a
    raw URL where the account name belongs. Idempotent: only empty rows move.
    """
    cursor.execute('''
        UPDATE targets
        SET username = (
            SELECT tk.username FROM tasks tk
            WHERE tk.target_id = targets.id
              AND tk.username IS NOT NULL AND tk.username <> ''
            ORDER BY tk.id DESC LIMIT 1
        )
        WHERE (username IS NULL OR username = '')
          AND EXISTS (
            SELECT 1 FROM tasks tk
            WHERE tk.target_id = targets.id
              AND tk.username IS NOT NULL AND tk.username <> ''
          )
    ''')


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
    _ensure_columns(cursor, 'accounts', ACCOUNT_COLUMNS)
    _ensure_columns(cursor, 'audits', AUDIT_COLUMNS)

    # An older build retired a blocked profile visit as "done", so accounts that
    # were never measured kept needs_visit = 0 and no later visit was queued.
    # Repair the flag on every start: it is the queue's only input.
    cursor.execute(
        "UPDATE accounts SET needs_visit = 1 "
        "WHERE follower_count IS NULL AND post_count IS NULL"
    )

    # The opposite drift exists too: a post task can fill an account's
    # follower_count from a post page while needs_visit stays 1, and the MIN()
    # in record_account_profile only ever lowers the flag. Once a profile visit
    # has actually harvested recent posts, the visit is settled — derive the
    # flag from the evidence instead of trusting a number that can only stall.
    fresh_cutoff = (
        datetime.now(timezone.utc) - timedelta(minutes=POST_CACHE_TTL_MINUTES)
    ).isoformat(timespec='seconds').replace('+00:00', 'Z')
    cursor.execute(
        '''
        UPDATE accounts
        SET needs_visit = 0
        WHERE needs_visit <> 0
          AND EXISTS (
              SELECT 1 FROM account_posts p
              WHERE p.platform = accounts.platform
                AND p.username = accounts.username
                AND p.fetched_at >= ?
          )
        ''',
        (fresh_cutoff,),
    )


SNAPSHOT_COLUMNS = (
    'id', 'target_id', 'run_id', 'task_id', 'scraped_at', 'status', 'error_code',
    'error_message', 'likes', 'comments', 'views', 'shares', 'follower_count',
    'post_date', 'caption',
)


def migrate_snapshot_uniqueness(cursor):
    """SCHEMA_VERSION 3: snapshots are append-only.

    The old UNIQUE(target_id, run_id) made every retry overwrite the previous
    attempt, so a failed visit left no trace and the counter history of a post
    within one run was unrecoverable. SQLite cannot drop a table constraint in
    place, so the table is rebuilt with its rows and ids intact.
    """
    cursor.execute("PRAGMA index_list(snapshots)")
    if not any(row[2] for row in cursor.fetchall()):
        return

    cursor.execute("PRAGMA table_info(snapshots)")
    present = [row[1] for row in cursor.fetchall()]
    carried = [name for name in SNAPSHOT_COLUMNS if name in present]
    columns = ', '.join(carried)

    cursor.execute('''
        CREATE TABLE snapshots_append_only (
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
            caption TEXT
        )
    ''')
    cursor.execute(f"INSERT INTO snapshots_append_only ({columns}) SELECT {columns} FROM snapshots")
    cursor.execute("DROP TABLE snapshots")
    cursor.execute("ALTER TABLE snapshots_append_only RENAME TO snapshots")


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
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_account_posts_account ON account_posts(platform, username, posted_at)")
    # Both lookups start from a post, not from its account: the worker asks by
    # ref (a task's URL) and the estimate asks by URL. The unique constraint is
    # prefixed by (platform, username), so it cannot serve either.
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_account_posts_ref ON account_posts(post_ref)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_account_posts_url ON account_posts(post_url)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_account_history_account ON account_history(platform, username, month)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_account_history_month ON account_history(month)")

    # Re-auditing the same URL is a core feature now, so the old global
    # uniqueness constraint on tasks(url) must go. Dedupe is per audit target.
    cursor.execute("DROP INDEX IF EXISTS idx_tasks_url_unique")


def backfill_account_history(cursor):
    """Give accounts harvested before v5 a first month, so the series is not empty."""
    cursor.execute("SELECT COUNT(*) AS count FROM account_history")
    if cursor.fetchone()['count']:
        return 0

    cursor.execute('''
        INSERT INTO account_history (
            platform, username, month, follower_count, following_count,
            post_count, first_seen_at, last_seen_at, visits
        )
        SELECT platform, username, substr(fetched_at, 1, 7), follower_count,
               following_count, post_count, fetched_at, fetched_at, 1
        FROM accounts
        WHERE fetched_at IS NOT NULL AND length(fetched_at) >= 7
    ''')
    return cursor.rowcount


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
            run_id = _insert_run(cursor, audit_id, 'migration', 'DONE')

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


# Tables a backup must carry before it is allowed to replace the live data.
RESTORE_REQUIRED_TABLES = ('audits', 'targets', 'tasks', 'snapshots')
BACKUP_TABLES = (
    'audits', 'targets', 'tasks', 'snapshots', 'accounts',
    'account_posts', 'account_history',
)


def _table_counts(conn, tables):
    counts = {}
    for table in tables:
        try:
            counts[table] = conn.execute(
                f'SELECT COUNT(*) FROM "{table}"'
            ).fetchone()[0]
        except sqlite3.OperationalError:
            counts[table] = None
    return counts


def get_database_info():
    """Size, schema version and row counts for the backup panel."""
    size = 0
    if os.path.exists(DB_PATH):
        size = os.path.getsize(DB_PATH)
    for suffix in ('-wal', '-shm'):
        sidecar = DB_PATH + suffix
        if os.path.exists(sidecar):
            size += os.path.getsize(sidecar)

    conn = get_db_connection()
    try:
        counts = _table_counts(conn, BACKUP_TABLES)
        version = conn.execute('PRAGMA user_version').fetchone()[0] or 0
    finally:
        conn.close()

    updated_at = None
    if os.path.exists(DB_PATH):
        updated_at = (
            datetime.fromtimestamp(os.path.getmtime(DB_PATH), timezone.utc)
            .isoformat(timespec='seconds')
            .replace('+00:00', 'Z')
        )

    return {
        'filename': os.path.basename(DB_PATH),
        'size_bytes': size,
        'updated_at': updated_at,
        'schema_version': version,
        'counts': counts,
    }


def backup_database(destination):
    """Write a transactionally consistent copy of the live database.

    sqlite3's backup API copies pages through a read transaction, so the copy
    stays valid while the worker is writing. The journal is switched back to
    DELETE so the downloaded file is self-contained (no -wal sidecar).
    """
    destination = os.path.abspath(destination)
    folder = os.path.dirname(destination)
    if folder:
        os.makedirs(folder, exist_ok=True)
    for stale in (destination, destination + '-wal', destination + '-shm'):
        if os.path.exists(stale):
            os.remove(stale)

    source = get_db_connection()
    target = sqlite3.connect(destination)
    try:
        source.backup(target)
        target.commit()
        target.execute('PRAGMA journal_mode=DELETE')
        target.commit()
    finally:
        target.close()
        source.close()
    return destination


def inspect_backup(path):
    """Validate an uploaded .db before it may replace the live data."""
    if not os.path.exists(path):
        raise ValueError('File cadangan tidak ditemukan.')
    size = os.path.getsize(path)
    if size < 512:
        raise ValueError('File terlalu kecil untuk menjadi database SQLite.')

    with open(path, 'rb') as handle:
        if handle.read(16) != b'SQLite format 3\x00':
            raise ValueError('File bukan database SQLite (.db) yang valid.')

    try:
        conn = sqlite3.connect(path, timeout=10)
        try:
            check = conn.execute('PRAGMA integrity_check').fetchone()
            if not check or check[0] != 'ok':
                raise ValueError('File cadangan rusak (integrity_check gagal).')

            version = conn.execute('PRAGMA user_version').fetchone()[0] or 0
            if version > SCHEMA_VERSION:
                raise ValueError(
                    f'Cadangan memakai skema {version}, sedangkan aplikasi ini '
                    f'mendukung sampai skema {SCHEMA_VERSION}. Perbarui aplikasi dulu.'
                )

            tables = {
                row[0] for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            missing = [
                name for name in RESTORE_REQUIRED_TABLES if name not in tables
            ]
            if missing:
                raise ValueError(
                    'File bukan cadangan sunscraping: tabel '
                    + ', '.join(missing) + ' tidak ada.'
                )

            counts = _table_counts(conn, BACKUP_TABLES)
        finally:
            conn.close()
    except sqlite3.DatabaseError as exc:
        raise ValueError(
            'File tidak bisa dibaca sebagai database SQLite.'
        ) from exc

    return {
        'schema_version': version,
        'size_bytes': size,
        'counts': counts,
    }


def restore_database(source_path):
    """Replace the live database with a validated backup, then migrate it."""
    source = sqlite3.connect(source_path, timeout=10)
    try:
        destination = sqlite3.connect(DB_PATH, timeout=30)
        try:
            source.backup(destination)
            destination.commit()
            destination.execute('PRAGMA journal_mode=WAL')
            destination.commit()
        finally:
            destination.close()
    finally:
        source.close()
    init_db()


def _record_snapshot(cursor, target_id, run_id, task_id, status, error_code,
                     error_message, likes, comments, views, shares,
                     follower_count, post_date, caption, scraped_at):
    """Append one snapshot per attempt; reports collapse to the last one."""
    if not target_id or not run_id:
        return
    cursor.execute('''
        INSERT INTO snapshots (
            target_id, run_id, task_id, scraped_at, status, error_code, error_message,
            likes, comments, views, shares, follower_count, post_date, caption
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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


def _finalize_stale_runs(cursor):
    """Close any run whose tasks are all settled, including runs orphaned by an
    earlier server restart."""
    cursor.execute("SELECT id FROM runs WHERE status <> 'DONE' AND finished_at IS NULL")
    for row in cursor.fetchall():
        _finalize_run(cursor, row['id'])


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


def _insert_run(cursor, audit_id, trigger, status='RUNNING'):
    cursor.execute(
        "INSERT INTO runs (audit_id, trigger, status, created_at) VALUES (?, ?, ?, ?)",
        (audit_id, trigger, status, _sql_now()),
    )
    return cursor.lastrowid


def _insert_task(cursor, audit_id, run_id, target):
    """Queue one task for a target row (targets table row or _insert_target output)."""
    cursor.execute(
        "INSERT INTO tasks (url, platform, username, tema, audit_id, run_id, target_id) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (target['url'], target['platform'], target['username'], target['tema'],
         audit_id, run_id, target['id']),
    )


def _insert_target(cursor, audit_id, task, seen):
    """Sanitize one upload row and store it as a target of this audit.

    Returns ('invalid', None) for rows without a usable url/platform,
    ('duplicate', None) when the link was already seen in this batch or is
    already stored, and ('inserted', row) with the new target id on success.
    """
    url = _clean_text(task.get('url'), 2048)
    platform = _clean_text(task.get('platform'), 32)
    if not url or platform not in ('instagram', 'tiktok'):
        return 'invalid', None
    if url in seen:
        return 'duplicate', None
    seen.add(url)

    row = {
        'url': url,
        'platform': platform,
        'username': _clean_text(task.get('username'), 100),
        'tema': _clean_text(task.get('tema'), 150),
    }
    cursor.execute(
        "INSERT OR IGNORE INTO targets (audit_id, platform, url, username, tema, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (audit_id, row['platform'], row['url'], row['username'], row['tema'], _sql_now()),
    )
    if cursor.rowcount == 0:
        return 'duplicate', None
    row['id'] = cursor.lastrowid
    return 'inserted', row


def _create_run(cursor, audit_id, trigger='manual', full=False):
    """Queue a run. Unless full=True, targets that already carry verified
    metrics are skipped, so a rerun costs visits only where evidence is missing."""
    run_id = _insert_run(cursor, audit_id, trigger)
    verified_filter = '' if full else '''
        AND NOT EXISTS (
            SELECT 1 FROM tasks v
            WHERE v.target_id = t.id
              AND v.audit_id = t.audit_id
              AND v.status IN ('OK', 'PARTIAL')
              AND (v.likes IS NOT NULL OR v.views IS NOT NULL OR v.comments IS NOT NULL)
              AND v.id = (SELECT MAX(v2.id) FROM tasks v2 WHERE v2.target_id = v.target_id)
        )
    '''
    cursor.execute(
        f"SELECT id, platform, url, username, tema FROM targets t "
        f"WHERE audit_id = ?{verified_filter} ORDER BY id ASC",
        (audit_id,),
    )
    targets = cursor.fetchall()
    for target in targets:
        _insert_task(cursor, audit_id, run_id, target)
    cursor.execute("UPDATE audits SET last_run_at = ? WHERE id = ?", (_sql_now(), audit_id))
    if not targets:
        cursor.execute(
            "UPDATE runs SET status = 'DONE', finished_at = ? WHERE id = ?",
            (_sql_now(), run_id),
        )
    return run_id, len(targets)


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
        # A due periodic audit exists to re-measure: last month's numbers are
        # the point, so it never inherits the skip-verified default.
        _, created = _create_run(cursor, audit['id'], 'schedule', full=True)
        created_total += created
    return created_total


def _audit_row_to_dict(row, cached_targets=0):
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

    # Pre-flight cost of one cycle: every account is visited once (that visit
    # also yields its recent posts), every other post is a visit of its own.
    targets = int(data.get('target_count') or 0)
    accounts = int(data.get('account_count') or 0)
    cached = int(cached_targets or 0)
    data['cached_targets'] = cached
    data['visit_estimate'] = accounts + max(0, targets - cached)
    data['visit_budget'] = VISIT_BUDGET_PER_CYCLE
    data['over_budget'] = data['visit_estimate'] > VISIT_BUDGET_PER_CYCLE
    return data


def _cached_target_counts(cursor, max_age_minutes=POST_CACHE_TTL_MINUTES):
    """How many targets of each audit a profile visit already measured.

    Matched on the post URL the harvester stored, so a link uploaded with query
    parameters still finds its row. Freshness uses the window the worker applies,
    or the estimate would promise savings that no longer exist.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
    cursor.execute(
        '''
        SELECT t.audit_id AS audit_id, COUNT(*) AS cached_count
        FROM targets t
        WHERE EXISTS (
            SELECT 1 FROM account_posts p
            WHERE p.fetched_at > ?
              AND (p.post_url = t.url
                   OR p.post_url = rtrim(t.url, '/')
                   OR substr(t.url, 1, instr(t.url || '?', '?') - 1) = p.post_url)
        )
        GROUP BY t.audit_id
        ''',
        (cutoff.strftime('%Y-%m-%dT%H:%M:%SZ'),),
    )
    return {row['audit_id']: row['cached_count'] for row in cursor.fetchall()}


def get_audits():
    conn = get_db_connection()
    try:
        cursor = conn.execute('''
            SELECT a.*,
                (SELECT COUNT(*) FROM targets t WHERE t.audit_id = a.id) AS target_count,
                (SELECT COUNT(DISTINCT t.username) FROM targets t
                  WHERE t.audit_id = a.id AND t.username IS NOT NULL AND t.username <> '') AS account_count,
                (SELECT COUNT(*) FROM tasks tk WHERE tk.audit_id = a.id AND tk.status = 'PENDING') AS pending_count,
                (SELECT COUNT(*) FROM tasks tk WHERE tk.audit_id = a.id AND tk.status = 'RUNNING') AS running_count,
                (SELECT status FROM runs r WHERE r.audit_id = a.id ORDER BY r.id DESC LIMIT 1) AS latest_run_status
            FROM audits a
            ORDER BY COALESCE(a.period, '') DESC, a.created_at DESC, a.id DESC
        ''')
        rows = cursor.fetchall()
        cached = _cached_target_counts(cursor)
    finally:
        conn.close()
    return [_audit_row_to_dict(row, cached.get(row['id'], 0)) for row in rows]


def get_audit(audit_id):
    try:
        audit_id = int(audit_id)
    except (TypeError, ValueError):
        return None
    for audit in get_audits():
        if audit['id'] == audit_id:
            return audit
    return None


def create_audit_with_tasks(tasks_list, name=None, repeat_days=0, source_filename=None,
                            period=None, received_at=None):
    if not tasks_list:
        return {'audit_id': None, 'run_id': None, 'inserted': 0, 'duplicates': 0}

    raw_name = _clean_text(name, 120)
    # A month-named campaign belongs to that month, not the upload month.
    name = raw_name or f"Audit {datetime.now().strftime('%d-%m-%Y %H:%M')}"
    inferred_period = infer_period_from_name(raw_name) if raw_name else None
    clamped = parse_repeat_days(repeat_days)
    repeat_days = 0 if clamped is None else clamped

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute(
            "INSERT INTO audits (name, source_filename, repeat_days, created_at, last_run_at, period, received_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name, _clean_text(source_filename, 200), repeat_days, _sql_now(), _sql_now(),
             clean_period(period) or inferred_period or datetime.now().strftime('%Y-%m'),
             _clean_text(received_at, 32) or _sql_now()),
        )
        audit_id = cursor.lastrowid
        run_id = _insert_run(cursor, audit_id, 'upload')

        inserted = 0
        duplicates = 0
        seen = set()
        for task in tasks_list:
            outcome, row = _insert_target(cursor, audit_id, task, seen)
            if outcome == 'invalid':
                continue
            if outcome == 'duplicate':
                duplicates += 1
                continue
            _insert_task(cursor, audit_id, run_id, row)
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


def enqueue_run(audit_id, trigger='manual', full=False):
    """Queue a fresh run. full=False (the default) leaves already-verified
    targets alone; a periodic audit passes full=True to re-measure everything."""
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

        run_id, created = _create_run(cursor, audit_id, trigger, full=full)
        conn.commit()
        return {
            'run_id': run_id,
            'created': created,
            'skipped_verified': 0 if full else max(0, _count_targets(cursor, audit_id) - created),
            'full': bool(full),
            'pending': False,
            'empty': False,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _count_targets(cursor, audit_id):
    cursor.execute("SELECT COUNT(*) AS count FROM targets WHERE audit_id = ?", (audit_id,))
    return cursor.fetchone()['count']


def append_targets_to_audit(audit_id, tasks_list, source_filename=None):
    """Add new targets to an existing audit and enqueue one fresh run.

    Returns None only when the audit does not exist. Raises ValueError when the
    caller sends no usable rows or an unusable audit id, so the two cases do not
    get reported to the user as a missing audit.
    """
    if not tasks_list:
        raise ValueError('no target rows to append')
    try:
        audit_id = int(audit_id)
    except (TypeError, ValueError):
        raise ValueError('audit_id is not usable')

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
            outcome, row = _insert_target(cursor, audit_id, task, seen)
            if outcome == 'invalid':
                continue
            if outcome == 'duplicate':
                duplicates += 1
                continue
            pending.append(row)
            inserted += 1

        run_id = None
        if pending:
            run_id = _insert_run(cursor, audit_id, 'append')
            for row in pending:
                _insert_task(cursor, audit_id, run_id, row)
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


def retry_targets(audit_id, target_ids):
    """Queue fresh visits for an explicit user selection of targets.

    Unlike retry_failed_targets, PERMANENT failures are not filtered out: the
    user picked these rows on purpose.
    """
    try:
        audit_id = int(audit_id)
    except (TypeError, ValueError):
        return None

    ids = []
    for value in target_ids or []:
        try:
            number = int(value)
        except (TypeError, ValueError):
            continue
        if number not in ids:
            ids.append(number)
    ids = ids[:200]
    if not ids:
        return {'audit_id': audit_id, 'created': 0, 'run_id': None,
                'skipped_running': 0, 'missing': 0}

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute("SELECT id, name FROM audits WHERE id = ?", (audit_id,))
        audit = cursor.fetchone()
        if not audit:
            conn.rollback()
            return None

        placeholders = ', '.join('?' for _ in ids)
        cursor.execute(f'''
            SELECT t.id, t.url, t.platform, t.username, t.tema
            FROM targets t
            WHERE t.audit_id = ? AND t.id IN ({placeholders})
            ORDER BY t.id ASC
        ''', [audit_id] + ids)
        rows = cursor.fetchall()
        found = {row['id'] for row in rows}

        cursor.execute(f'''
            SELECT DISTINCT target_id FROM tasks
            WHERE audit_id = ? AND status IN ('PENDING', 'RUNNING')
              AND target_id IN ({placeholders})
        ''', [audit_id] + ids)
        running = {row['target_id'] for row in cursor.fetchall()}

        targets = [row for row in rows if row['id'] not in running]
        run_id = None
        if targets:
            run_id = _insert_run(cursor, audit_id, 'retry-selected')
            for target in targets:
                _insert_task(cursor, audit_id, run_id, target)
            cursor.execute("UPDATE audits SET last_run_at = ? WHERE id = ?",
                           (_sql_now(), audit_id))

        conn.commit()
        return {
            'audit_id': audit_id,
            'audit_name': audit['name'],
            'run_id': run_id,
            'created': len(targets),
            'skipped_running': len(running),
            'missing': len(ids) - len(found),
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def retry_failed_targets(audit_id):
    """Queue a fresh run for FAILED targets, skipping PERMANENT failures."""
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
                SELECT tk.target_id, tk.status, tk.error_code,
                       ROW_NUMBER() OVER (PARTITION BY tk.target_id ORDER BY tk.id DESC) AS rn
                FROM tasks tk
                WHERE tk.audit_id = ?
            )
            SELECT t.id, t.url, t.platform, t.username, t.tema, l.error_code AS last_error_code
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
        failed = cursor.fetchall()
        # A PERMANENT failure (deleted post, wrong link) will fail the same way
        # every time; re-visiting it only burns the daily budget.
        targets = [row for row in failed if row['last_error_code'] != 'PERMANENT']
        skipped_permanent = len(failed) - len(targets)

        run_id = None
        if targets:
            run_id = _insert_run(cursor, audit_id, 'retry')
            for target in targets:
                _insert_task(cursor, audit_id, run_id, target)
            cursor.execute("UPDATE audits SET last_run_at = ? WHERE id = ?", (_sql_now(), audit_id))

        conn.commit()
        return {
            'audit_id': audit_id,
            'audit_name': audit['name'],
            'run_id': run_id,
            'created': len(targets),
            'skipped_permanent': skipped_permanent,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def enqueue_profile_visits(audit_id, only_missing=True):
    """Queue one profile visit per account that has nothing stored yet.

    The visit is its own task: it must not depend on a post task happening to
    carry a handle, which is why the Instagram targets were never harvested.
    """
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

        # Older builds marked a blocked visit as done, so accounts with no
        # measurement at all were never queued again. Repair them here, where
        # the queue is decided, instead of relying on a one-off migration.
        cursor.execute(
            "UPDATE accounts SET needs_visit = 1 "
            "WHERE follower_count IS NULL AND post_count IS NULL"
        )

        # A draining post queue used to block profile visits outright, so an
        # account with no follower count stayed unmeasured for a whole campaign.
        # Only another waiting visit needs to stop a second batch.
        cursor.execute(
            "SELECT COUNT(*) AS count FROM tasks "
            "WHERE audit_id = ? AND status IN ('PENDING', 'RUNNING') AND kind = 'PROFILE'",
            (audit_id,),
        )
        if cursor.fetchone()['count']:
            conn.commit()
            return {'audit_id': audit_id, 'run_id': None, 'created': 0, 'pending': True}

        condition = '' if not only_missing else '''
            AND (a.username IS NULL
                 OR a.needs_visit = 1
                 OR a.follower_count IS NULL)
        '''
        cursor.execute(f'''
            SELECT DISTINCT t.platform, t.username
            FROM targets t
            LEFT JOIN accounts a
              ON a.platform = t.platform AND a.username = t.username
            WHERE t.audit_id = ?
              AND t.username IS NOT NULL AND t.username <> ''
              {condition}
            ORDER BY t.id ASC
        ''', (audit_id,))
        candidates = [dict(row) for row in cursor.fetchall()]
        if not candidates:
            conn.commit()
            return {'audit_id': audit_id, 'run_id': None, 'created': 0, 'empty': True}

        run_id = _insert_run(cursor, audit_id, 'profile')
        created = 0
        for row in candidates:
            username = row['username']
            url = (f"https://www.instagram.com/{username}/"
                   if row['platform'] == 'instagram'
                   else f"https://www.tiktok.com/@{username}")
            cursor.execute(
                "INSERT INTO tasks (url, platform, username, tema, audit_id, run_id, kind) "
                "VALUES (?, ?, ?, NULL, ?, ?, 'PROFILE')",
                (url, row['platform'], username, audit_id, run_id),
            )
            created += 1

        cursor.execute("UPDATE audits SET last_run_at = ? WHERE id = ?", (_sql_now(), audit_id))
        _finalize_run(cursor, run_id)
        conn.commit()
        return {'audit_id': audit_id, 'run_id': run_id, 'created': created}
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
            # A profile task is the cheap way to fill an account: one page load
            # yields the fingerprint and its recent posts. Serve those first so
            # the post tasks that follow can be answered from that harvest.
            cursor.execute('''
                SELECT * FROM tasks
                WHERE status = 'PENDING' AND kind = 'PROFILE'
                ORDER BY id ASC
                LIMIT 1
            ''')
            profile_task = cursor.fetchone()
            if profile_task:
                return profile_task

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
            # Nothing left to claim: close runs whose tasks are all settled.
            # Without this a run stayed RUNNING forever after its last task, so
            # "batch finished" could never be trusted.
            _finalize_stale_runs(cursor)
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
    """Persist a scraper result. Returns False when the task is unknown or
    already settled — snapshots are appended, so a resent report would otherwise
    record a second visit that never happened."""
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
            "SELECT id, status, retry_count, audit_id, run_id, target_id, platform, url, kind "
            "FROM tasks WHERE id = ?",
            (task_id,),
        )
        row = cursor.fetchone()
        if not row:
            return False
        if row['status'] != 'RUNNING':
            return False

        # A profile task measures the account, not a post: settling it must not
        # append a snapshot (there is no target) nor be downgraded to PARTIAL
        # for having no likes/views.
        if (row['kind'] or 'POST') == 'PROFILE':
            profile_status = 'FAILED' if str(result.get('status') or 'OK').upper() == 'FAILED' else 'OK'
            # Store a real error only; '' is a meaningless row that fools the
            # failure filters on the dashboard ('' is not NULL, so it reads as
            # "has an error").
            profile_error = _clean_text(result.get('error'), 500)
            settled_at = _iso_now()
            cursor.execute(
                "UPDATE tasks SET status = ?, error_message = ?, error_code = ?, "
                "scraped_at = ?, claimed_at = NULL, locked_until = NULL WHERE id = ?",
                (profile_status, profile_error,
                 _infer_error_code(profile_status, profile_error, result.get('errorCode')),
                 settled_at, task_id),
            )
            # needs_visit is settled by record_account_profile, which knows
            # whether the visit actually measured anything. Clearing it here on
            # status alone would retire an anti-bot wall as a finished visit.
            _finalize_run(cursor, row['run_id'])
            conn.commit()
            return True

        status = str(result.get('status') or 'OK').upper()
        if status not in ('OK', 'PARTIAL', 'FAILED'):
            status = 'FAILED'

        platform = _clean_text(result.get('platform'), 32) or row['platform']
        # '' is not a real error: it only made every OK row carry an empty
        # string that the failure filters on the dashboard then had to ignore.
        error_message = _clean_text(result.get('error'), 500)
        error_code = _infer_error_code(status, error_message, result.get('errorCode'))

        retry_count = row['retry_count'] or 0
        if status == 'FAILED' and error_code == 'TRANSIENT':
            retry_count += 1
            if retry_count < MAX_RETRIES:
                status = 'PENDING'

        username = clean_username(result.get('username'))
        likes = _clean_int(result.get('likes'))
        comments = _clean_int(result.get('comments'))
        views = _clean_int(result.get('views'))
        shares = _clean_int(result.get('shares'))
        follower_count = _clean_int(result.get('followerCount'))
        post_date = _clean_text(result.get('postDate'), 32)
        caption = _clean_text(result.get('caption'), 500)
        scraped_at = _iso_now()

        # A page that produced no metric at all is not a finished post: a profile
        # link, a login wall, or a scraper that read the wrong page all land here.
        # Calling that OK put an empty row in the dashboard and in the export, so
        # it is recorded as PARTIAL and its reason is kept for the operator.
        if status == 'OK' and all(
            value is None for value in (likes, comments, views, shares)
        ):
            status = 'PARTIAL'
            error_code = None
            if not error_message:
                error_message = (
                    'Tidak ada metrik yang terbaca dari halaman; '
                    'pastikan link mengarah ke postingan.'
                )

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

        # The page is the authority on who published the link. A sheet label that
        # contradicts it would make the row's @name disagree with the account the
        # link opens, so the visited handle replaces the stored one.
        if username and row['target_id']:
            cursor.execute(
                "UPDATE targets SET username = ? WHERE id = ?",
                (username, row['target_id']),
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
            record_account_month(
                cursor, cache_platform, username,
                captured_at=scraped_at, follower_count=follower_count,
            )

        _finalize_run(cursor, row['run_id'])
        conn.commit()
        return True
    finally:
        conn.close()


PROFILE_ACCOUNT_FIELDS = (
    ('account_id', 'accountId', 64),
    ('external_id', 'externalId', 128),
    ('display_name', 'displayName', 120),
    ('bio', 'bio', 300),
    ('region', 'region', 16),
)


def _month_of(value):
    parsed = _parse_utc(value)
    return parsed.strftime('%Y-%m') if parsed else None


def record_account_month(cursor, platform, username, captured_at=None,
                         follower_count=None, following_count=None, post_count=None):
    """Add one point to the monthly series of an account.

    The current month's row is updated in place so the series holds the latest
    numbers for this month instead of one row per visit. Without this table the
    follower history that separates a real account from a farmed one is lost on
    every overwrite of the accounts row.
    """
    month = _month_of(captured_at) or _utc_now().strftime('%Y-%m')
    stamp = captured_at or _iso_now()
    cursor.execute('''
        INSERT INTO account_history (
            platform, username, month, follower_count, following_count,
            post_count, first_seen_at, last_seen_at, visits
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(platform, username, month) DO UPDATE SET
            follower_count  = COALESCE(excluded.follower_count,  account_history.follower_count),
            following_count = COALESCE(excluded.following_count, account_history.following_count),
            post_count      = COALESCE(excluded.post_count,      account_history.post_count),
            first_seen_at   = COALESCE(account_history.first_seen_at, excluded.first_seen_at),
            last_seen_at    = MAX(account_history.last_seen_at, excluded.last_seen_at),
            visits          = account_history.visits + 1
    ''', (platform, username, month, follower_count, following_count, post_count, stamp, stamp))


def record_account_profile(payload):
    """Store the result of one profile visit: account fingerprint + recent posts.

    Anything the page did not expose stays as it was, so a partial visit never
    erases data an earlier visit found.
    """
    if not isinstance(payload, dict):
        return None

    platform = _clean_text(payload.get('platform'), 32)
    if platform not in ('instagram', 'tiktok'):
        return None
    username = clean_username(payload.get('username'))
    if not username:
        return None

    verified = payload.get('isVerified')
    account = {
        'follower_count': _clean_int(payload.get('followerCount')),
        'following_count': _clean_int(payload.get('followingCount')),
        'post_count': _clean_int(payload.get('postCount')),
        'is_verified': None if verified is None else (1 if verified else 0),
    }
    for column, key, size in PROFILE_ACCOUNT_FIELDS:
        account[column] = _clean_text(payload.get(key), size)

    fetched_at = _iso_now()
    posts = payload.get('posts')
    posts = posts if isinstance(posts, list) else []
    # A visit that measured nothing (blocked page, anti-bot wall) must not count
    # as "already visited": otherwise the account keeps an empty fingerprint and
    # no later visit is ever queued for it.
    #
    # A bare follower count must NOT count either. Instagram always renders its
    # totals (and display name) in the meta description, so a counts-only visit
    # previously set the account "done" while its biography and recent posts
    # were still missing — the analytics never got the data it scores on, and
    # the queue stopped asking. Only actual posts or a biography prove the
    # visit reached the pages that carry them.
    measured = bool(posts) or account['bio'] is not None
    needs_visit = 0 if measured else 1

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute('''
            INSERT INTO accounts (
                platform, username, follower_count, fetched_at,
                account_id, external_id, display_name, bio, region,
                following_count, post_count, is_verified, needs_visit, last_visit_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(platform, username) DO UPDATE SET
                follower_count  = COALESCE(excluded.follower_count,  accounts.follower_count),
                following_count = COALESCE(excluded.following_count, accounts.following_count),
                post_count      = COALESCE(excluded.post_count,      accounts.post_count),
                account_id      = COALESCE(excluded.account_id,      accounts.account_id),
                external_id     = COALESCE(excluded.external_id,     accounts.external_id),
                display_name    = COALESCE(excluded.display_name,    accounts.display_name),
                bio             = COALESCE(excluded.bio,             accounts.bio),
                region          = COALESCE(excluded.region,          accounts.region),
                is_verified     = COALESCE(excluded.is_verified,     accounts.is_verified),
                fetched_at      = excluded.fetched_at,
                needs_visit     = MIN(accounts.needs_visit, excluded.needs_visit),
                last_visit_at   = excluded.last_visit_at
        ''', (
            platform, username, account['follower_count'], fetched_at,
            account['account_id'], account['external_id'], account['display_name'],
            account['bio'], account['region'], account['following_count'],
            account['post_count'], account['is_verified'], needs_visit, fetched_at,
        ))
        record_account_month(
            cursor, platform, username,
            captured_at=fetched_at,
            follower_count=account['follower_count'],
            following_count=account['following_count'],
            post_count=account['post_count'],
        )

        stored = 0
        for post in posts[:MAX_PROFILE_POSTS]:
            if not isinstance(post, dict):
                continue
            url = _clean_text(post.get('url'), 300)
            ref = (_clean_text(post.get('id'), 64)
                   or _clean_text(post.get('ref'), 64)
                   or post_ref_from_url(url))
            if not ref:
                continue
            cursor.execute('''
                INSERT INTO account_posts (
                    platform, username, post_ref, post_url, posted_at,
                    likes, comments, shares, views, caption, is_video, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(platform, username, post_ref) DO UPDATE SET
                    post_url   = COALESCE(excluded.post_url,   account_posts.post_url),
                    posted_at  = COALESCE(excluded.posted_at,  account_posts.posted_at),
                    likes      = COALESCE(excluded.likes,      account_posts.likes),
                    comments   = COALESCE(excluded.comments,   account_posts.comments),
                    shares     = COALESCE(excluded.shares,     account_posts.shares),
                    views      = COALESCE(excluded.views,      account_posts.views),
                    caption    = COALESCE(excluded.caption,    account_posts.caption),
                    is_video   = COALESCE(excluded.is_video,   account_posts.is_video),
                    fetched_at = excluded.fetched_at
            ''', (
                platform, username, ref, url,
                _clean_text(post.get('postedAt') or post.get('timestamp'), 40),
                _clean_int(post.get('likes')),
                _clean_int(post.get('comments')),
                _clean_int(post.get('shares')),
                _clean_int(post.get('views')),
                _clean_text(post.get('caption'), 500),
                None if post.get('isVideo') is None else (1 if post.get('isVideo') else 0),
                fetched_at,
            ))
            stored += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {
        'platform': platform,
        'username': username,
        'posts_seen': len(posts),
        'posts_stored': stored,
        'truncated': len(posts) > MAX_PROFILE_POSTS,
        'fetched_at': fetched_at,
    }


def get_account_profile(username, platform=None):
    """Stored fingerprint plus the harvested recent posts of one account."""
    username = clean_username(username)
    if not username:
        return None
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if platform:
            cursor.execute("SELECT * FROM accounts WHERE platform = ? AND username = ?",
                           (platform, username))
        else:
            cursor.execute("SELECT * FROM accounts WHERE username = ? ORDER BY fetched_at DESC LIMIT 1",
                           (username,))
        account = cursor.fetchone()
        if not account:
            return None
        cursor.execute('''
            SELECT post_ref, post_url, posted_at, likes, comments, shares, views,
                   caption, is_video, fetched_at
            FROM account_posts
            WHERE platform = ? AND username = ?
            ORDER BY posted_at DESC
        ''', (account['platform'], username))
        posts = [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()
    return {'account': dict(account), 'posts': posts}


def get_account_cache(username, platform=None, max_age_minutes=CACHE_TTL_MINUTES):
    username = clean_username(username)
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


def get_cached_post_metrics(url, platform=None, max_age_minutes=POST_CACHE_TTL_MINUTES):
    """Recent metrics for this exact post, harvested by a profile visit.

    Returns None unless the row carries at least one number: an empty cached row
    is not evidence, and answering a task with it would hide a real scrape.
    """
    post_ref = post_ref_from_url(url)
    if not post_ref:
        return None

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        if platform:
            cursor.execute('''
                SELECT p.post_ref, p.platform, p.username, p.post_url, p.posted_at,
                       p.likes, p.comments, p.shares, p.views, p.caption, p.is_video,
                       p.fetched_at, a.follower_count
                FROM account_posts p
                LEFT JOIN accounts a ON a.platform = p.platform AND a.username = p.username
                WHERE p.post_ref = ? AND p.platform = ?
                ORDER BY p.fetched_at DESC LIMIT 1
            ''', (post_ref, platform))
        else:
            cursor.execute('''
                SELECT p.post_ref, p.platform, p.username, p.post_url, p.posted_at,
                       p.likes, p.comments, p.shares, p.views, p.caption, p.is_video,
                       p.fetched_at, a.follower_count
                FROM account_posts p
                LEFT JOIN accounts a ON a.platform = p.platform AND a.username = p.username
                WHERE p.post_ref = ?
                ORDER BY p.fetched_at DESC LIMIT 1
            ''', (post_ref,))
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

    metrics = {
        'likes': row['likes'],
        'comments': row['comments'],
        'views': row['views'],
        'shares': row['shares'],
    }
    if all(value is None for value in metrics.values()):
        return None

    result = {'url': row['post_url'] or url, 'username': row['username'],
              'platform': row['platform'], 'fetchedAt': fetched_at,
              'followerCount': row['follower_count']}
    result.update(metrics)
    result['caption'] = row['caption']
    result['postDate'] = row['posted_at']
    return result


# ---------------------------------------------------------------------------
# Account intelligence. The monthly series plus two pure layers on top of it:
# per-account signals and the twin clusters they form. Scoring takes plain
# dicts so every threshold can be tested without a database.
# ---------------------------------------------------------------------------

EMAIL_RE = re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')
PHONE_RUN_RE = re.compile(r'\d[\d\s\-\.()/]{5,}\d')
HASHTAG_RE = re.compile(r'#[a-z0-9_]+')


def _account_key(platform, username):
    handle = clean_username(username)
    if not handle:
        return None
    return f'{platform or "unknown"}:{handle}'


def _number(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _median(values):
    numbers = sorted(value for value in (_number(item) for item in values) if value is not None)
    if not numbers:
        return None
    middle = len(numbers) // 2
    if len(numbers) % 2:
        return numbers[middle]
    return (numbers[middle - 1] + numbers[middle]) / 2.0


def _display_int(value):
    """Group digits the way the Indonesian dashboard reads them."""
    return f'{int(value):,}'.replace(',', '.')


def _display_pct(value, digits=1):
    return f'{value:.{digits}f}'.replace('.', ',') + '%'


def _minute_of(value):
    parsed = _parse_utc(value)
    return int(parsed.timestamp() // 60) if parsed else None


def _age_minutes(value, now=None):
    parsed = _parse_utc(value)
    if not parsed:
        return None
    return int(((now or _utc_now()) - parsed).total_seconds() // 60)


def _normalize_phone(digits):
    text = re.sub(r'\D', '', digits)
    if text.startswith('0062'):
        text = text[4:]
    elif text.startswith('62'):
        text = text[2:]
    elif text.startswith('0'):
        text = text[1:]
    return text if len(text) >= BIO_CONTACT_MIN_DIGITS else None


def bio_contact_tokens(bio):
    """Contacts left in a bio. The same WhatsApp number across accounts is the
    clearest public trace of one phone holding several accounts."""
    tokens = set()
    text = _clean_text(bio, 300) or ''
    for match in EMAIL_RE.finditer(text):
        tokens.add('email:' + match.group(0).lower())
    for match in PHONE_RUN_RE.finditer(text):
        phone = _normalize_phone(match.group(0))
        if phone:
            tokens.add('phone:' + phone)
    return tokens


def caption_template_key(caption):
    """Ad copy that repeats across accounts, ignoring hashtags and numbers.

    Dropping digits is deliberate: the same pitch with a different price or
    link is still the same template. Too-short captions never count.
    """
    text = HASHTAG_RE.sub('', str(caption or '').lower())
    text = ' '.join(re.sub(r'\d', '#', text).split())
    if len(text) < CAPTION_TEMPLATE_PREFIX:
        return None
    return text[:CAPTION_TEMPLATE_PREFIX]


def _pair_off(keys, reason, links):
    ordered = sorted(set(keys))
    for index, first in enumerate(ordered):
        for second in ordered[index + 1:]:
            links.setdefault(first, {}).setdefault(second, set()).add(reason)
            links.setdefault(second, {}).setdefault(first, set()).add(reason)


def shared_caption_templates(posts_by_account):
    """Template keys repeated across more than one account.

    The same template on two handles is the coordination signal we surface in
    the account detail by marking those caption cells. A template that only one
    account uses is just that account's voice, so it never counts.
    """
    by_template = {}
    for key, posts in posts_by_account.items():
        for post in posts:
            template = caption_template_key(post.get('caption'))
            if template:
                by_template.setdefault(template, set()).add(key)
    return {template for template, keys in by_template.items() if len(keys) >= 2}


def find_account_links(accounts, posts_by_account):
    """Cross-account evidence as {account_key: {peer_key: {reasons}}}."""
    links = {}

    by_ref = {}
    by_bucket = {}
    for key, posts in posts_by_account.items():
        platform = key.split(':', 1)[0]
        for post in posts:
            ref = post.get('post_ref')
            if ref:
                by_ref.setdefault((platform, str(ref)), []).append(key)
            minute = _minute_of(post.get('posted_at'))
            if minute is not None:
                bucket = (platform, minute // SIBLING_SYNC_WINDOW_MINUTES)
                by_bucket.setdefault(bucket, set()).add(key)

    for keys in by_ref.values():
        _pair_off(keys, 'konten', links)

    sync_hits = {}
    for keys in by_bucket.values():
        if len(keys) < 2:
            continue
        for key in keys:
            for other in keys:
                if other != key:
                    sync_hits.setdefault((key, other), 0)
                    sync_hits[(key, other)] += 1
    for (first, second), hits in sync_hits.items():
        if hits >= SIBLING_SYNC_MIN_HITS and first < second:
            _pair_off([first, second], 'serentak', links)

    by_token = {}
    for account in accounts:
        key = _account_key(account.get('platform'), account.get('username'))
        if not key:
            continue
        for token in bio_contact_tokens(account.get('bio')):
            by_token.setdefault(token, []).append(key)
    for keys in by_token.values():
        _pair_off(keys, 'kontak', links)

    by_template = {}
    for key, posts in posts_by_account.items():
        for post in posts:
            template = caption_template_key(post.get('caption'))
            if template:
                by_template.setdefault(template, set()).add(key)
    for keys in by_template.values():
        _pair_off(keys, 'template', links)

    return links


def build_clusters(links):
    """Group accounts that share hard evidence, so the dashboard can say
    "these five look like one operator" instead of five lonely badges."""
    parent = {}

    def find(node):
        parent.setdefault(node, node)
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    def union(left, right):
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[max(root_left, root_right)] = min(root_left, root_right)

    for account_key, peers in links.items():
        find(account_key)
        for peer, reasons in peers.items():
            union(account_key, peer)

    groups = {}
    for node in parent:
        groups.setdefault(find(node), set()).add(node)

    clusters = []
    for members in groups.values():
        if len(members) < 2:
            continue
        reasons = set()
        for account_key in members:
            for peer, kinds in links.get(account_key, {}).items():
                if peer in members:
                    reasons.update(kinds)
        clusters.append({
            'members': sorted(members),
            'size': len(members),
            'reasons': sorted(reasons),
            'strong': bool({'konten', 'kontak'} & reasons),
        })
    clusters.sort(key=lambda cluster: (not cluster['strong'], -cluster['size']))
    return clusters


def risk_level(score):
    for name, floor in RISK_LEVELS:
        if score >= floor:
            return name
    return 'bersih'


def analyse_account(account, posts, history_rows, links, appearance=None):
    """Score one account against every signal we can see in our own data."""
    key = _account_key(account.get('platform'), account.get('username'))
    platform = account.get('platform')
    followers = _number(account.get('follower_count'))
    following = _number(account.get('following_count'))
    posts = posts or []
    appearance = appearance or {}

    stamps = sorted(m for m in (_minute_of(post.get('posted_at')) for post in posts) if m is not None)
    videos = [post for post in posts if _number(post.get('views')) is not None]
    liked = [post for post in posts if _number(post.get('likes')) is not None]
    median_views = _median(post.get('views') for post in videos)
    median_likes = _median(post.get('likes') for post in liked)
    median_comments = _median(post.get('comments') for post in posts)

    view_reach = None
    if followers and median_views is not None:
        view_reach = median_views / followers * 100.0
    like_reach = None
    if followers and median_likes is not None:
        like_reach = median_likes / followers * 100.0

    posts_per_week = None
    if len(stamps) >= 2:
        span_minutes = stamps[-1] - stamps[0]
        if span_minutes > 0:
            posts_per_week = round(len(stamps) / (span_minutes / (60.0 * 24.0 * 7.0)), 2)

    burst = 0
    for index, start in enumerate(stamps):
        count = 1
        for other in range(index + 1, len(stamps)):
            if stamps[other] - start < UPLOAD_BURST_WINDOW_MINUTES:
                count += 1
            else:
                break
        burst = max(burst, count)

    months = [row for row in (history_rows or []) if _number(row.get('follower_count')) is not None]
    months.sort(key=lambda row: row.get('month') or '')
    month_values = [_number(row.get('follower_count')) for row in months]
    follower_delta_pct = None
    post_growth = None
    if len(month_values) >= 2 and month_values[0]:
        low, high = min(month_values), max(month_values)
        follower_delta_pct = round((high - low) / low * 100.0, 2)
        counts = [_number(row.get('post_count')) for row in months]
        if counts[0] is not None and counts[-1] is not None:
            post_growth = counts[-1] - counts[0]

    in_band = bool(followers and TERNAK_BAND_MIN <= followers <= TERNAK_BAND_MAX)
    flags = []

    def flag(kind, label, detail, points):
        flags.append({'key': kind, 'label': label, 'detail': detail, 'points': points})

    if platform == 'tiktok':
        reach, floor_value, unit, sample = view_reach, VIEW_REACH_FLOOR, 'views', len(videos)
    else:
        reach, floor_value, unit, sample = like_reach, IG_LIKE_REACH_FLOOR, 'likes', len(liked)
    if reach is not None and followers and followers >= TERNAK_BAND_MIN and sample >= MIN_POSTS_FOR_RATIO:
        if reach < floor_value:
            flag('reach_rendah', 'Jangkauan rendah',
                 'Rata-rata %s %s dari %s followers (%s)' % (
                     _display_int(median_views if unit == 'views' else median_likes),
                     unit, _display_int(followers), _display_pct(reach)), 2)

    if (len(liked) >= MIN_POSTS_FOR_COMMENT_RATIO and median_likes
            and median_likes >= LIKE_FLOOR_WITHOUT_COMMENTS):
        comments_value = median_comments or 0
        if comments_value <= max(1.0, median_likes * COMMENT_TO_LIKE_FLOOR):
            flag('komentar_minim', 'Komentar nyaris nol',
                 '%d unggahan rata-rata %s likes tetapi hanya %s komentar' % (
                     len(liked), _display_int(median_likes), _display_int(comments_value)), 2)

    if burst >= UPLOAD_BURST_MIN_COUNT:
        flag('unggah_bertumpuk', 'Unggahan bertumpuk',
             '%d unggahan dalam %d menit, pola antrean upload satu perangkat' % (
                 burst, UPLOAD_BURST_WINDOW_MINUTES), 2)

    reasons_by_peer = {}
    for peer, kinds in (links or {}).items():
        for kind in kinds:
            reasons_by_peer.setdefault(kind, set()).add(peer)

    def peer_list(kind):
        """Handles rather than internal keys: these strings are shown to the user."""
        return ', '.join('@' + peer.rsplit(':', 1)[-1] for peer in sorted(reasons_by_peer[kind]))

    if 'konten' in reasons_by_peer:
        flag('konten_kembar', 'Unggahan sama di akun lain',
             'Ref posting yang sama juga muncul di %s' % peer_list('konten'), 4)
    if 'kontak' in reasons_by_peer:
        flag('kontak_bio_sama', 'Kontak bio sama',
             'Nomor atau email di bio dipakai juga oleh %s' % peer_list('kontak'), 3)
    if 'template' in reasons_by_peer:
        flag('caption_template', 'Caption berpola',
             'Caption seragam (hanya angka/hashtag yang beda) dengan %s' % peer_list('template'), 2)
    if 'serentak' in reasons_by_peer:
        flag('unggah_serentak', 'Unggahan serentak',
             'Jam upload bergeser beberapa menit saja dengan %s' % peer_list('serentak'), 1)

    if len(month_values) >= 2 and follower_delta_pct is not None and in_band:
        band_flat = any(low <= followers <= high for low, high in FLAT_FOLLOWER_BANDS)
        steady = follower_delta_pct <= FLAT_FOLLOWER_TOLERANCE * 100.0
        kept_uploading = post_growth is None or post_growth >= FLAT_FOLLOWER_MIN_POST_GROWTH
        if band_flat and steady and kept_uploading and len(month_values) >= 2:
            flag('followers_datar', 'Followers tidak pernah bergerak',
                 'Selisih %s antara %d bulan (%s → %s) sementara upload jalan terus' % (
                     _display_pct(follower_delta_pct), len(month_values),
                     _display_int(month_values[0]), _display_int(month_values[-1])), 2)

    if following is not None and followers and followers < TERNAK_BAND_MAX and following >= followers:
        flag('akun_salur', 'Following lebih banyak dari followers',
             '%s following berbanding %s followers, ciri akun salur' % (
                 _display_int(following), _display_int(followers)), 1)

    score = sum(item['points'] for item in flags)
    if account.get('is_verified'):
        score = max(0, score - 1)
    level = risk_level(score)
    strong = bool({'konten', 'kontak'} & set(reasons_by_peer))
    if strong and level in ('bersih', 'amati'):
        level = 'pola_ternak'

    age = _age_minutes(account.get('fetched_at'))
    return {
        'key': key,
        'platform': platform,
        'username': account.get('username'),
        'display_name': account.get('display_name'),
        'bio': account.get('bio'),
        'region': account.get('region'),
        'external_id': account.get('external_id'),
        'is_verified': bool(account.get('is_verified')),
        'followers': int(followers) if followers is not None else None,
        'following': int(following) if following is not None else None,
        'post_count': int(_number(account.get('post_count'))) if _number(account.get('post_count')) is not None else None,
        'fetched_at': account.get('fetched_at'),
        'data_age_minutes': age,
        'needs_refresh': age is None or age > CACHE_TTL_MINUTES,
        'in_ternak_band': in_band,
        'audits_seen': int(appearance.get('audits_seen') or 0),
        'targets_seen': int(appearance.get('targets_seen') or 0),
        'last_verified_at': appearance.get('last_verified_at'),
        'months_seen': len(month_values),
        'follower_delta_pct': follower_delta_pct,
        'metrics': {
            'posts_seen': len(posts),
            'videos_seen': len(videos),
            'median_views': int(median_views) if median_views is not None else None,
            'median_likes': int(median_likes) if median_likes is not None else None,
            'median_comments': int(median_comments) if median_comments is not None else None,
            'view_reach_pct': round(view_reach, 2) if view_reach is not None else None,
            'like_reach_pct': round(like_reach, 2) if like_reach is not None else None,
            'posts_per_week': posts_per_week,
            'upload_burst': burst,
        },
        'flags': flags,
        'score': score,
        'level': level,
        'peers': sorted((links or {}).keys()),
        'peer_reasons': {peer: sorted(kinds) for peer, kinds in (links or {}).items()},
    }


def _intel_snapshot():
    """Score the whole account corpus.

    The monthly master list is a few hundred accounts, so this is computed per
    request instead of being materialised into a table; the scoring itself is
    pure Python and covered by tests without touching SQL.
    """
    conn = get_db_connection()
    try:
        accounts = [dict(row) for row in conn.execute(
            'SELECT * FROM accounts ORDER BY LOWER(username) ASC')]
        post_rows = [dict(row) for row in conn.execute(
            'SELECT platform, username, post_ref, posted_at, likes, comments, shares, '
            'views, caption FROM account_posts')]
        history_rows = [dict(row) for row in conn.execute(
            'SELECT platform, username, month, follower_count, post_count FROM account_history')]
        target_rows = [dict(row) for row in conn.execute(
            'SELECT platform, username, audit_id, last_scraped_at FROM targets')]
    finally:
        conn.close()

    posts_by_account = {}
    for post in post_rows:
        key = _account_key(post.get('platform'), post.get('username'))
        if key:
            posts_by_account.setdefault(key, []).append(post)

    history_by_account = {}
    for row in history_rows:
        key = _account_key(row.get('platform'), row.get('username'))
        if key:
            history_by_account.setdefault(key, []).append(row)

    appearance = {}
    for row in target_rows:
        key = _account_key(row.get('platform'), row.get('username'))
        if not key:
            continue
        entry = appearance.setdefault(key, {'audits': set(), 'targets': 0, 'last_verified_at': None})
        entry['audits'].add(row.get('audit_id'))
        entry['targets'] += 1
        stamp = row.get('last_scraped_at')
        if stamp and (entry['last_verified_at'] is None or stamp > entry['last_verified_at']):
            entry['last_verified_at'] = stamp

    links = find_account_links(accounts, posts_by_account)
    clusters = build_clusters(links)
    shared_templates = shared_caption_templates(posts_by_account)

    items = []
    for account in accounts:
        key = _account_key(account.get('platform'), account.get('username'))
        if not key:
            continue
        seen = appearance.get(key) or {}
        items.append(analyse_account(
            account,
            posts_by_account.get(key, []),
            history_by_account.get(key, []),
            links.get(key, {}),
            {
                'audits_seen': len(seen.get('audits') or ()),
                'targets_seen': seen.get('targets', 0),
                'last_verified_at': seen.get('last_verified_at'),
            },
        ))

    return {'items': items, 'links': links, 'clusters': clusters,
            'shared_templates': shared_templates}


def get_account_intel(platform=None, query=None, band=None, level=None,
                      sort='risk', direction='desc', limit=50, offset=0):
    """Account master list with risk scores, twin clusters and refresh state.

    This is the monthly view: an account harvested last month keeps its numbers,
    so the same list answers "what still needs a visit" without scraping again.
    """
    limit = clamp_limit(limit, 1, 200, 50)
    offset = max(0, int(offset or 0))

    snapshot = _intel_snapshot()
    items = snapshot['items']
    clusters = snapshot['clusters']

    def matches(item):
        if platform and item['platform'] != platform:
            return False
        if band == 'ternak' and not item['in_ternak_band']:
            return False
        if band == 'kecil' and not (item['followers'] is not None and item['followers'] < TERNAK_BAND_MIN):
            return False
        if band == 'besar' and not (item['followers'] is not None and item['followers'] > TERNAK_BAND_MAX):
            return False
        if level == 'curiga':
            if item['score'] < RISK_FLOORS['pola_ternak']:
                return False
        elif level and item['level'] != level:
            return False
        if query:
            needle = str(query).strip().lower()
            haystack = ' '.join(filter(None, [
                item['username'], item['display_name'], item['bio'], item['region'],
            ])).lower()
            if needle and needle not in haystack:
                return False
        return True

    filtered = [item for item in items if matches(item)]

    sort_keys = {
        'risk': lambda item: (item['score'], item['followers'] or 0),
        'followers': lambda item: item['followers'] or 0,
        'reach': lambda item: (item['metrics']['view_reach_pct']
                               if item['metrics']['view_reach_pct'] is not None
                               else item['metrics']['like_reach_pct'] or -1),
        'posts': lambda item: item['metrics']['posts_seen'] or 0,
        'audits': lambda item: item['audits_seen'] or 0,
        'age': lambda item: item['data_age_minutes']
                            if item['data_age_minutes'] is not None else 1 << 40,
        'username': lambda item: str(item['username'] or '').lower(),
    }
    key_func = sort_keys.get(sort, sort_keys['risk'])
    # Counts read biggest-first by default; a handle reads a to z by default.
    reverse = (direction == 'desc') if sort == 'username' else (direction != 'asc')
    filtered.sort(key=key_func, reverse=reverse)

    total = len(filtered)
    return {
        'items': filtered[offset:offset + limit],
        'total': total,
        'limit': limit,
        'offset': offset,
        'clusters': [cluster for cluster in clusters
                     if any(member in {item['key'] for item in filtered} for member in cluster['members'])],
        'summary': {
            'accounts': len(items),
            'shown': total,
            'flagged': sum(1 for item in items if item['score'] >= RISK_FLOORS['amati']),
            'in_band': sum(1 for item in items if item['in_ternak_band']),
            'needs_refresh': sum(1 for item in items if item['needs_refresh']),
            'clusters': len(clusters),
            'visit_budget': VISIT_BUDGET_PER_CYCLE,
        },
    }


def get_account_detail(username, platform=None):
    """One account as the dashboard needs it: identity, monthly series, the
    posts we hold, and the sibling accounts its evidence points at."""
    username = clean_username(username)
    if not username:
        return None

    snapshot = _intel_snapshot()
    by_key = {item['key']: item for item in snapshot['items']}
    wanted = f'{platform}:{username}' if platform else None
    match = by_key.get(wanted) if wanted else None
    if match is None and not wanted:
        candidates = [item for item in snapshot['items'] if item['username'] == username]
        match = max(candidates, key=lambda item: item['score'], default=None)
    if match is None:
        return None

    conn = get_db_connection()
    try:
        posts = [dict(row) for row in conn.execute(
            'SELECT post_ref, post_url, posted_at, likes, comments, shares, views, caption, '
            'is_video, fetched_at FROM account_posts WHERE platform = ? AND username = ? '
            'ORDER BY posted_at DESC', (match['platform'], username))]
        history = [dict(row) for row in conn.execute(
            'SELECT month, follower_count, following_count, post_count, first_seen_at, '
            'last_seen_at, visits FROM account_history WHERE platform = ? AND username = ? '
            'ORDER BY month ASC', (match['platform'], username))]
    finally:
        conn.close()

    shared_templates = snapshot.get('shared_templates') or set()
    for post in posts:
        post['caption_templated'] = bool(
            post.get('caption') and caption_template_key(post.get('caption')) in shared_templates)

    siblings = []
    for peer in match['peers']:
        other = by_key.get(peer) or {}
        siblings.append({
            'key': peer,
            'platform': other.get('platform'),
            'username': other.get('username'),
            'followers': other.get('followers'),
            'score': other.get('score'),
            'level': other.get('level'),
            'reasons': (other.get('peer_reasons') or {}).get(match['key'], []),
        })
    siblings.sort(key=lambda sibling: -(sibling.get('score') or 0))

    detail = dict(match)
    detail['siblings'] = siblings
    detail['posts'] = posts
    detail['history'] = history
    detail['clusters'] = [cluster for cluster in snapshot['clusters']
                          if match['key'] in cluster['members']]
    return detail


def get_latest_tasks(limit=10, audit_id=None):
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        conditions = ['s.attempt_rn = 1']
        params = []
        if audit_id:
            conditions.append('t.audit_id = ?')
            params.append(int(audit_id))
        params.append(int(limit))
        where = 'WHERE ' + ' AND '.join(conditions)
        cursor.execute(f'''
            WITH attempts AS (
                SELECT s.*,
                       ROW_NUMBER() OVER (
                           PARTITION BY s.target_id, s.run_id ORDER BY s.id DESC
                       ) AS attempt_rn
                FROM snapshots s
            ),
            ordered AS (
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
                FROM attempts s
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
    """One row per run (the final attempt), newest first — the panel compares runs."""
    columns = ', '.join(SNAPSHOT_COLUMNS)
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(f'''
            WITH attempts AS (
                SELECT s.*,
                       ROW_NUMBER() OVER (
                           PARTITION BY s.target_id, s.run_id ORDER BY s.id DESC
                       ) AS attempt_rn
                FROM snapshots s
                WHERE s.target_id = ?
            )
            SELECT {columns} FROM attempts WHERE attempt_rn = 1 ORDER BY id DESC LIMIT ?
        ''', (int(target_id), int(limit)))
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
                sort='recent', direction='desc', limit=50, offset=0, issue=None):
    """Target-level rows with latest task status and latest snapshot metrics."""
    limit = clamp_limit(limit, 1, 200, 50)
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
                   s.follower_count, s.scraped_at, s.post_date, s.caption,
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
    if issue == 'no_followers':
        conditions.append('ls.id IS NOT NULL AND ls.follower_count IS NULL')
    elif issue == 'no_views':
        conditions.append('ls.id IS NOT NULL AND ls.views IS NULL')
    elif issue == 'partial':
        conditions.append("COALESCE(lt.status, 'PENDING') = 'PARTIAL'")
    elif issue == 'failed':
        conditions.append("COALESCE(lt.status, 'PENDING') = 'FAILED'")
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
            LEFT JOIN latest_snapshots ls ON ls.target_id = t.id AND ls.rn = 1
            ''' + where, params)
        total = cursor.fetchone()['count']

        cursor.execute(base + '''
            SELECT t.id AS target_id, t.audit_id, a.name AS audit_name,
                   t.platform, t.url, t.username, t.tema, t.created_at,
                   lt.id AS task_id, COALESCE(lt.status, 'PENDING') AS status,
                   lt.error_code, lt.error_message, COALESCE(lt.retry_count, 0) AS retry_count,
                   lt.claimed_at, lt.scraped_at AS task_scraped_at,
                   ls.id AS snapshot_id,                   ls.likes, ls.comments, ls.views, ls.shares,
                   ls.follower_count, ls.scraped_at AS snapshot_at,
                   ls.post_date, ls.caption,
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
        where = ('WHERE s.attempt_rn = 1 AND ' + ' AND '.join(conditions)) if conditions else 'WHERE s.attempt_rn = 1'
        cursor.execute(f'''
            WITH attempts AS (
                SELECT s.*,
                       ROW_NUMBER() OVER (
                           PARTITION BY s.target_id, s.run_id ORDER BY s.id DESC
                       ) AS attempt_rn
                FROM snapshots s
            ),
            ordered AS (
                SELECT s.id, s.target_id, s.run_id, s.task_id, s.scraped_at,
                       s.status, s.error_code, s.error_message, s.likes,
                       s.comments, s.views, s.shares, s.follower_count,
                       s.post_date, s.caption,
                       t.platform, t.username, t.tema, t.url, t.audit_id,
                       a.name AS audit_name, a.period AS period,
                       COALESCE(tk.retry_count, 0) AS retry_count,
                       LAG(s.likes) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_likes,
                       LAG(s.comments) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_comments,
                       LAG(s.views) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_views,
                       LAG(s.shares) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_shares,
                       LAG(s.follower_count) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_follower_count,
                       LAG(s.scraped_at) OVER (PARTITION BY s.target_id ORDER BY s.id) AS prev_scraped_at
                FROM attempts s
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


# ---- Recap screen -------------------------------------------------------
# A median over two rows is a hint, not a finding: the payload always carries the
# number of rows it stands on, so a reader can weigh it instead of trusting it.
SUMMARY_TOP_LIMIT = 5
SUMMARY_MIN_ER_ROWS = 2


def _recap_median(values):
    """Median rounded to the two decimals the recap tables print.

    Kept under its own name: database._median() is the scoring helper and must
    keep its unrounded, tolerant semantics.
    """
    numbers = sorted(value for value in values if value is not None)
    if not numbers:
        return None
    middle = len(numbers) // 2
    if len(numbers) % 2:
        return round(numbers[middle], 2)
    return round((numbers[middle - 1] + numbers[middle]) / 2, 2)


def _handle_from_url(platform, url):
    """The handle a post URL already carries: TikTok always, Instagram sometimes."""
    if not url:
        return None
    from urllib.parse import urlsplit

    try:
        segments = [part for part in urlsplit(str(url)).path.split('/') if part]
    except ValueError:
        return None
    if platform == 'tiktok':
        for part in segments:
            if part.startswith('@'):
                return clean_username(part[1:])
        return None
    if platform == 'instagram' and len(segments) >= 3:
        if segments[1].lower() in ('p', 'reel', 'reels', 'tv'):
            return clean_username(segments[0])
    return None


def _summary_er(platform, likes, comments, views, shares, followers):
    """Same formula the worker reports, kept here so the recap and the table agree."""
    likes = likes or 0
    comments = comments or 0
    views = views or 0
    shares = shares or 0
    followers = followers or 0
    if platform == 'tiktok':
        if views <= 0:
            return None
        return round(((likes + comments + shares) / views) * 100, 2)
    if followers <= 0:
        return None
    return round(((likes + comments) / followers) * 100, 2)


def get_summary(audit_id=None):
    """One payload for the recap screen.

    Everything is derived from the latest snapshot per target, which is the same
    row the tables show, so a total can always be traced back to a visible post.
    Rows are aggregated here instead of in the browser because the activity feed
    only ever holds the newest page of snapshots.
    """
    audit_id = int(audit_id) if audit_id else None
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        where = 'WHERE t.audit_id = ?' if audit_id else ''
        params = [audit_id] if audit_id else []
        cursor.execute(f'''
            WITH latest_snapshots AS (
                SELECT s.*,
                       ROW_NUMBER() OVER (PARTITION BY s.target_id ORDER BY s.id DESC) AS rn
                FROM snapshots s
            ),
            latest_tasks AS (
                SELECT tk.*,
                       ROW_NUMBER() OVER (PARTITION BY tk.target_id ORDER BY tk.id DESC) AS rn
                FROM tasks tk
                WHERE tk.target_id IS NOT NULL
            )
            SELECT t.id AS target_id, t.audit_id, a.name AS audit_name, t.platform,
                   t.username, t.tema, t.url,
                   COALESCE(lt.status, 'PENDING') AS status, lt.error_code,
                   ls.likes, ls.comments, ls.views, ls.shares, ls.follower_count,
                   ls.scraped_at
            FROM targets t
            JOIN audits a ON a.id = t.audit_id
            LEFT JOIN latest_tasks lt ON lt.target_id = t.id AND lt.rn = 1
            LEFT JOIN latest_snapshots ls ON ls.target_id = t.id AND ls.rn = 1
            {where}
        ''', params)
        rows = [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

    status_counts = {'PENDING': 0, 'RUNNING': 0, 'OK': 0, 'PARTIAL': 0, 'FAILED': 0}
    account_keys = set()
    platform_rows = {}
    account_rows = {}
    tema_rows = {}
    audit_rows = {}
    posts = []
    scraped_times = []
    totals = {'views': 0, 'likes': 0, 'comments': 0, 'shares': 0}
    quality = {
        'without_followers': 0,
        'partial': 0,
        'missing_views': 0,
        'missing_username': 0,
        'never_scraped': 0,
    }
    # Completeness is tracked per account, not per link: one account that sends
    # three links must not make a follower gap look three times worse.
    account_quality = {}

    for row in rows:
        status = str(row.get('status') or 'PENDING').upper()
        status_counts[status] = status_counts.get(status, 0) + 1
        platform = row.get('platform') or 'unknown'

        stats = platform_rows.setdefault(platform, {
            'platform': platform, 'targets': 0, 'scraped': 0, 'ok': 0,
            'partial': 0, 'failed': 0, 'views': 0, 'likes': 0,
            'comments': 0, 'shares': 0, 'followers_known': 0, 'er': [],
        })
        stats['targets'] += 1
        if status == 'OK':
            stats['ok'] += 1
        elif status == 'PARTIAL':
            stats['partial'] += 1
        elif status == 'FAILED':
            stats['failed'] += 1

        audit = audit_rows.setdefault(row['audit_id'], {
            'audit_id': row['audit_id'], 'name': row.get('audit_name') or 'Audit',
            'targets': 0, 'ok': 0, 'partial': 0, 'failed': 0, 'pending': 0,
            'views': 0, 'er': [],
        })
        audit['targets'] += 1
        if status == 'OK':
            audit['ok'] += 1
        elif status == 'PARTIAL':
            audit['partial'] += 1
        elif status == 'FAILED':
            audit['failed'] += 1
        elif status in ('PENDING', 'RUNNING'):
            audit['pending'] += 1

        tema = (row.get('tema') or '').strip()
        tema_stats = tema_rows.setdefault(tema or '(tanpa tema)', {
            'tema': tema or '(tanpa tema)', 'targets': 0, 'views': 0, 'er': [],
        })
        tema_stats['targets'] += 1

        username = (row.get('username') or '').strip()
        if not username:
            username = _handle_from_url(platform, row.get('url')) or ''
        if username:
            account_keys.add((platform, username.lower()))
        handle = username or (row.get('url') or '—')
        account_key = (platform, (username or handle).lower())
        qflags = account_quality.setdefault(account_key, {
            'username': bool(username), 'scraped': False, 'followers': False,
            'views_missing': False, 'partial': False,
        })
        if username:
            qflags['username'] = True
        account = account_rows.setdefault(account_key, {
            'platform': platform, 'username': username, 'handle': handle,
            'posts': 0, 'views': 0, 'likes': 0, 'comments': 0,
            'followers': None, 'er': [], 'last_scraped_at': None,
        })
        account['posts'] += 1

        if row.get('scraped_at') is None:
            continue

        qflags['scraped'] = True
        stats['scraped'] += 1
        scraped_times.append(row['scraped_at'])
        account['last_scraped_at'] = max(
            filter(None, [account['last_scraped_at'], row['scraped_at']]),
            default=None,
        )
        if row.get('follower_count') is not None:
            stats['followers_known'] += 1
            qflags['followers'] = True
            account['followers'] = max(account['followers'] or 0, row['follower_count'])
        if status == 'PARTIAL':
            qflags['partial'] = True
        if row.get('views') is None:
            qflags['views_missing'] = True

        views = row.get('views') or 0
        likes = row.get('likes') or 0
        comments = row.get('comments') or 0
        shares = row.get('shares') or 0
        er = _summary_er(platform, likes, comments, views, shares,
                         row.get('follower_count'))

        for key, value in (('views', views), ('likes', likes),
                           ('comments', comments), ('shares', shares)):
            stats[key] += value
            totals[key] += value
        audit['views'] += views
        tema_stats['views'] += views
        account['views'] += views
        account['likes'] += likes
        account['comments'] += comments

        if er is not None:
            stats['er'].append(er)
            audit['er'].append(er)
            tema_stats['er'].append(er)
            account['er'].append(er)

        posts.append({
            'platform': platform,
            'handle': handle,
            'username': username,
            'url': row.get('url'),
            'views': row.get('views'),
            'likes': row.get('likes'),
            'comments': row.get('comments'),
            'shares': row.get('shares'),
            'followers': row.get('follower_count'),
            'er': er,
            'scraped_at': row.get('scraped_at'),
        })

    for (account_platform, _), flags in account_quality.items():
        if not flags['username']:
            quality['missing_username'] += 1
        if not flags['scraped']:
            quality['never_scraped'] += 1
            continue
        if not flags['followers']:
            quality['without_followers'] += 1
        if flags['partial']:
            quality['partial'] += 1
        # Instagram never shows view counts, so a missing view there is a platform
        # property rather than a gap in this audit.
        if account_platform == 'tiktok' and flags['views_missing']:
            quality['missing_views'] += 1

    platforms = []
    for stats in platform_rows.values():
        values = stats.pop('er')
        stats['er_rows'] = len(values)
        stats['median_er'] = _recap_median(values)
        platforms.append(stats)
    platforms.sort(key=lambda item: (-item['targets'], item['platform']))

    accounts = []
    for account in account_rows.values():
        values = account.pop('er')
        account['er_rows'] = len(values)
        account['median_er'] = _recap_median(values)
        accounts.append(account)
    accounts.sort(key=lambda item: (-item['views'], item['handle'].lower()))

    temas = []
    for tema in tema_rows.values():
        values = tema.pop('er')
        tema['er_rows'] = len(values)
        tema['median_er'] = _recap_median(values)
        temas.append(tema)
    temas.sort(key=lambda item: (-item['views'], item['tema'].lower()))

    audit_list = []
    for audit in audit_rows.values():
        values = audit.pop('er')
        audit['er_rows'] = len(values)
        audit['median_er'] = _recap_median(values)
        audit_list.append(audit)
    audit_list.sort(key=lambda item: (-item['targets'], item['audit_id']))

    ranked_views = sorted(
        (post for post in posts if post['views'] is not None),
        key=lambda post: -post['views'],
    )[:SUMMARY_TOP_LIMIT]
    ranked_er = sorted(
        (post for post in posts if post['er'] is not None),
        key=lambda post: -post['er'],
    )[:SUMMARY_TOP_LIMIT]

    scraped = sum(item['scraped'] for item in platforms)
    verified = status_counts['OK'] + status_counts['PARTIAL']

    return {
        'audit_id': audit_id,
        'generated_at': _iso_now(),
        'kpi': {
            'targets': len(rows),
            'scraped': scraped,
            'verified': verified,
            'ok': status_counts['OK'],
            'partial': status_counts['PARTIAL'],
            'failed': status_counts['FAILED'],
            'pending': status_counts['PENDING'],
            'running': status_counts['RUNNING'],
            'success_rate': round(verified / scraped * 100, 1) if scraped else None,
            'accounts': len(account_keys),
            'audits': len(audit_rows),
            'first_scraped_at': min(scraped_times) if scraped_times else None,
            'last_scraped_at': max(scraped_times) if scraped_times else None,
            'totals': totals,
        },
        'status': status_counts,
        'platforms': platforms,
        'accounts': accounts[:20],
        'accounts_total': len(accounts),
        'temas': temas[:12],
        'temas_total': len(temas),
        'audits': audit_list,
        'posts': {'top_views': ranked_views, 'top_er': ranked_er},
        'quality': quality,
        'quality_basis': 'account',
        'limits': {
            'top': SUMMARY_TOP_LIMIT,
            'min_er_rows': SUMMARY_MIN_ER_ROWS,
        },
    }


def get_compare(months=6, period=None):
    """Accounts by month — the monthly campaign view.

    One row per account, one value per period, built from the latest snapshot of
    each target in that period. A month with no link stays empty instead of
    repeating last month's numbers, which is what makes a missing submission
    visible.
    """
    try:
        months = max(2, min(int(months or 6), 24))
    except (TypeError, ValueError):
        months = 6

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT DISTINCT period FROM audits WHERE period IS NOT NULL AND period <> '' "
            "ORDER BY period DESC"
        )
        periods = [row['period'] for row in cursor.fetchall()][:months]
        selected = clean_period(period)
        if selected and selected not in periods:
            periods = ([selected] + periods)[:months]
        if not periods:
            return {'periods': [], 'latest_period': None, 'accounts': [],
                    'summary': {'accounts': 0, 'new_accounts': 0, 'missing_latest': 0}}

        placeholders = ', '.join('?' for _ in periods)
        cursor.execute(f'''
            WITH latest AS (
                SELECT s.*, ROW_NUMBER() OVER (PARTITION BY s.target_id ORDER BY s.id DESC) AS rn
                FROM snapshots s
            )
            SELECT a.period AS period, t.platform, t.username, t.url,
                   ls.likes, ls.comments, ls.views, ls.shares, ls.follower_count
            FROM targets t
            JOIN audits a ON a.id = t.audit_id
            LEFT JOIN latest ls ON ls.target_id = t.id AND ls.rn = 1
            WHERE a.period IN ({placeholders})
        ''', periods)
        rows = [dict(row) for row in cursor.fetchall()]

        cursor.execute(f'''
            SELECT platform, username, month, follower_count, post_count
            FROM account_history
            WHERE month IN ({placeholders})
        ''', periods)
        history = {(row['platform'], row['username'], row['month']): dict(row)
                   for row in cursor.fetchall()}
    finally:
        conn.close()

    accounts = {}
    for row in rows:
        username = (row.get('username') or '').strip()
        if not username:
            username = _handle_from_url(row.get('platform'), row.get('url')) or ''
        key = (row.get('platform'), username or (row.get('url') or '—'))
        entry = accounts.setdefault(key, {
            'platform': row.get('platform'), 'username': username, 'months': {},
        })
        bucket = entry['months'].setdefault(row['period'], {
            'posts': 0, 'views': 0, 'likes': 0, 'comments': 0, 'shares': 0,
            'er': [], 'followers': None,
        })
        bucket['posts'] += 1
        for field in ('views', 'likes', 'comments', 'shares'):
            bucket[field] += row.get(field) or 0
        if row.get('follower_count') is not None:
            bucket['followers'] = max(bucket['followers'] or 0, row['follower_count'])
        er = _summary_er(row.get('platform'), row.get('likes'), row.get('comments'),
                         row.get('views'), row.get('shares'), row.get('follower_count'))
        if er is not None:
            bucket['er'].append(er)

    for (platform, username, month), row in history.items():
        key = (platform, username)
        entry = accounts.get(key)
        if not entry:
            continue
        bucket = entry['months'].get(month)
        if bucket is None:
            continue
        if bucket['followers'] is None and row.get('follower_count') is not None:
            bucket['followers'] = row['follower_count']

    latest_period = periods[0]
    items = []
    for (platform, handle_key), entry in accounts.items():
        row = {
            'platform': platform,
            'username': entry['username'],
            'handle': entry['username'] or handle_key,
            'months': {},
            'first_period': None,
            'last_period': None,
            'posts_total': 0,
            'views_total': 0,
        }
        for period_key in periods:
            bucket = entry['months'].get(period_key)
            if bucket is None:
                row['months'][period_key] = None
                continue
            values = bucket.pop('er')
            bucket['er_rows'] = len(values)
            bucket['median_er'] = _recap_median(values)
            row['months'][period_key] = bucket
            row['posts_total'] += bucket['posts']
            row['views_total'] += bucket['views']
            if row['first_period'] is None:
                row['first_period'] = period_key
            row['last_period'] = period_key
        # "New" only means something once there is an earlier month to compare
        # against; with a single period every account would look new.
        row['is_new'] = len(periods) > 1 and row['first_period'] == latest_period
        row['missing_latest'] = row['months'].get(latest_period) is None
        items.append(row)

    items.sort(key=lambda item: (item['missing_latest'], -item['views_total'], item['handle'].lower()))
    return {
        'periods': periods,
        'latest_period': latest_period,
        'accounts': items,
        'summary': {
            'accounts': len(items),
            'new_accounts': sum(1 for item in items if item['is_new']),
            'missing_latest': sum(1 for item in items if item['missing_latest']),
        },
    }


def search_data(query, limit=20):
    """Manual lookup over what is already stored: targets, accounts, posts."""
    needle = str(query or '').strip()
    if len(needle) < 2:
        return {'query': needle, 'targets': [], 'accounts': [], 'posts': []}

    limit = clamp_limit(limit, 1, 50, 20)
    like = '%' + needle + '%'
    handle = '%' + needle.lstrip('@') + '%'

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT t.id AS target_id, t.audit_id, a.name AS audit_name, a.period,
                   t.platform, t.username, t.url, t.tema,
                   t.last_status AS status, t.last_scraped_at
            FROM targets t
            JOIN audits a ON a.id = t.audit_id
            WHERE t.username LIKE ? OR t.url LIKE ? OR COALESCE(t.tema, '') LIKE ?
            ORDER BY t.id DESC LIMIT ?
        ''', (handle, like, like, limit))
        targets = [dict(row) for row in cursor.fetchall()]

        cursor.execute('''
            SELECT platform, username, follower_count, display_name, bio, region,
                   post_count, following_count, fetched_at
            FROM accounts
            WHERE username LIKE ? OR COALESCE(display_name, '') LIKE ?
               OR COALESCE(bio, '') LIKE ?
            ORDER BY fetched_at DESC LIMIT ?
        ''', (handle, like, like, limit))
        accounts = [dict(row) for row in cursor.fetchall()]

        cursor.execute('''
            SELECT platform, username, post_url, posted_at, likes, comments,
                   views, shares, caption
            FROM account_posts
            WHERE post_url LIKE ? OR COALESCE(caption, '') LIKE ? OR username LIKE ?
            ORDER BY posted_at DESC LIMIT ?
        ''', (like, like, handle, limit))
        posts = [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()

    return {'query': needle, 'targets': targets, 'accounts': accounts, 'posts': posts}


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
        # A task written by an older schema can carry a NULL status; it belongs
        # to the queue, not to a `None` key the dashboard cannot read.
        status = row['status'] or 'PENDING'
        stats[status] = stats.get(status, 0) + row['count']
        stats['TOTAL'] += row['count']
    return stats


def update_audit(audit_id, name=None, repeat_days=None, period=None):
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
            clamped = parse_repeat_days(repeat_days)
            cursor.execute("UPDATE audits SET repeat_days = ? WHERE id = ?",
                           (0 if clamped is None else clamped, audit_id))
        if period is not None:
            cleaned = clean_period(period)
            if cleaned:
                cursor.execute("UPDATE audits SET period = ? WHERE id = ?", (cleaned, audit_id))
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
        cursor.execute("DELETE FROM account_posts")
        cursor.execute("DELETE FROM account_history")
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
