const { app, BrowserWindow, Menu, globalShortcut, ipcMain, clipboard, dialog, systemPreferences, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { pathToFileURL } = require('node:url')
const { DEFAULT_URL, validateUrl, checkConnection } = require('./service.cjs')
const { explain } = require('./mentor.cjs')
const { captureSelection, createSelectionShortcut, hasSelectionPermission } = require('./selection.cjs')
const { createSpeechController } = require('./speech.cjs')

if (!app.isPackaged) require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
if (!app.isPackaged && process.env.TRANSLATE_USER_DATA_DIR) {
  app.setPath('userData', process.env.TRANSLATE_USER_DATA_DIR)
}
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const rendererFile = path.join(__dirname, '..', 'dist', 'index.html')
const rendererUrl = devUrl || pathToFileURL(rendererFile).href
const shortcut = process.platform === 'darwin' ? 'Command+B' : 'Control+B'
let window
let quitting = false
let controller
let settings
let shortcutRegistered = false
let rendererReady = false
let pendingWake
let translationSettled
const speech = createSpeechController({ onState: (payload) => {
  if (window && !window.isDestroyed()) window.webContents.send('speech:state', payload)
} })

function wake(payload = {}) {
  if (!window || window.isDestroyed()) return
  if (payload.text) speech.stop()
  if (window.isMinimized()) window.restore()
  window.show()
  app.focus({ steal: true })
  window.focus()
  if (rendererReady) window.webContents.send('window:wake', payload)
  else pendingWake = payload
}

async function cancelTranslation() {
  controller?.abort()
  await translationSettled
}

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || event.senderFrame.url !== rendererUrl) throw new Error('Untrusted IPC sender.')
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event)
    return fn(...args)
  })
}

async function loadSettings() {
  let saved = {}
  try {
    saved = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'settings.json'), 'utf8'))
  } catch { /* First launch or invalid settings uses the default endpoint. */ }
  try { return { serviceUrl: validateUrl(saved.serviceUrl || process.env.LANGGRAPH_URL || DEFAULT_URL) } }
  catch { return { serviceUrl: DEFAULT_URL } }
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1060, height: 780, minWidth: 620, minHeight: 540,
    title: 'Translate', backgroundColor: '#fafafa', show: false,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 21 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.on('close', (event) => {
    speech.stop()
    if (!quitting) { event.preventDefault(); window.hide() }
  })
  window.webContents.on('did-start-loading', () => { rendererReady = false; speech.stop() })
  window.on('hide', () => speech.stop())
  window.once('ready-to-show', () => wake(pendingWake || {}))
  if (devUrl) await window.loadURL(devUrl)
  else await window.loadFile(rendererFile)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => wake())
  app.on('activate', () => wake())
  app.on('before-quit', () => { quitting = true; controller?.abort(); speech.stop() })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.whenReady().then(async () => {
    settings = await loadSettings()
    const selectionShortcut = createSelectionShortcut({
      capture: () => captureSelection({ app, systemPreferences }),
      wake,
      isFocused: () => window?.isFocused() ?? false,
    })
    shortcutRegistered = globalShortcut.register(shortcut, () => void selectionShortcut())
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Translate', submenu: [
        { role: 'about' }, { type: 'separator' },
        { label: 'Show Translate', click: () => wake() },
        { role: 'hide' }, { type: 'separator' }, { role: 'quit' },
      ] },
      { role: 'editMenu' },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    ]))
    handle('window:ready', () => {
      rendererReady = true
      if (pendingWake) { window.webContents.send('window:wake', pendingWake); pendingWake = undefined }
    })
    handle('selection:permission', () => hasSelectionPermission({ app, systemPreferences }))
    handle('selection:request-permission', async () => {
      if (process.platform !== 'darwin') return false
      systemPreferences.isTrustedAccessibilityClient(true)
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
      return hasSelectionPermission({ app, systemPreferences })
    })
    handle('settings:get', () => ({ ...settings, shortcutRegistered }))
    handle('settings:save', async (value) => {
      if (controller) throw new Error('Finish or stop the current translation before changing the service.')
      const next = { serviceUrl: validateUrl(value?.serviceUrl) }
      await fs.writeFile(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify(next), { mode: 0o600 })
      settings = next
      return { ...settings, shortcutRegistered }
    })
    handle('translation:run', async (request, requestId) => {
      if (typeof requestId !== 'string' || !/^\d{1,16}$/.test(requestId)) throw new Error('Invalid request ID.')
      if (controller) throw new Error('A mentor explanation is already running.')
      const current = new AbortController()
      controller = current
      let settle
      translationSettled = new Promise((resolve) => { settle = resolve })
      const timeout = setTimeout(() => current.abort('timeout'), 180000)
      try {
        return await explain(settings.serviceUrl, request, {
          signal: current.signal, apiKey: process.env.LANGGRAPH_API_KEY,
          onText: (text) => {
            if (!current.signal.aborted && !window.isDestroyed()) window.webContents.send('mentor:text', { requestId, text })
          },
        })
      } catch (error) {
        if (current.signal.aborted) throw new Error(current.signal.reason === 'timeout'
          ? 'The mentor timed out. Check the agent service and try again.' : 'Explanation stopped.')
        if (error.status === 404 || (error.status === 400 && error.message?.includes('Invalid assistant'))) {
          throw new Error('Mentor graph not found. Restart generic-agent-service to load translation-mentor.')
        }
        if (error.status === 422) throw new Error('The service rejected the mentor input. Check the translation-mentor graph schema in the agent service.')
        if ([401, 403].includes(error.status)) throw new Error('Service access denied. Check gateway authentication.')
        if (error.status >= 500) throw new Error('The mentor service failed. Check the agent service logs.')
        if (error.name === 'ConnectionError') throw new Error('Cannot reach the agent service. Check its address and make sure it is running.')
        if (error instanceof TypeError) throw new Error('Cannot reach the agent service. Check its address and make sure it is running.')
        throw error
      } finally { clearTimeout(timeout); if (controller === current) controller = undefined; settle() }
    })
    handle('translation:cancel', cancelTranslation)
    handle('speech:read', (text, requestId) => speech.speak(text, requestId))
    handle('speech:stop', () => speech.stop())
    handle('service:check', async () => {
      try { return await checkConnection(settings.serviceUrl, { apiKey: process.env.LANGGRAPH_API_KEY }) }
      catch { throw new Error('Cannot connect to the agent service. Check the address and make sure it is running.') }
    })
    handle('clipboard:read', () => clipboard.readText())
    handle('clipboard:write', (text) => {
      if (typeof text !== 'string' || text.length > 100000) throw new Error('Invalid clipboard text.')
      clipboard.writeText(text)
    })
    handle('window:hide', () => window.hide())
    await createWindow()
  }).catch((error) => {
    dialog.showErrorBox('Translate could not start', error.message)
    app.quit()
  })
}
