(function () {
  'use strict';

  var STORAGE_KEY = 'sa_dashboard_audit';
  var ALL_AUDITS_KEY = 'sa_dashboard_all_audits';
  var POLL_MS = 5000;
  var RECONNECT_MS = 10000;
  var REFRESH_LABEL_MS = 30000;
  var TARGETS_REFRESH_MS = 7000;
  var ACCOUNTS_REFRESH_MS = 60000;
  var SUMMARY_REFRESH_MS = 10000;
  var COMPARE_REFRESH_MS = 30000;

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
    openDatabaseBtn: document.getElementById('openDatabaseBtn'),
    auditSelect: document.getElementById('auditSelect'),
    sidebarAudit: document.getElementById('sidebarAudit'),
    globalSearch: document.getElementById('globalSearch'),
    auditMeta: document.getElementById('auditMeta'),
    auditCost: document.getElementById('auditCost'),
    rerunCost: document.getElementById('rerunCost'),
    processRetryBtn: document.getElementById('processRetryBtn'),
    qaProcess: document.getElementById('qaProcess'),
    qaAccounts: document.getElementById('qaAccounts'),
    qaExport: document.getElementById('qaExport'),
    qualityInfoBtn: document.getElementById('qualityInfoBtn'),
    qualityInfo: document.getElementById('qualityInfo'),
    qualityInfoClose: document.getElementById('qualityInfoClose'),
    summaryPlatformSubtitle: document.getElementById('summaryPlatformSubtitle'),
    summaryHealthGauge: document.getElementById('summaryHealthGauge'),
    summaryHealthGaugeFill: document.getElementById('summaryHealthGaugeFill'),
    summaryRiskCard: document.getElementById('summaryRiskCard'),
    summaryRiskList: document.getElementById('summaryRiskList'),
    summaryRiskCount: document.getElementById('summaryRiskCount'),
    summaryRiskAll: document.getElementById('summaryRiskAll'),
    topViewsAll: document.getElementById('topViewsAll'),
    topErAll: document.getElementById('topErAll'),
    compareBars: document.getElementById('compareBars'),
    targetSelectAll: document.getElementById('targetSelectAll'),
    targetBatch: document.getElementById('targetBatch'),
    targetBatchCount: document.getElementById('targetBatchCount'),
    targetBatchRetry: document.getElementById('targetBatchRetry'),
    targetBatchClear: document.getElementById('targetBatchClear'),
    rerunBtn: document.getElementById('rerunBtn'),
    rerunFullBtn: document.getElementById('rerunFullBtn'),
    retryFailedBtn: document.getElementById('retryFailedBtn'),
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
    navSummary: document.getElementById('navSummary'),
    navActivity: document.getElementById('navActivity'),
    navData: document.getElementById('navData'),
    navSettings: document.getElementById('navSettings'),
    pageSummary: document.getElementById('pageSummary'),
    pageActivity: document.getElementById('pageActivity'),
    pageTargets: document.getElementById('pageTargets'),
    pageAccounts: document.getElementById('pageAccounts'),
    pageSettings: document.getElementById('pageSettings'),
    dataToolbar: document.getElementById('dataToolbar'),
    dataActions: document.getElementById('dataActions'),
    settingsWorker: document.getElementById('settingsWorker'),
    pageCompare: document.getElementById('pageCompare'),
    pageSearch: document.getElementById('pageSearch'),
    tabSearch: document.getElementById('tabSearch'),
    compareMonths: document.getElementById('compareMonths'),
    compareInfoBtn: document.getElementById('compareInfoBtn'),
    compareInfo: document.getElementById('compareInfo'),
    compareSummary: document.getElementById('compareSummary'),
    compareHead: document.getElementById('compareHead'),
    compareBody: document.getElementById('compareBody'),
    compareMore: document.getElementById('compareMore'),
    dataSearch: document.getElementById('dataSearch'),
    searchSummary: document.getElementById('searchSummary'),
    searchEmpty: document.getElementById('searchEmpty'),
    searchEmptyTitle: document.getElementById('searchEmptyTitle'),
    searchEmptyCopy: document.getElementById('searchEmptyCopy'),
    searchAccountsCard: document.getElementById('searchAccountsCard'),
    searchAccountsBody: document.getElementById('searchAccountsBody'),
    searchTargetsCard: document.getElementById('searchTargetsCard'),
    searchTargetsBody: document.getElementById('searchTargetsBody'),
    searchPostsCard: document.getElementById('searchPostsCard'),
    searchPostsBody: document.getElementById('searchPostsBody'),
    targetIssue: document.getElementById('targetIssue'),
    auditPeriod: document.getElementById('auditPeriod'),
    settingsPeriod: document.getElementById('settingsPeriod'),
    activitySync: document.getElementById('activitySync'),
    tabTargets: document.getElementById('tabTargets'),
    tabAccounts: document.getElementById('tabAccounts'),
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
    workerNotice: document.getElementById('workerNotice'),
    workerNoticeText: document.getElementById('workerNoticeText'),
    workerNoticeDismiss: document.getElementById('workerNoticeDismiss'),
    targetSkeleton: document.getElementById('targetSkeleton'),
    activitySkeleton: document.getElementById('activitySkeleton'),
    activityNote: document.getElementById('activityNote'),
    erInfoBtn: document.getElementById('erInfoBtn'),
    erInfo: document.getElementById('erInfo'),
    erInfoClose: document.getElementById('erInfoClose'),
    targetFilterReset: document.getElementById('targetFilterReset'),
    manageNote: document.getElementById('manageNote'),
    targetRetryBtn: document.getElementById('targetRetryBtn'),
    summaryPanel: document.getElementById('summaryPanel'),
    summarySkeleton: document.getElementById('summarySkeleton'),
    summaryBody: document.getElementById('summaryBody'),
    summaryEmpty: document.getElementById('summaryEmpty'),
    summaryEmptyCopy: document.getElementById('summaryEmptyCopy'),
    summaryImportBtn: document.getElementById('summaryImportBtn'),
    summaryStamp: document.getElementById('summaryStamp'),
    summaryKpi: document.getElementById('summaryKpi'),
    summaryQuality: document.getElementById('summaryQuality'),
    summaryQualitySection: document.getElementById('summaryQualitySection'),
    summaryHealthBadge: document.getElementById('summaryHealthBadge'),
    summaryPlatformSection: document.getElementById('summaryPlatformSection'),
    platformCardsToggle: document.getElementById('platformCardsToggle'),
    platformTableToggle: document.getElementById('platformTableToggle'),
    summaryPlatformCards: document.getElementById('summaryPlatformCards'),
    summaryPlatformTableWrap: document.getElementById('summaryPlatformTableWrap'),
    summarySpotlightSection: document.getElementById('summarySpotlightSection'),
    spotlightTabViews: document.getElementById('spotlightTabViews'),
    spotlightTabEr: document.getElementById('spotlightTabEr'),
    spotlightTabAccounts: document.getElementById('spotlightTabAccounts'),
    summarySpotlightList: document.getElementById('summarySpotlightList'),
    summaryTopViewsCard: document.getElementById('summaryTopViewsCard'),
    summaryTopErCard: document.getElementById('summaryTopErCard'),
    summaryPlatformBody: document.getElementById('summaryPlatformBody'),
    summaryTopViewsBody: document.getElementById('summaryTopViewsBody'),
    summaryTopErBody: document.getElementById('summaryTopErBody'),
    summaryTemaCard: document.getElementById('summaryTemaCard'),
    summaryTemaBody: document.getElementById('summaryTemaBody'),
    summaryAuditCard: document.getElementById('summaryAuditCard'),
    summaryAuditBody: document.getElementById('summaryAuditBody'),
    summaryFootnote: document.getElementById('summaryFootnote'),
    compareBtn3: document.getElementById('compareBtn3'),
    compareBtn6: document.getElementById('compareBtn6'),
    compareBtn12: document.getElementById('compareBtn12'),
    emptyImportBtn: document.getElementById('emptyImportBtn'),
    activityImportBtn: document.getElementById('activityImportBtn'),
    summaryItems: Array.prototype.slice.call(document.querySelectorAll('.summary-item')),
    processProgress: document.getElementById('processProgress'),
    processSub: document.getElementById('processSub'),
    processBar: document.getElementById('processBar'),
    toastContainer: document.getElementById('toastContainer'),
    importModal: document.getElementById('importModal'),
    closeImport: document.getElementById('closeImport'),
    cancelImport: document.getElementById('cancelImport'),
    exportModal: document.getElementById('exportModal'),
    closeExport: document.getElementById('closeExport'),
    cancelExport: document.getElementById('cancelExport'),
    databaseModal: document.getElementById('databaseModal'),
    closeDatabase: document.getElementById('closeDatabase'),
    databaseStats: document.getElementById('databaseStats'),
    dbSize: document.getElementById('dbSize'),
    dbAudits: document.getElementById('dbAudits'),
    dbTargets: document.getElementById('dbTargets'),
    dbAccounts: document.getElementById('dbAccounts'),
    dbPosts: document.getElementById('dbPosts'),
    dbSnapshots: document.getElementById('dbSnapshots'),
    dbUpdated: document.getElementById('dbUpdated'),
    dbDownloadBtn: document.getElementById('dbDownloadBtn'),
    dbDropzone: document.getElementById('dbDropzone'),
    dbFileInput: document.getElementById('dbFileInput'),
    dbFileChip: document.getElementById('dbFileChip'),
    dbFileName: document.getElementById('dbFileName'),
    dbFileSize: document.getElementById('dbFileSize'),
    dbRemoveFile: document.getElementById('dbRemoveFile'),
    dbRestoreBtn: document.getElementById('dbRestoreBtn'),
    dbStatus: document.getElementById('dbStatus'),
    settingsForm: document.getElementById('settingsForm'),
    settingsName: document.getElementById('settingsName'),
    settingsRepeat: document.getElementById('settingsRepeat'),
    saveSettings: document.getElementById('saveSettings'),
    historyModal: document.getElementById('historyModal'),
    historyTitle: document.getElementById('historyTitle'),
    historySub: document.getElementById('historySub'),
    historyTrend: document.getElementById('historyTrend'),
    trendGrid: document.getElementById('trendGrid'),
    historyBody: document.getElementById('historyBody'),
    historyClose: document.getElementById('historyClose'),
    targetToolbar: document.getElementById('targetToolbar'),
    accountPanel: document.getElementById('accountPanel'),
    accountSearch: document.getElementById('accountSearch'),
    accountLevel: document.getElementById('accountLevel'),
    accountBand: document.getElementById('accountBand'),
    accountPlatform: document.getElementById('accountPlatform'),
    accountVisitBtn: document.getElementById('accountVisitBtn'),
    accountSummary: document.getElementById('accountSummary'),
    accountClusters: document.getElementById('accountClusters'),
    accountSkeleton: document.getElementById('accountSkeleton'),
    accountEmpty: document.getElementById('accountEmpty'),
    accountEmptyTitle: document.getElementById('accountEmptyTitle'),
    accountEmptyCopy: document.getElementById('accountEmptyCopy'),
    accountResetBtn: document.getElementById('accountResetBtn'),
    accountRetryBtn: document.getElementById('accountRetryBtn'),
    accountTableWrap: document.getElementById('accountTableWrap'),
    accountHead: document.getElementById('accountHead'),
    accountBody: document.getElementById('accountBody'),
    accountPager: document.getElementById('accountPager'),
    accountPageInfo: document.getElementById('accountPageInfo'),
    accountPrev: document.getElementById('accountPrev'),
    accountNext: document.getElementById('accountNext'),
    reachInfo: document.getElementById('reachInfo'),
    reachInfoBtn: document.getElementById('reachInfoBtn'),
    reachInfoClose: document.getElementById('reachInfoClose'),
    accountFilterReset: document.getElementById('accountFilterReset'),
    accountModal: document.getElementById('accountModal'),
    accountTitle: document.getElementById('accountTitle'),
    accountSub: document.getElementById('accountSub'),
    accountClose: document.getElementById('accountClose'),
    accountRisk: document.getElementById('accountRisk'),
    accountRiskBadge: document.getElementById('accountRiskBadge'),
    accountRiskScore: document.getElementById('accountRiskScore'),
    accountFlags: document.getElementById('accountFlags'),
    accountProfile: document.getElementById('accountProfile'),
    accountSiblingsBox: document.getElementById('accountSiblingsBox'),
    accountSiblings: document.getElementById('accountSiblings'),
    accountTrendBox: document.getElementById('accountTrendBox'),
    accountHistoryBody: document.getElementById('accountHistoryBody'),
    accountPostsBox: document.getElementById('accountPostsBox'),
    accountPostsBody: document.getElementById('accountPostsBody'),
    confirmModal: document.getElementById('confirmModal'),
    confirmTitle: document.getElementById('confirmTitle'),
    confirmBody: document.getElementById('confirmBody'),
    confirmCancel: document.getElementById('confirmCancel'),
    confirmOk: document.getElementById('confirmOk')
  };

  // Material icon paths are inlined instead of loaded from a font host: the
  // dashboard stays local-only and icons stay crisp at any zoom.
  var ICON_PATHS = {
    dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
    process: 'M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z',
    table: 'M3 3h18v18H3V3zm2 4v4h6V7H5zm8 0v4h6V7h-6zM5 13v4h6v-4H5zm8 0v4h6v-4h-6z',
    people: 'M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
    compare: 'M9 3L5 6.99h3V14h2V6.99h3L9 3zm7 14.01V10h-2v7.01h-3L15 21l4-3.99h-3z',
    search: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
    upload: 'M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z',
    download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
    database: 'M12 3C7.58 3 4 4.79 4 7v10c0 2.21 3.59 4 8 4s8-1.79 8-4V7c0-2.21-3.58-4-8-4zm0 2c3.87 0 6 1.5 6 2s-2.13 2-6 2-6-1.5-6-2 2.13-2 6-2zm6 12c0 .5-2.13 2-6 2s-6-1.5-6-2v-2.23c1.61.78 3.72 1.23 6 1.23s4.39-.45 6-1.23V17zm0-5c0 .5-2.13 2-6 2s-6-1.5-6-2v-2.23C7.61 10.55 9.72 11 12 11s4.39-.45 6-1.23V12z',
    file: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
    refresh: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    info: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z'
  };

  function svgIcon(name) {
    var path = ICON_PATHS[name];
    if (!path) return null;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'icon');
    var node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    node.setAttribute('d', path);
    svg.appendChild(node);
    return svg;
  }

  var NAV_ICONS = {
    navSummary: 'dashboard', navActivity: 'process', navData: 'table',
    navSettings: 'settings'
  };
  var BUTTON_ICONS = {
    openImportBtn: 'upload', openExportBtn: 'download', templateBtn: 'file',
    openDatabaseBtn: 'database', dbDownloadBtn: 'download', dbRestoreBtn: 'refresh',
    exportBtn: 'download', targetRetryBtn: 'refresh', accountVisitBtn: 'people',
    emptyImportBtn: 'upload', activityImportBtn: 'upload', summaryImportBtn: 'upload',
    targetResetBtn: 'refresh', accountResetBtn: 'refresh', accountRetryBtn: 'refresh',
    offlineRetry: 'refresh'
  };

  // Menus and buttons get their icon from here, so markup stays free of
  // decorative elements and a renamed button cannot lose its icon silently.
  function decorateIcons() {
    Object.keys(NAV_ICONS).forEach(function (id) {
      var button = document.getElementById(id);
      if (!button || button.querySelector('.icon')) return;
      var svg = svgIcon(NAV_ICONS[id]);
      if (svg) button.insertBefore(svg, button.firstChild);
    });

    Object.keys(BUTTON_ICONS).forEach(function (id) {
      var button = document.getElementById(id);
      if (!button || button.querySelector('.icon')) return;
      var svg = svgIcon(BUTTON_ICONS[id]);
      if (svg) button.insertBefore(svg, button.firstChild);
    });
  }

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
  var restoreInFlight = false;
  var lastSyncAt = null;
  var workerState = 'idle';
  var workerSeenLabel = '';
  var noticeDismissed = false;
  var initialPage = 'summary';
  var dataView = 'targets';

  var autoSelectAudit = !currentAuditId && localStorage.getItem(ALL_AUDITS_KEY) !== '1';

  var targetState = {
    status: '',
    platform: '',
    issue: '',
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

  var accountState = {
    level: '',
    band: '',
    platform: '',
    query: '',
    sort: 'risk',
    dir: 'desc',
    limit: 50,
    offset: 0,
    total: 0,
    items: [],
    clusters: [],
    summary: null,
    thresholds: null,
    signature: '',
    requestId: 0,
    lastFetch: 0
  };
  var accountDetailRequest = 0;

  var summaryState = {
    data: null,
    loading: false,
    requestId: 0,
    lastFetch: 0,
    samples: []
  };

  var compareState = { data: null, loading: false, requestId: 0, lastFetch: 0, expanded: false };
  var COMPARE_PREVIEW = 6;
  var riskState = { items: [], loading: false, lastFetch: 0 };
  var selectedTargets = new Set();
  var searchState = { data: null, loading: false, requestId: 0 };

  var activitySort = { key: 'time', dir: 'desc' };
  var activePage = 'summary';
  var PAGES = ['summary', 'activity', 'targets', 'accounts', 'search', 'settings'];
  var PAGE_MENU = {
    summary: 'summary',
    activity: 'activity',
    targets: 'data',
    accounts: 'data',
    search: 'data',
    settings: 'settings'
  };
  var searchTimer = null;
  var globalSearchTimer = null;
  var accountSearchTimer = null;
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

  function formatDateOnly(value) {
    var date = parseServerTime(value);
    if (!date) return '—';
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatTimeOnly(value) {
    var date = parseServerTime(value);
    if (!date) return '—';
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
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
    var badge = make('span', 'badge ' + meta.cls);
    badge.appendChild(make('span', 'status-dot is-' + status));
    badge.appendChild(document.createTextNode(
      status === 'FAILED' && item.retry_count ? 'Gagal · ' + item.retry_count + 'x' : meta.label));
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
    el.workerPillText.textContent = busy ? 'Worker aktif' : 'Worker siaga';
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

    var since = workerSeenLabel ? ' · terakhir ' + workerSeenLabel : '';
    el.workerNoticeText.textContent = formatNumber(queued) + ' menunggu · worker belum berjalan' + since;
    el.workerNoticeText.title = 'Buka ekstensi sunscraping, lalu klik Mulai worker agar antrean diproses.';
    el.workerNotice.hidden = false;
  }

  function renderLastSync() {
    if (!el.activitySync) return;
    if (!lastSyncAt) {
      el.activitySync.textContent = '';
      return;
    }
    var diff = Math.round((Date.now() - lastSyncAt) / 1000);
    el.activitySync.textContent = diff < 10
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
      autoSelectAudit = true;
    }

    // One audit is always in scope: a queue, a recap and an export read better
    // with a named scope than with an "all audits" bucket.
    var autoSelected = false;
    if (!currentAuditId && audits.length) {
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

    audits.forEach(function (audit) {
      var option = make('option', null,
        (audit.period ? monthLabel(audit.period) + ' · ' : '') + audit.name);
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
      if (el.auditCost) el.auditCost.hidden = true;
      if (el.rerunCost) el.rerunCost.hidden = true;
      el.rerunBtn.disabled = true;
      el.rerunFullBtn.disabled = true;
      el.deleteAuditBtn.disabled = true;
      el.rerunBtn.title = 'Pilih satu audit untuk menjalankan ulang';
      el.rerunFullBtn.title = 'Pilih satu audit untuk mendaur ulang semua target';
      el.deleteAuditBtn.title = 'Pilih audit yang akan dihapus';
      updateManageNote(false);
      updateExportUi();
      updateRetryButton();
      return;
    }

    if (!audit) {
      meta.textContent = 'Audit tidak ditemukan.';
      if (el.auditCost) el.auditCost.hidden = true;
      if (el.rerunCost) el.rerunCost.hidden = true;
      el.rerunBtn.disabled = true;
      el.rerunFullBtn.disabled = true;
      el.deleteAuditBtn.disabled = true;
      el.rerunBtn.title = 'Pilih satu audit yang ada untuk menjalankan ulang';
      el.deleteAuditBtn.title = 'Pilih audit yang akan dihapus';
      updateManageNote(false);
      updateRetryButton();
      return;
    }

    var parts = [audit.name, formatNumber(audit.target_count) + ' target'];
    parts.push(audit.repeat_days > 0 ? 'otomatis tiap ' + audit.repeat_days + ' hari' : 'manual');
    if (audit.last_run_at) parts.push('terakhir ' + timeRelative(audit.last_run_at));
    // Context only: name, batch size, last run. Cost and schedule live in their
    // own chip so this line stays readable instead of becoming a paragraph.
    meta.textContent = parts.join(' · ');
    meta.title = audit.over_budget
      ? 'Melebihi budget ' + formatNumber(audit.visit_budget) + ' kunjungan per siklus; worker berhenti di angka itu.'
      : '';

    if (el.auditCost) {
      var cost = [];
      if (audit.visit_estimate !== undefined && audit.visit_estimate !== null) {
        cost.push('±' + formatNumber(audit.visit_estimate) + ' kunjungan');
      }
      if (audit.repeat_days > 0 && audit.next_due_at) {
        cost.push('jadwal ' + timeRelative(audit.next_due_at));
      }
      el.auditCost.hidden = cost.length === 0;
      el.auditCost.textContent = cost.join(' · ');
      el.auditCost.title = audit.cached_targets
        ? formatNumber(audit.cached_targets) + ' tautan sudah terukur dan tidak perlu profil ulang'
        : 'Perkiraan jumlah halaman yang akan dibuka worker';
    }

    if (el.rerunCost) {
      var estimate = audit.visit_estimate;
      el.rerunCost.hidden = estimate === undefined || estimate === null;
      el.rerunCost.textContent = 'Audit ulang penuh: ±' + formatNumber(estimate) +
        ' kunjungan · Ulangi target gagal hanya menyentuh baris yang gagal pada siklus ini.';
    }

    // Audits arrive after the first page render, so a deep link to Settings used
    // to show empty fields until the reader navigated away and back.
    if (activePage === 'settings') fillSettingsForm();

    var busy = Number(audit.pending_count) > 0 || Number(audit.running_count) > 0;
    el.rerunBtn.disabled = busy;
    el.rerunBtn.title = busy
      ? 'Selesaikan antrean audit ini sebelum menjadwalkan ulang'
      : 'Hanya target yang belum punya angka (hemat kunjungan)';
    el.rerunFullBtn.disabled = busy;
    el.rerunFullBtn.title = busy
      ? 'Selesaikan antrean audit ini sebelum menjadwalkan ulang'
      : 'Daur ulang seluruh target, termasuk yang sudah terverifikasi';
    el.deleteAuditBtn.disabled = false;
    updateManageNote(true);
    updateExportUi();

    updateRetryButton();
  }

  function updateBatchBar() {
    if (!el.targetBatch) return;
    var count = selectedTargets.size;
    var show = count > 0 && activePage === 'targets';
    el.targetBatch.hidden = !show;
    if (el.targetBatchCount) el.targetBatchCount.textContent = formatNumber(count) + ' dipilih';
    if (el.targetBatchRetry) el.targetBatchRetry.disabled = count === 0;
  }

  function syncSelectAll() {
    if (!el.targetSelectAll || !el.targetBody) return;
    var boxes = Array.prototype.slice.call(
      el.targetBody.querySelectorAll('tr[data-target-id] input[type="checkbox"]'));
    if (!boxes.length) {
      el.targetSelectAll.checked = false;
      el.targetSelectAll.indeterminate = false;
      return;
    }
    var checked = boxes.filter(function (box) { return box.checked; }).length;
    el.targetSelectAll.checked = checked === boxes.length;
    el.targetSelectAll.indeterminate = checked > 0 && checked < boxes.length;
  }

  function updateRetryButton() {
    var failed = lastStats ? Number(lastStats.FAILED) || 0 : 0;
    el.retryFailedBtn.disabled = !currentAuditId || failed === 0;
    el.retryFailedBtn.title = !currentAuditId
      ? 'Pilih satu audit untuk mengulang target gagal'
      : failed === 0 ? 'Tidak ada target gagal pada audit ini' : 'Jadwalkan ulang ' + failed + ' target gagal';

    // The same action sits beside the number it acts on: a failure should not
    // require opening Settings just to be retried.
    if (el.processRetryBtn) {
      var show = Boolean(currentAuditId) && failed > 0;
      el.processRetryBtn.hidden = !show;
      el.processRetryBtn.disabled = !show;
      el.processRetryBtn.textContent = 'Ulangi ' + formatNumber(failed) + ' gagal';
      el.processRetryBtn.title = 'Jadwalkan ulang ' + formatNumber(failed) + ' target gagal pada audit ini';
    }
  }

  function renderStats(stats) {
    stats = stats || {};
    lastStats = stats;
    var counts = {
      PENDING: Number(stats.PENDING) || 0,
      RUNNING: Number(stats.RUNNING) || 0,
      OK: Number(stats.OK) || 0,
      PARTIAL: Number(stats.PARTIAL) || 0,
      FAILED: Number(stats.FAILED) || 0
    };
    el.statPending.textContent = formatNumber(counts.PENDING);
    el.statRunning.textContent = formatNumber(counts.RUNNING);
    el.statOk.textContent = formatNumber(counts.OK);
    el.statPartial.textContent = formatNumber(counts.PARTIAL);
    el.statFailed.textContent = formatNumber(counts.FAILED);
    el.statFailed.classList.toggle('is-danger', counts.FAILED > 0);
    el.summaryItems.forEach(function (item) {
      item.classList.toggle('is-zero', !counts[(item.dataset.stat || '').toUpperCase()]);
    });
    renderProcessProgress(counts);

    // Every count stays on screen, including the zeros: a strip that grows and
    // shrinks as the queue drains cannot be compared before and after.
    renderWorker(stats.WORKER_LAST_SEEN);
    if (el.settingsWorker) {
      el.settingsWorker.textContent = stats.WORKER_LAST_SEEN
        ? 'Terakhir menghubungi backend ' + timeRelative(stats.WORKER_LAST_SEEN) + '.'
        : 'Belum ada worker yang menghubungi backend sejak aplikasi dijalankan.';
    }
    updateRetryButton();
    updateAuditMeta();
    updateExportUi();
  }

  // One bar answers "how far along is this run?" before the reader parses five
  // separate numbers; the counts below stay so progress can be compared.
  function renderProcessProgress(counts) {
    var total = counts.PENDING + counts.RUNNING + counts.OK + counts.PARTIAL + counts.FAILED;
    var done = counts.OK + counts.PARTIAL;
    if (el.processProgress) {
      el.processProgress.textContent = total ? Math.round(done * 100 / total) + '%' : '0%';
    }
    if (el.processSub) {
      el.processSub.textContent = total
        ? formatNumber(done) + ' dari ' + formatNumber(total) + ' target sudah diperiksa · ' +
          formatNumber(counts.PENDING + counts.RUNNING) + ' belum'
        : 'Belum ada target pada audit ini.';
    }
    if (!el.processBar) return;
    var fragment = document.createDocumentFragment();
    [['ok', counts.OK], ['partial', counts.PARTIAL], ['running', counts.RUNNING],
      ['pending', counts.PENDING], ['failed', counts.FAILED]].forEach(function (pair) {
      if (!total || !pair[1]) return;
      var segment = make('span', 'status-seg is-' + pair[0]);
      segment.style.width = (pair[1] * 100 / total) + '%';
      segment.title = formatNumber(pair[1]) + ' target';
      fragment.appendChild(segment);
    });
    el.processBar.replaceChildren(fragment);
  }

  // ---------- Recap ----------
  function handleFromUrl(url) {
    if (!url) return '';
    var text = String(url);
    var tiktok = text.match(/tiktok\.com\/(?:@|%40)([A-Za-z0-9._]{2,30})/i);
    if (tiktok) return tiktok[1];
    var instagram = text.match(/instagram\.com\/([A-Za-z0-9._]{2,30})\/(?:p|reels?|tv)\//i);
    return instagram ? instagram[1] : '';
  }

  function targetHandle(item) {
    // A link that names its owner is evidence; the sheet label is only a claim.
    return handleFromUrl(item.url) || item.username || '';
  }

  function erMissingReason(item) {
    if (item.platform === 'tiktok') {
      return item.views
        ? 'ER belum dihitung untuk baris ini.'
        : 'Views belum terbaca, jadi ER TikTok tidak bisa dihitung.';
    }
    if (!item.follower_count) {
      return 'Followers akun belum terukur (butuh kunjungan profil), jadi ER Instagram tidak bisa dihitung.';
    }
    return 'ER belum dihitung untuk baris ini.';
  }

  function formatDuration(hours) {
    var minutes = Math.round(hours * 60);
    if (minutes < 60) return Math.max(1, minutes) + ' menit';
    var rest = minutes % 60;
    return Math.floor(minutes / 60) + ' jam' + (rest ? ' ' + rest + ' menit' : '');
  }

  function trackThroughput(stats) {
    var done = (Number(stats.OK) || 0) + (Number(stats.PARTIAL) || 0) + (Number(stats.FAILED) || 0);
    var samples = summaryState.samples;
    var now = Date.now();
    var last = samples[samples.length - 1];
    if (last && last.done === done && now - last.at < 120000) return;
    samples.push({ at: now, done: done });
    while (samples.length > 60) samples.shift();
    var cutoff = now - 30 * 60000;
    while (samples.length > 2 && samples[0].at < cutoff) samples.shift();
  }

  function throughputPerHour() {
    var samples = summaryState.samples;
    if (samples.length < 2) return null;
    var first = samples[0];
    var last = samples[samples.length - 1];
    var hours = (last.at - first.at) / 3600000;
    if (hours <= 0 || last.done <= first.done) return null;
    return (last.done - first.done) / hours;
  }

  function loadSummary(force) {
    if (!el.summaryBody) return;
    if (summaryState.loading) return;
    if (!force && Date.now() - summaryState.lastFetch < SUMMARY_REFRESH_MS) return;
    summaryState.loading = true;
    var requestId = ++summaryState.requestId;
    fetchJson('/api/summary' + auditQuery()).then(function (data) {
      if (requestId !== summaryState.requestId) return;
      summaryState.data = data;
      summaryState.lastFetch = Date.now();
      renderSummary();
    }).catch(function () {
      if (summaryState.lastFetch) return;
      if (el.summarySkeleton) el.summarySkeleton.hidden = true;
      el.summaryBody.hidden = true;
      el.summaryEmpty.hidden = false;
      el.summaryEmptyCopy.textContent = 'Dashboard tidak bisa dimuat. Periksa koneksi ke backend lalu coba lagi.';
    }).finally(function () {
      summaryState.loading = false;
    });
  }

  function kpiCard(label, value, sub, rows) {
    var card = make('div', 'kpi');
    card.appendChild(make('span', 'kpi-label', label));
    if (rows && rows.length) {
      // A metric whose meaning differs per platform gets one row per platform
      // instead of a single headline number picked by link count.
      var list = make('div', 'kpi-rows');
      rows.forEach(function (row) {
        var line = make('div', 'kpi-row');
        line.appendChild(make('span', 'kpi-row-label', row.label));
        var val = make('span', 'kpi-row-value', row.value);
        if (row.lowSample) val.classList.add('is-warn');
        line.appendChild(val);
        if (row.note) line.title = row.note;
        list.appendChild(line);
      });
      card.appendChild(list);
    } else {
      card.appendChild(make('div', 'kpi-value', value));
    }
    if (sub) card.appendChild(make('span', 'kpi-sub', sub));
    return card;
  }

  function recapCell(text, className) {
    return make('td', className || null,
      text === null || text === undefined || text === '' ? '—' : text);
  }

  function recapEmptyRow(tbody, columns, message) {
    var tr = make('tr');
    var td = make('td', 'recap-empty', message);
    td.colSpan = columns;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  function recapAccountCell(item) {
    var td = make('td', 'account-cell');
    var line = make('span', 'account-line');
    line.appendChild(platformDot(item.platform));
    var recapHandle = handleFromUrl(item.url) || item.username;
    var label = recapHandle ? '@' + recapHandle : (item.handle || '—');
    if (item.url) {
      var link = make('a', 'account recap-link', label);
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      line.appendChild(link);
    } else {
      line.appendChild(make('span', 'account', label));
    }
    td.appendChild(line);
    return td;
  }

  function renderSummary() {
    var data = summaryState.data;
    if (!data || !data.kpi) return;
    var kpi = data.kpi;
    var totals = kpi.totals || {};
    var limits = data.limits || {};
    var minRows = Number(limits.min_er_rows) || 2;

    if (el.summarySkeleton) el.summarySkeleton.hidden = true;

    if (!kpi.targets) {
      el.summaryBody.hidden = true;
      el.summaryEmpty.hidden = false;
      el.summaryEmptyCopy.textContent = 'Belum ada target pada audit ini. Impor daftar link untuk mulai mengaudit.';
      return;
    }

    el.summaryBody.hidden = false;
    el.summaryEmpty.hidden = true;

    var platforms = data.platforms || [];
    var erRows = platforms.map(function (item) {
      return {
        label: platformLabel(item.platform),
        value: formatEr(item.median_er),
        lowSample: item.median_er !== null && item.er_rows < minRows,
        note: item.median_er === null
          ? 'Belum ada baris dengan penyebut lengkap; ER belum bisa dihitung.'
          : 'Median dari ' + formatNumber(item.er_rows) + ' baris' +
            (item.er_rows < minRows ? ' — sampel kecil, baca sebagai indikasi.' : '.')
      };
    });

    var statusCounts = data.status || {};
    var remaining = (Number(statusCounts.PENDING) || 0) + (Number(statusCounts.RUNNING) || 0);

    // Modern Executive Cockpit Grid
    renderCockpitKpi(data, limits, minRows);

    // One short label on screen; the technical window stays in the tooltip so a
    // timestamp never competes with the numbers it describes.
    el.summaryStamp.textContent = data.generated_at ? 'Diperbarui ' + timeRelative(data.generated_at) : '';
    el.summaryStamp.title = kpi.first_scraped_at
      ? 'Rekap ' + formatDateTime(data.generated_at) + '\nData ' + formatDateTime(kpi.first_scraped_at) +
        ' sampai ' + formatDateTime(kpi.last_scraped_at)
      : '';

    if (el.qaProcess) {
      var rate = throughputPerHour();
      el.qaProcess.title = remaining
        ? 'Perkiraan ' + (rate && rate > 0 ? formatDuration(remaining / rate) : 'belum terukur') + ' lagi'
        : 'Semua target sudah diproses';
      el.qaProcess.replaceChildren(document.createTextNode(
        remaining ? 'Lihat proses · ' + formatNumber(remaining) + ' tersisa' : 'Lihat proses'));
      var qaArrow = make('span', null, '→');
      qaArrow.setAttribute('aria-hidden', 'true');
      el.qaProcess.appendChild(qaArrow);
    }

    var quality = data.quality || {};
    renderDiagnosticQuality(quality, kpi);

    // Platform Duel cards and standard table fallback
    renderPlatformDuel(platforms, minRows);

    el.summaryPlatformBody.replaceChildren();
    platforms.forEach(function (item) {
      var tr = make('tr');
      tr.appendChild(recapCell(platformLabel(item.platform)));
      tr.appendChild(recapCell(formatNumber(item.targets), 'num'));
      tr.appendChild(recapCell(formatNumber((item.ok || 0) + (item.partial || 0)), 'num'));
      tr.appendChild(recapCell(formatNumber(item.views), 'num'));
      tr.appendChild(recapCell(formatNumber(item.likes), 'num col-likes'));
      tr.appendChild(recapCell(formatNumber(item.comments), 'num col-comments'));
      tr.appendChild(recapCell(formatNumber(item.shares), 'num col-share'));
      var erTd = make('td', 'num');
      erTd.appendChild(make('span', 'metric-value', formatEr(item.median_er)));
      if (item.median_er !== null && item.er_rows < minRows) {
        erTd.appendChild(make('span', 'metric-sub is-warn', 'n=' + item.er_rows));
      }
      tr.appendChild(erTd);
      el.summaryPlatformBody.appendChild(tr);
    });
    if (!platforms.length) {
      recapEmptyRow(el.summaryPlatformBody, 8, 'Belum ada platform yang terbaca.');
    }

    // Spotlight Leaderboard
    renderSpotlight();

    // Populate fallback tables for contract safety
    var topViews = (data.posts && data.posts.top_views) || [];
    el.summaryTopViewsBody.replaceChildren();
    topViews.forEach(function (post) {
      var tr = make('tr');
      tr.appendChild(recapAccountCell(post));
      tr.appendChild(recapCell(formatNumber(post.views), 'num'));
      tr.appendChild(recapCell(formatNumber(post.likes), 'num'));
      tr.appendChild(recapCell(formatEr(post.er), 'num'));
      el.summaryTopViewsBody.appendChild(tr);
    });
    if (!topViews.length) {
      recapEmptyRow(el.summaryTopViewsBody, 4, 'Belum ada views yang terbaca.');
    }
    if (el.summaryTopViewsCard) el.summaryTopViewsCard.hidden = !topViews.length;

    var topEr = (data.posts && data.posts.top_er) || [];
    el.summaryTopErBody.replaceChildren();
    topEr.forEach(function (post) {
      var tr = make('tr');
      tr.appendChild(recapAccountCell(post));
      tr.appendChild(recapCell(formatEr(post.er), 'num'));
      tr.appendChild(recapCell(formatNumber(post.views), 'num'));
      tr.appendChild(recapCell(formatNumber(post.likes), 'num'));
      el.summaryTopErBody.appendChild(tr);
    });
    if (!topEr.length) {
      recapEmptyRow(el.summaryTopErBody, 4, 'ER belum bisa dihitung: followers/views belum lengkap.');
    }
    if (el.summaryTopErCard) el.summaryTopErCard.hidden = !topEr.length;

    var temas = (data.temas || []).filter(function (item) {
      return item.tema !== '(tanpa tema)';
    });
    if (el.summaryTemaCard) {
      el.summaryTemaCard.hidden = temas.length === 0;
      el.summaryTemaBody.replaceChildren();
      temas.forEach(function (item) {
        var tr = make('tr');
        tr.appendChild(recapCell(item.tema));
        tr.appendChild(recapCell(formatNumber(item.targets), 'num'));
        tr.appendChild(recapCell(formatNumber(item.views), 'num'));
        tr.appendChild(recapCell(formatEr(item.median_er), 'num'));
        el.summaryTemaBody.appendChild(tr);
      });
    }

    var auditList = data.audits || [];
    if (el.summaryAuditCard) {
      el.summaryAuditCard.hidden = auditList.length < 2;
      el.summaryAuditBody.replaceChildren();
      auditList.forEach(function (item) {
        var tr = make('tr');
        tr.appendChild(recapCell(item.name));
        tr.appendChild(recapCell(formatNumber(item.targets), 'num'));
        tr.appendChild(recapCell(formatNumber((item.ok || 0) + (item.partial || 0)), 'num'));
        tr.appendChild(recapCell(formatNumber(item.pending), 'num'));
        tr.appendChild(recapCell(formatNumber(item.views), 'num'));
        tr.appendChild(recapCell(formatEr(item.median_er), 'num'));
        el.summaryAuditBody.appendChild(tr);
      });
    }

    el.summaryFootnote.hidden = true;
    el.summaryFootnote.textContent = '';
  }

  function filterTargetsByStatus(status) {
    setDataView('targets');
    targetState.status = status;
    if (el.targetStatus) el.targetStatus.value = status;
    targetState.offset = 0;
    targetState.signature = '';
    loadTargets(true);
  }

  function filterTargetsByPlatform(platform) {
    setDataView('targets');
    targetState.platform = platform;
    if (el.targetPlatform) el.targetPlatform.value = platform;
    targetState.offset = 0;
    targetState.signature = '';
    loadTargets(true);
  }

  function renderCockpitKpi(data, limits, minRows) {
    var kpi = data.kpi || {};
    var totals = kpi.totals || {};
    var statusCounts = data.status || {};
    var platforms = data.platforms || [];

    var remaining = (Number(statusCounts.PENDING) || 0) + (Number(statusCounts.RUNNING) || 0);
    var targets = Math.max(1, Number(kpi.targets) || 1);
    var okCount = Number(statusCounts.OK) || 0;
    var partCount = Number(statusCounts.PARTIAL) || 0;
    var failCount = Number(statusCounts.FAILED) || 0;
    var verified = Number(kpi.verified) || (okCount + partCount);
    var completionPct = Math.round(verified * 100 / targets);

    el.summaryKpi.replaceChildren();

    // Card 1: Velocity & Integrity
    var card1 = make('div', 'kpi-cockpit-card is-velocity');
    var head1 = make('div', 'kpi-cockpit-head');
    head1.appendChild(make('span', 'kpi-cockpit-title', 'Kecepatan & Integritas Audit'));
    head1.appendChild(make('span', 'kpi-cockpit-meta', completionPct + '% Selesai'));
    card1.appendChild(head1);

    var metric1 = make('div', 'kpi-cockpit-metric');
    metric1.appendChild(make('span', 'kpi-cockpit-number', formatNumber(verified)));
    metric1.appendChild(make('span', 'kpi-cockpit-denom', 'dari ' + formatNumber(kpi.targets) + ' target terverifikasi'));
    card1.appendChild(metric1);

    var progBar = make('div', 'kpi-progress-bar');
    var okWidth = Math.round(okCount * 100 / targets);
    var partWidth = Math.round(partCount * 100 / targets);
    var failWidth = Math.round(failCount * 100 / targets);
    var pendWidth = Math.max(0, 100 - (okWidth + partWidth + failWidth));

    if (okWidth > 0) {
      var segOk = make('span', 'kpi-progress-seg is-ok');
      segOk.style.width = okWidth + '%';
      segOk.title = 'Selesai: ' + formatNumber(okCount) + ' (' + okWidth + '%)';
      progBar.appendChild(segOk);
    }
    if (partWidth > 0) {
      var segPart = make('span', 'kpi-progress-seg is-partial');
      segPart.style.width = partWidth + '%';
      segPart.title = 'Sebagian: ' + formatNumber(partCount) + ' (' + partWidth + '%)';
      progBar.appendChild(segPart);
    }
    if (failWidth > 0) {
      var segFail = make('span', 'kpi-progress-seg is-failed');
      segFail.style.width = failWidth + '%';
      segFail.title = 'Gagal: ' + formatNumber(failCount) + ' (' + failWidth + '%)';
      progBar.appendChild(segFail);
    }
    if (pendWidth > 0) {
      var segPend = make('span', 'kpi-progress-seg is-pending');
      segPend.style.width = pendWidth + '%';
      segPend.title = 'Antrean: ' + formatNumber(remaining) + ' (' + pendWidth + '%)';
      progBar.appendChild(segPend);
    }
    card1.appendChild(progBar);

    var chips = make('div', 'kpi-status-chips');
    var chipOk = make('button', 'kpi-chip is-ok');
    chipOk.type = 'button';
    chipOk.title = 'Filter target Selesai (OK) di halaman Target';
    chipOk.appendChild(make('span', 'kpi-chip-dot'));
    chipOk.appendChild(document.createTextNode('Selesai ' + formatNumber(okCount)));
    chipOk.addEventListener('click', function () { filterTargetsByStatus('OK'); });
    chips.appendChild(chipOk);

    var chipPart = make('button', 'kpi-chip is-partial');
    chipPart.type = 'button';
    chipPart.title = 'Filter target Terbaca Sebagian (PARTIAL) di halaman Target';
    chipPart.appendChild(make('span', 'kpi-chip-dot'));
    chipPart.appendChild(document.createTextNode('Sebagian ' + formatNumber(partCount)));
    chipPart.addEventListener('click', function () { filterTargetsByStatus('PARTIAL'); });
    chips.appendChild(chipPart);

    if (failCount > 0) {
      var chipFail = make('button', 'kpi-chip is-failed');
      chipFail.type = 'button';
      chipFail.title = 'Filter target Gagal (FAILED) di halaman Target';
      chipFail.appendChild(make('span', 'kpi-chip-dot'));
      chipFail.appendChild(document.createTextNode('Gagal ' + formatNumber(failCount)));
      chipFail.addEventListener('click', function () { filterTargetsByStatus('FAILED'); });
      chips.appendChild(chipFail);
    }

    var chipPend = make('button', 'kpi-chip is-pending');
    chipPend.type = 'button';
    chipPend.title = remaining ? 'Buka antrean proses worker di halaman Aktivitas' : 'Semua antrean selesai diproses';
    chipPend.appendChild(make('span', 'kpi-chip-dot'));
    chipPend.appendChild(document.createTextNode(remaining ? 'Antrean ' + formatNumber(remaining) : 'Antrean bersih'));
    chipPend.addEventListener('click', function () { setPage('activity'); });
    chips.appendChild(chipPend);
    card1.appendChild(chips);

    el.summaryKpi.appendChild(card1);

    // Card 2: Campaign Reach & Impact
    var card2 = make('div', 'kpi-cockpit-card is-reach');
    var head2 = make('div', 'kpi-cockpit-head');
    head2.appendChild(make('span', 'kpi-cockpit-title', 'Hasil Jangkauan (Reach & Engagement)'));
    head2.appendChild(make('span', 'kpi-cockpit-meta', formatNumber(kpi.accounts || 0) + ' Akun Terlibat'));
    card2.appendChild(head2);

    var metric2 = make('div', 'kpi-cockpit-metric');
    metric2.appendChild(make('span', 'kpi-cockpit-number', formatNumber(totals.views || 0)));
    metric2.appendChild(make('span', 'kpi-cockpit-denom', 'Total Views Terkumpul'));
    card2.appendChild(metric2);

    // Platform share bar
    var igViews = 0, ttViews = 0;
    var igEr = null, ttEr = null;
    platforms.forEach(function (p) {
      if (p.platform === 'instagram') { igViews = p.views || 0; igEr = p.median_er; }
      if (p.platform === 'tiktok') { ttViews = p.views || 0; ttEr = p.median_er; }
    });
    var sumViews = igViews + ttViews;
    if (sumViews > 0) {
      var shareBar = make('div', 'kpi-share-bar');
      var ttShare = Math.round(ttViews * 100 / sumViews);
      var igShare = 100 - ttShare;
      if (ttShare > 0) {
        var segTt = make('span', 'kpi-share-seg is-tt');
        segTt.style.width = ttShare + '%';
        segTt.title = 'TikTok: ' + formatNumber(ttViews) + ' views (' + ttShare + '%)';
        shareBar.appendChild(segTt);
      }
      if (igShare > 0) {
        var segIg = make('span', 'kpi-share-seg is-ig');
        segIg.style.width = igShare + '%';
        segIg.title = 'Instagram: ' + formatNumber(igViews) + ' views (' + igShare + '%)';
        shareBar.appendChild(segIg);
      }
      card2.appendChild(shareBar);

      var shareLegend = make('div', 'kpi-share-legend');
      shareLegend.appendChild(make('span', null, 'TikTok: ' + ttShare + '% (' + formatNumber(ttViews) + ')'));
      shareLegend.appendChild(make('span', null, 'Instagram: ' + igShare + '% (' + formatNumber(igViews) + ')'));
      card2.appendChild(shareLegend);

      var shareNote = make('div', 'kpi-share-note', 'ℹ️ Views Instagram hanya mencakup Reels & Video.');
      card2.appendChild(shareNote);
    }

    var subMatrix = make('div', 'kpi-sub-matrix');
    function addSubItem(label, val, isBrand, tooltip) {
      var item = make('div', 'kpi-sub-item');
      item.appendChild(make('span', 'kpi-sub-label', label));
      var vNode = make('span', 'kpi-sub-val' + (isBrand ? ' is-brand' : ''), val);
      if (tooltip) item.title = tooltip;
      item.appendChild(vNode);
      subMatrix.appendChild(item);
    }
    addSubItem('Likes', formatNumber(totals.likes || 0));
    addSubItem('Komentar', formatNumber(totals.comments || 0));
    addSubItem('Share', formatNumber(totals.shares || 0));

    if (ttEr !== null && igEr !== null) {
      addSubItem('Median ER', 'TT ' + formatEr(ttEr) + ' · IG ' + formatEr(igEr), true,
        'TikTok berbasis views: (likes+komentar+share)/views. Instagram berbasis followers: (likes+komentar)/followers.');
    } else if (ttEr !== null) {
      addSubItem('Median ER (TikTok)', formatEr(ttEr), true, 'TikTok: (likes+komentar+share) ÷ views');
    } else if (igEr !== null) {
      addSubItem('Median ER (IG)', formatEr(igEr), true, 'Instagram: (likes+komentar) ÷ followers');
    } else {
      addSubItem('Median ER', '—', true);
    }
    card2.appendChild(subMatrix);

    el.summaryKpi.appendChild(card2);
  }

  function renderPlatformDuel(platforms, minRows) {
    if (!el.summaryPlatformCards) return;
    el.summaryPlatformCards.replaceChildren();

    if (el.summaryPlatformSubtitle) {
      if (platforms.length === 1) {
        el.summaryPlatformSubtitle.textContent = 'Platform Tunggal: ' + platformLabel(platforms[0].platform);
      } else if (platforms.length > 1) {
        el.summaryPlatformSubtitle.textContent = 'Instagram vs TikTok';
      } else {
        el.summaryPlatformSubtitle.textContent = '';
      }
    }

    if (platforms.length === 1) {
      el.summaryPlatformCards.classList.add('is-single');
    } else {
      el.summaryPlatformCards.classList.remove('is-single');
    }

    if (!platforms.length) {
      var emptyNotice = make('div', 'recap-empty', 'Belum ada platform yang terbaca.');
      el.summaryPlatformCards.appendChild(emptyNotice);
      return;
    }

    platforms.forEach(function (item) {
      var isIg = item.platform === 'instagram';
      var card = make('div', 'platform-card ' + (isIg ? 'is-ig' : 'is-tt'));

      var head = make('div', 'platform-card-head');
      var badge = make('span', 'platform-card-badge');
      badge.appendChild(platformDot(item.platform));
      badge.appendChild(document.createTextNode(platformLabel(item.platform)));
      head.appendChild(badge);

      var verifiedCount = (item.ok || 0) + (item.partial || 0);
      var ratePct = item.targets ? Math.round(verifiedCount * 100 / item.targets) : 0;
      head.appendChild(make('span', 'platform-card-meta', formatNumber(verifiedCount) + '/' + formatNumber(item.targets) + ' (' + ratePct + '%)'));
      card.appendChild(head);

      var statsGrid = make('div', 'platform-card-stats');

      var cell1 = make('div', 'platform-stat-cell');
      cell1.appendChild(make('span', 'platform-stat-label', 'Total Views'));
      cell1.appendChild(make('span', 'platform-stat-value', formatNumber(item.views)));
      statsGrid.appendChild(cell1);

      var cell2 = make('div', 'platform-stat-cell');
      cell2.appendChild(make('span', 'platform-stat-label', isIg ? 'Likes & Komentar' : 'Likes & Share'));
      var engTotal = isIg ? ((item.likes || 0) + (item.comments || 0)) : ((item.likes || 0) + (item.shares || 0));
      cell2.appendChild(make('span', 'platform-stat-value', formatNumber(engTotal)));
      cell2.appendChild(make('span', 'platform-stat-sub', formatNumber(item.likes) + ' likes'));
      statsGrid.appendChild(cell2);

      var cell3 = make('div', 'platform-stat-cell');
      cell3.appendChild(make('span', 'platform-stat-label', 'Median ER'));
      cell3.appendChild(make('span', 'platform-stat-value', formatEr(item.median_er)));
      if (item.median_er !== null && item.er_rows < minRows) {
        cell3.appendChild(make('span', 'platform-stat-sub is-warn', 'n=' + item.er_rows + ' (sampel kecil)'));
      } else {
        cell3.appendChild(make('span', 'platform-stat-sub', isIg ? 'basis followers' : 'basis views'));
      }
      statsGrid.appendChild(cell3);
      card.appendChild(statsGrid);

      var btn = make('button', 'platform-card-btn', 'Lihat Target ' + platformLabel(item.platform) + ' →');
      btn.type = 'button';
      btn.addEventListener('click', function () {
        filterTargetsByPlatform(item.platform);
      });
      card.appendChild(btn);

      el.summaryPlatformCards.appendChild(card);
    });
  }

  var currentSpotlightTab = 'views';
  function renderSpotlight() {
    if (!el.summarySpotlightList) return;
    var data = summaryState.data;
    if (!data) return;

    var list = [];
    var maxVal = 1;
    if (currentSpotlightTab === 'views') {
      list = (data.posts && data.posts.top_views) || [];
      maxVal = Math.max.apply(null, list.map(function (p) { return Number(p.views) || 0; }).concat([1]));
    } else if (currentSpotlightTab === 'er') {
      list = (data.posts && data.posts.top_er) || [];
      maxVal = Math.max.apply(null, list.map(function (p) { return Number(p.er) || 0; }).concat([0.01]));
    } else if (currentSpotlightTab === 'accounts') {
      list = (data.accounts || []).slice(0, 5);
      maxVal = Math.max.apply(null, list.map(function (a) { return Number(a.views) || 0; }).concat([1]));
    }

    el.summarySpotlightList.replaceChildren();

    if (!list.length) {
      var msg = currentSpotlightTab === 'views'
        ? 'Belum ada views yang terbaca.'
        : (currentSpotlightTab === 'er' ? 'ER belum bisa dihitung: followers/views belum lengkap.' : 'Belum ada akun yang terbaca.');
      el.summarySpotlightList.appendChild(make('div', 'recap-empty', msg));
      return;
    }

    list.slice(0, 5).forEach(function (item, index) {
      var row = make('div', 'spotlight-item');

      var rankCls = index === 0 ? 'is-rank-1' : (index === 1 ? 'is-rank-2' : (index === 2 ? 'is-rank-3' : 'is-rank-other'));
      row.appendChild(make('span', 'spotlight-rank ' + rankCls, '#' + (index + 1)));

      var accountBox = make('div', 'spotlight-account');
      accountBox.appendChild(platformDot(item.platform));
      var recapHandle = handleFromUrl(item.url) || item.username;
      var label = recapHandle ? '@' + recapHandle : (item.handle || '—');
      var handleBtn = make('button', 'spotlight-handle', label);
      handleBtn.type = 'button';
      handleBtn.title = 'Buka detail profil akun';
      handleBtn.addEventListener('click', function () {
        var key = item.platform + ':' + (recapHandle || item.username || item.handle);
        openAccountDetail(key);
      });
      accountBox.appendChild(handleBtn);
      row.appendChild(accountBox);

      var barWrap = make('div', 'spotlight-bar-wrapper');
      var track = make('div', 'spotlight-bar-track');
      var fill = make('span', 'spotlight-bar-fill');
      var currentVal = currentSpotlightTab === 'views'
        ? (Number(item.views) || 0)
        : (currentSpotlightTab === 'er' ? (Number(item.er) || 0) : (Number(item.views) || 0));
      var fillPct = Math.max(3, Math.min(100, Math.round(currentVal * 100 / maxVal)));
      fill.style.width = fillPct + '%';
      track.appendChild(fill);
      barWrap.appendChild(track);
      row.appendChild(barWrap);

      var metricsBox = make('div', 'spotlight-metrics');
      if (currentSpotlightTab === 'views') {
        metricsBox.appendChild(make('span', 'spotlight-metric-val', formatNumber(item.views) + ' views'));
        metricsBox.appendChild(make('span', 'spotlight-metric-sub', formatNumber(item.likes) + ' likes · ER ' + formatEr(item.er)));
      } else if (currentSpotlightTab === 'er') {
        var erHead = make('span', 'spotlight-metric-val', 'ER ' + formatEr(item.er));
        var isSmallSample = (item.platform === 'tiktok' && (Number(item.views) || 0) < 100) ||
                            (item.platform === 'instagram' && (Number(item.likes) || 0) < 20);
        if (isSmallSample) {
          var tagWarn = make('span', 'spotlight-tag is-sample-warn', 'sampel kecil');
          tagWarn.title = 'ER tinggi namun sampel metrik masih sedikit sehingga belum representatif.';
          erHead.appendChild(tagWarn);
        }
        metricsBox.appendChild(erHead);
        metricsBox.appendChild(make('span', 'spotlight-metric-sub', formatNumber(item.views) + ' views · ' + formatNumber(item.likes) + ' likes'));
      } else {
        metricsBox.appendChild(make('span', 'spotlight-metric-val', formatNumber(item.views) + ' views'));
        metricsBox.appendChild(make('span', 'spotlight-metric-sub', (item.followers ? formatNumber(item.followers) + ' followers · ' : '') + 'ER ' + formatEr(item.median_er)));
      }
      row.appendChild(metricsBox);

      var actionsBox = make('div', 'spotlight-actions');
      if (item.url) {
        var postLink = make('a', 'btn btn-ghost btn-xs', 'Post ↗');
        postLink.href = item.url;
        postLink.target = '_blank';
        postLink.rel = 'noopener noreferrer';
        actionsBox.appendChild(postLink);
      }
      var detailBtn = make('button', 'btn btn-secondary btn-xs', 'Akun');
      detailBtn.type = 'button';
      detailBtn.title = 'Buka slide drawer akun';
      detailBtn.addEventListener('click', function () {
        var key = item.platform + ':' + (recapHandle || item.username || item.handle);
        openAccountDetail(key);
      });
      actionsBox.appendChild(detailBtn);
      row.appendChild(actionsBox);

      el.summarySpotlightList.appendChild(row);
    });
  }

  function setSpotlightTab(tab) {
    currentSpotlightTab = tab;
    if (el.spotlightTabViews) {
      el.spotlightTabViews.classList.toggle('is-active', tab === 'views');
      el.spotlightTabViews.setAttribute('aria-selected', tab === 'views' ? 'true' : 'false');
    }
    if (el.spotlightTabEr) {
      el.spotlightTabEr.classList.toggle('is-active', tab === 'er');
      el.spotlightTabEr.setAttribute('aria-selected', tab === 'er' ? 'true' : 'false');
    }
    if (el.spotlightTabAccounts) {
      el.spotlightTabAccounts.classList.toggle('is-active', tab === 'accounts');
      el.spotlightTabAccounts.setAttribute('aria-selected', tab === 'accounts' ? 'true' : 'false');
    }
    if (el.topViewsAll) el.topViewsAll.hidden = tab === 'er';
    if (el.topErAll) el.topErAll.hidden = tab !== 'er';
    renderSpotlight();
  }

  function renderDiagnosticQuality(quality, kpi) {
    var gaps = (Number(quality.without_followers) || 0) +
               (Number(quality.partial) || 0) +
               (Number(quality.missing_views) || 0) +
               (Number(quality.missing_username) || 0) +
               (Number(quality.never_scraped) || 0);
    var totalAccounts = Math.max(1, Number(kpi.accounts) || 1);
    var healthPct = Math.max(0, Math.min(100, Math.round(100 - (gaps / totalAccounts * 40))));

    if (el.summaryHealthBadge) {
      if (gaps === 0) {
        el.summaryHealthBadge.className = 'health-badge is-perfect';
        el.summaryHealthBadge.textContent = '100% Siap Lapor';
      } else if (healthPct >= 80) {
        el.summaryHealthBadge.className = 'health-badge is-good';
        el.summaryHealthBadge.textContent = healthPct + '% Cukup Lengkap';
      } else {
        el.summaryHealthBadge.className = 'health-badge is-warn';
        el.summaryHealthBadge.textContent = healthPct + '% Perlu Tinjauan';
      }
    }

    if (el.summaryHealthGaugeFill) {
      el.summaryHealthGaugeFill.style.width = healthPct + '%';
      el.summaryHealthGaugeFill.className = 'health-meter-fill ' +
        (gaps === 0 ? 'is-perfect' : (healthPct >= 80 ? 'is-good' : 'is-warn'));
    }

    var qualityItems = [
      ['without_followers', 'Tanpa followers', 'Akun yang followers-nya belum pernah terukur. ER Instagram membutuhkan angka ini.', function () { setDataView('accounts'); }],
      ['partial', 'Sebagian terbaca', 'Akun yang setidaknya satu unggahannya hanya terbaca sebagian.', function () { filterTargetsByStatus('PARTIAL'); }],
      ['missing_views', 'TikTok tanpa views', 'Akun TikTok yang views-nya belum terbaca.', function () { filterTargetsByPlatform('tiktok'); }],
      ['missing_username', 'Tanpa handle', 'Akun yang tautannya tidak memuat handle, jadi ditampilkan sebagai URL.', function () { setDataView('accounts'); }],
      ['never_scraped', 'Belum diproses', 'Akun yang belum punya satu pun snapshot.', function () { filterTargetsByStatus('PENDING'); }]
    ];

    el.summaryQuality.replaceChildren();
    qualityItems.forEach(function (entry) {
      var value = Number(quality[entry[0]]) || 0;
      var li = make('li', 'quality-item');
      li.classList.toggle('is-clear', !value);
      li.title = entry[2] + (value ? ' (Klik untuk filter)' : '');
      li.appendChild(make('span', 'quality-value' + (value ? ' is-warn' : ''), formatNumber(value)));
      li.appendChild(make('span', 'quality-label', entry[1]));
      if (value > 0 && entry[3]) {
        li.style.cursor = 'pointer';
        li.addEventListener('click', entry[3]);
      }
      el.summaryQuality.appendChild(li);
    });
  }

  // Toggle platform cards vs table view
  if (el.platformCardsToggle && el.platformTableToggle) {
    el.platformCardsToggle.addEventListener('click', function () {
      if (el.summaryPlatformCards) el.summaryPlatformCards.hidden = false;
      if (el.summaryPlatformTableWrap) el.summaryPlatformTableWrap.hidden = true;
      el.platformCardsToggle.classList.add('is-active');
      el.platformTableToggle.classList.remove('is-active');
    });
    el.platformTableToggle.addEventListener('click', function () {
      if (el.summaryPlatformCards) el.summaryPlatformCards.hidden = true;
      if (el.summaryPlatformTableWrap) el.summaryPlatformTableWrap.hidden = false;
      el.platformTableToggle.classList.add('is-active');
      el.platformCardsToggle.classList.remove('is-active');
    });
  }

  // Spotlight tabs
  if (el.spotlightTabViews) el.spotlightTabViews.addEventListener('click', function () { setSpotlightTab('views'); });
  if (el.spotlightTabEr) el.spotlightTabEr.addEventListener('click', function () { setSpotlightTab('er'); });
  if (el.spotlightTabAccounts) el.spotlightTabAccounts.addEventListener('click', function () { setSpotlightTab('accounts'); });

  // Compare month quick pills
  function syncCompareButtons(months) {
    if (el.compareBtn3) el.compareBtn3.classList.toggle('is-active', months === '3');
    if (el.compareBtn6) el.compareBtn6.classList.toggle('is-active', months === '6');
    if (el.compareBtn12) el.compareBtn12.classList.toggle('is-active', months === '12');
  }

  [
    { btn: el.compareBtn3, months: '3' },
    { btn: el.compareBtn6, months: '6' },
    { btn: el.compareBtn12, months: '12' }
  ].forEach(function (pair) {
    if (!pair.btn) return;
    pair.btn.addEventListener('click', function () {
      if (el.compareMonths) el.compareMonths.value = pair.months;
      compareState.expanded = false;
      syncCompareButtons(pair.months);
      loadCompare(true);
    });
  });

  if (el.summaryImportBtn) {
    el.summaryImportBtn.addEventListener('click', openImportModal);
  }

  if (el.qaProcess) el.qaProcess.addEventListener('click', function () { setPage('activity'); });
  if (el.qaAccounts) el.qaAccounts.addEventListener('click', function () { setDataView('accounts'); });
  if (el.qaExport) el.qaExport.addEventListener('click', openExportModal);
  if (el.summaryRiskAll) el.summaryRiskAll.addEventListener('click', function () {
    accountState.sort = 'risk';
    accountState.dir = 'desc';
    accountState.offset = 0;
    setDataView('accounts');
  });

  if (el.qualityInfoBtn) {
    el.qualityInfoBtn.addEventListener('click', function () {
      var open = el.qualityInfo.hidden;
      el.qualityInfo.hidden = !open;
      el.qualityInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      el.qualityInfoBtn.classList.toggle('is-active', open);
    });
  }

  if (el.qualityInfoClose) {
    el.qualityInfoClose.addEventListener('click', function () {
      if (el.qualityInfo) el.qualityInfo.hidden = true;
      if (el.qualityInfoBtn) {
        el.qualityInfoBtn.setAttribute('aria-expanded', 'false');
        el.qualityInfoBtn.classList.remove('is-active');
      }
    });
  }

  function showTopTargets(key) {
    setDataView('targets');
    targetState.sort = key;
    targetState.dir = 'desc';
    targetState.offset = 0;
    targetState.signature = '';
    updateTargetSortHeaders();
    loadTargets(true);
  }

  if (el.topViewsAll) el.topViewsAll.addEventListener('click', function () { showTopTargets('views'); });
  if (el.topErAll) el.topErAll.addEventListener('click', function () { showTopTargets('er'); });

  if (el.targetSelectAll) {
    el.targetSelectAll.addEventListener('change', function () {
      var checked = el.targetSelectAll.checked;
      Array.prototype.forEach.call(
        el.targetBody.querySelectorAll('tr[data-target-id]'),
        function (row) {
          var box = row.querySelector('input[type="checkbox"]');
          if (!box) return;
          box.checked = checked;
          var id = Number(row.dataset.targetId);
          if (checked) selectedTargets.add(id); else selectedTargets.delete(id);
        });
      updateBatchBar();
    });
  }

  if (el.targetBatchClear) {
    el.targetBatchClear.addEventListener('click', function () {
      selectedTargets.clear();
      Array.prototype.forEach.call(
        el.targetBody.querySelectorAll('input[type="checkbox"]'),
        function (box) { box.checked = false; });
      if (el.targetSelectAll) {
        el.targetSelectAll.checked = false;
        el.targetSelectAll.indeterminate = false;
      }
      updateBatchBar();
    });
  }

  if (el.targetBatchRetry) {
    el.targetBatchRetry.addEventListener('click', async function () {
      if (!currentAuditId || !selectedTargets.size) return;
      var count = selectedTargets.size;
      var confirmed = await askConfirm({
        title: 'Ulangi ' + formatNumber(count) + ' target terpilih?',
        body: 'Target terpilih akan diantrekan untuk kunjungan baru. Angka lama tetap tersimpan sampai hasil baru masuk.',
        confirmLabel: 'Ulangi target'
      });
      if (!confirmed) return;
      el.targetBatchRetry.disabled = true;
      try {
        var data = await postJson('/api/targets/retry', {
          audit_id: currentAuditId,
          target_ids: Array.from(selectedTargets)
        });
        toast('success', data.message || 'Target dijadwalkan ulang.');
        selectedTargets.clear();
        updateBatchBar();
        loadTargets(false);
        pollOnce();
      } catch (error) {
        if (!unauthorizedShown) toast('error', error.message || 'Gagal menjadwalkan ulang.');
      } finally {
        el.targetBatchRetry.disabled = false;
      }
    });
  }

  // ---------- Monthly comparison ----------
  function monthLabel(period) {
    if (!period || String(period).length < 7) return period || '—';
    var names = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    var index = Number(String(period).slice(5, 7)) - 1;
    return (names[index] || period) + ' ' + String(period).slice(0, 4);
  }

  function loadCompare(force) {
    if (!el.compareBody || compareState.loading) return;
    if (!force && Date.now() - compareState.lastFetch < COMPARE_REFRESH_MS) return;
    compareState.loading = true;
    var requestId = ++compareState.requestId;
    var months = el.compareMonths ? el.compareMonths.value : '6';
    fetchJson('/api/compare?months=' + encodeURIComponent(months)).then(function (data) {
      if (requestId !== compareState.requestId) return;
      compareState.data = data;
      compareState.lastFetch = Date.now();
      renderCompare();
    }).catch(function () {
      if (!unauthorizedShown) toast('error', 'Perbandingan bulanan tidak bisa dimuat.');
    }).finally(function () {
      compareState.loading = false;
    });
  }

  // Risk is corpus-wide (all audits), which is exactly what coordination checks
  // need; it runs on its own throttle instead of riding every summary refresh.
  function loadRisk(force) {
    if (!el.summaryRiskCard) return;
    if (riskState.loading) return;
    if (!force && Date.now() - riskState.lastFetch < 60000) return;
    riskState.loading = true;
    fetchJson('/api/accounts?sort=risk&dir=desc&limit=12').then(function (data) {
      riskState.items = Array.isArray(data.items) ? data.items : [];
      riskState.lastFetch = Date.now();
      renderRisk();
    }).catch(function () {
      el.summaryRiskCard.hidden = true;
    }).finally(function () {
      riskState.loading = false;
    });
  }

  function renderRisk() {
    if (!el.summaryRiskCard || !el.summaryRiskList) return;
    var flagged = riskState.items.filter(function (item) { return Number(item.score) > 0; });
    var top = flagged.slice(0, 5);
    el.summaryRiskCard.hidden = top.length === 0;
    el.summaryRiskList.replaceChildren();
    if (!top.length) return;
    top.forEach(function (item) {
      var li = make('li');
      var row = make('button', 'risk-row');
      row.type = 'button';
      row.appendChild(make('span', 'risk-handle', '@' + (item.username || item.key)));
      var meta = levelMeta(item.level);
      row.appendChild(make('span', 'badge ' + meta.cls, meta.label));
      var labels = (item.flags || []).map(function (flag) { return flag.label; });
      var primary = primaryFlag(item);
      var riskText = primary ? primary.label : 'Tanpa sinyal rinci';
      if (labels.length > 1) riskText += ' · +' + (labels.length - 1);
      row.appendChild(make('span', 'risk-flags', riskText));
      row.appendChild(make('span', 'risk-score', item.score + ' poin'));
      row.title = labels.length ? labels.join(' · ') + ' — skor ' + item.score : 'Buka detail akun';
      row.addEventListener('click', function () { openAccountDetail(item.key); });
      li.appendChild(row);
      el.summaryRiskList.appendChild(li);
    });
    if (el.summaryRiskCount) {
      el.summaryRiskCount.textContent = flagged.length > top.length
        ? 'menampilkan ' + top.length + ' dari ' + formatNumber(flagged.length) + ' akun'
        : formatNumber(flagged.length) + ' akun';
    }
  }

  function renderCompare() {
    var data = compareState.data;
    if (!data) return;
    var periods = data.periods || [];

    if (el.compareMonths) syncCompareButtons(el.compareMonths.value);

    el.compareHead.replaceChildren();
    var headRow = make('tr');
    var accountTh = make('th', null, 'Akun');
    accountTh.scope = 'col';
    headRow.appendChild(accountTh);
    periods.forEach(function (period) {
      var th = make('th', 'compare-month', monthLabel(period));
      th.scope = 'col';
      headRow.appendChild(th);
    });
    el.compareHead.appendChild(headRow);

    // Ten rows answer "who changed this month"; the other thirty turn the only
    // overview page into a four-screen scroll, so they wait behind a button.
    var allAccounts = data.accounts || [];
    var visibleAccounts = compareState.expanded ? allAccounts : allAccounts.slice(0, COMPARE_PREVIEW);
    el.compareBody.replaceChildren();
    visibleAccounts.forEach(function (account) {
      var tr = make('tr');
      var accountTd = make('td', 'account-cell');
      var line = make('div', 'compare-account-info');

      var handleRow = make('div', 'compare-account-handle-row');
      handleRow.appendChild(platformDot(account.platform));
      var handleLabel = account.username ? '@' + account.username : (account.handle || '—');
      var handleNode = make('button', 'compare-account-handle', handleLabel);
      handleNode.type = 'button';
      handleNode.title = 'Buka slide drawer profil akun';
      handleNode.addEventListener('click', function () {
        openAccountDetail(account.platform + ':' + (account.username || account.handle));
      });
      handleRow.appendChild(handleNode);
      line.appendChild(handleRow);

      if (account.is_new) {
        line.appendChild(make('span', 'compare-badge is-new', '✨ Baru'));
      } else if (account.missing_latest) {
        line.appendChild(make('span', 'compare-badge is-absent', '⚠️ Absen bln ini'));
      }
      accountTd.appendChild(line);
      tr.appendChild(accountTd);

      var prevViews = null;
      periods.forEach(function (period) {
        var cell = account.months[period];
        var td = make('td', 'compare-cell');
        if (!cell) {
          var emptyCard = make('div', 'compare-cell-empty');
          emptyCard.appendChild(make('span', 'empty-dash', '—'));
          emptyCard.title = 'Tidak ada unggahan pada bulan ini';
          td.appendChild(emptyCard);
          prevViews = null;
        } else {
          var card = make('div', 'compare-cell-card');

          var top = make('div', 'compare-cell-top');
          top.appendChild(make('span', 'compare-views-num', formatNumber(cell.views)));
          top.appendChild(make('span', 'compare-views-unit', 'views'));

          if (prevViews !== null && prevViews > 0 && cell.views !== null && cell.views !== undefined) {
            var diff = Number(cell.views) - prevViews;
            var pct = Math.round(diff * 100 / prevViews);
            if (pct !== 0) {
              var deltaPill = make('span', 'delta-pill ' + (pct > 0 ? 'is-up' : 'is-down'),
                (pct > 0 ? '↑ +' : '↓ ') + pct + '%');
              deltaPill.title = (pct > 0 ? 'Naik ' : 'Turun ') + Math.abs(pct) + '% dibanding bulan sebelumnya';
              top.appendChild(deltaPill);
            }
          }
          prevViews = Number(cell.views) || 0;
          card.appendChild(top);

          var meta = make('div', 'compare-cell-meta');
          meta.appendChild(make('span', 'compare-tag', formatNumber(cell.posts) + ' post'));
          if (cell.median_er !== null && cell.median_er !== undefined) {
            meta.appendChild(make('span', 'compare-tag is-er', 'ER ' + formatEr(cell.median_er)));
          }
          card.appendChild(meta);

          if (cell.followers) {
            card.appendChild(make('div', 'compare-cell-followers', formatNumber(cell.followers) + ' flwr'));
          }
          td.appendChild(card);
        }
        tr.appendChild(td);
      });
      el.compareBody.appendChild(tr);
    });

    if (!allAccounts.length) {
      var emptyRow = make('tr');
      var emptyTd = make('td', 'recap-empty', 'Belum ada data bulanan. Impor batch pertama untuk memulai.');
      emptyTd.colSpan = Math.max(2, periods.length + 1);
      emptyRow.appendChild(emptyTd);
      el.compareBody.appendChild(emptyRow);
    }

    if (el.compareMore) {
      el.compareMore.hidden = allAccounts.length <= COMPARE_PREVIEW;
      el.compareMore.textContent = compareState.expanded
        ? 'Ringkas ke ' + COMPARE_PREVIEW + ' akun'
        : 'Tampilkan semua ' + formatNumber(allAccounts.length) + ' akun';
    }

    // One bar per period: the monthly trend is visible before reading a cell.
    if (el.compareBars) {
      var totals = periods.map(function (period) {
        var total = 0;
        (data.accounts || []).forEach(function (account) {
          var cell = account.months && account.months[period];
          if (cell) total += Number(cell.views) || 0;
        });
        return { period: period, views: total };
      });
      var maxTotal = totals.reduce(function (max, item) { return Math.max(max, item.views); }, 0);
      var showBars = totals.length >= 2 && maxTotal > 0;
      el.compareBars.hidden = !showBars;
      var barsWrap = document.getElementById('compareBarsWrap');
      if (barsWrap) barsWrap.hidden = !showBars;
      el.compareBars.replaceChildren();
      if (showBars) {
        var prevBarViews = null;
        totals.forEach(function (item) {
          var row = make('div', 'compare-bar-row');
          row.appendChild(make('span', 'compare-bar-label', monthLabel(item.period)));

          var track = make('div', 'compare-bar-track');
          var fill = make('span', 'compare-bar-fill');
          fill.style.width = Math.max(2, Math.round(item.views * 100 / maxTotal)) + '%';
          track.appendChild(fill);
          row.appendChild(track);

          var valBox = make('div', 'compare-bar-val-box');
          valBox.appendChild(make('strong', 'compare-bar-value', formatNumber(item.views) + ' views'));
          if (prevBarViews !== null && prevBarViews > 0 && item.views > 0) {
            var diff = item.views - prevBarViews;
            var pct = Math.round(diff * 100 / prevBarViews);
            if (pct !== 0) {
              valBox.appendChild(make('span', 'delta-pill ' + (pct > 0 ? 'is-up' : 'is-down'),
                (pct > 0 ? '↑ +' : '↓ ') + pct + '%'));
            }
          }
          prevBarViews = item.views;
          row.appendChild(valBox);

          el.compareBars.appendChild(row);
        });
      }
    }

    el.compareSummary.hidden = false;
    el.compareSummary.replaceChildren();

    var chipAccounts = make('div', 'compare-summary-chip');
    chipAccounts.appendChild(make('span', 'chip-icon', '👥'));
    chipAccounts.appendChild(make('span', 'chip-label', 'Akun Terpantau'));
    chipAccounts.appendChild(make('strong', null, formatNumber(data.summary.accounts)));
    el.compareSummary.appendChild(chipAccounts);

    var chipNew = make('div', 'compare-summary-chip is-new');
    chipNew.appendChild(make('span', 'chip-icon', '✨'));
    chipNew.appendChild(make('span', 'chip-label', 'Baru Bulan Ini'));
    chipNew.appendChild(make('strong', null, '+' + formatNumber(data.summary.new_accounts)));
    el.compareSummary.appendChild(chipNew);

    var missingCount = Number(data.summary.missing_latest) || 0;
    var chipMissing = make('div', 'compare-summary-chip' + (missingCount ? ' is-warn' : ''));
    chipMissing.appendChild(make('span', 'chip-icon', missingCount ? '⚠️' : '✓'));
    chipMissing.appendChild(make('span', 'chip-label', missingCount ? 'Absen Bulan Ini' : 'Semua Aktif'));
    chipMissing.appendChild(make('strong', null, formatNumber(missingCount)));
    el.compareSummary.appendChild(chipMissing);
  }

  // ---------- Manual search ----------
  function loadSearch() {
    if (!el.dataSearch) return;
    var query = el.dataSearch.value.trim();
    if (query.length < 2) {
      searchState.requestId += 1;
      searchState.data = null;
      ['Accounts', 'Targets', 'Posts'].forEach(function (name) {
        el['search' + name + 'Card'].hidden = true;
      });
      el.searchSummary.hidden = true;
      el.searchEmpty.hidden = false;
      el.searchEmptyTitle.textContent = 'Cari data yang sudah tersimpan';
      el.searchEmptyCopy.textContent = 'Ketik minimal dua huruf. Pencarian mencakup target, akun, dan unggahan.';
      return;
    }
    if (searchState.loading) return;
    searchState.loading = true;
    var requestId = ++searchState.requestId;
    fetchJson('/api/search?q=' + encodeURIComponent(query)).then(function (data) {
      if (requestId !== searchState.requestId) return;
      searchState.data = data;
      renderSearch();
    }).catch(function () {
      if (!unauthorizedShown) toast('error', 'Pencarian gagal dijalankan.');
    }).finally(function () {
      searchState.loading = false;
    });
  }

  function renderSearch() {
    var data = searchState.data || {};
    var groups = [
      ['Accounts', data.accounts || [], function (row) {
        var tr = make('tr');
        tr.appendChild(recapAccountCell({
          platform: row.platform, username: row.username, handle: row.username
        }));
        tr.appendChild(make('td', null, platformLabel(row.platform)));
        tr.appendChild(recapCell(formatNumber(row.follower_count), 'num'));
        tr.appendChild(recapCell(formatNumber(row.post_count), 'num'));
        tr.appendChild(recapCell(timeRelative(row.fetched_at)));
        return tr;
      }],
      ['Targets', data.targets || [], function (row) {
        var tr = make('tr');
        var td = make('td', 'account-cell');
        var line = make('span', 'account-line');
        line.appendChild(platformDot(row.platform));
        var handle = handleFromUrl(row.url) || row.username;
        if (row.url) {
          var link = make('a', 'account recap-link', handle ? '@' + handle : row.url);
          link.href = row.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          line.appendChild(link);
        } else {
          line.appendChild(make('span', 'account', handle || '—'));
        }
        td.appendChild(line);
        tr.appendChild(td);
        tr.appendChild(make('td', null, monthLabel(row.period)));
        tr.appendChild(statusCell({ status: row.status || 'PENDING' }));
        tr.appendChild(recapCell(timeRelative(row.last_scraped_at)));
        return tr;
      }],
      ['Posts', data.posts || [], function (row) {
        var tr = make('tr');
        tr.appendChild(recapAccountCell({
          platform: row.platform, username: row.username, handle: row.username
        }));
        tr.appendChild(recapCell(row.posted_at ? formatDateTime(row.posted_at) : '—'));
        tr.appendChild(recapCell(formatNumber(row.views), 'num'));
        tr.appendChild(recapCell(formatNumber(row.likes), 'num'));
        tr.appendChild(make('td', 'caption-cell', row.caption || '—'));
        return tr;
      }]
    ];

    var total = 0;
    var labels = { Accounts: 'Akun', Targets: 'Tautan', Posts: 'Unggahan' };
    groups.forEach(function (group) {
      var rows = group[1];
      total += rows.length;
      var card = el['search' + group[0] + 'Card'];
      var body = el['search' + group[0] + 'Body'];
      var title = card.querySelector('.recap-title');
      if (title) {
        title.replaceChildren(document.createTextNode(labels[group[0]] || group[0]));
        title.appendChild(make('span', 'recap-count', formatNumber(rows.length) + ' hasil'));
      }
      body.replaceChildren();
      rows.forEach(function (row) { body.appendChild(group[2](row)); });
      card.hidden = rows.length === 0;
    });

    el.searchSummary.hidden = false;
    el.searchSummary.textContent = total
      ? formatNumber(total) + ' hasil untuk "' + (data.query || '') + '"'
      : 'Tidak ada data yang cocok.';
    el.searchEmpty.hidden = total > 0;
    if (!total) {
      el.searchEmptyTitle.textContent = 'Tidak ada hasil';
      el.searchEmptyCopy.textContent = 'Coba handle lain, potongan URL, tema, atau kata di caption.';
    }
  }

  // ---------- Shareable state ----------
  function syncUrl() {
    if (!window.history || !window.history.replaceState) return;
    var params = [];
    if (currentAuditId) params.push('audit=' + currentAuditId);
    if (activePage !== 'summary') params.push('page=' + activePage);
    if (targetState.query) params.push('q=' + encodeURIComponent(targetState.query));
    if (targetState.status) params.push('status=' + encodeURIComponent(targetState.status));
    if (targetState.platform) params.push('platform=' + encodeURIComponent(targetState.platform));
    if (targetState.issue) params.push('issue=' + encodeURIComponent(targetState.issue));
    if (targetState.sort !== 'recent') params.push('sort=' + encodeURIComponent(targetState.sort) + '&dir=' + targetState.dir);
    if (targetState.offset > 0) params.push('offset=' + targetState.offset);
    if (activePage === 'accounts') {
      if (accountState.query) params.push('aq=' + encodeURIComponent(accountState.query));
      if (accountState.level) params.push('al=' + encodeURIComponent(accountState.level));
      if (accountState.band) params.push('ab=' + encodeURIComponent(accountState.band));
      if (accountState.platform) params.push('ap=' + encodeURIComponent(accountState.platform));
      if (accountState.sort !== 'risk') {
        params.push('asort=' + encodeURIComponent(accountState.sort), 'adir=' + accountState.dir);
      }
      if (accountState.offset > 0) params.push('aoffset=' + accountState.offset);
    }
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
    var page = params.get('page');
    if (page === 'data') {
      initialPage = 'targets';
    } else if (page === 'compare') {
      initialPage = 'summary';
    } else if (PAGES.indexOf(page) !== -1) {
      initialPage = page;
    }
    var view = params.get('view');
    if (view === 'accounts' || view === 'targets' || view === 'search') dataView = view;
    if (initialPage === 'accounts' || initialPage === 'search') dataView = initialPage;
    var status = params.get('status');
    targetState.query = (params.get('q') || '').slice(0, 120);
    targetState.status = ['done', 'pending', 'running', 'failed'].indexOf(status) !== -1 ? status : '';
    var platform = params.get('platform');
    targetState.platform = platform === 'instagram' || platform === 'tiktok' ? platform : '';
    var issue = params.get('issue');
    targetState.issue = ['no_followers', 'no_views'].indexOf(issue) !== -1 ? issue : '';
    var sort = params.get('sort');
    if (sort && ['username', 'followers', 'likes', 'comments', 'views', 'er'].indexOf(sort) !== -1) {
      targetState.sort = sort;
      targetState.dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
    }
    var offset = Number(params.get('offset'));
    if (isFinite(offset) && offset > 0) targetState.offset = Math.floor(offset / targetState.limit) * targetState.limit;

    var level = params.get('al');
    accountState.level = ['curiga', 'pola_kembar', 'pola_ternak', 'amati', 'bersih'].indexOf(level) !== -1 ? level : '';
    var band = params.get('ab');
    accountState.band = ['ternak', 'kecil', 'besar'].indexOf(band) !== -1 ? band : '';
    var accountPlatform = params.get('ap');
    accountState.platform = accountPlatform === 'instagram' || accountPlatform === 'tiktok' ? accountPlatform : '';
    accountState.query = (params.get('aq') || '').slice(0, 120);
    var accountSort = params.get('asort');
    if (accountSort && ['risk', 'followers', 'reach', 'posts', 'audits', 'age', 'username'].indexOf(accountSort) !== -1) {
      accountState.sort = accountSort;
      accountState.dir = params.get('adir') === 'asc' ? 'asc' : 'desc';
    }
    var accountOffset = Number(params.get('aoffset'));
    if (isFinite(accountOffset) && accountOffset > 0) {
      accountState.offset = Math.floor(accountOffset / accountState.limit) * accountState.limit;
    }
  }

  // ---------- Target list ----------
  function targetQueryString() {
    var params = [];
    if (currentAuditId) params.push('audit_id=' + encodeURIComponent(currentAuditId));
    if (targetState.status) params.push('status=' + encodeURIComponent(targetState.status));
    if (targetState.platform) params.push('platform=' + encodeURIComponent(targetState.platform));
    if (targetState.issue) params.push('issue=' + encodeURIComponent(targetState.issue));
    if (targetState.query) params.push('q=' + encodeURIComponent(targetState.query));
    params.push('sort=' + encodeURIComponent(targetState.sort));
    params.push('dir=' + encodeURIComponent(targetState.dir));
    params.push('limit=' + targetState.limit);
    params.push('offset=' + targetState.offset);
    return '/api/targets?' + params.join('&');
  }

  async function loadTargets(reset) {
    if (reset) {
      targetState.offset = 0;
      // A new filter or audit means the previous selection no longer refers to
      // the rows on screen; keeping it would retry the wrong batch.
      selectedTargets.clear();
      updateBatchBar();
    }
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
    if (activePage !== 'targets' || document.hidden) return;
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
          item.snapshot_at, item.task_scraped_at, item.post_date];
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
    syncSelectAll();
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
    if (item.status === 'FAILED') tr.classList.add('is-failed-row');
    else if (item.status === 'PARTIAL') tr.classList.add('is-partial-row');

    var selectTd = make('td', 'col-select');
    var check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = selectedTargets.has(Number(item.target_id));
    check.setAttribute('aria-label', 'Pilih baris ' + (targetHandle(item) || item.target_id));
    check.addEventListener('change', function () {
      if (check.checked) selectedTargets.add(Number(item.target_id));
      else selectedTargets.delete(Number(item.target_id));
      updateBatchBar();
      syncSelectAll();
    });
    selectTd.appendChild(check);
    tr.appendChild(selectTd);

    var accountTd = make('td', 'account-cell');
    var line = make('span', 'account-line');
    line.appendChild(platformDot(item.platform));
    var handle = targetHandle(item);
    line.appendChild(make('span', 'account', handle ? '@' + handle : (item.url || '—')));
    accountTd.appendChild(line);

    var urlHandle = handleFromUrl(item.url);
    var labelConflict = urlHandle && item.username &&
      urlHandle.toLowerCase() !== String(item.username).toLowerCase();
    var subParts = [];
    if (item.tema) subParts.push(item.tema);
    if (!currentAuditId && item.audit_name) subParts.push(item.audit_name);
    var fresh = item.snapshot_at || item.task_scraped_at || null;
    subParts.push(fresh ? 'diperiksa ' + timeRelative(fresh) : 'belum dicek');
    if (labelConflict) subParts.push('berkas: @' + item.username);
    var sub = make('span', 'account-sub', subParts.join(' · '));
    if (fresh) sub.title = formatDateTime(fresh);
    if (labelConflict) {
      sub.classList.add('is-warn');
      sub.title = 'Kolom akun di berkas (@' + item.username + ') berbeda dari pemilik tautan (@' +
        urlHandle + '). Nama yang ditampilkan mengikuti tautan.' +
        (fresh ? '\nDiperiksa ' + formatDateTime(fresh) : '');
    }
    accountTd.appendChild(sub);
    tr.appendChild(accountTd);

    var dateTd = make('td', 'data-cell col-upload');
    var dateVal = formatDateOnly(item.post_date);
    var dateNode = make('span', 'metric-value', dateVal);
    if (item.post_date) {
      dateNode.title = formatDateTime(item.post_date);
    }
    dateTd.appendChild(dateNode);
    tr.appendChild(dateTd);

    var timeTd = make('td', 'data-cell col-time');
    var timeVal = formatTimeOnly(item.post_date);
    if (timeVal !== '—') {
      var timeNode = make('span', 'time-pill', timeVal);
      if (item.post_date) {
        timeNode.title = formatDateTime(item.post_date);
      }
      timeTd.appendChild(timeNode);
    } else {
      timeTd.appendChild(make('span', 'metric-value text-muted', '—'));
    }
    tr.appendChild(timeTd);

    var postTd = make('td', 'col-post');
    if (item.url) {
      var postBtn = make('a', 'post-col-btn', 'Post ↗');
      postBtn.href = item.url;
      postBtn.target = '_blank';
      postBtn.rel = 'noopener noreferrer';
      postBtn.title = 'Buka postingan asli di tab baru';
      postTd.appendChild(postBtn);
    } else {
      postTd.appendChild(make('span', 'metric-value text-muted', '—'));
    }
    tr.appendChild(postTd);

    tr.appendChild(metricValueCell(item.follower_count, missingReason(item, 'followers'), 'col-followers'));
    tr.appendChild(metricValueCell(item.likes, null, 'col-likes'));
    tr.appendChild(metricValueCell(item.comments, null, 'col-comments'));
    tr.appendChild(metricValueCell(item.views));

    var erTd = make('td', 'num er col-er');
    var targetErNode = make('span', 'metric-value', formatEr(item.engagement_rate));
    if (item.engagement_rate === null || item.engagement_rate === undefined) {
      targetErNode.title = erMissingReason(item);
    }
    erTd.appendChild(targetErNode);
    tr.appendChild(erTd);

    tr.appendChild(statusCell(item));

    return tr;
  }

  function metricValueCell(value, reason, extraClass) {
    var td = make('td', 'num' + (extraClass ? ' ' + extraClass : ''));
    var missing = value === null || value === undefined || value === '';
    td.appendChild(make('span', 'metric-value', formatNumber(value)));
    // A dash without a reason is unreadable: "no followers" and "failed to read"
    // look identical, and one of them means the audit itself is incomplete. Only
    // the followers column prints the reason: repeating it on four cells of the
    // same failed row turns one explanation into noise.
    // The reason stays on the cell, not in the row: repeating "profil belum
    // diukur" under every dash turned a 40px row into a paragraph and made the
    // table harder to scan. The quality card counts these gaps.
    if (missing) {
      td.title = reason
        ? reason + ' — angka belum tersedia pada pengambilan terakhir.'
        : 'Angka tidak tersedia — lihat kolom Status.';
    }
    return td;
  }

  function missingReason(item, field) {
    if (item.status === 'FAILED') return 'gagal dibaca';
    if (item.status === 'PENDING' || item.status === 'RUNNING') return 'belum dicek';
    if (field === 'followers') return 'profil belum diukur';
    return 'tidak tersedia';
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

  // ---------- Account master list ----------
  var ACCOUNT_LEVELS = {
    pola_kembar: { cls: 'badge-risk-high', label: 'Pola kembar' },
    pola_ternak: { cls: 'badge-risk-mid', label: 'Pola ternak' },
    amati: { cls: 'badge-risk-watch', label: 'Diamati' },
    bersih: { cls: 'badge-risk-clean', label: 'Bersih' }
  };

  var LINK_REASON_LABELS = {
    konten: 'unggahannya sama',
    kontak: 'kontak bionya sama',
    template: 'captionnya seragam',
    serentak: 'jam uploadnya berdekatan'
  };

  function levelMeta(level) {
    return ACCOUNT_LEVELS[level] || ACCOUNT_LEVELS.bersih;
  }

  function handleFromKey(key) {
    var index = String(key || '').indexOf(':');
    return index === -1 ? String(key || '') : '@' + String(key).slice(index + 1);
  }

  function reasonLabel(kind) {
    return LINK_REASON_LABELS[kind] || kind;
  }

  // The one signal worth saying out loud. Cross-account evidence (same post,
  // same contact, same caption) outranks a single account's own metrics, so a
  // reviewer reads the strongest reason first instead of a flat list.
  var FLAG_PRIORITY = {
    konten_kembar: 0, kontak_bio_sama: 1, caption_template: 2,
    followers_datar: 3, reach_rendah: 4, unggah_bertumpuk: 5,
    komentar_minim: 6, unggah_serentak: 7, akun_salur: 8
  };
  function primaryFlag(item) {
    var flags = (item && item.flags) || [];
    if (!flags.length) return null;
    return flags.slice().sort(function (a, b) {
      var pa = FLAG_PRIORITY[a.key] === undefined ? 99 : FLAG_PRIORITY[a.key];
      var pb = FLAG_PRIORITY[b.key] === undefined ? 99 : FLAG_PRIORITY[b.key];
      return pa !== pb ? pa - pb : (b.points || 0) - (a.points || 0);
    })[0];
  }

  function pickReach(item) {
    var metrics = (item && item.metrics) || {};
    var value = metrics.view_reach_pct;
    if (value === null || value === undefined) value = metrics.like_reach_pct;
    return value === null || value === undefined || !isFinite(Number(value)) ? null : Number(value);
  }

  function formatPct(value) {
    if (value === null || value === undefined || !isFinite(Number(value))) return '—';
    return Number(value).toFixed(1).replace('.', ',') + '%';
  }

  function formatDecimal(value) {
    if (value === null || value === undefined || !isFinite(Number(value))) return '—';
    return Number(value).toFixed(1).replace('.', ',');
  }

  function riskBadge(item) {
    var meta = levelMeta(item.level);
    var badge = make('span', 'badge ' + meta.cls, meta.label);
    var reasons = (item.flags || []).map(function (flag) { return flag.label; });
    badge.title = reasons.length
      ? reasons.join(' · ') + ' — skor ' + item.score
      : 'Tidak ada sinyal mencurigakan';
    return badge;
  }

  function accountQueryString() {
    var params = [];
    if (accountState.level) params.push('level=' + encodeURIComponent(accountState.level));
    if (accountState.band) params.push('band=' + encodeURIComponent(accountState.band));
    if (accountState.platform) params.push('platform=' + encodeURIComponent(accountState.platform));
    if (accountState.query) params.push('q=' + encodeURIComponent(accountState.query));
    params.push('sort=' + encodeURIComponent(accountState.sort));
    params.push('dir=' + encodeURIComponent(accountState.dir));
    params.push('limit=' + accountState.limit);
    params.push('offset=' + accountState.offset);
    return '/api/accounts?' + params.join('&');
  }

  async function loadAccounts(reset) {
    if (reset) accountState.offset = 0;
    accountState.requestId += 1;
    var requestId = accountState.requestId;
    accountState.lastFetch = Date.now();
    syncUrl();
    try {
      var data = await fetchJson(accountQueryString());
      if (requestId !== accountState.requestId) return;
      accountState.items = Array.isArray(data.items) ? data.items : [];
      accountState.total = Number(data.total) || 0;
      accountState.limit = Number(data.limit) || accountState.limit;
      accountState.offset = Number(data.offset) || 0;
      accountState.clusters = Array.isArray(data.clusters) ? data.clusters : [];
      accountState.summary = data.summary || null;
      accountState.thresholds = data.thresholds || null;
      if (el.accountSkeleton) el.accountSkeleton.hidden = true;
      renderAccounts();
    } catch (error) {
      if (el.accountSkeleton) el.accountSkeleton.hidden = true;
      if (unauthorizedShown || requestId !== accountState.requestId) return;
      el.accountTableWrap.hidden = true;
      el.accountPager.hidden = true;
      el.accountSummary.hidden = true;
      el.accountClusters.hidden = true;
      el.accountEmpty.hidden = false;
      el.accountEmptyTitle.textContent = 'Gagal memuat akun';
      el.accountEmptyCopy.textContent = 'Backend tidak dapat dihubungi. Data yang terakhir tampil tetap tersimpan.';
      el.accountResetBtn.hidden = true;
      el.accountRetryBtn.hidden = false;
    }
  }

  function maybeLoadAccounts(force) {
    if (activePage !== 'accounts' || document.hidden) return;
    if (!force && Date.now() - accountState.lastFetch < ACCOUNTS_REFRESH_MS) return;
    loadAccounts(false);
  }

  function renderAccountSummary() {
    var summary = accountState.summary;
    if (!summary || !summary.accounts) {
      el.accountSummary.hidden = true;
      return;
    }
    var thresholds = accountState.thresholds || {};
    var band = Array.isArray(thresholds.band) ? thresholds.band : [];
    var parts = [
      formatNumber(summary.accounts) + ' akun tersimpan',
      formatNumber(summary.flagged) + ' berpola mencurigakan',
      formatNumber(summary.in_band) + ' dalam band ' + formatNumber(band[0]) + '–' + formatNumber(band[1])
    ];
    if (summary.shown !== summary.accounts) parts.unshift(formatNumber(summary.shown) + ' cocok filter');
    parts.push(formatNumber(summary.needs_refresh) + ' perlu diharvest ulang');
    el.accountSummary.textContent = parts.join(' · ');
    el.accountSummary.hidden = false;
  }

  function renderAccountClusters() {
    var clusters = accountState.clusters || [];
    el.accountClusters.replaceChildren();
    if (!clusters.length) {
      el.accountClusters.hidden = true;
      return;
    }
    el.accountClusters.appendChild(document.createTextNode(
      clusters.length + ' grup akun tertaut: '));
    clusters.slice(0, 4).forEach(function (cluster, index) {
      if (index) el.accountClusters.appendChild(document.createTextNode(' · '));
      var entry = make('span', 'cluster-item', cluster.members.map(handleFromKey).join(' + '));
      if (cluster.strong) entry.classList.add('is-strong');
      entry.title = (cluster.reasons || []).map(reasonLabel).join(', ');
      el.accountClusters.appendChild(entry);
    });
    if (clusters.length > 4) {
      el.accountClusters.appendChild(document.createTextNode(' +' + (clusters.length - 4) + ' grup lain'));
    }
    el.accountClusters.hidden = false;
  }

  function renderAccounts() {
    if (el.accountSkeleton) el.accountSkeleton.hidden = true;
    renderAccountSummary();
    renderAccountClusters();

    var items = accountState.items;
    var signature = JSON.stringify({
      total: accountState.total,
      offset: accountState.offset,
      sort: accountState.sort + accountState.dir,
      items: items.map(function (item) {
        return [item.key, item.followers, item.score, item.level, item.needs_refresh,
          item.metrics.view_reach_pct, item.metrics.like_reach_pct, item.metrics.posts_per_week,
          item.audits_seen, item.fetched_at];
      })
    });
    if (signature === accountState.signature) {
      updateAccountSortHeaders();
      return;
    }
    accountState.signature = signature;

    if (!items.length) {
      el.accountTableWrap.hidden = true;
      el.accountPager.hidden = true;
      el.accountEmpty.hidden = false;
      el.accountRetryBtn.hidden = true;
      var filtered = Boolean(accountState.level || accountState.band || accountState.platform || accountState.query);
      if (filtered) {
        el.accountEmptyTitle.textContent = 'Tidak ada akun yang cocok';
        el.accountEmptyCopy.textContent = 'Ubah filter atau level risiko untuk melihat akun lain.';
        el.accountResetBtn.hidden = false;
      } else {
        el.accountEmptyTitle.textContent = 'Belum ada akun tersimpan';
        el.accountEmptyCopy.textContent = 'Akun terisi sendiri saat worker membuka link atau profil akun dari ekstensi.';
        el.accountResetBtn.hidden = true;
      }
      el.accountBody.replaceChildren();
      updateAccountSortHeaders();
      return;
    }

    var fragment = document.createDocumentFragment();
    items.forEach(function (item) { fragment.appendChild(buildAccountRow(item)); });
    var focusRow = el.accountBody.contains(document.activeElement)
      ? document.activeElement.closest('tr[data-account-key]')
      : null;
    var focusKey = focusRow ? focusRow.dataset.accountKey : null;
    el.accountBody.replaceChildren(fragment);
    if (focusKey) {
      var restore = el.accountBody.querySelector('tr[data-account-key="' + focusKey + '"]');
      if (restore) restore.focus();
    }

    el.accountTableWrap.hidden = false;
    el.accountEmpty.hidden = true;

    var start = accountState.offset + 1;
    var end = Math.min(accountState.offset + items.length, accountState.total);
    var page = Math.floor(accountState.offset / accountState.limit) + 1;
    var pages = Math.max(1, Math.ceil(accountState.total / accountState.limit));
    el.accountPageInfo.textContent = 'Halaman ' + page + ' dari ' + pages + ' · ' +
      formatNumber(start) + '–' + formatNumber(end) + ' dari ' + formatNumber(accountState.total) + ' akun';
    el.accountPrev.disabled = accountState.offset <= 0;
    el.accountNext.disabled = accountState.offset + items.length >= accountState.total;
    el.accountPager.hidden = false;
    updateAccountSortHeaders();
  }

  function buildAccountRow(item) {
    var tr = make('tr');
    tr.dataset.accountKey = item.key;
    tr.tabIndex = 0;
    tr.title = 'Klik atau tekan Enter untuk bukti, riwayat bulanan, dan unggahan akun ini';

    var accountTd = make('td', 'account-cell');
    var line = make('span', 'account-line');
    line.appendChild(platformDot(item.platform));
    line.appendChild(make('span', 'account', '@' + (item.username || '—')));
    if (item.is_verified) {
      var tick = make('span', 'verified-mark', '✓');
      tick.title = 'Akun terverifikasi';
      line.appendChild(tick);
    }
    accountTd.appendChild(line);

    var subParts = [];
    if (item.display_name) subParts.push(item.display_name);
    if (item.in_ternak_band) subParts.push('band ternak');
    if (item.following) subParts.push('following ' + formatNumber(item.following));
    var sub = make('span', 'account-sub', subParts.join(' · '));
    if (item.bio) sub.title = item.bio;
    accountTd.appendChild(sub);
    tr.appendChild(accountTd);

    tr.appendChild(metricValueCell(item.followers, null, 'col-followers'));

    var reachTd = make('td', 'num er');
    var reach = pickReach(item);
    reachTd.appendChild(make('span', 'metric-value', formatPct(reach)));
    if (reach === null) {
      reachTd.appendChild(make('span', 'metric-sub', 'belum cukup unggahan'));
    } else if (reach < (item.platform === 'tiktok' ? 3 : 1)) {
      reachTd.appendChild(make('span', 'metric-sub is-error', 'di bawah ambang'));
    }
    tr.appendChild(reachTd);

    var uploadTd = make('td', 'num col-posts');
    uploadTd.appendChild(make('span', 'metric-value', formatDecimal(item.metrics.posts_per_week)));
    if (item.metrics.upload_burst >= 3) {
      var burstSub = make('span', 'metric-sub is-error', item.metrics.upload_burst + ' sekaligus');
      burstSub.title = 'Beberapa unggahan naik dalam jendela beberapa menit.';
      uploadTd.appendChild(burstSub);
    }
    tr.appendChild(uploadTd);

    var auditsTd = make('td', 'num col-audits');
    auditsTd.appendChild(make('span', 'metric-value', formatNumber(item.audits_seen)));
    var targetSub = make('span', 'metric-sub', item.targets_seen + ' link');
    targetSub.title = 'Jumlah link akun ini yang sudah diverifikasi.';
    auditsTd.appendChild(targetSub);
    tr.appendChild(auditsTd);

    var dataTd = make('td', 'data-cell col-updated');
    dataTd.appendChild(make('span', 'metric-value', item.fetched_at ? timeRelative(item.fetched_at) : 'Belum ada'));
    if (item.needs_refresh) {
      var due = make('span', 'metric-sub is-warn', 'perlu diharvest');
      due.title = 'Data lebih tua dari masa pakai cache; bulan depan akun ini cukup dibuka sekali.';
      dataTd.appendChild(due);
    }
    tr.appendChild(dataTd);

    var riskTd = make('td', 'num status-cell');
    riskTd.appendChild(riskBadge(item));
    var primary = primaryFlag(item);
    var scoreSub = make('span', 'cell-sub',
      primary ? primary.label : (item.flags.length ? item.flags[0].label : 'Bersih'));
    scoreSub.title = item.flags.length
      ? 'Skor ' + item.score + ' · ' + item.flags.map(function (flag) { return flag.label; }).join(' · ')
      : 'Tidak ada sinyal mencurigakan';
    riskTd.appendChild(scoreSub);
    tr.appendChild(riskTd);

    return tr;
  }

  function sortAccounts(key) {
    if (accountState.sort === key) {
      accountState.dir = accountState.dir === 'asc' ? 'desc' : 'asc';
    } else {
      accountState.sort = key;
      accountState.dir = key === 'username' ? 'asc' : 'desc';
    }
    accountState.offset = 0;
    updateAccountSortHeaders();
    loadAccounts(false);
  }

  function updateAccountSortHeaders() {
    if (!el.accountHead) return;
    var headers = el.accountHead.querySelectorAll('th[aria-sort]');
    Array.prototype.forEach.call(headers, function (th) {
      var button = th.querySelector('button[data-account-sort]');
      if (!button) return;
      var active = button.dataset.accountSort === accountState.sort;
      th.setAttribute('aria-sort', active ? (accountState.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      var ind = button.querySelector('.sort-ind');
      if (ind) ind.textContent = active ? (accountState.dir === 'asc' ? '↑' : '↓') : '↕';
    });
  }

  function resetAccountFilters() {
    el.accountSearch.value = '';
    el.accountLevel.value = '';
    el.accountBand.value = '';
    el.accountPlatform.value = '';
    accountState.query = '';
    accountState.level = '';
    accountState.band = '';
    accountState.platform = '';
    loadAccounts(true);
  }

  // ---------- Account detail ----------
  var currentAccountKey = null;
  async function openAccountDetail(key) {
    currentAccountKey = key;
    var index = String(key || '').indexOf(':');
    if (index === -1) return;
    var platform = String(key).slice(0, index);
    var username = String(key).slice(index + 1);

    showModal(el.accountModal, el.accountClose);
    accountDetailRequest += 1;
    var requestId = accountDetailRequest;
    el.accountTitle.textContent = '@' + username;
    el.accountSub.textContent = 'Memuat…';
    el.accountRisk.hidden = true;
    el.accountFlags.replaceChildren();
    el.accountProfile.replaceChildren();
    el.accountSiblingsBox.hidden = true;
    el.accountSiblings.replaceChildren();
    el.accountTrendBox.hidden = true;
    el.accountHistoryBody.replaceChildren();
    el.accountPostsBox.hidden = true;
    el.accountPostsBody.replaceChildren();

    try {
      var data = await fetchJson('/api/accounts/' + encodeURIComponent(platform) + '/' + encodeURIComponent(username));
      if (requestId !== accountDetailRequest) return;
      renderAccountDetail(data.account || {});
    } catch (error) {
      if (requestId !== accountDetailRequest || unauthorizedShown) return;
      el.accountSub.textContent = error.message || 'Gagal memuat detail akun.';
    }
  }

  function profileRow(label, value, hint) {
    var row = make('div', 'profile-row');
    row.appendChild(make('span', 'profile-label', label));
    row.appendChild(make('span', 'profile-value', value === null || value === undefined || value === '' ? '—' : value));
    if (hint) row.appendChild(make('span', 'profile-hint', hint));
    return row;
  }

  function renderAccountDetail(account) {
    if (!account || !account.username) {
      el.accountSub.textContent = 'Akun belum pernah disimpan.';
      return;
    }

    el.accountTitle.textContent = '@' + account.username;
    var sub = el.accountSub;
    sub.replaceChildren();
    sub.appendChild(document.createTextNode(platformLabel(account.platform)));
    if (account.display_name) sub.appendChild(document.createTextNode(' · ' + account.display_name));
    if (account.region) sub.appendChild(document.createTextNode(' · ' + account.region));
    if (account.fetched_at) {
      var stamp = make('span', 'history-meta', ' · data ' + timeRelative(account.fetched_at));
      stamp.title = formatDateTime(account.fetched_at);
      sub.appendChild(stamp);
    }

    var meta = levelMeta(account.level);
    el.accountRiskBadge.className = 'badge ' + meta.cls;
    el.accountRiskBadge.textContent = meta.label;
    el.accountRiskScore.textContent = account.score + ' poin';
    el.accountFlags.replaceChildren();
    (account.flags || []).forEach(function (flag) {
      var row = make('li', 'flag-item');
      row.appendChild(make('span', 'flag-label', flag.label));
      row.appendChild(make('span', 'flag-detail', flag.detail));
      row.appendChild(make('span', 'flag-points', '+' + flag.points));
      el.accountFlags.appendChild(row);
    });
    if (!(account.flags || []).length) {
      el.accountFlags.appendChild(make('li', 'flag-item', 'Tidak ada sinyal mencurigakan dari data yang kita punya.'));
    }
    el.accountRisk.hidden = false;

    var metrics = account.metrics || {};
    var profileRows = document.createDocumentFragment();
    profileRows.appendChild(profileRow('Followers', formatNumber(account.followers),
      account.in_ternak_band ? 'dalam band ternak' : null));
    profileRows.appendChild(profileRow('Following', formatNumber(account.following)));
    profileRows.appendChild(profileRow('Unggahan di profil', formatNumber(account.post_count)));
    profileRows.appendChild(profileRow('Median views', formatNumber(metrics.median_views)));
    profileRows.appendChild(profileRow('Median likes', formatNumber(metrics.median_likes)));
    profileRows.appendChild(profileRow('Median komentar', formatNumber(metrics.median_comments)));
    profileRows.appendChild(profileRow('Reach', formatPct(pickReach(account)),
      account.platform === 'tiktok' ? 'views ÷ followers' : 'likes ÷ followers'));
    profileRows.appendChild(profileRow('Bulan tercatat', formatNumber(account.months_seen),
      account.follower_delta_pct === null || account.follower_delta_pct === undefined
        ? null
        : 'selisih ' + formatDecimal(account.follower_delta_pct) + '%'));
    profileRows.appendChild(profileRow('Audit diikuti', formatNumber(account.audits_seen),
      account.targets_seen + ' link diverifikasi'));
    profileRows.appendChild(profileRow('Unggahan disimpan', formatNumber(metrics.posts_seen)));
    if (account.bio) profileRows.appendChild(profileRow('Bio', account.bio));
    if (account.external_id) profileRows.appendChild(profileRow('ID eksternal', account.external_id));
    el.accountProfile.replaceChildren(profileRows);

    var siblings = account.siblings || [];
    if (siblings.length) {
      var fragment = document.createDocumentFragment();
      siblings.forEach(function (sibling) {
        var row = make('li', 'peer-item');
        row.appendChild(platformDot(sibling.platform));
        row.appendChild(make('span', 'peer-handle', '@' + (sibling.username || '—')));
        row.appendChild(make('span', 'peer-score', levelMeta(sibling.level).label + ' · ' + (sibling.score || 0)));
        var reasons = (sibling.reasons || []).map(reasonLabel).join(', ');
        if (reasons) row.appendChild(make('span', 'peer-reason', reasons));
        fragment.appendChild(row);
      });
      el.accountSiblings.replaceChildren(fragment);
      el.accountSiblingsBox.hidden = false;
    }

    var history = account.history || [];
    if (history.length) {
      var historyFragment = document.createDocumentFragment();
      history.forEach(function (row, index) {
        var previous = history[index - 1] || null;
        var tr = make('tr');
        tr.appendChild(make('td', 'row-time', row.month));
        tr.appendChild(monthCell(row.follower_count, previous ? previous.follower_count : null));
        tr.appendChild(make('td', 'num', formatNumber(row.following_count)));
        tr.appendChild(make('td', 'num', formatNumber(row.post_count)));
        var visitsTd = make('td', 'num');
        visitsTd.appendChild(make('span', 'metric-value', formatNumber(row.visits)));
        if (row.first_seen_at) visitsTd.title = 'Pertama ' + formatDateTime(row.first_seen_at);
        tr.appendChild(visitsTd);
        historyFragment.appendChild(tr);
      });
      el.accountHistoryBody.replaceChildren(historyFragment);
      el.accountTrendBox.hidden = false;
    }

    var posts = account.posts || [];
    if (posts.length) {
      var postFragment = document.createDocumentFragment();
      posts.forEach(function (post) {
        var tr = make('tr');
        var timeTd = make('td', 'row-time', post.posted_at ? timeRelative(post.posted_at) : '—');
        if (post.posted_at) timeTd.title = formatDateTime(post.posted_at);
        tr.appendChild(timeTd);
        tr.appendChild(make('td', 'num', formatNumber(post.views)));
        tr.appendChild(make('td', 'num', formatNumber(post.likes)));
        tr.appendChild(make('td', 'num', formatNumber(post.comments)));
        var captionTd = make('td', 'caption-cell', post.caption || '—');
        if (post.caption) captionTd.title = post.caption;
        if (post.caption_templated) {
          captionTd.classList.add('is-templated');
          captionTd.title = (captionTd.title ? captionTd.title + ' · ' : '') + 'Pola caption sama dengan akun lain';
        }
        tr.appendChild(captionTd);
        postFragment.appendChild(tr);
      });
      el.accountPostsBody.replaceChildren(postFragment);
      el.accountPostsBox.hidden = false;
    }
  }

  function monthCell(value, previous) {
    var td = make('td', 'num');
    td.appendChild(make('span', 'metric-value', formatNumber(value)));
    var delta = deltaNode(value, previous);
    if (delta) td.appendChild(delta);
    return td;
  }

  function closeAccountDetail() {
    hideModal(el.accountModal);
  }

  // A shared toolbar belongs to the page it acts on: title first, then tabs and
  // actions. Moving the one toolbar keeps a single set of ids instead of copying
  // the markup into every data view.
  function positionDataChrome(onData) {
    el.dataToolbar.hidden = !onData;
    if (!onData) return;
    var section = document.querySelector('.page[data-page="' + activePage + '"]');
    if (!section) return;
    var head = section.querySelector('.page-head');
    if (!head) return;
    if (el.dataActions && el.dataActions.parentNode !== head) head.appendChild(el.dataActions);
    if (head.nextElementSibling !== el.dataToolbar) {
      head.insertAdjacentElement('afterend', el.dataToolbar);
    }
  }

  function setPage(name, focusMenu) {
    activePage = PAGES.indexOf(name) === -1 ? 'summary' : name;

    var pages = [
      { key: 'summary', node: el.pageSummary },
      { key: 'activity', node: el.pageActivity },
      { key: 'targets', node: el.pageTargets },
      { key: 'accounts', node: el.pageAccounts },
      { key: 'search', node: el.pageSearch },
      { key: 'settings', node: el.pageSettings }
    ];
    pages.forEach(function (page) {
      page.node.hidden = page.key !== activePage;
    });

    var menuKey = PAGE_MENU[activePage];
    [el.navSummary, el.navActivity, el.navData, el.navSettings].forEach(function (button) {
      var selected = button.dataset.page === menuKey;
      button.classList.toggle('is-active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
      if (selected && focusMenu) button.focus();
    });

    // Import, export and the target filters belong to the data pages only.
    var onData = activePage === 'targets' || activePage === 'accounts' || activePage === 'search';
    el.targetToolbar.hidden = activePage !== 'targets';
    positionDataChrome(onData);
    // The audit picker is not part of Settings; there it reads as if it changed
    // which settings are edited rather than which batch is in scope.
    if (el.sidebarAudit) el.sidebarAudit.hidden = activePage === 'settings';
    updateRetryButton();
    updateBatchBar();
    syncUrl();

    if (activePage === 'settings') fillSettingsForm();
    if (activePage === 'summary') {
      loadSummary(false);
      // Comparison is part of the overview, not a separate workspace.
      loadCompare(false);
      loadRisk(false);
    }
    if (activePage === 'search') loadSearch(false);
    if (activePage === 'targets') loadTargets(false);
    if (activePage === 'accounts') loadAccounts(false);
  }

  function fillSettingsForm() {
    var audit = selectedAudit();
    if (!audit) return;
    // Never overwrite a field the user is currently typing in.
    if (document.activeElement !== el.settingsName) el.settingsName.value = audit.name || '';
    if (document.activeElement !== el.settingsRepeat) {
      el.settingsRepeat.value = String(audit.repeat_days || 0);
    }
    if (document.activeElement !== el.settingsPeriod) {
      el.settingsPeriod.value = audit.period || '';
    }
  }

  function setDataView(view, focusTab) {
    dataView = view === 'accounts' || view === 'search' ? view : 'targets';
    [['targets', el.tabTargets], ['accounts', el.tabAccounts], ['search', el.tabSearch]]
      .forEach(function (pair) {
        if (!pair[1]) return;
        var selected = pair[0] === dataView;
        pair[1].setAttribute('aria-selected', selected ? 'true' : 'false');
        pair[1].tabIndex = selected ? 0 : -1;
        if (selected && focusTab) pair[1].focus();
      });
    setPage(dataView);
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
    if (key === 'upload') {
      var upload = parseServerTime(item.post_date);
      return upload ? upload.getTime() : null;
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
      el.activityNote.textContent = formatNumber(lastRows.length) + ' unggahan terbaru · satu baris satu tautan';
      el.activityNote.title = 'Tgl. unggah = waktu unggahan naik. Diperiksa = waktu data diambil. Klik baris untuk riwayat target.';
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
          item.username, item.tema, item.audit_name, item.scraped_at, item.post_date];
      })
    });

    if (!force && signature === rowsSignature) return;
    rowsSignature = signature;

    var ordered = sortedRows();
    var fragment = document.createDocumentFragment();
    ordered.forEach(function (item) { fragment.appendChild(buildRow(item)); });
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
    var rowHandle = targetHandle(item);
    line.appendChild(make('span', 'account', rowHandle ? '@' + rowHandle : '—'));
    accountTd.appendChild(line);
    var subParts = [];
    if (item.tema) subParts.push(item.tema);
    if (!currentAuditId && item.audit_name) subParts.push(item.audit_name);
    if (subParts.length) accountTd.appendChild(make('span', 'account-sub', subParts.join(' · ')));
    tr.appendChild(accountTd);

    // One value per cell: the per-post change lives in the history modal, so the
    // feed stays scannable instead of every number carrying a second line.
    tr.appendChild(metricValueCell(item.follower_count, missingReason(item, 'followers'), 'col-followers'));
    tr.appendChild(metricValueCell(item.likes, null, 'col-likes'));
    tr.appendChild(metricValueCell(item.comments, null, 'col-comments'));
    tr.appendChild(metricValueCell(item.views));

    var erTd = make('td', 'num er col-er');
    var er = calcEr(item.platform, item.likes, item.comments, item.views, item.shares, item.follower_count);
    var erNode = make('span', 'metric-value', formatEr(er));
    if (er === null) erNode.title = erMissingReason(item);
    erTd.appendChild(erNode);
    tr.appendChild(erTd);

    // The upload time is the post's own timestamp, not when we checked it; the
    // two differ by weeks and conflating them hides whether a post is fresh.
    var uploadTd = make('td', 'row-time col-upload', item.post_date ? timeRelative(item.post_date) : '—');
    if (item.post_date) uploadTd.title = formatDateTime(item.post_date);
    tr.appendChild(uploadTd);

    tr.appendChild(statusCell(item));

    var timeTd = make('td', 'row-time col-checked', timeRelative(item.scraped_at));
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

  var currentHistoryTargetId = null;
  async function openHistory(targetId) {
    currentHistoryTargetId = targetId;
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
    if (!el.auditPeriod.value) {
      el.auditPeriod.value = new Date().toISOString().slice(0, 7);
    }
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

  // ---------- Database backup ----------
  function setDbStatus(message, className) {
    el.dbStatus.textContent = message || '';
    el.dbStatus.className = 'upload-status' + (className ? ' ' + className : '');
  }

  function renderDatabaseInfo(info) {
    if (!info) return;
    var counts = info.counts || {};
    el.databaseStats.hidden = false;
    el.dbSize.textContent = formatBytes(info.size_bytes);
    el.dbAudits.textContent = formatNumber(counts.audits);
    el.dbTargets.textContent = formatNumber(counts.targets);
    el.dbAccounts.textContent = formatNumber(counts.accounts);
    el.dbPosts.textContent = formatNumber(counts.account_posts);
    el.dbSnapshots.textContent = formatNumber(counts.snapshots);
    el.dbUpdated.textContent = info.updated_at
      ? 'Diperbarui ' + timeRelative(info.updated_at) + ' · skema ' + (info.schema_version || '—')
      : 'Database belum pernah diperbarui.';
  }

  function loadDatabaseInfo() {
    fetchJson('/api/database/info').then(renderDatabaseInfo).catch(function (error) {
      if (unauthorizedShown) return;
      el.databaseStats.hidden = true;
      el.dbUpdated.textContent = 'Info database tidak tersedia.';
      setDbStatus(error.message || 'Gagal memuat info database.', 'is-error');
    });
  }

  function openDatabaseModal() {
    clearDbFile();
    setDbStatus('', '');
    el.databaseStats.hidden = true;
    el.dbUpdated.textContent = 'Memuat ukuran database…';
    showModal(el.databaseModal, el.dbDownloadBtn);
    loadDatabaseInfo();
  }

  function closeDatabaseModal() {
    if (restoreInFlight) return;
    hideModal(el.databaseModal);
  }

  function clearDbFile() {
    el.dbFileInput.value = '';
    el.dbFileChip.hidden = true;
    el.dbFileName.textContent = '—';
    el.dbFileSize.textContent = '—';
    el.dbRestoreBtn.disabled = true;
  }

  function setDbFile(file) {
    if (!file) {
      clearDbFile();
      return;
    }
    if (!/\.(db|sqlite|sqlite3|backup)$/i.test(file.name)) {
      clearDbFile();
      setDbStatus('Format cadangan harus .db atau .sqlite.', 'is-error');
      return;
    }
    el.dbFileName.textContent = file.name;
    el.dbFileSize.textContent = formatBytes(file.size);
    el.dbFileChip.hidden = false;
    el.dbRestoreBtn.disabled = false;
    setDbStatus('', '');
  }

  function databaseFilename() {
    var now = new Date();
    function pad(value) {
      return String(value).length < 2 ? '0' + value : String(value);
    }
    return 'sunscraping_db_' + now.getFullYear() + pad(now.getMonth() + 1) +
      pad(now.getDate()) + '_' + pad(now.getHours()) + pad(now.getMinutes()) + '.db';
  }

  async function downloadDatabase() {
    el.dbDownloadBtn.disabled = true;
    el.dbDownloadBtn.classList.add('is-loading');
    try {
      var response = await fetch('/api/database/export', { credentials: 'same-origin' });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        var payload = await response.json().catch(function () { return {}; });
        toast('error', payload.error || 'Gagal membuat cadangan database.');
        return;
      }
      var blob = await response.blob();
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = databaseFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('success', 'Cadangan database diunduh.');
    } catch (error) {
      toast('error', 'Gagal mengunduh cadangan database.');
    } finally {
      el.dbDownloadBtn.disabled = false;
      el.dbDownloadBtn.classList.remove('is-loading');
    }
  }

  async function restoreDatabase() {
    var file = el.dbFileInput.files && el.dbFileInput.files[0];
    if (!file || restoreInFlight) return;

    var confirmed = await askConfirm({
      title: 'Pulihkan dari "' + file.name + '"?',
      body: 'Seluruh audit, target, akun, dan unggahan yang ada sekarang diganti isi file ini. ' +
        'Cadangan pengaman dibuat otomatis sebelum data diganti.',
      confirmLabel: 'Pulihkan'
    });
    if (!confirmed) return;

    restoreInFlight = true;
    el.dbRestoreBtn.disabled = true;
    el.dbRestoreBtn.classList.add('is-loading');
    el.closeDatabase.disabled = true;
    setDbStatus('Memulihkan database…', '');
    try {
      var form = new FormData();
      form.append('file', file, file.name);
      var response = await fetch('/api/database/import', {
        method: 'POST',
        credentials: 'same-origin',
        body: form
      });
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        setDbStatus(data.error || 'Pemulihan database gagal.', 'is-error');
        toast('error', data.error || 'Pemulihan database gagal.');
        return;
      }
      setDbStatus('Database dipulihkan. Memuat ulang dashboard…', 'is-success');
      toast('success', 'Database dipulihkan dari ' + file.name + '.');
      setTimeout(function () { window.location.reload(); }, 1200);
    } catch (error) {
      setDbStatus('Tidak dapat menghubungi backend. Periksa Control Panel.', 'is-error');
      toast('error', 'Pemulihan database gagal.');
    } finally {
      restoreInFlight = false;
      el.dbRestoreBtn.classList.remove('is-loading');
      el.closeDatabase.disabled = false;
      if (el.dbFileInput.files && el.dbFileInput.files[0]) el.dbRestoreBtn.disabled = false;
    }
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

  // ---------- Polling + SSE ----------
  function applyPayload(data) {
    if (!data) return;
    lastSyncAt = Date.now();
    renderLastSync();
    if (data.stats) {
      renderStats(data.stats);
      trackThroughput(data.stats);
    }
    if (Array.isArray(data.latest)) renderRows(data.latest);
    if (Array.isArray(data.audits)) renderAudits(data.audits);
    maybeLoadTargets(false);
    if (activePage === 'summary') {
      loadSummary(false);
      // Comparison is part of the overview, not a separate workspace.
      loadCompare(false);
      loadRisk(false);
    }
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
    // Header only: a template ships the shape of the file, never fake rows that
    // could be mistaken for real data or imported by accident.
    var content = '\uFEFFLink,Username,Tema\r\n';
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

  el.navSummary.addEventListener('click', function () { setPage('summary'); });
  el.navActivity.addEventListener('click', function () { setPage('activity'); });
  el.navData.addEventListener('click', function () { setDataView(dataView); });
  el.navSettings.addEventListener('click', function () { setPage('settings'); });

  [['targets', el.tabTargets], ['accounts', el.tabAccounts], ['search', el.tabSearch]]
    .forEach(function (pair, index, list) {
      var tab = pair[1];
      if (!tab) return;
      tab.addEventListener('click', function () { setDataView(pair[0]); });
      tab.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        var step = event.key === 'ArrowRight' ? 1 : -1;
        setDataView(list[(index + step + list.length) % list.length][0], true);
      });
    });

  function updateTargetFilterResetUi() {
    if (!el.targetFilterReset) return;
    var hasFilter = Boolean(el.targetSearch.value.trim() || el.targetStatus.value || el.targetPlatform.value || el.targetIssue.value);
    el.targetFilterReset.hidden = !hasFilter;
  }

  function updateAccountFilterResetUi() {
    if (!el.accountFilterReset) return;
    var hasFilter = Boolean(el.accountSearch.value.trim() || el.accountLevel.value || el.accountBand.value || el.accountPlatform.value);
    el.accountFilterReset.hidden = !hasFilter;
  }

  el.targetSearch.addEventListener('input', function () {
    var value = el.targetSearch.value.trim();
    updateTargetFilterResetUi();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      targetState.query = value;
      targetState.offset = 0;
      loadTargets(true);
    }, 300);
  });

  el.targetStatus.addEventListener('change', function () {
    targetState.status = el.targetStatus.value;
    updateTargetFilterResetUi();
    loadTargets(true);
  });

  el.targetPlatform.addEventListener('change', function () {
    targetState.platform = el.targetPlatform.value;
    updateTargetFilterResetUi();
    loadTargets(true);
  });

  el.targetIssue.addEventListener('change', function () {
    targetState.issue = el.targetIssue.value;
    updateTargetFilterResetUi();
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

  function resetTargetFilters() {
    el.targetSearch.value = '';
    el.targetStatus.value = '';
    el.targetPlatform.value = '';
    el.targetIssue.value = '';
    targetState.query = '';
    targetState.status = '';
    targetState.platform = '';
    targetState.issue = '';
    targetState.offset = 0;
    updateTargetFilterResetUi();
    loadTargets(true);
  }
  el.targetResetBtn.addEventListener('click', resetTargetFilters);
  if (el.targetFilterReset) el.targetFilterReset.addEventListener('click', resetTargetFilters);

  el.targetRetryBtn.addEventListener('click', function () {
    el.targetRetryBtn.disabled = true;
    loadTargets(true);
    setTimeout(function () { el.targetRetryBtn.disabled = false; }, 800);
  });

  el.accountSearch.addEventListener('input', function () {
    var value = el.accountSearch.value.trim();
    updateAccountFilterResetUi();
    clearTimeout(accountSearchTimer);
    accountSearchTimer = setTimeout(function () {
      accountState.query = value;
      accountState.offset = 0;
      loadAccounts(true);
    }, 300);
  });

  el.accountLevel.addEventListener('change', function () {
    accountState.level = el.accountLevel.value;
    updateAccountFilterResetUi();
    loadAccounts(true);
  });

  el.accountBand.addEventListener('change', function () {
    accountState.band = el.accountBand.value;
    updateAccountFilterResetUi();
    loadAccounts(true);
  });

  el.accountPlatform.addEventListener('change', function () {
    accountState.platform = el.accountPlatform.value;
    updateAccountFilterResetUi();
    loadAccounts(true);
  });

  function resetAccountFilters() {
    el.accountSearch.value = '';
    el.accountLevel.value = '';
    el.accountBand.value = '';
    el.accountPlatform.value = '';
    accountState.query = '';
    accountState.level = '';
    accountState.band = '';
    accountState.platform = '';
    accountState.offset = 0;
    updateAccountFilterResetUi();
    loadAccounts(true);
  }
  el.accountResetBtn.addEventListener('click', resetAccountFilters);
  if (el.accountFilterReset) el.accountFilterReset.addEventListener('click', resetAccountFilters);

  el.accountPlatform.addEventListener('change', function () {
    accountState.platform = el.accountPlatform.value;
    loadAccounts(true);
  });

  el.accountPrev.addEventListener('click', function () {
    if (accountState.offset <= 0) return;
    accountState.offset = Math.max(0, accountState.offset - accountState.limit);
    loadAccounts(false);
  });

  el.accountNext.addEventListener('click', function () {
    if (accountState.offset + accountState.limit >= accountState.total) return;
    accountState.offset += accountState.limit;
    loadAccounts(false);
  });

  if (el.accountVisitBtn) {
    el.accountVisitBtn.addEventListener('click', function () {
      if (!currentAuditId) return;
      el.accountVisitBtn.disabled = true;
      postJson('/api/accounts/visit', { audit_id: currentAuditId, only_missing: true })
        .then(function (data) {
          toast('info', data.message || 'Kunjungan profil dijadwalkan.');
          loadAccounts(true);
        })
        .catch(function () {
          toast('error', 'Gagal menjadwalkan kunjungan profil.');
        })
        .finally(function () {
          el.accountVisitBtn.disabled = false;
        });
    });
  }

  el.accountResetBtn.addEventListener('click', resetAccountFilters);

  el.accountRetryBtn.addEventListener('click', function () {
    el.accountRetryBtn.disabled = true;
    loadAccounts(true);
    setTimeout(function () { el.accountRetryBtn.disabled = false; }, 800);
  });

  el.accountHead.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-account-sort]');
    if (button) sortAccounts(button.dataset.accountSort);
  });

  function handleAccountRow(node) {
    var row = node.closest('tr[data-account-key]');
    if (row) openAccountDetail(row.dataset.accountKey);
  }

  el.accountBody.addEventListener('click', function (event) {
    handleAccountRow(event.target);
  });

  el.accountBody.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var row = event.target.closest('tr[data-account-key]');
    if (row) {
      event.preventDefault();
      openAccountDetail(row.dataset.accountKey);
    }
  });

  el.reachInfoBtn.addEventListener('click', function () {
    var open = el.reachInfo.hidden;
    el.reachInfo.hidden = !open;
    el.reachInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    el.reachInfoBtn.classList.toggle('is-active', open);
  });
  if (el.reachInfoClose) {
    el.reachInfoClose.addEventListener('click', function () {
      el.reachInfo.hidden = true;
      el.reachInfoBtn.setAttribute('aria-expanded', 'false');
      el.reachInfoBtn.classList.remove('is-active');
    });
  }

  el.accountClose.addEventListener('click', closeAccountDetail);
  el.accountModal.addEventListener('click', function (event) {
    if (event.target === el.accountModal) closeAccountDetail();
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
  if (el.erInfoClose) {
    el.erInfoClose.addEventListener('click', function () {
      el.erInfo.hidden = true;
      el.erInfoBtn.setAttribute('aria-expanded', 'false');
      el.erInfoBtn.classList.remove('is-active');
    });
  }

  el.targetHead.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-target-sort]');
    if (button) sortTargets(button.dataset.targetSort);
  });

  el.activityHead.addEventListener('click', function (event) {
    var button = event.target.closest('button[data-activity-sort]');
    if (button) sortActivity(button.dataset.activitySort);
  });

  function handleTargetRow(node) {
    // The checkbox and inline links own their clicks; opening a modal instead
    // would make selection impossible.
    if (node.closest('input, button, a, label')) return;
    var row = node.closest('tr[data-target-id]');
    if (row) openHistory(Number(row.dataset.targetId));
  }

  el.targetBody.addEventListener('click', function (event) {
    handleTargetRow(event.target);
  });

  el.targetBody.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.tagName === 'INPUT') return;
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

  el.exportStatus.addEventListener('change', updateExportHint);    el.compareMonths.addEventListener('change', function () {
      compareState.expanded = false;
      loadCompare(true);
    });

    if (el.compareMore) {
      el.compareMore.addEventListener('click', function () {
        compareState.expanded = !compareState.expanded;
        renderCompare();
      });
    }

    if (el.compareInfoBtn) {
      el.compareInfoBtn.addEventListener('click', function () {
        var open = el.compareInfo.hidden;
        el.compareInfo.hidden = !open;
        el.compareInfoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        el.compareInfoBtn.classList.toggle('is-active', open);
      });
    }

  el.dataSearch.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadSearch, 300);
  });

  window.addEventListener('offline', function () {
    showOffline('Perangkat offline. Sambungkan jaringan untuk melanjutkan audit.');
  });

  window.addEventListener('online', function () {
    hideOffline();
    restartStream();
  });

  async function retryFailed() {
    if (!currentAuditId) return;
    [el.retryFailedBtn, el.processRetryBtn].forEach(function (button) {
      if (button) button.disabled = true;
    });
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
  }

  [el.retryFailedBtn, el.processRetryBtn].forEach(function (button) {
    if (!button) return;
    button.addEventListener('click', function () { retryFailed(); });
  });

  async function runRerun(full, button) {
    if (!currentAuditId) return;
    button.disabled = true;
    try {
      var data = await postJson('/api/audits/' + currentAuditId + '/rerun', full ? { full: true } : {});
      toast(data.pending || data.empty ? 'info' : 'success', data.message || 'Audit dijadwalkan ulang.');
      pollOnce();
    } catch (error) {
      if (!unauthorizedShown) toast('error', error.message || 'Gagal menjadwalkan ulang.');
    } finally {
      updateAuditMeta();
    }
  }

  el.rerunBtn.addEventListener('click', function () { runRerun(false, el.rerunBtn); });
  el.rerunFullBtn.addEventListener('click', function () { runRerun(true, el.rerunFullBtn); });

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

  el.openDatabaseBtn.addEventListener('click', openDatabaseModal);
  el.closeDatabase.addEventListener('click', closeDatabaseModal);
  el.databaseModal.addEventListener('click', function (event) {
    if (event.target === el.databaseModal) closeDatabaseModal();
  });
  el.dbDownloadBtn.addEventListener('click', downloadDatabase);
  el.dbDropzone.addEventListener('click', function () { el.dbFileInput.click(); });
  el.dbDropzone.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    el.dbFileInput.click();
  });
  el.dbFileInput.addEventListener('change', function () {
    setDbFile(this.files && this.files[0]);
  });
  el.dbRemoveFile.addEventListener('click', clearDbFile);
  el.dbRestoreBtn.addEventListener('click', restoreDatabase);

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
        repeat_days: Math.round(repeat),
        period: el.settingsPeriod.value || null
      });
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
      restartStream();
      loadTargets(true);
      maybeLoadAccounts(true);
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
      restartStream();
      loadTargets(true);
      accountState.signature = '';
      maybeLoadAccounts(true);
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
    var modal = openModals();
    if (!modal) return;
    if (event.key === 'Escape') {
      if (modal === el.confirmModal) settleConfirm(false);
      else if (modal === el.importModal) closeImportModal();
      else if (modal === el.exportModal) closeExportModal();
      else if (modal === el.databaseModal) closeDatabaseModal();
      else if (modal === el.historyModal) closeHistory();
      else if (modal === el.accountModal) closeAccountDetail();
      return;
    }
    var tag = (event.target && event.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (modal === el.accountModal && currentAccountKey) {
        var curRow = document.querySelector('tr[data-account-key="' + CSS.escape(currentAccountKey) + '"]');
        if (curRow) {
          var nextRow = event.key === 'ArrowDown' ? curRow.nextElementSibling : curRow.previousElementSibling;
          if (nextRow && nextRow.dataset && nextRow.dataset.accountKey) {
            event.preventDefault();
            openAccountDetail(nextRow.dataset.accountKey);
          }
        }
      } else if (modal === el.historyModal && currentHistoryTargetId !== null) {
        var curRow = document.querySelector('tr[data-target-id="' + currentHistoryTargetId + '"]');
        if (curRow) {
          var nextRow = event.key === 'ArrowDown' ? curRow.nextElementSibling : curRow.previousElementSibling;
          if (nextRow && nextRow.dataset && nextRow.dataset.targetId) {
            event.preventDefault();
            openHistory(Number(nextRow.dataset.targetId));
          }
        }
      }
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    pollOnce();
    if (!stream) connectStream();
    loadTargets(false);
    maybeLoadAccounts(true);
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
    maybeLoadAccounts(false);
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
      if (el.auditPeriod.value) formData.append('period', el.auditPeriod.value);

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
        el.auditPeriod.value = '';
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
  if (el.globalSearch) {
    el.globalSearch.addEventListener('input', function () {
      var value = el.globalSearch.value.trim();
      clearTimeout(globalSearchTimer);
      if (value.length < 2) return;
      globalSearchTimer = setTimeout(function () {
        el.dataSearch.value = value;
        setDataView('search');
        loadSearch();
      }, 250);
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    var tag = (event.target && event.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target.isContentEditable) return;
    if (!el.globalSearch) return;
    event.preventDefault();
    el.globalSearch.focus();
  });

  decorateIcons();
  readUrlState();
  el.targetSearch.value = targetState.query;
  el.targetStatus.value = targetState.status;
  el.targetPlatform.value = targetState.platform;
  el.accountSearch.value = accountState.query;
  el.accountLevel.value = accountState.level;
  el.accountBand.value = accountState.band;
  el.accountPlatform.value = accountState.platform;
  updateAccountSortHeaders();
  el.auditSelect.value = currentAuditId ? String(currentAuditId) : '';
  updateTargetSortHeaders();
  updateActivitySortHeaders();
  updateAppendUi();
  renderWorker(null);
  updateAuditMeta();
  if (initialPage === 'targets' || initialPage === 'accounts' || initialPage === 'search') {
    setDataView(initialPage);
  } else {
    setPage(initialPage);
  }
  pollOnce();
  connectStream();
})();
