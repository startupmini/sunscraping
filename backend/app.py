# pyrefly: ignore [missing-import]
from flask import (
    Flask, Response, jsonify, render_template, request, send_file, session,
    stream_with_context,
)
from flask_cors import CORS
import pandas as pd
import io
import sqlite3
import os
import re
import sys
import csv
import json
import math
import time
import signal
import atexit
import logging
import secrets
import uuid
import zipfile
from datetime import datetime, timezone
from functools import wraps
from urllib.parse import urlparse
from werkzeug.utils import secure_filename
import database

# PID file for clean server management
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PID_FILE = os.path.join(BASE_DIR, 'server.pid')
KEY_FILE = os.path.join(BASE_DIR, '.api_key')
SECRET_FILE = os.path.join(BASE_DIR, '.session_secret')

app = Flask(__name__)

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)


class _NoiseFilter(logging.Filter):
    """Keep request logs useful: drop dashboard/HTA polling noise."""

    NOISE = ('/api/health', '/api/stats', '/api/latest', '/api/events', '/api/audits', '/api/targets')

    def filter(self, record):
        try:
            message = record.getMessage()
        except Exception:
            return True
        return not any(path in message for path in self.NOISE)


logging.getLogger('werkzeug').addFilter(_NoiseFilter())


def _load_or_create_file(path, factory):
    try:
        if os.path.exists(path):
            with open(path, 'r', encoding='utf-8') as handle:
                value = handle.read().strip()
            if value:
                return value
        value = factory()
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write(value)
        return value
    except OSError as exc:
        logger.warning(f'Could not persist {os.path.basename(path)}: {exc}')
        return factory()


# ==========================================
# SECURITY: per-install API key + dashboard session
# ==========================================
API_KEY = _load_or_create_file(
    KEY_FILE,
    lambda: os.environ.get('SA_API_KEY', '').strip() or secrets.token_hex(24),
)
if os.environ.get('SA_API_KEY', '').strip() and os.environ['SA_API_KEY'].strip() != API_KEY:
    # Env key wins and is persisted so the Control Panel can show it.
    API_KEY = os.environ['SA_API_KEY'].strip()
    try:
        with open(KEY_FILE, 'w', encoding='utf-8') as handle:
            handle.write(API_KEY)
    except OSError:
        pass

PORT = int(os.environ.get('SA_PORT', '5000'))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # single ceiling for both the 413 handler and the size check
# A spreadsheet is a zip: MAX_CONTENT_LENGTH bounds the archive, not the XML it
# unpacks into memory, so the unpacked size gets its own ceiling.
MAX_UNCOMPRESSED_XLSX_BYTES = 200 * 1024 * 1024
ASSET_VERSION = '40'  # bump whenever dashboard.css/dashboard.js changes, so browsers drop the cache

app.config.update(
    SECRET_KEY=_load_or_create_file(SECRET_FILE, lambda: secrets.token_hex(32)),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Strict',
    SESSION_COOKIE_NAME='sa_dashboard',
    MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,
)

DEBUG_MODE = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'

# Restrict CORS to the local dashboard and this extension origin pattern.
CORS(
    app,
    resources={r"/api/*": {"origins": [
        f"http://localhost:{PORT}",
        f"http://127.0.0.1:{PORT}",
        r"^chrome-extension://[a-p]{32}$",
    ]}},
    allow_headers=["Content-Type", "X-API-Key"],
    methods=["GET", "POST"],
)

MAX_ROWS = 10000

RUNTIME_FOLDER = os.path.join(BASE_DIR, 'runtime')
UPLOAD_FOLDER = os.path.join(RUNTIME_FOLDER, 'uploads')
EXPORT_FOLDER = os.path.join(UPLOAD_FOLDER, 'exports')
BACKUP_FOLDER = os.path.join(RUNTIME_FOLDER, 'backups')
os.makedirs(EXPORT_FOLDER, exist_ok=True)
os.makedirs(BACKUP_FOLDER, exist_ok=True)

# A restore replaces every table, so the file must look like a sunscraping DB.
BACKUP_EXTENSIONS = ('.db', '.sqlite', '.sqlite3', '.backup')
BACKUP_KEEP = 10

INSTAGRAM_HOSTS = {'instagram.com', 'www.instagram.com', 'm.instagram.com'}
TIKTOK_HOSTS = {
    'tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
}
# Short links carry an opaque code until the browser follows the redirect, so
# their path cannot be checked for a post segment.
TIKTOK_SHORT_HOSTS = {'vm.tiktok.com', 'vt.tiktok.com'}
INSTAGRAM_POST_SEGMENTS = ('p', 'reel', 'reels', 'tv')

URL_HEADER_HINTS = ('link', 'url', 'tautan', 'postingan')
USER_HEADER_HINTS = ('username', 'user name', 'akun', 'account', 'user')
USER_HEADER_EXCLUDE = ('agent', 'email', 'bio')
TEMA_HEADER_HINTS = ('tema', 'title', 'judul', 'kategori', 'campaign')


def _request_hostname():
    try:
        return (urlparse('//' + request.host).hostname or '').lower()
    except ValueError:
        return ''


@app.before_request
def guard_host_header():
    """Block DNS-rebinding: only loopback hostnames may talk to this server."""
    if _request_hostname() not in ('localhost', '127.0.0.1', '::1'):
        return jsonify({"error": "Invalid Host header"}), 403
    return None


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Referrer-Policy'] = 'no-referrer'
    # The dashboard is plain ES5 with no build step: its only script source is
    # /static/dashboard.js. blob: stays allowed because the CSV template and the
    # Excel download both hand the browser a blob URL.
    response.headers['Content-Security-Policy'] = (
        "default-src 'self' blob:; script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
        "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
        "form-action 'self'"
    )
    return response


def _has_valid_api_key():
    key = request.headers.get('X-API-Key', '')
    if not key:
        return False
    # compare_digest rejects non-ASCII str; a key with accents is not a match
    # anyway, but it must answer 401 instead of raising TypeError -> 500.
    try:
        return secrets.compare_digest(key.encode('utf-8'), API_KEY.encode('utf-8'))
    except (UnicodeError, AttributeError):
        return False


# In-memory heartbeat: updated whenever the extension talks to the task API.
WORKER_LAST_SEEN = {'ts': None}


def _touch_worker():
    WORKER_LAST_SEEN['ts'] = datetime.now(timezone.utc).isoformat(
        timespec='seconds'
    ).replace('+00:00', 'Z')


# Reclaiming stale RUNNING tasks is a write transaction, and the popup polls
# /api/stats every few seconds while the worker claims tasks with its own write
# transaction. A stale claim only matters after database.TASK_LOCK_MINUTES, so
# running the sweep at most every 30 seconds keeps both sides off the writer.
RECLAIM_MIN_INTERVAL_SECONDS = 30
_RECLAIM_STATE = {'last': 0.0}


def _stats_payload(audit_id=None, reclaim=True):
    if reclaim and time.time() - _RECLAIM_STATE['last'] < RECLAIM_MIN_INTERVAL_SECONDS:
        reclaim = False
    if reclaim:
        _RECLAIM_STATE['last'] = time.time()
    stats = database.get_dashboard_stats(audit_id=audit_id, reclaim=reclaim)
    stats['WORKER_LAST_SEEN'] = WORKER_LAST_SEEN['ts']
    return stats


def require_api_key(f):
    """Require the extension API key or an authenticated dashboard session."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not (_has_valid_api_key() or session.get('dashboard')):
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated


def _looks_like_post(platform, parsed):
    """Only a post page has metrics; a profile link never does.

    Profile URLs used to pass host validation and then produce an empty row the
    dashboard counted as finished, so the path decides now: /p/, /reel/, /tv/ on
    Instagram and /video/, /photo/ (or a short link) on TikTok.
    """
    segments = [segment for segment in (parsed.path or '').split('/') if segment]
    if not segments:
        return False

    if platform == 'instagram':
        return len(segments) >= 2 and segments[0].lower() in INSTAGRAM_POST_SEGMENTS

    host = (parsed.hostname or '').lower()
    if host in TIKTOK_SHORT_HOSTS:
        return True

    head = segments[0].lower()
    if head in ('t', 'v') and len(segments) >= 2:
        return True
    return (
        len(segments) >= 3
        and head.startswith('@')
        and segments[1].lower() in ('video', 'photo')
    )


def _xlsx_expands_too_far(path):
    """True when the archived sheet unpacks past the ceiling (zip bomb)."""
    try:
        with zipfile.ZipFile(path) as archive:
            unpacked = sum(entry.file_size for entry in archive.infolist())
    except (zipfile.BadZipFile, OSError, ValueError):
        # Let pandas report an unreadable file with its own message.
        return False
    return unpacked > MAX_UNCOMPRESSED_XLSX_BYTES


def normalize_target_url(raw):
    """Return (platform, canonical_url) for a post on an allowed host."""
    if raw is None:
        return None
    value = str(raw).strip()
    if not value or value.lower() in ('nan', 'none'):
        return None
    if not re.match(r'^https?://', value, re.IGNORECASE):
        if re.match(r'^[a-z0-9.-]+\.[a-z]{2,}(/|$)', value, re.IGNORECASE):
            value = 'https://' + value
        else:
            return None

    try:
        parsed = urlparse(value)
    except ValueError:
        return None
    if parsed.scheme not in ('http', 'https'):
        return None
    if parsed.username or parsed.password:
        return None

    host = (parsed.hostname or '').lower()
    if host in INSTAGRAM_HOSTS:
        platform = 'instagram'
    elif host in TIKTOK_HOSTS:
        platform = 'tiktok'
    else:
        return None
    if not _looks_like_post(platform, parsed):
        return None

    canonical = parsed._replace(scheme='https', fragment='').geturl()
    if len(canonical) > 2048:
        return None
    return platform, canonical


def _parse_int_arg(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _pick_column(columns, hints, exclude=()):
    scored = []
    for column in columns:
        name = str(column).strip().lower()
        if any(token in name for token in exclude):
            continue
        for rank, hint in enumerate(hints):
            if hint in name:
                scored.append((rank, 0 if name == hint else 1, column))
                break
    if not scored:
        return None
    scored.sort(key=lambda item: (item[0], item[1]))
    return scored[0][2]


def _cell_text(value):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    text = str(value).strip()
    if not text or text.lower() in ('nan', 'none'):
        return None
    return text


def _sniff_csv_separator(path, encoding):
    """Detect a delimiter from common candidates only.

    pandas' sep=None sniffing picks arbitrary characters (it split a
    single-column 'Link' header on the letter 'n'), so constrain it.
    """
    try:
        with open(path, 'r', encoding=encoding, newline='') as handle:
            sample = handle.read(4096)
    except (UnicodeDecodeError, OSError):
        return None
    try:
        return csv.Sniffer().sniff(sample, delimiters=',;\t|').delimiter
    except csv.Error:
        return ','


def _read_dataframe(path, extension):
    if extension == '.csv':
        last_error = None
        # Excel on Windows commonly exports cp1252 or UTF-8 with BOM, and
        # semicolon-delimited CSV is the default in many Indonesian locales.
        for encoding in ('utf-8-sig', 'utf-8', 'latin-1'):
            try:
                separator = _sniff_csv_separator(path, encoding)
                if separator is None:
                    continue
                return pd.read_csv(
                    path,
                    nrows=MAX_ROWS + 1,
                    sep=separator,
                    encoding=encoding,
                )
            except UnicodeDecodeError as exc:
                last_error = exc
                continue
        raise last_error or ValueError('Unable to decode CSV file')
    return pd.read_excel(path, nrows=MAX_ROWS + 1)


def _cleanup_old_exports(max_age_seconds=3600):
    now = time.time()
    try:
        for name in os.listdir(EXPORT_FOLDER):
            full_path = os.path.join(EXPORT_FOLDER, name)
            if os.path.isfile(full_path) and now - os.path.getmtime(full_path) > max_age_seconds:
                try:
                    os.remove(full_path)
                except OSError:
                    pass
    except OSError:
        pass


# Initialize DB on startup
database.init_db()

# ==========================================
# WEB DASHBOARD (UI)
# ==========================================


@app.route('/')
def index():
    session['dashboard'] = True
    return render_template(
        'dashboard.html',
        asset_version=ASSET_VERSION,
        max_rows=f"{MAX_ROWS:,}".replace(",", "."),
        max_upload_mb=MAX_UPLOAD_BYTES // (1024 * 1024),
    )

# ==========================================
# API ENDPOINTS
# ==========================================

@app.route('/api/stats', methods=['GET'])
@require_api_key
def get_stats():
    audit_id = _parse_int_arg(request.args.get('audit_id'))
    return jsonify(_stats_payload(audit_id=audit_id))

@app.route('/api/summary', methods=['GET'])
@require_api_key
def get_summary():
    """Recap payload: totals, medians, top posts and per-account rollups."""
    audit_id = _parse_int_arg(request.args.get('audit_id'))
    return jsonify(database.get_summary(audit_id=audit_id))


@app.route('/api/compare', methods=['GET'])
@require_api_key
def compare_periods():
    """Accounts by month, for the monthly campaign review."""
    months = _parse_int_arg(request.args.get('months')) or 6
    return jsonify(database.get_compare(
        months=months,
        period=database.clean_period(request.args.get('period')),
    ))


@app.route('/api/search', methods=['GET'])
@require_api_key
def search_data():
    """Manual lookup across targets, accounts and stored posts."""
    return jsonify(database.search_data(
        request.args.get('q'),
        limit=_parse_int_arg(request.args.get('limit')) or 20,
    ))


@app.route('/api/clear', methods=['POST'])
@require_api_key
def clear_tasks():
    database.clear_all_tasks()
    logger.info("Database cleared by user")
    return jsonify({"success": True})


@app.route('/api/audits', methods=['GET'])
@require_api_key
def list_audits():
    return jsonify(database.get_audits())


@app.route('/api/audits/<int:audit_id>/rerun', methods=['POST'])
@require_api_key
def rerun_audit(audit_id):
    body = request.get_json(silent=True) or {}
    full = bool(body.get('full') or request.args.get('full') == '1')
    result = database.enqueue_run(audit_id, trigger='manual', full=full)
    if result is None:
        return jsonify({"error": "Audit tidak ditemukan."}), 404
    if result.get('pending'):
        return jsonify({
            "success": True,
            "created": 0,
            "pending": True,
            "message": "Masih ada antrean PENDING/RUNNING untuk audit ini.",
        })
    if result.get('empty'):
        return jsonify({
            "success": True,
            "created": 0,
            "empty": True,
            "message": "Audit ini belum memiliki target.",
        })
    skipped = result.get('skipped_verified', 0)
    logger.info(
        f"Re-audit queued: {result['created']} targets for audit {audit_id} "
        f"({skipped} verified skipped, full={full})"
    )
    message = f"{result['created']} target dijadwalkan ulang."
    if skipped:
        message += f" {skipped} target yang sudah punya angka dilewati."
    return jsonify({"success": True, **result, "message": message})


@app.route('/api/accounts/visit', methods=['POST'])
@require_api_key
def queue_profile_visits():
    """Queue one profile visit per account that has no stored fingerprint yet."""
    body = request.get_json(silent=True) or {}
    audit_id = _parse_int_arg(body.get('audit_id') or request.args.get('audit_id'))
    if not audit_id:
        return jsonify({"error": "audit_id wajib diisi."}), 400
    only_missing = body.get('only_missing')
    if only_missing is None:
        only_missing = request.args.get('only_missing') != '0'
    result = database.enqueue_profile_visits(audit_id, only_missing=bool(only_missing))
    if result is None:
        return jsonify({"error": "Audit tidak ditemukan."}), 404
    if result.get('pending'):
        return jsonify({
            "success": True,
            **result,
            "message": "Sudah ada kunjungan profil yang menunggu; tugas post boleh tetap berjalan.",
        })
    if not result.get('created'):
        return jsonify({
            "success": True,
            **result,
            "message": "Semua akun yang punya handle sudah pernah diukur.",
        })
    logger.info(f"Profile visits queued: {result['created']} accounts for audit {audit_id}")
    return jsonify({
        "success": True,
        **result,
        "message": f"{result['created']} kunjungan profil dijadwalkan.",
    })


@app.route('/api/targets/retry', methods=['POST'])
@require_api_key
def retry_selected_targets():
    """Queue new visits for rows the user selected in the target table."""
    body = request.get_json(silent=True) or {}
    audit_id = _parse_int_arg(body.get('audit_id'))
    target_ids = body.get('target_ids')
    if not audit_id:
        return jsonify({'error': 'audit_id wajib diisi.'}), 400
    if not isinstance(target_ids, list) or not target_ids:
        return jsonify({'error': 'target_ids harus berisi minimal satu id.'}), 400
    result = database.retry_targets(audit_id, target_ids)
    if result is None:
        return jsonify({'error': 'Audit tidak ditemukan.'}), 404
    message = f"{result['created']} target dijadwalkan ulang."
    if result['skipped_running']:
        message += f" {result['skipped_running']} target masih berjalan dan dilewati."
    if result['missing']:
        message += f" {result['missing']} id tidak ditemukan pada audit ini."
    logger.info(
        f"Selected retry: {result['created']} targets for audit {audit_id} "
        f"({result['skipped_running']} running, {result['missing']} missing)"
    )
    return jsonify({'success': True, **result, 'message': message})


@app.route('/api/audits/<int:audit_id>/retry-failed', methods=['POST'])
@require_api_key
def retry_failed(audit_id):
    result = database.retry_failed_targets(audit_id)
    if result is None:
        return jsonify({"error": "Audit tidak ditemukan."}), 404
    skipped = result.get('skipped_permanent', 0)
    note = f" {skipped} target gagal permanen dilewati." if skipped else ""
    if result['created'] == 0:
        return jsonify({
            "success": True,
            **result,
            "message": ("Semua target gagal bersifat permanen (postingan hilang/tautan salah); tidak perlu diulang."
                        if skipped else "Tidak ada target gagal yang bisa diulang."),
        })
    logger.info(
        f"Retry queued: {result['created']} failed targets for audit {audit_id} "
        f"({skipped} permanent skipped)"
    )
    return jsonify({
        "success": True,
        **result,
        "message": f"{result['created']} target gagal dijadwalkan ulang.{note}",
    })


@app.route('/api/audits/<int:audit_id>/settings', methods=['POST'])
@require_api_key
def update_audit_settings(audit_id):
    data = request.get_json(silent=True) or {}
    name = data.get('name')
    repeat_days = data.get('repeat_days')
    if repeat_days is not None:
        clamped = database.parse_repeat_days(repeat_days)
        if clamped is None:
            return jsonify({"error": "repeat_days harus angka 0-365."}), 400
        repeat_days = clamped
    period = data.get('period')
    if period is not None and database.clean_period(period) is None:
        return jsonify({"error": "period harus format YYYY-MM."}), 400
    audit = database.update_audit(audit_id, name=name, repeat_days=repeat_days, period=period)
    if not audit:
        return jsonify({"error": "Audit tidak ditemukan."}), 404
    return jsonify({"success": True, "audit": audit})


@app.route('/api/audits/<int:audit_id>/delete', methods=['POST'])
@require_api_key
def delete_audit(audit_id):
    if not database.delete_audit(audit_id):
        return jsonify({"error": "Audit tidak ditemukan."}), 404
    logger.info(f"Audit {audit_id} deleted")
    return jsonify({"success": True})


@app.route('/api/history', methods=['GET'])
@require_api_key
def target_history():
    target_id = _parse_int_arg(request.args.get('target_id'))
    if not target_id:
        return jsonify({"error": "target_id wajib diisi."}), 400
    limit = database.clamp_limit(_parse_int_arg(request.args.get('limit')), 1, 200, 50)
    target = database.get_target_with_audit(target_id)
    if not target:
        return jsonify({"error": "Target tidak ditemukan."}), 404
    return jsonify({
        "target": target,
        "snapshots": database.get_target_history(target_id, limit=limit),
    })


@app.route('/api/events', methods=['GET'])
@require_api_key
def dashboard_events():
    """Server-Sent Events feed for the dashboard."""
    audit_id = _parse_int_arg(request.args.get('audit_id'))

    def generate():
        last_payload = None
        while True:
            try:
                payload = json.dumps({
                    "stats": _stats_payload(audit_id=audit_id, reclaim=False),
                    "latest": database.get_latest_tasks(limit=50, audit_id=audit_id),
                    "audits": database.get_audits(),
                    "ts": int(time.time()),
                }, ensure_ascii=False, separators=(',', ':'))
                if payload != last_payload:
                    yield f"data: {payload}\n\n"
                    last_payload = payload
                else:
                    yield ": ping\n\n"
            except (GeneratorExit, BrokenPipeError):
                break
            except Exception as exc:  # keep the stream alive on transient DB errors
                logger.warning(f"SSE tick failed: {exc}")
                yield f"event: error\ndata: {json.dumps({'error': str(exc)})}\n\n"
            time.sleep(2)

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        },
    )

def _username_from_post_url(platform, url):
    """Most post URLs carry the handle; a sheet with only links still gets one.

    Instagram uses /{user}/p/{code}/ as well as /p/{code}/, TikTok always uses
    /@user/video/{id}. Anything else returns None instead of guessing.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return None
    segments = [part for part in (parsed.path or '').split('/') if part]
    if platform == 'instagram' and len(segments) >= 3:
        if segments[1].lower() in INSTAGRAM_POST_SEGMENTS:
            return database.clean_username(segments[0])
        return None
    if platform == 'tiktok':
        if segments and segments[0].startswith('@'):
            return database.clean_username(segments[0][1:])
    return None


def _parse_upload_rows(df):
    """Read a target sheet into task dicts plus the counts the response reports.

    Returns None when the file has no Link/URL column.
    """
    truncated = len(df) > MAX_ROWS
    if truncated:
        df = df.head(MAX_ROWS)

    url_column = _pick_column(df.columns, URL_HEADER_HINTS)
    if url_column is None:
        return None

    username_column = _pick_column(df.columns, USER_HEADER_HINTS, USER_HEADER_EXCLUDE)
    tema_column = _pick_column(df.columns, TEMA_HEADER_HINTS)

    tasks = []
    empty_rows = 0
    invalid_urls = 0

    for _, row in df.iterrows():
        raw_url = _cell_text(row.get(url_column))
        if not raw_url:
            empty_rows += 1
            continue

        target = normalize_target_url(raw_url)
        if not target:
            invalid_urls += 1
            continue

        platform, url = target
        username = database.clean_username(_cell_text(row.get(username_column))) if username_column else None
        # The link is evidence, the sheet column is a claim. When the URL already
        # names its owner that name wins, so @name and the opened post can never
        # describe two different accounts.
        url_username = _username_from_post_url(platform, url)
        if url_username:
            username = url_username
        tema = _cell_text(row.get(tema_column)) if tema_column else None

        tasks.append({
            'url': url,
            'platform': platform,
            'username': username,
            'tema': tema
        })

    return {
        'tasks': tasks,
        'empty_rows': empty_rows,
        'invalid_urls': invalid_urls,
        'truncated': truncated,
        'columns': {
            "url": str(url_column),
            "username": str(username_column) if username_column is not None else None,
            "tema": str(tema_column) if tema_column is not None else None,
        },
    }


def _upload_summary(parsed, result, audit_name, repeat_days, is_append):
    """Response body shared by the create-audit and append-to-audit paths."""
    return {
        "inserted": result['inserted'],
        "duplicates": result['duplicates'],
        "skipped": parsed['empty_rows'] + parsed['invalid_urls'],
        "invalid_urls": parsed['invalid_urls'],
        "empty_rows": parsed['empty_rows'],
        "truncated": parsed['truncated'],
        "max_rows": MAX_ROWS,
        "append": is_append,
        "audit_id": result['audit_id'],
        "audit_name": audit_name,
        "run_id": result['run_id'],
        "repeat_days": repeat_days,
        "columns": parsed['columns'],
    }


@app.route('/api/upload', methods=['POST'])
@require_api_key
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    uploaded = request.files['file']
    if uploaded.filename == '':
        return jsonify({"error": "No selected file"}), 400

    # MAX_CONTENT_LENGTH enforces the ceiling while the body is parsed; the 413
    # handler reports it, so no per-file size check is needed here.
    safe_name = secure_filename(uploaded.filename)
    if not safe_name:
        return jsonify({"error": "Invalid filename"}), 400

    extension = os.path.splitext(safe_name)[1].lower()
    if extension not in ('.csv', '.xlsx'):
        return jsonify({"error": "Format file harus .csv atau .xlsx"}), 400

    # Unique temp path: two users uploading "data.csv" must not overwrite each other.
    filepath = os.path.join(UPLOAD_FOLDER, f"upload_{uuid.uuid4().hex}{extension}")
    uploaded.save(filepath)

    try:
        # Checked before pandas opens it: the ceiling bounds the archive, not the
        # XML it unpacks, so the archive is inspected first.
        if extension == '.xlsx' and _xlsx_expands_too_far(filepath):
            return jsonify({
                "error": "File Excel terlalu besar saat dibuka. Pecah file menjadi beberapa bagian."
            }), 400

        df = _read_dataframe(filepath, extension)
        if len(df.columns) == 0:
            return jsonify({"error": "File tidak berisi kolom yang bisa dibaca."}), 400

        parsed = _parse_upload_rows(df)
        if parsed is None:
            return jsonify({
                "error": "Kolom 'Link'/'URL' tidak ditemukan. Periksa header file (contoh: Link, URL, Tautan)."
            }), 400

        tasks = parsed['tasks']
        empty_rows = parsed['empty_rows']
        invalid_urls = parsed['invalid_urls']

        audit_name = (request.form.get('audit_name') or '').strip()
        if not audit_name:
            audit_name = os.path.splitext(safe_name)[0].replace('_', ' ').strip() or 'Audit baru'
        repeat_field = (request.form.get('repeat_days') or '').strip()
        clamped = database.parse_repeat_days(repeat_field)
        if repeat_field and clamped is None:
            # A typo used to be stored as "manual"; say so instead of guessing.
            return jsonify({"error": "repeat_days harus angka 0-365."}), 400
        repeat_days = 0 if clamped is None else clamped
        period = database.clean_period(request.form.get('period'))

        append_audit_id = _parse_int_arg(request.form.get('audit_id'))

        if append_audit_id:
            try:
                result = database.append_targets_to_audit(
                    append_audit_id,
                    tasks,
                    source_filename=safe_name,
                )
            except ValueError:
                return jsonify({"error": "Tidak ada target valid untuk ditambahkan."}), 400
            if result is None:
                return jsonify({"error": "Audit yang dipilih tidak ditemukan."}), 404

            summary = _upload_summary(parsed, result, result['audit_name'], None, True)
            if summary['inserted'] == 0:
                logger.warning(f"Append rejected, no new rows in {safe_name} for audit {append_audit_id}")
                reason = (
                    f"Semua {summary['duplicates']} link sudah ada di audit ini."
                    if summary['duplicates'] else
                    f"Tidak ada target valid. {empty_rows} baris kosong, "
                    f"{invalid_urls} link bukan halaman postingan Instagram/TikTok."
                )
                return jsonify({"error": reason, **summary}), 400

            logger.info(
                f"Appended {summary['inserted']} targets to audit '{result['audit_name']}' "
                f"({summary['duplicates']} duplicates, {empty_rows} empty, {invalid_urls} invalid) "
                f"from {safe_name}"
            )
            return jsonify({"success": True, **summary})

        result = database.create_audit_with_tasks(
            tasks,
            name=audit_name,
            repeat_days=repeat_days,
            source_filename=safe_name,
            period=period,
        )
        summary = _upload_summary(parsed, result, audit_name, repeat_days, False)

        if summary['inserted'] == 0:
            if result.get('audit_id'):
                database.delete_audit(result['audit_id'])
            logger.warning(f"Upload rejected, no valid rows in {safe_name}")
            reason = (
                f"Semua {summary['duplicates']} link duplikat di dalam file."
                if summary['duplicates'] else
                f"Tidak ada task valid. {empty_rows} baris kosong, "
                f"{invalid_urls} link bukan halaman postingan Instagram/TikTok."
            )
            return jsonify({"error": reason, **summary}), 400

        logger.info(
            f"Uploaded audit '{audit_name}' with {summary['inserted']} targets "
            f"({summary['duplicates']} duplicates, {empty_rows} empty, {invalid_urls} invalid) "
            f"from {safe_name}"
        )
        return jsonify({"success": True, **summary})

    except Exception as exc:
        logger.error(f"Upload error: {exc}", exc_info=True)
        return jsonify({
            "error": "Gagal memproses file. Pastikan format benar (xlsx/csv dengan kolom 'Link')."
        }), 500
    finally:
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except OSError as exc:
            logger.warning(f"Could not remove upload file {filepath}: {exc}")

@app.route('/api/task/next', methods=['GET'])
@require_api_key
def get_task():
    _touch_worker()
    prefer_platform = request.args.get('prefer')
    if prefer_platform not in ('instagram', 'tiktok'):
        prefer_platform = None
    task = database.get_next_task(prefer_platform=prefer_platform)
    if not task:
        return jsonify({"hasTask": False})

    follower_cache = None
    if task.get('username'):
        follower_cache = database.get_account_cache(task['username'], task.get('platform'))

    # A profile visit may already have measured this exact post; handing the
    # numbers to the worker saves the navigation entirely.
    cached_post = database.get_cached_post_metrics(task['url'], task.get('platform'))

    return jsonify({
        "hasTask": True,
        "task": {
            "id": task['id'],
            "url": task['url'],
            "platform": task['platform'],
            "username": task['username'],
            "tema": task['tema'],
            "auditId": task.get('audit_id'),
            "runId": task.get('run_id'),
            "targetId": task.get('target_id'),
            "cachedFollowerCount": follower_cache,
            "cachedPost": cached_post,
        }
    })

@app.route('/api/task/result', methods=['POST'])
@require_api_key
def submit_result():
    _touch_worker()
    data = request.get_json(silent=True) or {}
    task_id = data.get('taskId')
    result = data.get('result')

    if not task_id or not isinstance(result, dict):
        return jsonify({"error": "Invalid payload"}), 400

    if not database.update_task_result(task_id, result):
        return jsonify({"error": "Task tidak ditemukan atau sudah selesai."}), 404
    return jsonify({"success": True})


@app.route('/api/account/profile', methods=['POST'])
@require_api_key
def save_account_profile():
    """One profile visit: account fingerprint plus its most recent posts."""
    _touch_worker()
    payload = request.get_json(silent=True) or {}
    result = database.record_account_profile(payload)
    if result is None:
        return jsonify({"error": "Profil tidak valid: platform dan username wajib diisi."}), 400
    logger.info(
        f"Profile stored: {result['platform']}@{result['username']} "
        f"({result['posts_stored']} posts)"
    )
    return jsonify({"success": True, **result})


@app.route('/api/account/profile', methods=['GET'])
@require_api_key
def read_account_profile():
    platform = request.args.get('platform')
    username = request.args.get('username')
    account = database.get_account_profile(username, platform)
    if account is None:
        return jsonify({"error": "Akun belum pernah discrape."}), 404
    return jsonify(account)

@app.route('/api/latest', methods=['GET'])
@require_api_key
def get_latest():
    audit_id = _parse_int_arg(request.args.get('audit_id'))
    limit = database.clamp_limit(_parse_int_arg(request.args.get('limit')), 1, 50, 10)
    return jsonify(database.get_latest_tasks(limit=limit, audit_id=audit_id))


@app.route('/api/targets', methods=['GET'])
@require_api_key
def list_targets():
    return jsonify(database.get_targets(
        audit_id=_parse_int_arg(request.args.get('audit_id')),
        status=(request.args.get('status') or '').strip() or None,
        platform=(request.args.get('platform') or '').strip() or None,
        query=(request.args.get('q') or '').strip() or None,
        issue=(request.args.get('issue') or '').strip() or None,
        sort=(request.args.get('sort') or 'recent').strip(),
        direction=(request.args.get('dir') or 'desc').strip(),
        limit=_parse_int_arg(request.args.get('limit')) or 50,
        offset=_parse_int_arg(request.args.get('offset')) or 0,
    ))

@app.route('/api/accounts', methods=['GET'])
@require_api_key
def list_accounts():
    """Account master list: what we already know, what needs a visit, and which
    accounts look farmed — with the thresholds the verdict used."""
    result = database.get_account_intel(
        platform=(request.args.get('platform') or '').strip() or None,
        query=(request.args.get('q') or '').strip() or None,
        band=(request.args.get('band') or '').strip() or None,
        level=(request.args.get('level') or '').strip() or None,
        sort=(request.args.get('sort') or 'risk').strip(),
        direction=(request.args.get('dir') or 'desc').strip(),
        limit=_parse_int_arg(request.args.get('limit')) or 50,
        offset=_parse_int_arg(request.args.get('offset')) or 0,
    )
    result['thresholds'] = {
        'band': [database.TERNAK_BAND_MIN, database.TERNAK_BAND_MAX],
        'view_reach_floor': database.VIEW_REACH_FLOOR,
        'like_reach_floor': database.IG_LIKE_REACH_FLOOR,
        'upload_burst': [database.UPLOAD_BURST_MIN_COUNT, database.UPLOAD_BURST_WINDOW_MINUTES],
        'flat_follower_tolerance': database.FLAT_FOLLOWER_TOLERANCE * 100,
        'cache_ttl_minutes': database.CACHE_TTL_MINUTES,
        'levels': dict(database.RISK_FLOORS),
    }
    return jsonify(result)


@app.route('/api/accounts/<platform>/<username>', methods=['GET'])
@require_api_key
def account_detail(platform, username):
    detail = database.get_account_detail(username, platform=(platform or '').strip() or None)
    if not detail:
        return jsonify({'success': False, 'error': 'Akun belum pernah disimpan.'}), 404
    return jsonify({'success': True, 'account': detail})


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check for the launcher and the extension popup.

    An unauthenticated probe only learns that the server is up: queue counts are
    business data, so they are served to a paired caller (Control Panel and the
    extension both hold the key) instead of anyone who can reach loopback.
    """
    payload = {
        "status": "healthy",
        "pid": os.getpid(),
        "version": "3.5.0",
    }
    if _has_valid_api_key() or session.get('dashboard'):
        payload['tasks'] = _stats_payload(reclaim=False)
        payload['audits'] = len(database.get_audits())
    return jsonify(payload)


@app.route('/api/auth/check', methods=['GET'])
@require_api_key
def auth_check():
    """No-op authenticated endpoint used by the extension Settings test."""
    return jsonify({"success": True})


@app.errorhandler(413)
def payload_too_large(error):
    return jsonify({"error": f"File terlalu besar (max {MAX_UPLOAD_BYTES // (1024 * 1024)}MB)."}), 413


def _to_number(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def _sanitize_cell(value):
    # Neutralise CSV/Excel formula injection in scraped/user-supplied text.
    if isinstance(value, str) and value and value[0] in ('=', '+', '-', '@', '\t', '\r'):
        return "'" + value
    return value


def _calc_er(platform, likes, comments, views, shares, followers):
    likes = _to_number(likes) or 0.0
    comments = _to_number(comments) or 0.0
    views = _to_number(views) or 0.0
    shares = _to_number(shares) or 0.0
    followers = _to_number(followers) or 0.0

    if str(platform or '') == 'tiktok':
        if views <= 0:
            return None
        return round(((likes + comments + shares) / views) * 100, 2)
    if followers <= 0:
        return None
    return round(((likes + comments) / followers) * 100, 2)


def _difference(current, previous):
    current_value = _to_number(current)
    previous_value = _to_number(previous)
    if current_value is None or previous_value is None:
        return None
    return round(current_value - previous_value, 2)


def _recap_rows(audit_id=None):
    """Rows for the "Rekap" sheet: the numbers a reader would otherwise total
    by hand in Excel, in one tidy block per section."""
    summary = database.get_summary(audit_id=audit_id)
    kpi = summary['kpi']
    rows = []

    def add(section, label, value, note=''):
        rows.append({'Bagian': section, 'Label': label, 'Nilai': value, 'Keterangan': note})

    label = summary['audits'][0]['name'] if audit_id and summary['audits'] else 'Semua audit'
    add('Ringkasan', 'Audit', label)
    add('Ringkasan', 'Target', kpi['targets'])
    add('Ringkasan', 'Sudah diproses', kpi['scraped'])
    add('Ringkasan', 'Terverifikasi (OK + sebagian)', kpi['verified'])
    add('Ringkasan', 'Tingkat keberhasilan (%)', kpi['success_rate'],
        'terverifikasi / sudah diproses')
    add('Ringkasan', 'Gagal', kpi['failed'])
    add('Ringkasan', 'Menunggu / berjalan', kpi['pending'] + kpi['running'])
    add('Ringkasan', 'Akun unik', kpi['accounts'])
    add('Ringkasan', 'Total views', kpi['totals']['views'])
    add('Ringkasan', 'Total likes', kpi['totals']['likes'])
    add('Ringkasan', 'Total komentar', kpi['totals']['comments'])
    add('Ringkasan', 'Total share', kpi['totals']['shares'])
    add('Ringkasan', 'Data pertama', kpi['first_scraped_at'] or '—')
    add('Ringkasan', 'Data terakhir', kpi['last_scraped_at'] or '—')

    for item in summary['platforms']:
        platform = item['platform']
        add(f'Platform {platform}', 'Target', item['targets'])
        add(f'Platform {platform}', 'Sudah diproses', item['scraped'])
        add(f'Platform {platform}', 'Terverifikasi', item['ok'] + item['partial'])
        add(f'Platform {platform}', 'Views', item['views'])
        add(f'Platform {platform}', 'Likes', item['likes'])
        add(f'Platform {platform}', 'Komentar', item['comments'])
        add(f'Platform {platform}', 'Share', item['shares'])
        add(f'Platform {platform}', 'Median ER (%)', item['median_er'],
            f"dari {item['er_rows']} postingan")

    for item in summary['accounts']:
        handle = item['username'] or item['handle']
        add('Akun', f"@{handle}" if item['username'] else handle, item['views'],
            f"{item['platform']} · {item['posts']} postingan · "
            f"median ER {item['median_er'] if item['median_er'] is not None else '—'}%")

    quality = summary['quality']
    add('Kualitas data', 'Akun tanpa followers', quality['without_followers'],
        'ER Instagram tidak bisa dihitung untuk akun ini')
    add('Kualitas data', 'Akun sebagian terbaca (PARTIAL)', quality['partial'])
    add('Kualitas data', 'Akun TikTok tanpa views', quality['missing_views'],
        'Instagram tidak menampilkan views, jadi tidak dihitung sebagai celah')
    add('Kualitas data', 'Akun tanpa handle', quality['missing_username'])
    add('Kualitas data', 'Akun belum pernah diproses', quality['never_scraped'])
    add('Kualitas data', 'Dasar hitung kelengkapan', 'per akun, bukan per tautan')

    add('Catatan', 'Rumus ER Instagram', '(likes + komentar) / followers × 100')
    add('Catatan', 'Rumus ER TikTok', '(likes + komentar + share) / views × 100')
    add('Catatan', 'Pembulatan platform',
        'Views/likes dari platform sudah dibulatkan (mis. 17,6M), jadi ER memakai nilai bulat itu')
    add('Catatan', 'Median, bukan rata-rata',
        'Median dipakai agar satu postingan viral tidak menggeser seluruh angka')
    return rows


def _style_export_sheet(sheet, frame, freeze='A2', autofilter=False):
    """Header colour, frozen header row and readable widths."""
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    header_font = Font(bold=True, color='FFFFFF')
    header_fill = PatternFill('solid', fgColor='1D4ED8')
    for cell in sheet[1]:
        cell.font = header_font
        cell.fill = header_fill
    sheet.freeze_panes = freeze
    if autofilter:
        sheet.auto_filter.ref = sheet.dimensions
    for index, column in enumerate(frame.columns, start=1):
        values = [str(value) for value in frame[column].head(200)]
        longest = max([len(str(column))] + [len(value) for value in values])
        sheet.column_dimensions[get_column_letter(index)].width = min(48, max(10, longest + 2))


@app.route('/api/export', methods=['GET'])
@require_api_key
def export_excel():
    audit_id = _parse_int_arg(request.args.get('audit_id'))
    status = (request.args.get('status') or '').upper()
    if status not in ('OK', 'PARTIAL', 'FAILED'):
        status = None
    rows = database.get_export_rows(audit_id, status=status)
    if not rows:
        if status == 'FAILED':
            message = "Belum ada snapshot gagal untuk diexport."
        elif status:
            message = f"Belum ada snapshot berstatus {status} untuk diexport."
        else:
            message = "Belum ada hasil untuk diexport." if not audit_id else "Audit ini belum memiliki snapshot hasil."
        return jsonify({"error": message}), 400

    df = pd.DataFrame(rows)

    def calc_er(row):
        return _calc_er(
            row.get('platform'), row.get('likes'), row.get('comments'),
            row.get('views'), row.get('shares'), row.get('follower_count'),
        )

    def calc_prev_er(row):
        return _calc_er(
            row.get('platform'), row.get('prev_likes'), row.get('prev_comments'),
            row.get('prev_views'), row.get('prev_shares'), row.get('prev_follower_count'),
        )

    df['engagement_rate_%'] = df.apply(calc_er, axis=1)
    df['prev_engagement_rate_%'] = df.apply(calc_prev_er, axis=1)
    df['delta_likes'] = df.apply(lambda row: _difference(row.get('likes'), row.get('prev_likes')), axis=1)
    df['delta_comments'] = df.apply(lambda row: _difference(row.get('comments'), row.get('prev_comments')), axis=1)
    df['delta_views'] = df.apply(lambda row: _difference(row.get('views'), row.get('prev_views')), axis=1)
    df['delta_follower_count'] = df.apply(
        lambda row: _difference(row.get('follower_count'), row.get('prev_follower_count')), axis=1
    )
    df['delta_engagement_rate_%'] = df.apply(
        lambda row: _difference(row.get('engagement_rate_%'), row.get('prev_engagement_rate_%')), axis=1
    )

    columns = [
        'period', 'audit_name', 'run_id', 'platform', 'tema', 'url', 'username',
        'follower_count', 'likes', 'comments', 'views', 'shares',
        'engagement_rate_%', 'prev_likes', 'prev_comments', 'prev_views',
        'prev_follower_count', 'prev_engagement_rate_%', 'delta_likes',
        'delta_comments', 'delta_views', 'delta_follower_count',
        'delta_engagement_rate_%', 'post_date', 'caption', 'status',
        'error_code', 'error_message', 'retry_count', 'scraped_at',
        'prev_scraped_at',
    ]
    df = df[[c for c in columns if c in df.columns]]

    for column in df.columns:
        if df[column].dtype == object:
            df[column] = df[column].map(_sanitize_cell)

    _cleanup_old_exports()
    export_path = os.path.join(EXPORT_FOLDER, f"sunscraping_export_{uuid.uuid4().hex}.xlsx")
    try:
        recap = pd.DataFrame(_recap_rows(audit_id))
        with pd.ExcelWriter(export_path, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Data')
            if not recap.empty:
                recap.to_excel(writer, index=False, sheet_name='Rekap')
            _style_export_sheet(writer.sheets['Data'], df, autofilter=True)
            if 'Rekap' in writer.sheets:
                _style_export_sheet(writer.sheets['Rekap'], recap)
    except Exception as exc:
        logger.error(f"Export error: {exc}", exc_info=True)
        return jsonify({
            "error": "Gagal membuat file Excel. Tutup file yang mungkin terkunci lalu coba lagi."
        }), 500

    audit_label = rows[0].get('audit_name') if audit_id else 'semua_audit'
    safe_label = re.sub(r'[^A-Za-z0-9]+', '_', str(audit_label or 'audit')).strip('_')[:48] or 'audit'
    status_label = '_' + status.lower() if status else ''
    filename = (
        f"sunscraping_{safe_label}{status_label}_"
        f"{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    )

    return send_file(
        export_path,
        as_attachment=True,
        download_name=filename,
    )

def _prune_safety_backups(keep=BACKUP_KEEP):
    """Keep the newest pre-restore copies and drop the rest."""
    try:
        names = [
            name for name in os.listdir(BACKUP_FOLDER)
            if name.startswith('pre_restore_') and name.endswith('.db')
        ]
    except OSError:
        return
    paths = [os.path.join(BACKUP_FOLDER, name) for name in names]
    paths.sort(key=lambda item: os.path.getmtime(item), reverse=True)
    for path in paths[keep:]:
        try:
            os.remove(path)
        except OSError:
            pass


@app.route('/api/database/info', methods=['GET'])
@require_api_key
def database_info():
    return jsonify(database.get_database_info())


@app.route('/api/database/export', methods=['GET'])
@require_api_key
def export_database():
    """Download one consistent .db file containing every table."""
    temp_path = os.path.join(EXPORT_FOLDER, f'db_export_{uuid.uuid4().hex}.db')
    try:
        database.backup_database(temp_path)
        with open(temp_path, 'rb') as handle:
            payload = handle.read()
    except (OSError, sqlite3.Error) as exc:
        logger.error(f'Database export failed: {exc}', exc_info=True)
        return jsonify({'error': 'Gagal membuat cadangan database.'}), 500
    finally:
        for path in (temp_path, temp_path + '-wal', temp_path + '-shm'):
            try:
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass

    stamp = datetime.now().strftime('%Y%m%d_%H%M')
    return send_file(
        io.BytesIO(payload),
        as_attachment=True,
        download_name=f'sunscraping_db_{stamp}.db',
        mimetype='application/vnd.sqlite3',
    )


@app.route('/api/database/import', methods=['POST'])
@require_api_key
def import_database():
    """Replace all data with an uploaded .db, after keeping a safety copy."""
    uploaded = request.files.get('file')
    if uploaded is None or not uploaded.filename:
        return jsonify({'error': 'Pilih file cadangan .db.'}), 400

    safe_name = secure_filename(uploaded.filename)
    extension = os.path.splitext(safe_name)[1].lower()
    if extension not in BACKUP_EXTENSIONS:
        return jsonify({'error': 'Format cadangan harus .db atau .sqlite.'}), 400

    filepath = os.path.join(
        UPLOAD_FOLDER, f'restore_{uuid.uuid4().hex}{extension}'
    )
    uploaded.save(filepath)
    try:
        try:
            incoming = database.inspect_backup(filepath)
        except ValueError as exc:
            return jsonify({'error': str(exc)}), 400

        safety_name = (
            'pre_restore_'
            + datetime.now().strftime('%Y%m%d_%H%M%S')
            + '.db'
        )
        safety_path = os.path.join(BACKUP_FOLDER, safety_name)
        try:
            database.backup_database(safety_path)
        except (OSError, sqlite3.Error) as exc:
            logger.error(f'Pre-restore backup failed: {exc}', exc_info=True)
            return jsonify({
                'error': 'Cadangan pengaman gagal dibuat, jadi pemulihan dibatalkan. '
                         'Data lama tidak diubah.'
            }), 500

        try:
            database.restore_database(filepath)
        except (OSError, sqlite3.Error) as exc:
            logger.error(f'Database restore failed: {exc}', exc_info=True)
            return jsonify({
                'error': 'Gagal memulihkan database. Data lama tetap tersimpan di '
                         + safety_name + '.'
            }), 500

        _prune_safety_backups()
        restored = database.get_database_info()
        logger.info(
            f'Database restored from {safe_name}: '
            f"{restored['counts'].get('audits')} audits, "
            f"{restored['counts'].get('targets')} targets; "
            f'safety copy {safety_name}'
        )
        return jsonify({
            'success': True,
            'file': safe_name,
            'safety_backup': safety_name,
            'source': incoming,
            'restored': restored,
        })
    finally:
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
        except OSError as exc:
            logger.warning(f'Could not remove restore upload {filepath}: {exc}')


def write_pid():
    """Write current process PID to file for clean shutdown."""
    try:
        with open(PID_FILE, 'w') as f:
            f.write(str(os.getpid()))
        logger.info(f"PID {os.getpid()} written to {PID_FILE}")
    except Exception as e:
        logger.warning(f"Could not write PID file: {e}")

def cleanup_pid():
    """Remove PID file on exit."""
    try:
        if os.path.exists(PID_FILE):
            os.remove(PID_FILE)
            logger.info("PID file cleaned up")
    except Exception:
        pass

def graceful_shutdown(signum, frame):
    """Handle SIGINT/SIGTERM for clean exit."""
    logger.info(f"Received signal {signum}, shutting down gracefully...")
    cleanup_pid()
    sys.exit(0)

if __name__ == '__main__':
    key_source = 'SA_API_KEY env' if os.environ.get('SA_API_KEY', '').strip() else KEY_FILE

    # Register cleanup handlers
    atexit.register(cleanup_pid)
    signal.signal(signal.SIGINT, graceful_shutdown)
    signal.signal(signal.SIGTERM, graceful_shutdown)

    # Write PID file
    write_pid()

    logger.info(f"sunscraping backend starting on http://localhost:{PORT} (debug={DEBUG_MODE})")
    logger.info(f"API key source: {key_source}")
    if not os.environ.get('SA_API_KEY', '').strip():
        logger.info("Use the Control Panel or backend/.api_key to pair the Chrome extension.")
    if DEBUG_MODE:
        logger.warning("Flask debug mode is ON. Do not use it outside local development.")

    banner = "\n".join([
        "",
        "  +======================================+",
        "  |   sunscraping — Backend Server       |",
        "  +======================================+",
        f"  |  URL  : http://localhost:{PORT:<13}|",
        f"  |  PID  : {os.getpid():<28}|",
        f"  |  Debug: {'ON' if DEBUG_MODE else 'OFF':<28}|",
        f"  |  Key  : lihat {os.path.basename(KEY_FILE):<25}|",
        "  +======================================+",
        "",
    ])
    logger.info(banner)

    app.run(host='127.0.0.1', port=PORT, debug=DEBUG_MODE)
