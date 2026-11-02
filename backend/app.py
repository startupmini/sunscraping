# pyrefly: ignore [missing-import]
from flask import (
    Flask, Response, jsonify, render_template, request, send_file, session,
    stream_with_context,
)
from flask_cors import CORS
import pandas as pd
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
ASSET_VERSION = '4'  # bump whenever dashboard.css/dashboard.js changes, so browsers drop the cache

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

UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
EXPORT_FOLDER = os.path.join(UPLOAD_FOLDER, 'exports')
os.makedirs(EXPORT_FOLDER, exist_ok=True)

INSTAGRAM_HOSTS = {'instagram.com', 'www.instagram.com', 'm.instagram.com'}
TIKTOK_HOSTS = {
    'tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
}

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
    return response


def _has_valid_api_key():
    key = request.headers.get('X-API-Key', '')
    return bool(key) and secrets.compare_digest(key, API_KEY)


# In-memory heartbeat: updated whenever the extension talks to the task API.
WORKER_LAST_SEEN = {'ts': None}


def _touch_worker():
    WORKER_LAST_SEEN['ts'] = datetime.now(timezone.utc).isoformat(
        timespec='seconds'
    ).replace('+00:00', 'Z')


def _stats_payload(audit_id=None, reclaim=True):
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


def normalize_target_url(raw):
    """Return (platform, canonical_url) for allowed Instagram/TikTok hosts."""
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
    return render_template('dashboard.html', asset_version=ASSET_VERSION)

# ==========================================
# API ENDPOINTS
# ==========================================

@app.route('/api/stats', methods=['GET'])
@require_api_key
def get_stats():
    audit_id = _parse_int_arg(request.args.get('audit_id'))
    return jsonify(_stats_payload(audit_id=audit_id))

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
    result = database.enqueue_run(audit_id, trigger='manual')
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
    logger.info(f"Re-audit queued: {result['created']} targets for audit {audit_id}")
    return jsonify({"success": True, **result, "message": f"{result['created']} target dijadwalkan ulang."})


@app.route('/api/audits/<int:audit_id>/retry-failed', methods=['POST'])
@require_api_key
def retry_failed(audit_id):
    result = database.retry_failed_targets(audit_id)
    if result is None:
        return jsonify({"error": "Audit tidak ditemukan."}), 404
    if result['created'] == 0:
        return jsonify({
            "success": True,
            "created": 0,
            "message": "Tidak ada target gagal yang bisa diulang.",
        })
    logger.info(f"Retry queued: {result['created']} failed targets for audit {audit_id}")
    return jsonify({
        "success": True,
        **result,
        "message": f"{result['created']} target gagal dijadwalkan ulang.",
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
    audit = database.update_audit(audit_id, name=name, repeat_days=repeat_days)
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
        username = _cell_text(row.get(username_column)) if username_column else None
        if username:
            username = username.lstrip('@').strip() or None
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
        clamped = database.parse_repeat_days(request.form.get('repeat_days'))
        repeat_days = 0 if clamped is None else clamped

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
                    f"{invalid_urls} link bukan Instagram/TikTok."
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
                f"{invalid_urls} link bukan Instagram/TikTok."
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
            "cachedFollowerCount": follower_cache
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
        return jsonify({"error": "Task not found"}), 404
    return jsonify({"success": True})

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
        sort=(request.args.get('sort') or 'recent').strip(),
        direction=(request.args.get('dir') or 'desc').strip(),
        limit=_parse_int_arg(request.args.get('limit')) or 50,
        offset=_parse_int_arg(request.args.get('offset')) or 0,
    ))

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint for launcher/monitoring."""
    stats = _stats_payload(reclaim=False)
    return jsonify({
        "status": "healthy",
        "pid": os.getpid(),
        "version": "3.5.0",
        "tasks": stats,
        "audits": len(database.get_audits()),
    })


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
        'audit_name', 'run_id', 'platform', 'tema', 'url', 'username',
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
        df.to_excel(export_path, index=False)
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
