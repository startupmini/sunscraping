'use strict';
/**
 * Runs test/sessions.harness.js in Electron so worker/sessions.js is exercised
 * for real. Follows the same pattern as tests/js/dom-*.test.mjs: spawn a browser
 * binary, read its verdict, skip when the binary is not available.
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const HARNESS = path.join(__dirname, 'sessions.harness.js');

function electronBinary() {
  try {
    const resolved = require('electron');
    // Installed as a dependency, the module resolves to the executable path.
    return typeof resolved === 'string' ? resolved : null;
  } catch (error) {
    return null;
  }
}

const binary = electronBinary();
const headlessBlocked = process.platform === 'linux' && !process.env.DISPLAY;
const skip = !binary
  ? 'electron belum dipasang (cd desktop && npm install)'
  : headlessBlocked
    ? 'tidak ada DISPLAY untuk Electron di Linux (jalankan lewat xvfb)'
    : false;

test('sessions.js drives the DOM fixtures inside a real Electron window', { skip }, () => {
  const args = [HARNESS];
  if (process.platform === 'linux') args.push('--no-sandbox');
  args.push('--disable-gpu');

  const run = spawnSync(binary, args, { encoding: 'utf8', timeout: 240000 });
  const output = `${run.stdout || ''}\n${run.stderr || ''}`;

  if (run.status !== 0 && !/ALL SESSIONS FIXTURES PASS|HARNESS FAILURES/.test(output)) {
    throw new Error(`electron harness exited ${run.status}: ${output.slice(0, 1500)}`);
  }
  if (!/ALL SESSIONS FIXTURES PASS/.test(output)) {
    const details = output.match(/HARNESS FAILURES[\s\S]*$/);
    throw new Error(
      `sessions fixtures failed:\n${details ? details[0].slice(0, 2000) : output.slice(0, 1500)}`,
    );
  }
});
