const { spawn } = require('node:child_process')

function validateSpeech(text, requestId) {
  if (typeof requestId !== 'string' || !/^\d{1,16}$/.test(requestId)) throw new Error('Invalid speech request ID.')
  if (typeof text !== 'string' || !text.trim() || [...text].length > 10000 || text.includes('\0')) {
    throw new Error('Read-aloud text must contain 1-10,000 characters.')
  }
  if (!/\p{Script=Latin}/u.test(text) || /\p{Script=Han}/u.test(text)) {
    throw new Error('Read aloud is available for English source text.')
  }
}

function createSpeechController({ onState = () => {}, spawnImpl = spawn, platform = process.platform } = {}) {
  let active

  function stop() {
    if (!active) return
    const current = active
    active = undefined
    current.child.kill('SIGTERM')
    onState({ requestId: current.requestId, speaking: false })
  }

  async function speak(text, requestId) {
    validateSpeech(text, requestId)
    if (platform !== 'darwin') throw new Error('Read aloud is available on macOS.')
    stop()
    // Source text goes to stdin, never shell code or command-line options.
    const child = spawnImpl('/usr/bin/say', ['-v', 'Samantha'], {
      stdio: ['pipe', 'ignore', 'ignore'], shell: false,
    })
    const current = { child, requestId }
    active = current
    return new Promise((resolve, reject) => {
      let started = false
      let settled = false
      const fail = () => {
        const error = new Error('Could not read aloud. Check that the English Samantha voice is installed in macOS Spoken Content settings.')
        if (active === current) {
          active = undefined
          child.kill('SIGTERM')
          onState({ requestId, speaking: false, error: error.message })
        }
        if (!settled) { settled = true; reject(error) }
      }
      child.once('error', fail)
      child.stdin.on('error', fail)
      child.once('spawn', () => {
        if (active !== current) {
          child.kill('SIGTERM')
          settled = true
          resolve(false)
          return
        }
        started = true
        onState({ requestId, speaking: true })
        child.stdin.end(text)
        settled = true
        resolve(true)
      })
      child.once('close', (code) => {
        if (active !== current) return
        if (code !== 0 || !started) { fail(); return }
        active = undefined
        onState({ requestId, speaking: false })
      })
    })
  }

  return { speak, stop }
}

module.exports = { createSpeechController, validateSpeech }
