importScripts('utils/rate-limiter.js');

const DEFAULT_API_BASE = 'http://localhost:5000';
const POLL_ALARM = 'social-auditor-poll';
const SCRAPE_TIMEOUT_MS = 60000;
const FOLLOWER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WORKER_TAB_KEY = 'sa_workerTabId';
const BLOCK_PAUSE_MS = {
  THROTTLED: 10 * 60 * 1000,
  AUTH: 20 * 60 * 1000,
};
const ALLOWED_HOSTS = new Set([
  'instagram.com', 'www.instagram.com', 'm.instagram.com',
  'tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com',
]);

let apiBase = DEFAULT_API_BASE;
let apiKey = '';
let isWorkerActive = false;
let isPolling = false;
let pollTimerId = null;
let lastPlatformProcessed = null;
let consecutiveFailures = 0;
let followerMemCache = new Map();
let followerAttempts = new Set();
let workerTabId = null;
let pendingTabRelease = false;

const ready = RateLimiter.init()
  .then(loadConfiguration)
  .then(restoreWorkerState)
  .catch(error => console.warn('[Worker] Initialisation failed:', error));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    await ready;

    if (request.action === 'toggleWorker') {
      sendResponse(await setWorkerActive(Boolean(request.active)));
      return;
    }

    if (request.action === 'getWorkerStatus') {
      const data = await chrome.storage.local.get(['sa_last_error']);
      sendResponse({
        active: isWorkerActive,
        configured: Boolean(apiKey),
        error: data.sa_last_error || null,
        apiBase,
        rate: RateLimiter.getStatus(),
        queue: apiKey ? await fetchPendingCount() : null,
      });
    }
  })();

  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.sa_api_base) {
    apiBase = normalizeBase(changes.sa_api_base.newValue);
  }
  if (changes.sa_api_key) {
    apiKey = String(changes.sa_api_key.newValue || '').trim();
    if (!apiKey && isWorkerActive) {
      setWorkerActive(false);
      setLastError('API key dihapus. Worker dihentikan.');
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollForTasks();
  }
});

chrome.runtime.onStartup.addListener(() => {
  ready.then(restoreWorkerState);
});

chrome.runtime.onInstalled.addListener(() => {
  ready.then(restoreWorkerState);
});

function normalizeBase(value) {
  const base = String(value || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(base) ? base : DEFAULT_API_BASE;
}

async function loadConfiguration() {
  const data = await chrome.storage.local.get(['sa_api_base', 'sa_api_key', WORKER_TAB_KEY]);
  apiBase = normalizeBase(data.sa_api_base);
  apiKey = String(data.sa_api_key || '').trim();
  const storedTabId = Number(data[WORKER_TAB_KEY]);
  if (Number.isFinite(storedTabId) && storedTabId > 0) {
    workerTabId = storedTabId;
  }
}

async function restoreWorkerState() {
  try {
    const data = await chrome.storage.local.get([
      'sa_workerActive', 'sa_lastPlatformProcessed', 'sa_consecutiveFailures',
    ]);
    isWorkerActive = Boolean(data.sa_workerActive);
    lastPlatformProcessed = data.sa_lastPlatformProcessed || null;
    consecutiveFailures = Number(data.sa_consecutiveFailures) || 0;

    if (isWorkerActive && !apiKey) {
      await setWorkerActive(false);
      await setLastError('API key belum diatur. Buka Settings ekstensi.');
      return;
    }
    if (isWorkerActive) scheduleNextPoll(1000);
  } catch (error) {
    console.warn('[Worker] Could not restore worker state:', error);
  }
}

function notify(title, message) {
  try {
    chrome.notifications.create('', {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message,
      priority: 1,
    });
  } catch (error) {}
}

async function setLastError(message) {
  try {
    await chrome.storage.local.set({ sa_last_error: message });
  } catch (error) {}
}

async function clearLastError() {
  try {
    await chrome.storage.local.remove('sa_last_error');
  } catch (error) {}
}

async function setWorkerActive(active) {
  if (active && !apiKey) {
    isWorkerActive = false;
    await chrome.storage.local.set({ sa_workerActive: false });
    const message = 'API key belum diatur. Buka Settings ekstensi lalu tempel API key dari Control Panel.';
    await setLastError(message);
    return { active: false, error: message };
  }

  isWorkerActive = active;
  await chrome.storage.local.set({ sa_workerActive: isWorkerActive });

  if (isWorkerActive) {
    await clearLastError();
    scheduleNextPoll(500);
    notify('Worker aktif', 'Audit akan berjalan dengan jeda aman. Biarkan Chrome tetap terbuka.');
  } else {
    if (pollTimerId) {
      clearTimeout(pollTimerId);
      pollTimerId = null;
    }
    chrome.alarms.clear(POLL_ALARM);
    if (isPolling) {
      pendingTabRelease = true;
    } else {
      releaseWorkerTab();
    }
  }

  return { active: isWorkerActive };
}

function scheduleNextPoll(delayMs) {
  if (!isWorkerActive) return;

  if (pollTimerId) {
    clearTimeout(pollTimerId);
    pollTimerId = null;
  }

  pollTimerId = setTimeout(() => {
    pollTimerId = null;
    pollForTasks();
  }, Math.max(500, delayMs));

  // MV3 service workers are suspended after ~30s idle, so a setTimeout alone
  // is not reliable. Keep a one-shot alarm as the recovery path.
  chrome.alarms.clear(POLL_ALARM, () => {
    chrome.alarms.create(POLL_ALARM, { when: Date.now() + Math.max(30000, delayMs + 5000) });
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cacheKey(username, platform) {
  return `${platform || 'unknown'}:${String(username || '').toLowerCase()}`;
}

function isAllowedTarget(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username || url.password) return false;
    return ALLOWED_HOSTS.has(url.hostname.toLowerCase());
  } catch (error) {
    return false;
  }
}

function classifyError(error) {
  const message = error && error.message ? error.message : String(error || '');
  if (/login|auth|session|unauthorized/i.test(message)) return 'AUTH';
  if (/private|not available|tidak tersedia|deleted/i.test(message)) return 'PERMANENT';
  if (/timeout|network|fetch|tidak dapat/i.test(message)) return 'TRANSIENT';
  return 'TRANSIENT';
}

async function apiRequest(path, options = {}) {
  if (!apiKey) throw new Error('API key belum diatur. Buka Settings ekstensi.');
  const headers = Object.assign({}, options.headers || {}, { 'X-API-Key': apiKey });
  const response = await fetch(apiBase + path, Object.assign({}, options, { headers }));
  if (response.status === 401 || response.status === 403) {
    throw new Error('API key ditolak backend. Periksa Settings ekstensi.');
  }
  return response;
}

async function fetchNextTask() {
  const preferPlatform = lastPlatformProcessed === 'tiktok' ? 'instagram' : 'tiktok';
  const response = await apiRequest(`/api/task/next?prefer=${preferPlatform}`);
  if (!response.ok) throw new Error(`Backend /task/next gagal (${response.status})`);
  return response.json();
}

async function fetchPendingCount() {
  try {
    const response = await apiRequest('/api/stats');
    if (!response.ok) return 0;
    const stats = await response.json();
    return (stats.PENDING || 0) + (stats.RUNNING || 0);
  } catch (error) {
    return 0;
  }
}

async function reportResult(taskId, result) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await apiRequest('/api/task/result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, result }),
      });
      if (response.ok) return true;
      lastError = new Error(`Backend /task/result gagal (${response.status})`);
      if (response.status < 500) break;
    } catch (error) {
      lastError = error;
      if (error.message.startsWith('API key')) break;
    }
    await delay(1000);
  }
  throw lastError || new Error('Gagal mengirim hasil');
}

async function getWorkerTab() {
  if (workerTabId) {
    try {
      const existing = await chrome.tabs.get(workerTabId);
      if (existing && existing.id) return existing;
    } catch (error) {
      workerTabId = null;
    }
  }

  if (!workerTabId) {
    try {
      const data = await chrome.storage.local.get(WORKER_TAB_KEY);
      const storedId = Number(data[WORKER_TAB_KEY]);
      if (Number.isFinite(storedId) && storedId > 0) {
        const stored = await chrome.tabs.get(storedId);
        if (stored && stored.id) {
          workerTabId = stored.id;
          return stored;
        }
      }
    } catch (error) {}
  }

  const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
  workerTabId = tab.id;
  try {
    await chrome.storage.local.set({ [WORKER_TAB_KEY]: tab.id });
  } catch (error) {}
  return tab;
}

async function releaseWorkerTab() {
  pendingTabRelease = false;
  const tabId = workerTabId;
  workerTabId = null;
  try {
    await chrome.storage.local.remove(WORKER_TAB_KEY);
  } catch (error) {}
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {}
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function navigateWorkerTab(tabId, url, timeoutMs = 20000) {
  const loaded = waitForTabComplete(tabId, timeoutMs);
  try {
    const current = await chrome.tabs.get(tabId);
    if (current && current.url === url) {
      await chrome.tabs.reload(tabId);
    } else {
      await chrome.tabs.update(tabId, { url });
    }
  } catch (error) {
    return false;
  }
  await loaded;
  return true;
}

async function pollForTasks() {
  await ready;
  if (!isWorkerActive || isPolling) return;

  isPolling = true;

  try {
    if (!RateLimiter.checkDailyLimit()) {
      const message = `Batas harian ${RateLimiter.DAILY_LIMIT} task tercapai. Worker berhenti sampai besok.`;
      await setLastError(message);
      notify('Batas harian tercapai', message);
      await setWorkerActive(false);
      return;
    }

    if (RateLimiter.needsSessionBreak()) {
      const breakDuration = RateLimiter.getSessionBreakDuration();
      const breakMinutes = Math.round(breakDuration / 60000);
      console.log(`[ANTI-BAN] Session break: resting ${breakMinutes} minutes after ${RateLimiter.sessionTaskCount} tasks.`);
      RateLimiter.resetSessionBreak();
      notify('Istirahat sesi', `Worker berhenti sementara ${breakMinutes} menit agar pola akses tetap wajar.`);
      scheduleNextPoll(breakDuration);
      return;
    }

    const pendingCount = await fetchPendingCount();
    RateLimiter.autoSelectMode(pendingCount);

    const data = await fetchNextTask();
    if (!data || !data.hasTask || !data.task) {
      scheduleNextPoll(5000);
      return;
    }

    const task = data.task;

    if (RateLimiter.isWarmingUp()) {
      console.log(`[ANTI-BAN] Warm-up phase: task ${RateLimiter.totalTasksThisSession + 1}/5 (${RateLimiter.getWarmupMultiplier()}x slower)`);
    }

    console.log(`[Worker] Task #${RateLimiter.dailyTaskCount + 1}/${RateLimiter.DAILY_LIMIT} | Session: ${RateLimiter.sessionTaskCount + 1}/${RateLimiter.sessionBreakThreshold} | Mode: ${RateLimiter.currentMode} | Fatigue: ${RateLimiter.getFatigueMultiplier().toFixed(1)}x`);

    const result = await processTask(task);

    lastPlatformProcessed = task.platform;
    chrome.storage.local.set({ sa_lastPlatformProcessed: lastPlatformProcessed });

    const errorCode = String(result.errorCode || '').toUpperCase();
    const isBlocked = result.status === 'FAILED' && (errorCode === 'THROTTLED' || errorCode === 'AUTH');

    if (result.status === 'FAILED') {
      RateLimiter.reportError();
      if (isBlocked) {
        consecutiveFailures++;
        console.warn(`[CIRCUIT BREAKER] Blocked response count: ${consecutiveFailures} (${errorCode})`);
      } else {
        consecutiveFailures = 0;
      }
    } else {
      consecutiveFailures = 0;
      RateLimiter.reportSuccess();
    }
    await chrome.storage.local.set({ sa_consecutiveFailures: consecutiveFailures });

    try {
      await reportResult(task.id, result);
    } catch (error) {
      console.error('[Worker] Could not report result:', error);
      await setLastError(error.message || 'Gagal mengirim hasil ke backend.');
    }

    if (isBlocked) {
      if (consecutiveFailures >= 3) {
        const message = errorCode === 'AUTH'
          ? 'Sesi login Instagram/TikTok berakhir 3x berturut-turut. Login manual lalu jalankan worker lagi.'
          : 'Instagram/TikTok membatasi akses 3x berturut-turut. Worker dihentikan untuk keamanan.';
        await setWorkerActive(false);
        await setLastError(message);
        notify('Worker dihentikan', message);
        return;
      }

      const pauseMs = BLOCK_PAUSE_MS[errorCode] || BLOCK_PAUSE_MS.THROTTLED;
      const pauseMinutes = Math.round(pauseMs / 60000);
      const message = errorCode === 'AUTH'
        ? `Sesi login diperlukan. Worker dijeda ${pauseMinutes} menit; login manual di Chrome lalu biarkan berjalan.`
        : `Akses dibatasi platform. Worker dijeda ${pauseMinutes} menit lalu lanjut otomatis.`;
      await setLastError(message);
      notify('Worker dijeda sementara', message);
      scheduleNextPoll(pauseMs);
      return;
    }

    if (result.status === 'FAILED' && consecutiveFailures === 0) {
      await clearLastError();
    }

    const nextDelay = RateLimiter.getDelay();
    const estimate = RateLimiter.estimateTime(Math.max(0, pendingCount - 1));
    console.log(`[Worker] Next in ${Math.round(nextDelay / 1000)}s | Remaining: ~${estimate.display} (${estimate.breaksEstimated} breaks)`);
    scheduleNextPoll(nextDelay);
  } catch (error) {
    console.error('[Worker] Poll failed:', error);
    let message = error && error.message ? error.message : 'Worker error';
    if (error instanceof TypeError) {
      message = 'Backend tidak dapat dihubungi. Pastikan server berjalan.';
    }
    await setLastError(message);
    if (message.startsWith('API key')) {
      await setWorkerActive(false);
      return;
    }
    scheduleNextPoll(15000);
  } finally {
    isPolling = false;
    if (!isWorkerActive || pendingTabRelease) {
      releaseWorkerTab();
    }
  }
}

async function processTask(task) {
  if (!isAllowedTarget(task.url)) {
    return {
      status: 'FAILED',
      platform: task.platform,
      username: task.username || null,
      tema: task.tema || null,
      error: 'URL tidak diizinkan (hanya host Instagram/TikTok)',
      errorCode: 'PERMANENT',
    };
  }

  try {
    const tab = await getWorkerTab();
    const navigated = await navigateWorkerTab(tab.id, task.url, 20000);
    if (!navigated) {
      throw new Error('Tidak dapat membuka halaman target');
    }
    await delay(task.platform === 'tiktok' ? 500 : 250);
    await delay(RateLimiter.getDwellTime());

    const result = await requestScrape(tab.id, task);
    result.tema = task.tema || null;
    if (!result.username && task.username) result.username = task.username;

    await enrichFollowerCount(result, task, tab.id);
    return result;
  } catch (error) {
    return {
      status: 'FAILED',
      platform: task.platform,
      username: task.username || null,
      tema: task.tema || null,
      error: error.message,
      errorCode: classifyError(error),
    };
  }
}

function requestScrape(tabId, task) {
  return new Promise(resolve => {
    let settled = false;
    let attempts = 0;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({
        status: 'FAILED',
        platform: task.platform,
        error: 'Timeout - halaman terlalu lambat',
        errorCode: 'TRANSIENT',
      });
    }, SCRAPE_TIMEOUT_MS);

    const send = () => {
      chrome.tabs.sendMessage(tabId, { action: 'scrapePost', linkObj: task }, response => {
        if (settled) return;
        const lastError = chrome.runtime.lastError;
        const message = lastError && lastError.message ? lastError.message : '';
        if (message && /Receiving end does not exist|Could not establish connection/i.test(message) && attempts < 2) {
          attempts++;
          setTimeout(send, 900);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(response || {
          status: 'FAILED',
          platform: task.platform,
          error: message || 'Tidak dapat menghubungi content script',
          errorCode: message ? classifyError(new Error(message)) : 'TRANSIENT',
        });
      });
    };

    send();
  });
}

async function enrichFollowerCount(result, task, tabId) {
  const platform = result.platform || task.platform;

  if (result.followerCount !== null && result.followerCount !== undefined) {
    if (result.username) {
      followerMemCache.set(cacheKey(result.username, platform), {
        value: result.followerCount,
        ts: Date.now(),
      });
    }
    return;
  }

  if (task.cachedFollowerCount !== null && task.cachedFollowerCount !== undefined) {
    result.followerCount = task.cachedFollowerCount;
    return;
  }

  if (!result.username || result.status === 'FAILED') return;

  const key = cacheKey(result.username, platform);
  const cached = followerMemCache.get(key);
  if (cached && Date.now() - cached.ts < FOLLOWER_CACHE_TTL_MS) {
    result.followerCount = cached.value;
    return;
  }

  if (followerAttempts.has(key)) return;
  followerAttempts.add(key);

  try {
    const followerCount = await fetchFollowerCount(result.username, platform, tabId);
    if (followerCount !== null && followerCount !== undefined) {
      result.followerCount = followerCount;
      followerMemCache.set(key, { value: followerCount, ts: Date.now() });
    }
  } catch (error) {
    console.warn('[Worker] Follower lookup failed:', error);
  }
}

async function scrapeProfileInTab(tabId) {
  await delay(600);
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, 12000);

    chrome.tabs.sendMessage(tabId, { action: 'scrapeProfile' }, response => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response ? response.followerCount : null);
    });
  });
}

async function fetchFollowerCount(username, platform, reuseTabId = null) {
  if (!username || !platform) return null;

  const encoded = encodeURIComponent(username);
  const url = platform === 'instagram'
    ? `https://www.instagram.com/${encoded}/`
    : `https://www.tiktok.com/@${encoded}`;

  await RateLimiter.recordAuxiliaryVisit();
  await delay(1200 + Math.floor(Math.random() * 1800));

  if (reuseTabId) {
    try {
      await navigateWorkerTab(reuseTabId, url, 20000);
      return await scrapeProfileInTab(reuseTabId);
    } catch (error) {
      return null;
    }
  }

  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabComplete(tab.id, 15000);
    return await scrapeProfileInTab(tab.id);
  } catch (error) {
    return null;
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (error) {}
    }
  }
}
