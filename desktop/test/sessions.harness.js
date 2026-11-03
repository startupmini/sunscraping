'use strict';
/**
 * Electron harness for worker/sessions.js.
 *
 * It exercises the real module — real BrowserWindow, real isolated world, real
 * chrome.runtime shim, real content scripts — while every social URL is routed
 * to a local fixture. That is the part the Chrome dump-dom tests cannot cover:
 * navigation, injection and the message round-trip.
 *
 * Run through the test runner (desktop/test/sessions.test.js) or by hand:
 *   npx electron test/sessions.harness.js
 */

const fs = require('node:fs');

let electron = null;
try {
  electron = require('electron');
} catch (error) {
  electron = null;
}

// The Node test runner may pick this file up with plain Node, where `electron`
// resolves to a binary path instead of the API. Exiting 0 keeps that harmless.
if (!electron || typeof electron !== 'object' || !electron.app) {
  console.log('sessions harness: butuh Electron (jalankan lewat npm test).');
  process.exit(0);
}

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app } = electron;

const { createSessions } = require('../worker/sessions.js');
const { allowedTarget } = require('../worker/core.js');

const FIXTURES = path.join(__dirname, 'fixtures');

function fixture(name) {
  return pathToFileURL(path.join(FIXTURES, name)).href;
}

// Logical URL → page served. Keyed by what the worker would navigate to, so the
// task data in each case stays a realistic social URL.
const ROUTES = {
  'https://www.tiktok.com/@demo/video/1000000001': fixture('tk-post.html'),
  'https://www.tiktok.com/@demo.akun/video/1000000002': fixture('tk-profile-as-post.html'),
  'https://www.instagram.com/demo.akun/': fixture('ig-profile.html'),
};

function emit(line) {
  // fs.writeSync, not console.log: app.exit() ends the process before a pipe
  // flush on Windows and the verdict would vanish.
  fs.writeSync(1, `${line}\n`);
}

function expect(label, actual, wanted, failures) {
  if (actual !== wanted) {
    failures.push(`${label} = ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`);
  }
}

function tiktokTask(id, url, username) {
  return {
    id,
    url,
    platform: 'tiktok',
    username,
    tema: 'fixture',
  };
}

const CASES = [
  {
    name: 'tiktok post: labelled counters become metrics',
    run: (sessions) => sessions.scrapePost(
      tiktokTask(1, 'https://www.tiktok.com/@demo/video/1000000001', 'demo'),
    ),
    check: (result, failures) => {
      expect('status', result.status, 'OK', failures);
      expect('platform', result.platform, 'tiktok', failures);
      expect('likes', result.likes, 18200, failures);
      expect('comments', result.comments, 234, failures);
      expect('shares', result.shares, 12, failures);
      expect('views', result.views, 90000, failures);
      expect('caption', result.caption, 'iklan kopi #ad', failures);
    },
  },
  {
    name: 'instagram profile: one visit returns the account and its posts',
    run: (sessions) => sessions.scrapeProfile('demo.akun', 'instagram'),
    check: (result, failures) => {
      expect('status', result.status, 'OK', failures);
      expect('username', result.username, 'demo.akun', failures);
      expect('followerCount', result.followerCount, 7400, failures);
      expect('followingCount', result.followingCount, 12, failures);
      expect('postCount', result.postCount, 214, failures);
      expect('postSource', result.postSource, 'page-json', failures);
      expect('posts.length', (result.posts || []).length, 2, failures);

      const first = (result.posts || [])[0] || {};
      expect('posts[0].id', first.id, 'CODE0', failures);
      expect('posts[0].likes', first.likes, 200, failures);
      expect('posts[0].comments', first.comments, 7, failures);
      expect('posts[0].views', first.views, 5000, failures);
      expect('posts[0].url', first.url, 'https://www.instagram.com/reel/CODE0/', failures);
      expect('posts[0].postedAt', first.postedAt, '2024-10-27T03:33:20Z', failures);
    },
  },
  {
    name: 'tiktok profile payload is never reported as a finished post',
    run: (sessions) => sessions.scrapePost(
      tiktokTask(2, 'https://www.tiktok.com/@demo.akun/video/1000000002', 'demo.akun'),
    ),
    check: (result, failures) => {
      expect('status', result.status, 'FAILED', failures);
      expect('errorCode', result.errorCode, 'TRANSIENT', failures);
      expect('likes', result.likes, null, failures);
      expect('views', result.views, null, failures);
    },
  },
  {
    name: 'a host outside the allowlist is refused before any navigation',
    run: (sessions) => sessions.scrapePost(
      tiktokTask(3, 'https://notinstagram.com/@demo/video/1000000003', 'demo'),
    ),
    expectThrow: /tidak diizinkan/i,
  },
];

async function run() {
  const failures = [];
  const sessions = createSessions({
    onLog: (message) => emit(`[log] ${message}`),
    resolvePage: (url) => ROUTES[url] || url,
    // Fixtures live on disk; everything else still goes through the real guard.
    isAllowedPage: (url) => url.startsWith('file://') || allowedTarget(url),
    partition: 'sa-harness',
  });

  try {
    for (const testCase of CASES) {
      try {
        const result = await testCase.run(sessions);
        if (testCase.expectThrow) {
          failures.push(`${testCase.name} :: seharusnya ditolak (${testCase.expectThrow})`);
          continue;
        }
        testCase.check(result || {}, failures);
      } catch (error) {
        const message = String((error && error.message) || error);
        if (testCase.expectThrow && testCase.expectThrow.test(message)) continue;
        failures.push(`${testCase.name} :: ${message}`);
      }
    }
  } finally {
    sessions.dispose();
  }

  if (failures.length) {
    emit(`HARNESS FAILURES ${failures.length}`);
    failures.forEach((line) => emit(`- ${line}`));
    app.exit(1);
    return;
  }

  emit(`ALL SESSIONS FIXTURES PASS (${CASES.length})`);
  app.exit(0);
}

app.whenReady()
  .then(run)
  .catch((error) => {
    emit('HARNESS FAILURES 1');
    emit(`- harness: ${(error && error.message) || error}`);
    app.exit(1);
  });
