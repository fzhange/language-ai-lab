// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'
import type { CollectionRow } from '../lib/supabase'
import { parseCollectionDoc } from '../lib/collection-document'

const auth = vi.hoisted(() => ({ user: { id: 'reader' } as { id: string } | null, supabaseReady: true }))
const db = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
}))
vi.mock('../lib/auth', () => ({ useAuth: () => ({ ...auth, signOut: vi.fn() }) }))
vi.mock('../lib/collections', () => ({
  listCollections: db.list, createCollection: db.create, updateCollection: db.update, deleteCollection: db.remove,
}))
vi.mock('../components/CollectionEditor', () => ({
  CollectionEditor: ({ initialDoc, onChange, disabled }: { initialDoc: { content: { content?: { text: string }[] }[] } | null; onChange: (doc: unknown, text: string) => void; disabled?: boolean }) => (
    <textarea aria-label="收藏正文" disabled={disabled} defaultValue={initialDoc?.content.map((p) => p.content?.map((n) => n.text).join('') ?? '').join('\n') ?? ''}
      onChange={(event) => {
        const text = event.target.value
        const content = { type: 'doc', content: text.split('\n').map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) }
        onChange(parseCollectionDoc(content) ? content : null, 'not authoritative')
      }} />
  ),
}))
vi.mock('../components/AuthGate', () => ({ AuthGate: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@langchain/react', () => ({ useStream: () => ({ messages: [], values: {}, isLoading: false }) }))

import App from '../App'
import { CollectionsPage } from './CollectionsPage'

const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Saved text', marks: [{ type: 'textStyle', attrs: { color: '#2563eb' } }] }] }] }
const row: CollectionRow = { id: 'one', user_id: 'reader', content_text: 'Saved text', content_doc: doc, created_at: '2026-01-01T12:00:00Z', updated_at: '2026-01-01T12:00:00Z' }

function view() { return render(<MemoryRouter><CollectionsPage /></MemoryRouter>) }
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.resetAllMocks(); auth.user = { id: 'reader' }; auth.supabaseReady = true })

describe('my collections', () => {
  it('shows configuration and sign-in states without querying collections', () => {
    auth.supabaseReady = false
    view()
    expect(screen.getByText(/未配置 Supabase/)).toBeInTheDocument()
    cleanup()
    auth.supabaseReady = true
    auth.user = null
    view()
    expect(screen.getByText(/请先登录/)).toBeInTheDocument()
    expect(db.list).not.toHaveBeenCalled()
  })

  it('opens a modal while keeping the empty state behind it', async () => {
    db.list.mockResolvedValue([])
    view()
    expect(await screen.findByText('还没有收藏')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    expect(screen.getByRole('dialog', { name: '记录新发现' })).toHaveClass('w-[90vw]', 'h-[85vh]')
    expect(screen.getByText(/Enter 与 Shift \+ Enter 换行 · 点击保存收藏/)).toBeInTheDocument()
    expect(screen.getByText('还没有收藏')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('还没有收藏')).toBeInTheDocument()
  })

  it('uses the wider page area and consistent responsive side gutters', async () => {
    db.list.mockResolvedValue([row])
    view()
    const page = (await screen.findByRole('heading', { name: '我的收藏' })).closest('.mx-auto')
    expect(page).toHaveClass('max-w-[96rem]', 'px-4', 'sm:px-6')
  })

  it('places each collection in its own full-width row', async () => {
    db.list.mockResolvedValue([row, { ...row, id: 'two' }])
    view()
    const list = await screen.findByRole('list', { name: '收藏列表' })
    expect(list).toHaveClass('flex', 'flex-col')
    expect(list.children).toHaveLength(2)
    expect(Array.from(list.children).every((item) => item.tagName === 'LI')).toBe(true)
  })

  it('collapses a long collection and lets readers show all and collapse it again', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(320)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(176)
    db.list.mockResolvedValue([row])
    view()
    const preview = await screen.findByLabelText('收藏预览')
    const showAll = screen.getByRole('button', { name: '显示全部' })
    const region = document.getElementById(showAll.getAttribute('aria-controls') ?? '')
    expect(region).toContainElement(preview)
    expect(region).toHaveClass('max-h-44', 'overflow-hidden')
    expect(showAll).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(showAll)
    expect(region).not.toHaveClass('max-h-44')
    const collapse = screen.getByRole('button', { name: '收起' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(collapse)
    expect(region).toHaveClass('max-h-44')
    expect(screen.getByRole('button', { name: '显示全部' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('does not show expansion controls for a short collection', async () => {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(80)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(176)
    db.list.mockResolvedValue([row])
    view()
    await screen.findByLabelText('收藏预览')
    expect(screen.queryByRole('button', { name: '显示全部' })).toBeNull()
    expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
  })

  it('loads a page and reveals the next 50 entries on demand', async () => {
    db.list.mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => ({ ...row, id: `entry-${i}` }))).mockResolvedValueOnce([row])
    view()
    await waitFor(() => expect(screen.getAllByText('Saved text')).toHaveLength(50))
    await userEvent.click(screen.getByRole('button', { name: '加载更多' }))
    await waitFor(() => expect(db.list).toHaveBeenCalledWith({ created_at: row.created_at, id: 'entry-49' }, 50))
    expect(screen.getAllByText('Saved text')).toHaveLength(51)
  })

  it('creates nonempty text from the document and keeps edits on a failed save', async () => {
    db.list.mockResolvedValue([])
    db.create.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce(row)
    view()
    await screen.findByText(/还没有收藏/)
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    const save = screen.getByRole('button', { name: '保存收藏' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: '  ' } })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'New text' } })
    await userEvent.click(save)
    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('network error')
    expect(screen.getByRole('dialog', { name: '记录新发现' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '收藏正文' })).toHaveValue('New text')
    expect(db.create).toHaveBeenCalledWith('reader', 'New text', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New text' }] }] })
    await userEvent.click(save)
    await waitFor(() => expect(db.create).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('textbox', { name: '收藏正文' })).toBeNull()
  })

  it('does not submit on Enter and saves only from the button', async () => {
    db.list.mockResolvedValue([])
    db.create.mockResolvedValue(row)
    view()
    await screen.findByText(/还没有收藏/)
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'Keyboard text' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: '收藏正文' }), { key: 'Enter' })
    expect(db.create).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '保存收藏' }))
    await waitFor(() => expect(db.create).toHaveBeenCalledWith('reader', 'Keyboard text', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keyboard text' }] }] }))
    expect(db.create).toHaveBeenCalledTimes(1)
  })

  it('edits existing formatted text without losing the document structure', async () => {
    db.list.mockResolvedValue([row])
    db.update.mockResolvedValue(row)
    view()
    await userEvent.click(await screen.findByRole('button', { name: '编辑收藏' }))
    expect(screen.getByRole('dialog', { name: '编辑收藏' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '收藏正文' })).toHaveValue('Saved text')
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'Revised' } })
    await userEvent.click(screen.getByRole('button', { name: '保存收藏' }))
    await waitFor(() => expect(db.update).toHaveBeenCalledWith('one', 'reader', 'Revised', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Revised' }] }] }))
  })

  it('requires explicit confirmation and reports stale deletions', async () => {
    db.list.mockResolvedValue([row])
    db.remove.mockRejectedValue(new Error('收藏不存在或无权操作。'))
    view()
    await userEvent.click(await screen.findByRole('button', { name: '删除收藏' }))
    expect(db.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '取消删除' }))
    expect(db.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '删除收藏' }))
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('收藏不存在')
    expect(db.remove).toHaveBeenCalledWith('one', 'reader')
  })

  it('flags malformed stored formatting without rendering it as HTML', async () => {
    db.list.mockResolvedValue([{ ...row, content_doc: { type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] } }])
    view()
    expect(await screen.findByText(/内容格式无效/)).toBeInTheDocument()
    expect(document.querySelector('script[src="javascript:alert(1)"]')).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑收藏' })).toBeNull()
  })

  it('previews supported heading, alignment, quote, nested lists, marks and safe links', async () => {
    const rich = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'Lesson' }] },
      { type: 'paragraph', content: [
        { type: 'text', text: 'Emphasis', marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }] },
        { type: 'text', text: ' Guide', marks: [{ type: 'link', attrs: { href: 'https://example.org/guide', target: '_blank', rel: 'noopener noreferrer' } }] },
      ] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Word' }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meaning' }] }] }] },
      ] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Remember' }] }] },
    ] }
    db.list.mockResolvedValue([{ ...row, content_doc: rich }])
    view()
    const heading = await screen.findByRole('heading', { name: 'Lesson', level: 2 })
    expect(heading).toHaveStyle({ textAlign: 'center' })
    expect(heading).toHaveClass('text-xl')
    const link = screen.getByRole('link', { name: 'Guide' })
    expect(link).toHaveAttribute('href', 'https://example.org/guide')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('Emphasis').closest('strong')?.querySelector('em u s')).toBeTruthy()
    expect(document.querySelector('ul li ol li')).toHaveTextContent('Meaning')
    expect(document.querySelector('blockquote')).toHaveTextContent('Remember')
  })

  it('keeps unsafe links or excessively nested records inaccessible', async () => {
    const badLink = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }
    let deep: unknown = { type: 'paragraph', content: [{ type: 'text', text: 'deep' }] }
    for (let index = 0; index < 20; index++) deep = { type: 'blockquote', content: [deep] }
    db.list.mockResolvedValue([{ ...row, content_doc: badLink }, { ...row, id: 'two', content_doc: { type: 'doc', content: [deep] } }])
    view()
    expect(await screen.findAllByText(/内容格式无效/)).toHaveLength(2)
    expect(screen.queryByRole('link', { name: 'click' })).toBeNull()
  })

  it('disables save for a formatting-only collection', async () => {
    db.list.mockResolvedValue([{ ...row, content_doc: { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '  ' }] }] } }])
    view()
    await userEvent.click(await screen.findByRole('button', { name: '编辑收藏' }))
    expect(screen.getByRole('button', { name: '保存收藏' })).toBeDisabled()
  })

  it('prevents saving a stale draft when visible editor content becomes invalid', async () => {
    db.list.mockResolvedValue([row])
    view()
    await userEvent.click(await screen.findByRole('button', { name: '编辑收藏' }))
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'Draft' } })
    expect(screen.getByRole('button', { name: '保存收藏' })).toBeEnabled()
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'x'.repeat(100_001) } })
    expect(screen.getByRole('button', { name: '保存收藏' })).toBeDisabled()
    expect(await screen.findByRole('alert')).toHaveTextContent('格式')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('removes previous account data immediately on identity change even if the next load fails', async () => {
    db.list.mockResolvedValueOnce([row]).mockRejectedValueOnce(new Error('offline'))
    const rendered = view()
    expect(await screen.findByText('Saved text')).toBeInTheDocument()
    auth.user = { id: 'another-reader' }
    rendered.rerender(<MemoryRouter><CollectionsPage /></MemoryRouter>)
    expect(screen.queryByText('Saved text')).toBeNull()
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    expect(screen.queryByText('Saved text')).toBeNull()
  })

  it('asks before discarding edits and resets the next draft', async () => {
    db.list.mockResolvedValue([])
    view()
    await screen.findByText(/还没有收藏/)
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'Old draft' } })
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: '放弃未保存的修改？' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.getByRole('textbox', { name: '收藏正文' })).toHaveValue('Old draft')
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    expect(screen.getByRole('textbox', { name: '收藏正文' })).toHaveValue('')
    expect(screen.getByRole('button', { name: '保存收藏' })).toBeDisabled()
  })

  it('locks the editor while a save is in flight', async () => {
    db.list.mockResolvedValue([])
    db.create.mockImplementation(() => new Promise(() => {}))
    view()
    await screen.findByText(/还没有收藏/)
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'Unsent text' } })
    await userEvent.click(screen.getByRole('button', { name: '保存收藏' }))
    expect(screen.getByRole('textbox', { name: '收藏正文' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: '记录新发现' })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(db.create).toHaveBeenCalledTimes(1)
  })

  it('keeps a successfully saved item visible if list refresh fails', async () => {
    db.list.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('list offline'))
    db.create.mockResolvedValue({ ...row, id: 'created', content_text: 'New text', content_doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New text' }] }] } })
    view()
    await screen.findByText(/还没有收藏/)
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'New text' } })
    await userEvent.click(screen.getByRole('button', { name: '保存收藏' }))
    expect(await screen.findByText('New text')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('list offline')
  })

  it('removes a successfully deleted item even when list refresh fails', async () => {
    db.list.mockResolvedValueOnce([row]).mockRejectedValueOnce(new Error('list offline'))
    db.remove.mockResolvedValue(undefined)
    view()
    await screen.findByText('Saved text')
    await userEvent.click(screen.getByRole('button', { name: '删除收藏' }))
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(screen.queryByText('Saved text')).toBeNull())
    expect(await screen.findByRole('alert')).toHaveTextContent('list offline')
  })

  it('does not let the initial request overwrite a newer saved item', async () => {
    let resolveInitial!: (value: CollectionRow[]) => void
    db.list.mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve })).mockResolvedValueOnce([{ ...row, id: 'created' }])
    db.create.mockResolvedValue({ ...row, id: 'created' })
    view()
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'Saved text' } })
    await userEvent.click(screen.getByRole('button', { name: '保存收藏' }))
    expect(await screen.findByText('Saved text')).toBeInTheDocument()
    resolveInitial([])
    await waitFor(() => expect(screen.getByText('Saved text')).toBeInTheDocument())
  })

  it('exposes a dedicated collection navigation route', async () => {
    db.list.mockResolvedValue([])
    render(<MemoryRouter initialEntries={['/collections']}><App /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '我的收藏' })).toHaveAttribute('href', '/collections')
    expect(screen.getByRole('link', { name: '我的高亮' })).toHaveAttribute('href', '/highlights')
    expect(screen.getByRole('main').querySelector(':scope > header')).toHaveClass('px-4', 'sm:px-6')
    expect(await screen.findByRole('heading', { name: '我的收藏' })).toBeInTheDocument()
  })
})
