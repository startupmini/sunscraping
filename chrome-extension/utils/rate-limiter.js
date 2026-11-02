/**
 * sunscraping — Rate Limiter v2
 * Best-effort safety throttling system
 * 
 * Layer 1: Session Break (istirahat berkala)
 * Layer 2: Daily Limit (batas harian)
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

  needsSessionBreak() {
    return this.sessionTaskCount >= this.sessionBreakThreshold;
  },

  getSessionBreakDuration() {
    // Random break duration between 3-5 minutes
    const duration = this.SESSION_BREAK_MIN + Math.floor(Math.random() * (this.SESSION_BREAK_MAX - this.SESSION_BREAK_MIN));
    return duration;
  },

  resetSessionBreak() {
    this.sessionTaskCount = 0;
    // Randomize next threshold so it's not predictable
    this.sessionBreakThreshold = 30 + Math.floor(Math.random() * 21);
    this._persistSession();
  },

  recordTaskCompleted() {
    this.sessionTaskCount++;
  },

  // ============================================================
  // LAYER 2: DAILY LIMIT
  // Max tasks per hari untuk keamanan akun
  // ============================================================
  DAILY_LIMIT: 500,
  dailyTaskCount: 0,
  lastResetDate: new Date().toDateString(),

  /**
   * Initialize: load persisted daily counters from chrome.storage
   */
  async init() {
    try {
      const data = await chrome.storage.local.get([
        'sa_dailyTaskCount', 'sa_lastResetDate',
        'sa_sessionTaskCount', 'sa_sessionBreakThreshold', 'sa_totalTasksThisSession',
        'sa_consecutiveErrors', 'sa_backoffMultiplier'
      ]);
      const today = new Date().toDateString();
      if (data.sa_lastResetDate === today) {
        this.dailyTaskCount = Number(data.sa_dailyTaskCount) || 0;
        this.lastResetDate = today;
        console.log(`[RateLimiter] Restored daily count: ${this.dailyTaskCount}/${this.DAILY_LIMIT}`);
      } else {
        // New day — reset
        this.dailyTaskCount = 0;
        this.lastResetDate = today;
        await this._persistDaily();
        console.log('[RateLimiter] New day — daily counter reset.');
      }

      const sessionCount = Number(data.sa_sessionTaskCount);
      if (Number.isFinite(sessionCount) && sessionCount >= 0) {
        this.sessionTaskCount = sessionCount;
      }
      const threshold = Number(data.sa_sessionBreakThreshold);
      if (Number.isFinite(threshold) && threshold >= 10 && threshold <= 100) {
        this.sessionBreakThreshold = threshold;
      }
      const totalTasks = Number(data.sa_totalTasksThisSession);
      if (Number.isFinite(totalTasks) && totalTasks >= 0) {
        this.totalTasksThisSession = totalTasks;
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

  _persistSession() {
    try {
      chrome.storage.local.set({
        sa_sessionTaskCount: this.sessionTaskCount,
        sa_sessionBreakThreshold: this.sessionBreakThreshold,
        sa_totalTasksThisSession: this.totalTasksThisSession,
        sa_consecutiveErrors: this.consecutiveErrors,
        sa_backoffMultiplier: this.backoffMultiplier
      });
    } catch (e) {}
  },

  async _persistDaily() {
    try {
      await chrome.storage.local.set({
        sa_dailyTaskCount: this.dailyTaskCount,
        sa_lastResetDate: this.lastResetDate
      });
    } catch (e) {}
  },

  checkDailyLimit() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyTaskCount = 0;
      this.lastResetDate = today;
      this._persistDaily();
    }
    return this.dailyTaskCount < this.DAILY_LIMIT;
  },

  recordDailyTask() {
    this.dailyTaskCount++;
    this._persistDaily();
  },

  getDailyRemaining() {
    return Math.max(0, this.DAILY_LIMIT - this.dailyTaskCount);
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
    
    return Math.round(delay);
  },

  /**
   * Wait for the calculated delay
   */
  async wait() {
    const delay = this.getDelay();
    await new Promise(resolve => setTimeout(resolve, delay));
    return delay;
  },

  // ============================================================
  // ERROR TRACKING
  // ============================================================
  reportSuccess() {
    this.consecutiveErrors = 0;
    this.backoffMultiplier = 1;
    this.totalTasksThisSession++;
    this.recordTaskCompleted();
    this.recordDailyTask();
    this._persistSession();
  },

  reportError() {
    this.consecutiveErrors++;
    this.backoffMultiplier = Math.min(10, Math.pow(1.5, this.consecutiveErrors));
    this.totalTasksThisSession++;
    this.recordTaskCompleted();
    this.recordDailyTask();
    this._persistSession();
  },

  /**
   * Extra page visit (e.g. follower lookup) that is not a task but still
   * counts toward the session-break budget.
   */
  async recordAuxiliaryVisit() {
    this.sessionTaskCount++;
    this._persistSession();
  },

  // ============================================================
  // STATUS & ESTIMATES
  // ============================================================
  getStatus() {
    return {
      mode: this.currentMode,
      modeLabel: this.MODES[this.currentMode]?.label || this.currentMode,
      sessionTasks: this.sessionTaskCount,
      sessionBreakAt: this.sessionBreakThreshold,
      dailyTasks: this.dailyTaskCount,
      dailyLimit: this.DAILY_LIMIT,
      dailyRemaining: this.getDailyRemaining(),
      isWarmup: this.isWarmingUp(),
      fatigue: this.getFatigueMultiplier(),
      backoff: this.backoffMultiplier,
    };
  },

  estimateTime(remainingCount) {
    const { min, max } = this.MODES[this.currentMode];
    const avgDelay = ((min + max) / 2) * this.backoffMultiplier;
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

if (typeof module !== 'undefined') module.exports = RateLimiter;
