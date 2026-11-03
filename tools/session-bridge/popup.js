'use strict';
/**
 * Export the cookies of the profile this extension runs in — the profile the
 * user is actually logged into — and hand them to the desktop app.
 *
 * Why this exists: since Chrome 136 the browser refuses --remote-debugging-port
 * on the default user data directory, and since Chrome 127 cookies are wrapped
 * with App-Bound Encryption, so a copied profile cannot be decrypted elsewhere.
 * An extension is the one place Chrome hands out plaintext cookies.
 *
 * Delivery: POST to the local receiver (tools/session-receiver.py) so the file
 * lands in the project folder; fall back to a normal download when it is not
 * running.
 */

const DOMAINS = ['instagram.com', 'tiktok.com'];
const RECEIVER = 'http://127.0.0.1:8765/session';
const FILE_NAME = 'sunscraping-session.json';

const button = document.getElementById('export');
const log = document.getElementById('log');

function say(lines) {
  log.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines);
}

function sameSite(value) {
  return ['no_restriction', 'lax', 'strict', 'unspecified'].includes(value) ? value : 'unspecified';
}

function normalise(cookie) {
  const entry = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: sameSite(cookie.sameSite),
  };
  if (typeof cookie.expirationDate === 'number') entry.expirationDate = cookie.expirationDate;
  return entry;
}

async function collect() {
  const cookies = [];
  const summary = [];
  for (const domain of DOMAINS) {
    const list = await chrome.cookies.getAll({ domain });
    const kept = list.filter((cookie) => {
      const host = cookie.domain.replace(/^\./, '');
      return host === domain || host.endsWith(`.${domain}`);
    });
    summary.push(`${domain}: ${kept.length} cookie`);
    cookies.push(...kept.map(normalise));
  }

  const seen = new Set();
  const unique = cookies.filter((cookie) => {
    const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { unique, summary };
}

async function toReceiver(payload) {
  const response = await fetch(RECEIVER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`receiver HTTP ${response.status}`);
  return response.json();
}

async function viaDownload(payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: FILE_NAME, saveAs: false });
}

async function run() {
  button.disabled = true;
  try {
    const { unique, summary } = await collect();
    if (!unique.length) {
      say([
        'Tidak ada cookie Instagram/TikTok di profil ini.',
        'Pastikan popup dibuka dari profil Chrome yang sudah login,',
        'bukan dari jendela profil tamu.',
      ]);
      return;
    }

    const payload = { exportedAt: new Date().toISOString(), cookies: unique };
    const important = ['sessionid', 'ds_user_id', 'sid_guard', 'uid_tt', 'csrftoken', 'mid'];
    const found = unique.filter((cookie) => important.includes(cookie.name))
      .map((cookie) => `${cookie.domain}/${cookie.name}`);

    const lines = [...summary, `total: ${unique.length} cookie`, ''];
    lines.push(found.length
      ? `kunci: ${found.join(', ')}`
      : 'PERINGATAN: sessionid tidak ditemukan — profil ini belum login.');

    try {
      const result = await toReceiver(payload);
      lines.push('', `TERKIRIM ke aplikasi: ${result.saved}`);
    } catch (error) {
      try {
        await viaDownload(payload);
        lines.push('', `Penerima lokal mati, berkas diunduh: ${FILE_NAME} (Downloads)`);
      } catch (downloadError) {
        lines.push('', `GAGAL mengirim dan mengunduh: ${error.message} / ${downloadError.message}`);
      }
    }

    say(lines);
  } catch (error) {
    say(`Gagal: ${(error && error.message) || error}`);
  } finally {
    button.disabled = false;
  }
}

button.addEventListener('click', run);
