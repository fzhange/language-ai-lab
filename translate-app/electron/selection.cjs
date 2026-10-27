const { loadNativeSelection } = require('./native-selection.cjs')
let native

function selectionNative(app) {
  native ??= loadNativeSelection({ app })
  return native
}

function hasSelectionPermission({ app, systemPreferences, platform = process.platform, getNative = selectionNative }) {
  if (platform !== 'darwin' || !systemPreferences.isTrustedAccessibilityClient(false)) return false
  return getNative(app).isTrusted()
}

async function captureSelection({ app, systemPreferences, getNative = selectionNative, platform = process.platform }) {
  if (platform !== 'darwin') return { error: 'Selection capture is available on macOS.' }
  if (!systemPreferences.isTrustedAccessibilityClient(false)) {
    return { error: 'Allow Translate in System Settings > Privacy & Security > Accessibility, then select text and press Command+B again.' }
  }
  try {
    const result = await getNative(app).capture()
    if (result.error === 'accessibility') {
      return { error: 'macOS has not applied Accessibility access to this Translate build. Quit Translate, remove its old Accessibility entry, add this app again, enable it, and reopen Translate.' }
    }
    if (result.error === 'capture-failed') throw new Error('Native selection capture failed.')
    if (typeof result.text !== 'string' || !result.text.trim()) {
      return { error: 'No selected text was captured. Select text in the source app and press Command+B again.' }
    }
    return { text: result.text }
  } catch {
    return { error: 'Could not capture the selection. Check Accessibility permission and try again.' }
  }
}

function createSelectionShortcut({ capture, wake, isFocused }) {
  let capturing = false
  return async () => {
    if (capturing) return
    if (isFocused()) { wake(); return }
    capturing = true
    try { wake(await capture()) }
    catch { wake({ error: 'Could not capture the selection. Try selecting the text again.' }) }
    finally { capturing = false }
  }
}

module.exports = { captureSelection, createSelectionShortcut, hasSelectionPermission }
