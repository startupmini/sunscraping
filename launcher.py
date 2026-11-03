#!/usr/bin/env python3
"""sunscraping mini launcher.

A small local control panel that starts and stops the Flask backend. It uses
only the Python standard library: no Electron, no HTA, no extra dependency.

Security model: the launcher binds to 127.0.0.1, gives the page an HttpOnly
SameSite=Strict cookie, and requires a custom header on every API call. A
cross-site page cannot read the responses and cannot send the custom header
without a CORS preflight, which this server does not answer.
"""

from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

APP_NAME = "sunscraping-launcher"
VERSION = "1.0.0"
ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
APP_FILE = BACKEND_DIR / "app.py"
KEY_FILE = BACKEND_DIR / ".api_key"
PID_FILE = BACKEND_DIR / "server.pid"
RUNTIME_DIR = BACKEND_DIR / "runtime"
# The HTA/hidden runner keeps server_log.txt open with an exclusive cmd
# redirect, so a launcher-managed backend writes to its own file instead.
LOG_FILE = RUNTIME_DIR / "server_log.txt"
LAUNCHER_LOG_FILE = RUNTIME_DIR / "server_log_launcher.txt"
UI_DIR = ROOT / "launcher"
HOST = "127.0.0.1"
SESSION_COOKIE = "sa_launcher_session"
SESSION_TOKEN = secrets.token_urlsafe(32)
MAX_LOG_BYTES = 5 * 1024 * 1024

ASSETS = {
    "/": (UI_DIR / "index.html", "text/html; charset=utf-8"),
    "/index.html": (UI_DIR / "index.html", "text/html; charset=utf-8"),
    "/launcher.css": (UI_DIR / "launcher.css", "text/css; charset=utf-8"),
    "/launcher.js": (UI_DIR / "launcher.js", "application/javascript; charset=utf-8"),
}
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
HTML_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self'; "
    "img-src 'self' data:; connect-src 'self'; font-src 'self'; "
    "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
)


def _env_port(name: str, default: int) -> int:
    try:
        value = int((os.environ.get(name) or "").strip() or default)
    except (TypeError, ValueError):
        return default
    return value if 1 <= value <= 65535 else default


LAUNCHER_PORT = _env_port("SA_LAUNCHER_PORT", 5050)
BACKEND_PORT = _env_port("SA_PORT", 5000)

# Chrome/Edge refuse to navigate to these (net::ERR_UNSAFE_PORT), so the
# panel would never open there even though the socket works fine.
UNSAFE_PORTS = {
    1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69,
    77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119,
    123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
    526, 530, 531, 532, 540, 548, 554, 556, 563, 636, 989, 990, 993, 995,
    1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666,
    6667, 6668, 6669, 6679, 6697, 10080,
}


def backend_base(port: int = BACKEND_PORT) -> str:
    return f"http://{HOST}:{port}"


def read_key() -> Optional[str]:
    try:
        key = KEY_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return key or None


def mask_key(key: Optional[str]) -> str:
    if not key:
        return ""
    if len(key) < 12:
        return "•" * 8
    return key[:4] + "…" + key[-4:]


def active_log_file() -> Path:
    """Prefer the launcher's own log; fall back to the shared server log."""
    if LAUNCHER_LOG_FILE.exists():
        return LAUNCHER_LOG_FILE
    return LOG_FILE


def read_log_tail(path: Optional[Path] = None, limit: int = 120) -> list[str]:
    """Return the last lines without loading a growing log file whole."""
    target = Path(path) if path is not None else active_log_file()
    if limit <= 0:
        return []
    try:
        with target.open("rb") as handle:
            handle.seek(0, os.SEEK_END)
            size = handle.tell()
            handle.seek(max(0, size - 128 * 1024))
            raw = handle.read()
    except OSError:
        return []
    text = raw.decode("utf-8", errors="replace")
    return text.splitlines()[-limit:]


def rotate_log() -> None:
    try:
        if not LAUNCHER_LOG_FILE.exists() or LAUNCHER_LOG_FILE.stat().st_size <= MAX_LOG_BYTES:
            return
        old = LAUNCHER_LOG_FILE.with_suffix(".old")
        try:
            old.unlink()
        except OSError:
            pass
        LAUNCHER_LOG_FILE.replace(old)
    except OSError:
        pass


def allowed_host(host_header: str, port: int) -> bool:
    return (host_header or "").lower() in {
        f"127.0.0.1:{port}",
        f"localhost:{port}",
    }


def allowed_origin(origin: Optional[str], port: int) -> bool:
    if not origin:
        return True
    return origin.lower() in {
        f"http://127.0.0.1:{port}",
        f"http://localhost:{port}",
    }


def _get_json(url: str, headers: Optional[dict] = None, timeout: float = 0.9) -> Optional[dict]:
    merged = {"Accept": "application/json"}
    if headers:
        merged.update(headers)
    request = urllib.request.Request(url, headers=merged)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                return None
            payload = response.read(1024 * 1024)
            parsed = json.loads(payload.decode("utf-8"))
    except (OSError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


class LauncherState:
    def __init__(self, backend_port: int, launcher_port: int) -> None:
        self.backend_port = backend_port
        self.launcher_port = launcher_port
        self.child: Optional[subprocess.Popen] = None
        self.action: Optional[str] = None
        self.action_lock = threading.Lock()
        self.server: Optional[ThreadingHTTPServer] = None
        self.last_error = ""

    @property
    def url(self) -> str:
        return backend_base(self.backend_port)

    def health(self) -> Optional[dict]:
        key = read_key()
        headers = {"X-API-Key": key} if key else None
        return _get_json(self.url + "/api/health", headers=headers)

    def _owns(self, health: Optional[dict]) -> bool:
        return bool(
            health
            and self.child is not None
            and self.child.poll() is None
            and health.get("pid") == self.child.pid
        )

    def status(self) -> dict:
        health = self.health()
        online = bool(health and health.get("status") == "healthy")

        if self.child is not None and self.child.poll() is not None:
            self.child = None
        child = self.child
        if online and self._owns(health):
            owner = "launcher"
        elif online:
            owner = "external"
        else:
            owner = None

        tasks = health.get("tasks") if online else None
        if not isinstance(tasks, dict):
            tasks = None

        key = read_key()
        log_path = active_log_file()
        try:
            log_size = log_path.stat().st_size
            log_exists = True
        except OSError:
            log_size = 0
            log_exists = False

        busy = self.action is not None
        phase = self.action
        if not busy and child is not None and not online:
            phase = "starting"

        return {
            "ok": True,
            "launcher": {
                "name": APP_NAME,
                "version": VERSION,
                "port": self.launcher_port,
                "url": f"http://{HOST}:{self.launcher_port}",
            },
            "backend": {
                "online": online,
                "url": self.url,
                "pid": health.get("pid") if online else None,
                "version": health.get("version") if online else None,
                "owner": owner,
                "tasks": tasks,
                "can_start": not online and not busy and child is None,
                "can_stop": owner == "launcher" and not busy,
                "can_restart": owner == "launcher" and not busy,
                "external": owner == "external",
            },
            "key": {
                "available": bool(key),
                "masked": mask_key(key),
            },
            "log": {
                "path": str(log_path.relative_to(ROOT).as_posix()),
                "exists": log_exists,
                "size": log_size,
            },
            "busy": busy,
            "phase": phase,
            "last_error": self.last_error,
            "server_time": time.time(),
        }

    def start(self) -> dict:
        return self._run("start", self._start)

    def stop(self) -> dict:
        return self._run("stop", self._stop)

    def restart(self) -> dict:
        return self._run("restart", self._restart)

    def _run(self, action: str, callback) -> dict:
        if not self.action_lock.acquire(blocking=False):
            return {"ok": False, "error": "Aksi lain sedang diproses. Tunggu sebentar."}
        self.action = action
        self.last_error = ""
        try:
            result = callback()
            if not result.get("ok"):
                self.last_error = result.get("error", "")
            return result
        except Exception as exc:  # keep the launcher alive on unexpected errors
            self.last_error = f"{type(exc).__name__}: {exc}"
            return {
                "ok": False,
                "error": self.last_error,
                "log": read_log_tail(limit=30),
            }
        finally:
            self.action = None
            self.action_lock.release()

    def _start(self) -> dict:
        health = self.health()
        if health:
            return {"ok": False, "error": "Server sudah berjalan."}
        if self.child is not None:
            return {
                "ok": False,
                "error": "Proses backend masih berjalan tetapi belum merespons. Hentikan dulu sebelum memulai lagi.",
            }
        if not APP_FILE.exists():
            return {"ok": False, "error": f"Backend tidak ditemukan: {APP_FILE}"}

        try:
            RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
            rotate_log()
            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            env.setdefault("SA_PORT", str(self.backend_port))
            # The child runs with cwd=backend, so a project-relative SA_DB_PATH
            # (as documented in .env.example) would resolve one level too deep.
            db_path = (env.get("SA_DB_PATH") or "").strip()
            if db_path and not os.path.isabs(db_path):
                resolved = (ROOT / db_path).resolve()
                try:
                    resolved.parent.mkdir(parents=True, exist_ok=True)
                except OSError:
                    pass
                env["SA_DB_PATH"] = str(resolved)
            popen_kwargs = {}
            if os.name == "nt":
                popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
            try:
                log_handle = LAUNCHER_LOG_FILE.open("ab", buffering=0)
            except OSError as exc:
                return {
                    "ok": False,
                    "error": "Log launcher terkunci oleh proses lain. Coba lagi sebentar lagi.",
                    "detail": str(exc),
                }
            try:
                self.child = subprocess.Popen(
                    [sys.executable, str(APP_FILE)],
                    cwd=str(BACKEND_DIR),
                    env=env,
                    stdin=subprocess.DEVNULL,
                    stdout=log_handle,
                    stderr=subprocess.STDOUT,
                    **popen_kwargs,
                )
            finally:
                log_handle.close()
        except OSError as exc:
            self.child = None
            return {"ok": False, "error": f"Gagal menyalakan backend: {exc}"}

        child = self.child
        deadline = time.time() + 20
        while time.time() < deadline:
            if child.poll() is not None:
                self.child = None
                return {
                    "ok": False,
                    "error": "Backend berhenti saat dinyalakan. Periksa log server.",
                    "log": read_log_tail(limit=40),
                }
            health = self.health()
            if health and health.get("pid") == child.pid:
                self.last_error = ""
                return {
                    "ok": True,
                    "message": "Server berjalan.",
                    "status": self.status(),
                }
            time.sleep(0.35)

        self._terminate_child()
        return {
            "ok": False,
            "error": "Server tidak merespons dalam 20 detik. Periksa log.",
            "log": read_log_tail(limit=40),
        }

    def _stop(self) -> dict:
        health = self.health()
        child = self.child
        if child is None:
            if health:
                return {
                    "ok": False,
                    "error": "Server ini dijalankan di luar launcher. Hentikan dari jendela asalnya.",
                }
            return {"ok": True, "message": "Server sudah berhenti."}
        if child.poll() is not None:
            self.child = None
            if health:
                return {
                    "ok": False,
                    "error": "Port masih dipakai proses lain. Server launcher sudah berhenti.",
                }
            return {"ok": True, "message": "Server sudah berhenti."}

        self._terminate_child()
        deadline = time.time() + 8
        while time.time() < deadline:
            if not self.health():
                return {"ok": True, "message": "Server dihentikan."}
            time.sleep(0.25)
        return {
            "ok": True,
            "message": "Proses backend dihentikan, tetapi port masih melayani proses lain.",
        }

    def _restart(self) -> dict:
        health = self.health()
        if health and not self._owns(health):
            return {
                "ok": False,
                "error": "Server ini dijalankan di luar launcher. Restart tidak diizinkan.",
            }
        if self.child is not None:
            stopped = self._stop()
            if not stopped.get("ok"):
                return stopped
        return self._start()

    def _terminate_child(self) -> None:
        child = self.child
        if child is None:
            return
        pid = child.pid
        try:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=3)
        finally:
            self.child = None
            try:
                if PID_FILE.exists() and PID_FILE.read_text(encoding="utf-8").strip() == str(pid):
                    PID_FILE.unlink()
            except OSError:
                pass


class LauncherHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class LauncherHandler(BaseHTTPRequestHandler):
    server_version = f"{APP_NAME}/{VERSION}"
    protocol_version = "HTTP/1.1"

    @property
    def state(self) -> LauncherState:
        return self.server.state  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args) -> None:
        # The status endpoint is polled every two seconds; keep the console clean.
        pass

    def _valid_host(self) -> bool:
        if allowed_host(self.headers.get("Host", ""), self.server.server_port):
            return True
        self._send_json(400, {"ok": False, "error": "Invalid Host header"})
        return False

    def _cookie_valid(self) -> bool:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return False
        morsel = cookie.get(SESSION_COOKIE)
        return bool(morsel and secrets.compare_digest(morsel.value, SESSION_TOKEN))

    def _authorized(self) -> bool:
        if not self._valid_host():
            return False
        if not self._cookie_valid():
            self._send_json(401, {"ok": False, "error": "Sesi launcher kedaluwarsa."})
            return False
        if self.headers.get("X-Launcher") != "1":
            self._send_json(403, {"ok": False, "error": "Header launcher tidak valid."})
            return False
        return True

    def _send(self, status: int, body: bytes, content_type: str, csp: str = API_CSP,
              extra_headers: tuple = ()) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", csp)
        for name, value in extra_headers:
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _serve_asset(self, path: str) -> None:
        target, content_type = ASSETS[path]
        try:
            body = target.read_bytes()
        except OSError:
            self._send_json(500, {"ok": False, "error": "Aset launcher tidak ditemukan."})
            return
        extra = ()
        if path in ("/", "/index.html") and not self._cookie_valid():
            cookie = (
                f"{SESSION_COOKIE}={SESSION_TOKEN}; HttpOnly; SameSite=Strict; Path=/"
            )
            extra = (("Set-Cookie", cookie),)
        csp = HTML_CSP if content_type.startswith("text/html") else "default-src 'none'"
        self._send(200, body, content_type, csp=csp, extra_headers=extra)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/healthz":
            if not self._valid_host():
                return
            self._send_json(200, {"app": APP_NAME, "version": VERSION})
            return
        if path == "/favicon.ico":
            if not self._valid_host():
                return
            self._send(204, b"", "image/x-icon")
            return
        if path in ASSETS:
            if not self._valid_host():
                return
            self._serve_asset(path)
            return
        if not path.startswith("/api/"):
            self._send_json(404, {"ok": False, "error": "Tidak ditemukan."})
            return
        if not self._authorized():
            return

        if path == "/api/status":
            self._send_json(200, self.state.status())
            return
        if path == "/api/key":
            key = read_key()
            if not key:
                self._send_json(404, {"ok": False, "error": "API key belum dibuat. Jalankan server dulu."})
                return
            self._send_json(200, {"ok": True, "key": key})
            return
        if path == "/api/log":
            try:
                requested = int(parse_qs(parsed.query).get("lines", ["120"])[0])
            except (TypeError, ValueError):
                requested = 120
            limit = max(1, min(300, requested))
            log_path = active_log_file()
            self._send_json(200, {
                "ok": True,
                "path": str(log_path.relative_to(ROOT).as_posix()),
                "exists": log_path.exists(),
                "lines": read_log_tail(limit=limit),
            })
            return
        self._send_json(404, {"ok": False, "error": "Endpoint tidak ditemukan."})

    def do_POST(self) -> None:
        if not self._authorized():
            return
        if not allowed_origin(self.headers.get("Origin"), self.server.server_port):
            self._send_json(403, {"ok": False, "error": "Origin tidak diizinkan."})
            return
        fetch_site = self.headers.get("Sec-Fetch-Site")
        if fetch_site and fetch_site not in ("same-origin", "none"):
            self._send_json(403, {"ok": False, "error": "Permintaan lintas situs ditolak."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            length = 0
        if length > 8192:
            self._send_json(413, {"ok": False, "error": "Body terlalu besar."})
            return
        if length:
            self.rfile.read(length)

        path = urlparse(self.path).path
        if path == "/api/quit":
            self._send_json(200, {"ok": True, "message": "Launcher ditutup."})
            threading.Timer(0.25, self.server.shutdown).start()
            return

        actions = {
            "/api/start": self.state.start,
            "/api/stop": self.state.stop,
            "/api/restart": self.state.restart,
        }
        action = actions.get(path)
        if action is None:
            self._send_json(404, {"ok": False, "error": "Endpoint tidak ditemukan."})
            return
        result = action()
        status = 200 if result.get("ok") else 409
        self._send_json(status, result)

    def do_OPTIONS(self) -> None:
        self._send_json(405, {"ok": False, "error": "Metode tidak diizinkan."})


def find_existing_launcher(start_port: int, attempts: int = 20) -> Optional[int]:
    for port in range(start_port, min(65535, start_port + attempts) + 1):
        payload = _get_json(f"http://{HOST}:{port}/healthz", timeout=0.25)
        if payload and payload.get("app") == APP_NAME:
            return port
    return None


def create_server(state: LauncherState, start_port: int, attempts: int = 20):
    last_error = None
    for port in range(start_port, min(65535, start_port + attempts) + 1):
        if port in UNSAFE_PORTS:
            continue
        try:
            httpd = LauncherHTTPServer((HOST, port), LauncherHandler)
        except OSError as exc:
            last_error = exc
            continue
        httpd.state = state  # type: ignore[attr-defined]
        state.launcher_port = port
        state.server = httpd
        return httpd
    raise RuntimeError(f"Tidak ada port launcher yang tersedia: {last_error}")


def open_browser(url: str) -> None:
    if os.environ.get("SA_LAUNCHER_NO_BROWSER") == "1":
        return
    try:
        webbrowser.open(url, new=2)
    except Exception:
        pass


def _fatal(message: str) -> None:
    try:
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        (RUNTIME_DIR / "launcher.log").write_text(message, encoding="utf-8")
    except OSError:
        pass
    if os.name == "nt":
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                0,
                "Launcher sunscraping gagal dijalankan.\n\n"
                + message.splitlines()[-1][:300]
                + "\n\nLihat backend/runtime/launcher.log.",
                "sunscraping",
                0x10,
            )
        except Exception:
            pass


def main() -> int:
    existing = find_existing_launcher(LAUNCHER_PORT)
    if existing:
        url = f"http://{HOST}:{existing}/"
        print(f"Launcher sudah berjalan: {url}")
        open_browser(url)
        return 0

    state = LauncherState(BACKEND_PORT, LAUNCHER_PORT)
    server = create_server(state, LAUNCHER_PORT)
    port = server.server_port
    state.launcher_port = port
    url = f"http://{HOST}:{port}/"
    print(f"sunscraping launcher: {url}")
    print(f"Backend target: {backend_base(BACKEND_PORT)}")
    print("Tutup jendela ini atau pakai tombol 'Keluar launcher' untuk menghentikan launcher.")
    threading.Timer(0.45, open_browser, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        _fatal(traceback.format_exc())
        raise
