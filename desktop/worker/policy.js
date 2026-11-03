'use strict';
/**
 * The parts of the worker that decide how much traffic the app sends, kept free
 * of Electron and chrome.* so they can be unit tested with plain Node.
 *
 * chrome-extension/background.js still carries its own copy of these rules. That
 * copy cannot be shared from here (the MV3 service worker is not a CommonJS
 * module), so test/worker.test.js parses background.js and fails when the two
 * drift apart. That is a detector, not a fix: the real fix is one module for
 * both clients.
 */

const BLOCK_PAUSE_MS = Object.freeze({
  THROTTLED: 10 * 60 * 1000,
  AUTH: 20 * 60 * 1000,
});

const MAX_BLOCKED_IN_A_ROW = 3;
const IDLE_POLL_MS = 5000;
const ERROR_BACKOFF_MS = 15000;
const CACHE_HIT_DELAY_MS = 400;

// Exact hosts, mapped to the scraper that owns them. A suffix test would accept
// notinstagram.com; only these names ever load a page.
const HOST_PLATFORM = Object.freeze({
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'm.instagram.com': 'instagram',
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'm.tiktok.com': 'tiktok',
  'vm.tiktok.com': 'tiktok',
  'vt.tiktok.com': 'tiktok',
});

const ALLOWED_HOSTS = new Set(Object.keys(HOST_PLATFORM));

function allowedTarget(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (url.username || url.password) return false;
    return ALLOWED_HOSTS.has(url.hostname.toLowerCase());
  } catch (error) {
    return false;
  }
}

/** Platform for a URL, or null. Never guesses from a partial host match. */
function platformForHost(rawUrl) {
  if (!allowedTarget(rawUrl)) return null;
  try {
    return HOST_PLATFORM[new URL(rawUrl).hostname.toLowerCase()] || null;
  } catch (error) {
    return null;
  }
}

function classifyError(error) {
  const message = error && error.message ? error.message : String(error || '');
  if (/login|auth|session|unauthorized/i.test(message)) return 'AUTH';
  if (/too many requests|rate ?limit|throttl|429|try again later|coba lagi nanti|temporarily blocked/i.test(message)) return 'THROTTLED';
  if (/private|not available|tidak tersedia|deleted/i.test(message)) return 'PERMANENT';
  if (/timeout|network|fetch|tidak dapat/i.test(message)) return 'TRANSIENT';
  return 'TRANSIENT';
}

function cacheKey(platform, username) {
  return `${platform || 'unknown'}:${String(username || '').toLowerCase()}`;
}

/**
 * What one scrape result means for the worker: whether it was a visit at all,
 * whether the platform blocked us, and whether that is the third block in a row.
 * A cache hit loaded no page, so it is never charged and never counted.
 */
function outcomeOf(result, blockedInARow = 0) {
  const status = String((result && result.status) || '').toUpperCase();
  const errorCode = String((result && result.errorCode) || '').toUpperCase();
  const fromCache = Boolean(result && result.source === 'profile-visit');

  const charge = fromCache ? 'none' : (status === 'FAILED' ? 'error' : 'success');
  const blocked = charge === 'error' && (errorCode === 'THROTTLED' || errorCode === 'AUTH');
  const nextBlocked = blocked ? blockedInARow + 1 : 0;

  return {
    status,
    errorCode,
    fromCache,
    charge,
    blocked,
    blockedInARow: nextBlocked,
    pauseMs: blocked ? (BLOCK_PAUSE_MS[errorCode] || BLOCK_PAUSE_MS.THROTTLED) : 0,
    stop: blocked && nextBlocked >= MAX_BLOCKED_IN_A_ROW,
  };
}

module.exports = {
  ALLOWED_HOSTS,
  BLOCK_PAUSE_MS,
  CACHE_HIT_DELAY_MS,
  ERROR_BACKOFF_MS,
  HOST_PLATFORM,
  IDLE_POLL_MS,
  MAX_BLOCKED_IN_A_ROW,
  allowedTarget,
  cacheKey,
  classifyError,
  outcomeOf,
  platformForHost,
};
