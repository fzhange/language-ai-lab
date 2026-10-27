const path = require('node:path')

function loadNativeSelection({ app, arch = process.arch, resourcesPath = process.resourcesPath, ffi = require('koffi') }) {
  const libraryPath = path.join(app.isPackaged ? resourcesPath : app.getAppPath(),
    app.isPackaged ? 'selection-capture' : 'native/bin',
    `selection-capture-${arch === 'arm64' ? 'arm64' : 'x86_64'}.dylib`)
  const library = ffi.load(libraryPath)
  const trusted = library.func('int TranslateAccessibilityTrusted(void)')
  const processId = library.func('int TranslateCaptureProcessId(void)')
  const capture = library.func('void *TranslateCaptureSelection(void)')
  const free = library.func('void TranslateFreeResult(void *result)')

  return {
    isTrusted: () => trusted() === 1,
    processId: () => processId(),
    capture: () => new Promise((resolve, reject) => {
      // Run bounded AX/clipboard work off the event loop, but in Translate's process.
      capture.async((error, pointer) => {
        try {
          if (error) throw error
          if (!pointer) throw new Error('Native selection capture returned no result.')
          resolve(JSON.parse(ffi.decode.string(pointer)))
        } catch (error) { reject(error) }
        finally { if (pointer) free(pointer) }
      })
    }),
  }
}

module.exports = { loadNativeSelection }
