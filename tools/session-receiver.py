#!/usr/bin/env python3
"""Receive the cookie export from tools/session-bridge and store it.

Loopback only: the cookies are session credentials, so the server never listens
on a routable interface and exits after a successful save when --once is used.

    python tools/session-receiver.py --once
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'backend' / 'runtime' / 'session-cookies.json'
KEY_NAMES = ('sessionid', 'ds_user_id', 'sid_guard', 'uid_tt', 'csrftoken', 'mid')


def summarise(cookies):
    counts = {}
    for cookie in cookies:
        domain = str(cookie.get('domain') or '?')
        counts[domain] = counts.get(domain, 0) + 1
    keys = [
        f"{cookie.get('domain')}/{cookie.get('name')}"
        for cookie in cookies
        if cookie.get('name') in KEY_NAMES
    ]
    return counts, keys


class Handler(BaseHTTPRequestHandler):
    server_version = 'sunscraping-session/1.0'

    def _reply(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._reply(204, {})

    def do_GET(self):
        self._reply(200, {'status': 'ready', 'target': str(TARGET)})

    def do_POST(self):
        if self.path.rstrip('/') != '/session':
            self._reply(404, {'error': 'gunakan /session'})
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
            payload = json.loads(self.rfile.read(length) or b'{}')
        except (ValueError, json.JSONDecodeError) as error:
            self._reply(400, {'error': f'JSON tidak valid: {error}'})
            return

        cookies = payload.get('cookies') or []
        if not cookies:
            self._reply(400, {'error': 'tidak ada cookie'})
            return

        TARGET.parent.mkdir(parents=True, exist_ok=True)
        stored = {
            'receivedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'exportedAt': payload.get('exportedAt'),
            'cookies': cookies,
        }
        TARGET.write_text(json.dumps(stored, indent=2), encoding='utf-8')

        counts, keys = summarise(cookies)
        print(f'[receiver] {len(cookies)} cookie dari '
              + ', '.join(f'{domain}={count}' for domain, count in counts.items()))
        print(f'[receiver] kunci: {", ".join(keys) or "(tidak ada)"}')
        print(f'[receiver] tersimpan: {TARGET}', flush=True)

        self._reply(200, {
            'saved': str(TARGET),
            'count': len(cookies),
            'domains': counts,
            'keys': keys,
        })

        if self.server.once:
            self.server.should_stop = True

    def log_message(self, *args):
        return


def serve(port, once):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.once = once
    server.should_stop = False
    print(f'[receiver] mendengarkan di http://127.0.0.1:{port}/session', flush=True)
    try:
        while not server.should_stop:
            server.handle_request()
    finally:
        server.server_close()
    print('[receiver] selesai.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--once', action='store_true',
                        help='keluar setelah satu ekspor berhasil')
    args = parser.parse_args()
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass
    serve(args.port, args.once)


if __name__ == '__main__':
    main()
