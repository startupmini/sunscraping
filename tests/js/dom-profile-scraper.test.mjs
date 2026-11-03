// Runs tests/js/fixtures/profile-dom.html in headless Chrome so both profile
// harvesters are exercised against a real DOM: one visit must yield the account
// fingerprint plus the last RECENT_POST_LIMIT posts.
// Run: node --test tests/js  (or bun test)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const browser = BROWSERS.find((path) => existsSync(path));
const fixture = new URL('fixtures/profile-dom.html', import.meta.url);

test('one profile visit returns the account plus its recent posts', { skip: browser ? false : 'no Chrome/Edge found' }, () => {
  const run = spawnSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--allow-file-access-from-files',
    '--virtual-time-budget=240000',
    '--dump-dom',
    fixture.href,
  ], { encoding: 'utf8', timeout: 180000 });

  const output = `${run.stdout || ''}\n${run.stderr || ''}`;
  if (run.status !== 0 && !/ALL FIXTURES PASS|FIXTURE FAILURES/.test(output)) {
    throw new Error(`headless browser exited ${run.status}: ${output.slice(0, 800)}`);
  }
  if (!/ALL FIXTURES PASS/.test(output)) {
    const details = output.match(/FIXTURE FAILURES[\s\S]*?(?=<\/pre>|$)/);
    throw new Error(`profile DOM fixtures failed:\n${details ? details[0] : output.slice(0, 800)}`);
  }
});
