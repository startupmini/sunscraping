'use strict';
/**
 * The extension's safety engine is plain JS: rate-limiter.js only touches
 * chrome.storage.local. A tiny file-backed implementation of that one API is
 * enough to run the exact same engine in the desktop app, so pacing, warm-up,
 * session breaks and the cycle budget cannot drift between the two clients.
 *
 * rate-limiter.js declares `const RateLimiter` at top level instead of exporting,
 * so it is evaluated in its own context and the value is read back from there.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createStorage(filePath) {
  let data = {};
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch (error) {
    // First run: start from an empty state.
  }

  let queue = Promise.resolve();
  function persist() {
    const snapshot = JSON.stringify(data);
    queue = queue
      .then(() => fs.promises.mkdir(path.dirname(filePath), { recursive: true }))
      .then(() => fs.promises.writeFile(filePath, snapshot))
      .catch(() => {});
    return queue;
  }

  return {
    async get(keys) {
      if (keys === null || keys === undefined) return { ...data };
      const wanted = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const key of wanted) {
        if (Object.prototype.hasOwnProperty.call(data, key)) result[key] = data[key];
      }
      return result;
    },
    async set(values) {
      Object.assign(data, values || {});
      await persist();
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
      await persist();
    },
  };
}

function loadRateLimiter(filePath, storage) {
  const code = fs.readFileSync(filePath, 'utf8');
  // A fresh vm context already owns its built-ins; only the two globals the
  // engine actually touches come from the host.
  const sandbox = {
    chrome: { storage: { local: storage } },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${code}\n;globalThis.__rateLimiter = RateLimiter;`,
    sandbox,
    { filename: filePath },
  );
  if (!sandbox.__rateLimiter) {
    throw new Error(`RateLimiter tidak ditemukan di ${filePath}`);
  }
  return sandbox.__rateLimiter;
}

module.exports = { createStorage, loadRateLimiter };
