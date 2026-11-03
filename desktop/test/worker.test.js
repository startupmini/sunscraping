'use strict';
/**
 * These tests run with plain Node (no Electron): the storage shim, the shared
 * rate limiter, the traffic policy and the worker loop are the parts that decide
 * how much traffic the app sends, so they are the parts worth pinning.
 *
 * Run: npm test   (or: node --test desktop/test)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createStorage, loadRateLimiter } = require('../worker/legacy.js');
const { allowedTarget, classifyError, createWorker } = require('../worker/core.js');
const policy = require('../worker/policy.js');

const ROOT = path.join(__dirname, '..', '..');
const LIMITER_FILE = path.join(ROOT, 'chrome-extension', 'utils', 'rate-limiter.js');

function tempStateFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-desktop-'));
  return path.join(dir, 'worker-state.json');
}

/* ------------------------------------------------------------------ shims -- */

/** Captures scheduled work so a tick can be driven without waiting for it. */
function manualTimers() {
  const queue = [];
  return {
    queue,
    setTimeout(fn, ms) {
      const entry = { fn, ms };
      queue.push(entry);
      return entry;
    },
    clearTimeout() {},
  };
}

function fakeLimiter(overrides = {}) {
  return {
    VISIT_BUDGET: 500,
    cycleVisits: 0,
    totalTasksThisSession: 0,
    cycleId: null,
    calls: { success: 0, error: 0, auxiliary: 0, session: 0 },
    async startSession() { this.calls.session += 1; },
    async hasVisitBudget() { return true; },
    needsSessionBreak() { return false; },
    getSessionBreakDuration() { return 0; },
    async resetSessionBreak() {},
    autoSelectMode() {},
    async beginCycle(cycleId) {
      if (this.cycleId === cycleId) return false;
      this.cycleId = cycleId;
      return true;
    },
    isWarmingUp() { return false; },
    getWarmupMultiplier() { return 1; },
    async reportSuccess() { this.calls.success += 1; },
    async reportError() { this.calls.error += 1; },
    async recordAuxiliaryVisit() { this.calls.auxiliary += 1; },
    getDelay() { return 10; },
    estimateTime() { return { display: '1m' }; },
    ...overrides,
  };
}

function fakeApi({ pending = 1, task = null, nextTaskError = null } = {}) {
  return {
    reported: [],
    async pendingCount() { return pending; },
    async nextTask() {
      if (nextTaskError) throw nextTaskError;
      return task ? { hasTask: true, task } : { hasTask: false };
    },
    async reportResult(taskId, result) {
      this.reported.push({ taskId, result });
    },
    async reportProfile() {},
  };
}

function fakeSessions(scrapePost) {
  const calls = { post: 0, profile: 0 };
  return {
    calls,
    async scrapePost(task) {
      calls.post += 1;
      return scrapePost(task);
    },
    async scrapeProfile() {
      calls.profile += 1;
      return null;
    },
  };
}

/** A task with a fresh follower count, so no account visit is attempted. */
function baseTask(overrides = {}) {
  return {
    id: 11,
    url: 'https://www.instagram.com/p/ABC/',
    platform: 'instagram',
    username: 'akun',
    tema: 'tema',
    auditId: 2,
    runId: 1,
    cachedFollowerCount: 10,
    ...overrides,
  };
}

function flush() {
  let pending = Promise.resolve();
  for (let i = 0; i < 8; i += 1) {
    pending = pending.then(() => new Promise((resolve) => setImmediate(resolve)));
  }
  return pending;
}

async function runScheduledStep(timers) {
  const entry = timers.queue.shift();
  assert.ok(entry, 'worker tidak menjadwalkan langkah berikutnya');
  entry.fn();
  await flush();
  return entry;
}

function workerWith({ limiter, api, sessions }) {
  const timers = manualTimers();
  const worker = createWorker({ api, sessions, limiter, log: () => {}, timers });
  return { worker, timers };
}

/* ------------------------------------------------------------ rate limiter -- */

test('the extension rate limiter runs unchanged on the desktop storage shim', async () => {
  const limiter = loadRateLimiter(LIMITER_FILE, createStorage(tempStateFile()));
  await limiter.init();

  assert.equal(typeof limiter.getDelay, 'function');
  assert.ok(limiter.getDelay() > 0);
  assert.equal(limiter.VISIT_BUDGET, 500);
});

test('cycle counters survive a restart through the shared state file', async () => {
  const file = tempStateFile();

  const limiter = loadRateLimiter(LIMITER_FILE, createStorage(file));
  await limiter.init();
  await limiter.beginCycle('7:9');
  await limiter.reportSuccess();
  await limiter.reportSuccess();

  const reloaded = loadRateLimiter(LIMITER_FILE, createStorage(file));
  await reloaded.init();
  assert.equal(reloaded.cycleId, '7:9');
  assert.equal(reloaded.cycleVisits, 2);
});

test('a new cycle refills the visit budget but the daily rail still applies', async () => {
  const limiter = loadRateLimiter(LIMITER_FILE, createStorage(tempStateFile()));
  await limiter.init();
  await limiter.beginCycle('1:1');
  await limiter.reportSuccess();
  assert.equal(limiter.cycleVisits, 1);

  assert.equal(await limiter.beginCycle('1:2'), true);
  assert.equal(limiter.cycleVisits, 0);
  assert.equal(await limiter.hasVisitBudget(), true);
  assert.equal(limiter.dailyVisits, 1);
});

/* ----------------------------------------------------------------- policy -- */

test('the worker refuses hosts the platforms do not own', () => {
  assert.equal(allowedTarget('https://www.instagram.com/p/ABC/'), true);
  assert.equal(allowedTarget('https://www.tiktok.com/@a/video/1'), true);
  assert.equal(allowedTarget('https://www.instagram.com.evil.tld/p/ABC/'), false);
  assert.equal(allowedTarget('https://evil.tld/?u=instagram.com'), false);
  assert.equal(allowedTarget('file:///etc/passwd'), false);
  assert.equal(allowedTarget('javascript:alert(1)'), false);
});

test('a platform is derived from an exact host, never from a suffix', () => {
  assert.equal(policy.platformForHost('https://www.instagram.com/p/ABC/'), 'instagram');
  assert.equal(policy.platformForHost('https://vm.tiktok.com/abc/'), 'tiktok');
  assert.equal(policy.platformForHost('https://notinstagram.com/p/ABC/'), null);
  assert.equal(policy.platformForHost('https://instagram.com.evil.tld/p/ABC/'), null);
  assert.equal(policy.platformForHost('about:blank'), null);
});

test('blocked responses keep their own error code', () => {
  assert.equal(classifyError(new Error('Too many requests from this IP')), 'THROTTLED');
  assert.equal(classifyError(new Error('Login required / Session expired')), 'AUTH');
  assert.equal(classifyError(new Error('Postingan private')), 'PERMANENT');
  assert.equal(classifyError(new Error('net::ERR_TIMED_OUT')), 'TRANSIENT');
  assert.equal(classifyError(new Error('Content script tidak menjawab')), 'TRANSIENT');
});

test('a result is charged once, and a cache hit not at all', () => {
  const cacheHit = policy.outcomeOf({ status: 'OK', source: 'profile-visit' });
  assert.equal(cacheHit.charge, 'none');
  assert.equal(cacheHit.blocked, false);

  const failure = policy.outcomeOf({ status: 'FAILED', errorCode: 'TRANSIENT' }, 0);
  assert.equal(failure.charge, 'error');
  assert.equal(failure.blockedInARow, 0);

  const blocked = policy.outcomeOf({ status: 'FAILED', errorCode: 'THROTTLED' }, 2);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.stop, true);
  assert.equal(blocked.pauseMs, policy.BLOCK_PAUSE_MS.THROTTLED);
});

test('the extension and the desktop policy still agree on the guard values', () => {
  const source = fs.readFileSync(path.join(ROOT, 'chrome-extension', 'background.js'), 'utf8');

  for (const host of policy.ALLOWED_HOSTS) {
    assert.ok(source.includes(`'${host}'`), `background.js tidak lagi mengizinkan ${host}`);
  }
  assert.match(source, new RegExp(`THROTTLED: ${policy.BLOCK_PAUSE_MS.THROTTLED / 60000} \\* 60 \\* 1000`));
  assert.match(source, new RegExp(`AUTH: ${policy.BLOCK_PAUSE_MS.AUTH / 60000} \\* 60 \\* 1000`));
  assert.ok(
    source.includes(`consecutiveFailures >= ${policy.MAX_BLOCKED_IN_A_ROW}`),
    'batas circuit breaker di background.js berbeda',
  );
  assert.ok(
    source.includes(`scheduleNextPoll(${policy.IDLE_POLL_MS})`),
    'jeda antrean kosong di background.js berbeda',
  );
  assert.ok(
    source.includes(`scheduleNextPoll(${policy.ERROR_BACKOFF_MS})`),
    'backoff error di background.js berbeda',
  );
});

/* ----------------------------------------------------------- worker loop -- */

test('the worker stops instead of polling when the cycle budget is gone', async () => {
  const limiter = fakeLimiter({ hasVisitBudget: async () => false });
  const sessions = fakeSessions(() => {
    throw new Error('tidak boleh ada kunjungan');
  });
  const { worker, timers } = workerWith({ limiter, api: fakeApi(), sessions });

  await worker.start();
  await runScheduledStep(timers);

  const status = worker.getStatus();
  assert.equal(status.active, false);
  assert.match(status.lastError, /Budget/);
  assert.equal(sessions.calls.post, 0);
  assert.equal(timers.queue.length, 0);
});

test('a finished visit is charged once, reported, then paced by the limiter', async () => {
  const limiter = fakeLimiter();
  const api = fakeApi({ task: baseTask() });
  const sessions = fakeSessions(async () => ({
    status: 'OK',
    platform: 'instagram',
    username: 'akun',
    likes: 1,
    comments: 2,
    views: 3,
    shares: 4,
  }));
  const { worker, timers } = workerWith({ limiter, api, sessions });

  await worker.start();
  await runScheduledStep(timers);

  assert.equal(sessions.calls.post, 1);
  assert.equal(limiter.calls.success, 1);
  assert.equal(limiter.calls.error, 0);
  assert.equal(api.reported.length, 1);
  assert.equal(api.reported[0].taskId, 11);
  assert.equal(api.reported[0].result.followerCount, 10);
  // getDelay() is 10ms in the fake, but the loop keeps a 200ms floor.
  assert.equal(timers.queue[0].ms, 200);
});

test('a cache hit is not charged and is not paced like a visit', async () => {
  const limiter = fakeLimiter();
  const api = fakeApi({
    task: baseTask({
      cachedPost: {
        platform: 'instagram',
        username: 'akun',
        url: 'https://www.instagram.com/p/ABC/',
        likes: 5,
        comments: 6,
        views: 7,
        shares: 8,
        followerCount: 10,
        fetchedAt: new Date().toISOString(),
      },
    }),
  });
  const sessions = fakeSessions(() => {
    throw new Error('cache hit tidak boleh memuat halaman');
  });
  const { worker, timers } = workerWith({ limiter, api, sessions });

  await worker.start();
  await runScheduledStep(timers);

  assert.equal(sessions.calls.post, 0);
  assert.equal(limiter.calls.success, 0);
  assert.equal(limiter.calls.error, 0);
  assert.equal(api.reported[0].result.source, 'profile-visit');
  assert.equal(timers.queue[0].ms, policy.CACHE_HIT_DELAY_MS);
});

test('three blocked responses in a row stop the worker', async () => {
  const limiter = fakeLimiter();
  const api = fakeApi({ task: baseTask() });
  const sessions = fakeSessions(async () => ({
    status: 'FAILED',
    platform: 'instagram',
    username: 'akun',
    error: 'Too many requests',
    errorCode: 'THROTTLED',
  }));
  const { worker, timers } = workerWith({ limiter, api, sessions });

  await worker.start();
  await runScheduledStep(timers);
  await runScheduledStep(timers);
  assert.equal(worker.getStatus().active, true);

  await runScheduledStep(timers);
  const status = worker.getStatus();
  assert.equal(status.active, false);
  assert.match(status.lastError, /membatasi/);
  assert.equal(limiter.calls.error, 3);
});

test('a URL outside the allowlist fails permanently without loading a page', async () => {
  const limiter = fakeLimiter();
  const api = fakeApi({ task: baseTask({ url: 'https://notinstagram.com/p/ABC/' }) });
  const sessions = fakeSessions(() => {
    throw new Error('tidak boleh ada navigasi');
  });
  const { worker, timers } = workerWith({ limiter, api, sessions });

  await worker.start();
  await runScheduledStep(timers);

  assert.equal(sessions.calls.post, 0);
  assert.equal(api.reported[0].result.status, 'FAILED');
  assert.equal(api.reported[0].result.errorCode, 'PERMANENT');
  assert.equal(limiter.calls.error, 1);
});

test('a rejected API key stops the worker instead of retrying forever', async () => {
  const limiter = fakeLimiter();
  const api = fakeApi({
    nextTaskError: new Error('API key ditolak backend. Hapus backend/.api_key lalu jalankan ulang.'),
  });
  const { worker, timers } = workerWith({ limiter, api, sessions: fakeSessions(async () => null) });

  await worker.start();
  await runScheduledStep(timers);

  const status = worker.getStatus();
  assert.equal(status.active, false);
  assert.match(status.lastError, /API key/);
  assert.equal(timers.queue.length, 0);
});

test('the storage shim answers only the keys that exist', async () => {
  const storage = createStorage(tempStateFile());
  await storage.set({ a: 1, b: 'two' });

  assert.deepEqual(await storage.get(['a', 'missing']), { a: 1 });
  assert.deepEqual(await storage.get(null), { a: 1, b: 'two' });

  await storage.remove('a');
  assert.deepEqual(await storage.get(['a']), {});
});
