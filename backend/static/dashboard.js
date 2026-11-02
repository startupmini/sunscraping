(function () {
  'use strict';

  var STORAGE_KEY = 'sa_dashboard_audit';
  var ALL_AUDITS_KEY = 'sa_dashboard_all_audits';
  var POLL_MS = 5000;
  var RECONNECT_MS = 10000;
  var REFRESH_LABEL_MS = 30000;
  var TARGETS_REFRESH_MS = 7000;

  var el = {
    workerPill: document.getElementById('workerPill'),
    workerPillText: document.getElementById('workerPillText'),
    offlineBanner: document.getElementById('offlineBanner'),
    offlineText: document.getElementById('offlineText'),
    offlineRetry: document.getElementById('offlineRetry'),
    streamPill: document.getElementById('streamPill'),
    streamPillText: document.getElementById('streamPillText'),
    openImportBtn: document.getElementById('openImportBtn'),
    openExportBtn: document.getElementById('openExportBtn'),
    openManageBtn: document.getElementById('openManageBtn'),
    auditSelect: document.getElementById('auditSelect'),
    auditMeta: document.getElementById('auditMeta'),
    rerunBtn: document.getElementById('rerunBtn'),
    retryFailedBtn: document.getElementById('retryFailedBtn'),
    settingsBtn: document.getElementById('settingsBtn'),
    deleteAuditBtn: document.getElementById('deleteAuditBtn'),
    statPending: document.getElementById('stat-pending'),
    statRunning: document.getElementById('stat-running'),
    statOk: document.getElementById('stat-ok'),
    statPartial: document.getElementById('stat-partial'),
    statFailed: document.getElementById('stat-failed'),
    liveFeedBody: document.getElementById('liveFeedBody'),
    activityHead: document.getElementById('activityHead'),
    tableWrap: document.getElementById('tableWrap'),
    emptyState: document.getElementById('emptyState'),
    emptyCopy: document.getElementById('emptyCopy'),
    tabTargets: document.getElementById('tabTargets'),
    tabActivity: document.getElementById('tabActivity'),
    targetPanel: document.getElementById('targetPanel'),
    activityPanel: document.getElementById('activityPanel'),
    targetSearch: document.getElementById('targetSearch'),
    targetStatus: document.getElementById('targetStatus'),
    targetPlatform: document.getElementById('targetPlatform'),
    targetHead: document.getElementById('targetHead'),
    targetBody: document.getElementById('targetBody'),
    targetTableWrap: document.getElementById('targetTableWrap'),
    targetEmpty: document.getElementById('targetEmpty'),
    targetEmptyTitle: document.getElementById('targetEmptyTitle'),
    targetEmptyCopy: document.getElementById('targetEmptyCopy'),
    targetResetBtn: document.getElementById('targetResetBtn'),
    targetPager: document.getElementById('targetPager'),
    targetPageInfo: document.getElementById('targetPageInfo'),
    targetPrev: document.getElementById('targetPrev'),
    targetNext: document.getElementById('targetNext'),
    dropzone: document.getElementById('dropzone'),
    fileInput: document.getElementById('fileInput'),
    fileChip: document.getElementById('fileChip'),
    fileName: document.getElementById('fileName'),
    fileSize: document.getElementById('fileSize'),
    removeFileBtn: document.getElementById('removeFile'),
    previewWrap: document.getElementById('previewWrap'),
    previewHead: document.getElementById('previewHead'),
    previewBody: document.getElementById('previewBody'),
    previewNote: document.getElementById('previewNote'),
    templateBtn: document.getElementById('templateBtn'),
    uploadForm: document.getElementById('uploadForm'),
    uploadBtn: document.getElementById('uploadBtn'),
    uploadStatus: document.getElementById('uploadStatus'),
    auditName: document.getElementById('auditName'),
    repeatDays: document.getElementById('repeatDays'),
    newAuditFields: document.getElementById('newAuditFields'),
    repeatHint: document.getElementById('repeatHint'),
    appendMode: document.getElementById('appendMode'),
    appendHint: document.getElementById('appendHint'),
    exportBtn: document.getElementById('exportBtn'),
    exportStatus: document.getElementById('exportStatus'),
    exportHint: document.getElementById('exportHint'),
    clearBtn: document.getElementById('clearBtn'),
    lastSync: document.getElementById('lastSync'),
    workerNotice: document.getElementById('workerNotice'),
    workerNoticeText: document.getElementById('workerNoticeText'),
    workerNoticeDismiss: document.getElementById('workerNoticeDismiss'),
    targetSkeleton: document.getElementById('targetSkeleton'),
    activitySkeleton: document.getElementById('activitySkeleton'),
    activityNote: document.getElementById('activityNote'),
    erInfoBtn: document.getElementById('erInfoBtn'),
    erInfo: document.getElementById('erInfo'),
    manageNote: document.getElementById('manageNote'),
    targetRetryBtn: document.getElementById('targetRetryBtn'),
    emptyImportBtn: document.getElementById('emptyImportBtn'),
    activityImportBtn: document.getElementById('activityImportBtn'),
    summaryItems: Array.prototype.slice.call(document.querySelectorAll('.summary-item')),
    toastContainer: document.getElementById('toastContainer'),
    importModal: document.getElementById('importModal'),
    closeImport: document.getElementById('closeImport'),
    cancelImport: document.getElementById('cancelImport'),
    exportModal: document.getElementById('exportModal'),
    closeExport: document.getElementById('closeExport'),
    cancelExport: document.getElementById('cancelExport'),
    manageModal: document.getElementById('manageModal'),
    closeManage: document.getElementById('closeManage'),
    cancelManage: document.getElementById('cancelManage'),
    settingsModal: document.getElementById('settingsModal'),
    settingsForm: document.getElementById('settingsForm'),
    settingsName: document.getElementById('settingsName'),
    settingsRepeat: document.getElementById('settingsRepeat'),
    settingsSub: document.getElementById('settingsSub'),
    cancelSettings: document.getElementById('cancelSettings'),
    saveSettings: document.getElementById('saveSettings'),
    historyModal: document.getElementById('historyModal'),
    historyTitle: document.getElementById('historyTitle'),
    historySub: document.getElementById('historySub'),
    historyTrend: document.getElementById('historyTrend'),
    trendGrid: document.getElementById('trendGrid'),
    historyBody: document.getElementById('historyBody'),
    historyClose: document.getElementById('historyClose'),
    confirmModal: document.getElementById('confirmModal'),
    confirmTitle: document.getElementById('confirmTitle'),
    confirmBody: document.getElementById('confirmBody'),
    confirmCancel: document.getElementById('confirmCancel'),
    confirmOk: document.getElementById('confirmOk')
  };

  var currentAuditId = (function () {
    var stored = localStorage.getItem(STORAGE_KEY);
    return stored && /^\d+$/.test(stored) ? Number(stored) : null;
  })();

  var audits = [];
  var lastStats = null;
  var lastRows = [];
  var rowsSignature = '';
  var auditsSignature = '';
  var connection = null;
  var unauthorizedShown = false;
  var stream = null;
  var pollTimer = null;
  var reconnectTimer = null;
  var pollBusy = false;
  var pendingConfirm = null;
  var modalStack = [];
  var uploadInFlight = false;
  var lastSyncAt = null;
  var workerState = 'idle';
  var workerSeenLabel = '';
  var noticeDismissed = false;
  var initialTab = 'targets';

  var autoSelectAudit = !currentAuditId && localStorage.getItem(ALL_AUDITS_KEY) !== '1';

  var targetState = {
    status: '',
    platform: '',
    query: '',
    sort: 'recent',
    dir: 'desc',
    limit: 25,
    offset: 0,
    total: 0,
    items: [],
    signature: '',
    loading: false,
    requestId: 0,
    lastFetch: 0
  };

  var activitySort = { key: 'time', dir: 'desc' };
  var activeTab = 'targets';
  var searchTimer = null;
  var previewRequest = 0;

  // ---------- Helpers ----------
  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatNumber(value) {
    var num = Number(value);
    if (value === null || value === undefined || value === '' || !isFinite(num)) return '—';
    return num.toLocaleString('id-ID');
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    var units = ['B', 'KB', 'MB'];
    var index = 0;
    var size = bytes;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return (index === 0 ? size : size.toFixed(1)) + ' ' + units[index];
  }

  function parseServerTime(value) {
    if (!value) return null;
    var text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
      text = text.replace(' ', 'T') + 'Z';
    }
    var date = new Date(text);
    return isNaN(date.getTime()) ? null : date;
  }

  function timeRelative(value) {
    var date = parseServerTime(value);
    if (!date) return '—';
    var diff = Math.round((date.getTime() - Date.now()) / 1000);
    var future = diff > 0;
    var abs = Math.abs(diff);
    var text;
    if (abs < 60) text = 'kurang dari 1 menit';
    else if (abs < 3600) text = Math.round(abs / 60) + ' menit';
    else if (abs < 86400) text = Math.round(abs / 3600) + ' jam';
    else if (abs < 2592000) text = Math.round(abs / 86400) + ' hari';
    else text = Math.round(abs / 2592000) + ' bulan';
    return future ? 'dalam ' + text : text + ' lalu';
  }

  function formatDateTime(value) {
    var date = parseServerTime(value);
    if (!date) return '—';
    return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function calcEr(platform, likes, comments, views, shares, followers) {
    var l = Number(likes) || 0;
    var c = Number(comments) || 0;
    var v = Number(views) || 0;
    var s = Number(shares) || 0;
    var f = Number(followers) || 0;
    if (platform === 'tiktok') {
      return v > 0 ? ((l + c + s) / v) * 100 : null;
    }
    return f > 0 ? ((l + c) / f) * 100 : null;
  }

  function formatEr(value) {
    return value === null || value === undefined || !isFinite(value)
      ? '—'
      : value.toFixed(2) + '%';
  }

  function deltaNode(current, previous, suffix) {
    if (current === null || current === undefined || previous === null || previous === undefined) return null;
    var c = Number(current);
    var p = Number(previous);
    if (!isFinite(c) || !isFinite(p) || p === 0) return null;
    var diff = c - p;
    var percent = (diff / Math.abs(p)) * 100;
    var node = make('span',
      'metric-sub ' + (diff > 0 ? 'delta-up' : diff < 0 ? 'delta-down' : 'delta-flat'));
    var sign = diff > 0 ? '+' : '';
    if (suffix === 'pp') {
      node.textContent = sign + diff.toFixed(2) + ' pp';
    } else {
      node.textContent = sign + formatNumber(diff) + ' (' + sign + percent.toFixed(1).replace('.', ',') + '%)';
    }
    return node;
  }

  function platformLabel(platform) {
    if (platform === 'instagram') return 'Instagram';
    if (platform === 'tiktok') return 'TikTok';
    return 'Platform tidak dikenal';
  }

  function platformDot(platform) {
    var dot = make('span', 'platform-dot ' + (platform || ''));
    var label = platformLabel(platform);
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', label);
    dot.title = label;
    return dot;
  }

  function statusMeta(status) {    if (status === 'OK') return { cls: 'badge-ok', label: 'Selesai' };
    if (status === 'PARTIAL') return { cls: 'badge-partial', label: 'Sebagian' };
    if (status === 'RUNNING') return { cls: 'badge-running', label: 'Berjalan' };
    if (status === 'PENDING') return { cls: 'badge-pending', label: 'Menunggu' };
    return { cls: 'badge-failed', label: 'Gagal' };
  }

  function errorLabel(item) {
    var code = item.error_code || '';
    var message = String(item.error_message || '').toLowerCase();
    if (code === 'AUTH') return 'Login platform diperlukan';
    if (code === 'THROTTLED') return 'Dibatasi sementara oleh platform';
    if (message.indexOf('privat') >= 0 || message.indexOf('private') >= 0) return 'Akun atau postingan privat';
    if (/not found|tidak ditemukan|\b404\b/.test(message)) return 'Postingan tidak ditemukan';
    if (code === 'TRANSIENT') return 'Gagal sementara, akan dicoba ulang';
    if (code === 'PERMANENT') return 'Gagal permanen, perlu tinjauan';
    if (message) return 'Perlu tinjauan';
    return 'Menunggu diulang';
  }

  function statusCell(item) {
    var td = make('td', 'status-cell');
    var status = item.status || 'PENDING';
    var meta = statusMeta(status);
    var badge = make('span', 'badge ' + meta.cls, meta.label);
    if (status === 'FAILED' && item.retry_count) badge.textContent = 'Gagal · ' + item.retry_count + 'x';
    if (item.error_message) badge.title = item.error_message;
    else if (status === 'PARTIAL') badge.title = 'Sebagian metrik tidak berhasil diambil.';
    else if (status === 'PENDING') badge.title = 'Menunggu worker memproses target ini.';
    td.appendChild(badge);
    if (status === 'FAILED') {
      var hint = make('span', 'cell-sub is-error', errorLabel(item));
      if (item.error_message) hint.title = item.error_message;
      td.appendChild(hint);
    }
    return td;
  }

  function auditQuery(extra) {
    var query = currentAuditId ? 'audit_id=' + encodeURIComponent(currentAuditId) : '';
    if (extra) query = query ? query + '&' + extra : extra;
    return query ? '?' + query : '';
  }

  function selectedAudit() {
    if (!currentAuditId) return null;
    for (var i = 0; i < audits.length; i += 1) {
      if (Number(audits[i].id) === currentAuditId) return audits[i];
    }
    return null;
  }

  function auditTargetCount() {
    return audits.reduce(function (sum, item) {
      return sum + (Number(item.target_count) || 0);
    }, 0);
  }


  // ---------- Toast ----------
  function toast(kind, message) {
    var node = make('div', 'toast toast-' + kind);

    var icon = make('span', 'toast-icon', kind === 'success' ? '✓' : kind === 'error' ? '!' : 'i');
    icon.setAttribute('aria-hidden', 'true');

    var body = make('div', 'toast-body', message);

    var close = make('button', 'toast-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Tutup notifikasi');

    function dismiss() {
      if (!node.isConnected) return;
      node.classList.add('is-leaving');
      setTimeout(function () { node.remove(); }, 180);
    }

    close.addEventListener('click', dismiss);
    node.appendChild(icon);
    node.appendChild(body);
    node.appendChild(close);
    el.toastContainer.appendChild(node);

    while (el.toastContainer.children.length > 3) {
      el.toastContainer.removeChild(el.toastContainer.firstElementChild);
    }

    setTimeout(dismiss, 4500);
  }

  // ---------- Connection state ----------
  function showOffline(message) {
    el.offlineText.textContent = message || 'Koneksi ke backend terputus. Data yang tampil mungkin sudah lama.';
    el.offlineBanner.hidden = false;
  }

  function hideOffline() {
    el.offlineBanner.hidden = true;
  }

  function setStreamState(state) {
    if (state === connection) return;
    var previous = connection;
    connection = state;

    el.streamPill.classList.toggle('is-online', state === 'live');
    el.streamPill.classList.toggle('is-polling', state === 'polling');
    el.streamPill.classList.toggle('is-offline', state === 'offline');
    el.streamPill.hidden = state === 'live';
    el.streamPillText.textContent =
      state === 'live' ? 'Live' : state === 'polling' ? 'Polling' : 'Terputus';
    el.streamPill.title = state === 'live'
      ? 'Live via SSE'
      : state === 'polling' ? 'Polling tiap 5 detik' : 'Mencoba menghubungkan…';

    if (state === 'offline') {
      showOffline('Koneksi ke backend terputus. Data yang tampil mungkin sudah lama.');
    } else {
      hideOffline();
    }

    if (previous === 'offline' && state !== 'offline') {
      toast('success', 'Koneksi ke backend pulih.');
    } else if (previous !== null && previous !== 'offline' && state === 'offline') {
      toast('error', 'Koneksi backend terputus. Periksa Control Panel.');
    }

    renderWorkerNotice();
  }

  function renderWorker(seen) {
    var date = parseServerTime(seen);
    var age = date ? (Date.now() - date.getTime()) / 1000 : null;
    var busy = age !== null && age < 45;
    var stale = age !== null && age >= 45 && age < 600;

    workerState = busy ? 'busy' : stale ? 'stale' : 'idle';
    workerSeenLabel = date ? timeRelative(seen) : '';

    el.workerPill.classList.toggle('is-busy', busy);
    el.workerPill.classList.toggle('is-stale', stale);
    el.workerPill.classList.toggle('is-idle', !busy && !stale);
    el.workerPillText.textContent = busy ? 'Worker aktif' : 'Worker idle';
    el.workerPill.title = date
      ? 'Terakhir terlihat ' + timeRelative(seen)
      : 'Worker ekstensi belum pernah menghubungi backend';

    renderWorkerNotice();
  }

  function renderWorkerNotice() {
    if (!el.workerNotice) return;
    var queued = lastStats
      ? (Number(lastStats.PENDING) || 0) + (Number(lastStats.RUNNING) || 0)
      : 0;
    var show = !noticeDismissed && queued > 0 && workerState !== 'busy' && connection !== 'offline';

    if (!show) {
      el.workerNotice.hidden = true;
      return;
    }

    var since = workerSeenLabel ? ' (terakhir terlihat ' + workerSeenLabel + ')' : '';
    el.workerNoticeText.textContent = formatNumber(queued) + ' target menunggu tetapi worker belum berjalan' + since +
      '. Buka ekstensi sunscraping di Chrome, lalu klik Mulai worker.';
    el.workerNotice.hidden = false;
  }

  function renderLastSync() {
    if (!el.lastSync) return;
    if (!lastSyncAt) {
      el.lastSync.textContent = '';
      return;
    }
    var diff = Math.round((Date.now() - lastSyncAt) / 1000);
    el.lastSync.textContent = diff < 10
      ? 'diperbarui baru saja'
      : diff < 120 ? 'diperbarui ' + diff + ' detik lalu'
      : 'diperbarui ' + Math.round(diff / 60) + ' menit lalu';
  }

  function handleUnauthorized() {
    if (unauthorizedShown) return;
    unauthorizedShown = true;
    stopPolling();
    clearReconnect();
    closeStream();
    setStreamState('offline');
    showOffline('Sesi dashboard kedaluwarsa. Muat ulang halaman untuk masuk kembali.');
    toast('error', 'Sesi dashboard kedaluwarsa. Muat ulang halaman lalu coba lagi.');
  }

  async function fetchJson(url, options) {
    var config = Object.assign({ credentials: 'same-origin', headers: { 'Accept': 'application/json' } }, options || {});
    var response = await fetch(url, config);
    if (response.status === 401) {
      handleUnauthorized();
      throw new Error('Sesi dashboard kedaluwarsa.');
    }
    var data = null;
    try { data = await response.json(); } catch (error) { data = null; }
    if (!response.ok) {
      throw new Error((data && data.error) || ('Permintaan gagal (' + response.status + ').'));
    }
    return data;
  }

  function postJson(url, body) {
    return fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body || {})
    });
  }

  // ---------- Audits ----------
  function renderAudits(list) {
    audits = Array.isArray(list) ? list : [];

    var signature = JSON.stringify(audits.map(function (audit) {
      return [audit.id, audit.name, audit.target_count, audit.repeat_days];
    }));

    if (signature !== auditsSignature) {
      auditsSignature = signature;
      rebuildAuditOptions();
    }

    if (currentAuditId && !selectedAudit()) {
      currentAuditId = null;
      localStorage.removeItem(STORAGE_KEY);
      autoSelectAudit = true;
    }

    var autoSelected = false;
    if (!currentAuditId && autoSelectAudit && audits.length) {
      currentAuditId = Number(audits[0].id);
      localStorage.setItem(STORAGE_KEY, String(currentAuditId));
      autoSelectAudit = false;
      autoSelected = true;
    }

    el.auditSelect.value = currentAuditId ? String(currentAuditId) : '';
    updateAuditMeta();
    updateAppendUi();

    if (autoSelected) {
      restartStream();
      loadTargets(true);
    }
  }

  function rebuildAuditOptions() {
    var fragment = document.createDocumentFragment();
    var all = make('option', null, 'Semua audit');
    all.value = '';
    fragment.appendChild(all);

    audits.forEach(function (audit) {
      var option = make('option', null, audit.name);
      option.value = String(audit.id);
      fragment.appendChild(option);
    });

    el.auditSelect.replaceChildren(fragment);
    el.auditSelect.value = currentAuditId ? String(currentAuditId) : '';
  }

  function updateManageNote(hasAudit) {
    if (el.manageNote) el.manageNote.hidden = Boolean(hasAudit);
  }

  function updateAuditMeta() {
    var audit = selectedAudit();
    var meta = el.auditMeta;

    if (!currentAuditId) {
      var totalTargets = auditTargetCount();
      meta.textContent = audits.length
        ? audits.length + ' audit · ' + formatNumber(totalTargets) + ' target'
        : 'Belum ada audit. Impor file untuk memulai.';
      el.rerunBtn.disabled = true;
      el.settingsBtn.disabled = true;
      el.deleteAuditBtn.disabled = true;
      el.rerunBtn.title = 'Pilih satu audit untuk menjalankan ulang';
      el.settingsBtn.title = 'Pengaturan berlaku per audit — pilih satu audit dulu';
      el.deleteAuditBtn.title = 'Pilih audit yang akan dihapus';
      updateManageNote(false);
      updateExportUi();
      updateRetryButton();
      return;
    }

    if (!audit) {
      meta.textContent = 'Audit tidak ditemukan.';
      el.rerunBtn.disabled = true;
      el.settingsBtn.disabled = true;
      el.deleteAuditBtn.disabled = true;
      el.rerunBtn.title = 'Pilih satu audit yang ada untuk menjalankan ulang';
      el.settingsBtn.title = 'Pengaturan berlaku per audit — pilih satu audit dulu';
      el.deleteAuditBtn.title = 'Pilih audit yang akan dihapus';
      updateManageNote(false);
      updateRetryButton();
      return;
    }

    var parts = [];
    parts.push(formatNumber(audit.target_count) + ' target');
    parts.push(audit.repeat_days > 0 ? 'otomatis tiap ' + audit.repeat_days + ' hari' : 'manual');
    if (audit.last_run_at) parts.push('terakhir ' + timeRelative(audit.last_run_at));
    if (audit.repeat_days > 0 && audit.next_due_at) {
      parts.push('jadwal berikutnya ' + timeRelative(audit.next_due_at));
    }

    meta.textContent = audit.name + ' · ' + parts.join(' · ');

    var busy = Number(audit.pending_count) > 0 || Number(audit.running_count) > 0;
    el.rerunBtn.disabled = busy;
    el.rerunBtn.title = busy
      ? 'Selesaikan antrean audit ini sebelum menjadwalkan ulang'
      : 'Jadwalkan ulang semua target di audit ini';
    el.settingsBtn.disabled = false;
    el.deleteAuditBtn.disabled = false;
    updateManageNote(true);
    updateExportUi();

    updateRetryButton();
  }

  function updateRetryButton() {
    var failed = lastStats ? Number(lastStats.FAILED) || 0 : 0;
    el.retryFailedBtn.disabled = !currentAuditId || failed === 0;
    el.retryFailedBtn.title = !currentAuditId
      ? 'Pilih satu audit untuk mengulang target gagal'
      : failed === 0 ? 'Tidak ada target gagal pada audit ini' : 'Jadwalkan ulang ' + failed + ' target gagal';
  }

  function renderStats(stats) {
    stats = stats || {};
    lastStats = stats;
    el.statPending.textContent = formatNumber(stats.PENDING || 0);
    el.statRunning.textContent = formatNumber(stats.RUNNING || 0);
    el.statOk.textContent = formatNumber(stats.OK || 0);
    el.statPartial.textContent = formatNumber(stats.PARTIAL || 0);
    el.statFailed.textContent = formatNumber(stats.FAILED || 0);
    el.statFailed.classList.toggle('is-danger', Number(stats.FAILED) > 0);

    el.summaryItems.forEach(function (item) {
      var key = String(item.getAttribute('data-stat') || '').toUpperCase();
      item.hidden = Number(stats[key] || 0) === 0;
    });

    renderWorker(stats.WORKER_LAST_SEEN);
    updateRetryButton();
    updateAuditMeta();
    updateExportUi();
  }

  // ---------- Shareable state ----------
  function syncUrl() {
    if (!window.history || !window.history.replaceState) return;
    var params = [];
    if (currentAuditId) params.push('audit=' + currentAuditId);
    if (activeTab !== 'targets') params.push('tab=' + activeTab);
    if (targetState.query) params.push('q=' + encodeURIComponent(targetState.query));
    if (targetState.status) params.push('status=' + encodeURIComponent(targetState.status));
    if (targetState.platform) params.push('platform=' + encodeURIComponent(targetState.platform));
    if (targetState.sort !== 'recent') params.push('sort=' + encodeURIComponent(targetState.sort) + '&dir=' + targetState.dir);
    if (targetState.offset > 0) params.push('offset=' + targetState.offset);
    var url = location.pathname + (params.length ? '?' + params.join('&') : '');
    if (url !== location.pathname + location.search) {
      window.history.replaceState(null, '', url);
    }
  }

  function readUrlState() {
    if (typeof URLSearchParams !== 'function') return;
    var params = new URLSearchParams(location.search);
    var audit = params.get('audit');
    if (audit && /^\d+$/.test(audit)) {
      currentAuditId = Number(audit);
      autoSelectAudit = false;
    }
    var tab = params.get('tab');
    if (tab === 'activity' || tab === 'targets') initialTab = tab;
    var status = params.get('status');
    targetState.query = (params.get('q') || '').slice(0, 120);
    targetState.status = ['done', 'pending', 'running', 'failed'].indexOf(status) !== -1 ? status : '';
    var platform = params.get('platform');
    targetState.platform = platform === 'instagram' || platform === 'tiktok' ? platform : '';
    var sort = params.get('sort');
    if (sort && ['username', 'followers', 'likes', 'comments', 'views', 'er'].indexOf(sort) !== -1) {
      targetState.sort = sort;
      targetState.dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
    }
    var offset = Number(params.get('offset'));
    if (isFinite(offset) && offset > 0) targetState.offset = Math.floor(offset / targetState.limit) * targetState.limit;
  }

  // ---------- Target list ----------
  function targetQueryString() {
    var params = [];
    if (currentAuditId) params.push('audit_id=' + encodeURIComponent(currentAuditId));
    if (targetState.status) params.push('status=' + encodeURIComponent(targetState.status));
    if (targetState.platform) params.push('platform=' + encodeURIComponent(targetState.platform));
    if (targetState.query) params.push('q=' + encodeURIComponent(targetState.query));
    params.push('sort=' + encodeURIComponent(targetState.sort));
    params.push('dir=' + encodeURIComponent(targetState.dir));
    params.push('limit=' + targetState.limit);
    params.push('offset=' + targetState.offset);
    return '/api/targets?' + params.join('&');
  }

  async function loadTargets(reset) {
    if (reset) targetState.offset = 0;
    targetState.requestId += 1;
    var requestId = targetState.requestId;
    targetState.lastFetch = Date.now();
    syncUrl();
    try {
      var data = await fetchJson(targetQueryString());
      if (requestId !== targetState.requestId) return;
      targetState.items = Array.isArray(data.items) ? data.items : [];
      targetState.total = Number(data.total) || 0;
      targetState.limit = Number(data.limit) || targetState.limit;
      targetState.offset = Number(data.offset) || 0;
      if (el.targetSkeleton) el.targetSkeleton.hidden = true;
      renderTargets();
    } catch (error) {
      if (el.targetSkeleton) el.targetSkeleton.hidden = true;
      if (unauthorizedShown || requestId !== targetState.requestId) return;
      el.targetTableWrap.hidden = true;
      el.targetPager.hidden = true;
      el.targetEmpty.hidden = false;
      el.targetEmptyTitle.textContent = 'Gagal memuat target';
      el.targetEmptyCopy.textContent = 'Backend tidak dapat dihubungi. Data yang terakhir tampil tetap tersimpan.';
      el.targetResetBtn.hidden = true;
      el.emptyImportBtn.hidden = true;
      el.targetRetryBtn.hidden = false;
    }
  }

  function maybeLoadTargets(force) {
    if (activeTab !== 'targets' || document.hidden) return;
    if (!force && Date.now() - targetState.lastFetch < TARGETS_REFRESH_MS) return;
    loadTargets(false);
  }

  function renderTargets() {
    if (el.targetSkeleton) el.targetSkeleton.hidden = true;
    var items = targetState.items;
    var signature = JSON.stringify({
      audit: currentAuditId,
      total: targetState.total,
      offset: targetState.offset,
      limit: targetState.limit,
      items: items.map(function (item) {
        return [item.target_id, item.status, item.error_code, item.retry_count,
          item.likes, item.comments, item.views, item.shares, item.follower_count,
          item.snapshot_at, item.task_scraped_at];
      })
    });
    if (signature === targetState.signature) {
      updateTargetSortHeaders();
      return;
    }
    targetState.signature = signature;

    if (!items.length) {
      el.targetTableWrap.hidden = true;
      el.targetPager.hidden = true;
      el.targetEmpty.hidden = false;
      el.targetRetryBtn.hidden = true;
      var filtered = Boolean(targetState.status || targetState.platform || targetState.query);
      el.emptyImportBtn.hidden = filtered;
      if (filtered) {
        el.targetEmptyTitle.textContent = 'Tidak ada target yang cocok';
        el.targetEmptyCopy.textContent = 'Ubah kata kunci atau filter untuk melihat target lain.';
        el.targetResetBtn.hidden = false;
      } else if (currentAuditId) {
        el.targetEmptyTitle.textContent = 'Audit ini belum punya target';
        el.targetEmptyCopy.textContent = 'Tambahkan file link ke audit ini untuk mulai mengaudit.';
        el.targetResetBtn.hidden = true;
      } else {
        el.targetEmptyTitle.textContent = 'Belum ada target';
        el.targetEmptyCopy.textContent = 'Impor daftar link untuk mulai mengaudit.';
        el.targetResetBtn.hidden = true;
      }
      if (currentAuditId && items.length === 0 && targetState.status === 'failed') {
        el.targetEmptyCopy.textContent = 'Tidak ada target gagal. Semua target sudah diproses.';
      }
      el.targetBody.replaceChildren();
      updateTargetSortHeaders();
      return;
    }

    var rowsFragment = document.createDocumentFragment();
    items.forEach(function (item) { rowsFragment.appendChild(buildTargetRow(item)); });
    var focusRow = el.targetBody.contains(document.activeElement)
      ? document.activeElement.closest('tr[data-target-id]')
      : null;
    var focusTargetId = focusRow ? focusRow.dataset.targetId : null;
    el.targetBody.replaceChildren(rowsFragment);
    if (focusTargetId) {
      var restore = el.targetBody.querySelector('tr[data-target-id="' + focusTargetId + '"]');
      if (restore) restore.focus();
    }

    el.targetTableWrap.hidden = false;
    el.targetEmpty.hidden = true;

    var start = targetState.offset + 1;
    var end = Math.min(targetState.offset + items.length, targetState.total);
    var page = Math.floor(targetState.offset / targetState.limit) + 1;
    var pages = Math.max(1, Math.ceil(targetState.total / targetState.limit));
    el.targetPageInfo.textContent = 'Halaman ' + page + ' dari ' + pages + ' · ' +
      formatNumber(start) + '–' + formatNumber(end) + ' dari ' + formatNumber(targetState.total) + ' target';
    el.targetPrev.disabled = targetState.offset <= 0;
    el.targetNext.disabled = targetState.offset + items.length >= targetState.total;
    el.targetPager.hidden = false;
    updateTargetSortHeaders();
  }

  function buildTargetRow(item) {
    var tr = make('tr');
    tr.dataset.targetId = item.target_id;
    tr.tabIndex = 0;
    tr.title = (item.url ? item.url + '\n' : '') + 'Klik atau tekan Enter untuk riwayat target';

    var accountTd = make('td', 'account-cell');
    var line = make('span', 'account-line');
    line.appendChild(platformDot(item.platform));
    line.appendChild(make('span', 'account', item.username ? '@' + item.username : (item.url || '—')));
    accountTd.appendChild(line);

    var subParts = [];
    if (item.tema) subParts.push(item.tema);
    if (!currentAuditId && item.audit_name) subParts.push(item.audit_name);
    var fresh = item.snapshot_at || item.task_scraped_at || null;
    subParts.push(fresh ? timeRelative(fresh) : 'Belum dicek');
    var sub = make('span', 'account-sub', subParts.join(' · '));
    if (fresh) sub.title = formatDateTime(fresh);
    accountTd.appendChild(sub);
    tr.appendChild(accountTd);

    tr.appendChild(metricValueCell(item.follower_count));
    tr.appendChild(metricValueCell(item.likes));
    tr.appendChild(metricValueCell(item.comments));
    tr.appendChild(metricValueCell(item.views));

    var erTd = make('td', 'num er');
    erTd.appendChild(make('span', 'metric-value', formatEr(item.engagement_rate)));
    tr.appendChild(erTd);

    tr.appendChild(statusCell(item));

    return tr;
  }

  function metricValueCell(value) {
    var td = make('td', 'num');
    td.appendChild(make('span', 'metric-value', formatNumber(value)));
    return td;
  }

  function sortTargets(key) {
    if (targetState.sort === key) {
      targetState.dir = targetState.dir === 'asc' ? 'desc' : 'asc';
    } else {
      targetState.sort = key;
      targetState.dir = key === 'username' ? 'asc' : 'desc';
    }
    targetState.offset = 0;
    updateTargetSortHeaders();
    loadTargets(false);
  }

  function updateTargetSortHeaders() {
    if (!el.targetHead) return;
    var headers = el.targetHead.querySelectorAll('th[aria-sort]');
    Array.prototype.forEach.call(headers, function (th) {
      var button = th.querySelector('button[data-target-sort]');
      if (!button) return;
      var active = button.dataset.targetSort === targetState.sort;
      th.setAttribute('aria-sort', active ? (targetState.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      var ind = button.querySelector('.sort-ind');
      if (ind) ind.textContent = active ? (targetState.dir === 'asc' ? '↑' : '↓') : '↕';
    });
  }

  function setTab(name, focusTab) {
    activeTab = name === 'activity' ? 'activity' : 'targets';
    var showTargets = activeTab === 'targets';

    el.tabTargets.setAttribute('aria-selected', showTargets ? 'true' : 'false');
    el.tabActivity.setAttribute('aria-selected', showTargets ? 'false' : 'true');
    el.tabTargets.tabIndex = showTargets ? 0 : -1;
    el.tabActivity.tabIndex = showTargets ? -1 : 0;
    el.targetPanel.hidden = !showTargets;
    el.activityPanel.hidden = showTargets;
    syncUrl();

    if (focusTab === 'targets') el.tabTargets.focus();
    if (focusTab === 'activity') el.tabActivity.focus();

    if (showTargets) loadTargets(false);
  }

  // ---------- Activity sorting ----------
  function activityValue(item, key) {
    if (key === 'platform') return item.platform || '';
    if (key === 'account') return String(item.username || '').toLowerCase();
    if (key === 'er') {
      return calcEr(item.platform, item.likes, item.comments, item.views, item.shares, item.follower_count);
    }
    if (key === 'status') {
      return { RUNNING: 0, PENDING: 1, OK: 2, PARTIAL: 3, FAILED: 4 }[item.status] || 5;
    }
    if (key === 'time') {
      var date = parseServerTime(item.scraped_at);
      return date ? date.getTime() : 0;
    }
    var num = Number(item[key]);
    return item[key] === null || item[key] === undefined || !isFinite(num) ? null : num;
  }

  function sortedRows() {
    var copy = lastRows.slice();
    var key = activitySort.key;
    var dir = activitySort.dir === 'asc' ? 1 : -1;
    copy.sort(function (a, b) {
      var av = activityValue(a, key);
      var bv = activityValue(b, key);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (typeof av === 'string' || typeof bv === 'string') {
        var cmp = String(av).localeCompare(String(bv), 'id');
        return cmp * dir;
      }
      return (av - bv) * dir;
    });
    return copy;
  }

  function sortActivity(key) {
    if (activitySort.key === key) {
      activitySort.dir = activitySort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      activitySort.key = key;
      activitySort.dir = key === 'time' ? 'desc' : 'asc';
    }
    updateActivitySortHeaders();
    renderRows(lastRows, true);
  }

  function updateActivitySortHeaders() {
    if (!el.activityHead) return;
    var headers = el.activityHead.querySelectorAll('th[aria-sort]');
    Array.prototype.forEach.call(headers, function (th) {
      var button = th.querySelector('button[data-activity-sort]');
      if (!button) return;
      var active = button.dataset.activitySort === activitySort.key;
      th.setAttribute('aria-sort', active ? (activitySort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      var ind = button.querySelector('.sort-ind');
      if (ind) ind.textContent = active ? (activitySort.dir === 'asc' ? '↑' : '↓') : '↕';
    });
  }

  // ---------- Latest table ----------
  function renderRows(items, force) {
    lastRows = Array.isArray(items) ? items : [];
    if (el.activitySkeleton) el.activitySkeleton.hidden = true;
    if (el.activityNote) {
      el.activityNote.hidden = lastRows.length === 0;
      el.activityNote.textContent = 'Menampilkan ' + lastRows.length + ' snapshot terbaru. Klik baris untuk riwayat lengkap target.';
    }

    if (lastRows.length === 0) {
      el.tableWrap.hidden = true;
      el.emptyState.hidden = false;
      var audit = selectedAudit();
      el.emptyCopy.textContent = audit
        ? 'Belum ada snapshot pada "' + audit.name + '". Jalankan worker dari ekstensi Chrome.'
        : currentAuditId
          ? 'Belum ada snapshot pada audit ini. Jalankan worker dari ekstensi Chrome.'
          : 'Impor daftar link, lalu jalankan worker dari ekstensi Chrome. Hasil akan muncul di sini secara otomatis.';
      el.liveFeedBody.replaceChildren();
      rowsSignature = '';
      return;
    }

    var signature = JSON.stringify({
      sort: activitySort.key + activitySort.dir,
      rows: lastRows.map(function (item) {
        return [item.id, item.status, item.error_code, item.likes, item.comments, item.views,
          item.shares, item.follower_count, item.prev_likes, item.prev_follower_count,
          item.username, item.tema, item.audit_name, item.scraped_at];
      })
    });

    if (!force && signature === rowsSignature) return;
    rowsSignature = signature;

    var fragment = document.createDocumentFragment();
    sortedRows().forEach(function (item) { fragment.appendChild(buildRow(item)); });
    el.liveFeedBody.replaceChildren(fragment);
    el.tableWrap.hidden = false;
    el.emptyState.hidden = true;
  }

  function buildRow(item) {
    var tr = make('tr');
    tr.dataset.targetId = item.target_id;
    tr.tabIndex = 0;
    tr.title = 'Klik atau tekan Enter untuk riwayat target';

    var accountTd = make('td', 'account-cell');
    var line = make('span', 'account-line');
    line.appendChild(platformDot(item.platform));
    line.appendChild(make('span', 'account', '@' + (item.username || '—')));
    accountTd.appendChild(line);
    var subParts = [];
    if (item.tema) subParts.push(item.tema);
    if (!currentAuditId && item.audit_name) subParts.push(item.audit_name);
    if (subParts.length) accountTd.appendChild(make('span', 'account-sub', subParts.join(' · ')));
    tr.appendChild(accountTd);

    tr.appendChild(metricCell(item.follower_count, item.prev_follower_count));
    tr.appendChild(metricCell(item.likes, item.prev_likes));
    tr.appendChild(metricCell(item.comments, item.prev_comments));
    tr.appendChild(metricCell(item.views, item.prev_views));

    var erTd = make('td', 'num er');
    var er = calcEr(item.platform, item.likes, item.comments, item.views, item.shares, item.follower_count);
    var prevEr = calcEr(item.platform, item.prev_likes, item.prev_comments, item.prev_views, item.prev_shares, item.prev_follower_count);
    erTd.appendChild(make('span', 'metric-value', formatEr(er)));
    var erDelta = deltaNode(er, prevEr, 'pp');
    if (erDelta) erTd.appendChild(erDelta);
    tr.appendChild(erTd);

    tr.appendChild(statusCell(item));

    var timeTd = make('td', 'row-time', timeRelative(item.scraped_at));
    timeTd.title = formatDateTime(item.scraped_at);
    tr.appendChild(timeTd);

    return tr;
  }

  function metricCell(value, previous) {
    var td = make('td', 'num');
    td.appendChild(make('span', 'metric-value', formatNumber(value)));
    var delta = deltaNode(value, previous, null);
    if (delta) td.appendChild(delta);
    return td;
  }

  // ---------- History ----------
  var historyTarget = null;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function buildSparkline(values, color) {
    var numbers = values.filter(function (value) {
      return value !== null && value !== undefined && isFinite(Number(value));
    }).map(Number);
    if (numbers.length < 2) return null;

    var width = 260;
    var height = 36;
    var pad = 3;
    var min = Math.min.apply(null, numbers);
    var max = Math.max.apply(null, numbers);
    var span = max - min || 1;

    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'trend-svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');

    var points = numbers.map(function (value, index) {
      var x = pad + (index * (width - pad * 2)) / (numbers.length - 1);
      var y = height - pad - ((value - min) / span) * (height - pad * 2);
      return x.toFixed(2) + ',' + y.toFixed(2);
    });

    var line = document.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('points', points.join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(line);

    var last = points[points.length - 1].split(',');
    var dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', last[0]);
    dot.setAttribute('cy', last[1]);
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', color);
    dot.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(dot);

    return svg;
  }

  function renderTrend(snapshots) {
    var chronological = snapshots.slice().reverse();
    var platform = historyTarget ? historyTarget.platform : null;

    if (chronological.length < 2) {
      el.historyTrend.hidden = true;
      el.trendGrid.replaceChildren();
      return;
    }

    var metrics = [
      {
        key: 'followers',
        label: 'Followers',
        color: 'var(--success)',
        values: chronological.map(function (s) { return s.follower_count; }),
        format: formatNumber
      },
      {
        key: 'likes',
        label: 'Likes',
        color: 'var(--brand)',
        values: chronological.map(function (s) { return s.likes; }),
        format: formatNumber
      },
      {
        key: 'er',
        label: 'Engagement rate',
        color: 'var(--warning)',
        values: chronological.map(function (s) {
          return calcEr(platform, s.likes, s.comments, s.views, s.shares, s.follower_count);
        }),
        format: formatEr
      }
    ];

    var fragment = document.createDocumentFragment();
    metrics.forEach(function (metric) {
      var row = make('div', 'trend-row');
      row.appendChild(make('span', 'trend-label', metric.label));

      var chartCell = make('span');
      var valid = metric.values.filter(function (value) {
        return value !== null && value !== undefined && isFinite(Number(value));
      });
      var chart = buildSparkline(metric.values, metric.color);
      if (chart) {
        chartCell.appendChild(chart);
      } else {
        chartCell.appendChild(make('span', 'preview-note', 'Butuh minimal 2 snapshot'));
      }
      row.appendChild(chartCell);

      var latest = valid.length ? valid[valid.length - 1] : null;
      row.appendChild(make('span', 'trend-value', metric.format(latest)));
      fragment.appendChild(row);
    });

    el.trendGrid.replaceChildren(fragment);
    el.historyTrend.hidden = false;
  }

  async function openHistory(targetId) {
    showModal(el.historyModal, el.historyClose);
    el.historyTitle.textContent = 'Riwayat target';
    el.historySub.textContent = 'Memuat…';
    el.historyBody.replaceChildren();
    el.historyTrend.hidden = true;
    el.trendGrid.replaceChildren();
    historyTarget = null;

    try {
      var data = await fetchJson('/api/history?target_id=' + encodeURIComponent(targetId) + '&limit=100');
      historyTarget = data.target || null;
      renderHistory(data.target, data.snapshots || []);
    } catch (error) {
      if (unauthorizedShown) { closeHistory(); return; }
      el.historySub.textContent = error.message || 'Gagal memuat riwayat.';
    }
  }

  function renderHistory(target, snapshots) {
    el.historyTitle.textContent = '@' + (target.username || 'target');

    var sub = el.historySub;
    sub.replaceChildren();
    sub.appendChild(document.createTextNode(platformLabel(target.platform)));
    sub.appendChild(document.createTextNode(' · ' + (target.audit_name || 'Audit')));
    if (target.tema) sub.appendChild(document.createTextNode(' · ' + target.tema));
    if (target.url) {
      var link = make('a', 'history-link', 'Buka postingan');
      link.href = target.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      sub.appendChild(link);
    }

    renderTrend(snapshots);

    if (!snapshots.length) {
      var emptyRow = make('tr');
      var emptyCell = make('td', null, 'Belum ada snapshot untuk target ini.');
      emptyCell.colSpan = 8;
      emptyRow.appendChild(emptyCell);
      el.historyBody.replaceChildren(emptyRow);
      return;
    }

    var fragment = document.createDocumentFragment();
    snapshots.forEach(function (snapshot, index) {
      var older = snapshots[index + 1] || null;
      fragment.appendChild(buildHistoryRow(snapshot, older));
    });
    el.historyBody.replaceChildren(fragment);
  }

  function buildHistoryRow(snapshot, older) {
    var tr = make('tr');

    var timeTd = make('td', 'row-time', timeRelative(snapshot.scraped_at));
    timeTd.title = formatDateTime(snapshot.scraped_at);
    tr.appendChild(timeTd);

    tr.appendChild(statusCell(snapshot));

    tr.appendChild(metricCell(snapshot.follower_count, older ? older.follower_count : null));
    tr.appendChild(metricCell(snapshot.likes, older ? older.likes : null));
    tr.appendChild(metricCell(snapshot.comments, older ? older.comments : null));
    tr.appendChild(metricCell(snapshot.views, older ? older.views : null));
    tr.appendChild(metricCell(snapshot.shares, older ? older.shares : null));

    var erTd = make('td', 'num er');
    var platform = historyTarget ? historyTarget.platform : null;
    var er = calcEr(platform, snapshot.likes, snapshot.comments,
      snapshot.views, snapshot.shares, snapshot.follower_count);
    var prevEr = older
      ? calcEr(platform, older.likes, older.comments,
        older.views, older.shares, older.follower_count)
      : null;
    erTd.appendChild(make('span', 'metric-value', formatEr(er)));
    var delta = deltaNode(er, prevEr, 'pp');
    if (delta) erTd.appendChild(delta);
    tr.appendChild(erTd);

    return tr;
  }

  function closeHistory() {
    hideModal(el.historyModal);
  }

  // ---------- Modal plumbing ----------
  function focusableIn(modal) {
    return modal.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
  }

  function showModal(modal, focusTarget) {
    modal._restoreFocus = document.activeElement;
    if (modalStack.indexOf(modal) === -1) modalStack.push(modal);
    modal.style.zIndex = String(70 + modalStack.length * 2);
    modal.hidden = false;
    var target = focusTarget || focusableIn(modal)[0];
    if (target) target.focus();
  }

  function hideModal(modal) {
    if (modal.hidden) return;
    var wasTop = modalStack[modalStack.length - 1] === modal;
    modal.hidden = true;
    modal.style.zIndex = '';
    var index = modalStack.indexOf(modal);
    if (index !== -1) modalStack.splice(index, 1);
    var back = modal._restoreFocus;
    modal._restoreFocus = null;
    if (wasTop && back && back.isConnected && typeof back.focus === 'function') back.focus();
  }

  function openModals() {
    return modalStack.length ? modalStack[modalStack.length - 1] : null;
  }

  function openImportModal() {
    setUploadStatus('', '');
    showModal(el.importModal, el.dropzone);
  }

  function closeImportModal() {
    if (uploadInFlight) return;
    hideModal(el.importModal);
  }

  function openExportModal() {
    updateExportUi();
    showModal(el.exportModal, el.exportStatus);
  }

  function closeExportModal() {
    hideModal(el.exportModal);
  }

  function openManageModal() {
    updateAuditMeta();
    showModal(el.manageModal, el.cancelManage);
  }

  function closeManageModal() {
    hideModal(el.manageModal);
  }

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    var modal = openModals();
    if (!modal) return;
    var nodes = focusableIn(modal);
    if (!nodes.length) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function askConfirm(options) {
    return new Promise(function (resolve) {
      if (pendingConfirm) {
        pendingConfirm(false);
        pendingConfirm = null;
      }
      pendingConfirm = resolve;
      el.confirmTitle.textContent = options.title || 'Konfirmasi';
      el.confirmBody.textContent = options.body || 'Tindakan ini tidak dapat dibatalkan.';
      el.confirmOk.textContent = options.confirmLabel || 'Ya, lanjutkan';
      showModal(el.confirmModal, el.confirmCancel);
    });
  }

  function settleConfirm(value) {
    if (el.confirmModal.hidden) return;
    hideModal(el.confirmModal);
    var resolve = pendingConfirm;
    pendingConfirm = null;
    if (resolve) resolve(value);
  }

  function openSettings() {
    var audit = selectedAudit();
    if (!audit) return;
    el.settingsName.value = audit.name || '';
    el.settingsRepeat.value = String(audit.repeat_days || 0);
    el.settingsSub.textContent = 'Ubah nama dan jadwal pengecekan untuk "' + audit.name + '".';
    showModal(el.settingsModal, el.settingsName);
    el.settingsName.select();
  }

  function closeSettings() {
    hideModal(el.settingsModal);
  }

  // ---------- Polling + SSE ----------
  function applyPayload(data) {
    if (!data) return;
    lastSyncAt = Date.now();
    renderLastSync();
    if (data.stats) renderStats(data.stats);
    if (Array.isArray(data.latest)) renderRows(data.latest);
    if (Array.isArray(data.audits)) renderAudits(data.audits);
    maybeLoadTargets(false);
  }

  function pollOnce() {
    if (pollBusy || unauthorizedShown) return Promise.resolve();
    pollBusy = true;
    var query = auditQuery();
    return Promise.all([
      fetchJson('/api/stats' + query),
      fetchJson('/api/latest' + (query ? query + '&limit=50' : '?limit=50')),
      fetchJson('/api/audits')
    ]).then(function (results) {
      applyPayload({ stats: results[0], latest: results[1], audits: results[2] });
      if (!stream) setStreamState('polling');
    }).catch(function (error) {
      if (!unauthorizedShown) setStreamState('offline');
    }).finally(function () {
      pollBusy = false;
    });
  }

  function startPolling() {
    if (!pollTimer) {
      pollTimer = setInterval(function () {
        if (!document.hidden) pollOnce();
      }, POLL_MS);
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect() {
    clearReconnect();
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connectStream();
    }, RECONNECT_MS);
  }

  function closeStream() {
    if (stream) {
      stream.close();
      stream = null;
    }
  }

  function connectStream() {
    if (unauthorizedShown) return;
    if (typeof EventSource === 'undefined') {
      setStreamState('polling');
      startPolling();
      return;
    }
    closeStream();

    var source;
    try {
      source = new EventSource('/api/events' + auditQuery());
      stream = source;
    } catch (error) {
      setStreamState('polling');
      startPolling();
      scheduleReconnect();
      return;
    }

    source.onopen = function () {
      if (source !== stream) return;
      setStreamState('live');
      stopPolling();
    };

    source.onmessage = function (event) {
      if (source !== stream) return;
      var data;
      try { data = JSON.parse(event.data); } catch (error) { return; }
      applyPayload(data);
      setStreamState('live');
    };

    source.onerror = function () {
      if (source !== stream) return;
      closeStream();
      setStreamState('polling');
      startPolling();
      scheduleReconnect();
    };
  }

  function restartStream() {
    closeStream();
    clearReconnect();
    stopPolling();
    connectStream();
    pollOnce();
  }

  function selectAudit(value) {
    currentAuditId = value ? Number(value) : null;
    autoSelectAudit = false;
    if (currentAuditId) {
      localStorage.setItem(STORAGE_KEY, String(currentAuditId));
      localStorage.removeItem(ALL_AUDITS_KEY);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(ALL_AUDITS_KEY, '1');
    }

    lastStats = null;
    targetState.signature = '';
    targetState.offset = 0;
    updateAuditMeta();
    updateAppendUi();
    restartStream();
    loadTargets(true);
  }

  // ---------- Upload ----------
  function setUploadStatus(message, className) {
    el.uploadStatus.textContent = message || '';
    el.uploadStatus.className = 'upload-status' + (className ? ' ' + className : '');
  }

  function updateAppendUi() {
    var audit = selectedAudit();
    if (!audit) {
      el.appendMode.checked = false;
      el.appendMode.disabled = true;
      el.appendHint.textContent = 'Pilih satu audit aktif untuk menambah target tanpa membuat audit baru.';
    } else {
      el.appendMode.disabled = false;
      el.appendHint.textContent = 'Gabungkan file ke "' + audit.name + '" tanpa membuat audit baru.';
    }
    var append = Boolean(audit && el.appendMode.checked);
    el.newAuditFields.hidden = append;
    el.repeatHint.hidden = append;
    el.uploadBtn.textContent = append ? 'Tambahkan target' : 'Impor data';
  }

  function setFile(file) {
    if (!file) {
      clearFile();
      return;
    }
    var name = file.name || '';
    if (!/\.(csv|xlsx)$/i.test(name)) {
      setUploadStatus('Format file harus .csv atau .xlsx.', 'is-error');
      toast('error', 'Format file tidak didukung. Gunakan CSV atau XLSX.');
      el.fileInput.value = '';
      return;
    }
    el.fileName.textContent = name;
    el.fileSize.textContent = formatBytes(file.size);
    el.fileChip.hidden = false;
    el.uploadBtn.disabled = false;
    setUploadStatus('', '');
    updateAppendUi();
    previewFile(file);
  }

  function clearFile() {
    previewRequest += 1;
    el.fileInput.value = '';
    el.fileChip.hidden = true;
    el.previewWrap.hidden = true;
    el.previewHead.replaceChildren();
    el.previewBody.replaceChildren();
    el.uploadBtn.disabled = true;
    el.fileName.textContent = '—';
    el.fileSize.textContent = '—';
  }

  function parseCsv(text) {
    var firstLine = (text.split(/\r?\n/)[0] || '');
    var commas = (firstLine.match(/,/g) || []).length;
    var semicolons = (firstLine.match(/;/g) || []).length;
    var delimiter = semicolons > commas ? ';' : ',';
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    var maxRows = 60;

    function pushRow() {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    }

    for (var i = 0; i < text.length && rows.length < maxRows; i += 1) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 1; }
          else quoted = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === delimiter) {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        pushRow();
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (rows.length < maxRows && (field !== '' || row.length)) pushRow();

    return rows.filter(function (cells) {
      return cells.some(function (cell) { return String(cell).trim() !== ''; });
    });
  }

  function normalizeHeader(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function findColumn(headers, hints) {
    var normalized = headers.map(normalizeHeader);
    for (var h = 0; h < hints.length; h += 1) {
      var exact = normalized.indexOf(hints[h]);
      if (exact >= 0) return exact;
    }
    for (var i = 0; i < normalized.length; i += 1) {
      for (var j = 0; j < hints.length; j += 1) {
        if (normalized[i] && normalized[i].indexOf(hints[j]) >= 0) return i;
      }
    }
    return -1;
  }

  async function previewFile(file) {
    var token = ++previewRequest;
    el.previewWrap.hidden = false;
    el.previewHead.replaceChildren();
    el.previewBody.replaceChildren();
    el.previewNote.className = 'preview-note';

    if (!/\.csv$/i.test(file.name || '')) {
      el.previewNote.textContent = 'Pratinjau baris hanya tersedia untuk CSV. File XLSX tetap divalidasi saat impor.';
      return;
    }

    try {
      var text = await file.slice(0, 128 * 1024).text();
      if (token !== previewRequest) return;
      var rows = parseCsv(text.replace(/^\uFEFF/, ''));
      if (!rows.length) {
        el.previewNote.className = 'preview-note is-error';
        el.previewNote.textContent = 'File CSV kosong atau tidak bisa dibaca.';
        return;
      }

      var headers = rows[0];
      var urlIndex = findColumn(headers, ['link', 'url', 'tautan', 'post', 'postingan']);
      var userIndex = findColumn(headers, ['username', 'user', 'akun', 'account', 'ig', 'tiktok']);
      var temaIndex = findColumn(headers, ['tema', 'theme', 'kategori', 'category', 'kampanye', 'campaign']);

      var picks = [];
      if (urlIndex >= 0) picks.push(urlIndex);
      if (userIndex >= 0 && userIndex !== urlIndex) picks.push(userIndex);
      if (temaIndex >= 0 && picks.indexOf(temaIndex) === -1) picks.push(temaIndex);
      if (!picks.length) {
        for (var c = 0; c < Math.min(headers.length, 3); c += 1) picks.push(c);
      }

      var headRow = make('tr');
      picks.forEach(function (index) {
        var th = make('th', null, headers[index] || ('Kolom ' + (index + 1)));
        th.scope = 'col';
        headRow.appendChild(th);
      });
      el.previewHead.replaceChildren(headRow);

      var bodyFragment = document.createDocumentFragment();
      rows.slice(1, 6).forEach(function (cells) {
        var tr = make('tr');
        picks.forEach(function (index) { tr.appendChild(make('td', null, cells[index] || '—')); });
        bodyFragment.appendChild(tr);
      });
      el.previewBody.replaceChildren(bodyFragment);

      var dataCount = rows.length - 1;
      var suffix = dataCount >= 59 ? '59+' : String(dataCount);
      if (urlIndex < 0) {
        el.previewNote.className = 'preview-note is-error';
        el.previewNote.textContent = 'Kolom Link/URL tidak terdeteksi. Impor akan ditolak — gunakan header "Link".';
      } else {
        el.previewNote.textContent = 'Pratinjau ' + Math.min(dataCount, 5) + ' baris dari ' +
          suffix + ' baris · kolom Link: "' + headers[urlIndex] + '"' +
          (userIndex >= 0 ? ' · Username: "' + headers[userIndex] + '"' : '') +
          (temaIndex >= 0 ? ' · Tema: "' + headers[temaIndex] + '"' : '');
      }
    } catch (error) {
      if (token !== previewRequest) return;
      el.previewNote.className = 'preview-note is-error';
      el.previewNote.textContent = 'Gagal membaca pratinjau file.';
    }
  }

  function downloadTemplate() {
    var content = '\uFEFFLink,Username,Tema\r\n' +
      'https://www.instagram.com/p/CONTOH123/,contoh_akun,Kampanye A\r\n' +
      'https://www.tiktok.com/@contoh_akun/video/0000000000000000000,contoh_akun,Kampanye A\r\n';
    var blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'template_target_sunscraping.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('success', 'Template CSV diunduh.');
  }

  // ---------- Export ----------
  var exportInFlight = false;

  function exportAvailable() {
    if (!lastStats) return true;
    return Number(lastStats.SNAPSHOTS) > 0;
  }

  function updateExportUi() {
    var available = exportAvailable();
    el.exportBtn.disabled = exportInFlight || !available;
    el.exportBtn.title = available ? '' : (currentAuditId
      ? 'Audit ini belum punya snapshot. Jalankan worker lebih dulu.'
      : 'Belum ada snapshot sama sekali. Jalankan worker lebih dulu.');
    updateExportHint();
  }

  function updateExportHint() {
    var status = el.exportStatus.value;
    var labels = { OK: 'selesai', PARTIAL: 'sebagian', FAILED: 'gagal' };
    var audit = selectedAudit();
    var scope = audit ? 'audit "' + audit.name + '"' : 'semua audit';
    if (!lastStats) {
      el.exportHint.textContent = 'Memuat jumlah data…';
      return;
    }
    var snapshots = Number(lastStats.SNAPSHOTS) || 0;
    if (!snapshots) {
      el.exportHint.textContent = 'Belum ada snapshot untuk ' + scope + '. Jalankan worker lalu unduh hasilnya.';
      return;
    }
    el.exportHint.textContent = formatNumber(snapshots) + ' snapshot dari ' + scope + ' akan diunduh' +
      (labels[status] ? ' — difilter status ' + labels[status] + '.' : '.');
  }

  function exportFilename() {
    var audit = selectedAudit();
    var label = audit ? audit.name : 'semua_audit';
    var safe = String(label || 'audit').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'audit';
    var status = el.exportStatus.value;
    var suffix = status ? '_' + status.toLowerCase() : '';
    var stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return 'sunscraping_' + safe + suffix + '_' + stamp + '.xlsx';
  }

  async function downloadExport() {
    exportInFlight = true;
    el.exportBtn.disabled = true;
    el.exportBtn.classList.add('is-loading');
    var downloaded = false;
    try {
      var status = el.exportStatus.value;
      var query = auditQuery(status ? 'status=' + encodeURIComponent(status) : '');
      var response = await fetch('/api/export' + query, { credentials: 'same-origin' });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        var payload = await response.json().catch(function () { return {}; });
        toast('error', payload.error || 'Belum ada data untuk diekspor.');
        return;
      }
      var blob = await response.blob();
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = exportFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('success', 'Laporan berhasil diunduh.');
      downloaded = true;
    } catch (error) {
      toast('error', 'Gagal mengunduh laporan.');
    } finally {
      exportInFlight = false;
      el.exportBtn.classList.remove('is-loading');
      updateExportUi();
      if (downloaded) closeExportModal();
    }
  }

  // ---------- Event wiring ----------
  el.offlineRetry.addEventListener('click', function () {
    el.offlineRetry.disabled = true;
    restartStream();
    setTimeout(function () { el.offlineRetry.disabled = false; }, 1200);
  });

  el.auditSelect.addEventListener('change', function () {
    selectAudit(el.auditSelect.value);
  });

  el.tabTargets.addEventListener('click', function () { setTab('targets'); });
  el.tabActivity.addEventListener('click', function () { setTab('activity'); });

  [el.tabTargets, el.tabActivity].forEach(function (tab) {
    tab.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setTab(activeTab === 'targets' ? 'activity' : 'targets', true);
    });
  });

  el.targetSearch.addEventListener('input', function () {
    var value = el.targetSearch.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      targetState.query = value;
      targetState.offset = 0;
      loadTargets(true);
    }, 300);
  });

  el.targetStatus.addEventListener('change', function () {
    targetState.status = el.targetStatus.value;
    loadTargets(true);
  });

  el.targetPlatform.addEventListener('change', function () {
    targetState.platform = el.targetPlatform.value;
    loadTargets(true);
  });

  el.targetPrev.addEventListener('click', function () {
    if (targetState.offset <= 0) return;
    targetState.offset = Math.max(0, targetState.offset - targetState.limit);
    loadTargets(false);
  });

  el.targetNext.addEventListener('click', function () {
    if (targetState.offset + targetState.limit >= targetState.total) return;
    targetState.offset += targetState.limit;
    loadTargets(false);
  });

  el.targetResetBtn.addEventListener('click', function () {
    el.targetSearch.value = '';
    el.targetStatus.value = '';
    el.targetPlatform.value = '';
    targetState.query = '';
    targetState.status = '';
    targetState.platform = '';
    loadTargets(true);
  });

  el.targetRetryBtn.addEventListener('click', function () {
    el.targetRetryBtn.disabled = true;
    loadTargets(true);
    setTimeout(function () { el.targetRetryBtn.disabled = false; }, 800);
  });

  el.emptyImportBtn.addEventListener('click', openImportModal);
  el.activityImportBtn.addEventListener('click', openImportModal);

  el.workerNoticeDismiss.addEventListener('click', function () {
    noticeDismissed = true;
    el.workerNotice.hidden = true;
  });

  el.erInfoBtn.addEventListener('click', function () {
    var open = el.erInfo.hidden;
    el.erInfo.hidden = !open;
    el.erInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    el.erInfoBtn.classList.toggle('is-active', open);
  });

  el.targetHead.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-target-sort]');
    if (button) sortTargets(button.dataset.targetSort);
  });

  el.activityHead.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-activity-sort]');
    if (button) sortActivity(button.dataset.activitySort);
  });

  function handleTargetRow(node) {
    var row = node.closest('tr[data-target-id]');
    if (row) openHistory(Number(row.dataset.targetId));
  }

  el.targetBody.addEventListener('click', function (event) {
    handleTargetRow(event.target);
  });

  el.targetBody.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var row = event.target.closest('tr[data-target-id]');
    if (row) {
      event.preventDefault();
      openHistory(Number(row.dataset.targetId));
    }
  });

  el.appendMode.addEventListener('change', function () {
    updateAppendUi();
  });

  el.templateBtn.addEventListener('click', downloadTemplate);

  el.exportStatus.addEventListener('change', updateExportHint);

  window.addEventListener('offline', function () {
    showOffline('Perangkat offline. Sambungkan jaringan untuk melanjutkan audit.');
  });

  window.addEventListener('online', function () {
    hideOffline();
    restartStream();
  });

  el.retryFailedBtn.addEventListener('click', async function () {
    if (!currentAuditId) return;
    el.retryFailedBtn.disabled = true;
    try {
      var data = await postJson('/api/audits/' + currentAuditId + '/retry-failed');
      toast(data.created ? 'success' : 'info', data.message || 'Target gagal dijadwalkan ulang.');
      pollOnce();
      loadTargets(false);
    } catch (error) {
      if (!unauthorizedShown) toast('error', error.message || 'Gagal mengulang target gagal.');
    } finally {
      updateRetryButton();
    }
  });

  el.rerunBtn.addEventListener('click', async function () {
    if (!currentAuditId) return;
    el.rerunBtn.disabled = true;
    try {
      var data = await postJson('/api/audits/' + currentAuditId + '/rerun');
      toast(data.pending || data.empty ? 'info' : 'success', data.message || 'Audit dijadwalkan ulang.');
      pollOnce();
    } catch (error) {
      if (!unauthorizedShown) toast('error', error.message || 'Gagal menjadwalkan ulang.');
    } finally {
      updateAuditMeta();
    }
  });

  el.openImportBtn.addEventListener('click', openImportModal);
  el.closeImport.addEventListener('click', closeImportModal);
  el.cancelImport.addEventListener('click', closeImportModal);
  el.importModal.addEventListener('click', function (event) {
    if (event.target === el.importModal) closeImportModal();
  });

  el.openExportBtn.addEventListener('click', openExportModal);
  el.closeExport.addEventListener('click', closeExportModal);
  el.cancelExport.addEventListener('click', closeExportModal);
  el.exportModal.addEventListener('click', function (event) {
    if (event.target === el.exportModal) closeExportModal();
  });

  el.openManageBtn.addEventListener('click', openManageModal);
  el.closeManage.addEventListener('click', closeManageModal);
  el.cancelManage.addEventListener('click', closeManageModal);
  el.manageModal.addEventListener('click', function (event) {
    if (event.target === el.manageModal) closeManageModal();
  });

  el.settingsBtn.addEventListener('click', openSettings);
  el.cancelSettings.addEventListener('click', closeSettings);
  el.settingsModal.addEventListener('click', function (event) {
    if (event.target === el.settingsModal) closeSettings();
  });

  el.settingsForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!currentAuditId) return;
    var name = el.settingsName.value.trim();
    var repeat = Number(el.settingsRepeat.value);
    if (!name) {
      toast('error', 'Nama audit tidak boleh kosong.');
      return;
    }
    if (!isFinite(repeat) || repeat < 0 || repeat > 365) {
      toast('error', 'Ulang otomatis harus 0-365 hari.');
      return;
    }
    el.saveSettings.disabled = true;
    el.saveSettings.textContent = 'Menyimpan…';
    try {
      await postJson('/api/audits/' + currentAuditId + '/settings', {
        name: name,
        repeat_days: Math.round(repeat)
      });
      closeSettings();
      toast('success', 'Pengaturan audit disimpan.');
      pollOnce();
    } catch (error) {
      if (!unauthorizedShown) toast('error', error.message || 'Gagal menyimpan pengaturan.');
    } finally {
      el.saveSettings.disabled = false;
      el.saveSettings.textContent = 'Simpan';
    }
  });

  el.deleteAuditBtn.addEventListener('click', async function () {
    var audit = selectedAudit();
    if (!audit) return;
    var confirmed = await askConfirm({
      title: 'Hapus audit "' + audit.name + '"?',
      body: 'Semua target, snapshot, dan riwayat audit ini akan dihapus permanen.',
      confirmLabel: 'Hapus audit'
    });
    if (!confirmed) return;

    try {
      await postJson('/api/audits/' + audit.id + '/delete');
      currentAuditId = null;
      autoSelectAudit = true;
      localStorage.removeItem(STORAGE_KEY);
      toast('success', 'Audit dihapus.');
      closeManageModal();
      restartStream();
      loadTargets(true);
    } catch (error) {
      if (!unauthorizedShown) toast('error', error.message || 'Gagal menghapus audit.');
    }
  });

  el.clearBtn.addEventListener('click', async function () {
    var confirmed = await askConfirm({
      title: 'Kosongkan semua data?',
      body: 'Seluruh audit, target, snapshot, dan antrean akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.',
      confirmLabel: 'Ya, hapus semua'
    });
    if (!confirmed) return;

    try {
      await postJson('/api/clear');
      currentAuditId = null;
      autoSelectAudit = true;
      localStorage.removeItem(STORAGE_KEY);
      toast('success', 'Database dikosongkan.');
      closeManageModal();
      restartStream();
      loadTargets(true);
    } catch (error) {
      if (!unauthorizedShown) toast('error', error.message || 'Gagal mengosongkan database.');
    }
  });

  el.confirmCancel.addEventListener('click', function () { settleConfirm(false); });
  el.confirmOk.addEventListener('click', function () { settleConfirm(true); });
  el.confirmModal.addEventListener('click', function (event) {
    if (event.target === el.confirmModal) settleConfirm(false);
  });

  el.historyClose.addEventListener('click', closeHistory);
  el.historyModal.addEventListener('click', function (event) {
    if (event.target === el.historyModal) closeHistory();
  });

  el.liveFeedBody.addEventListener('click', function (event) {
    var row = event.target.closest('tr[data-target-id]');
    if (row) openHistory(Number(row.dataset.targetId));
  });

  el.liveFeedBody.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var row = event.target.closest('tr[data-target-id]');
    if (row) {
      event.preventDefault();
      openHistory(Number(row.dataset.targetId));
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var modal = openModals();
    if (!modal) return;
    if (modal === el.confirmModal) settleConfirm(false);
    else if (modal === el.importModal) closeImportModal();
    else if (modal === el.exportModal) closeExportModal();
    else if (modal === el.manageModal) closeManageModal();
    else if (modal === el.historyModal) closeHistory();
    else if (modal === el.settingsModal) closeSettings();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    pollOnce();
    if (!stream) connectStream();
    loadTargets(false);
  });

  setInterval(function () {
    if (document.hidden || !lastRows.length) return;
    if (el.liveFeedBody.contains(document.activeElement)) return;
    renderRows(lastRows, true);
  }, REFRESH_LABEL_MS);

  // Audit list could change while tab hidden; refresh meta labels too.
  setInterval(function () {
    if (document.hidden) return;
    updateAuditMeta();
    renderWorker(lastStats && lastStats.WORKER_LAST_SEEN);
    renderLastSync();
    maybeLoadTargets(false);
  }, REFRESH_LABEL_MS);

  // ---------- File + upload wiring ----------
  el.dropzone.addEventListener('click', function () { el.fileInput.click(); });
  el.dropzone.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      el.fileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach(function (name) {
    el.dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      el.dropzone.classList.add('is-dragover');
    });
  });

  ['dragleave', 'drop'].forEach(function (name) {
    el.dropzone.addEventListener(name, function (event) {
      event.preventDefault();
      el.dropzone.classList.remove('is-dragover');
    });
  });

  el.dropzone.addEventListener('drop', function (event) {
    var files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) {
      el.fileInput.files = files;
      setFile(files[0]);
    }
  });

  el.fileInput.addEventListener('change', function () {
    setFile(el.fileInput.files && el.fileInput.files[0]);
  });

  el.removeFileBtn.addEventListener('click', function (event) {
    event.stopPropagation();
    clearFile();
    setUploadStatus('', '');
  });

  el.uploadForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    var file = el.fileInput.files && el.fileInput.files[0];
    if (!file) {
      setUploadStatus('Pilih file terlebih dahulu.', 'is-error');
      return;
    }

    var append = Boolean(el.appendMode.checked && currentAuditId);
    var repeat = Number(el.repeatDays.value);
    if (!append && (!isFinite(repeat) || repeat < 0 || repeat > 365)) {
      setUploadStatus('Ulang otomatis harus 0-365 hari.', 'is-error');
      return;
    }

    el.uploadBtn.disabled = true;
    el.uploadBtn.classList.add('is-loading');
    el.uploadBtn.replaceChildren();
    var spinner = make('span', 'spinner');
    spinner.setAttribute('aria-hidden', 'true');
    el.uploadBtn.appendChild(spinner);
    el.uploadBtn.appendChild(document.createTextNode(append ? 'Menambahkan…' : 'Mengimpor…'));
    setUploadStatus('', '');
    uploadInFlight = true;
    el.closeImport.disabled = true;
    el.cancelImport.disabled = true;
    var uploaded = false;

    try {
      var formData = new FormData();
      formData.append('file', file);
      if (append) formData.append('audit_id', String(currentAuditId));
      if (el.auditName.value.trim()) formData.append('audit_name', el.auditName.value.trim());
      formData.append('repeat_days', String(Math.round(repeat)));

      var response = await fetch('/api/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      var data = await response.json().catch(function () { return {}; });

      if (response.ok && data.success) {
        var parts = [];
        if (data.append) {
          parts.push(data.inserted + ' target ditambahkan');
          if (data.duplicates) parts.push(data.duplicates + ' duplikat dilewati');
        } else {
          parts.push(data.inserted + ' target diimpor');
          if (data.duplicates) parts.push(data.duplicates + ' duplikat dilewati');
        }
        if (data.skipped) parts.push(data.skipped + ' baris dilewati');
        if (data.truncated) parts.push('dipotong di ' + data.max_rows + ' baris');
        setUploadStatus(parts.join(' · '), 'is-success');
        toast('success', parts.join(' · '));

        if (data.audit_id) {
          currentAuditId = Number(data.audit_id);
          autoSelectAudit = false;
          localStorage.setItem(STORAGE_KEY, String(currentAuditId));
        }
        el.auditName.value = '';
        el.repeatDays.value = '0';
        targetState.offset = 0;
        targetState.signature = '';
        clearFile();
        updateAppendUi();
        restartStream();
        loadTargets(true);
        uploaded = true;
      } else {
        var message = data.error || 'Impor gagal.';
        setUploadStatus(message, 'is-error');
        toast('error', message);
      }
    } catch (error) {
      setUploadStatus('Gagal menghubungi server. Pastikan backend berjalan.', 'is-error');
      toast('error', 'Tidak dapat menghubungi backend. Periksa Control Panel.');
    } finally {
      uploadInFlight = false;
      el.closeImport.disabled = false;
      el.cancelImport.disabled = false;
      el.uploadBtn.classList.remove('is-loading');
      updateAppendUi();
      el.uploadBtn.disabled = !(el.fileInput.files && el.fileInput.files[0]);
      if (uploaded) closeImportModal();
    }
  });

  el.exportBtn.addEventListener('click', downloadExport);

  // ---------- Boot ----------
  readUrlState();
  el.targetSearch.value = targetState.query;
  el.targetStatus.value = targetState.status;
  el.targetPlatform.value = targetState.platform;
  el.auditSelect.value = currentAuditId ? String(currentAuditId) : '';
  updateTargetSortHeaders();
  updateActivitySortHeaders();
  updateAppendUi();
  renderWorker(null);
  updateAuditMeta();
  setTab(initialTab);
  pollOnce();
  connectStream();
})();
