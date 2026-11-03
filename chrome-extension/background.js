importScripts('config.js', 'utils/rate-limiter.js', 'utils/task-cache.js');

const DEFAULT_API_BASE = SA_CONFIG.apiBase;
const POLL_ALARM = 'sunscraping-poll';
const SCRAPE_TIMEOUT_MS = 60000;
// A tab can report "complete" before the content script is ready. Two retries
// 900ms apart were not enough: 9 TikTok tasks died on "Receiving end does not
// exist" and burned all their backend retries while the tab was still booting.
const CONTENT_SCRIPT_ATTEMPTS = 5;
const CONTENT_SCRIPT_RETRY_MS = 1200;
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
let currentCycleId = null;
// Accounts already visited in this cycle: the harvest is once per account, and
// an MV3 restart must not spend a second visit on the same one.
let harvestedAccounts = new Set();

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
  try {
    const url = new URL(base);
    const loopback = url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '::1'
      || url.hostname === '[::1]';
    // Same rule the options page enforces before saving: the API key only ever
    // travels to this machine, even if storage was edited by other means.
    if (!loopback || url.username || url.password) return DEFAULT_API_BASE;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_API_BASE;
    return base;
  } catch (error) {
    return DEFAULT_API_BASE;
  }
}

async function loadConfiguration() {
  const data = await chrome.storage.local.get([
    'sa_api_base', 'sa_api_key', WORKER_TAB_KEY, 'sa_harvestedAccounts', 'sa_cycleId',
  ]);
  apiBase = normalizeBase(data.sa_api_base);
  apiKey = String(data.sa_api_key || '').trim();
  const storedTabId = Number(data[WORKER_TAB_KEY]);
  if (Number.isFinite(storedTabId) && storedTabId > 0) {
    workerTabId = storedTabId;
  }
  currentCycleId = data.sa_cycleId ? String(data.sa_cycleId) : null;
  if (data.sa_harvestedAccounts && data.sa_harvestedAccounts.cycle === currentCycleId) {
    harvestedAccounts = new Set(data.sa_harvestedAccounts.keys || []);
  }
}

function persistHarvestedAccounts() {
  const keys = Array.from(harvestedAccounts).slice(-1000);
  return chrome.storage.local.set({
    sa_harvestedAccounts: { cycle: currentCycleId, keys },
    sa_cycleId: currentCycleId,
  }).catch(() => {});
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
    await RateLimiter.startSession();
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
  // Without this branch the 10-minute protective pause never fired: a throttle
  // reply fell through to TRANSIENT and the worker kept visiting.
  if (/too many requests|rate ?limit|throttl|429|try again later|coba lagi nanti|temporarily blocked/i.test(message)) return 'THROTTLED';
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
      // 404 means the task is already settled (a late or resent report). The
      // backend appends one snapshot per report, so retrying would record a
      // visit that never happened.
      if (response.status === 404) {
        console.warn(`[Worker] Hasil ditolak: task ${taskId} sudah selesai`);
        return true;
      }
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
    if (!(await RateLimiter.hasVisitBudget())) {
      const message = `Budget ${RateLimiter.VISIT_BUDGET} kunjungan untuk siklus ini habis `
        + `(${RateLimiter.cycleVisits} terpakai). Worker berhenti; jalankan lagi untuk siklus berikutnya.`;
      await setLastError(message);
      notify('Budget kunjungan habis', message);
      await setWorkerActive(false);
      return;
    }

    if (RateLimiter.needsSessionBreak()) {
      const breakDuration = RateLimiter.getSessionBreakDuration();
      const breakMinutes = Math.round(breakDuration / 60000);
      console.log(`[ANTI-BAN] Session break: resting ${breakMinutes} minutes after ${RateLimiter.sessionTaskCount} tasks.`);
      await RateLimiter.resetSessionBreak();
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

    // A cycle is one run: its accounts plus their posts. Switching runs refills
    // the budget; a task of the current cycle spends what is left of it.
    const cycleId = task.runId ? `${task.auditId || 0}:${task.runId}` : null;
    if (await RateLimiter.beginCycle(cycleId)) {
      currentCycleId = cycleId;
      harvestedAccounts = new Set();
      // A failed profile lookup is remembered for this cycle only; carrying that
      // guard for the lifetime of the worker left the account without a follower
      // count until Chrome restarted the service worker.
      followerAttempts = new Set();
      await persistHarvestedAccounts();
    } else {
      currentCycleId = RateLimiter.cycleId;
    }

    if (!(await RateLimiter.hasVisitBudget())) {
      const message = `Budget ${RateLimiter.VISIT_BUDGET} kunjungan siklus ini habis. `
        + 'Tugas yang baru diambil akan kembali ke antrean, lalu jalankan worker lagi.';
      await setLastError(message);
      notify('Budget kunjungan habis', message);
      await setWorkerActive(false);
      return;
    }

    if (RateLimiter.isWarmingUp()) {
      console.log(`[ANTI-BAN] Warm-up phase: task ${RateLimiter.totalTasksThisSession + 1}/5 (${RateLimiter.getWarmupMultiplier()}x slower)`);
    }

    console.log(`[Worker] Kunjungan #${RateLimiter.cycleVisits + 1}/${RateLimiter.VISIT_BUDGET} siklus ${RateLimiter.cycleId || '-'} (hari ini ${RateLimiter.dailyVisits}/${RateLimiter.DAILY_VISIT_RAIL}) | Session: ${RateLimiter.sessionTaskCount + 1}/${RateLimiter.sessionBreakThreshold} | Mode: ${RateLimiter.currentMode} | Fatigue: ${RateLimiter.getFatigueMultiplier().toFixed(1)}x`);

    const result = await processTask(task);

    lastPlatformProcessed = task.platform;
    chrome.storage.local.set({ sa_lastPlatformProcessed: lastPlatformProcessed });

    const errorCode = String(result.errorCode || '').toUpperCase();
    const isBlocked = result.status === 'FAILED' && (errorCode === 'THROTTLED' || errorCode === 'AUTH');
    // A cache hit loaded no page, so it is not a visit: charging it would make
    // the budget run out on work the platform never saw.
    const fromCache = result.source === 'profile-visit';

    if (fromCache) {
      consecutiveFailures = 0;
    } else if (result.status === 'FAILED') {
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

    if (fromCache) {
      // Nothing was loaded, so the human-like pause would only slow the queue.
      console.log(`[Worker] Next immediately (cache hit) | Remaining: ${Math.max(0, pendingCount - 1)}`);
      scheduleNextPoll(400);
      return;
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
    // A profile task exists so the account can be measured without waiting for
    // one of its posts to happen to carry a handle.
    if (task.kind === 'PROFILE') {
      const profile = await harvestProfile(task.username, task.platform);
      if (!profile) {
        return {
          status: 'FAILED',
          kind: 'PROFILE',
          platform: task.platform,
          username: task.username,
          error: 'Kunjungan profil tidak menghasilkan data',
          errorCode: 'TRANSIENT',
        };
      }
      await reportProfile(profile, task.username, task.platform);
      return {
        status: profile.status === 'FAILED' ? 'FAILED' : 'OK',
        kind: 'PROFILE',
        platform: task.platform,
        username: task.username,
        errorCode: profile.errorCode || null,
      };
    }

    // The account visit already measured this post: answer without loading it.
    const cached = TaskCache.resultFromTask(task);
    if (cached) {
      cached.tema = task.tema || null;
      console.log(`[Worker] Task #${task.id} answered from the profile visit (no navigation)`);
      return cached;
    }

    // Otherwise visit the account once per cycle. That single load yields the
    // fingerprint, the follower count and the last posts, so the post we are
    // about to check may already be covered.
    const harvested = await ensureAccountHarvested(task);
    if (harvested && harvested.match) {
      harvested.match.tema = task.tema || null;
      console.log(`[Worker] Task #${task.id} covered by the account visit it just made`);
      return harvested.match;
    }

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
        if (message && /Receiving end does not exist|Could not establish connection/i.test(message) && attempts < CONTENT_SCRIPT_ATTEMPTS) {
          attempts++;
          setTimeout(send, CONTENT_SCRIPT_RETRY_MS * attempts);
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
    const profile = await harvestProfile(result.username, platform, tabId);
    if (!profile) return;

    await reportProfile(profile, result.username, platform);
    if (profile.followerCount !== null && profile.followerCount !== undefined) {
      result.followerCount = profile.followerCount;
      followerMemCache.set(key, { value: profile.followerCount, ts: Date.now() });
    }
  } catch (error) {
    console.warn('[Worker] Profile lookup failed:', error);
  }
}

/**
 * Store what the profile visit found: account fingerprint plus its recent posts.
 * A failure here must not fail the post task that triggered the visit.
 */
async function reportProfile(profile, fallbackUsername, fallbackPlatform) {
  const payload = {
    ...profile,
    platform: profile.platform || fallbackPlatform,
    username: profile.username || fallbackUsername,
  };
  if (!payload.username || !payload.platform) return;

  try {
    await apiRequest('/api/account/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.warn('[Worker] Could not store profile:', error);
  }
}

/**
 * Visit the account once per cycle when the backend has no fresh row for it.
 * That one load returns the fingerprint, the follower count and the last posts,
 * so the post we are about to check may already be covered by it.
 */
async function ensureAccountHarvested(task) {
  const platform = task.platform;
  const username = task.username;
  if (!platform || !username) return null;

  const key = cacheKey(username, platform);
  if (!TaskCache.shouldHarvestAccount(task, harvestedAccounts)) return null;

  harvestedAccounts.add(key);
  await persistHarvestedAccounts();

  let profile = null;
  try {
    profile = await harvestProfile(username, platform);
  } catch (error) {
    console.warn('[Worker] Account harvest failed:', error);
    return null;
  }
  if (!profile) return null;

  await reportProfile(profile, username, platform);
  if (profile.followerCount !== null && profile.followerCount !== undefined) {
    followerMemCache.set(key, { value: profile.followerCount, ts: Date.now() });
    // The per-post follower lookup would otherwise visit the same page again.
    followerAttempts.add(key);
  }
  return { profile, match: TaskCache.fromHarvest(profile, task) };
}

async function scrapeProfileInTab(tabId, username) {
  await delay(600);
  return new Promise(resolve => {
    let settled = false;
    let attempts = 0;
    // The scrape now also waits for the same-origin post list of the profile.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, 20000);

    const send = () => {
      chrome.tabs.sendMessage(tabId, { action: 'scrapeProfile', username }, response => {
        if (settled) return;
        const lastError = chrome.runtime.lastError;
        const message = lastError && lastError.message ? lastError.message : '';
        // A missing receiver means the content script has not finished loading,
        // not that the page is wrong: resend into the same tab rather than pay
        // for another navigation.
        if (message && /Receiving end does not exist|Could not establish connection/i.test(message) && attempts < CONTENT_SCRIPT_ATTEMPTS) {
          attempts++;
          setTimeout(send, CONTENT_SCRIPT_RETRY_MS * attempts);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(response || null);
      });
    };

    send();
  });
}

async function harvestProfile(username, platform, reuseTabId = null) {
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
      return await scrapeProfileInTab(reuseTabId, username);
    } catch (error) {
      return null;
    }
  }

  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabComplete(tab.id, 15000);
    return await scrapeProfileInTab(tab.id, username);
  } catch (error) {
    return null;
  } finally {
    if (tab && tab.id) {
      try { await chrome.tabs.remove(tab.id); } catch (error) {}
    }
  }
}
