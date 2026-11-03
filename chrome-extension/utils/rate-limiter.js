/**
 * sunscraping — Rate Limiter v2
 * Best-effort safety throttling system
 * 
 * Layer 1: Session Break (istirahat berkala)
 * Layer 2: Visit budget (per siklus, dengan rail harian sebagai rem darurat)
 * Layer 3: Auto Speed Selection (pilih mode otomatis)
 * Layer 4: Random Dwell Time (simulasi baca halaman)
 * Layer 5: Warm-up Phase (awal sesi ekstra lambat)
 * Layer 6: Fatigue Simulation (makin lama makin lambat)
 * Layer 7: Platform Alternation (handled in background.js)
 */

const RateLimiter = {
  // ============================================================
  // SPEED MODES
  // ============================================================
  MODES: {
    safe:       { min: 5000, max: 10000, label: 'Aman (5-10 dtk)' },
    normal:     { min: 3000, max: 8000,  label: 'Normal (3-8 dtk)' },
    aggressive: { min: 1500, max: 3000,  label: 'Cepat (1,5-3 dtk)' },
  },

  currentMode: 'normal',
  backoffMultiplier: 1,
  consecutiveErrors: 0,

  // ============================================================
  // LAYER 1: SESSION BREAK
  // Istirahat setelah N task agar terlihat seperti manusia ngopi
  // ============================================================
  sessionTaskCount: 0,
  sessionBreakThreshold: 30 + Math.floor(Math.random() * 21), // 30-50 (randomized per session)
  
  SESSION_BREAK_MIN: 180000,  // 3 menit
  SESSION_BREAK_MAX: 300000,  // 5 menit
  MAX_DELAY_MS: 60000,        // ceiling for mode range x warmup x fatigue x backoff

  needsSessionBreak() {
    return this.sessionTaskCount >= this.sessionBreakThreshold;
  },

  getSessionBreakDuration() {
    // Random break duration between 3-5 minutes
    const duration = this.SESSION_BREAK_MIN + Math.floor(Math.random() * (this.SESSION_BREAK_MAX - this.SESSION_BREAK_MIN));
    return duration;
  },

  async resetSessionBreak() {
    this.sessionTaskCount = 0;
    // Randomize next threshold so it's not predictable
    this.sessionBreakThreshold = 30 + Math.floor(Math.random() * 21);
    await this._persistSession();
  },

  recordTaskCompleted() {
    this.sessionTaskCount++;
  },

  // ============================================================
  // LAYER 2: VISIT BUDGET
  // One cycle = one run: the accounts it visits plus their posts. The budget is
  // spent per cycle, not per calendar day, because the operator thinks in runs
  // ("selesaikan audit ini"), while the platform still sees a wall clock — so a
  // wide daily rail stays in place underneath the cycle budget.
  // ============================================================
  VISIT_BUDGET: 500,
  DAILY_VISIT_RAIL: 2000,
  cycleId: null,
  cycleVisits: 0,
  dailyVisits: 0,
  lastResetDate: new Date().toDateString(),

  /**
   * Initialize: load persisted visit counters from chrome.storage
   */
  async init() {
    try {
      const data = await chrome.storage.local.get([
        'sa_dailyTaskCount', 'sa_lastResetDate', 'sa_cycleId', 'sa_cycleVisits',
        'sa_sessionTaskCount', 'sa_sessionBreakThreshold', 'sa_totalTasksThisSession',
        'sa_consecutiveErrors', 'sa_backoffMultiplier'
      ]);
      const today = new Date().toDateString();
      const sameDay = data.sa_lastResetDate === today;

      if (sameDay) {
        this.dailyVisits = Number(data.sa_dailyTaskCount) || 0;
        this.lastResetDate = today;
        this.cycleId = data.sa_cycleId || null;
        this.cycleVisits = Number(data.sa_cycleVisits) || 0;
        console.log(`[RateLimiter] Restored visits: ${this.cycleVisits}/${this.VISIT_BUDGET} siklus ini, ${this.dailyVisits}/${this.DAILY_VISIT_RAIL} hari ini`);

        const sessionCount = Number(data.sa_sessionTaskCount);
        if (Number.isFinite(sessionCount) && sessionCount >= 0) {
          this.sessionTaskCount = sessionCount;
        }
        const totalTasks = Number(data.sa_totalTasksThisSession);
        if (Number.isFinite(totalTasks) && totalTasks >= 0) {
          this.totalTasksThisSession = totalTasks;
        }
      } else {
        // New day: counters start over, otherwise a stale totalTasksThisSession
        // leaves warm-up permanently disabled.
        await this.startSession();
        this.dailyVisits = 0;
        this.cycleVisits = 0;
        this.cycleId = null;
        await this._persistDaily();
        console.log('[RateLimiter] New day — visit counters and session counters reset.');
      }

      const threshold = Number(data.sa_sessionBreakThreshold);
      if (Number.isFinite(threshold) && threshold >= 10 && threshold <= 100) {
        this.sessionBreakThreshold = threshold;
      }
      const errors = Number(data.sa_consecutiveErrors);
      if (Number.isFinite(errors) && errors >= 0) {
        this.consecutiveErrors = errors;
      }
      const backoff = Number(data.sa_backoffMultiplier);
      if (Number.isFinite(backoff) && backoff >= 1 && backoff <= 10) {
        this.backoffMultiplier = backoff;
      }

      console.log(`[RateLimiter] Restored session ${this.sessionTaskCount}/${this.sessionBreakThreshold}, warm-up done: ${this.totalTasksThisSession}`);
    } catch (e) {
      console.warn('[RateLimiter] Could not load persisted state:', e);
    }
  },

  /**
   * A session starts when the user turns the worker on (and on a new day):
   * warm-up and the session-break budget begin again from zero. The visit
   * counters deliberately survive, or restarting the worker would refill them.
   */
  async startSession() {
    this.totalTasksThisSession = 0;
    this.sessionTaskCount = 0;
    this.sessionBreakThreshold = 30 + Math.floor(Math.random() * 21);
    this.consecutiveErrors = 0;
    this.backoffMultiplier = 1;
    this.lastResetDate = new Date().toDateString();
    await this._persistSession();
  },

  _persistSession() {
    // Awaited: an MV3 service worker can be evicted right after a task, and an
    // unflushed counter silently grants extra visits.
    return chrome.storage.local.set({
      sa_sessionTaskCount: this.sessionTaskCount,
      sa_sessionBreakThreshold: this.sessionBreakThreshold,
      sa_totalTasksThisSession: this.totalTasksThisSession,
      sa_consecutiveErrors: this.consecutiveErrors,
      sa_backoffMultiplier: this.backoffMultiplier
    }).catch(() => {});
  },

  _persistDaily() {
    return chrome.storage.local.set({
      sa_dailyTaskCount: this.dailyVisits,
      sa_lastResetDate: this.lastResetDate,
      sa_cycleId: this.cycleId,
      sa_cycleVisits: this.cycleVisits
    }).catch(() => {});
  },

  /**
   * A cycle is one run (its accounts plus their posts). Entering a different
   * cycle refills the budget; re-entering the same cycle does not.
   */
  async beginCycle(cycleId) {
    const next = cycleId === null || cycleId === undefined ? null : String(cycleId);
    if (next === this.cycleId) return false;
    this.cycleId = next;
    this.cycleVisits = 0;
    await this._persistDaily();
    console.log(`[RateLimiter] Cycle ${next || 'unknown'} — ${this.VISIT_BUDGET} kunjungan tersedia.`);
    return true;
  },

  /** Today's date rolls the rail over; a stalled worker must not stay locked. */
  async _rollDayIfNeeded() {
    const today = new Date().toDateString();
    if (today === this.lastResetDate) return;
    this.dailyVisits = 0;
    this.cycleVisits = 0;
    this.cycleId = null;
    await this.startSession();
    await this._persistDaily();
  },

  async hasVisitBudget() {
    await this._rollDayIfNeeded();
    return this.cycleVisits < this.VISIT_BUDGET && this.dailyVisits < this.DAILY_VISIT_RAIL;
  },

  async recordVisit() {
    await this._rollDayIfNeeded();
    this.cycleVisits++;
    this.dailyVisits++;
    await this._persistDaily();
  },

  getVisitsRemaining() {
    return Math.max(0, Math.min(
      this.VISIT_BUDGET - this.cycleVisits,
      this.DAILY_VISIT_RAIL - this.dailyVisits
    ));
  },

  // ============================================================
  // LAYER 3: AUTO SPEED SELECTION
  // Otomatis pilih mode berdasarkan jumlah pending tasks
  // ============================================================
  autoSelectMode(pendingCount) {
    if (pendingCount <= 50) {
      this.setMode('aggressive');
    } else if (pendingCount <= 300) {
      this.setMode('normal');
    } else {
      this.setMode('safe');
    }
    console.log(`[RateLimiter] Auto mode: ${this.currentMode} (${pendingCount} pending)`);
  },

  setMode(mode) {
    if (this.MODES[mode]) {
      this.currentMode = mode;
    }
  },

  // ============================================================
  // LAYER 4: RANDOM DWELL TIME
  // Simulasi waktu user membaca halaman sebelum pindah
  // ============================================================
  getDwellTime() {
    // 1-4 detik seolah-olah sedang membaca
    return 1000 + Math.floor(Math.random() * 3000);
  },

  // ============================================================
  // LAYER 5: WARM-UP PHASE
  // 5 task pertama ekstra lambat (simulasi awal browsing)
  // ============================================================
  totalTasksThisSession: 0,

  isWarmingUp() {
    return this.totalTasksThisSession < 5;
  },

  getWarmupMultiplier() {
    // Task 1: 3x slower, Task 2: 2.5x, Task 3: 2x, Task 4: 1.5x, Task 5+: 1x
    if (this.totalTasksThisSession === 0) return 3.0;
    if (this.totalTasksThisSession === 1) return 2.5;
    if (this.totalTasksThisSession === 2) return 2.0;
    if (this.totalTasksThisSession === 3) return 1.5;
    if (this.totalTasksThisSession === 4) return 1.2;
    return 1.0;
  },

  // ============================================================
  // LAYER 6: FATIGUE SIMULATION
  // Setiap 10 task, jeda semakin panjang (simulasi capek)
  // ============================================================
  getFatigueMultiplier() {
    // Every 10 tasks, add 10% delay (max 50% extra)
    const fatigueLevel = Math.floor(this.sessionTaskCount / 10);
    return 1.0 + Math.min(0.5, fatigueLevel * 0.1);
  },

  // ============================================================
  // MAIN: Calculate Delay (combines all layers)
  // ============================================================
  getDelay() {
    const { min, max } = this.MODES[this.currentMode];
    
    // Box-Muller transform for gaussian-ish random
    const u1 = Math.random();
    const u2 = Math.random();
    const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Map gaussian to our range
    const mean = (min + max) / 2;
    const std = (max - min) / 6;
    let delay = mean + gaussian * std;
    delay = Math.max(min, Math.min(max, delay));
    
    // Apply Layer 5: Warm-up multiplier
    delay *= this.getWarmupMultiplier();
    
    // Apply Layer 6: Fatigue multiplier
    delay *= this.getFatigueMultiplier();
    
    // Apply error backoff
    delay *= this.backoffMultiplier;
    
    // Clamped last: warm-up, fatigue and backoff multiply the range, so the
    // mode label is only the starting point. Without a ceiling a backoff of 10
    // in safe mode turns a 10 second pace into minutes of dead time.
    return Math.min(this.MAX_DELAY_MS, Math.round(delay));
  },

  // ============================================================
  // ERROR TRACKING
  // ============================================================
  async reportSuccess() {
    this.consecutiveErrors = 0;
    this.backoffMultiplier = 1;
    this.totalTasksThisSession++;
    this.recordTaskCompleted();
    await this.recordVisit();
    await this._persistSession();
  },

  async reportError() {
    this.consecutiveErrors++;
    this.backoffMultiplier = Math.min(10, Math.pow(1.5, this.consecutiveErrors));
    this.totalTasksThisSession++;
    this.recordTaskCompleted();
    await this.recordVisit();
    await this._persistSession();
  },

  /**
   * Extra page visit (e.g. the profile harvest). It is not a task, but it is
   * still a visit the platform sees, so it spends the cycle budget and counts
   * toward the session-break budget as well.
   */
  async recordAuxiliaryVisit() {
    this.sessionTaskCount++;
    await this.recordVisit();
    await this._persistSession();
  },

  // ============================================================
  // STATUS & ESTIMATES
  // ============================================================
  /**
   * The pace the operator will actually experience: the mode range with the
   * warm-up, fatigue and backoff multipliers applied and capped like getDelay.
   */
  getPaceLabel() {
    const { min, max } = this.MODES[this.currentMode];
    const factor = Math.min(
      this.MAX_DELAY_MS / max,
      this.getWarmupMultiplier() * this.getFatigueMultiplier() * this.backoffMultiplier
    );
    return `${Math.round((min * factor) / 1000)}-${Math.round((max * factor) / 1000)} dtk`;
  },

  getStatus() {
    return {
      mode: this.currentMode,
      modeLabel: this.MODES[this.currentMode]?.label || this.currentMode,
      paceLabel: this.getPaceLabel(),
      sessionTasks: this.sessionTaskCount,
      sessionBreakAt: this.sessionBreakThreshold,
      cycleId: this.cycleId,
      cycleVisits: this.cycleVisits,
      visitBudget: this.VISIT_BUDGET,
      cycleRemaining: Math.max(0, this.VISIT_BUDGET - this.cycleVisits),
      dailyVisits: this.dailyVisits,
      dailyRail: this.DAILY_VISIT_RAIL,
      remaining: this.getVisitsRemaining(),
      isWarmup: this.isWarmingUp(),
      fatigue: this.getFatigueMultiplier(),
      backoff: this.backoffMultiplier,
    };
  },

  estimateTime(remainingCount) {
    const { min, max } = this.MODES[this.currentMode];
    // Same maths as getDelay, or the ETA promises a third of the real duration.
    const multiplied = ((min + max) / 2)
      * this.getWarmupMultiplier() * this.getFatigueMultiplier() * this.backoffMultiplier;
    const avgDelay = Math.min(this.MAX_DELAY_MS, multiplied);
    const avgPerItem = avgDelay + 4000; // ~4s per page load
    
    // Add session breaks
    const breaksNeeded = Math.floor(remainingCount / this.sessionBreakThreshold);
    const breakTime = breaksNeeded * ((this.SESSION_BREAK_MIN + this.SESSION_BREAK_MAX) / 2);
    
    const totalMs = (remainingCount * avgPerItem) + breakTime;
    
    return {
      totalMs,
      minutes: Math.ceil(totalMs / 60000),
      display: this.formatTime(totalMs),
      breaksEstimated: breaksNeeded,
    };
  },

  formatTime(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}j ${minutes}m`;
    return `${minutes}m`;
  }
};
