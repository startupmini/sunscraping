document.addEventListener('DOMContentLoaded', () => {
  const DEFAULT_API_BASE = 'http://localhost:5000';
  const HEALTH_TIMEOUT_MS = 4000;
  const HEALTH_REFRESH_MS = 8000;
  const STATUS_REFRESH_MS = 7000;

  const toggleBtn = document.getElementById('toggleBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const statusBadge = document.getElementById('statusBadge');
  const statusHint = document.getElementById('statusHint');
  const modeValue = document.getElementById('modeValue');
  const quotaValue = document.getElementById('quotaValue');
  const queueValue = document.getElementById('queueValue');
  const dashboardLink = document.getElementById('dashboardLink');

  const state = {
    active: false,
    configured: false,
    error: null,
    rate: null,
    queue: null,
    base: DEFAULT_API_BASE,
    backend: 'unknown',
    loading: true,
  };

  let healthController = null;

  function normalizeBase(value) {
    const base = String(value || '').trim().replace(/\/+$/, '');
    if (!base) return DEFAULT_API_BASE;
    try {
      const url = new URL(base);
      const loopback = url.hostname === 'localhost'
        || url.hostname === '127.0.0.1'
        || url.hostname === '::1'
        || url.hostname === '[::1]';
      if (!loopback || url.username || url.password) return DEFAULT_API_BASE;
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_API_BASE;
      return base;
    } catch (error) {
      return DEFAULT_API_BASE;
    }
  }

  function applyBase(value) {
    const base = normalizeBase(value);
    const changed = base !== state.base;
    state.base = base;
    if (dashboardLink) {
      dashboardLink.href = base;
      dashboardLink.title = 'Buka ' + base;
    }
    return changed;
  }

  function baseLabel() {
    return state.base.replace(/^https?:\/\//, '');
  }

  function refreshStatus() {
    chrome.runtime.sendMessage({ action: 'getWorkerStatus' }, (response) => {
      state.loading = false;
      if (chrome.runtime.lastError) {
        state.error = 'Tidak dapat menghubungi background worker. Muat ulang ekstensi.';
      } else {
        const baseChanged = applyBase(response && response.apiBase);
        state.active = Boolean(response && response.active);
        state.configured = Boolean(response && response.configured);
        state.error = response && response.error ? response.error : null;
        state.rate = response && response.rate ? response.rate : null;
        state.queue = response && Number.isFinite(response.queue) ? response.queue : null;
        if (baseChanged) checkBackend();
      }
      render();
    });
  }

  async function checkBackend() {
    if (healthController) healthController.abort();
    const controller = new AbortController();
    healthController = controller;
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    try {
      const response = await fetch(state.base + '/api/health', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Backend merespons ' + response.status);
      if (healthController === controller) state.backend = 'online';
    } catch (error) {
      if (healthController === controller) state.backend = 'offline';
    } finally {
      clearTimeout(timer);
      if (healthController === controller) {
        healthController = null;
        render();
      }
    }
  }

  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  toggleBtn.addEventListener('click', () => {
    if (toggleBtn.disabled) return;
    toggleBtn.disabled = true;
    chrome.runtime.sendMessage({ action: 'toggleWorker', active: !state.active }, (response) => {
      if (chrome.runtime.lastError) {
        state.error = 'Worker tidak merespons. Coba lagi.';
        render();
        return;
      }
      state.active = Boolean(response && response.active);
      state.error = response && response.error ? response.error : null;
      if (state.active) {
        state.error = null;
        state.configured = true;
      }
      render();
      refreshStatus();
      checkBackend();
    });
  });

  function setBadge(kind, label) {
    statusBadge.className = 'status-badge ' + kind;
    statusBadge.replaceChildren();

    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.setAttribute('aria-hidden', 'true');

    statusBadge.appendChild(dot);
    statusBadge.appendChild(document.createTextNode(label));
  }

  function setToggle(active) {
    toggleBtn.className = 'btn ' + (active ? 'btn-stop' : 'btn-start');
    toggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    toggleBtn.replaceChildren();

    const icon = document.createElement('span');
    icon.className = 'btn-icon ' + (active ? 'btn-icon-stop' : 'btn-icon-play');
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'btn-label';
    label.textContent = active ? 'Hentikan worker' : 'Mulai worker';

    toggleBtn.appendChild(icon);
    toggleBtn.appendChild(label);
  }

  function setRateDisplay() {
    const rate = state.rate;
    modeValue.textContent = rate && rate.modeLabel ? rate.modeLabel : 'Mode aman';
    quotaValue.textContent = rate && Number.isFinite(rate.dailyRemaining) && Number.isFinite(rate.dailyLimit)
      ? rate.dailyRemaining + ' / ' + rate.dailyLimit
      : '—';
    queueValue.textContent = Number.isFinite(state.queue) ? state.queue : '—';
  }

  function render() {
    setRateDisplay();
    setToggle(state.active);

    let hint = '';
    let badgeKind = 'status-idle';
    let badgeLabel = 'Siaga';

    if (state.loading) {
      hint = 'Memeriksa status worker…';
      badgeLabel = 'Memuat';
    } else if (state.error) {
      hint = state.error;
      badgeKind = 'status-error';
      badgeLabel = 'Terhenti';
    } else if (!state.configured) {
      hint = 'API key belum diatur. Buka Pengaturan untuk mulai.';
      badgeLabel = 'Belum siap';
    } else if (state.backend === 'offline') {
      hint = 'Backend tidak merespons di ' + baseLabel() + '.';
      badgeKind = 'status-error';
      badgeLabel = 'Offline';
    } else if (state.active) {
      hint = 'Worker memproses antrean. Biarkan Chrome tetap terbuka.';
      badgeKind = 'status-active';
      badgeLabel = 'Aktif';
    } else if (Number.isFinite(state.queue) && state.queue > 0) {
      hint = state.queue + ' target menunggu. Klik Mulai worker untuk memproses.';
      badgeLabel = 'Siaga';
    } else {
      hint = 'Siap memproses antrean Instagram dan TikTok.';
    }

    statusHint.textContent = hint;
    statusHint.classList.toggle('status-error', Boolean(state.error));
    setBadge(badgeKind, badgeLabel);

    const blockedByBackend = state.backend === 'offline' && !state.active;
    toggleBtn.disabled = state.loading || !state.configured || blockedByBackend;
  }

  applyBase(DEFAULT_API_BASE);
  refreshStatus();
  checkBackend();
  setInterval(refreshStatus, STATUS_REFRESH_MS);
  setInterval(checkBackend, HEALTH_REFRESH_MS);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.sa_api_base) {
      applyBase(changes.sa_api_base.newValue);
      checkBackend();
    }
    if (changes.sa_api_key) {
      state.configured = Boolean(String(changes.sa_api_key.newValue || '').trim());
      render();
    }
  });
});
