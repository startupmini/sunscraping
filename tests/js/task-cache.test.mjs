// Unit guard for chrome-extension/utils/task-cache.js: when may the worker
// answer a post task from the numbers a profile visit already produced?
// Run: node --test tests/js   (or: bun test tests/js)
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = readFileSync(
  new URL('../../chrome-extension/utils/task-cache.js', import.meta.url), 'utf8');

function load() {
  const context = vm.createContext({ console, Math, Date, Number, Object, Array });
  vm.runInContext(SOURCE, context);
  return vm.runInContext('TaskCache', context);
}

const NOW = Date.parse('2026-11-02T10:00:00Z');
const VIDEO_URL = 'https://www.tiktok.com/@salsaabl.f_/video/1234567890';
const minutesAgo = (minutes) => new Date(NOW - minutes * 60000).toISOString();

const task = (cachedPost) => ({
  id: 7,
  url: 'https://www.tiktok.com/@salsaabl.f_/video/1234567890',
  platform: 'tiktok',
  username: 'salsaabl.f_',
  tema: 'kopi',
  cachedPost,
});

test('a fresh full row answers the task without a navigation', () => {
  const cache = load();
  const result = cache.resultFromTask(task({
    platform: 'tiktok', username: 'salsaabl.f_',
    url: 'https://www.tiktok.com/@salsaabl.f_/video/1234567890',
    likes: 18200, comments: 234, views: 90000, shares: 120,
    followerCount: 7400, postDate: '2024-10-27T03:33:20Z', caption: 'iklan kopi',
    fetchedAt: minutesAgo(20),
  }), NOW);

  assert.ok(result, 'expected the cache to answer');
  assert.equal(result.status, 'OK');
  assert.equal(result.likes, 18200);
  assert.equal(result.views, 90000);
  assert.equal(result.followerCount, 7400);
  assert.equal(result.caption, 'iklan kopi');
  assert.equal(result.tema, undefined, 'tema is filled by the caller from the task');
  assert.equal(result.source, 'profile-visit');
});

test('nothing is invented for a metric the profile visit did not carry', () => {
  const cache = load();
  const result = cache.resultFromTask(task({
    platform: 'tiktok', username: 'salsaabl.f_',
    url: 'https://www.tiktok.com/@salsaabl.f_/video/1234567890',
    likes: 18200, comments: 234, views: null, shares: null,
    fetchedAt: minutesAgo(5),
  }), NOW);

  assert.equal(result.views, null);
  assert.equal(result.shares, null);
  // A photo/grid row has no view counter at all; that is not a partial result.
  assert.equal(result.status, 'OK');
});

test('a row without a single number is not evidence', () => {
  const cache = load();
  const result = cache.resultFromTask(task({
    platform: 'tiktok', username: 'salsaabl.f_',
    url: 'https://www.tiktok.com/@salsaabl.f_/video/1234567890',
    likes: null, comments: null, views: null, shares: null,
    fetchedAt: minutesAgo(5),
  }), NOW);
  assert.equal(result, null, 'an empty cached row would hide a real scrape');
});

test('a stale row is refused even though the backend offered it', () => {
  const cache = load();
  const stale = task({
    likes: 100, comments: 2, views: 3000, shares: 1,
    fetchedAt: minutesAgo(cache.MAX_AGE_MS / 60000 + 60),
  });
  assert.equal(cache.resultFromTask(stale, NOW), null);

  const future = task({
    likes: 100, comments: 2, views: 3000, shares: 1,
    fetchedAt: minutesAgo(-30),
  });
  assert.equal(cache.resultFromTask(future, NOW), null, 'a clock-ahead row must not be trusted');
});

test('a row without a usable timestamp is refused', () => {
  const cache = load();
  assert.equal(cache.resultFromTask(task({ likes: 10, fetchedAt: null }), NOW), null);
  assert.equal(cache.resultFromTask(task({ likes: 10, fetchedAt: 'besok sore' }), NOW), null);
});

test('the account is visited once per cycle, and not when the backend is fresh', () => {
  const cache = load();
  const plain = { platform: 'TikTok', username: 'Salsaabl.F_', cachedFollowerCount: null };

  assert.equal(cache.shouldHarvestAccount(plain, []), true);
  assert.equal(cache.shouldHarvestAccount(plain, ['tiktok:salsaabl.f_']), false,
    'the key is lower-cased the same way in both directions');
  assert.equal(cache.shouldHarvestAccount(plain, new Set(['tiktok:salsaabl.f_'])), false);
  assert.equal(cache.shouldHarvestAccount({ ...plain, cachedFollowerCount: 7400 }, []), false,
    'a follower count inside the cache window means the account was visited recently');
  assert.equal(cache.shouldHarvestAccount({ ...plain, username: '' }, []), false);
  assert.equal(cache.shouldHarvestAccount(null, []), false);
});

test('no cached row means the post is visited normally', () => {
  const cache = load();
  assert.equal(cache.resultFromTask(task(undefined), NOW), null);
  assert.equal(cache.resultFromTask(task(null), NOW), null);
  assert.equal(cache.resultFromTask({}, NOW), null);
});

test('post refs are read the way the backend stores them', () => {
  const cache = load();
  assert.equal(cache.refFromUrl('https://www.tiktok.com/@a/video/1234567890'), '1234567890');
  assert.equal(cache.refFromUrl('https://www.tiktok.com/@a/photo/42'), '42');
  assert.equal(cache.refFromUrl('https://www.instagram.com/reel/CODEabc/'), 'codeabc');
  assert.equal(cache.refFromUrl('https://www.instagram.com/p/CODEabc/?utm=1'), 'codeabc');
  assert.equal(cache.refFromUrl('https://www.instagram.com/alice/'), null);
});

test('a post that came with the account visit needs no navigation', () => {
  const cache = load();
  const result = cache.fromHarvest({
    platform: 'tiktok',
    username: 'salsaabl.f_',
    followerCount: 7400,
    posts: [
      { id: '111', likes: 1, comments: 1, views: 10, shares: 0, postedAt: '2026-11-01T01:00:00Z' },
      {
        id: '1234567890', url: VIDEO_URL, likes: 18200, comments: 234, views: 90000, shares: 12,
        caption: 'iklan kopi', postedAt: '2026-10-27T03:33:20Z',
      },
    ],
  }, task(null));

  assert.ok(result, 'the account visit carried this post');
  assert.equal(result.likes, 18200);
  assert.equal(result.followerCount, 7400);
  assert.equal(result.postDate, '2026-10-27T03:33:20Z');
  assert.equal(result.status, 'OK');
});

test('the harvest only answers for the post it actually covered', () => {
  const cache = load();
  const other = { ...task(null), url: 'https://www.tiktok.com/@salsaabl.f_/video/5555' };
  const profile = {
    platform: 'tiktok', username: 'salsaabl.f_', followerCount: 7400,
    posts: [{ id: '1234567890', url: VIDEO_URL, likes: 18200 }],
  };
  assert.equal(cache.fromHarvest(profile, other), null);
  assert.equal(cache.fromHarvest(null, task(null)), null);
  assert.equal(cache.fromHarvest({ posts: [] }, task(null)), null);
});

test('a harvested row without numbers still costs a visit', () => {
  const cache = load();
  const profile = {
    platform: 'tiktok', username: 'salsaabl.f_', followerCount: 7400,
    posts: [{ id: '1234567890', url: VIDEO_URL, likes: null, comments: null, views: null }],
  };
  assert.equal(cache.fromHarvest(profile, task(null)), null,
    'grid ids without counters are not evidence');
});
