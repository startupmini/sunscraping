// Regression guard for SA_CONTENT.parseCount — the counter grammar both content
// scripts must agree on. Run: node --test tests/js
//
// common.js is a classic content script, so it is evaluated in a vm sandbox the
// way Chrome would run it, not imported as a module.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../../chrome-extension/content/common.js', import.meta.url), 'utf8');
const sandbox = vm.createContext({ console });
vm.runInContext(source, sandbox);
const { parseCount, metricFromLabel } = vm.runInContext('SA_CONTENT', sandbox);

const CASES = [
  ['1,5', 2],            // was 1.5 on TikTok, 15 on Instagram
  ['1.5', 2],
  ['1,234', 1234],       // en-US thousands separator
  ['1.234', 1234],       // id-ID thousands separator
  ['100,000', 100000],
  ['1.234.567', 1234567],
  ['1,234,567', 1234567],
  ['12345', 12345],
  ['12,5rb', 12500],
  ['12.5K', 12500],
  ['1,2M', 1200000],
  ['1.2M', 1200000],
  ['1,5 jt', 1500000],
  ['1.234K', 1234],      // abbreviated counters never group
  ['18 likes', 18],
  ['1,234 likes', 1234],
  ['18.2K shares', 18200],
  ['1,234 comments', 1234],
  ['3,4 juta', 3400000],
  ['1,2 miliar', 1200000000],
  [1234, 1234],
  [1234.6, 1235],
  ['  1,2 Mn  ', 1200000],
  ['', null],
  ['   ', null],
  ['tidak tersedia', null],
  [null, null],
  [undefined, null],
  [NaN, null],
];

test('parseCount agrees across platforms for every counter shape', () => {
  for (const [input, expected] of CASES) {
    const actual = parseCount(input);
    if (actual !== expected) {
      throw new Error(`parseCount(${JSON.stringify(input)}) = ${actual}, expected ${expected}`);
    }
  }
});

// A counter is only reported when a label says which metric it belongs to.
// Anything the label table maps to null stays null in the result instead of
// being guessed from DOM position.
const LABELS = [
  ['like-count', 'likes'],
  ['browse-like-count', 'likes'],
  ['comment-count', 'comments'],
  ['browse-comment-count', 'comments'],
  ['share-count', 'shares'],
  ['undefined-count', null],
  ['like-icon', 'likes'],
  ['comment-icon', 'comments'],
  ['share-icon', 'shares'],
  ['DivActionLikeContainer', 'likes'],
  ['DivActionFavoriteContainer', null],
  ['Add to Favorites', null],
  ['Duet', null],
  ['Copy link', null],
  ['Suka', 'likes'],
  ['Komentar', 'comments'],
  ['Bagikan', 'shares'],
  ['Following', null],
  ['video-views', null],
  ['', null],
  [null, null],
  [undefined, null],
];

test('metricFromLabel names a metric only when the label says so', () => {
  for (const [label, expected] of LABELS) {
    const actual = metricFromLabel(label);
    if (actual !== expected) {
      throw new Error(`metricFromLabel(${JSON.stringify(label)}) = ${actual}, expected ${expected}`);
    }
  }
});
