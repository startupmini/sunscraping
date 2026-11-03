'use strict';
/**
 * The desktop app keeps the existing Flask backend: it owns the SQLite schema,
 * the queue, the export and the dashboard. Electron only starts it, waits for
 * health, and reads the API key the backend writes on first run.
 *
 * Ownership is recorded in a file outside the repo (userData) so a backend left
 * behind by a crash can be recognised and shut down on the next quit, instead of
 * running forever on port 5000.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND_DIR = path.join(ROOT, 'backend');
const APP_PY = path.join(BACKEND_DIR, 'app.py');
const KEY_FILE = path.join(BACKEND_DIR, '.api_key');
const PID_FILE = path.join(BACKEND_DIR, 'server.pid');
const HEALTH_TIMEOUT_MS = 45000;

async function fetchHealth(base, timeoutMs = 1500) {
  const response = await fetch(`${base}/api/health`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function isHealthy(base, timeoutMs = 1500) {
  try {
    return (await fetchHealth(base, timeoutMs)) !== null;
  } catch (error) {
    return false;
  }
}

/**
 * @param {string} base
 * @param {number|object} [options]  timeout in ms (legacy call shape), or
 *   `{ timeoutMs, isDead }` where `isDead()` aborts the wait early — a missing
 *   Python binary should not cost a 45-second silent hang.
 */
async function waitForHealthy(base, options = {}) {
  const { timeoutMs, isDead } = typeof options === 'number'
    ? { timeoutMs: options }
    : { timeoutMs: HEALTH_TIMEOUT_MS, ...options };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (typeof isDead === 'function' && isDead()) return false;
    if (await isHealthy(base)) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** The backend creates this file on first start; read it once it exists. */
async function readApiKey({ retries = 40, delayMs = 250 } = {}) {
  const fromEnv = (process.env.SA_API_KEY || '').trim();
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const value = fs.readFileSync(KEY_FILE, 'utf8').trim();
      if (value) return value;
    } catch (error) {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return fromEnv || null;
}

function createBackend({ port, base, onLog, ownerFile } = {}) {
  const say = typeof onLog === 'function' ? onLog : () => {};
  let child = null;
  // PID of a backend started by an earlier run of this app (crash, force quit).
  // We have no ChildProcess handle for it, so it is only ever stopped after the
  // live backend confirms it is still that process.
  let adoptedPid = null;

  function readOwnerFile() {
    if (!ownerFile) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
      const pid = Number(raw && raw.pid);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch (error) {
      return null;
    }
  }

  function writeOwnerFile(pid) {
    if (!ownerFile) return;
    try {
      fs.mkdirSync(path.dirname(ownerFile), { recursive: true });
      fs.writeFileSync(ownerFile, JSON.stringify({
        pid,
        port,
        startedAt: new Date().toISOString(),
      }));
    } catch (error) {
      say(`Tidak dapat menulis penanda backend: ${error.message}`);
    }
  }

  function clearOwnerFile() {
    if (!ownerFile) return;
    try {
      fs.unlinkSync(ownerFile);
    } catch (error) {
      // Already gone.
    }
  }

  async function livePid() {
    try {
      const payload = await fetchHealth(base);
      const pid = Number(payload && payload.pid);
      return Number.isFinite(pid) && pid > 0 ? pid : null;
    } catch (error) {
      return null;
    }
  }

  function clearStalePidFile(pid) {
    try {
      const stored = fs.readFileSync(PID_FILE, 'utf8').trim();
      if (stored === String(pid)) fs.unlinkSync(PID_FILE);
    } catch (error) {
      // No PID file.
    }
  }

  async function stop() {
    const running = child;
    const adopted = adoptedPid;
    child = null;
    adoptedPid = null;

    if (running && running.exitCode === null) {
      // The handle knows its own process: no PID is ever signalled from a file,
      // so a reused PID cannot make us kill something unrelated.
      try {
        running.kill();
      } catch (error) {
        say(`Gagal menghentikan backend: ${error.message}`);
      }
      clearStalePidFile(running.pid);
      return;
    }

    if (!adopted) return;

    // Adopted backend: confirm it is still the process we recorded, then stop it.
    const pid = await livePid();
    if (pid !== adopted) {
      say(`Backend adopsi (PID ${adopted}) sudah tidak berjalan; tidak ada yang dihentikan.`);
      clearOwnerFile();
      return;
    }
    try {
      process.kill(adopted);
      say(`Backend adopsi (PID ${adopted}) dihentikan.`);
    } catch (error) {
      say(`Backend adopsi (PID ${adopted}) tidak dapat dihentikan: ${error.message}`);
    }
    clearStalePidFile(adopted);
    clearOwnerFile();
  }

  async function ensure() {
    if (await isHealthy(base)) {
      const pid = await livePid();
      const recorded = readOwnerFile();

      // Started by a previous run of this app: take ownership so quitting this
      // time actually closes it.
      if (pid && recorded && pid === recorded) {
        adoptedPid = pid;
        say(`Backend dari sesi sebelumnya masih berjalan (PID ${pid}); akan dihentikan saat keluar.`);
        return { owned: true, adopted: true, pid };
      }

      if (recorded) {
        say('Penanda backend lama tidak cocok dengan proses yang berjalan; penanda dihapus.');
        clearOwnerFile();
      }
      say('Backend sudah berjalan; memakai proses yang ada.');
      return { owned: false, adopted: false, pid };
    }

    const python = process.env.SA_PYTHON || 'python';
    say(`Menjalankan ${python} ${APP_PY} (port ${port})`);

    let spawnError = null;
    const thisChild = spawn(python, [APP_PY], {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        SA_PORT: String(port),
        PYTHONIOENCODING: 'utf-8',
        PYTHONUNBUFFERED: '1',
      },
      windowsHide: true,
    });
    child = thisChild;

    thisChild.on('error', (error) => {
      spawnError = error;
      say(`Gagal menjalankan Python: ${error.message}`);
    });
    thisChild.on('exit', (code, signal) => {
      // Do not keep a dead handle around: stop() must never act on it.
      if (child === thisChild) child = null;
      if (child === null) clearOwnerFile();
      say(`Backend berhenti (${signal || code}).`);
    });
    if (thisChild.stdout) thisChild.stdout.on('data', (chunk) => say(String(chunk).trimEnd()));
    if (thisChild.stderr) thisChild.stderr.on('data', (chunk) => say(String(chunk).trimEnd()));

    const ready = await waitForHealthy(base, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      isDead: () => spawnError !== null,
    });

    if (!ready) {
      await stop();
      if (spawnError) {
        throw new Error(
          `Python tidak dapat dijalankan (${spawnError.code || spawnError.message}). `
          + 'Pasang Python 3.10-3.12 lalu jalankan INSTALL_sunscraping.bat sekali.',
        );
      }
      throw new Error(
        'Backend tidak merespons. Pastikan Python 3.10-3.12 dan dependencies terpasang '
        + '(jalankan INSTALL_sunscraping.bat sekali), lalu coba lagi.',
      );
    }

    writeOwnerFile(thisChild.pid);
    return { owned: true, adopted: false, pid: thisChild.pid };
  }

  return { ensure, stop };
}

module.exports = { createBackend, isHealthy, readApiKey, waitForHealthy };
