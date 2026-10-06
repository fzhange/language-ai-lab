import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

const html = await readFile(new URL('../entrypoints/popup/index.html', import.meta.url), 'utf8');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../entrypoints/popup/main.ts', import.meta.url))],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  loader: { '.css': 'empty' },
  logLevel: 'silent'
});

async function openPopup({ url = 'https://example.com/article', response = { ok: true, disabled: false, supported: true, highlights: [] }, confirm = () => true } = {}) {
  const { window, document } = parseHTML(html);
  const stored = {};
  let confirmation = '';
  window.confirm = (message) => { confirmation = message; return confirm(); };
  globalThis.window = window;
  globalThis.document = document;
  globalThis.chrome = {
    runtime: { lastError: undefined, getURL: (path) => `chrome-extension://test/${path}` },
    storage: { local: {
      async set(values) { Object.assign(stored, values); },
      async get(key) { return { [key]: stored[key] }; }
    } },
    tabs: {
      query(_query, callback) { callback([{ id: 17, url }]); },
      sendMessage(_id, message, callback) { callback(message.type === 'getHighlights' ? response : { ok: true }); }
    }
  };
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}#${Math.random()}`);
  await new Promise((resolve) => setImmediate(resolve));
  return { document, stored, getConfirmation: () => confirmation };
}

function disableButton(document) {
  return [...document.querySelectorAll('button')].find((button) => button.textContent.includes('在此网站禁用'));
}

test('cancelling the clearly labelled popup action does not disable the current site', async () => {
  const popup = await openPopup({ confirm: () => false });
  const button = disableButton(popup.document);
  assert.ok(button, 'The popup should offer an explicit disable-site action');
  assert.equal(button.hidden, false);
  button.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(popup.getConfirmation(), /example\.com/);
  assert.deepEqual(popup.stored, {});
});

test('confirming from the popup blocks exactly the current hostname', async () => {
  const popup = await openPopup();
  const button = disableButton(popup.document);
  assert.ok(button);
  button.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(popup.stored, { 'whw-site-blocklist:example.com': true });
  assert.equal(button.hidden, true);
});

test('unsupported and already disabled pages do not offer disable-site action', async () => {
  const unsupported = await openPopup({ url: 'chrome://extensions', response: null });
  assert.ok(disableButton(unsupported.document).hidden);
  const disabled = await openPopup({ response: { ok: true, disabled: true, supported: true, highlights: [] } });
  assert.ok(disableButton(disabled.document).hidden);
});
