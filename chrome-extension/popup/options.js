const DEFAULT_API_BASE = 'http://localhost:5000';
const TEST_TIMEOUT_MS = 7000;

const settingsForm = document.getElementById('settingsForm');
const apiBaseInput = document.getElementById('apiBase');
const apiKeyInput = document.getElementById('apiKey');
const toggleKeyBtn = document.getElementById('toggleKey');
const eyeSlash = document.getElementById('eyeSlash');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const statusEl = document.getElementById('status');
const dirtyHint = document.getElementById('dirtyHint');

const savedValues = { base: DEFAULT_API_BASE, key: '' };
let loading = true;
let saving = false;
let testing = false;

function normalizeBase(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function currentBase() {
  return normalizeBase(apiBaseInput.value) || DEFAULT_API_BASE;
}

function currentKey() {
  return apiKeyInput.value.trim();
}

function isLoopbackBase(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '::1'
      || url.hostname === '[::1]';
  } catch (error) {
    return false;
  }
}

function isDirty() {
  return currentBase() !== savedValues.base || currentKey() !== savedValues.key;
}

function updateDirtyState() {
  const dirty = !loading && isDirty();
  if (dirtyHint) dirtyHint.hidden = !dirty;
  saveBtn.disabled = loading || saving || !dirty;
}

function setStatus(kind, message) {
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  statusEl.textContent = message || '';
  statusEl.hidden = !message;
}

function describeError(error) {
  if (error && error.name === 'AbortError') {
    return 'Koneksi timeout. Pastikan backend berjalan lalu coba lagi.';
  }
  if (error instanceof TypeError) {
    return 'Backend tidak dapat dihubungi. Pastikan server berjalan.';
  }
  return error && error.message ? error.message : 'Koneksi gagal.';
}

function validateInputs() {
  const base = currentBase();
  const key = currentKey();

  if (!isLoopbackBase(base)) {
    setStatus('error', 'API Base URL harus localhost, 127.0.0.1, atau ::1.');
    return null;
  }
  if (!key) {
    setStatus('error', 'API key tidak boleh kosong.');
    return null;
  }
  return { base: base, key: key };
}

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(['sa_api_base', 'sa_api_key']);
    savedValues.base = normalizeBase(data.sa_api_base) || DEFAULT_API_BASE;
    savedValues.key = String(data.sa_api_key || '').trim();
    apiBaseInput.value = savedValues.base;
    apiKeyInput.value = savedValues.key;
    if (!savedValues.key) {
      setStatus('', 'API key belum diatur. Tempel key dari Control Panel untuk mulai.');
    }
  } finally {
    loading = false;
    updateDirtyState();
  }
}

async function saveSettings() {
  const validated = validateInputs();
  if (!validated) return false;

  await chrome.storage.local.set({ sa_api_base: validated.base, sa_api_key: validated.key });
  savedValues.base = validated.base;
  savedValues.key = validated.key;
  apiBaseInput.value = validated.base;
  apiKeyInput.value = validated.key;
  setStatus('ok', 'Pengaturan disimpan. Worker siap dijalankan.');
  updateDirtyState();
  return true;
}

async function testConnection() {
  const validated = validateInputs();
  if (!validated) return;

  const dirty = isDirty();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  testing = true;
  testBtn.disabled = true;
  setStatus('', 'Menguji koneksi menggunakan nilai di formulir…');

  try {
    const health = await fetch(`${validated.base}/api/health`, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!health.ok) throw new Error(`Backend merespons ${health.status}`);

    const auth = await fetch(`${validated.base}/api/auth/check`, {
      cache: 'no-store',
      headers: { 'X-API-Key': validated.key },
      signal: controller.signal,
    });
    if (auth.status === 401 || auth.status === 403) {
      throw new Error('API key ditolak. Salin ulang dari Control Panel.');
    }
    if (!auth.ok) throw new Error(`Backend merespons ${auth.status}`);

    setStatus(
      'ok',
      dirty
        ? 'Koneksi dan API key valid. Klik Simpan untuk menerapkan perubahan.'
        : 'Koneksi dan API key valid. Pengaturan sudah tersimpan.'
    );
  } catch (error) {
    setStatus('error', describeError(error));
  } finally {
    clearTimeout(timer);
    testing = false;
    testBtn.disabled = false;
  }
}

function handleEdit() {
  if (statusEl.classList.contains('ok')) setStatus('', '');
  updateDirtyState();
}

toggleKeyBtn.addEventListener('click', () => {
  const reveal = apiKeyInput.type === 'password';
  apiKeyInput.type = reveal ? 'text' : 'password';
  toggleKeyBtn.setAttribute('aria-pressed', reveal ? 'true' : 'false');
  toggleKeyBtn.setAttribute('aria-label', reveal ? 'Sembunyikan API key' : 'Tampilkan API key');
  if (eyeSlash) eyeSlash.style.display = reveal ? 'none' : '';
});

apiBaseInput.addEventListener('input', handleEdit);
apiKeyInput.addEventListener('input', handleEdit);

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving || loading) return;
  if (!isDirty()) {
    updateDirtyState();
    return;
  }

  saving = true;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Menyimpan…';
  try {
    await saveSettings();
  } catch (error) {
    setStatus('error', 'Gagal menyimpan pengaturan.');
  } finally {
    saving = false;
    saveBtn.textContent = 'Simpan';
    updateDirtyState();
  }
});

testBtn.addEventListener('click', () => {
  if (!testing) testConnection();
});

loadSettings().catch(() => setStatus('error', 'Gagal memuat pengaturan.'));
