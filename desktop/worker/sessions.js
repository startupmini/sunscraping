'use strict';
/**
 * Scraping surface for the desktop app.
 *
 * The content scripts from chrome-extension/content are reused verbatim: they
 * read the rendered page and answer through chrome.runtime.onMessage, so a shim
 * registers their listener and the worker calls it directly. They run in an
 * isolated world (the same isolation a content script gets) against a persistent
 * Electron partition, which is where the user's Instagram/TikTok login lives.
 *
 * The host boundary lives here too: a URL is checked against the allowlist
 * before any navigation, so this module is safe even if a caller forgets to.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BrowserWindow, session, shell } = require('electron');
const { allowedTarget, platformForHost } = require('./policy.js');

const EXTENSION_DIR = path.join(__dirname, '..', '..', 'chrome-extension');
const CONTENT_DIR = path.join(EXTENSION_DIR, 'content');
const PARTITION = 'persist:sunscraping';
const WORLD_ID = 999;
const SCRAPE_TIMEOUT_MS = 45000;
// A long-lived window on heavy SPAs leaks memory; recycling it is cheaper than
// watching RSS grow for hours.
const LOADS_PER_WINDOW = 120;
const CHANNEL_KEY = 'sunscraping.channel.v1';

const LOGIN_URLS = {
  instagram: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/',
};

/**
 * A content script shares the page's `window`, so anything we leave there is
 * visible to page JavaScript. The channel is therefore a single symbol-keyed
 * slot whose `invoke` is defined once, non-writable, and bound to the handler
 * that registered during injection — a page cannot swap in a fake scorer after
 * the fact. If a page has already claimed the slot, injection fails loudly
 * instead of trusting it.
 */
const SHIM = `(() => {
  const KEY = Symbol.for('${CHANNEL_KEY}');
  const existing = window[KEY];
  if (existing) {
    if (existing.__saShim === true) return;
    throw new Error('Kanal content script sudah dipakai skrip halaman; halaman tidak dipercaya.');
  }
  const handlers = [];
  const chromeObj = window.chrome || {};
  const runtime = chromeObj.runtime || {};
  runtime.onMessage = {
    addListener(fn) { if (typeof fn === 'function') handlers.push(fn); },
    removeListener(fn) {
      const index = handlers.indexOf(fn);
      if (index >= 0) handlers.splice(index, 1);
    },
  };
  chromeObj.runtime = runtime;
  try { window.chrome = chromeObj; } catch (error) {}
  const slot = { handlers };
  Object.defineProperty(slot, '__saShim', { value: true, writable: false, configurable: false, enumerable: false });
  Object.defineProperty(window, KEY, { value: slot, writable: false, configurable: false, enumerable: false });
})();`;

const BIND = `(() => {
  const KEY = Symbol.for('${CHANNEL_KEY}');
  const slot = window[KEY];
  if (!slot || slot.__saShim !== true) return;
  if (typeof slot.invoke === 'function') return;
  const handlers = Array.isArray(slot.handlers) ? slot.handlers : [];
  const handler = handlers.length ? handlers[handlers.length - 1] : null;
  try { delete slot.handlers; } catch (error) {}
  if (typeof handler !== 'function') return;
  Object.defineProperty(slot, 'invoke', {
    value: (message, timeoutMs) => new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value || null);
      };
      const timer = setTimeout(() => finish({ __error: 'timeout' }), Number(timeoutMs) || 45000);
      try {
        handler(message, {}, finish);
      } catch (error) {
        finish({ __error: String((error && error.message) || error) });
      }
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
})();`;

const CHANNEL_READY = `(() => {
  const slot = window[Symbol.for('${CHANNEL_KEY}')];
  return Boolean(slot && typeof slot.invoke === 'function');
})()`;

function readContent(name) {
  return fs.readFileSync(path.join(CONTENT_DIR, name), 'utf8');
}

function loadScrapers() {
  try {
    return {
      common: readContent('common.js'),
      instagram: readContent('ig-scraper.js'),
      tiktok: readContent('tk-scraper.js'),
    };
  } catch (error) {
    throw new Error(`Content script tidak ditemukan di ${CONTENT_DIR}: ${error.message}`);
  }
}

/** Electron's default UA advertises "Electron/…"; these sites read that. */
function desktopUserAgent() {
  const chrome = process.versions.chrome || '126.0.0.0';
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 `
    + `(KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

/**
 * @param {object} [options]
 * @param {(message: string) => void} [options.onLog]
 * @param {(url: string) => string} [options.resolvePage]  logical target URL →
 *   page actually loaded. The Electron harness uses it to serve a local fixture
 *   for a social URL; the app leaves it undefined.
 * @param {(url: string) => boolean} [options.isAllowedPage]  navigation guard;
 *   defaults to the same host allowlist the worker enforces.
 * @param {string} [options.partition]  session partition. The harness passes a
 *   non-persistent name so tests never touch the real login.
 */
function createSessions({ onLog, resolvePage, isAllowedPage, partition } = {}) {
  const scrapers = loadScrapers();
  const say = typeof onLog === 'function' ? onLog : () => {};
  const resolve = typeof resolvePage === 'function' ? resolvePage : (url) => url;
  const allowed = typeof isAllowedPage === 'function' ? isAllowedPage : allowedTarget;
  const partitionName = partition || PARTITION;
  let workerWindow = null;
  let loads = 0;

  const partitionSession = session.fromPartition(partitionName);
  partitionSession.setUserAgent(desktopUserAgent());
  partitionSession.setPermissionRequestHandler((contents, permission, callback) => callback(false));

  function runInPage(code) {
    return workerWindow.webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [{ code }]);
  }

  function createWorkerWindow() {
    workerWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      title: 'sunscraping worker',
      webPreferences: {
        partition: partitionName,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    loads = 0;
    workerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    workerWindow.webContents.on('will-navigate', (event, url) => {
      if (!allowed(url)) {
        say(`Navigasi keluar diblokir: ${url}`);
        event.preventDefault();
      }
    });
    // A crashed or wedged renderer used to be invisible: every later scrape
    // failed with an unrelated message. Drop the window so the next visit
    // starts from a clean one.
    workerWindow.webContents.on('render-process-gone', (event, details) => {
      say(`Renderer worker berhenti (${details.reason}); jendela akan dibuat ulang.`);
      if (workerWindow && !workerWindow.isDestroyed()) workerWindow.destroy();
      workerWindow = null;
    });
    workerWindow.on('unresponsive', () => {
      say('Jendela worker tidak merespons; memuat ulang halaman.');
      try {
        workerWindow.webContents.reload();
      } catch (error) {
        // The window is gone; the next call recreates it.
      }
    });
    workerWindow.on('closed', () => { workerWindow = null; });
    return workerWindow;
  }

  function ensureWorkerWindow() {
    if (workerWindow && !workerWindow.isDestroyed()) return workerWindow;
    return createWorkerWindow();
  }

  async function load(url) {
    if (!allowed(url)) throw new Error(`Navigasi ditolak: hanya host Instagram/TikTok (${url})`);

    let win = ensureWorkerWindow();
    if (loads >= LOADS_PER_WINDOW) {
      say(`Mendaur ulang jendela worker setelah ${loads} halaman.`);
      if (!win.isDestroyed()) win.destroy();
      workerWindow = null;
      win = ensureWorkerWindow();
    }
    loads += 1;

    try {
      await win.loadURL(resolve(url));
    } catch (error) {
      // A redirect can abort the first load; the document that landed is the
      // one we want to read, so this is not a failure on its own.
      if (!/ERR_ABORTED/i.test(String((error && error.message) || error))) throw error;
    }
    return win;
  }

  async function inject(platform) {
    const win = ensureWorkerWindow();
    if (await runInPage(CHANNEL_READY)) return;

    // One call, several sources: shim → common → scraper → bind runs without
    // page scripts getting a turn in between.
    await win.webContents.executeJavaScriptInIsolatedWorld(WORLD_ID, [
      { code: SHIM, url: `${CHANNEL_KEY}/shim.js` },
      { code: scrapers.common, url: 'common.js' },
      { code: scrapers[platform], url: `${platform}-scraper.js` },
      { code: BIND, url: `${CHANNEL_KEY}/bind.js` },
    ]);

    if (!(await runInPage(CHANNEL_READY))) {
      throw new Error('Content script tidak terpasang');
    }
  }

  function callScript(message, timeoutMs) {
    return `new Promise((resolve) => {
  const slot = window[Symbol.for('${CHANNEL_KEY}')];
  if (!slot || typeof slot.invoke !== 'function') {
    resolve({ __error: 'content script tidak terpasang' });
    return;
  }
  Promise.resolve(slot.invoke(${JSON.stringify(message)}, ${Number(timeoutMs)}))
    .then((value) => resolve(value || null), (error) => resolve({ __error: String((error && error.message) || error) }));
})`;
  }

  async function callHandler(platform, message) {
    const win = ensureWorkerWindow();
    await inject(platform);
    const result = await win.webContents.executeJavaScriptInIsolatedWorld(
      WORLD_ID,
      [{ code: callScript(message, SCRAPE_TIMEOUT_MS) }],
    );
    if (result && result.__error) throw new Error(result.__error);
    if (!result) throw new Error('Content script tidak menjawab');
    return result;
  }

  return {
    async scrapePost(task) {
      const platform = platformForHost(task.url);
      if (!platform) throw new Error('URL tidak diizinkan (hanya host Instagram/TikTok)');
      await load(task.url);
      return callHandler(platform, {
        action: 'scrapePost',
        linkObj: { url: task.url, username: task.username || null, tema: task.tema || null },
      });
    },

    async scrapeProfile(username, platform) {
      if (!username || !scrapers[platform]) return null;
      const handle = encodeURIComponent(username);
      const url = platform === 'instagram'
        ? `https://www.instagram.com/${handle}/`
        : `https://www.tiktok.com/@${handle}`;
      await load(url);
      const result = await callHandler(platform, { action: 'scrapeProfile', username });
      return result && result.status !== 'FAILED' ? result : null;
    },

    openLogin(platform) {
      const target = LOGIN_URLS[platform];
      if (!target) return;
      const win = new BrowserWindow({
        width: 1100,
        height: 820,
        title: `Login ${platform}`,
        webPreferences: {
          partition: partitionName,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      // A popup from a login page must not be able to push an arbitrary URL into
      // the user's default browser.
      win.webContents.setWindowOpenHandler(({ url }) => {
        if (allowedTarget(url)) shell.openExternal(url);
        else say(`Popup diblokir: ${url}`);
        return { action: 'deny' };
      });
      win.loadURL(target);
      return win;
    },

    dispose() {
      if (workerWindow && !workerWindow.isDestroyed()) workerWindow.destroy();
      workerWindow = null;
    },
  };
}

module.exports = { createSessions, platformOf: platformForHost };
