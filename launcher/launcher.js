(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    statusPill: $('statusPill'),
    statusText: $('statusText'),
    heroTitle: $('heroTitle'),
    heroSub: $('heroSub'),
    btnStart: $('btnStart'),
    btnStop: $('btnStop'),
    btnRestart: $('btnRestart'),
    btnDashboard: $('btnDashboard'),
    heroNote: $('heroNote'),
    metaEndpoint: $('metaEndpoint'),
    metaPid: $('metaPid'),
    metaVersion: $('metaVersion'),
    metaOwner: $('metaOwner'),
    queueStamp: $('queueStamp'),
    statPending: $('statPending'),
    statRunning: $('statRunning'),
    statOk: $('statOk'),
    statFailed: $('statFailed'),
    statsNote: $('statsNote'),
    apiKeyMasked: $('apiKeyMasked'),
    btnCopyKey: $('btnCopyKey'),
    apiBase: $('apiBase'),
    btnCopyBase: $('btnCopyBase'),
    logDetails: $('logDetails'),
    logMeta: $('logMeta'),
    logPath: $('logPath'),
    btnRefreshLog: $('btnRefreshLog'),
    logOutput: $('logOutput'),
    launcherMeta: $('launcherMeta'),
    btnQuit: $('btnQuit'),
    closedScreen: $('closedScreen'),
    closedDashboard: $('closedDashboard'),
    confirmDialog: $('confirmDialog'),
    confirmTitle: $('confirmTitle'),
    confirmBody: $('confirmBody'),
    confirmCancel: $('confirmCancel'),
    confirmOk: $('confirmOk'),
    toast: $('toast'),
  };

  const number = new Intl.NumberFormat('id-ID');
  let status = null;
  let fetchError = '';
  let pending = null;
  let refreshPromise = null;
  let refreshErrorShown = false;
  let toastTimer = null;
  let logTimer = null;
  let logLoading = false;
  let confirmResolve = null;
  let sessionReloaded = sessionStorage.getItem('sa_launcher_reloaded') === '1';

  function value(value) {
    return value === null || value === undefined || value === ''
      ? '—'
      : number.format(Number(value) || 0);
  }

  function text(node, message) {
    if (node) node.textContent = message;
  }

  function visible(node, show) {
    if (node) node.hidden = !show;
  }

  async function call(path, options = {}) {
    const headers = Object.assign({ 'X-Launcher': '1' }, options.headers || {});
    const response = await fetch(path, Object.assign(
      { credentials: 'same-origin' },
      options,
      { headers }
    ));

    if (response.status === 401 && !sessionReloaded) {
      sessionReloaded = true;
      sessionStorage.setItem('sa_launcher_reloaded', '1');
      window.location.reload();
      throw new Error('Memuat ulang sesi launcher…');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || 'Permintaan launcher gagal.');
    }
    sessionReloaded = false;
    sessionStorage.removeItem('sa_launcher_reloaded');
    return data;
  }

  function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const data = await call('/api/status');
        status = data;
        fetchError = '';
        refreshErrorShown = false;
      } catch (error) {
        fetchError = error.message || 'Launcher tidak merespons.';
        if (!refreshErrorShown) {
          refreshErrorShown = true;
          showToast(fetchError, 'error');
        }
      } finally {
        refreshPromise = null;
        render();
      }
    })();
    return refreshPromise;
  }

  function setPill(kind, message) {
    el.statusPill.className = 'status-pill is-' + kind;
    text(el.statusText, message);
  }

  function render() {
    const backend = (status && status.backend) || {};
    const online = Boolean(backend.online);
    const owner = backend.owner || null;
    const owned = online && owner === 'launcher';
    const external = online && owner === 'external';
    const busy = Boolean(pending || (status && status.busy));
    const phase = pending || (status && status.phase) || null;
    const tasks = backend.tasks || null;

    if (busy) {
      if (phase === 'stop') {
        setPill('busy', 'Menghentikan…');
        text(el.heroTitle, 'Menghentikan server…');
        text(el.heroSub, 'Menutup proses backend dengan rapi. Tunggu sebentar.');
      } else if (phase === 'restart') {
        setPill('busy', 'Merestart…');
        text(el.heroTitle, 'Merestart server…');
        text(el.heroSub, 'Server dihentikan lalu dinyalakan kembali.');
      } else {
        setPill('busy', 'Menyalakan…');
        text(el.heroTitle, 'Menyalakan server…');
        text(el.heroSub, 'Menunggu backend merespons. Biasanya selesai dalam beberapa detik.');
      }
    } else if (online) {
      setPill(external ? 'external' : 'online', external ? 'Online · eksternal' : 'Online');
      text(el.heroTitle, external ? 'Server berjalan.' : 'Server siap.');
      text(
        el.heroSub,
        external
          ? 'Backend aktif di luar launcher. Launcher hanya memantau proses ini.'
          : 'Backend lokal aktif dan siap menerima pekerjaan dari ekstensi.'
      );
    } else {
      setPill('offline', 'Offline');
      text(el.heroTitle, 'Server belum berjalan.');
      text(el.heroSub, 'Mulai backend untuk membuka dashboard dan memproses antrean audit.');
    }

    visible(el.btnStart, !online && (!busy || phase === 'start'));
    visible(el.btnStop, owned && (!busy || phase === 'stop'));
    visible(el.btnRestart, owned && (!busy || phase === 'restart'));
    visible(el.btnDashboard, online && !busy);

    el.btnStart.disabled = busy;
    el.btnStop.disabled = busy;
    el.btnRestart.disabled = busy;
    el.btnStart.classList.toggle('is-loading', busy && phase === 'start');
    el.btnStop.classList.toggle('is-loading', busy && phase === 'stop');
    el.btnRestart.classList.toggle('is-loading', busy && phase === 'restart');

    if (online) {
      el.btnDashboard.href = backend.url || '#';
      el.btnDashboard.title = 'Buka dashboard sunscraping';
    } else {
      el.btnDashboard.href = '#';
      el.btnDashboard.title = 'Server belum aktif';
    }

    text(el.metaEndpoint, backend.url || '—');
    text(el.metaPid, online && backend.pid ? String(backend.pid) : '—');
    text(el.metaVersion, online && backend.version ? String(backend.version) : '—');
    text(
      el.metaOwner,
      online ? (external ? 'Eksternal' : 'Launcher') : '—'
    );

    const notes = [];
    if (external) {
      notes.push('Server ini dijalankan di luar launcher. Hentikan dari jendela asalnya; launcher tidak akan mematikan proses yang bukan miliknya.');
    }
    if (status && status.last_error && !busy) notes.push(status.last_error);
    if (fetchError) notes.push(fetchError);
    text(el.heroNote, notes.join(' '));
    visible(el.heroNote, notes.length > 0);

    if (busy) {
      text(el.queueStamp, 'Memproses');
    } else if (online && tasks) {
      text(el.queueStamp, value(tasks.TARGETS || tasks.TOTAL || 0) + ' target');
    } else if (online) {
      text(el.queueStamp, 'Tanpa statistik');
    } else {
      text(el.queueStamp, 'Menunggu server');
    }

    text(el.statPending, online && tasks ? value(tasks.PENDING) : '—');
    text(el.statRunning, online && tasks ? value(tasks.RUNNING) : '—');
    text(el.statOk, online && tasks ? value(tasks.OK) : '—');
    text(el.statFailed, online && tasks ? value(tasks.FAILED) : '—');
    text(
      el.statsNote,
      busy
        ? 'Menunggu aksi server selesai.'
        : online && tasks
          ? 'Diperbarui otomatis setiap 2 detik.'
          : online
            ? 'Statistik membutuhkan API key yang cocok.'
            : 'Statistik muncul saat server berjalan.'
    );

    const key = (status && status.key) || {};
    text(el.apiKeyMasked, key.available ? key.masked : 'Belum tersedia');
    el.btnCopyKey.disabled = !key.available;
    text(el.apiBase, backend.url || 'http://127.0.0.1:5000');

    const log = (status && status.log) || {};
    text(el.logMeta, log.exists ? 'Tersedia' : 'Belum ada');
    if (log.path) text(el.logPath, log.path);
    text(
      el.launcherMeta,
      'Launcher v' + ((status && status.launcher && status.launcher.version) || '1.0') +
      ' · hanya loopback · data tidak keluar dari perangkat ini'
    );
  }

  function showToast(message, kind = 'info') {
    if (!el.toast) return;
    el.toast.className = 'toast' + (kind === 'error' ? ' is-error' : kind === 'success' ? ' is-success' : '');
    text(el.toast, message);
    el.toast.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      el.toast.hidden = true;
    }, 4200);
  }

  function finishConfirm(result) {
    const resolve = confirmResolve;
    confirmResolve = null;
    if (el.confirmDialog.open) el.confirmDialog.close();
    if (resolve) resolve(result);
  }

  function askConfirm({ title, body, label = 'Ya, lanjutkan', danger = true }) {
    if (el.confirmDialog.open) finishConfirm(false);
    return new Promise((resolve) => {
      confirmResolve = resolve;
      text(el.confirmTitle, title);
      text(el.confirmBody, body);
      text(el.confirmOk, label);
      el.confirmOk.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
      el.confirmDialog.showModal();
      el.confirmCancel.focus();
    });
  }

  async function runAction(name, path, confirmOptions) {
    if (pending) return;
    if (confirmOptions) {
      const confirmed = await askConfirm(confirmOptions);
      if (!confirmed) return;
    }
    pending = name;
    render();
    try {
      const result = await call(path, { method: 'POST' });
      if (result.status) status = result.status;
      showToast(result.message || 'Selesai.', 'success');
      await refresh();
      if (el.logDetails.open) await loadLog();
    } catch (error) {
      showToast(error.message || 'Aksi gagal.', 'error');
      await refresh();
    } finally {
      pending = null;
      render();
    }
  }

  function activeTasks() {
    const tasks = (status && status.backend && status.backend.tasks) || null;
    if (!tasks) return 0;
    return (Number(tasks.RUNNING) || 0) + (Number(tasks.PENDING) || 0);
  }

  async function copyText(valueToCopy) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(valueToCopy);
        return;
      } catch (error) {
        // Fall through to the selection-based fallback.
      }
    }
    const helper = document.createElement('textarea');
    helper.className = 'clipboard-helper';
    helper.value = valueToCopy;
    helper.setAttribute('readonly', '');
    document.body.appendChild(helper);
    helper.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } finally {
      helper.remove();
    }
    if (!copied) throw new Error('Clipboard tidak tersedia di browser ini.');
  }

  async function copyKey() {
    if (el.btnCopyKey.disabled) return;
    el.btnCopyKey.disabled = true;
    try {
      const data = await call('/api/key');
      await copyText(data.key);
      showToast('API key berhasil disalin.', 'success');
    } catch (error) {
      showToast(error.message || 'Gagal menyalin API key.', 'error');
    } finally {
      render();
    }
  }

  async function copyBase() {
    const url = (status && status.backend && status.backend.url) || el.apiBase.textContent;
    try {
      await copyText(url);
      showToast('API base berhasil disalin.', 'success');
    } catch (error) {
      showToast(error.message || 'Gagal menyalin API base.', 'error');
    }
  }

  async function loadLog() {
    if (!el.logDetails.open || logLoading) return;
    logLoading = true;
    text(el.logMeta, 'Memuat…');
    try {
      const data = await call('/api/log?lines=120');
      const lines = Array.isArray(data.lines) ? data.lines : [];
      text(el.logOutput, lines.length
        ? lines.join('\n')
        : 'Belum ada log server. Log muncul setelah server dinyalakan.');
      text(el.logMeta, data.exists ? 'Tersedia' : 'Belum ada');
      if (data.path) text(el.logPath, data.path);
    } catch (error) {
      text(el.logOutput, error.message || 'Gagal memuat log.');
      text(el.logMeta, 'Gagal dimuat');
    } finally {
      logLoading = false;
    }
  }

  function startLogTimer() {
    if (logTimer) return;
    logTimer = window.setInterval(() => {
      if (el.logDetails.open) loadLog();
    }, 5000);
  }

  function stopLogTimer() {
    if (logTimer) {
      window.clearInterval(logTimer);
      logTimer = null;
    }
  }

  async function quitLauncher() {
    const confirmed = await askConfirm({
      title: 'Keluar dari launcher?',
      body: 'Server backend tetap berjalan dan dashboard tetap bisa dibuka. Hanya halaman kontrol ini yang ditutup.',
      label: 'Keluar launcher',
      danger: false,
    });
    if (!confirmed) return;
    try {
      await call('/api/quit', { method: 'POST' });
      const topbar = document.querySelector('.topbar');
      const main = document.querySelector('main');
      if (topbar) topbar.hidden = true;
      if (main) main.hidden = true;
      el.closedScreen.hidden = false;
      el.closedDashboard.href = (status && status.backend && status.backend.url) || '#';
    } catch (error) {
      showToast(error.message || 'Gagal menutup launcher.', 'error');
    }
  }

  el.btnStart.addEventListener('click', () => {
    runAction('start', '/api/start');
  });

  el.btnStop.addEventListener('click', () => {
    const active = activeTasks();
    runAction('stop', '/api/stop', {
      title: 'Hentikan server?',
      body: active
        ? number.format(active) + ' target masih menunggu atau berjalan. Menghentikan server akan memutus prosesnya.'
        : 'Dashboard tidak dapat dibuka sampai server dinyalakan lagi.',
      label: 'Hentikan',
      danger: true,
    });
  });

  el.btnRestart.addEventListener('click', () => {
    const active = activeTasks();
    runAction('restart', '/api/restart', {
      title: 'Restart server?',
      body: active
        ? number.format(active) + ' target masih menunggu atau berjalan. Restart akan memutus proses yang sedang berjalan.'
        : 'Server akan dihentikan lalu dinyalakan kembali.',
      label: 'Restart',
      danger: true,
    });
  });

  el.btnCopyKey.addEventListener('click', copyKey);
  el.btnCopyBase.addEventListener('click', copyBase);
  el.btnRefreshLog.addEventListener('click', loadLog);
  el.btnQuit.addEventListener('click', quitLauncher);

  el.logDetails.addEventListener('toggle', () => {
    if (el.logDetails.open) {
      loadLog();
      startLogTimer();
    } else {
      stopLogTimer();
    }
  });

  el.confirmCancel.addEventListener('click', () => finishConfirm(false));
  el.confirmOk.addEventListener('click', () => finishConfirm(true));
  el.confirmDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    finishConfirm(false);
  });
  el.confirmDialog.addEventListener('click', (event) => {
    if (event.target === el.confirmDialog) finishConfirm(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  window.addEventListener('online', refresh);

  refresh();
  window.setInterval(() => {
    if (!document.hidden) refresh();
  }, 2000);
})();
