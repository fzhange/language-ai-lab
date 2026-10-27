import { test, expect, _electron as electron } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

test('native app: secure preload, HTTP translation, clipboard, hide and wake', async () => {
  const requests = []
  let continueStream
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/ok') { response.end(JSON.stringify({ ok: true })); return }
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body)
    requests.push(payload)
    if (request.url !== '/runs/stream') { response.statusCode = 404; response.end('{}'); return }
    response.setHeader('Content-Type', 'text/event-stream')
    const answer = payload.input.follow_up ? 'digest 是名词，summary 更泛指摘要。' : payload.input.target_language === 'zh'
      ? '## 译文\n理解，而非死记。\n\n## 用法与区别\n理解强调掌握含义。\n\n## 例句\nUnderstand the context.'
      : '## 译文\nUnderstand, don\'t memorize.\n\n## 用法与区别\nunderstand 强调理解含义。'
    const send = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    const firstChunk = payload.input.follow_up ? 'digest 是名词，' : '## 译文\n'
    send('messages', [{ type: 'ai', content: firstChunk }, { langgraph_node: 'explain' }])
    if (requests.length === 1) await new Promise((resolve) => { continueStream = resolve })
    send('messages', [{ type: 'ai', content: answer.slice(firstChunk.length) }, { langgraph_node: 'explain' }])
    send('values', { explanation: answer })
    send('end', null)
    response.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const profile = await mkdtemp(path.join(tmpdir(), 'translate-e2e-'))
  const root = fileURLToPath(new URL('../', import.meta.url))
  let app
  try {
    app = await electron.launch({
      ...(process.env.TRANSLATE_E2E_EXECUTABLE ? { executablePath: process.env.TRANSLATE_E2E_EXECUTABLE } : {}),
      args: [root], cwd: root,
      env: { ...process.env, TRANSLATE_USER_DATA_DIR: profile, ELECTRON_RENDERER_URL: '',
        LANGGRAPH_URL: `http://127.0.0.1:${server.address().port}` },
    })
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('heading', { name: 'Translate', exact: true })).toBeVisible()
    const security = await app.evaluate(({ BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
      return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration }
    })
    expect(security).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false })
    expect(await page.evaluate(() => typeof window.require)).toBe('undefined')
    await expect(page.getByText('Service connected')).toBeVisible()
    // Exercise the scoped bridge without emitting audible speech in automated tests.
    expect(await page.evaluate(() => typeof window.desktop.readAloud)).toBe('function')
    await page.evaluate(() => window.desktop.stopReading())
    const invalidSpeech = await page.evaluate(async () => {
      try { await window.desktop.readAloud('中文', '1'); return '' }
      catch (error) { return error.message }
    })
    expect(invalidSpeech).toContain('English source text')
    await page.getByRole('textbox', { name: 'Text to translate' }).fill("Understand, don't memorize.")
    await expect(page.getByRole('button', { name: 'Read English aloud' })).toBeEnabled()
    await page.getByRole('textbox', { name: 'Text to translate' }).press('Enter')
    await expect(page.getByRole('heading', { name: '译文' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '例句' })).not.toBeVisible()
    continueStream()
    await expect(page.getByRole('heading', { name: '例句' })).toBeVisible()
    await page.getByRole('button', { name: 'Copy explanation' }).click()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain('## 用法与区别')
    expect(requests[0].assistant_id).toBe('translation-mentor')
    expect(requests[0].stream_mode).toEqual(['messages-tuple', 'values'])
    expect(requests[0].on_completion).toBe('delete')
    const followUp = page.getByRole('textbox', { name: 'Follow-up question' })
    await followUp.fill('这个词和 summary 有什么区别？')
    await followUp.press('Enter')
    await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText('digest 是名词，summary 更泛指摘要。')
    await expect(page.getByRole('heading', { name: '例句' })).toBeVisible()
    expect(requests.at(-1).input.text).toBe("Understand, don't memorize.")
    expect(requests.at(-1).input.follow_up).toBe('这个词和 summary 有什么区别？')
    expect(requests.at(-1).input.history.map((message) => message.role)).toEqual(['assistant'])
    expect(requests.at(-1).on_completion).toBe('delete')
    await page.screenshot({ path: 'test-results/translate-native.png' })
    const shortcutRegistered = await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Command+B'))
    expect(shortcutRegistered).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false)
    // Exercise the same wake handler as Command+B without synthesizing OS input.
    await app.evaluate(({ app }) => app.emit('activate'))
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true)
    await expect(page.getByRole('textbox', { name: 'Text to translate' })).toBeFocused()
    // Deliver a captured native selection across the real preload event boundary.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('window:wake', { text: 'Automatic selection' }))
    await expect(page.getByRole('textbox', { name: 'Text to translate' })).toHaveValue('Automatic selection')
    await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText('理解，而非死记。')
    await expect(page.getByRole('button', { name: 'Explain', exact: true })).toBeVisible()
    expect(requests.at(-1).input.text).toBe('Automatic selection')
    expect(requests.at(-1).input.history).toBeUndefined()
    await page.getByRole('textbox', { name: 'Text to translate' }).fill('自动识别输入语言。')
    await expect(page.getByRole('button', { name: 'Read English aloud' })).not.toBeVisible()
    await expect(page.getByLabel('Source language')).toHaveText('Chinese')
    await expect(page.getByLabel('Target language')).toHaveText('English')
    await page.getByRole('button', { name: 'Explain', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText("Understand, don't memorize.")
    expect(requests.at(-1).input).toEqual({ text: '自动识别输入语言。', focus: '', source_language: 'zh', target_language: 'en' })
    const permission = await page.evaluate(() => window.desktop.getAccessibilityPermission())
    expect(typeof permission).toBe('boolean')
    // Both native AX checks and capture now execute under Translate's TCC identity.
    // This status-only check never reads the user's foreground selection.
    const nativeStatus = await app.evaluate(({ app, systemPreferences }) => {
      const path = process.mainModule.require('node:path')
      const ffi = process.mainModule.require('koffi')
      const lib = ffi.load(path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(),
        app.isPackaged ? 'selection-capture' : 'native/bin',
        `selection-capture-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}.dylib`))
      return {
        capturePid: lib.func('int TranslateCaptureProcessId(void)')(),
        appPid: process.pid,
        captureTrusted: lib.func('int TranslateAccessibilityTrusted(void)')() === 1,
        appTrusted: systemPreferences.isTrustedAccessibilityClient(false),
      }
    })
    expect(nativeStatus.capturePid).toBe(nativeStatus.appPid)
    expect(nativeStatus.captureTrusted).toBe(nativeStatus.appTrusted)
    expect(permission).toBe(nativeStatus.captureTrusted)
    expect(errors).toEqual([])
  } finally {
    continueStream?.()
    if (app) await app.close()
    await new Promise((resolve) => server.close(resolve))
    await rm(profile, { recursive: true, force: true })
  }
})
