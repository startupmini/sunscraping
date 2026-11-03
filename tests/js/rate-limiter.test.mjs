// Unit guard for the safety throttling in chrome-extension/utils/rate-limiter.js.
// Run: node --test tests/js   (or: bun test tests/js)
//
// The module is a classic extension script, so it is evaluated in a vm sandbox
// with a stubbed chrome.storage — the same way background.js loads it.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(
  new URL('../../chrome-extension/utils/rate-limiter.js', import.meta.url), 'utf8');

function load(initialStorage = {}) {
  const store = { ...initialStorage };
  const chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          for (const key of (Array.isArray(keys) ? keys : [keys])) {
            if (key in store) out[key] = store[key];
          }
          return out;
        },
        set: async (values) => { Object.assign(store, values); },
      },
    },
  };
  const context = vm.createContext({ chrome, console, Math, Date, Number, Set, Object, Array, Promise });
  vm.runInContext(SOURCE, context);
  return { limiter: vm.runInContext('RateLimiter', context), store };
}

const yesterday = () => new Date(Date.now() - 86400000).toDateString();

test('getDelay clamps after the multipliers, so a mode never stalls for minutes', () => {
  const { limiter } = load();
  limiter.setMode('safe');
  limiter.totalTasksThisSession = 99;   // warm-up over
  limiter.sessionTaskCount = 40;        // fatigue 1.5
  limiter.backoffMultiplier = 10;       // worst error backoff

  const delay = limiter.getDelay();
  assert.ok(delay <= limiter.MAX_DELAY_MS, `expected <= ${limiter.MAX_DELAY_MS}, got ${delay}`);
  assert.ok(delay > 10000, `expected the backoff to still matter, got ${delay}`);
});

test('warm-up really slows the first tasks of a session', () => {
  const { limiter } = load();
  limiter.setMode('aggressive');
  limiter.backoffMultiplier = 1;
  limiter.sessionTaskCount = 0;
  limiter.totalTasksThisSession = 0;
  const first = limiter.getDelay();
  limiter.totalTasksThisSession = 20;
  const later = limiter.getDelay();
  assert.ok(first > later, `first task ${first} should be slower than a warm one ${later}`);
});

test('estimateTime pays for the same multipliers getDelay applies', () => {
  const { limiter } = load();
  limiter.setMode('normal');
  limiter.totalTasksThisSession = 0;   // warm-up 3x
  limiter.sessionTaskCount = 0;
  limiter.backoffMultiplier = 1;
  const estimate = limiter.estimateTime(10);
  const { min, max } = limiter.MODES.normal;
  const floorWithoutWarmup = 10 * (((min + max) / 2) + 4000);
  assert.ok(estimate.totalMs > floorWithoutWarmup,
    `ETA ${estimate.totalMs} ignored warm-up (floor ${floorWithoutWarmup})`);
});

test('an auxiliary visit spends both the cycle budget and the daily rail', async () => {
  const { limiter, store } = load();
  await limiter.recordAuxiliaryVisit();
  assert.equal(limiter.cycleVisits, 1);
  assert.equal(limiter.dailyVisits, 1);
  assert.equal(store.sa_cycleVisits, 1, 'cycle counter must be persisted, not fire-and-forget');
  assert.equal(store.sa_dailyTaskCount, 1);
});

test('starting a session resets warm-up and break budget but not the visit budget', async () => {
  const { limiter } = load();
  limiter.cycleVisits = 123;
  limiter.dailyVisits = 123;
  limiter.totalTasksThisSession = 500;
  limiter.sessionTaskCount = 44;
  await limiter.startSession();
  assert.equal(limiter.totalTasksThisSession, 0);
  assert.equal(limiter.sessionTaskCount, 0);
  assert.equal(limiter.cycleVisits, 123, 'refilling the budget by restarting the worker would defeat it');
  assert.equal(limiter.dailyVisits, 123);
});

test('beginCycle refills the budget only when the cycle actually changes', async () => {
  const { limiter } = load();
  await limiter.beginCycle('1:10');
  for (let i = 0; i < 5; i++) await limiter.recordVisit();
  assert.equal(limiter.cycleVisits, 5);

  // The same run hands out more tasks; re-entering must not refund anything.
  assert.equal(await limiter.beginCycle('1:10'), false);
  assert.equal(limiter.cycleVisits, 5);

  // A new run is a new cycle: its accounts plus their posts get a fresh budget.
  assert.equal(await limiter.beginCycle('1:11'), true);
  assert.equal(limiter.cycleVisits, 0);
  assert.equal(limiter.cycleId, '1:11');
});

test('the cycle budget stops the worker while a fresh cycle may continue', async () => {
  const { limiter } = load();
  await limiter.beginCycle('3:30');
  limiter.cycleVisits = limiter.VISIT_BUDGET;
  assert.equal(limiter.getVisitsRemaining(), 0);
  assert.equal(await limiter.hasVisitBudget(), false);

  await limiter.beginCycle('3:31');
  assert.equal(await limiter.hasVisitBudget(), true);
});

test('the daily rail caps the total even when every cycle is fresh', async () => {
  const { limiter } = load();
  limiter.dailyVisits = limiter.DAILY_VISIT_RAIL;
  limiter.cycleVisits = 0;
  assert.equal(await limiter.hasVisitBudget(), false, 'unlimited cycles per day is how an account gets banned');
});

test('init on a new day clears stale counters', async () => {
  const { limiter } = load({
    sa_lastResetDate: yesterday(),
    sa_dailyTaskCount: 480,
    sa_cycleVisits: 480,
    sa_cycleId: '1:9',
    sa_sessionTaskCount: 41,
    sa_totalTasksThisSession: 900,
  });
  await limiter.init();
  assert.equal(limiter.dailyVisits, 0);
  assert.equal(limiter.cycleVisits, 0);
  assert.equal(limiter.cycleId, null);
  assert.equal(limiter.sessionTaskCount, 0);
  assert.equal(limiter.totalTasksThisSession, 0, 'a stale total disables warm-up forever');
});

test('init on the same day restores where the worker left off', async () => {
  const today = new Date().toDateString();
  const { limiter } = load({
    sa_lastResetDate: today,
    sa_dailyTaskCount: 137,
    sa_cycleVisits: 12,
    sa_cycleId: '2:7',
    sa_sessionTaskCount: 12,
    sa_sessionBreakThreshold: 45,
    sa_totalTasksThisSession: 137,
    sa_consecutiveErrors: 2,
    sa_backoffMultiplier: 2.25,
  });
  await limiter.init();
  assert.equal(limiter.dailyVisits, 137);
  assert.equal(limiter.cycleVisits, 12);
  assert.equal(limiter.cycleId, '2:7', 'losing the cycle id would hand a spent cycle a fresh budget');
  assert.equal(limiter.sessionTaskCount, 12);
  assert.equal(limiter.sessionBreakThreshold, 45);
  assert.equal(limiter.totalTasksThisSession, 137);
  assert.equal(limiter.getWarmupMultiplier(), 1);
  assert.equal(limiter.backoffMultiplier, 2.25);
});

test('hasVisitBudget blocks at the cap and reopens the next day', async () => {
  const { limiter } = load({
    sa_lastResetDate: yesterday(),
    sa_dailyTaskCount: 500,
    sa_sessionTaskCount: 40,
    sa_totalTasksThisSession: 500,
  });
  await limiter.init();
  limiter.cycleVisits = limiter.VISIT_BUDGET;
  limiter.dailyVisits = 0;
  assert.equal(await limiter.hasVisitBudget(), false);

  limiter.lastResetDate = yesterday();
  assert.equal(await limiter.hasVisitBudget(), true);
  assert.equal(limiter.cycleVisits, 0);
  assert.equal(limiter.dailyVisits, 0);
});
