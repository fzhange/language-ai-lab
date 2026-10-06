import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

execFileSync('npm', ['run', 'build'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'pipe'
});
const html = await readFile(new URL('../dist/chrome-mv3/options.html', import.meta.url), 'utf8');
const { document } = parseHTML(html);

test('admin only offers highlight and page views while keeping site settings', () => {
  const views = [...document.querySelectorAll('.tabs .tab')].map((tab) => tab.dataset.view);
  assert.deepEqual(views, ['all', 'pages']);
  assert.ok(document.querySelector('#items'));
  assert.ok(document.querySelector('#pages'));
  assert.ok(document.querySelector('#disabledSitesCard'));
  assert.ok(document.querySelector('#aiCard'));
  assert.ok(document.querySelector('#accountCard'));
});
