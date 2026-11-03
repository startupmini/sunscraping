#!/usr/bin/env python3
"""Live audit runner for sunscraping — upload a link sheet, then follow it to done.

This exists because the desktop/extension worker needs an interactive login and a
running backend: everything that *can* be automated is here, so a full run is one
command instead of six.

    python tools/live_audit.py --file "C:\\Users\\Vv\\Downloads\\link.xlsx" ^
        --name "Uji live" --wait --export

What it does, in order:

1. Starts `backend/app.py` if nothing answers /api/health yet (the process it
   starts is recorded in backend/runtime/live_audit.pid).
2. Reads `backend/.api_key` — the key the backend generates on first run.
3. Uploads the file to /api/upload as a new audit and prints the real summary
   (inserted / duplicates / empty rows / links that are not posts).
4. With --wait, polls /api/stats until PENDING + RUNNING is 0, and warns when the
   queue stops moving (that means no worker is running).
5. With --export, downloads the result sheet next to the input file.

The scraping itself is still done by the worker (Chrome extension or
desktop app), because it needs your logged-in session. Start the worker after
step 3; the same script reports when every row is finished.

Standard library only: no pip install beyond the backend's own requirements.
"""

import argparse
import json
import os
from datetime import datetime, timezone
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.join(ROOT, 'backend')
RUNTIME_DIR = os.path.join(BACKEND_DIR, 'runtime')
KEY_FILE = os.path.join(BACKEND_DIR, '.api_key')
STATE_FILE = os.path.join(RUNTIME_DIR, 'live_audit.json')
PID_FILE = os.path.join(RUNTIME_DIR, 'live_audit.pid')
SERVER_LOG = os.path.join(RUNTIME_DIR, 'live_audit_server.log')

STATUS_KEYS = ('PENDING', 'RUNNING', 'OK', 'PARTIAL', 'FAILED')


def out(message=''):
    print(message, flush=True)


def die(message, code=1):
    out(f'GAGAL: {message}')
    raise SystemExit(code)


def base_url(port):
    return f'http://127.0.0.1:{port}'


# --------------------------------------------------------------- HTTP helpers --

def request(base, path, key=None, method='GET', body=None, headers=None,
            timeout=60):
    hdrs = dict(headers or {})
    if key:
        hdrs['X-API-Key'] = key
    req = urllib.request.Request(base + path, data=body, headers=hdrs,
                                 method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as http_error:
        return http_error.code, http_error.read()
    except urllib.error.URLError as url_error:
        return None, str(url_error.reason).encode('utf-8', 'replace')


def get_json(base, path, key=None, timeout=60):
    status, payload = request(base, path, key=key, timeout=timeout)
    if status is None:
        return None, payload.decode('utf-8', 'replace')
    try:
        return status, json.loads(payload.decode('utf-8', 'replace') or '{}')
    except json.JSONDecodeError:
        return status, {'raw': payload.decode('utf-8', 'replace')[:400]}


def multipart(fields, file_field, filename, content):
    boundary = f'----sunscraping{uuid.uuid4().hex}'
    chunks = []
    for name, value in fields.items():
        if value is None:
            continue
        chunks.append(
            f'--{boundary}\r\n'
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
            f'{value}\r\n'.encode('utf-8')
        )
    chunks.append(
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="{file_field}"; '
        f'filename="{filename}"\r\n'
        'Content-Type: application/octet-stream\r\n\r\n'.encode('utf-8')
    )
    chunks.append(content)
    chunks.append(f'\r\n--{boundary}--\r\n'.encode('utf-8'))
    return boundary, b''.join(chunks)


# ------------------------------------------------------------- backend control --

def healthy(base):
    status, _ = request(base, '/api/health', timeout=3)
    return status == 200


def wait_healthy(base, seconds=45):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if healthy(base):
            return True
        time.sleep(0.5)
    return False


def read_key():
    try:
        with open(KEY_FILE, 'r', encoding='utf-8') as handle:
            value = handle.read().strip()
        return value or None
    except OSError:
        return None


def wait_key(seconds=20):
    deadline = time.time() + seconds
    while time.time() < deadline:
        key = read_key()
        if key:
            return key
        time.sleep(0.25)
    return None


def start_backend(port):
    os.makedirs(RUNTIME_DIR, exist_ok=True)
    out(f'Menjalankan backend: {os.path.join("backend", "app.py")} (port {port})')
    env = dict(os.environ)
    env['SA_PORT'] = str(port)
    env['PYTHONIOENCODING'] = 'utf-8'
    env['PYTHONUNBUFFERED'] = '1'
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0) if os.name == 'nt' else 0
    handle = open(SERVER_LOG, 'ab')
    process = subprocess.Popen(
        [sys.executable, os.path.join(BACKEND_DIR, 'app.py')],
        cwd=BACKEND_DIR,
        env=env,
        stdout=handle,
        stderr=subprocess.STDOUT,
        creationflags=flags,
    )
    try:
        with open(PID_FILE, 'w', encoding='utf-8') as pid_file:
            pid_file.write(str(process.pid))
    except OSError:
        pass
    if not wait_healthy(base_url(port)):
        die(f'backend tidak sehat setelah 45 detik; lihat {SERVER_LOG}')
    out(f'Backend siap (PID {process.pid}, log {os.path.relpath(SERVER_LOG, ROOT)}).')
    return process


def stop_backend():
    pid = None
    try:
        with open(PID_FILE, 'r', encoding='utf-8') as handle:
            pid = int(handle.read().strip())
    except (OSError, ValueError):
        pass
    if not pid:
        out('Tidak ada backend yang dijalankan skrip ini.')
        return
    try:
        os.kill(pid, 15)
    except OSError as error:
        out(f'Tidak dapat menghentikan PID {pid}: {error}')
        return
    try:
        os.remove(PID_FILE)
    except OSError:
        pass
    out(f'Backend PID {pid} dihentikan.')


def ensure_backend(port):
    base = base_url(port)
    if healthy(base):
        out('Backend sudah berjalan; memakai proses yang ada.')
        return
    start_backend(port)


# -------------------------------------------------------------------- commands --

def resolve_port(args, state=None):
    return (args.port
            or (state or {}).get('port')
            or int(os.environ.get('SA_PORT', '5000')))


def command_upload(args):
    port = resolve_port(args)
    ensure_backend(port)
    base = base_url(port)
    key = wait_key()
    if not key:
        die(f'API key tidak ditemukan di {KEY_FILE}')

    path = os.path.abspath(args.file)
    if not os.path.exists(path):
        die(f'File tidak ditemukan: {path}')
    size = os.path.getsize(path)
    out(f'Upload {path} ({size / 1024:.0f} KB) sebagai audit "{args.name}"...')

    fields = {'audit_name': args.name, 'repeat_days': str(args.repeat_days)}
    if args.audit_id:
        fields['audit_id'] = str(args.audit_id)

    with open(path, 'rb') as handle:
        content = handle.read()
    boundary, body = multipart(fields, 'file', os.path.basename(path), content)
    status, payload = request(
        base, '/api/upload', key=key, method='POST', body=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
        timeout=180,
    )
    try:
        data = json.loads(payload.decode('utf-8', 'replace') or '{}')
    except json.JSONDecodeError:
        die(f'Respons upload tidak terbaca (HTTP {status}): '
            f'{payload[:300]!r}')

    if status != 200 or not data.get('success'):
        die(f'upload ditolak (HTTP {status}): {data.get("error") or data}')

    out('')
    out('=== Hasil upload ===')
    out(f'  audit_id        : {data.get("audit_id")}')
    out(f'  run_id          : {data.get("run_id")}')
    out(f'  task baru       : {data.get("inserted")}')
    out(f'  duplikat        : {data.get("duplicates")}')
    out(f'  baris kosong    : {data.get("empty_rows")}')
    out(f'  bukan postingan : {data.get("invalid_urls")}')
    out(f'  kolom terdeteksi: {data.get("columns")}')
    invalid = data.get('invalid_urls')
    if isinstance(invalid, list) and invalid:
        for item in invalid[:10]:
            out(f'    - {item}')
        if len(invalid) > 10:
            out(f'    ... dan {len(invalid) - 10} lagi')

    state = {
        'audit_id': data.get('audit_id'),
        'run_id': data.get('run_id'),
        'file': path,
        'name': args.name,
        'port': port,
        'started_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
    }
    os.makedirs(RUNTIME_DIR, exist_ok=True)
    with open(STATE_FILE, 'w', encoding='utf-8') as handle:
        json.dump(state, handle, indent=2)
    out(f'\nStatus tersimpan di {os.path.relpath(STATE_FILE, ROOT)}.')

    out('\nLangkah berikutnya: jalankan worker (extension Chrome: popup → Start, '
        'atau desktop: tray → Mulai worker) dengan sesi login yang sama. '
        'Skrip ini akan melaporkan sampai antrean kosong.')
    return state


def read_state():
    try:
        with open(STATE_FILE, 'r', encoding='utf-8') as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}


def command_watch(args):
    state = read_state()
    base = base_url(int(resolve_port(args, state)))
    key = wait_key(5) or ''
    if not key:
        die(f'API key tidak ditemukan di {KEY_FILE}')
    if not healthy(base):
        die('backend tidak berjalan; jalankan dulu langkah upload')

    out(f'Memantau antrean (interval {args.interval} detik). Ctrl+C untuk berhenti.')
    last_change = time.time()
    previous = None
    silent_rounds = 0
    while True:
        status, stats = get_json(base, '/api/stats', key=key)
        if status != 200 or not isinstance(stats, dict):
            out(f'[stats] HTTP {status}: {stats if status != 200 else "?"}')
            time.sleep(args.interval)
            continue

        counts = {name: int(stats.get(name, 0) or 0) for name in STATUS_KEYS}
        remaining = counts['PENDING'] + counts['RUNNING']
        snapshot = tuple(counts.values())
        stamp = time.strftime('%H:%M:%S')
        worker_age = worker_silence(stats.get('WORKER_LAST_SEEN'))
        age_label = 'belum pernah' if worker_age is None else f'{worker_age:.0f}s lalu'
        out(f'[{stamp}] ' + ' | '.join(f'{k} {v}' for k, v in counts.items())
            + f'  (sisa {remaining}, worker {age_label})')

        if snapshot != previous:
            previous = snapshot
            last_change = time.time()

        if remaining == 0:
            out('\nSemua baris selesai diproses.')
            return counts

        # The backend records the last time a worker touched the task API, which
        # says "worker mati" far more reliably than a stalled counter does.
        stale = worker_age is None or worker_age > args.stall
        if stale and time.time() - last_change > args.stall:
            silent_rounds += 1
            out('  ! tidak ada worker menghubungi backend dan antrean tidak bergerak — '
                'worker kemungkinan belum dijalankan atau sudah berhenti '
                '(budget habis / login / error).')
            if silent_rounds >= 3:
                out('  ! berhenti memantau. Jalankan worker lagi lalu ulangi '
                    'perintah --watch.')
                return counts
        else:
            silent_rounds = 0

        time.sleep(args.interval)


def worker_silence(seen):
    """Seconds since the backend last saw a worker, or None if it never did."""
    if not seen:
        return None
    try:
        stamp = datetime.fromisoformat(str(seen).replace('Z', '+00:00'))
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return max(0.0, (datetime.now(timezone.utc) - stamp).total_seconds())


def command_export(args):
    state = read_state()
    base = base_url(int(resolve_port(args, state)))
    key = wait_key(5) or ''
    if not key:
        die(f'API key tidak ditemukan di {KEY_FILE}')
    audit_id = args.audit_id or state.get('audit_id')
    if not audit_id:
        die('audit_id tidak diketahui; jalankan upload dulu atau pakai --audit-id')
    query = urllib.parse.urlencode({'audit_id': audit_id})
    status, payload = request(base, f'/api/export?{query}', key=key, timeout=180)
    if status != 200:
        die(f'export gagal (HTTP {status}): {payload[:300]!r}')
    target = args.out or default_export_path(state.get('file'))
    with open(target, 'wb') as handle:
        handle.write(payload)
    out(f'Hasil disimpan: {target} ({len(payload) / 1024:.0f} KB)')
    return target


def default_export_path(source):
    if source:
        folder = os.path.dirname(os.path.abspath(source))
        stem = os.path.splitext(os.path.basename(source))[0]
        return os.path.join(folder, f'{stem}-hasil.xlsx')
    return os.path.join(ROOT, 'sunscraping-hasil.xlsx')


# ------------------------------------------------------------------------ main --

def build_parser():
    parser = argparse.ArgumentParser(
        description='Upload lembar link lalu pantau sampai semua baris selesai.',
    )
    parser.add_argument('--file', help='file .xlsx/.csv berisi kolom Link/URL')
    parser.add_argument('--name', default='Audit',
                        help='nama audit (default: "Audit")')
    parser.add_argument('--audit-id', type=int, default=None,
                        help='tambahkan ke audit yang sudah ada, bukan audit baru')
    parser.add_argument('--repeat-days', type=int, default=0,
                        help='pengulangan otomatis (0 = manual)')
    parser.add_argument('--port', type=int, default=None,
                        help='port backend (default: SA_PORT atau 5000)')
    parser.add_argument('--wait', action='store_true',
                        help='pantau /api/stats sampai antrean kosong')
    parser.add_argument('--interval', type=int, default=20,
                        help='detik antar poll saat memantau (default 20)')
    parser.add_argument('--stall', type=int, default=180,
                        help='detik tanpa perubahan sebelum memperingatkan (default 180)')
    parser.add_argument('--export', action='store_true',
                        help='unduh hasil ke <nama>-hasil.xlsx')
    parser.add_argument('--out', help='path hasil export')
    parser.add_argument('--watch', action='store_true',
                        help='hanya memantau antrean yang sudah ada')
    parser.add_argument('--stop', action='store_true',
                        help='hentikan backend yang dijalankan skrip ini')
    return parser


def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass

    args = build_parser().parse_args()
    if args.stop:
        stop_backend()
        return

    if args.file:
        command_upload(args)

    if args.wait or args.watch:
        command_watch(args)

    if args.export:
        command_export(args)

    if not (args.file or args.wait or args.watch or args.export):
        out('Tidak ada aksi. Contoh:')
        out('  python tools/live_audit.py --file "C:\\path\\link.xlsx" '
            '--name "Uji live" --wait --export')


if __name__ == '__main__':
    main()
