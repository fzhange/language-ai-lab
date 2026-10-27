import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electron from 'electron'

const server = await createServer({ server: { host: '127.0.0.1', port: 5175, strictPort: false } })
await server.listen()
server.printUrls()
const address = server.httpServer.address()
const child = spawn(electron, ['.'], {
  stdio: 'inherit', env: { ...process.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${address.port}/` },
})
let stopping = false
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  child.kill('SIGTERM')
  await server.close()
  process.exit(code)
}
child.on('exit', (code) => stop(code ?? 0))
child.on('error', (error) => { console.error(error); stop(1) })
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
