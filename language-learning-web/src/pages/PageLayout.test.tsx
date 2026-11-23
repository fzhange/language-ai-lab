// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { HighlightRow } from '../lib/supabase'

const auth = vi.hoisted(() => ({ user: { id: 'reader' } as { id: string } | null, supabaseReady: true }))
const highlights = vi.hoisted(() => ({
  rows: [{ id: 'one', user_id: 'reader', page_url: 'https://example.com', page_title: 'Example',
    exact: 'An important sentence.', color: '#ffddcc', note: 'A note', insight: '', prefix: '', suffix: '' }] as HighlightRow[],
  sortColumns: [] as string[],
}))

Element.prototype.scrollIntoView = vi.fn()

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ ...auth, accessToken: 'token', loading: false }),
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        is: () => ({
          order: (column: string) => {
            highlights.sortColumns.push(column)
            return {
              order: (nextColumn: string) => {
                highlights.sortColumns.push(nextColumn)
                return { range: (start: number, end: number) => Promise.resolve({ data: highlights.rows.slice(start, end + 1), error: null }) }
              },
              range: (start: number, end: number) => Promise.resolve({ data: highlights.rows.slice(start, end + 1), error: null }),
              limit: () => Promise.resolve({ data: highlights.rows.slice(0, 200), error: null }),
            }
          },
        }),
      }),
    }),
  },
}))

import { AuthGate } from '../components/AuthGate'
import { MarkdownView } from '../components/MarkdownView'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { HighlightsPage } from './HighlightsPage'
import { NotesPage } from './NotesPage'
import App from '../App'

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  auth.user = { id: 'reader' }
  auth.supabaseReady = true
  highlights.rows = [{ id: 'one', user_id: 'reader', page_url: 'https://example.com', page_title: 'Example',
    exact: 'An important sentence.', color: '#ffddcc', note: 'A note', insight: '', prefix: '', suffix: '' }]
  highlights.sortColumns.length = 0
  vi.unstubAllEnvs()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

function makeHighlight(id: string, overrides: Partial<HighlightRow> = {}): HighlightRow {
  return { id, user_id: 'reader', page_url: 'https://example.com/a', page_title: 'Shared title', exact: 'Forget',
    color: '#ffddcc', note: '', insight: '', prefix: '', suffix: '', created_at: '2025-01-02T12:00:00', ...overrides }
}

function renderPage(page: ReactNode) {
  render(<MemoryRouter>{page}</MemoryRouter>)
}

function CurrentLocation() {
  const location = useLocation()
  return <span data-testid="location">{location.pathname + location.search}</span>
}

describe('note selection persistence', () => {
  it('opens the knowledge base from the home route with three navigation entries', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.endsWith('/notes')
      ? { ok: true, json: async () => [{ path: 'one.md', title: 'One' }] }
      : { ok: true, text: async () => '# A note' })))
    render(<MemoryRouter initialEntries={['/']}><App /><CurrentLocation /></MemoryRouter>)
    expect(await screen.findByRole('article')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/notes')
    expect(within(screen.getByRole('navigation', { name: '主导航' })).getAllByRole('link')).toHaveLength(3)
  })

  it('keeps the selected note in the URL and restores it after a reload', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.endsWith('/notes')
      ? { ok: true, json: async () => [{ path: 'one.md', title: 'First' }, { path: 'tech/26M10.md', title: 'Second' }] }
      : { ok: true, text: async () => url.includes('26M10') ? '# Second note' : '# First note' })))
    const user = userEvent.setup()
    const view = render(<MemoryRouter initialEntries={['/notes']}><NotesPage /><CurrentLocation /></MemoryRouter>)

    await user.click(await screen.findByRole('button', { name: '26M10.md' }))
    expect(await screen.findByRole('heading', { name: 'Second note' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/notes?note=tech%2F26M10.md')

    view.unmount()
    render(<MemoryRouter initialEntries={['/notes?note=tech%2F26M10.md']}><NotesPage /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: '26M10.md' })).toHaveClass('bg-accent')
    expect(await screen.findByRole('heading', { name: 'Second note' })).toBeInTheDocument()
  })

  it('falls back to the first note for an outdated URL', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.endsWith('/notes')
      ? { ok: true, json: async () => [{ path: 'one.md', title: 'First' }] }
      : { ok: true, text: async () => '# First note' })))
    render(<MemoryRouter initialEntries={['/notes?note=missing.md']}><NotesPage /><CurrentLocation /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: 'one.md' })).toHaveClass('bg-accent')
    expect(await screen.findByRole('heading', { name: 'First note' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/notes?note=one.md')
  })
})

describe('notes sidebar resizing', () => {
  function renderNotes() {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.endsWith('/notes')
      ? { ok: true, json: async () => [{ path: 'one.md', title: 'One' }] }
      : { ok: true, text: async () => '# A note' })))
    return render(<MemoryRouter><NotesPage /></MemoryRouter>)
  }

  it('resizes by dragging and restores the saved width on a later visit', async () => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      pointerId: number
      constructor(type: string, init: PointerEventInit) {
        super(type, init)
        this.pointerId = init.pointerId ?? 0
      }
    })
    const view = renderNotes()
    const handle = await screen.findByRole('separator', { name: '调整知识目录宽度' })
    vi.spyOn(handle.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 800, left: 0 } as DOMRect)
    const capture = vi.fn()
    handle.setPointerCapture = capture

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 256 })
    expect(capture).toHaveBeenCalledWith(1)
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 400 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(handle).toHaveAttribute('aria-valuenow', '400')
    expect(window.localStorage.getItem('notes-sidebar-width')).toBe('400')

    view.unmount()
    renderNotes()
    expect(await screen.findByRole('separator', { name: '调整知识目录宽度' })).toHaveAttribute('aria-valuenow', '400')
  })

  it('limits keyboard resizing to the space available for the article', async () => {
    renderNotes()
    const handle = await screen.findByRole('separator', { name: '调整知识目录宽度' })
    vi.spyOn(handle.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 600, left: 0 } as DOMRect)
    handle.focus()
    await userEvent.keyboard('{End}')
    expect(handle).toHaveAttribute('aria-valuenow', '272')
    await userEvent.keyboard('{ArrowLeft}')
    expect(handle).toHaveAttribute('aria-valuenow', '256')
    await userEvent.keyboard('{Home}')
    expect(handle).toHaveAttribute('aria-valuenow', '192')
    expect(window.localStorage.getItem('notes-sidebar-width')).toBe('192')
  })

  it('ignores an invalid saved width', async () => {
    window.localStorage.setItem('notes-sidebar-width', 'not-a-number')
    renderNotes()
    expect(await screen.findByRole('separator', { name: '调整知识目录宽度' })).toHaveAttribute('aria-valuenow', '256')
  })

  it('clamps a restored width without losing the preference on a narrower screen', async () => {
    window.localStorage.setItem('notes-sidebar-width', '400')
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, left: 0 } as DOMRect)
    renderNotes()
    const handle = await screen.findByRole('separator', { name: '调整知识目录宽度' })
    await waitFor(() => expect(handle).toHaveAttribute('aria-valuenow', '272'))
    expect(window.localStorage.getItem('notes-sidebar-width')).toBe('400')
    handle.focus()
    await userEvent.keyboard('{ArrowRight}{End}')
    expect(handle).toHaveAttribute('aria-valuenow', '272')
    expect(window.localStorage.getItem('notes-sidebar-width')).toBe('400')

    measure.mockReturnValue({ width: 800, left: 0 } as DOMRect)
    fireEvent(window, new Event('resize'))
    expect(handle).toHaveAttribute('aria-valuenow', '400')
  })
})

describe('page readability', () => {
  it.each([
    ['highlights', HighlightsPage, '我的高亮'],
  ])('%s uses the wider content area and larger page heading', async (_page, Page, title) => {
    renderPage(<Page />)
    const heading = await screen.findByRole('heading', { name: title })
    expect(heading).toHaveClass('text-xl')
    expect(heading.closest('.mx-auto')).toHaveClass('max-w-[96rem]', 'px-4', 'sm:px-6')
  })

  it('makes note reading content wider and easier to read', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(url.endsWith('/notes')
      ? { ok: true, json: async () => [{ path: 'one.md', title: 'One' }] }
      : { ok: true, text: async () => '# A note\n\nAn explanation.' })))
    renderPage(<NotesPage />)
    const article = await screen.findByRole('article')
    expect(article).toHaveClass('px-4', 'sm:px-6')
    expect(article.firstElementChild).toHaveClass('max-w-[96rem]', 'sm:px-6')
    await screen.findByText('An explanation.')
    expect(article.querySelector('.prose-lg')).toHaveClass('mx-auto', 'max-w-6xl')
  })

  it('keeps forms comfortably sized on desktop and scales rendered markdown', () => {
    render(<><Input aria-label="topic" /><Textarea aria-label="essay" /><MarkdownView>Example note</MarkdownView></>)
    expect(screen.getByRole('textbox', { name: 'topic' })).toHaveClass('text-base')
    expect(screen.getByRole('textbox', { name: 'topic' })).not.toHaveClass('md:text-sm')
    expect(screen.getByRole('textbox', { name: 'essay' })).not.toHaveClass('md:text-sm')
    expect(screen.getByText('Example note').parentElement).not.toHaveClass('prose-sm')
  })

  it('enlarges login form text without stretching the login card', () => {
    auth.user = null
    render(<AuthGate><div>Signed in</div></AuthGate>)
    expect(screen.getByText('邮箱')).toHaveClass('text-base')
    expect(screen.getByText('邮箱').closest('.max-w-sm')).not.toBeNull()
  })
})

describe('highlight organization', () => {
  it('keeps the compact header and search on one desktop row with tabs below', async () => {
    highlights.rows = [makeHighlight('a')]
    renderPage(<HighlightsPage />)
    const tools = await screen.findByRole('region', { name: '高亮浏览工具' })
    const heading = within(tools).getByRole('heading', { name: '我的高亮' })
    const search = within(tools).getByRole('searchbox', { name: '搜索高亮' })
    expect(tools).toHaveClass('p-4', 'sm:p-5')
    const toolbarRow = heading.closest('.lg\\:flex-row')
    expect(toolbarRow).toContainElement(search)
    expect(toolbarRow).toHaveClass('flex-col', 'lg:flex-row')
    expect(within(tools).queryByText('快速查找')).not.toBeInTheDocument()
    expect(within(tools).getByText('1 条')).toBeInTheDocument()
    const tabs = within(tools).getByRole('tablist', { name: '高亮查看方式' })
    expect(tabs).toHaveClass('mt-3', 'grid', 'grid-cols-2', 'sm:grid-cols-4')
    expect(within(tabs).getAllByRole('tab')).toHaveLength(4)
  })

  it('searches only highlighted text, ignoring case and surrounding whitespace', async () => {
    highlights.rows = [
      makeHighlight('a', { exact: 'MORTALITY', note: 'definition' }),
      makeHighlight('b', { exact: 'stems', note: 'mortality', page_title: 'mortality journal' }),
      makeHighlight('c', { exact: 'immortality', page_url: 'https://example.com/mortality' }),
    ]
    renderPage(<HighlightsPage />)
    const search = await screen.findByRole('searchbox', { name: '搜索高亮' })
    await userEvent.type(search, '  MoRtAlItY  ')
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getAllByRole('listitem')).toHaveLength(2)
    expect(within(panel).getByText('MORTALITY')).toBeInTheDocument()
    expect(within(panel).getByText('immortality')).toBeInTheDocument()
    expect(within(panel).queryByText('stems')).not.toBeInTheDocument()
    expect(screen.getByText('3 条')).toBeInTheDocument()
    expect(screen.getByText('找到 2 条')).toBeInTheDocument()
  })

  it('keeps search active when switching views and counts matching highlights in frequency view', async () => {
    highlights.rows = [
      makeHighlight('a', { exact: 'Remember' }),
      makeHighlight('b', { exact: ' remember ', page_url: 'https://example.com/b' }),
      makeHighlight('c', { exact: 'Forget', note: 'remember' }),
    ]
    renderPage(<HighlightsPage />)
    const search = await screen.findByRole('searchbox', { name: '搜索高亮' })
    await userEvent.type(search, 'remember')
    const user = userEvent.setup()
    for (const tab of ['按标题', '按时间', '高亮频次']) {
      await user.click(screen.getByRole('tab', { name: tab }))
      expect(search).toHaveValue('remember')
      expect(screen.getByText('找到 2 条')).toBeInTheDocument()
      expect(within(screen.getByRole('tabpanel')).queryByText('Forget')).not.toBeInTheDocument()
    }
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText('2 次')).toBeInTheDocument()
    expect(within(panel).getByText('1 条不同的高亮')).toBeInTheDocument()
  })

  it('shows no-results feedback and lets the reader clear the search', async () => {
    highlights.rows = [makeHighlight('a', { exact: 'stems' })]
    renderPage(<HighlightsPage />)
    const search = await screen.findByRole('searchbox', { name: '搜索高亮' })
    await userEvent.type(search, 'missing')
    expect(screen.getByText('找到 0 条')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByText('没有找到匹配的高亮')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '清空搜索' }))
    expect(search).toHaveValue('')
    expect(within(screen.getByRole('tabpanel')).getByText('stems')).toBeInTheDocument()
  })

  it('groups the same title from different URLs while keeping each original source link', async () => {
    highlights.rows = [
      makeHighlight('a'),
      makeHighlight('b', { page_url: 'https://example.com/b', exact: 'Remember' }),
    ]
    const user = userEvent.setup()
    renderPage(<HighlightsPage />)
    expect(await screen.findByRole('tab', { name: '按网址' })).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getAllByRole('heading', { name: 'Shared title' })).toHaveLength(2)
    expect(screen.getByText('https://example.com/a')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/b')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '按标题' }))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getAllByRole('heading', { name: 'Shared title' })).toHaveLength(1)
    expect(within(panel).getAllByRole('listitem')).toHaveLength(2)
    expect(within(panel).getAllByRole('link', { name: /来源/ }).map((link) => link.getAttribute('href')))
      .toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(within(panel).getByText('https://example.com/a')).toBeInTheDocument()
    expect(within(panel).getByText('https://example.com/b')).toBeInTheDocument()
  })

  it('keeps the URL group header and links each highlight from its top-right corner', async () => {
    highlights.rows = [
      makeHighlight('a', { exact: 'First phrase' }),
      makeHighlight('b', { exact: 'Second phrase' }),
    ]
    renderPage(<HighlightsPage />)
    const panel = await screen.findByRole('tabpanel')
    const heading = within(panel).getByRole('heading', { name: 'Shared title' })
    expect(within(heading).getByRole('link')).toHaveAttribute('href', 'https://example.com/a')
    expect(within(panel).getByText('https://example.com/a')).toBeInTheDocument()
    for (const phrase of ['First phrase', 'Second phrase']) {
      const item = within(panel).getByText(phrase).closest('li')!
      const source = within(item).getByRole('link', { name: /来源/ })
      expect(source).toHaveAttribute('href', 'https://example.com/a')
      expect(source).toHaveTextContent('打开原网页')
      expect(source).toHaveAttribute('title', 'https://example.com/a')
      expect(within(item).getByText(phrase).closest('p')?.parentElement).toContainElement(source)
      expect(source).toHaveClass('sm:ml-auto')
    }
  })

  it('places each source link beside its highlight on desktop and below it on narrow screens', async () => {
    highlights.rows = [makeHighlight('a', {
      exact: 'Saved phrase', note: 'Reading note',
      page_url: 'https://example.com/a/very/long/source/path',
    })]
    renderPage(<HighlightsPage />)
    const user = userEvent.setup()
    for (const tab of ['按标题', '按时间']) {
      await user.click(await screen.findByRole('tab', { name: tab }))
      const item = within(screen.getByRole('tabpanel')).getByRole('listitem')
      const phrase = within(item).getByText('Saved phrase')
      const source = within(item).getByRole('link', { name: /来源/ })
      expect(source).toHaveAttribute('href', 'https://example.com/a/very/long/source/path')
      expect(source).toHaveAttribute('title', 'https://example.com/a/very/long/source/path')
      expect(phrase.closest('p')?.parentElement).toContainElement(source)
      expect(phrase.closest('p')?.parentElement).toHaveClass('flex-col', 'sm:flex-row')
      expect(source.querySelector('span')).toHaveClass('truncate')
      expect(within(item).getByText('Reading note')).toBeInTheDocument()
    }
  })

  it('groups highlights by their local calendar day, including missing dates', async () => {
    highlights.rows = [
      makeHighlight('a'),
      makeHighlight('b', { created_at: '2025-01-02T18:00:00' }),
      makeHighlight('c', { created_at: '2025-01-03T12:00:00' }),
      makeHighlight('d', { created_at: undefined }),
    ]
    const user = userEvent.setup()
    renderPage(<HighlightsPage />)
    await user.click(await screen.findByRole('tab', { name: '按时间' }))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getAllByRole('heading', { name: /2025年1月2日/ })).toHaveLength(1)
    expect(within(panel).getByRole('heading', { name: '未知日期' })).toBeInTheDocument()
    expect(within(panel).getAllByRole('listitem')).toHaveLength(4)
  })

  it('counts entire selected text ignoring case and surrounding whitespace, not words in sentences', async () => {
    highlights.rows = [
      makeHighlight('a'),
      makeHighlight('b', { exact: ' forget ', page_url: 'https://example.com/b' }),
      makeHighlight('c', { exact: 'Forget?' }),
      makeHighlight('d', { exact: 'I forget too' }),
    ]
    const user = userEvent.setup()
    renderPage(<HighlightsPage />)
    await user.click(await screen.findByRole('tab', { name: '高亮频次' }))
    const items = within(screen.getByRole('tabpanel')).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Forget')
    expect(items[0]).toHaveTextContent('2 次')
    expect(items[1]).toHaveTextContent('Forget?')
    expect(items[2]).toHaveTextContent('I forget too')
    await user.click(within(items[0]).getByText('Forget'))
    expect(within(items[0]).getAllByRole('link', { name: /来源/ }).map((link) => link.getAttribute('href')))
      .toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('shows each occurrence’s saved context, note, and insight inside the selected frequency row', async () => {
    highlights.rows = [
      makeHighlight('a', { prefix: 'Before ', suffix: ' after.', note: '**Remember this**', insight: 'Often confused with recall' }),
      makeHighlight('b', { exact: ' forget ', page_url: 'https://example.com/b', note: 'Second note' }),
    ]
    const user = userEvent.setup()
    renderPage(<HighlightsPage />)
    await user.click(await screen.findByRole('tab', { name: '高亮频次' }))
    const row = within(screen.getByRole('tabpanel')).getByRole('listitem')
    expect(within(row).queryByText('Remember this')).not.toBeInTheDocument()
    await user.click(within(row).getByText('Forget'))
    expect(within(row).getByText('Before')).toBeInTheDocument()
    expect(within(row).getByText('after.')).toBeInTheDocument()
    expect(within(row).getByText('Remember this')).toBeInTheDocument()
    expect(within(row).getByText('Often confused with recall')).toBeInTheDocument()
    expect(within(row).getByText('Second note')).toBeInTheDocument()
    expect(within(row).getAllByRole('link', { name: /来源/ })).toHaveLength(2)
  })

  it('preserves the original punctuation and spacing around a saved selection', async () => {
    highlights.rows = [makeHighlight('a', { exact: '世界', prefix: '你好', suffix: '！' })]
    const user = userEvent.setup()
    renderPage(<HighlightsPage />)
    await user.click(await screen.findByRole('tab', { name: '高亮频次' }))
    await user.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: /世界/ }))
    const mark = within(screen.getByRole('tabpanel')).getByText('世界', { selector: 'mark' })
    expect(mark.parentElement).toHaveTextContent('你好世界！')
  })

  it('opens a note-free selection with keyboard and shows its source without empty note labels', async () => {
    highlights.rows = [makeHighlight('a', { exact: 'No notes here', prefix: '', suffix: '', note: '', insight: '' })]
    const user = userEvent.setup()
    renderPage(<HighlightsPage />)
    await user.click(await screen.findByRole('tab', { name: '高亮频次' }))
    const row = within(screen.getByRole('tabpanel')).getByRole('listitem')
    const toggle = within(row).getByRole('button', { name: /No notes here/ })
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(row).getByRole('link', { name: /来源/ })).toHaveAttribute('href', 'https://example.com/a')
    expect(within(row).queryByText('笔记')).not.toBeInTheDocument()
    expect(within(row).queryByText('心得')).not.toBeInTheDocument()
  })

  it('counts beyond the old 200-row limit and retrieves further database pages', async () => {
    highlights.rows = Array.from({ length: 1001 }, (_, index) => makeHighlight(String(index)))
    const user = userEvent.setup()
    renderPage(<HighlightsPage />)
    await user.click(await screen.findByRole('tab', { name: '高亮频次' }))
    expect(within(screen.getByRole('tabpanel')).getByText('1001 次')).toBeInTheDocument()
    expect(screen.getByText('1001 条')).toBeInTheDocument()
    expect(highlights.sortColumns).toEqual(['created_at', 'id', 'created_at', 'id'])
  }, 15000)

  it('buckets UTC timestamps by the reader’s local calendar day', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    highlights.rows = [
      makeHighlight('late', { created_at: '2025-01-03T03:00:00Z' }),
      makeHighlight('early', { created_at: '2025-01-02T04:00:00Z' }),
    ]
    renderPage(<HighlightsPage />)
    await userEvent.setup().click(await screen.findByRole('tab', { name: '按时间' }))
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: '2025年1月2日' })).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByRole('heading', { name: '2025年1月1日' })).toBeInTheDocument()
  })
})
