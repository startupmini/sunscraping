'use strict';
/**
 * sunscraping desktop entry point.
 *
 * Order of operations matters: the Flask backend must answer /api/health and
 * have written backend/.api_key before the worker can talk to it, and the
 * persistent Electron partition is what carries the user's Instagram/TikTok
 * login, so nothing is scraped until the backend is ready.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, shell,
} = require('electron');

const backend = require('./worker/backend.js');
const { createApi } = require('./worker/api.js');
const { createSessions } = require('./worker/sessions.js');
const { createStorage, loadRateLimiter } = require('./worker/legacy.js');
const { createWorker } = require('./worker/core.js');

const PORT = Number(process.env.SA_PORT || 5000);
const BASE = `http://127.0.0.1:${PORT}`;
const ICON_FILE = path.join(__dirname, '..', 'chrome-extension', 'icons', 'icon48.png');
const LIMITER_FILE = path.join(__dirname, '..', 'chrome-extension', 'utils', 'rate-limiter.js');
const LOG_MAX_BYTES = 2 * 1024 * 1024;

let mainWindow = null;
let tray = null;
let server = null;
let sessions = null;
let worker = null;
let trayTimer = null;
let shuttingDown = false;
let logFile = null;

function log(message) {
  if (!message) return;
  const line = `[sunscraping] ${message}`;
  console.log(line);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch (error) {
    // A log file that cannot be written must not break the app.
  }
}

/** One file, bounded: this runs for hours and nobody rotates it by hand. */
function rotateLog(file) {
  try {
    if (fs.statSync(file).size > LOG_MAX_BYTES) fs.truncateSync(file, 0);
  } catch (error) {
    // First run.
  }
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body }).show();
  } catch (error) {
    log(`Notifikasi gagal: ${error.message}`);
  }
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'sunscraping',
    icon: ICON_FILE,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // The dashboard links to posts; those belong in the user's own browser, never
  // in a privileged Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL(BASE);
  return mainWindow;
}

function trayMenu() {
  const status = worker ? worker.getStatus() : { active: false, label: 'belum siap' };
  const items = [
    { label: 'Buka dashboard', click: () => createMainWindow() },
    { type: 'separator' },
    {
      label: status.active ? 'Hentikan worker' : 'Mulai worker',
      enabled: Boolean(worker),
      click: () => { toggleWorker().catch((error) => log(error.message)); },
    },
    { label: `Status: ${status.label}`, enabled: false },
  ];
  if (status.active && status.lastTaskId) {
    items.push({ label: `Task terakhir: #${status.lastTaskId}`, enabled: false });
  }
  if (status.lastError) {
    items.push({ label: `Terakhir: ${String(status.lastError).slice(0, 60)}`, enabled: false });
  }
  items.push(
    { type: 'separator' },
    { label: 'Login Instagram', click: () => sessions.openLogin('instagram') },
    { label: 'Login TikTok', click: () => sessions.openLogin('tiktok') },
    { type: 'separator' },
    { label: 'Keluar', click: () => app.quit() },
  );
  return Menu.buildFromTemplate(items);
}

function refreshTray() {
  if (!tray) return;
  const status = worker ? worker.getStatus() : null;
  tray.setContextMenu(trayMenu());
  const tooltip = status
    ? `sunscraping — ${status.label}${status.lastError ? ` (${status.lastError})` : ''}`
    : 'sunscraping';
  tray.setToolTip(tooltip.slice(0, 120));
}

/** Worker state changes arrive every few seconds; the menu does not need that. */
function refreshTraySoon() {
  if (trayTimer) return;
  trayTimer = setTimeout(() => {
    trayTimer = null;
    refreshTray();
  }, 250);
}

async function toggleWorker() {
  if (!worker) return;
  if (worker.getStatus().active) {
    worker.stop(null);
    log('Worker dihentikan dari tray.');
  } else {
    await worker.start();
    log('Worker dimulai dari tray.');
  }
  refreshTray();
}

async function boot() {
  app.setAppUserModelId('com.sunscraping.desktop');

  const userData = app.getPath('userData');
  logFile = path.join(userData, 'app.log');
  rotateLog(logFile);
  log('Memulai aplikasi desktop.');

  server = backend.createBackend({
    port: PORT,
    base: BASE,
    onLog: log,
    ownerFile: path.join(userData, 'backend-owner.json'),
  });
  await server.ensure();

  const apiKey = await backend.readApiKey();
  if (!apiKey) {
    throw new Error(`API key backend tidak ditemukan di ${path.join('backend', '.api_key')}.`);
  }

  const api = createApi({ base: BASE, key: apiKey });
  sessions = createSessions({ onLog: log });

  const storage = createStorage(path.join(userData, 'worker-state.json'));
  const limiter = loadRateLimiter(LIMITER_FILE, storage);
  await limiter.init();

  worker = createWorker({
    api,
    sessions,
    limiter,
    notify,
    log,
    onChange: refreshTraySoon,
  });

  createMainWindow();

  const icon = nativeImage.createFromPath(ICON_FILE);
  if (icon.isEmpty()) throw new Error(`Ikon tray tidak ditemukan: ${ICON_FILE}`);
  tray = new Tray(icon);
  tray.on('double-click', () => createMainWindow());
  refreshTray();

  // Unattended runs (the live-audit script, tests) may start the worker without
  // a tray click; the tray can still stop it.
  if (process.env.SA_AUTOSTART_WORKER === '1') {
    worker.start()
      .then(() => log('Worker dimulai otomatis (SA_AUTOSTART_WORKER=1).'))
      .catch((error) => log(`Worker gagal dimulai otomatis: ${error.message}`));
  }

  log(`Siap. Dashboard: ${BASE}`);
}

async function shutdown() {
  try {
    if (worker) worker.stop(null);
  } catch (error) {
    log(`Worker tidak berhenti bersih: ${error.message}`);
  }
  try {
    if (sessions) sessions.dispose();
  } catch (error) {
    log(`Jendela worker tidak tertutup bersih: ${error.message}`);
  }
  try {
    if (server) await server.stop();
  } catch (error) {
    log(`Backend tidak berhenti bersih: ${error.message}`);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => createMainWindow());

  // A tray app: closing the dashboard leaves the worker free to finish a cycle.
  app.on('window-all-closed', () => {});
  app.on('activate', () => createMainWindow());

  // Anything Electron creates gets the hardening defaults, so a future window
  // cannot forget them.
  app.on('web-contents-created', (event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (webviewEvent) => webviewEvent.preventDefault());
  });

  app.on('before-quit', (event) => {
    if (shuttingDown) return;
    // Stopping the adopted backend is asynchronous, so quit waits for it once.
    event.preventDefault();
    shuttingDown = true;
    shutdown()
      .catch((error) => log(`Shutdown gagal: ${error.message}`))
      .finally(() => app.exit(0));
  });

  app.whenReady()
    .then(boot)
    .catch(async (error) => {
      log(`Gagal dimulai: ${error.message}`);
      try {
        if (server) await server.stop();
      } catch (stopError) {
        log(`Backend tidak berhenti setelah gagal start: ${stopError.message}`);
      }
      dialog.showErrorBox(
        'sunscraping gagal dimulai',
        `${error.message}\n\nPastikan Python 3.10-3.12 dan dependencies terpasang `
        + '(jalankan INSTALL_sunscraping.bat sekali), lalu coba lagi.',
      );
      app.exit(1);
    });
}
