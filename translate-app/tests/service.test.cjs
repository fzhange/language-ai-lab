const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateUrl, validateRequest, translate, checkConnection } = require('../electron/service.cjs')

const request = { text: 'Hello', source_language: 'en', target_language: 'zh' }

test('service URL permits local HTTP and requires HTTPS remotely', () => {
  assert.equal(validateUrl('http://127.0.0.1:2024/'), 'http://127.0.0.1:2024')
  assert.equal(validateUrl('https://example.com/agent/'), 'https://example.com/agent')
  for (const url of ['file:///etc/passwd', 'http://example.com', 'https://user:secret@example.com',
    'https://example.com?token=secret', 'https://example.com#fragment', 'bad', null]) {
    assert.throws(() => validateUrl(url))
  }
})

test('translation input is validated and extra fields are not forwarded', () => {
  assert.deepEqual(validateRequest({ ...request, user_id: 'untrusted' }), request)
  for (const override of [{ text: ' ' }, { text: 42 }, { text: 'x'.repeat(10001) },
    { source_language: 'fr' }, { target_language: 'en' }]) {
    assert.throws(() => validateRequest({ ...request, ...override }))
  }
  assert.equal(validateRequest({ ...request, text: '𠮷'.repeat(10000) }).text.length, 20000)
})

test('calls the registered translator graph with structured input and private gateway header', async () => {
  const result = await translate('http://localhost:2024/', request, {
    apiKey: 'private', fetchImpl: async (url, options) => {
      assert.equal(url, 'http://localhost:2024/runs/wait')
      assert.equal(options.method, 'POST')
      assert.equal(options.redirect, 'error')
      assert.equal(options.headers['x-api-key'], 'private')
      assert.deepEqual(JSON.parse(options.body), { assistant_id: 'translator', input: request })
      return Response.json({ ...request, translation: '你好' })
    },
  })
  assert.equal(result, '你好')
})

test('handles missing graphs, authorization errors, failed runs, and empty output', async () => {
  for (const [response, pattern] of [
    [new Response('', { status: 404 }), /graph not found/],
    [Response.json({ detail: "Invalid assistant: 'translator'." }, { status: 400 }), /graph not found/],
    [new Response('', { status: 401 }), /access denied/],
    [new Response('private backend details', { status: 500 }), /HTTP 500/],
    [Response.json({ __error__: 'private details' }), /Translation failed/],
    [Response.json({ translation: '' }), /no translation/],
    [Response.json({ messages: [{ type: 'ai', content: 'wrong graph' }] }), /no translation/],
  ]) {
    await assert.rejects(translate('http://localhost:2024', request, { fetchImpl: async () => response }), pattern)
  }
})

test('forwards the abort signal and never follows redirects with credentials', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(translate('http://localhost:2024', request, {
    signal: controller.signal,
    fetchImpl: async (_url, options) => { options.signal.throwIfAborted() },
  }), { name: 'AbortError' })
})

test('checks the native LangGraph health response', async () => {
  assert.equal(await checkConnection('http://localhost:2024', { fetchImpl: async () => Response.json({ ok: true }) }), true)
  await assert.rejects(checkConnection('http://localhost:2024', { fetchImpl: async () => Response.json({ ok: false }) }), /not a healthy/)
})
