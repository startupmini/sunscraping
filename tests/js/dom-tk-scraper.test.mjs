// Runs tests/js/fixtures/tk-dom.html in headless Chrome so the TikTok content
// script is exercised against a real DOM. Run: node --test tests/js  (or bun test)
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import test from 'node:test';

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

const browser = BROWSERS.find((path) => existsSync(path));
const fixture = new URL('fixtures/tk-dom.html', import.meta.url);

test('TikTok DOM fixtures assign metrics by label', { skip: browser ? false : 'no Chrome/Edge found' }, () => {
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
    throw new Error(`TikTok DOM fixtures failed:\n${details ? details[0] : output.slice(0, 800)}`);
  }
});
