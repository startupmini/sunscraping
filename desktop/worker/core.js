'use strict';
/**
 * Desktop worker: the same contract as chrome-extension/background.js, without
 * chrome.tabs / chrome.alarms. Page work is delegated to sessions.js and pacing
 * to the extension's own RateLimiter (loaded through legacy.js).
 *
 * The rules that decide how much traffic is sent — host allowlist, error
 * taxonomy, what a result means — live in policy.js, where they can be tested
 * without Electron.
 */

const path = require('node:path');

const TaskCache = require(
  path.join(__dirname, '..', '..', 'chrome-extension', 'utils', 'task-cache.js'),
);

const {
  allowedTarget,
  cacheKey,
  classifyError,
  outcomeOf,
  CACHE_HIT_DELAY_MS,
  ERROR_BACKOFF_MS,
  IDLE_POLL_MS,
} = require('./policy.js');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createWorker({ api, sessions, limiter, notify, log, onChange, timers } = {}) {
  const say = typeof log === 'function' ? log : () => {};
  const ping = typeof notify === 'function' ? notify : () => {};
  // Injectable so tests can drive the loop without waiting on real delays.
  const clock = timers && typeof timers.setTimeout === 'function'
    ? timers
    : { setTimeout, clearTimeout };

  const state = {
    active: false,
    busy: false,
    timer: null,
    cycleId: null,
    lastPlatform: null,
    blockedInARow: 0,
    lastError: null,
    lastTaskId: null,
    harvested: new Set(),
    followerAttempts: new Set(),
  };

  function getStatus() {
    let label = 'siaga';
    if (state.active) label = state.busy ? 'memproses' : 'menunggu antrean';
    else if (state.lastError) label = 'berhenti';
    return {
      active: state.active,
      busy: state.busy,
      label,
      cycleId: state.cycleId,
      lastError: state.lastError,
      lastTaskId: state.lastTaskId,
    };
  }

  /** The tray label is rebuilt from this, so every transition has to report. */
  function changed() {
    if (typeof onChange !== 'function') return;
    try {
      onChange(getStatus());
    } catch (error) {
      say(`onChange gagal: ${error.message}`);
    }
  }

  function schedule(ms) {
    if (!state.active) return;
    if (state.timer) clock.clearTimeout(state.timer);
    state.timer = clock.setTimeout(() => {
      state.timer = null;
      tick().catch((error) => say(`Tick gagal: ${error.message}`));
    }, Math.max(200, ms));
    changed();
  }

  function stop(reason) {
    const wasActive = state.active;
    state.active = false;
    if (state.timer) {
      clock.clearTimeout(state.timer);
      state.timer = null;
    }
    if (reason) {
      state.lastError = reason;
      ping('Worker berhenti', reason);
    }
    changed();
    return wasActive;
  }

  async function start() {
    if (state.active) return getStatus();
    state.active = true;
    state.lastError = null;
    state.blockedInARow = 0;
    await limiter.startSession();
    ping('Worker aktif', 'Scraping berjalan di jendela tersembunyi. Biarkan aplikasi tetap terbuka.');
    changed();
    schedule(500);
    return getStatus();
  }

  /**
   * One account visit per cycle, only when the backend has no fresh follower
   * count. That visit also returns the account's recent posts, so the post we
   * are about to check may need no navigation at all.
   */
  async function ensureHarvested(task) {
    if (!task.platform || !task.username) return null;
    if (!TaskCache.shouldHarvestAccount(task, state.harvested)) return null;

    const platform = task.platform;
    const key = cacheKey(platform, task.username);
    state.harvested.add(key);

    try {
      await limiter.recordAuxiliaryVisit();
      await delay(1200 + Math.floor(Math.random() * 1800));
      const profile = await sessions.scrapeProfile(task.username, platform);
      if (!profile) return null;

      await api.reportProfile(profile, task.username, platform);
      if (profile.followerCount !== null && profile.followerCount !== undefined) {
        task.cachedFollowerCount = profile.followerCount;
        state.followerAttempts.add(key);
      }
      return { profile, match: TaskCache.fromHarvest(profile, task) };
    } catch (error) {
      say(`Kunjungan profil @${task.username} gagal: ${error.message}`);
      return null;
    }
  }

  async function enrichFollower(result, task) {
    if (result.followerCount !== null && result.followerCount !== undefined) return;
    if (task.cachedFollowerCount !== null && task.cachedFollowerCount !== undefined) {
      result.followerCount = task.cachedFollowerCount;
      return;
    }
    if (!result.username || result.status === 'FAILED') return;

    const platform = result.platform || task.platform;
    const key = cacheKey(platform, result.username);
    if (state.followerAttempts.has(key)) return;
    state.followerAttempts.add(key);

    try {
      await limiter.recordAuxiliaryVisit();
      const profile = await sessions.scrapeProfile(result.username, platform);
      if (!profile) return;
      await api.reportProfile(profile, result.username, platform);
      if (profile.followerCount !== null && profile.followerCount !== undefined) {
        result.followerCount = profile.followerCount;
      }
    } catch (error) {
      say(`Lookup follower @${result.username} gagal: ${error.message}`);
    }
  }

  async function processTask(task) {
    if (!allowedTarget(task.url)) {
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
      if (task.kind === 'PROFILE') {
        await limiter.recordAuxiliaryVisit();
        const profile = await sessions.scrapeProfile(task.username, task.platform);
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
        await api.reportProfile(profile, task.username, task.platform);
        return {
          status: profile.status === 'FAILED' ? 'FAILED' : 'OK',
          kind: 'PROFILE',
          platform: task.platform,
          username: task.username,
          errorCode: profile.errorCode || null,
        };
      }

      const cached = TaskCache.resultFromTask(task);
      if (cached) {
        cached.tema = task.tema || null;
        say(`Task #${task.id} dijawab dari kunjungan profil (tanpa navigasi)`);
        return cached;
      }

      const harvest = await ensureHarvested(task);
      if (harvest && harvest.match) {
        harvest.match.tema = task.tema || null;
        say(`Task #${task.id} sudah tercakup kunjungan akun`);
        return harvest.match;
      }

      const result = await sessions.scrapePost(task);
      result.tema = task.tema || null;
      if (!result.username && task.username) result.username = task.username;
      await enrichFollower(result, task);
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

  async function tick() {
    if (!state.active || state.busy) return;
    state.busy = true;
    changed();
    try {
      if (!(await limiter.hasVisitBudget())) {
        stop('Budget kunjungan siklus ini habis. Jalankan worker lagi untuk siklus berikutnya.');
        return;
      }

      if (limiter.needsSessionBreak()) {
        const pause = limiter.getSessionBreakDuration();
        await limiter.resetSessionBreak();
        ping(
          'Istirahat sesi',
          `Worker berhenti sementara ${Math.round(pause / 60000)} menit agar pola akses tetap wajar.`,
        );
        schedule(pause);
        return;
      }

      const pending = await api.pendingCount();
      limiter.autoSelectMode(pending);

      const prefer = state.lastPlatform === 'tiktok' ? 'instagram' : 'tiktok';
      const data = await api.nextTask(prefer);
      if (!data || !data.hasTask || !data.task) {
        schedule(IDLE_POLL_MS);
        return;
      }

      const task = data.task;

      // A cycle is one run: its accounts plus their posts. Switching runs refills
      // the budget; a task of the current cycle spends what is left of it.
      const cycleId = task.runId ? `${task.auditId || 0}:${task.runId}` : null;
      if (await limiter.beginCycle(cycleId)) {
        state.cycleId = cycleId;
        state.harvested = new Set();
        state.followerAttempts = new Set();
      } else {
        state.cycleId = limiter.cycleId;
      }

      if (!(await limiter.hasVisitBudget())) {
        stop('Budget kunjungan siklus ini habis. Jalankan worker lagi untuk siklus berikutnya.');
        return;
      }

      if (limiter.isWarmingUp()) {
        say(`Warm-up: task ${limiter.totalTasksThisSession + 1}/5 `
          + `(${limiter.getWarmupMultiplier()}x lebih lambat)`);
      }

      const result = await processTask(task);
      state.lastTaskId = task.id;
      state.lastPlatform = task.platform;

      const outcome = outcomeOf(result, state.blockedInARow);
      state.blockedInARow = outcome.blockedInARow;

      if (outcome.charge === 'success') await limiter.reportSuccess();
      else if (outcome.charge === 'error') await limiter.reportError();

      try {
        await api.reportResult(task.id, result);
      } catch (error) {
        say(`Gagal mengirim hasil task ${task.id}: ${error.message}`);
      }

      if (outcome.blocked) {
        if (outcome.stop) {
          stop(outcome.errorCode === 'AUTH'
            ? 'Sesi login berakhir 3x berturut-turut. Login ulang dari tray lalu jalankan worker lagi.'
            : 'Platform membatasi akses 3x berturut-turut. Worker dihentikan untuk keamanan.');
          return;
        }
        const pause = outcome.pauseMs;
        ping('Worker dijeda', outcome.errorCode === 'AUTH'
          ? `Sesi login diperlukan. Jeda ${Math.round(pause / 60000)} menit; login ulang dari tray.`
          : `Akses dibatasi platform. Jeda ${Math.round(pause / 60000)} menit lalu lanjut otomatis.`);
        schedule(pause);
        return;
      }

      if (outcome.fromCache) {
        // A cache hit loaded no page, so the human-like pause would only slow
        // the queue down.
        schedule(CACHE_HIT_DELAY_MS);
        return;
      }

      const delayMs = limiter.getDelay();
      const estimate = limiter.estimateTime(Math.max(0, pending - 1));
      say(`Berikutnya ${Math.round(delayMs / 1000)} dtk | sisa ~${estimate.display} | `
        + `siklus ${limiter.cycleVisits}/${limiter.VISIT_BUDGET}`);
      schedule(delayMs);
    } catch (error) {
      state.lastError = error.message || 'Worker error';
      say(`Poll gagal: ${state.lastError}`);
      if (/API key/i.test(state.lastError)) {
        stop(state.lastError);
        return;
      }
      changed();
      schedule(ERROR_BACKOFF_MS);
    } finally {
      state.busy = false;
      changed();
    }
  }

  return { start, stop, getStatus };
}

module.exports = { createWorker, allowedTarget, classifyError };
