// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter } from 'react-router-dom'

import { parseCollectionDoc } from '../lib/collection-document'
import { collectionWeekForDate, collectionWeeksInMonth, formatCollectionWeekRange } from '../lib/collection-weeks'
import type { CollectionRow } from '../lib/supabase'

const auth = vi.hoisted(() => ({ user: { id: 'reader' } as { id: string } | null, supabaseReady: true }))
const db = vi.hoisted(() => ({ archive: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), saveSummary: vi.fn() }))

vi.mock('../lib/auth', () => ({ useAuth: () => ({ ...auth, signOut: vi.fn() }) }))
vi.mock('../lib/collections', () => ({
  listCollectionArchive: db.archive,
  listCollectionsForWeek: db.list,
  createCollection: db.create,
  updateCollection: db.update,
  deleteCollection: db.remove,
  saveCollectionWeekSummary: db.saveSummary,
}))
vi.mock('../components/CollectionEditor', () => ({
  CollectionEditor: ({ initialDoc, onChange, disabled }: { initialDoc: { content: { content?: { text: string }[] }[] } | null; onChange: (doc: unknown) => void; disabled?: boolean }) => (
    <textarea aria-label="收藏正文" disabled={disabled} defaultValue={initialDoc?.content.map((p) => p.content?.map((n) => n.text).join('') ?? '').join('\n') ?? ''}
      onChange={(event) => {
        const text = event.target.value
        const content = { type: 'doc', content: text.split('\n').map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) }
        onChange(parseCollectionDoc(content) ? content : null)
      }} />
  ),
}))
vi.mock('../components/AuthGate', () => ({ AuthGate: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@langchain/react', () => ({ useStream: () => ({ messages: [], values: {}, isLoading: false }) }))

import App from '../App'
import { CollectionsPage } from './CollectionsPage'

const currentWeek = collectionWeekForDate(new Date())
const monthWeeks = collectionWeeksInMonth(currentWeek.year, currentWeek.month)
const doc = { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Agent notes' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Saved text', marks: [{ type: 'highlight', attrs: { color: '#bbf7d0' } }] }] }] }
const row: CollectionRow = { id: 'one', user_id: 'reader', week_key: currentWeek.key, content_text: 'Agent notes\nSaved text', content_doc: doc, created_at: '2026-10-15T12:00:00Z', updated_at: '2026-10-15T12:00:00Z' }

function view() { return render(<MemoryRouter><CollectionsPage /></MemoryRouter>) }

beforeEach(() => {
  auth.user = { id: 'reader' }
  auth.supabaseReady = true
  db.archive.mockResolvedValue({ counts: { [currentWeek.key]: 1 }, summaries: { [currentWeek.key]: 'This week I understood proactive agents.' }, unassignedCount: 0 })
  db.list.mockResolvedValue([row])
  db.create.mockResolvedValue(row)
  db.update.mockResolvedValue(row)
  db.remove.mockResolvedValue(undefined)
  db.saveSummary.mockResolvedValue({ user_id: 'reader', week_key: currentWeek.key, summary: 'Updated summary', created_at: '', updated_at: '' })
})

afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('weekly collections', () => {
  it('shows configuration and sign-in states without querying data', () => {
    auth.supabaseReady = false
    view()
    expect(screen.getByText(/未配置 Supabase/)).toBeInTheDocument()
    cleanup()
    auth.supabaseReady = true
    auth.user = null
    view()
    expect(screen.getByText(/请先登录/)).toBeInTheDocument()
    expect(db.archive).not.toHaveBeenCalled()
  })

  it('shows a compact week archive, summary, and full article content', async () => {
    view()
    expect(await screen.findByText('Agent notes')).toBeInTheDocument()
    expect(screen.getByText('Saved text')).toBeInTheDocument()
    expect(screen.getByText('This week I understood proactive agents.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '周分类' })).toHaveClass('border-b')
    const selectedWeek = screen.getByRole('button', { name: new RegExp(currentWeek.key) })
    expect(selectedWeek).toHaveAttribute('aria-pressed', 'true')
    expect(within(selectedWeek).getByText(`W${currentWeek.index}`)).toBeInTheDocument()
    expect(within(selectedWeek).getByText(formatCollectionWeekRange(currentWeek, true))).toBeInTheDocument()
    expect(within(selectedWeek).getByText('1', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '显示全部' })).toBeNull()
    expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
  })

  it('keeps zero-article weeks available and loads one directly', async () => {
    db.archive.mockResolvedValue({ counts: {}, summaries: {}, unassignedCount: 2 })
    db.list.mockResolvedValue([])
    view()
    const emptyWeek = monthWeeks.find((week) => week.key !== currentWeek.key)!
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(`${emptyWeek.key}.*0 篇`) }))
    await waitFor(() => expect(db.list).toHaveBeenCalledWith(emptyWeek.key))
    expect(screen.getByRole('heading', { name: emptyWeek.key })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑总结' })).toBeInTheDocument()
    expect(screen.queryByText('还没有本周总结，点击记录这一周的理解。')).toBeNull()
    expect(screen.getByText('本周还没有收藏')).toBeInTheDocument()
  })

  it('jumps directly to a month from the month picker', async () => {
    db.archive.mockResolvedValue({ counts: {}, summaries: {}, unassignedCount: 0 })
    db.list.mockResolvedValue([])
    view()
    await userEvent.click(screen.getByRole('button', { name: new RegExp(`选择月份，当前 ${currentWeek.year} 年 ${currentWeek.month} 月`) }))
    const picker = screen.getByRole('dialog', { name: '选择月份' })
    expect(within(picker).getByRole('spinbutton', { name: '年份' })).toHaveValue(currentWeek.year)
    const destinationMonth = currentWeek.month === 1 ? 2 : 1
    await userEvent.click(within(picker).getByRole('button', { name: new RegExp(`^${destinationMonth} 月$`) }))
    await waitFor(() => expect(db.archive).toHaveBeenCalledWith(currentWeek.year, destinationMonth))
    expect(screen.queryByRole('dialog', { name: '选择月份' })).toBeNull()
    expect(screen.getByRole('button', { name: new RegExp(`选择月份，当前 ${currentWeek.year} 年 ${destinationMonth} 月`) })).toBeInTheDocument()
  })

  it('creates an article in the selected week and derives text from the document', async () => {
    db.list.mockResolvedValue([])
    view()
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    expect(screen.getByRole('combobox', { name: '周分类' })).toHaveValue(currentWeek.key)
    const save = screen.getByRole('button', { name: '保存收藏' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'New insight' } })
    await userEvent.click(save)
    await waitFor(() => expect(db.create).toHaveBeenCalledWith('reader', 'New insight', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New insight' }] }] }, currentWeek.key))
    expect(screen.queryByRole('dialog', { name: '记录新发现' })).toBeNull()
  })

  it('moves an existing article to another week from the editor', async () => {
    const destination = monthWeeks.find((week) => week.key !== currentWeek.key)!
    db.update.mockResolvedValue({ ...row, week_key: destination.key })
    view()
    await userEvent.click(await screen.findByRole('button', { name: '编辑收藏' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '周分类' }), destination.key)
    await userEvent.click(screen.getByRole('button', { name: '保存收藏' }))
    await waitFor(() => expect(db.update).toHaveBeenCalledWith('one', 'reader', 'Agent notes\nSaved text', doc, destination.key))
  })

  it('edits and persists the selected week summary', async () => {
    view()
    await userEvent.click(await screen.findByRole('button', { name: '编辑总结' }))
    const field = screen.getByRole('textbox', { name: '本周总结' })
    expect(field).toHaveValue('This week I understood proactive agents.')
    await userEvent.clear(field)
    await userEvent.type(field, 'Updated summary')
    await userEvent.click(screen.getByRole('button', { name: '保存总结' }))
    await waitFor(() => expect(db.saveSummary).toHaveBeenCalledWith('reader', currentWeek.key, 'Updated summary'))
    expect(await screen.findByText('Updated summary')).toBeInTheDocument()
  })

  it('requires confirmation before deleting an article', async () => {
    view()
    await userEvent.click(await screen.findByRole('button', { name: '删除收藏' }))
    expect(db.remove).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(db.remove).toHaveBeenCalledWith('one', 'reader'))
  })

  it('keeps malformed stored documents inaccessible', async () => {
    db.list.mockResolvedValue([{ ...row, content_doc: { type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] } }])
    view()
    expect(await screen.findByText(/内容格式无效/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑收藏' })).toBeNull()
    expect(document.querySelector('script')).toBeNull()
  })

  it('renders all collection section blocks in the expanded article', async () => {
    db.list.mockResolvedValue([{ ...row, content_doc: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Opening note' }] },
      { type: 'horizontalRule' },
      { type: 'sectionDivider', attrs: { title: 'Agent architecture' } },
      { type: 'summaryBlock', attrs: { color: 'rose' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Weekly conclusion' }] }] },
    ] } }])
    view()
    expect(await screen.findByText('Agent architecture')).toBeInTheDocument()
    expect(screen.getByText('Weekly conclusion').closest('aside')).toHaveClass('border-rose-500', 'bg-rose-50/80')
    expect(screen.getByLabelText('收藏预览').querySelector('hr')).not.toBeNull()
  })

  it('collapses stacked empty paragraphs from pasted content so the preview has no oversized gaps', async () => {
    db.list.mockResolvedValue([{ ...row, content_doc: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First block' }] },
      { type: 'paragraph' },
      { type: 'paragraph' },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second block' }] },
    ] } }])
    view()
    const preview = await screen.findByLabelText('收藏预览')
    expect(within(preview).getByText('First block')).toBeInTheDocument()
    expect(within(preview).getByText('Second block')).toBeInTheDocument()
    // 三个连续空段落只保留一个空的 <p>，不应该把全部空段落都渲染出来。
    const paragraphs = Array.from(preview.querySelectorAll('p'))
    const emptyParagraphs = paragraphs.filter((p) => p.textContent === '')
    expect(emptyParagraphs).toHaveLength(1)
  })

  it('closes a changed draft on cancel without another confirmation', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'Unsaved' } })
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '记录新发现' })).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(db.create).not.toHaveBeenCalled()
  })

  it('closes a changed draft on Escape without another confirmation', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    fireEvent.change(screen.getByRole('textbox', { name: '收藏正文' }), { target: { value: 'Unsaved' } })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '记录新发现' })).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('keeps a new draft open after Command+S and updates it on the next save', async () => {
    db.list.mockResolvedValue([])
    view()
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    const input = screen.getByRole('textbox', { name: '收藏正文' })
    fireEvent.change(input, { target: { value: 'Keyboard insight' } })
    expect(fireEvent.keyDown(input, { key: 's', metaKey: true, cancelable: true })).toBe(false)
    await waitFor(() => expect(db.create).toHaveBeenCalledWith('reader', 'Keyboard insight', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keyboard insight' }] }] }, currentWeek.key))
    expect(await screen.findByRole('dialog', { name: '编辑收藏' })).toBeInTheDocument()
    expect(input).toHaveValue('Keyboard insight')
    fireEvent.change(input, { target: { value: 'More insight' } })
    fireEvent.keyDown(input, { key: 's', metaKey: true, cancelable: true })
    await waitFor(() => expect(db.update).toHaveBeenCalledWith('one', 'reader', 'More insight', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'More insight' }] }] }, currentWeek.key))
    expect(db.create).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: '编辑收藏' })).toBeInTheDocument()
  })

  it('keeps an edited draft open after Command+S', async () => {
    view()
    await userEvent.click(await screen.findByRole('button', { name: '编辑收藏' }))
    const input = screen.getByRole('textbox', { name: '收藏正文' })
    fireEvent.change(input, { target: { value: 'Revised insight' } })
    fireEvent.keyDown(input, { key: 's', metaKey: true, cancelable: true })
    await waitFor(() => expect(db.update).toHaveBeenCalledWith('one', 'reader', 'Revised insight', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Revised insight' }] }] }, currentWeek.key))
    expect(screen.getByRole('dialog', { name: '编辑收藏' })).toBeInTheDocument()
    expect(input).toHaveValue('Revised insight')
  })

  it('still closes the editor when clicking save after a shortcut save', async () => {
    view()
    await userEvent.click(await screen.findByRole('button', { name: '编辑收藏' }))
    const input = screen.getByRole('textbox', { name: '收藏正文' })
    fireEvent.change(input, { target: { value: 'Revised insight' } })
    fireEvent.keyDown(input, { key: 's', metaKey: true, cancelable: true })
    await waitFor(() => expect(db.update).toHaveBeenCalledTimes(1))
    await userEvent.click(screen.getByRole('button', { name: '保存收藏' }))
    await waitFor(() => expect(db.update).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog', { name: '编辑收藏' })).toBeNull()
  })

  it('does not save an empty draft with Command+S', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: '新增收藏' }))
    const input = screen.getByRole('textbox', { name: '收藏正文' })
    expect(fireEvent.keyDown(input, { key: 's', metaKey: true, cancelable: true })).toBe(false)
    expect(db.create).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '记录新发现' })).toBeInTheDocument()
  })

  it('exposes the collection route in the application shell', async () => {
    render(<MemoryRouter initialEntries={['/collections']}><App /></MemoryRouter>)
    expect(screen.getByRole('link', { name: '我的收藏' })).toHaveAttribute('href', '/collections')
    expect(await screen.findByRole('heading', { name: '我的收藏' })).toBeInTheDocument()
  })
})
