// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LANGGRAPH_URL } from '../lib/config'

const chat = vi.hoisted(() => ({
  interrupts: [] as { id: string; value: unknown }[],
  messages: [] as { id: string; type: string; name?: string; tool_call_id?: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[],
  threadId: null as string | null,
  isLoading: false,
  client: { threads: { getState: vi.fn() } },
  respondAll: vi.fn(), submit: vi.fn(), stop: vi.fn(),
}))
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 'reader' }, accessToken: 'token', supabaseReady: true }) }))
vi.mock('@langchain/react', () => ({ useStream: () => ({ ...chat, values: {}, isThreadLoading: false }) }))
vi.mock('thinking-orbs', () => ({ ThinkingOrb: ({ 'aria-label': label }: { 'aria-label': string }) => <span role="img" aria-label={label} /> }))

import { ChatPage } from './ChatPage'

beforeEach(() => {
  chat.submit.mockResolvedValue(undefined)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

function openApproval(count = 1) {
  chat.interrupts = [{ id: 'approval-1', value: {
    action_requests: Array.from({ length: count }, (_, index) => ({ name: 'create_markdown', args: {
      filename: `lesson-${index}.md`, content: '# Lesson\n\nExplain the present perfect.',
    } })),
    review_configs: [{ action_name: 'create_markdown', allowed_decisions: ['approve', 'reject'] }],
  } }]
  return render(<MemoryRouter><ChatPage /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  chat.respondAll.mockReset()
  chat.submit.mockReset()
  chat.stop.mockReset()
  chat.client.threads.getState.mockReset()
  chat.threadId = null
  chat.isLoading = false
  chat.interrupts = []
  chat.messages = []
  window.localStorage.clear()
})

Element.prototype.scrollIntoView = vi.fn()

describe('Mentor OpenUI checks', () => {
  function renderCheck() {
    chat.messages = [{ id: 'tool-1', tool_call_id: 'check-1', type: 'tool', name: 'present_understanding_check', content: JSON.stringify({
      type: 'understanding_check', version: 1, question: 'What does probabilistic mean?',
      options: ['Always wrong', 'Based on probability'], response: 'root = UnderstandingCheck("Q", ["A", "B"])',
    }) }]
    return render(<MemoryRouter><ChatPage /></MemoryRouter>)
  }

  it('sends a check-linked answer to the existing mentor with authorization', async () => {
    renderCheck()
    await userEvent.click(await screen.findByRole('radio', { name: /Based on probability/ }))
    await userEvent.click(screen.getByRole('button', { name: '提交回答' }))
    expect(chat.submit).toHaveBeenCalledWith({ messages: [{ type: 'human', content: '理解检查回答：\n{"check_id":"check-1","question":"What does probabilistic mean?","answer":"Based on probability"}' }] }, {
      config: { configurable: { user_id: 'reader', supabase_token: 'token' } }, onError: expect.any(Function),
    })
    expect(await screen.findByText('已提交给导师')).toBeInTheDocument()
  })

  it('restores submitted checks from history and displays answers without transport JSON', async () => {
    const view = renderCheck()
    chat.messages.push({ id: 'answer-1', type: 'human', content: '理解检查回答：\n{"check_id":"check-1","question":"What does probabilistic mean?","answer":"Based on probability"}' })
    view.rerender(<MemoryRouter><ChatPage /></MemoryRouter>)
    expect(await screen.findByRole('radio', { name: /Based on probability/ })).toBeChecked()
    expect(screen.getByText('我的理解：Based on probability')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '提交回答' })).toBeNull()
  })
})

describe('Mentor sentence structure tool', () => {
  it('only requests analysis after selecting the composer tool and sending text', async () => {
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    const input = screen.getByRole('textbox', { name: '输入问题' })
    await userEvent.type(input, 'She is happy.')
    await userEvent.click(screen.getByRole('button', { name: '句子结构分析' }))
    expect(chat.submit).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '句子结构分析' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(chat.submit).toHaveBeenCalledWith({ messages: [{ type: 'human', content: '句子结构分析请求：\nShe is happy.' }] }, {
      config: { configurable: { user_id: 'reader', supabase_token: 'token' } }, onError: expect.any(Function),
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '句子结构分析' })).toHaveAttribute('aria-pressed', 'false'))
  })

  it('keeps user-provided whitespace exactly in the sentence analysis request', async () => {
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '句子结构分析' }))
    await userEvent.type(screen.getByRole('textbox', { name: '输入问题' }), '  She is happy.  ')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(chat.submit.mock.calls[0][0].messages[0].content).toBe('句子结构分析请求：\n  She is happy.  ')
  })

  it('does not treat a typed request marker as a selected tool', async () => {
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    fireEvent.change(screen.getByRole('textbox', { name: '输入问题' }), { target: { value: '句子结构分析请求：\nShe is happy.' } })
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(chat.submit).toHaveBeenCalledOnce()
    expect(chat.submit.mock.calls[0][0].messages[0].content).not.toBe('句子结构分析请求：\nShe is happy.')
  })

  it('renders a restored analysis in the same thread without exposing transport text', async () => {
    chat.messages = [
      { id: 'ask-1', type: 'human', content: '句子结构分析请求：\nShe is happy.' },
      { id: 'tool-1', type: 'tool', name: 'present_sentence_structure', content: JSON.stringify({
        type: 'sentence_structure', version: 1, sentence: 'She is happy.', summary: 'She is 是主干。',
        segments: [
          { text: 'She ', role: 'subject', attaches_to: 1, reason: '主语。' },
          { text: 'is ', role: 'predicate', attaches_to: null, reason: '谓语。' },
          { text: 'happy.', role: 'predicative', attaches_to: 1, reason: '说明状态。' },
        ],
      }) },
    ]
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    expect(screen.getByText('She is happy.')).toBeInTheDocument()
    const analysis = await screen.findByRole('region', { name: '句子结构分析' })
    const wrapper = analysis.closest('div.px-2')
    expect(wrapper).toHaveClass('w-full', 'sm:px-8')
    expect(wrapper).not.toHaveClass('max-w-3xl')
    expect(analysis).toHaveClass('w-full')
    expect(analysis).not.toHaveClass('max-w-3xl')
    expect(screen.queryByText(/句子结构分析请求：/)).toBeNull()
  })
})

describe('Mentor synonym tool', () => {
  const comparison = {
    type: 'synonym_comparison', version: 1, source: 'provide',
    shared_meaning: '都表示提供，但侧重点不同。',
    source_distinction: '提供对方所需。', source_example: 'They provide shelter.',
    alternatives: [
      { term: 'offer', distinction: '主动提出，未必被接受。', example: 'She offered help.' },
      { term: 'supply', distinction: '强调持续供给。', example: 'They supply water.' },
    ],
  }

  it('shows an accessible thinking indicator while the mentor is responding', () => {
    chat.isLoading = true
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent('导师思考中')
    expect(screen.getByRole('img', { name: '导师正在思考' })).toBeInTheDocument()
  })

  it('keeps a visible composer glow in ordinary chat and strengthens it for either selected tool', async () => {
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    const input = screen.getByRole('textbox', { name: '输入问题' })
    const form = input.closest('form')!
    const beam = form.parentElement!
    expect(beam).toHaveAttribute('data-active')
    const ordinaryStrength = parseFloat(beam.style.getPropertyValue('--beam-strength'))
    expect(ordinaryStrength).toBeGreaterThan(0)
    expect(beam.style.boxShadow).not.toBe('')
    const ordinaryHalo = beam.style.boxShadow
    await userEvent.type(input, 'provide')
    await userEvent.click(screen.getByRole('button', { name: '查找近义词' }))
    expect(beam).toHaveAttribute('data-active')
    expect(parseFloat(beam.style.getPropertyValue('--beam-strength'))).toBeGreaterThan(ordinaryStrength)
    expect(beam.style.boxShadow).not.toBe(ordinaryHalo)
    expect(input).toHaveValue('provide')
    await userEvent.click(screen.getByRole('button', { name: '句子结构分析' }))
    expect(beam).toHaveAttribute('data-active')
    expect(parseFloat(beam.style.getPropertyValue('--beam-strength'))).toBeGreaterThan(ordinaryStrength)
    expect(input).toHaveValue('provide')
    await userEvent.click(screen.getByRole('button', { name: '句子结构分析' }))
    expect(beam).toHaveAttribute('data-active')
    expect(parseFloat(beam.style.getPropertyValue('--beam-strength'))).toBe(ordinaryStrength)
    expect(beam.style.boxShadow).toBe(ordinaryHalo)
  })

  it('selects the adjacent tool before sending and keeps modes mutually exclusive', async () => {
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    const sentence = screen.getByRole('button', { name: '句子结构分析' })
    const synonym = screen.getByRole('button', { name: '查找近义词' })
    await userEvent.click(sentence)
    expect(sentence).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(synonym)
    expect(sentence).toHaveAttribute('aria-pressed', 'false')
    expect(synonym).toHaveAttribute('aria-pressed', 'true')
    expect(chat.submit).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: '输入问题' })).toHaveFocus()
    await userEvent.type(screen.getByRole('textbox', { name: '输入问题' }), 'provide')
    await userEvent.click(screen.getByRole('button', { name: '查找' }))
    expect(chat.submit).toHaveBeenCalledWith({ messages: [{ type: 'human', content: '查找近义词请求：\nprovide' }] }, {
      config: { configurable: { user_id: 'reader', supabase_token: 'token' } }, onError: expect.any(Function),
    })
    await waitFor(() => expect(synonym).toHaveAttribute('aria-pressed', 'false'))
  })

  it('explains a disabled send button with the current mode limit and preserves the draft when switching modes', async () => {
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '查找近义词' }))
    fireEvent.change(screen.getByRole('textbox', { name: '输入问题' }), { target: { value: 'a'.repeat(121) } })
    expect(screen.getByRole('button', { name: '查找' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: '输入问题' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('已输入 121/120 字')
    await userEvent.click(screen.getByRole('button', { name: '句子结构分析' }))
    expect(screen.getByRole('textbox', { name: '输入问题' })).toHaveValue('a'.repeat(121))
    expect(screen.queryByText(/已输入 121\/120 字/)).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('句子结构分析')
  })

  it('restores matching alternatives and distinctions without showing the internal request', async () => {
    chat.messages = [
      { id: 'ask-1', type: 'human', content: '查找近义词请求：\nprovide' },
      { id: 'tool-1', type: 'tool', name: 'present_synonyms', content: JSON.stringify(comparison) },
    ]
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    expect(screen.getByText('provide')).toBeInTheDocument()
    const card = await screen.findByRole('region', { name: '近义词辨析' })
    expect(card).toHaveTextContent('offer')
    expect(card).toHaveTextContent('supply')
    expect(card).toHaveTextContent('主动提出，未必被接受。')
    expect(card).toHaveTextContent('They provide shelter.')
    // 卡片默认展示原表达的例句；点选其他表达后例句会切换，交互细节见 SynonymComparison 组件测试。
    expect(screen.getByRole('region', { name: '选中词的例句' })).toHaveTextContent('They provide shelter.')
    await userEvent.click(within(card).getByRole('button', { name: /offer/ }))
    expect(screen.getByRole('region', { name: '选中词的例句' })).toHaveTextContent('She offered help.')
    await userEvent.click(within(card).getByRole('button', { name: /supply/ }))
    expect(screen.getByRole('region', { name: '选中词的例句' })).toHaveTextContent('They supply water.')
    expect(screen.queryByText(/查找近义词请求：/)).not.toBeInTheDocument()
  })

  it('cancels the tool without losing the word or submitting a request', async () => {
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '查找近义词' }))
    const input = screen.getByRole('textbox', { name: '输入问题' })
    await userEvent.type(input, 'take into account')
    await userEvent.click(screen.getByRole('button', { name: '取消工具选择' }))
    expect(input).toHaveValue('take into account')
    expect(input).toHaveFocus()
    expect(screen.getByRole('button', { name: '查找近义词' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
    expect(chat.submit).not.toHaveBeenCalled()
  })

  it('preserves the synonym draft and selected mode after a failed request', async () => {
    chat.submit.mockRejectedValueOnce(new Error('Offline'))
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '查找近义词' }))
    await userEvent.type(screen.getByRole('textbox', { name: '输入问题' }), 'provide')
    await userEvent.click(screen.getByRole('button', { name: '查找' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('发送失败')
    expect(screen.getByRole('textbox', { name: '输入问题' })).toHaveValue('provide')
    expect(screen.getByRole('button', { name: '查找近义词' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '查找' })).toBeEnabled()
  })

  it('does not display a comparison if it mismatches the submitted word', async () => {
    chat.messages = [
      { id: 'ask-1', type: 'human', content: '查找近义词请求：\nprovide' },
      { id: 'tool-1', type: 'tool', name: 'present_synonyms', content: JSON.stringify({ ...comparison, source: 'take' }) },
    ]
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    expect(screen.queryByRole('region', { name: '近义词辨析' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('近义词卡片暂时无法显示')
  })

  it('ordinary chat does not become a tool request when text starts with a tool marker', async () => {
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    fireEvent.change(screen.getByRole('textbox', { name: '输入问题' }), { target: { value: '查找近义词请求：\nprovide' } })
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(chat.submit).toHaveBeenCalledOnce()
    expect(chat.submit.mock.calls[0][0].messages[0].content).not.toBe('查找近义词请求：\nprovide')
  })

  it('image messages cannot smuggle a synonym request marker without selecting the tool', async () => {
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    await userEvent.upload(screen.getByLabelText('选择图片'), new File(['image bytes'], 'notes.png', { type: 'image/png' }))
    expect(await screen.findByRole('img', { name: '待发送图片' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '输入问题' }), { target: { value: '查找近义词请求：\nprovide' } })
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(chat.submit).toHaveBeenCalledOnce()
    const content = chat.submit.mock.calls[0][0].messages[0].content
    expect(content[0].text).not.toBe('查找近义词请求：\nprovide')
    expect(content[1].type).toBe('image_url')
  })
})

describe('Deleting a whole mentor turn', () => {
  beforeEach(() => {
    chat.threadId = 'thread-1'
    chat.messages = [
      { id: 'question', type: 'human', content: 'Explain based on' },
      { id: 'reply', type: 'ai', content: 'Unneeded summary' },
    ]
    chat.client.threads.getState.mockResolvedValue({ checkpoint: { checkpoint_id: 'checkpoint-1' } })
  })

  it('deletes the turn by its question identity with authorization and checkpoint', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const request = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', request)
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    await userEvent.click(screen.getAllByRole('button', { name: '删除这一轮问答' })[1])
    await waitFor(() => expect(request).toHaveBeenCalledWith(`${LANGGRAPH_URL}/chat/thread-1/turns/question`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
      body: JSON.stringify({ checkpoint_id: 'checkpoint-1' }),
    }))
    expect(chat.submit).not.toHaveBeenCalled()
  })

  it('keeps the reply when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    await userEvent.click(screen.getAllByRole('button', { name: '删除这一轮问答' })[1])
    expect(chat.client.threads.getState).not.toHaveBeenCalled()
    expect(screen.getByText('Unneeded summary')).toBeInTheDocument()
  })

  it('preserves the reply and reports failure instead of hiding it', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409 }))
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    await userEvent.click(screen.getAllByRole('button', { name: '删除这一轮问答' })[1])
    expect(await screen.findByRole('alert')).toHaveTextContent('内容仍保留')
    expect(screen.getByText('Unneeded summary')).toBeInTheDocument()
  })

  it('puts a delete control on every bubble and card, all removing the same turn', async () => {
    chat.messages = [
      { id: 'question', type: 'human', content: '查找近义词请求：\nprovide' },
      { id: 'card', type: 'tool', name: 'present_synonyms', content: JSON.stringify({
        type: 'synonym_comparison', version: 1, source: 'provide',
        shared_meaning: '都与提供有关。', source_distinction: '提供所需。', source_example: 'They provide help.',
        alternatives: [{ term: 'offer', distinction: '主动提出。', example: 'She offered help.' }],
      }) },
      { id: 'reply', type: 'ai', content: '理解逻辑小结' },
    ]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const request = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', request)
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    // 用户提问、近义词卡片、导师回复各有一个垃圾桶。
    const buttons = await screen.findAllByRole('button', { name: '删除这一轮问答' })
    expect(buttons).toHaveLength(3)
    // 点卡片上的垃圾桶也删除整轮（按提问标识），不会留下半轮对话。
    await userEvent.click(buttons[1])
    await waitFor(() => expect(request).toHaveBeenCalledWith(`${LANGGRAPH_URL}/chat/thread-1/turns/question`, expect.objectContaining({ method: 'DELETE' })))
  })

  it('disables deletion while a response is streaming', () => {
    chat.isLoading = true
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    for (const button of screen.getAllByRole('button', { name: '删除这一轮问答' })) expect(button).toBeDisabled()
  })
})

describe('Mentor image messages', () => {
  const png = () => new File(['image bytes'], 'notes.png', { type: 'image/png' })
  const renderChat = () => render(<MemoryRouter><ChatPage /></MemoryRouter>)

  it('sends text and one selected image to the mentor as multimodal content', async () => {
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    expect(await screen.findByRole('img', { name: '待发送图片' })).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: '输入问题' }), 'Explain this sentence')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(chat.submit).toHaveBeenCalledOnce())
    expect(chat.submit).toHaveBeenCalledWith({ messages: [{ type: 'human', content: [
      { type: 'text', text: 'Explain this sentence' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=' } },
    ] }] }, { config: { configurable: { user_id: 'reader', supabase_token: 'token' } }, onError: expect.any(Function) })
    expect(screen.queryByRole('img', { name: '待发送图片' })).not.toBeInTheDocument()
  })

  it('sends an image without typed text and shows the image when restoring a thread', async () => {
    chat.messages = [{ id: 'user-image', type: 'human', content: [
      { type: 'text', text: 'Explain the English in this image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=' } },
    ] }]
    renderChat()
    expect(screen.getByRole('img', { name: '已发送图片' })).toHaveAttribute('src', 'data:image/png;base64,aW1hZ2UgYnl0ZXM=')
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(chat.submit).toHaveBeenCalledOnce())
    expect(chat.submit.mock.calls[0][0].messages[0].content[0]).toEqual({ type: 'text', text: '请讲解这张图片中的英语内容。' })
  })

  it('rejects unsupported or oversized images before submitting', async () => {
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), new File(['x'], 'notes.svg', { type: 'image/svg+xml' }), { applyAccept: false })
    expect(screen.getByRole('alert')).toHaveTextContent('PNG、JPEG 或 WebP')
    await userEvent.upload(screen.getByLabelText('选择图片'), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))
    expect(screen.getByRole('alert')).toHaveTextContent('2 MB')
    expect(chat.submit).not.toHaveBeenCalled()
  })

  it('accepts a pasted screenshot supplied as a clipboard item', async () => {
    renderChat()
    fireEvent.paste(screen.getByRole('textbox', { name: '输入问题' }), {
      clipboardData: { files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: png }] },
    })
    expect(await screen.findByRole('img', { name: '待发送图片' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
  })

  it('shows a processing indicator while a pasted image is being read and blocks sending until ready', async () => {
    const readers: { onload: (() => void) | null; result: string; readAsDataURL: () => void }[] = []
    class DeferredReader {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      result = 'data:image/png;base64,aW1hZ2UgYnl0ZXM='
      readAsDataURL() { readers.push(this) }
    }
    vi.stubGlobal('FileReader', DeferredReader)
    renderChat()
    await userEvent.type(screen.getByRole('textbox', { name: '输入问题' }), 'Help')
    fireEvent.paste(screen.getByRole('textbox', { name: '输入问题' }), {
      clipboardData: { files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: png }] },
    })
    expect(screen.getByRole('status')).toHaveTextContent('正在处理图片')
    expect(screen.queryByRole('img', { name: '待发送图片' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('textbox', { name: '输入问题' }).closest('form')!)
    expect(chat.submit).not.toHaveBeenCalled()
    act(() => { readers[0].onload?.() })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '待发送图片' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
  })

  it('clears the processing indicator and reports image read failure', async () => {
    const readers: { onerror: (() => void) | null; readAsDataURL: () => void }[] = []
    class FailingReader {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      readAsDataURL() { readers.push(this) }
    }
    vi.stubGlobal('FileReader', FailingReader)
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    expect(screen.getByRole('status')).toHaveTextContent('正在处理图片')
    act(() => { readers[0].onerror?.() })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('图片读取失败')
    expect(chat.submit).not.toHaveBeenCalled()
  })

  it('does not keep an older image when a replacement image is invalid', async () => {
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    expect(await screen.findByRole('img', { name: '待发送图片' })).toBeInTheDocument()
    await userEvent.upload(screen.getByLabelText('选择图片'), new File(['x'], 'bad.svg', { type: 'image/svg+xml' }), { applyAccept: false })
    expect(screen.getByRole('alert')).toHaveTextContent('PNG、JPEG 或 WebP')
    expect(screen.queryByRole('img', { name: '待发送图片' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  })

  it('does not attach an image after the user replaces it before the read completes', async () => {
    const readers: { onload: (() => void) | null; result: string | null; readAsDataURL: () => void }[] = []
    class DeferredReader {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      result: string | null = 'data:image/png;base64,aW1hZ2UgYnl0ZXM='
      readAsDataURL() { readers.push(this) }
    }
    vi.stubGlobal('FileReader', DeferredReader)
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    await userEvent.upload(screen.getByLabelText('选择图片'), new File(['x'], 'bad.svg', { type: 'image/svg+xml' }), { applyAccept: false })
    act(() => { readers[0].onload?.() })
    expect(screen.queryByRole('img', { name: '待发送图片' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  })

  it('opens a larger preview on thumbnail click and closes it without removing the attachment', async () => {
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    await userEvent.click(screen.getByRole('button', { name: '放大图片' }))
    const preview = screen.getByRole('dialog', { name: '图片预览' })
    expect(preview).toBeInTheDocument()
    expect(preview.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,aW1hZ2UgYnl0ZXM=')
    expect(preview.querySelector('img')).toHaveClass('max-h-[85dvh]')
    expect(chat.submit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '关闭图片预览' }))
    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '放大图片' })).toHaveFocus()
    expect(screen.getByRole('img', { name: '待发送图片' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '放大图片' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '待发送图片' })).toBeInTheDocument()
  })

  it('can remove a selected image before sending', async () => {
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    expect(await screen.findByRole('img', { name: '待发送图片' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '移除图片' }))
    expect(screen.queryByRole('img', { name: '待发送图片' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
  })

  it('keeps the draft when a running submission is stopped', async () => {
    let finish!: () => void
    chat.submit.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    await userEvent.type(screen.getByRole('textbox', { name: '输入问题' }), 'Help')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(screen.getByRole('textbox', { name: '输入问题' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '停止' }))
    finish()
    await waitFor(() => expect(screen.getByRole('textbox', { name: '输入问题' })).toBeEnabled())
    expect(screen.getByRole('img', { name: '待发送图片' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '输入问题' })).toHaveValue('Help')
  })

  it('keeps the draft when the stream reports a failed model run without rejecting submit', async () => {
    chat.submit.mockImplementation(async (_input, options) => { options.onError?.(new Error('vision unsupported')) })
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    await userEvent.type(screen.getByRole('textbox', { name: '输入问题' }), 'Help')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('导师回复未能完成')
    expect(screen.getByRole('img', { name: '待发送图片' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '输入问题' })).toHaveValue('Help')
  })

  it('keeps the image and question available when an image submission fails', async () => {
    chat.submit.mockRejectedValue(new Error('unsupported image'))
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    await userEvent.type(screen.getByRole('textbox', { name: '输入问题' }), 'Help')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('导师回复未能完成')
    expect(screen.getByRole('img', { name: '待发送图片' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '输入问题' })).toHaveValue('Help')
  })

  it('recovers a completed image reply when only the browser stream fails', async () => {
    let finishState!: (value: { values: { messages: typeof chat.messages } }) => void
    chat.threadId = 'thread-1'
    chat.client.threads.getState.mockImplementation(() => new Promise((resolve) => { finishState = resolve }))
    chat.submit.mockImplementation(async (_input, options) => { options.onError?.(new Error('stream disconnected')) })
    renderChat()
    await userEvent.upload(screen.getByLabelText('选择图片'), png())
    await userEvent.type(screen.getByRole('textbox', { name: '输入问题' }), 'Explain probabilistic')
    await userEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByRole('status')).toHaveTextContent('正在同步导师已完成的回复')

    chat.messages = [
      { id: 'human-1', type: 'human', content: 'Explain probabilistic' },
      { id: 'ai-1', type: 'ai', content: 'Probabilistic means based on likelihood, not certainty.' },
    ]
    finishState({ values: { messages: chat.messages } })

    expect(await screen.findByText(/based on likelihood/)).toBeInTheDocument()
    expect(screen.queryByText(/导师回复未能完成/)).toBeNull()
    expect(screen.queryByRole('img', { name: '待发送图片' })).toBeNull()
  })
})

describe('Markdown approval', () => {
  it('previews the requested document and blocks ordinary submit until reviewed', async () => {
    openApproval()
    expect(screen.getByText('lesson-0.md')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lesson' })).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: '输入问题' }), 'Hello')
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    fireEvent.submit(screen.getByRole('textbox', { name: '输入问题' }).closest('form')!)
    expect(chat.submit).not.toHaveBeenCalled()
  })

  it('approves every action in order using the pending interrupt and current identity', async () => {
    openApproval(2)
    chat.respondAll.mockResolvedValue(undefined)
    await userEvent.click(screen.getByRole('button', { name: '批准创建' }))
    expect(chat.respondAll).toHaveBeenCalledWith({ 'approval-1': { decisions: [{ type: 'approve' }, { type: 'approve' }] } }, {
      config: { configurable: { user_id: 'reader', supabase_token: 'token' } },
    })
  })

  it('sends explicit rejection feedback instead of executing or creating a new run', async () => {
    openApproval()
    chat.respondAll.mockResolvedValue(undefined)
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
    const decision = chat.respondAll.mock.calls[0][0]['approval-1'].decisions[0]
    expect(decision.type).toBe('reject')
    expect(decision.message).toContain('不要重试')
    expect(chat.submit).not.toHaveBeenCalled()
  })

  it('can reject a malformed tool proposal without approving it', async () => {
    chat.interrupts = [{ id: 'malformed', value: {
      action_requests: [{ name: 'create_markdown', args: { filename: 'lesson.md' } }],
    } }]
    chat.respondAll.mockResolvedValue(undefined)
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: '批准创建' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
    expect(chat.respondAll.mock.calls[0][0].malformed.decisions[0].type).toBe('reject')
  })

  it('keeps approval controls usable after a failed resume', async () => {
    openApproval()
    chat.respondAll.mockRejectedValue(new Error('offline'))
    await userEvent.click(screen.getByRole('button', { name: '批准创建' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('审批提交失败')
    expect(screen.getByRole('button', { name: '批准创建' })).toBeEnabled()
  })

  it('disables duplicate approval submissions while a response is pending', async () => {
    openApproval()
    let finish!: () => void
    chat.respondAll.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    await userEvent.click(screen.getByRole('button', { name: '批准创建' }))
    expect(screen.getByRole('button', { name: '拒绝' })).toBeDisabled()
    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: '拒绝' })).toBeEnabled())
  })

  it('restores the pending approval when returning to a saved thread', () => {
    const view = openApproval()
    view.unmount()
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: '批准创建' })).toBeInTheDocument()
  })
})

describe('Markdown preview', () => {
  function renderDocument() {
    chat.messages = [{ id: 'result', type: 'tool', name: 'create_markdown', content: JSON.stringify({
      type: 'markdown_artifact', artifact_id: 'a'.repeat(64), filename: 'lesson.md',
    }) }]
    return render(<MemoryRouter><ChatPage /></MemoryRouter>)
  }

  it('opens the saved document in a read-only dialog from its filename and closes with Escape', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '# Present perfect\n\n**Completed** actions.' })
    vi.stubGlobal('fetch', fetch)
    renderDocument()
    await userEvent.click(screen.getByRole('button', { name: '预览 lesson.md' }))
    const dialog = await screen.findByRole('dialog', { name: 'lesson.md' })
    expect(dialog).toHaveClass('w-[85vw]')
    expect(dialog).not.toHaveClass('max-w-5xl')
    expect(dialog).toHaveTextContent('Completed actions.')
    expect(screen.getByRole('heading', { name: 'Present perfect' })).toBeInTheDocument()
    expect(dialog.querySelector('textarea')).toBeNull()
    expect(fetch).toHaveBeenCalledWith(`${LANGGRAPH_URL.replace(/\/$/, '')}/artifacts/${'a'.repeat(64)}/download`, {
      headers: { Authorization: 'Bearer token' }, signal: expect.any(AbortSignal),
    })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '预览 lesson.md' })).toHaveFocus()
  })

  it('shows loading immediately, allows closing, and aborts the pending preview request', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      signal = options.signal
      return new Promise(() => {})
    }))
    renderDocument()
    await userEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('正在加载文档…')
    await userEvent.click(screen.getByRole('button', { name: '关闭预览' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(signal?.aborted).toBe(true)
  })

  it('shows a failed preview and lets the reader retry without regenerating the document', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, text: async () => '# Saved lesson' })
    vi.stubGlobal('fetch', fetch)
    renderDocument()
    await userEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('预览加载失败')
    await userEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByRole('heading', { name: 'Saved lesson' })).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(chat.submit).not.toHaveBeenCalled()
  })

  it('renders raw HTML as text instead of creating executable preview content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<script>alert(1)</script>\n\n# Safe title' }))
    renderDocument()
    await userEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(await screen.findByRole('heading', { name: 'Safe title' })).toBeInTheDocument()
    expect(screen.getByRole('dialog').querySelector('script')).toBeNull()
  })
})

describe('Markdown download', () => {
  it('downloads the approved artifact with the user token as a Markdown attachment', async () => {
    const id = 'a'.repeat(64)
    chat.messages = [{ id: 'result', type: 'tool', name: 'create_markdown', content: JSON.stringify({
      type: 'markdown_artifact', artifact_id: id, filename: 'lesson.md', download_path: `/artifacts/${id}/download`,
    }) }]
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['# Lesson']) })
    vi.stubGlobal('fetch', fetch)
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    let downloadedFilename: string | undefined
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilename = this.download
    })
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '下载 lesson.md' }))
    expect(fetch).toHaveBeenCalledWith(`${LANGGRAPH_URL.replace(/\/$/, '')}/artifacts/${id}/download`, {
      headers: { Authorization: 'Bearer token' },
    })
    expect(click).toHaveBeenCalledOnce()
    expect(downloadedFilename).toBe('lesson.md')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test')
  })

  it('shows a download error without pretending the file was retrieved', async () => {
    chat.messages = [{ id: 'result', type: 'tool', name: 'create_markdown', content: JSON.stringify({
      type: 'markdown_artifact', artifact_id: 'a'.repeat(64), filename: 'lesson.md',
    }) }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<MemoryRouter><ChatPage /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: '下载 lesson.md' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('下载失败')
  })
})
