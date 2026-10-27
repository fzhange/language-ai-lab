const { test } = require('node:test')
const assert = require('node:assert/strict')
const { captureSelection, createSelectionShortcut, hasSelectionPermission } = require('../electron/selection.cjs')
const { loadNativeSelection } = require('../electron/native-selection.cjs')

const base = {
  platform: 'darwin', arch: 'arm64',
  app: { isPackaged: false, getAppPath: () => '/workspace/translate-app' },
  systemPreferences: { isTrustedAccessibilityClient: () => true },
}

test('captures selected text through an in-process library, not a child executable', async () => {
  const payload = await captureSelection({ ...base, getNative: (app) => {
    assert.equal(app, base.app)
    return { capture: async () => ({ text: 'Selected source text' }) }
  } })
  assert.deepEqual(payload, { text: 'Selected source text' })
})

test('does not capture or use clipboard text without Accessibility permission', async () => {
  const payload = await captureSelection({ ...base,
    systemPreferences: { isTrustedAccessibilityClient: () => false },
    getNative: () => assert.fail('Must not capture without permission'),
  })
  assert.match(payload.error, /Accessibility/)
  assert.equal(payload.text, undefined)
})

test('missing, denied, invalid and failed captures never provide stale text', async () => {
  for (const result of [{}, { error: 'no-selection' }, { text: ' ' }, { error: 'accessibility' }, { error: 'capture-failed' }]) {
    const payload = await captureSelection({ ...base, getNative: () => ({ capture: async () => result }) })
    assert.equal(payload.text, undefined)
    assert.ok(payload.error)
  }
  const payload = await captureSelection({ ...base, getNative: () => { throw new Error('library failed to load') } })
  assert.equal(payload.text, undefined)
  assert.match(payload.error, /Could not capture/)
})

test('permission reflects both the app and the in-process capture API', () => {
  assert.equal(hasSelectionPermission({ ...base, getNative: () => ({ isTrusted: () => true }) }), true)
  assert.equal(hasSelectionPermission({ ...base, getNative: () => ({ isTrusted: () => false }) }), false)
  assert.equal(hasSelectionPermission({ ...base,
    systemPreferences: { isTrustedAccessibilityClient: () => false },
    getNative: () => assert.fail('Do not load native code without app permission'),
  }), false)
})

test('Koffi loads a fixed library path and always frees the native result', async () => {
  const freed = []
  const symbols = []
  const pointer = 1n
  const capture = Object.assign(() => {}, { async: (callback) => callback(null, pointer) })
  const ffi = {
    load: (file) => {
      assert.equal(file, '/workspace/translate-app/native/bin/selection-capture-arm64.dylib')
      return { func: (declaration) => {
        symbols.push(declaration)
        if (declaration.includes('TranslateAccessibilityTrusted')) return () => 1
        if (declaration.includes('TranslateCaptureProcessId')) return () => process.pid
        if (declaration.includes('TranslateCaptureSelection')) return capture
        if (declaration.includes('TranslateFreeResult')) return (value) => freed.push(value)
        assert.fail('Unexpected native symbol')
      } }
    },
    decode: { string: () => '{"text":"selection"}' },
  }
  const native = loadNativeSelection({ app: base.app, arch: 'arm64', ffi })
  assert.equal(native.isTrusted(), true)
  assert.equal(native.processId(), process.pid)
  assert.deepEqual(await native.capture(), { text: 'selection' })
  assert.deepEqual(freed, [pointer])
  ffi.decode.string = () => 'invalid JSON'
  await assert.rejects(native.capture(), SyntaxError)
  assert.deepEqual(freed, [pointer, pointer])
  assert.equal(symbols.length, 4)
})

test('global shortcut finishes capture before bringing Translate forward', async () => {
  const order = []
  const shortcut = createSelectionShortcut({
    isFocused: () => false,
    capture: async () => { order.push('capture'); return { text: 'selection' } },
    wake: (payload) => { order.push('wake'); assert.deepEqual(payload, { text: 'selection' }) },
  })
  await shortcut()
  assert.deepEqual(order, ['capture', 'wake'])
})

test('overlapping shortcut presses perform only one selection capture', async () => {
  let resolve
  let captures = 0
  const wakes = []
  const shortcut = createSelectionShortcut({
    isFocused: () => false,
    capture: () => { captures++; return new Promise((done) => { resolve = done }) },
    wake: (payload) => wakes.push(payload),
  })
  const first = shortcut()
  await shortcut()
  assert.equal(captures, 1)
  resolve({ text: 'same selection' })
  await first
  assert.deepEqual(wakes, [{ text: 'same selection' }])
})

test('waking Translate itself never copies from an unrelated app', async () => {
  let wakes = 0
  await createSelectionShortcut({ isFocused: () => true,
    capture: () => assert.fail('Must not capture'), wake: () => wakes++,
  })()
  assert.equal(wakes, 1)
})
