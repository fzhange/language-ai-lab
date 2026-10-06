import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SITE_BLOCKLIST_KEY,
  disableSite,
  enableSite,
  getDisabledSites,
  isSiteDisabled
} from '../lib/site-blocklist.ts';

function storageFixture() {
  const data = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(key) { return key == null ? { ...data } : { [key]: data[key] }; },
        async set(values) { Object.assign(data, values); },
        async remove(key) { delete data[key]; }
      }
    }
  };
  return data;
}

test('blocking a domain affects every path and port, but not its subdomains or unrelated sites', async () => {
  storageFixture();
  await disableSite('example.com');
  const sites = await getDisabledSites();
  assert.equal(isSiteDisabled('https://example.com/a', sites), true);
  assert.equal(isSiteDisabled('http://example.com:8080/b?x=1', sites), true);
  assert.equal(isSiteDisabled('https://sub.example.com/a', sites), false);
  assert.equal(isSiteDisabled('https://notexample.com/a', sites), false);
});

test('blocking is persistent, idempotent, and removing one domain preserves other entries', async () => {
  const data = storageFixture();
  await disableSite('example.com');
  await disableSite('example.com');
  await disableSite('another.test');
  assert.equal(data[`${SITE_BLOCKLIST_KEY}example.com`], true);
  assert.equal(data[`${SITE_BLOCKLIST_KEY}another.test`], true);
  await enableSite('example.com');
  assert.deepEqual(await getDisabledSites(), ['another.test']);
  assert.equal(isSiteDisabled('https://example.com/any', await getDisabledSites()), false);
});

test('concurrent disables of different sites cannot overwrite each other', async () => {
  storageFixture();
  await Promise.all([disableSite('a.example'), disableSite('b.example')]);
  assert.deepEqual((await getDisabledSites()).sort(), ['a.example', 'b.example']);
});

test('malformed storage and unsupported URLs cannot accidentally disable a site', async () => {
  const data = storageFixture();
  data[`${SITE_BLOCKLIST_KEY}example.com`] = { unexpected: true };
  assert.deepEqual(await getDisabledSites(), []);
  assert.equal(isSiteDisabled('chrome://extensions', ['extensions']), false);
});
