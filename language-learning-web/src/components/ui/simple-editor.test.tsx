// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { SimpleEditor } from './simple-editor'
import { PaletteHighlight } from './palette-highlight'
import { parseCollectionDoc } from '../../lib/collection-document'

const textColors = [{ name: '靛蓝', color: '#476996' }]
const backgroundColors = [{ name: '暖黄', color: '#fff3d6' }]
const props = { label: '复用文本编辑器', initialContent: null, textColors, backgroundColors, placeholder: '写一些文字…', onChange: vi.fn() }

beforeAll(() => {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null } as unknown as DOMRectList)
  Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0 } as DOMRect)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('shared simple editor', () => {
  it('offers only supported text/color actions in a compact toolbar', () => {
    render(<SimpleEditor {...props} />)
    expect(screen.getByRole('toolbar', { name: '文本格式' })).toHaveClass('max-h-[35vh]', 'overflow-y-auto')
    expect(screen.getByLabelText('常用排版')).toBeInTheDocument()
    expect(screen.getByLabelText('结构与颜色')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '段落样式' })).toContainElement(screen.getByRole('button', { name: '正文' }))
    expect(screen.getByRole('group', { name: '内容结构' })).toContainElement(screen.getByRole('button', { name: '插入小结区块' }))
    expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重做' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '文字颜色 靛蓝' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '背景颜色 暖黄' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '背景颜色 白色' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /图片|表格|AI/ })).toBeNull()
    expect(screen.getByRole('textbox', { name: '复用文本编辑器' })).toBeInTheDocument()
    expect(screen.getByText('写一些文字…')).toBeInTheDocument()
  })

  it('applies heading, quote and lists with real toolbar controls', async () => {
    const onChange = vi.fn()
    render(<SimpleEditor {...props} initialContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Example' }] }] }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '标题 2' }))
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Example')
    expect(parseCollectionDoc(onChange.mock.lastCall?.[0])).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '正文' }))
    fireEvent.click(screen.getByRole('button', { name: '无序列表' }))
    expect(screen.getByRole('list')).toHaveTextContent('Example')
    expect(parseCollectionDoc(onChange.mock.lastCall?.[0])).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '无序列表' }))
    fireEvent.click(screen.getByRole('button', { name: '引用' }))
    expect(document.querySelector('blockquote')).toHaveTextContent('Example')
  })

  it('exposes supported inline formatting and alignment actions', () => {
    render(<SimpleEditor {...props} initialContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Example' }] }] }} />)
    for (const name of ['粗体', '斜体', '下划线', '删除线', '左对齐', '居中对齐', '右对齐', '有序列表']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: '居中对齐' }))
    expect(screen.getByRole('textbox', { name: '复用文本编辑器' }).querySelector('p')).toHaveStyle({ textAlign: 'center' })
  })

  it('formats newly entered text with selected inline marks and preserves a valid document', async () => {
    const onChange = vi.fn()
    render(<SimpleEditor {...props} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '粗体' }))
    fireEvent.paste(screen.getByRole('textbox', { name: '复用文本编辑器' }), { clipboardData: { getData: () => 'Important' } })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(screen.getByRole('textbox', { name: '复用文本编辑器' }).querySelector('strong')).toHaveTextContent('Important')
    expect(parseCollectionDoc(onChange.mock.lastCall?.[0])).not.toBeNull()
  })

  it('retains all plain-text lines when pasting inside a list', async () => {
    const onChange = vi.fn()
    const item = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Existing' }] }] }] }] }
    render(<SimpleEditor {...props} initialContent={item} onChange={onChange} />)
    const editor = screen.getByRole('textbox', { name: '复用文本编辑器' })
    fireEvent.paste(editor, { clipboardData: { getData: () => '<b>First</b>\nSecond' } })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(editor.textContent).toContain('<b>First</b>')
    expect(editor.textContent).toContain('Second')
    expect(parseCollectionDoc(onChange.mock.lastCall?.[0])).not.toBeNull()
  })

  it('uses larger, matching type for editor text and its empty placeholder', () => {
    render(<SimpleEditor {...props} />)
    const content = screen.getByRole('textbox', { name: '复用文本编辑器' }).parentElement
    expect(content).toHaveClass('text-lg', 'leading-8')
    expect(screen.getByText('写一些文字…')).toHaveClass('text-lg', 'leading-8')
  })

  it('visually distinguishes headings, lists, quotes and links in the editing area', () => {
    render(<SimpleEditor {...props} />)
    const content = screen.getByRole('textbox', { name: '复用文本编辑器' }).parentElement
    expect(content).toHaveClass('[&_h1]:text-3xl', '[&_ul]:list-disc', '[&_blockquote]:border-l-2', '[&_a]:underline')
  })

  it('inserts plain and titled section dividers as valid structured nodes', async () => {
    const onChange = vi.fn()
    render(<SimpleEditor {...props} initialContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }] }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '插入分隔线' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '复用文本编辑器' }).querySelector('hr[data-collection-divider]')).not.toBeNull())
    expect(parseCollectionDoc(onChange.mock.lastCall?.[0])).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '插入带标题分节' }))
    fireEvent.change(screen.getByRole('textbox', { name: '分节标题' }), { target: { value: 'Agent architecture' } })
    fireEvent.click(screen.getByRole('button', { name: '插入分节' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '复用文本编辑器' }).querySelector('[data-collection-section]')).toHaveTextContent('Agent architecture'))
    expect(parseCollectionDoc(onChange.mock.lastCall?.[0])).not.toBeNull()
  })

  it('inserts a summary block and changes its stored color', async () => {
    const onChange = vi.fn()
    const summary = { type: 'doc', content: [{ type: 'summaryBlock', attrs: { color: 'blue' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Weekly understanding' }] }] }] }
    render(<SimpleEditor {...props} initialContent={summary} onChange={onChange} />)
    expect(screen.getByRole('group', { name: '小结区块颜色' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '小结区块颜色 玫瑰' }))
    await waitFor(() => expect(onChange.mock.lastCall?.[0].content[0].attrs.color).toBe('rose'))
    expect(parseCollectionDoc(onChange.mock.lastCall?.[0])).not.toBeNull()
    expect(screen.getByRole('textbox', { name: '复用文本编辑器' }).querySelector('aside[data-color="rose"]')).not.toBeNull()
  })

  it('places the caret inside a newly inserted visible summary block', async () => {
    const onChange = vi.fn()
    render(<SimpleEditor {...props} initialContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Source' }] }] }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '插入小结区块' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: '复用文本编辑器' }).querySelector('aside[data-collection-summary]')).toHaveTextContent('小结：'))
    expect(screen.getByRole('group', { name: '小结区块颜色' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '小结区块颜色 蓝色' })).toHaveAttribute('aria-pressed', 'true')
    expect(parseCollectionDoc(onChange.mock.lastCall?.[0])).not.toBeNull()
  })

  it('validates a titled section before insertion', () => {
    render(<SimpleEditor {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '插入带标题分节' }))
    fireEvent.click(screen.getByRole('button', { name: '插入分节' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入分节标题')
    expect(screen.getByRole('textbox', { name: '复用文本编辑器' }).querySelector('[data-collection-section]')).toBeNull()
  })

  it('uses an approved color for the Tiptap highlight shortcut', () => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text, PaletteHighlight], content: '<p>Important</p>' })
    editor.commands.setTextSelection({ from: 1, to: 10 })
    const key = new KeyboardEvent('keydown', { key: 'H', code: 'KeyH', shiftKey: true, ctrlKey: true, bubbles: true, cancelable: true })
    Object.defineProperty(key, 'keyCode', { value: 72 })
    const handled = editor.view.someProp('handleKeyDown', (handler) => handler(editor.view, key))
    expect(handled).toBe(true)
    expect(parseCollectionDoc(editor.getJSON())).not.toBeNull()
    expect(editor.getJSON().content?.[0]?.content?.[0]?.marks).toContainEqual({ type: 'highlight', attrs: { color: '#fff3d6' } })
    editor.destroy()
  })

  it('blocks unsafe link input before writing the document', async () => {
    const onChange = vi.fn()
    render(<SimpleEditor {...props} initialContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Read me' }] }] }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '插入链接' }))
    fireEvent.change(screen.getByRole('textbox', { name: '链接地址' }), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: '应用链接' }))
    expect(screen.getByRole('alert')).toHaveTextContent('http')
    expect(screen.getByRole('textbox', { name: '复用文本编辑器' }).querySelector('a')).toBeNull()
    expect(onChange.mock.calls.every((call) => parseCollectionDoc(call[0]) !== null)).toBe(true)
  })

  it('emits structured text on plain text paste without interpreting markup', async () => {
    const onChange = vi.fn()
    render(<SimpleEditor {...props} onChange={onChange} />)
    const editor = screen.getByRole('textbox', { name: '复用文本编辑器' })
    fireEvent.paste(editor, { clipboardData: { getData: (format: string) => format === 'text/plain' ? '<script>bad()</script>\nNext' : '<b>HTML</b>' } })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.lastCall?.[0].content.map((p: { content?: { text: string }[] }) => p.content?.[0]?.text)).toEqual(['<script>bad()</script>', 'Next'])
    expect(editor.querySelector('script')).toBeNull()
  })

  it('keeps angle brackets literally when pasting a single line', async () => {
    const onChange = vi.fn()
    render(<SimpleEditor {...props} initialContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] }] }} onChange={onChange} />)
    const editor = screen.getByRole('textbox', { name: '复用文本编辑器' })
    fireEvent.paste(editor, { clipboardData: { getData: () => '<p>hello</p><span style="color:red">red</span>' } })
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(editor.textContent).toContain('<p>hello</p><span style="color:red">red</span>')
    expect(editor.querySelector('span[style*="color: red"]')).toBeNull()
  })

  it('undoes and redoes pasted text with functional toolbar buttons', async () => {
    render(<SimpleEditor {...props} />)
    const editor = screen.getByRole('textbox', { name: '复用文本编辑器' })
    fireEvent.paste(editor, { clipboardData: { getData: () => 'A sentence' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '撤销' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(editor).not.toHaveTextContent('A sentence'))
    fireEvent.click(screen.getByRole('button', { name: '重做' }))
    await waitFor(() => expect(editor).toHaveTextContent('A sentence'))
  })

  it.each([false, true])('treats Enter with shiftKey=%s as a newline, never a submit', async (shiftKey) => {
    const onChange = vi.fn()
    render(<SimpleEditor {...props} initialContent={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }] }} onChange={onChange} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: '复用文本编辑器' }), { key: 'Enter', shiftKey })
    await waitFor(() => expect(onChange.mock.lastCall?.[0].content).toHaveLength(2))
  })
})
