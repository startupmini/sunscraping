'use strict';
/**
 * Import cookies exported by tools/session-bridge into the desktop app's
 * persistent partition, so the worker is already logged in.
 *
 *   npx electron tools/import-session-cookies.js "C:/Users/Vv/Downloads/sunscraping-session.json"
 *
 * The desktop app must be closed while this runs: two processes writing the same
 * cookie jar is a good way to lose the very session we are importing.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, session } = require('electron');

const PARTITION = 'persist:sunscraping';
const file = process.argv[2];

function fail(message) {
  console.error(`GAGAL: ${message}`);
  app.exit(1);
}

function cookieUrl(cookie) {
  const host = String(cookie.domain || '').replace(/^\./, '');
  const scheme = cookie.secure ? 'https' : 'http';
  return `${scheme}://${host}${cookie.path || '/'}`;
}

app.whenReady().then(async () => {
  if (!file) return fail('berikan path JSON hasil ekspor sebagai argumen');
  if (!fs.existsSync(file)) return fail(`berkas tidak ada: ${file}`);

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`JSON tidak terbaca: ${error.message}`);
  }

  const cookies = Array.isArray(payload.cookies) ? payload.cookies : [];
  if (!cookies.length) return fail('tidak ada cookie di dalam berkas');

  const jar = session.fromPartition(PARTITION);
  let saved = 0;
  const rejected = [];

  for (const cookie of cookies) {
    if (!cookie || !cookie.name) continue;
    const details = {
      url: cookieUrl(cookie),
      name: cookie.name,
      value: String(cookie.value ?? ''),
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: Boolean(cookie.secure),
      httpOnly: Boolean(cookie.httpOnly),
      sameSite: cookie.sameSite || 'unspecified',
    };
    if (typeof cookie.expirationDate === 'number') details.expirationDate = cookie.expirationDate;
    try {
      await jar.cookies.set(details);
      saved += 1;
    } catch (error) {
      rejected.push(`${cookie.domain}/${cookie.name}: ${error.message}`);
    }
  }

  console.log(`cookie tersimpan: ${saved}/${cookies.length}`);
  if (rejected.length) {
    console.log(`ditolak: ${rejected.length}`);
    rejected.slice(0, 5).forEach((line) => console.log(`  - ${line}`));
  }

  for (const [domain, label] of [['instagram.com', 'Instagram'], ['tiktok.com', 'TikTok']]) {
    const stored = await jar.cookies.get({ domain: `.${domain}` });
    const names = new Set(stored.map((cookie) => cookie.name));
    const loggedIn = names.has('sessionid') || names.has('sid_guard');
    console.log(`${label}: ${stored.length} cookie | sesi: ${loggedIn ? 'ADA' : 'TIDAK ADA'}`);
  }

  console.log(`partisi: ${PARTITION}`);
  console.log(`lokasi: ${path.join(app.getPath('userData'), 'Partitions', 'sunscraping')}`);
  app.exit(saved > 0 ? 0 : 1);
});
