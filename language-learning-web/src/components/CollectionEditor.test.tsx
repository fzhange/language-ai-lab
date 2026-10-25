// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { CollectionEditor } from './CollectionEditor'
import type { CollectionDoc } from '../lib/collection-document'

beforeAll(() => {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null } as unknown as DOMRectList)
  Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 } as DOMRect)
})
afterEach(cleanup)

describe('collection editor', () => {
  it.each([{ label: 'Enter', shiftKey: false }, { label: 'Shift+Enter', shiftKey: true }])('inserts a new paragraph at the caret with $label', async ({ shiftKey }) => {
    const onChange = vi.fn()
    const doc: CollectionDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A sentence' }] }] }
    render(<CollectionEditor initialDoc={doc} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: '收藏内容' }), { key: 'Enter', code: 'Enter', shiftKey })
    await waitFor(() => expect(onChange.mock.lastCall?.[1]).toBe('\nA sentence'))
  })

  it('does not change its document during composition or while disabled', () => {
    const onChange = vi.fn()
    const doc: CollectionDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ready' }] }] }
    const active = render(<CollectionEditor initialDoc={doc} onChange={onChange} />)
    fireEvent(screen.getByRole('textbox', { name: '收藏内容' }), new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }))
    expect(screen.getByRole('textbox', { name: '收藏内容' })).toHaveTextContent('Ready')
    expect(onChange.mock.calls.every((call) => call[1] === 'Ready')).toBe(true)
    active.unmount()
    onChange.mockClear()
    render(<CollectionEditor initialDoc={doc} onChange={onChange} disabled />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: '收藏内容' }), { key: 'Enter', code: 'Enter' })
    expect(screen.getByRole('textbox', { name: '收藏内容' })).toHaveTextContent('Ready')
    expect(onChange.mock.calls.every((call) => call[1] === 'Ready')).toBe(true)
  })

  it('pastes HTML as literal plain text while preserving line breaks', async () => {
    const onChange = vi.fn()
    render(<CollectionEditor initialDoc={null} onChange={onChange} />)
    const editor = screen.getByRole('textbox', { name: '收藏内容' })
    fireEvent.paste(editor, { clipboardData: { getData: (format: string) => format === 'text/plain' ? '<script>alert(1)</script>\nSecond line' : '<img onerror="bad()">' } })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.lastCall?.[1]).toBe('<script>alert(1)</script>\nSecond line')
    expect(editor.querySelector('script')).toBeNull()
    expect(editor.textContent).toContain('<script>alert(1)</script>')
  })

  it('inserts a single pasted line in place without interpreting HTML or adding paragraphs', async () => {
    const onChange = vi.fn()
    render(<CollectionEditor initialDoc={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }} onChange={onChange} />)
    const editor = screen.getByRole('textbox', { name: '收藏内容' })
    fireEvent.paste(editor, { clipboardData: { getData: () => '<b>safe</b>' } })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.lastCall?.[1]).toContain('<b>safe</b>')
    expect(onChange.mock.lastCall?.[0].content).toHaveLength(1)
    expect(editor.querySelector('b')).toBeNull()
  })

  it('shows white as the default background with an explicit white choice and an empty editor hint', () => {
    render(<CollectionEditor initialDoc={null} onChange={vi.fn()} />)
    const white = screen.getByRole('button', { name: '背景颜色 白色' })
    expect(white).toHaveAttribute('aria-pressed', 'true')
    expect(white).toHaveStyle({ backgroundColor: '#ffffff' })
    expect(screen.getByText(/粘贴或输入想收藏的文字/)).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '文字颜色' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '背景颜色' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '收藏内容' })).toHaveClass('min-h-full')
  })

  it('uses clean swatches for the current writing palette', () => {
    render(<CollectionEditor initialDoc={null} onChange={vi.fn()} />)
    const expected = [
      ['文字颜色 墨色', '#1e293b'],
      ['文字颜色 蓝色', '#2563eb'],
      ['文字颜色 莓红', '#be123c'],
      ['文字颜色 绿色', '#15803d'],
    ] as const
    for (const [name, color] of expected) {
      const button = screen.getByRole('button', { name })
      expect(button).not.toHaveTextContent('A')
      expect(button.querySelector('span')).toHaveStyle({ backgroundColor: color })
    }
  })

  it('loads stored selected-word formatting and exposes accessible palette controls', () => {
    const colored: CollectionDoc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Select ', marks: [{ type: 'textStyle', attrs: { color: '#2563eb' } }] },
      { type: 'text', text: 'this', marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }] },
      { type: 'text', text: ' text' },
    ] }] }
    render(<CollectionEditor initialDoc={colored} onChange={vi.fn()} />)
    const editor = screen.getByRole('textbox', { name: '收藏内容' })
    expect(editor).toHaveTextContent('Select this text')
    expect(editor.querySelector('span[style*="color"]')?.textContent).toBe('Select ')
    expect(editor.querySelector('mark')).toHaveTextContent('this')
    expect(screen.getByRole('button', { name: '文字颜色 蓝色' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '背景颜色 黄色' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除选中格式' })).toBeInTheDocument()
  })

  it('switches to markdown mode, edits text, and syncs the parsed document', async () => {
    const onChange = vi.fn()
    const doc: CollectionDoc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] }] }
    render(<CollectionEditor initialDoc={doc} onChange={onChange} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Markdown' }))
    const markdown = screen.getByRole('textbox', { name: '收藏内容（Markdown）' })
    expect(markdown).toHaveValue('## Title')
    await userEvent.type(markdown, '\n\nMore **bold** text')
    await waitFor(() => expect(onChange.mock.lastCall?.[1]).toContain('More bold text'))
    const latestDoc = onChange.mock.lastCall?.[0] as CollectionDoc
    const boldNode = latestDoc.content.flatMap((n) => n.content ?? []).find((n) => n.marks?.some((m) => m.type === 'bold'))
    expect(boldNode?.text).toBe('bold')
  })

  it('round-trips an edit back to the rich-text tab', async () => {
    const onChange = vi.fn()
    render(<CollectionEditor initialDoc={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Start' }] }] }} onChange={onChange} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Markdown' }))
    const markdown = screen.getByRole('textbox', { name: '收藏内容（Markdown）' })
    fireEvent.change(markdown, { target: { value: '# Heading\n\nBody text' } })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('tab', { name: '富文本' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Heading')
    expect(screen.getByRole('textbox', { name: '收藏内容' })).toHaveTextContent('Body text')
  })
})
