#!/usr/bin/env node
// Pull plaintext Instagram/TikTok session cookies out of a Chrome instance that
// was started with --remote-debugging-port. Chrome 136+ refuses that flag on the
// default profile, so the caller runs it against a copied user-data-dir; ABE
// (v20) cookies are readable here because Chrome itself decrypts them.
'use strict';
const fs = require('node:fs');

const OUT = process.argv[2] || 'session-cookies.json';
const PORT = process.argv[3] || '9222';

function wanted(domain) {
  return domain === 'instagram.com' || domain.endsWith('.instagram.com')
      || domain === 'tiktok.com' || domain.endsWith('.tiktok.com');
}

function openSocket(url) {
  const ws = new WebSocket(url);
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error('gagal koneksi WebSocket')), { once: true });
  });
}

function call(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      resolve(message);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => reject(new Error(`timeout ${method}`)), 20000);
  });
}

async function collect() {
  const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  console.log('browser:', version.Browser);

  const ws = await openSocket(version.webSocketDebuggerUrl);

  let response = await call(ws, 1, 'Storage.getCookies', {});
  let cookies = (response.result && response.result.cookies) || [];
  console.log(`Storage.getCookies: ${cookies.length}${response.error ? ' ERROR ' + JSON.stringify(response.error) : ''}`);

  if (!cookies.length) {
    response = await call(ws, 2, 'Network.getAllCookies', {});
    cookies = (response.result && response.result.cookies) || [];
    console.log(`Network.getAllCookies (browser): ${cookies.length}${response.error ? ' ERROR ' + JSON.stringify(response.error) : ''}`);
  }

  if (!cookies.length) {
    const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const page = targets.find((target) => target.type === 'page');
    if (page) {
      console.log('mencoba lewat target halaman:', page.url.slice(0, 60));
      const pageWs = await openSocket(page.webSocketDebuggerUrl);
      response = await call(pageWs, 3, 'Network.getAllCookies', {});
      cookies = (response.result && response.result.cookies) || [];
      console.log(`Network.getAllCookies (page): ${cookies.length}${response.error ? ' ERROR ' + JSON.stringify(response.error) : ''}`);
      pageWs.close();
    }
  }

  ws.close();
  return cookies;
}

(async () => {
  const cookies = await collect();
  const keep = cookies.filter((cookie) => wanted(cookie.domain));
  fs.writeFileSync(OUT, JSON.stringify(keep, null, 2));

  const byDomain = {};
  for (const cookie of keep) (byDomain[cookie.domain] = byDomain[cookie.domain] || []).push(cookie.name);
  console.log(`total: ${cookies.length} | IG/TikTok: ${keep.length} | ditulis: ${OUT}`);
  for (const [domain, names] of Object.entries(byDomain)) console.log(`  ${domain}: ${names.length}`);

  const KEY = ['sessionid', 'sessionid_csrf', 'sid', 'sid_guard', 'uid_tt', 'csrftoken', 'mid', 'ds_user_id'];
  const found = keep.filter((cookie) => KEY.includes(cookie.name)).map((cookie) => `${cookie.domain}/${cookie.name}`);
  console.log(`cookie kunci: ${found.length ? found.join(', ') : '(TIDAK ADA)'}`);
})().catch((error) => {
  console.error('GAGAL:', error.message);
  process.exit(1);
});
