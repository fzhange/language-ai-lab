import { test, expect } from '@playwright/test'

const answer = '## 译文\n捕获选中内容。\n\n## 语境与含义\n**capture** 在工具场景中表示主动捕获。\n\n## 重点拆解\n- capture the selection：捕获选中内容\n\n## 用法与区别\ncapture 比 get 更强调主动获取当前内容。\n\n## 例句\nCapture the current selection.\n捕获当前选中的内容。'

test.beforeEach(async ({ page }) => {
  await page.addInitScript((answer) => {
    window.testRequests = []
    window.testClipboard = 'Hello, world.'
    window.testSettings = { serviceUrl: 'http://127.0.0.1:2024', shortcutRegistered: true }
    window.testTextListener = () => {}
    window.testSpeechListener = () => {}
    window.testReadRequests = []
    window.desktop = {
      translate: async (request, requestId) => {
        window.testRequests.push(request)
        if (request.text === 'fail') throw new Error('Cannot reach the agent service.')
        if (request.follow_up === 'fail') throw new Error('Follow-up service unavailable.')
        if (request.text === 'slow' || request.follow_up === 'slow') {
          window.testTextListener({ requestId, text: '## 译文\n正在解释' })
          return new Promise((resolve) => { window.resolveTranslation = (text) => {
            window.testTextListener({ requestId, text }); resolve(text)
          } })
        }
        const text = request.follow_up ? 'capture 更强调主动捕获，get 是较泛的获取。\n\nCapture the selection. 获取选中内容。' : request.target_language === 'zh' ? answer : '## 译文\nUnderstand, don\'t memorize.\n\n## 用法与区别\nunderstand 强调理解含义。'
        window.testTextListener({ requestId, text })
        return text
      },
      onMentorText: (callback) => { window.testTextListener = callback; return () => {} },
      cancel: async () => {},
      readAloud: async (text, requestId) => {
        window.testReadRequests.push(text)
        if (text === 'speechfail') throw new Error('Could not read aloud.')
        window.testSpeechId = requestId
        window.testSpeechListener({ requestId, speaking: true })
        return true
      },
      stopReading: async () => {
        window.testSpeechListener({ requestId: window.testSpeechId, speaking: false })
      },
      onSpeechState: (callback) => { window.testSpeechListener = callback; return () => {} },
      getSettings: async () => window.testSettings,
      saveSettings: async (settings) => {
        if (!settings.serviceUrl.startsWith('http://127.0.0.1') && !settings.serviceUrl.startsWith('https://')) {
          throw new Error('Use HTTPS for remote services, or HTTP for localhost.')
        }
        window.testSettings = { ...window.testSettings, ...settings }; return window.testSettings
      },
      checkConnection: async () => true,
      readClipboard: async () => window.testClipboard,
      writeClipboard: async (text) => { window.testClipboard = text },
      hide: async () => { window.testHidden = true },
      getAccessibilityPermission: async () => false,
      requestAccessibilityPermission: async () => { window.testPermissionRequested = true; return false },
      onWake: (callback) => { window.testWake = callback; return () => {} },
    }
  }, answer)
  await page.goto('/')
})

test('word and sentence input renders mentor Markdown, context and examples', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Text to translate' }).fill('Capture the selection before bringing Translate forward.')
  await page.getByLabel('Focus word or phrase').fill('capture')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  await expect(page.getByRole('heading', { name: '语境与含义' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '例句' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText('capture 比 get')
  expect(await page.evaluate(() => window.testRequests[0].focus)).toBe('capture')
  await page.getByRole('button', { name: 'Copy explanation' }).click()
  expect(await page.evaluate(() => window.testClipboard)).toBe(answer)
  await page.screenshot({ path: 'test-results/mentor-answer.png', fullPage: true })
})

test('English source read-aloud starts only on click and stops, completes or resets safely', async ({ page }) => {
  const source = page.getByRole('textbox', { name: 'Text to translate' })
  await expect(page.getByRole('button', { name: 'Read English aloud' })).toBeDisabled()
  await source.fill('substantial')
  expect(await page.evaluate(() => window.testReadRequests)).toEqual([])
  await page.getByRole('button', { name: 'Read English aloud' }).click()
  await expect(page.getByRole('button', { name: 'Stop reading' })).toBeVisible()
  expect(await page.evaluate(() => window.testReadRequests)).toEqual(['substantial'])
  expect(await page.evaluate(() => window.testRequests)).toEqual([])
  await page.getByRole('button', { name: 'Stop reading' }).click()
  await expect(page.getByRole('button', { name: 'Read English aloud' })).toBeVisible()
  await page.getByRole('button', { name: 'Read English aloud' }).click()
  await page.evaluate(() => window.testSpeechListener({ requestId: window.testSpeechId, speaking: false }))
  await expect(page.getByRole('button', { name: 'Read English aloud' })).toBeVisible()
  await page.getByRole('button', { name: 'Read English aloud' }).click()
  await source.fill('New English sentence.')
  await expect(page.getByRole('button', { name: 'Stop reading' })).not.toBeVisible()
  await page.evaluate(() => window.testSpeechListener({ requestId: window.testSpeechId, speaking: true }))
  await expect(page.getByRole('button', { name: 'Stop reading' })).not.toBeVisible()
  await source.fill('中文输入')
  await expect(page.getByRole('button', { name: 'Read English aloud' })).not.toBeVisible()
})

test('speech errors do not affect mentor output and unsupported/oversized text cannot be read', async ({ page }) => {
  const source = page.getByRole('textbox', { name: 'Text to translate' })
  await source.fill('speechfail')
  await page.getByRole('button', { name: 'Read English aloud' }).click()
  await expect(page.getByRole('alert')).toContainText('Could not read aloud')
  await expect(page.getByRole('button', { name: 'Read English aloud' })).toBeEnabled()
  await source.fill('123')
  await expect(page.getByRole('button', { name: 'Read English aloud' })).toBeDisabled()
  await source.fill('x'.repeat(10001))
  await expect(page.getByRole('button', { name: 'Read English aloud' })).toBeDisabled()
})

test('English vocabulary IPA is rendered with pronunciation and part of speech', async ({ page }) => {
  await page.evaluate(() => {
    window.desktop.translate = async (_request, requestId) => {
      const answer = '## 译文\n可观的，大量的。\n\n## 发音\n**substantial** · 形容词 adj.\n\n英/美 /səbˈstænʃəl/\n\n## 用法与区别\nsubstantial 强调数量或程度值得注意。'
      window.testTextListener({ requestId, text: answer })
      return answer
    }
  })
  await page.getByRole('textbox', { name: 'Text to translate' }).fill('substantial')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  await expect(page.getByRole('heading', { name: '发音' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText('/səbˈstænʃəl/')
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText('形容词 adj.')
  await expect(page.getByRole('button', { name: 'Read English aloud' })).toBeEnabled()
  await page.screenshot({ path: 'test-results/mentor-english-pronunciation.png', fullPage: true })
})

test('paste, clear, keyboard submit, hide and wake', async ({ page }) => {
  await page.getByRole('button', { name: 'Paste text' }).click()
  await expect(page.getByRole('textbox', { name: 'Text to translate' })).toHaveValue('Hello, world.')
  await page.getByRole('textbox', { name: 'Text to translate' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: '译文' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear text' }).click()
  await expect(page.getByRole('textbox', { name: 'Text to translate' })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Explain', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => window.testHidden)).toBe(true)
  await page.evaluate(() => window.testWake())
  await expect(page.getByRole('textbox', { name: 'Text to translate' })).toBeFocused()
})

test('Shift+Enter inserts a newline and Enter submits the complete text exactly once', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Text to translate' })
  await input.fill('First line')
  await input.press('End')
  await input.press('Shift+Enter')
  await page.keyboard.insertText('Second line')
  await expect(input).toHaveValue('First line\nSecond line')
  expect(await page.evaluate(() => window.testRequests)).toEqual([])
  await input.press('Enter')
  await expect(page.getByRole('heading', { name: '译文' })).toBeVisible()
  expect(await page.evaluate(() => window.testRequests.map((request) => request.text))).toEqual(['First line\nSecond line'])
  await expect(input).toHaveValue('First line\nSecond line')
})

test('Enter respects empty input, running requests and IME composition', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Text to translate' })
  await input.press('Enter')
  expect(await page.evaluate(() => window.testRequests)).toEqual([])
  await input.fill('正在输入')
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, bubbles: true })
  expect(await page.evaluate(() => window.testRequests)).toEqual([])
  await input.fill('slow')
  await input.press('Enter')
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await input.press('Enter')
  expect(await page.evaluate(() => window.testRequests.map((request) => request.text))).toEqual(['slow'])
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
})

test('Enter in Settings does not ask the mentor', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Text to translate' }).fill('capture')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Agent service URL').press('Enter')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  expect(await page.evaluate(() => window.testRequests)).toEqual([])
})

test('tokens are visible before completion; stop retains partial text and ignores late output', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Text to translate' }).fill('slow')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText('正在解释')
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.evaluate(() => window.resolveTranslation('stale output'))
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).not.toContainText('stale output')
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText('正在解释')
})

test('shows service errors without fake mentor content', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Text to translate' }).fill('fail')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Cannot reach')
  await expect(page.getByRole('heading', { name: '例句' })).not.toBeVisible()
})

test('saves settings and offers Accessibility access', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Allow Access', exact: true }).click()
  expect(await page.evaluate(() => window.testPermissionRequested)).toBe(true)
  await page.getByLabel('Agent service URL').fill('http://example.com')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Use HTTPS')
  await page.getByLabel('Agent service URL').fill('https://example.com/agent')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test('detects language across typed, pasted and shortcut input', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Text to translate' }).fill('理解来自语境。')
  await expect(page.getByLabel('Source language')).toHaveText('Chinese')
  await expect(page.getByLabel('Target language')).toHaveText('English')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText("Understand, don't memorize.")
  await page.evaluate(() => { window.testClipboard = 'capture' })
  await page.getByRole('button', { name: 'Paste text' }).click()
  await expect(page.getByLabel('Source language')).toHaveText('English')
  await page.evaluate(() => window.testWake({ text: '新的选择' }))
  await expect(page.getByRole('textbox', { name: 'Text to translate' })).toHaveValue('新的选择')
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText("Understand, don't memorize.")
})

test('Chinese expression coaching renders vocabulary IPA and distinct sentence alternatives', async ({ page }) => {
  const replies = {
    '架构师': '## 英文表达\n\n| 英文 | 词性 | 音标（IPA） |\n| --- | --- | --- |\n| architect | 名词（n.，可数） | UK /ˈɑːkɪtekt/ · US /ˈɑːrkɪtekt/ |\n\n## 怎么选\n软件领域可用 **software architect**。\n\n## 例句\nShe is a software architect.\n她是一名软件架构师。',
    '我想再考虑一下': "## 推荐表达\n\n**I'd like to think about it a bit more.**\n自然、礼貌。\n\n## 其他表达\n1. **Let me think it over.** 日常口语。\n2. **I need some more time to consider this.** 更正式、直接。\n\n## 表达差异\n第一种更委婉，第二种更简洁，第三种更强调需要时间。",
  }
  await page.evaluate((replies) => {
    window.desktop.translate = async (request, requestId) => {
      window.testRequests.push(request)
      const text = replies[request.text]
      window.testTextListener({ requestId, text })
      return text
    }
  }, replies)
  const input = page.getByRole('textbox', { name: 'Text to translate' })
  const explanation = page.getByRole('region', { name: 'Mentor explanation' })
  await input.fill('架构师')
  await input.press('Enter')
  await expect(explanation.getByRole('heading', { name: '英文表达' })).toBeVisible()
  await expect(explanation.getByRole('columnheader', { name: '词性' })).toBeVisible()
  await expect(explanation.getByRole('columnheader', { name: '音标（IPA）' })).toBeVisible()
  await expect(explanation.getByRole('cell', { name: '名词（n.，可数）' })).toBeVisible()
  await expect(explanation.getByRole('table')).toContainText('/ˈɑːrkɪtekt/')
  await page.screenshot({ path: 'test-results/mentor-chinese-word.png', fullPage: true })
  await input.fill('我想再考虑一下')
  await input.press('Enter')
  await expect(explanation.getByRole('heading', { name: '推荐表达' })).toBeVisible()
  await expect(explanation.getByRole('heading', { name: '其他表达' })).toBeVisible()
  await expect(explanation.getByRole('heading', { name: '表达差异' })).toBeVisible()
  await expect(explanation).toContainText('Let me think it over.')
  await expect(explanation.getByRole('table')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/mentor-chinese-sentence.png', fullPage: true })
  expect(await page.evaluate(() => window.testRequests.map(({ source_language, target_language }) => ({ source_language, target_language })))).toEqual([
    { source_language: 'zh', target_language: 'en' },
    { source_language: 'zh', target_language: 'en' },
  ])
})

test('new selection replaces a running explanation without stale tokens', async ({ page }) => {
  await page.evaluate(() => window.testWake({ text: 'slow' }))
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await page.evaluate(() => window.testWake({ text: '新的选择' }))
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText("Understand, don't memorize.")
  await page.evaluate(() => window.resolveTranslation('old translation'))
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).not.toContainText('old translation')
})

test('capture failure and oversized input do not submit', async ({ page }) => {
  await page.evaluate(() => window.testWake({ error: 'Allow Translate in Accessibility.' }))
  await expect(page.getByRole('alert')).toContainText('Accessibility')
  await page.evaluate(() => window.testWake({ text: 'x'.repeat(10001) }))
  await expect(page.getByRole('alert')).toContainText('10,000 characters')
  expect(await page.evaluate(() => window.testRequests)).toEqual([])
})

test('model HTML and remote images are not rendered or fetched', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Text to translate' }).fill('slow')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  await page.evaluate(() => window.resolveTranslation('<script>window.hacked=true</script>\n\n![image](https://example.com/x.png)\n\n[link](javascript:alert(1))\n\n## 译文\nSafe text'))
  await expect(page.getByRole('heading', { name: '译文' })).toBeVisible()
  expect(await page.evaluate(() => window.hacked)).toBeUndefined()
  await expect(page.getByRole('region', { name: 'Mentor explanation' }).locator('img, a, script')).toHaveCount(0)
})

test('follow-ups preserve original context and all completed turns without changing direction', async ({ page }) => {
  const source = page.getByRole('textbox', { name: 'Text to translate' })
  await source.fill('capture')
  await source.press('Enter')
  const question = page.getByRole('textbox', { name: 'Follow-up question' })
  await expect(question).toBeVisible()
  await question.fill('和 get 有什么区别？')
  await question.press('Enter')
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).toContainText('capture 更强调主动捕获')
  await expect(source).toHaveValue('capture')
  await expect(page.getByLabel('Source language')).toHaveText('English')
  await question.fill('再举一个例子')
  await page.getByRole('button', { name: 'Send follow-up' }).click()
  await expect(question).toHaveValue('')
  const requests = await page.evaluate(() => window.testRequests)
  expect(requests[1]).toMatchObject({ text: 'capture', source_language: 'en', follow_up: '和 get 有什么区别？', history: [{ role: 'assistant', content: answer }] })
  expect(requests[2].history.map((message) => message.role)).toEqual(['assistant', 'user', 'assistant'])
  expect(requests[2].history[1].content).toBe('和 get 有什么区别？')
  await page.screenshot({ path: 'test-results/mentor-follow-up.png', fullPage: true })
})

test('follow-up Shift+Enter, IME, empty and length limits respect submission rules', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Text to translate' }).fill('capture')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  const question = page.getByRole('textbox', { name: 'Follow-up question' })
  await question.press('Enter')
  await question.fill('为什么')
  await question.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })
  await question.press('End')
  await question.press('Shift+Enter')
  await page.keyboard.insertText('举个例子')
  await expect(question).toHaveValue('为什么\n举个例子')
  expect(await page.evaluate(() => window.testRequests.length)).toBe(1)
  await question.fill('x'.repeat(2001))
  await expect(page.getByRole('alert')).toContainText('2,000')
  await expect(page.getByRole('button', { name: 'Send follow-up' })).toBeDisabled()
  await question.press('Enter')
  expect(await page.evaluate(() => window.testRequests.length)).toBe(1)
})

test('failed and cancelled follow-ups preserve valid context for retry', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Text to translate' }).fill('capture')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  const question = page.getByRole('textbox', { name: 'Follow-up question' })
  await question.fill('fail')
  await question.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Follow-up service unavailable')
  await expect(question).toHaveValue('fail')
  await question.fill('slow')
  await question.press('Enter')
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(question).toHaveValue('slow')
  await page.evaluate(() => window.resolveTranslation('stale answer'))
  await question.fill('请再解释一下')
  await question.press('Enter')
  await expect(page.getByRole('region', { name: 'Mentor explanation' })).not.toContainText('stale answer')
  expect(await page.evaluate(() => window.testRequests.at(-1).history)).toEqual([{ role: 'assistant', content: answer }])
})

test('editing source, focus or capturing new selection starts a fresh memory-only conversation', async ({ page }) => {
  const source = page.getByRole('textbox', { name: 'Text to translate' })
  await source.fill('capture')
  await source.press('Enter')
  await page.getByRole('textbox', { name: 'Follow-up question' }).fill('draft')
  await source.fill('digest')
  await expect(page.getByRole('textbox', { name: 'Follow-up question' })).not.toBeVisible()
  await source.press('Enter')
  expect(await page.evaluate(() => window.testRequests.at(-1).history)).toBeUndefined()
  await page.getByLabel('Focus word or phrase').fill('digest')
  await expect(page.getByRole('textbox', { name: 'Follow-up question' })).not.toBeVisible()
  await source.press('Enter')
  await page.evaluate(() => window.testWake({ text: 'new source' }))
  await expect(source).toHaveValue('new source')
  expect(await page.evaluate(() => window.testRequests.at(-1).history)).toBeUndefined()
  await page.reload()
  await expect(source).toHaveValue('')
  await expect(page.getByRole('textbox', { name: 'Follow-up question' })).not.toBeVisible()
})

test('blue mentor layouts fit desktop and narrow screens with a long answer', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Text to translate' }).fill('capture')
  await page.getByRole('button', { name: 'Explain', exact: true }).click()
  for (const [width, height] of [[1060, 780], [620, 540], [390, 844]]) {
    await page.setViewportSize({ width, height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await expect(page.getByRole('button', { name: 'Explain', exact: true })).toBeVisible()
    await page.screenshot({ path: `test-results/mentor-${width}.png`, fullPage: true })
  }
})
