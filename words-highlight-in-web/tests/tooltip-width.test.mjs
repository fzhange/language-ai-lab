import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const chrome = process.env.CHROME_BIN || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].find(existsSync);
const css = readFileSync(new URL('../lib/content.css', import.meta.url), 'utf8');

function tooltipSizes(viewportWidth) {
  const html = `<!doctype html><style>${css}</style>
    <div class="whw-tooltip whw-ui"><div class="whw-tip-sec"><div class="whw-tip-body">A long note with enough text to wrap inside the tooltip.</div></div></div>
    <div class="whw-tooltip whw-ui"><div class="whw-tip-sec"><div class="whw-tip-body">Note</div></div><div class="whw-tip-sec"><div class="whw-tip-body">Insight</div></div></div>
    <output id="sizes"></output>
    <script>
      const tips = [...document.querySelectorAll('.whw-tooltip')];
      document.querySelector('#sizes').textContent = JSON.stringify({
        viewport: innerWidth,
        widths: tips.map((tip) => tip.getBoundingClientRect().width),
        contentWidths: tips.map((tip) => [...tip.children].map((sec) => sec.getBoundingClientRect().width))
      });
    </script>`;
  const output = execFileSync(chrome, [
    '--headless', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--window-size=${viewportWidth},800`, '--dump-dom',
    `data:text/html;base64,${Buffer.from(html).toString('base64')}`
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const match = output.match(/<output id="sizes">([^<]+)<\/output>/);
  assert.ok(match, 'Chrome should report the rendered tooltip dimensions');
  return JSON.parse(match[1]);
}

test('a single tooltip fills its 500px container with readable text', { skip: !chrome }, () => {
  const { widths, contentWidths } = tooltipSizes(1080);
  assert.ok(widths[0] >= 490 && widths[0] <= 510, `expected about 500px, got ${widths[0]}px`);
  assert.ok(contentWidths[0][0] >= 450, `single-section text should use the container width, got ${contentWidths[0][0]}px`);
});

test('two tooltip sections remain side by side at desktop width', { skip: !chrome }, () => {
  const { widths, contentWidths } = tooltipSizes(1080);
  assert.ok(widths[1] >= 680 && widths[1] <= 720, `expected about 720px, got ${widths[1]}px`);
  assert.ok(contentWidths[1].every((width) => width >= 300), 'both sections should have readable widths');
});

test('tooltip stays readable within a narrow viewport', { skip: !chrome }, () => {
  const { viewport, widths, contentWidths } = tooltipSizes(500);
  assert.ok(widths.every((width) => width <= viewport - 16), `tooltip exceeds ${viewport}px viewport: ${widths}`);
  assert.ok(contentWidths[0][0] >= viewport - 64, 'single-section text should fill the available narrow-screen width');
  assert.ok(contentWidths[1].every((width) => width >= 300), 'both sections should stay readable on narrow screens');
});
