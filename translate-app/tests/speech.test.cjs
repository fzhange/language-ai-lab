const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createSpeechController, validateSpeech } = require('../electron/speech.cjs')

function childProcess() {
  const child = new EventEmitter()
  child.stdin = new EventEmitter()
  child.stdin.end = (text) => { child.text = text }
  child.kill = (signal) => { child.killed = signal; return true }
  return child
}

test('read-aloud validates English text, bounded length and request identity', () => {
  validateSpeech('substantial', '1')
  validateSpeech('First sentence.\nSecond sentence.', '2')
  for (const text of ['', ' ', null, '中文', '12345', 'x'.repeat(10001), 'test\0']) {
    assert.throws(() => validateSpeech(text, '1'))
  }
  assert.throws(() => validateSpeech('word', 'invalid'))
})

test('macOS read-aloud uses a fixed executable/voice with source data on stdin', async () => {
  const states = []
  const child = childProcess()
  const speech = createSpeechController({ platform: 'darwin', onState: (state) => states.push(state),
    spawnImpl: (file, args, options) => {
      assert.equal(file, '/usr/bin/say')
      assert.deepEqual(args, ['-v', 'Samantha'])
      assert.equal(options.shell, false)
      assert.deepEqual(options.stdio, ['pipe', 'ignore', 'ignore'])
      return child
    },
  })
  const text = '-o /tmp/not-a-command "quoted word"\n$(not-a-shell-command)'
  const playing = speech.speak(text, '1')
  child.emit('spawn')
  assert.equal(await playing, true)
  assert.equal(child.text, text)
  assert.deepEqual(states, [{ requestId: '1', speaking: true }])
  child.emit('close', 0)
  assert.deepEqual(states.at(-1), { requestId: '1', speaking: false })
})

test('stop and replacement kill only the owned speech process; late completion does not reset new playback', async () => {
  const states = []
  const children = []
  const speech = createSpeechController({ platform: 'darwin', onState: (state) => states.push(state),
    spawnImpl: () => { const child = childProcess(); children.push(child); return child },
  })
  const first = speech.speak('first', '1')
  children[0].emit('spawn')
  await first
  const second = speech.speak('second', '2')
  assert.equal(children[0].killed, 'SIGTERM')
  children[1].emit('spawn')
  await second
  children[0].emit('close', 0)
  assert.deepEqual(states.at(-1), { requestId: '2', speaking: true })
  speech.stop()
  assert.equal(children[1].killed, 'SIGTERM')
  assert.deepEqual(states.at(-1), { requestId: '2', speaking: false })
  speech.stop()
})

test('stopping before spawn never starts speech; startup and voice errors are visible', async () => {
  let child = childProcess()
  const states = []
  const speech = createSpeechController({ platform: 'darwin', onState: (state) => states.push(state), spawnImpl: () => child })
  const pending = speech.speak('word', '1')
  speech.stop()
  child.emit('spawn')
  assert.equal(await pending, false)
  assert.equal(child.text, undefined)
  child = childProcess()
  const failure = assert.rejects(speech.speak('word', '2'), /Could not read aloud/)
  child.emit('error', new Error('private OS error'))
  await failure
  assert.match(states.at(-1).error, /English Samantha voice/)
  child = childProcess()
  const started = speech.speak('word', '3')
  child.emit('spawn')
  await started
  child.emit('close', 1)
  assert.equal(states.at(-1).speaking, false)
  assert.ok(states.at(-1).error)
})

test('unsupported platforms do not spawn a speech process', async () => {
  const speech = createSpeechController({ platform: 'linux', spawnImpl: () => assert.fail('Must not spawn') })
  await assert.rejects(speech.speak('word', '1'), /macOS/)
})
