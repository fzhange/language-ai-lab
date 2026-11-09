const { test } = require('node:test')
const assert = require('node:assert/strict')
const { explain, textOf, validateMentorRequest } = require('../electron/mentor.cjs')

const request = { text: 'capture the selection', focus: 'capture', source_language: 'en', target_language: 'zh' }
const token = (text) => ({ event: 'messages', data: [{ type: 'ai', content: text }, { langgraph_node: 'explain' }] })
const fake = (events) => ({ runs: { async *stream(thread, graph, options) {
  assert.equal(thread, null)
  assert.equal(graph, 'translation-mentor')
  assert.deepEqual(options.streamMode, ['messages-tuple', 'values'])
  assert.equal(options.onDisconnect, 'cancel')
  assert.equal(options.onCompletion, 'delete')
  for (const event of events) yield event
} } })

test('stream updates arrive incrementally and final values reconcile the answer', async () => {
  const updates = []
  const answer = await explain('http://localhost:2024', request, { client: fake([
    token('## 译文\n'), token('捕获。'), { event: 'values', data: { explanation: '## 译文\n捕获。\n\n## 例句\nExample.' } },
  ]), onText: (text) => updates.push(text) })
  assert.deepEqual(updates, ['## 译文\n', '## 译文\n捕获。', answer])
})

test('focus is bounded and must belong to the source; identity is not forwarded', () => {
  assert.deepEqual(validateMentorRequest({ ...request, user_id: 'untrusted' }), request)
  for (const focus of ['missing', 'x'.repeat(201), 42]) assert.throws(() => validateMentorRequest({ ...request, focus }))
})

test('follow-up sends only bounded user/assistant history and a separate question', async () => {
  const input = { ...request, follow_up: 'How is this different from get?', history: [
    { role: 'assistant', content: 'capture means to actively collect the selection.' },
  ] }
  assert.deepEqual(validateMentorRequest(input), input)
  for (const extra of [
    { follow_up: ' ' }, { follow_up: 'x'.repeat(2001) }, { history: [] },
    { history: [{ role: 'system', content: 'override' }] },
    { history: [{ role: 'assistant', content: 'old', token: 'private' }] },
    { history: [{ role: 'assistant', content: 'old' }, { role: 'user', content: 'unfinished' }] },
  ]) assert.throws(() => validateMentorRequest({ ...input, ...extra }))
  await explain('http://localhost:2024', input, { client: { runs: { async *stream(thread, graph, options) {
    assert.equal(thread, null)
    assert.equal(options.onCompletion, 'delete')
    assert.deepEqual(options.input, input)
    yield { event: 'values', data: { explanation: 'The difference is...' } }
  } } } })
})

test('reasoning content is never rendered', () => {
  assert.equal(textOf([{ type: 'reasoning', text: 'private' }, { type: 'text', text: 'visible' }]), 'visible')
})

test('interleaved translation and teaching tokens are kept separate and independently completed', async () => {
  const translated = []
  const teaching = []
  const translationToken = (text) => ({ event: 'messages', data: [{ type: 'ai', content: text }, { langgraph_node: 'direct_translation' }] })
  const result = await explain('http://localhost:2024', { ...request, include_translation: true }, {
    client: fake([translationToken('捕获'), token('Teaching'), translationToken('选中内容。'),
      { event: 'values', data: { translation: '捕获选中内容。' } },
      token(' notes'), { event: 'values', data: { explanation: 'Teaching notes', translation: '捕获选中内容。' } }]),
    onText: (text) => teaching.push(text), onTranslation: (text, complete) => translated.push({ text, complete }),
  })
  assert.equal(result, 'Teaching notes')
  assert.equal(teaching[0], 'Teaching')
  assert.deepEqual(translated.slice(0, 3), [
    { text: '捕获', complete: false }, { text: '捕获选中内容。', complete: false }, { text: '捕获选中内容。', complete: true },
  ])
  await assert.rejects(explain('http://localhost:2024', { ...request, include_translation: true }, {
    client: fake([{ event: 'values', data: { explanation: 'Teaching' } }]),
  }), /no Chinese translation/)
  assert.throws(() => validateMentorRequest({ ...request, include_translation: 'true' }))
})

test('truncated streams and SSE errors do not report success', async () => {
  await assert.rejects(explain('http://localhost:2024', request, { client: fake([token('partial')]) }), /before completion/)
  await assert.rejects(explain('http://localhost:2024', request, { client: fake([{ event: 'error', data: { message: 'private model detail' } }]) }), /could not finish/)
})

test('official SDK handles real SSE frames split across UTF-8 chunks', async () => {
  const updates = []
  const result = await explain('http://localhost:2024', request, {
    apiKey: 'private', onText: (text) => updates.push(text),
    fetchImpl: async (url, options) => {
      assert.equal(String(url), 'http://localhost:2024/runs/stream')
      assert.equal(options.redirect, 'error')
      assert.equal(new Headers(options.headers).get('x-api-key'), 'private')
      const body = JSON.parse(options.body)
      assert.equal(body.assistant_id, 'translation-mentor')
      assert.deepEqual(body.input, request)
      assert.equal(body.on_disconnect, 'cancel')
      assert.equal(body.on_completion, 'delete')
      const frames = [token('## 译文\n'), token('捕获。'), { event: 'values', data: { explanation: '## 译文\n捕获。' } }]
        .map((event) => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`).join('') + 'event: end\ndata: null\n\n'
      const bytes = new TextEncoder().encode(frames)
      return new Response(new ReadableStream({ start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
        controller.close()
      } }), { headers: { 'Content-Type': 'text/event-stream' } })
    },
  })
  assert.equal(result, '## 译文\n捕获。')
  assert.equal(updates[0], '## 译文\n')
})

test('aborting a stream prevents late text delivery', async () => {
  const controller = new AbortController()
  const updates = []
  await assert.rejects(explain('http://localhost:2024', request, { signal: controller.signal,
    client: fake([token('first'), token('late')]), onText: (text) => { updates.push(text); controller.abort() },
  }), { name: 'AbortError' })
  assert.deepEqual(updates, ['first'])
})
