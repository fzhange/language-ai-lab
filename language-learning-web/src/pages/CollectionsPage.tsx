import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { Bookmark, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Inbox, Pencil, Plus, Trash2 } from 'lucide-react'
import { Dialog, Popover } from 'radix-ui'

import { CollectionEditor } from '../components/CollectionEditor'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useAuth } from '../lib/auth'
import { collectionPlainText, parseCollectionDoc, parseSafeCollectionUrl, type CollectionDoc, type CollectionNode, type CollectionSummaryColor } from '../lib/collection-document'
import { collectionWeekForDate, collectionWeeksInMonth, formatCollectionWeekRange, parseCollectionWeekKey, shiftCollectionMonth } from '../lib/collection-weeks'
import { createCollection, deleteCollection, listCollectionArchive, listCollectionsForPeriod, listCollectionsForWeek, saveCollectionWeekSummary, updateCollection, type CollectionArchive } from '../lib/collections'
import type { CollectionRow } from '../lib/supabase'

type Draft = { doc: CollectionDoc; text: string }
type EditorState = { id: string | null; initialDoc: CollectionDoc | null; session: number; weekKey: string | null }
type ViewMode = 'week' | 'month' | 'year'
type Scope = { key: string; viewMode: ViewMode; year: number; month: number; selectedWeekKey: string | null }

const EMPTY_ARCHIVE: CollectionArchive = { counts: {}, summaries: {}, unassignedCount: 0 }
const DEFAULT_COLLECTION_WEEK = collectionWeekForDate(new Date())
const MONTH_NAMES = Array.from({ length: 12 }, (_, index) => `${index + 1} 月`)

function previewNode(node: CollectionNode, key: number): ReactNode {
  if (node.type === 'text') {
    let text: ReactNode = node.text ?? ''
    for (const mark of [...(node.marks ?? [])].reverse()) {
      switch (mark.type) {
        case 'bold': text = <strong>{text}</strong>; break
        case 'italic': text = <em>{text}</em>; break
        case 'underline': text = <u>{text}</u>; break
        case 'strike': text = <s>{text}</s>; break
        case 'textStyle': text = <span style={{ color: mark.attrs.color }}>{text}</span>; break
        case 'highlight': text = <mark style={{ backgroundColor: mark.attrs.color }} className="rounded px-0.5">{text}</mark>; break
        case 'link': {
          const href = parseSafeCollectionUrl(mark.attrs.href)
          if (href) text = <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">{text}</a>
          break
        }
      }
    }
    return <Fragment key={key}>{text}</Fragment>
  }
  const children = (node.content ?? []).map(previewNode)
  const align = node.attrs?.textAlign ?? undefined
  const summaryColors: Record<CollectionSummaryColor, string> = {
    blue: 'border-blue-500 bg-blue-50/80',
    green: 'border-emerald-500 bg-emerald-50/80',
    yellow: 'border-amber-500 bg-amber-50/80',
    rose: 'border-rose-500 bg-rose-50/80',
  }
  switch (node.type) {
    case 'paragraph': return <p key={key} style={{ textAlign: align }} className="min-h-7 whitespace-pre-wrap">{children}</p>
    case 'heading': {
      const Tag = `h${node.attrs?.level}` as 'h1' | 'h2' | 'h3'
      const size = node.attrs?.level === 1 ? 'text-2xl' : node.attrs?.level === 2 ? 'text-xl' : 'text-lg'
      return <Tag key={key} style={{ textAlign: align }} className={`mt-3 mb-1 font-semibold leading-snug ${size}`}>{children}</Tag>
    }
    case 'blockquote': return <blockquote key={key} className="my-3 border-l-2 border-primary/60 bg-secondary/50 py-2 pl-4 text-muted-foreground">{children}</blockquote>
    case 'bulletList': return <ul key={key} className="my-2 list-disc space-y-1 pl-6">{children}</ul>
    case 'orderedList': return <ol key={key} start={node.attrs?.start} className="my-2 list-decimal space-y-1 pl-6">{children}</ol>
    case 'listItem': return <li key={key} className="pl-0.5">{children}</li>
    case 'horizontalRule': return <hr key={key} className="my-6 border-0 border-t border-border" />
    case 'sectionDivider': return <div key={key} className="my-6 flex items-center gap-3"><span className="shrink-0 text-sm font-semibold text-primary">{node.attrs?.title}</span><span className="h-px flex-1 bg-border" /></div>
    case 'summaryBlock': return <aside key={key} className={`my-5 space-y-2 border-l-4 px-4 py-3 ${summaryColors[node.attrs?.color ?? 'blue']}`}>{children}</aside>
    default: return null
  }
}

function Preview({ doc }: { doc: CollectionDoc }) {
  // 旧内容可能含有连续多个空段落（如从别处粘贴时每个空行都变成独立段落），只保留一个空段落的间距，避免预览出现异常大的空白。
  const isEmptyParagraph = (node: CollectionNode) => node.type === 'paragraph' && !node.content?.length
  const collapsed = doc.content.filter((node, index) => !(isEmptyParagraph(node) && isEmptyParagraph(doc.content[index - 1])))
  return <div className="space-y-2 break-words text-base leading-7" aria-label="收藏预览">{collapsed.map(previewNode)}</div>
}

function CollectionsView({ user }: { user: User }) {
  const [year, setYear] = useState(DEFAULT_COLLECTION_WEEK.year)
  const [month, setMonth] = useState(DEFAULT_COLLECTION_WEEK.month)
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(DEFAULT_COLLECTION_WEEK.key)
  const [viewMode, setViewMode] = useState<'week' | 'month' | 'year'>('week')
  const [archive, setArchive] = useState<CollectionArchive>(EMPTY_ARCHIVE)
  const [rows, setRows] = useState<CollectionRow[]>([])
  const [loadingArchive, setLoadingArchive] = useState(true)
  const [loadingRows, setLoadingRows] = useState(true)
  const [listError, setListError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [pending, setPending] = useState(false)
  const [editing, setEditing] = useState<EditorState | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [invalidDraft, setInvalidDraft] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [monthPickerOpen, setMonthPickerOpen] = useState(false)
  const [pickerYear, setPickerYear] = useState(DEFAULT_COLLECTION_WEEK.year)
  const busy = useRef(false)
  const session = useRef(0)
  const archiveVersion = useRef(0)
  const rowsVersion = useRef(0)
  // 异步操作（保存/删除）返回时视图可能已经切换，所有“刷新后写回”的动作都要对齐当前视图，
  // 否则会用旧视图的数据覆盖新视图。currentScope 始终指向最新一次渲染的视图。
  const currentScope = useRef<Scope>({ key: '', viewMode, year, month, selectedWeekKey })
  currentScope.current = { key: `${viewMode}:${year}:${month}:${selectedWeekKey}`, viewMode, year, month, selectedWeekKey }
  const weeks = useMemo(() => collectionWeeksInMonth(year, month), [year, month])
  const selectedWeek = selectedWeekKey ? parseCollectionWeekKey(selectedWeekKey) : null
  const selectedSummary = selectedWeekKey ? archive.summaries[selectedWeekKey] ?? '' : ''
  const editingWeek = editing?.weekKey ? parseCollectionWeekKey(editing.weekKey) : null
  const editorWeeks = editingWeek ? collectionWeeksInMonth(editingWeek.year, editingWeek.month) : weeks
  const matchesPeriod = (weekKey: string | null, target: Scope = currentScope.current) => weekKey !== null && weekKey.startsWith(target.viewMode === 'year' ? `${target.year}M` : `${target.year}M${target.month}W`)

  async function refreshArchive() {
    const target = currentScope.current
    const version = ++archiveVersion.current
    setLoadingArchive(true)
    try {
      const next = await listCollectionArchive(target.year, target.month)
      if (version === archiveVersion.current && target.key === currentScope.current.key) {
        setArchive(next)
        setListError('')
      }
    } catch (cause) {
      if (version === archiveVersion.current && target.key === currentScope.current.key) setListError((cause as Error).message)
    } finally {
      if (version === archiveVersion.current) setLoadingArchive(false)
    }
  }

  function loadRows(target: Scope = currentScope.current) {
    if (target.viewMode === 'week') return listCollectionsForWeek(target.selectedWeekKey)
    return target.viewMode === 'month' ? listCollectionsForPeriod(target.year, target.month) : listCollectionsForPeriod(target.year)
  }

  async function refreshRows() {
    const target = currentScope.current
    const version = ++rowsVersion.current
    setLoadingRows(true)
    try {
      const next = await loadRows(target)
      if (version === rowsVersion.current && target.key === currentScope.current.key) {
        setRows(next)
        setListError('')
      }
    } catch (cause) {
      if (version === rowsVersion.current && target.key === currentScope.current.key) setListError((cause as Error).message)
    } finally {
      if (version === rowsVersion.current) setLoadingRows(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const version = ++archiveVersion.current
    if (viewMode !== 'week') {
      setLoadingArchive(false)
      return
    }
    setLoadingArchive(true)
    void listCollectionArchive(year, month)
      .then((next) => {
        if (!cancelled && version === archiveVersion.current) {
          setArchive(next)
          setListError('')
        }
      })
      .catch((cause: Error) => { if (!cancelled && version === archiveVersion.current) setListError(cause.message) })
      .finally(() => { if (!cancelled && version === archiveVersion.current) setLoadingArchive(false) })
    return () => { cancelled = true }
  }, [user.id, year, month, viewMode])

  useEffect(() => {
    let cancelled = false
    const version = ++rowsVersion.current
    const target = currentScope.current
    setLoadingRows(true)
    void loadRows(target)
      .then((next) => {
        if (!cancelled && version === rowsVersion.current && target.key === currentScope.current.key) {
          setRows(next)
          setListError('')
        }
      })
      .catch((cause: Error) => { if (!cancelled && version === rowsVersion.current && target.key === currentScope.current.key) setListError(cause.message) })
      .finally(() => { if (!cancelled && version === rowsVersion.current) setLoadingRows(false) })
    return () => { cancelled = true }
  }, [user.id, selectedWeekKey, year, month, viewMode])

  function showMonth(next: { year: number; month: number }, preferCurrentWeek = false) {
    const nextWeeks = collectionWeeksInMonth(next.year, next.month)
    setYear(next.year)
    setMonth(next.month)
    setSelectedWeekKey(preferCurrentWeek && next.year === DEFAULT_COLLECTION_WEEK.year && next.month === DEFAULT_COLLECTION_WEEK.month
      ? DEFAULT_COLLECTION_WEEK.key
      : nextWeeks[0]?.key ?? null)
    setArchive(EMPTY_ARCHIVE)
    setRows([])
    setLoadingArchive(viewMode === 'week')
    setLoadingRows(true)
    setConfirmId(null)
    setActionError('')
    setActionNotice('')
  }

  function changeMonth(amount: number) {
    showMonth(shiftCollectionMonth(year, month, amount))
  }

  function chooseMonth(nextYear: number, nextMonth: number) {
    if (nextYear !== year || nextMonth !== month) showMonth({ year: nextYear, month: nextMonth })
    setMonthPickerOpen(false)
  }

  function returnToCurrentMonth() {
    showMonth({ year: DEFAULT_COLLECTION_WEEK.year, month: DEFAULT_COLLECTION_WEEK.month }, true)
    setPickerYear(DEFAULT_COLLECTION_WEEK.year)
    setMonthPickerOpen(false)
  }

  function selectWeek(weekKey: string | null) {
    setViewMode('week')
    setSelectedWeekKey(weekKey)
    setRows([])
    setConfirmId(null)
    setLoadingRows(true)
    setActionError('')
    setActionNotice('')
  }

  function selectView(mode: 'week' | 'month' | 'year') {
    if (mode === viewMode) return
    setViewMode(mode)
    setRows([])
    setLoadingRows(true)
    setConfirmId(null)
    setActionError('')
    setActionNotice('')
  }

  function changeYear(amount: number) {
    const nextYear = year + amount
    if (nextYear < 1 || nextYear > 9999) return
    setYear(nextYear)
    setSelectedWeekKey(collectionWeeksInMonth(nextYear, month)[0]?.key ?? null)
    setRows([])
    setLoadingRows(true)
    setConfirmId(null)
    setActionError('')
    setActionNotice('')
  }

  function startNew() {
    setActionError('')
    setActionNotice('')
    setInvalidDraft(false)
    setDraft(null)
    setEditing({ id: null, initialDoc: null, session: ++session.current, weekKey: viewMode === 'week' ? selectedWeekKey : weeks[0]?.key ?? null })
  }

  function startEdit(row: CollectionRow) {
    const doc = parseCollectionDoc(row.content_doc)
    if (!doc) return
    setActionError('')
    setActionNotice('')
    setInvalidDraft(false)
    setDraft({ doc, text: collectionPlainText(doc) })
    setEditing({ id: row.id, initialDoc: doc, session: ++session.current, weekKey: row.week_key })
  }

  function requestClose() {
    if (pending || !editing) return
    setEditing(null)
    setDraft(null)
    setInvalidDraft(false)
    setActionError('')
  }

  async function save(closeAfterSave = true) {
    const doc = draft?.doc
    if (busy.current || !editing || invalidDraft || !doc || !collectionPlainText(doc).trim()) return
    busy.current = true
    setPending(true)
    setActionError('')
    try {
      const text = collectionPlainText(doc)
      const saved = editing.id
        ? await updateCollection(editing.id, user.id, text, doc, editing.weekKey)
        : await createCollection(user.id, text, doc, editing.weekKey)
      if (saved.week_key !== editing.weekKey) {
        setActionNotice(`内容已保存。周分类迁移尚未部署，当前暂按创建日期归入 ${saved.week_key ?? '未分类'}。`)
      }
      const target = currentScope.current
      setRows((current) => (target.viewMode === 'week' ? saved.week_key === target.selectedWeekKey : matchesPeriod(saved.week_key, target))
        ? [saved, ...current.filter((item) => item.id !== saved.id)]
        : current.filter((item) => item.id !== saved.id))
      if (closeAfterSave) {
        setEditing(null)
        setDraft(null)
      } else {
        setEditing((current) => current ? { ...current, id: saved.id, initialDoc: doc } : current)
      }
      if (target.viewMode === 'week') void refreshArchive()
      void refreshRows()
    } catch (cause) {
      setActionError((cause as Error).message)
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  async function remove() {
    if (busy.current || !confirmId) return
    busy.current = true
    setPending(true)
    setActionError('')
    try {
      await deleteCollection(confirmId, user.id)
      const target = currentScope.current
      setRows((current) => current.filter((item) => item.id !== confirmId))
      setConfirmId(null)
      if (target.viewMode === 'week') void refreshArchive()
      void refreshRows()
    } catch (cause) {
      setActionError((cause as Error).message)
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  function openSummary() {
    setSummaryDraft(selectedSummary)
    setSummaryOpen(true)
    setActionError('')
    setActionNotice('')
  }

  async function saveSummary() {
    if (busy.current || !selectedWeekKey) return
    busy.current = true
    setPending(true)
    setActionError('')
    try {
      const saved = await saveCollectionWeekSummary(user.id, selectedWeekKey, summaryDraft.trim())
      setArchive((current) => ({ ...current, summaries: { ...current.summaries, [saved.week_key]: saved.summary } }))
      setSummaryOpen(false)
    } catch (cause) {
      setActionError((cause as Error).message)
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  function renderCollectionRows(items: CollectionRow[]) {
    return <ul aria-label="收藏列表" className="flex flex-col gap-4">
      {items.map((row) => {
        const doc = parseCollectionDoc(row.content_doc)
        return <li key={row.id}><Card className="gap-5 rounded-lg p-5 shadow-sm sm:p-6">{doc ? <Preview doc={doc} /> : <p role="status" className="text-sm text-destructive">内容格式无效，暂时无法预览或编辑。</p>}<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><time dateTime={row.created_at} className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString('zh-CN')}</time><div className="flex gap-2">{doc && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => startEdit(row)} aria-label="编辑收藏"><Pencil />编辑</Button>}{confirmId === row.id ? <><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirmId(null)}>取消删除</Button><Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => void remove()}>确认删除</Button></> : <Button type="button" size="icon-sm" variant="ghost" disabled={pending} onClick={() => { setConfirmId(row.id); setActionError('') }} aria-label="删除收藏"><Trash2 /></Button>}</div></div></Card></li>
      })}
    </ul>
  }

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-6 px-4 py-8 pb-24 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-primary"><Bookmark className="size-6" /></span>
          <div><h1 className="text-2xl font-semibold tracking-tight">我的收藏</h1><p className="mt-1 text-sm text-muted-foreground">按周整理收藏，按月、按年回顾理解与发现。</p></div>
        </div>
        <Button type="button" onClick={startNew} disabled={pending}><Plus />新增收藏</Button>
      </header>

      <div role="group" aria-label="查看范围" className="inline-flex rounded-lg border bg-secondary/50 p-1">
        {(['week', 'month', 'year'] as const).map((mode) => <button key={mode} type="button" aria-pressed={viewMode === mode} onClick={() => selectView(mode)} className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 ${viewMode === mode ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{mode === 'week' ? '按周' : mode === 'month' ? '按月' : '按年'}</button>)}
      </div>

      <section aria-label={viewMode === 'week' ? '周分类' : viewMode === 'month' ? '月分类' : '年分类'} className="flex flex-wrap items-center gap-3 border-b pb-4">
        {viewMode === 'year' ? <div className="flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="上一年" disabled={year <= 1} onClick={() => changeYear(-1)}><ChevronLeft /></Button>
          <span className="min-w-24 text-center text-sm font-semibold tabular-nums">{year} 年</span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="下一年" disabled={year >= 9999} onClick={() => changeYear(1)}><ChevronRight /></Button>
        </div> : <div className="flex shrink-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" aria-label="上个月" onClick={() => changeMonth(-1)}><ChevronLeft /></Button>
          <Popover.Root open={monthPickerOpen} onOpenChange={(open) => { setMonthPickerOpen(open); if (open) setPickerYear(year) }}>
            <Popover.Trigger asChild>
              <button type="button" aria-label={`选择月份，当前 ${year} 年 ${month} 月`} className="flex h-9 min-w-32 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"><CalendarDays className="size-4 text-muted-foreground" /><span>{year} 年 {month} 月</span><ChevronDown className="size-3.5 text-muted-foreground" /></button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content role="dialog" aria-label="选择月份" align="start" sideOffset={8} className="z-50 w-72 rounded-lg border bg-white p-3 text-slate-900 shadow-xl outline-none">
                <div className="flex items-center justify-between gap-2 border-b pb-3">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="上一年" onClick={() => setPickerYear((current) => Math.max(1, current - 1))}><ChevronLeft /></Button>
                  <label className="flex items-center gap-2 text-sm font-semibold"><span className="sr-only">年份</span><input type="number" aria-label="年份" min={1} max={9999} value={pickerYear} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 9999) setPickerYear(value) }} className="h-8 w-20 rounded-md border bg-white px-2 text-center text-sm font-semibold tabular-nums outline-none focus:ring-2 focus:ring-primary/30" />年</label>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="下一年" onClick={() => setPickerYear((current) => Math.min(9999, current + 1))}><ChevronRight /></Button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  {MONTH_NAMES.map((name, index) => {
                    const value = index + 1
                    const selected = pickerYear === year && value === month
                    const current = pickerYear === DEFAULT_COLLECTION_WEEK.year && value === DEFAULT_COLLECTION_WEEK.month
                    return <button key={name} type="button" aria-pressed={selected} onClick={() => chooseMonth(pickerYear, value)} className={`relative h-9 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 ${selected ? 'bg-primary font-semibold text-primary-foreground' : 'hover:bg-secondary'} ${current && !selected ? 'font-semibold text-primary' : ''}`}>{name}{current && <span className={`absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full ${selected ? 'bg-primary-foreground' : 'bg-primary'}`} />}</button>
                  })}
                </div>
                <div className="mt-3 border-t pt-3"><Button type="button" variant="ghost" size="sm" className="w-full" onClick={returnToCurrentMonth}><CalendarDays />回到本月</Button></div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="下个月" onClick={() => changeMonth(1)}><ChevronRight /></Button>
        </div>}
        {viewMode === 'week' && <>
        <div className="flex min-w-full flex-1 gap-2 overflow-x-auto pb-1 sm:min-w-0">
          {weeks.map((week) => {
            const selected = selectedWeekKey === week.key
            const count = archive.counts[week.key] ?? 0
            return <button key={week.key} type="button" aria-pressed={selected} aria-label={`${week.key}，${formatCollectionWeekRange(week)}，${count} 篇`} onClick={() => selectWeek(week.key)} className={`group flex h-16 min-w-32 flex-1 flex-col justify-center rounded-md border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 ${selected ? 'border-primary bg-accent text-primary' : 'bg-card text-foreground hover:border-primary/35 hover:bg-secondary/60'}`}>
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-semibold">W{week.index}</span>
                <span className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${selected ? 'bg-primary text-primary-foreground' : count > 0 ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground'}`}>{count}<span className="sr-only"> 篇</span></span>
              </span>
              <span className={`mt-1 text-xs tabular-nums ${selected ? 'text-primary/75' : 'text-muted-foreground'}`}>{formatCollectionWeekRange(week, true)}</span>
            </button>
          })}
        </div>
        <button type="button" aria-pressed={selectedWeekKey === null} onClick={() => selectWeek(null)} className={`flex h-16 shrink-0 items-center gap-2 rounded-md border px-3 text-xs transition-colors ${selectedWeekKey === null ? 'border-primary bg-accent text-primary' : 'bg-card text-muted-foreground hover:border-primary/35 hover:bg-secondary/60 hover:text-foreground'}`}><Inbox className="size-4" /><span>未分类</span><span className={`inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${selectedWeekKey === null ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>{archive.unassignedCount}</span></button>
        </>}
      </section>

      <Dialog.Root open={Boolean(editing)} onOpenChange={(open) => { if (!open) requestClose() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px]" />
          <Dialog.Content onKeyDown={(event) => {
            if (event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
              event.preventDefault()
              void save(false)
            }
          }} className="fixed top-1/2 left-1/2 z-50 flex h-[85vh] w-[90vw] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
              <div className="space-y-1"><Dialog.Title className="text-xl font-semibold text-slate-900">{editing?.id ? '编辑收藏' : '记录新发现'}</Dialog.Title><Dialog.Description className="text-sm leading-relaxed text-muted-foreground">粘贴纯文本，选中词句后使用上方色板；不保留原网页格式。</Dialog.Description></div>
              {editing && <label className="grid gap-1 text-xs text-muted-foreground">周分类<select aria-label="周分类" value={editing.weekKey ?? ''} disabled={pending} onChange={(event) => setEditing((current) => current ? { ...current, weekKey: event.target.value || null } : current)} className="h-9 rounded-md border bg-white px-3 text-sm text-slate-900"><option value="">未分类</option>{editorWeeks.map((week) => <option key={week.key} value={week.key}>{week.key} · {formatCollectionWeekRange(week)}</option>)}</select></label>}
            </div>
            {editing && <CollectionEditor key={editing.session} initialDoc={editing.initialDoc} disabled={pending} onChange={(doc) => { setInvalidDraft(!doc); setDraft(doc ? { doc, text: collectionPlainText(doc) } : null) }} />}
            {editing && invalidDraft && <p role="alert" className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">内容格式无效或超出长度限制，请调整后再保存。</p>}
            {editing && actionError && <p role="alert" className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{actionError}</p>}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Enter 与 Shift + Enter 换行 · ⌘ + S 保存收藏</span><div className="ml-auto flex gap-3"><Button type="button" variant="outline" disabled={pending} onClick={requestClose}>取消</Button><Button type="button" disabled={pending || invalidDraft || !draft?.text.trim()} onClick={() => void save()}>{pending ? '保存中…' : '保存收藏'}</Button></div></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={summaryOpen} onOpenChange={(open) => { if (!pending) setSummaryOpen(open) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-xl bg-white p-6 shadow-2xl">
            <div><Dialog.Title className="text-lg font-semibold text-slate-900">编辑本周总结</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted-foreground">用几句话记录这一周最重要的理解与发现。</Dialog.Description></div>
            <textarea aria-label="本周总结" value={summaryDraft} disabled={pending} onChange={(event) => setSummaryDraft(event.target.value)} maxLength={4000} rows={6} className="w-full resize-y rounded-lg border p-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-primary/30" />
            {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
            <div className="flex justify-end gap-3"><Button variant="outline" disabled={pending} onClick={() => setSummaryOpen(false)}>取消</Button><Button disabled={pending} onClick={() => void saveSummary()}>{pending ? '保存中…' : '保存总结'}</Button></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {!editing && !summaryOpen && actionError && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{actionError}</p>}
      {actionNotice && <p role="status" className="rounded-xl border border-primary/20 bg-accent p-4 text-sm text-accent-foreground">{actionNotice}</p>}
      {listError && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">加载收藏失败：{listError}</p>}

      {viewMode === 'week' ? <section aria-label={selectedWeekKey ?? '未分类收藏'} className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>{selectedWeek ? <p className="text-xs font-medium text-primary">{year} 年 {month} 月 · 第 {selectedWeek.index} 周</p> : <p className="text-xs font-medium text-muted-foreground">需要整理</p>}<h2 className="mt-1 text-2xl font-semibold">{selectedWeekKey ?? '未分类'}</h2><p className="mt-1 text-sm text-muted-foreground">{selectedWeek ? `${formatCollectionWeekRange(selectedWeek)} · ${archive.counts[selectedWeek.key] ?? rows.length} 篇收藏` : `${archive.unassignedCount} 篇收藏`}</p></div>
          {selectedWeekKey && <Button type="button" variant="outline" onClick={openSummary}><Pencil />编辑总结</Button>}
        </header>

        {selectedWeekKey && selectedSummary && <div className="rounded-lg bg-accent px-5 py-4"><p className="text-sm font-semibold text-primary">本周总结</p><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{selectedSummary}</p></div>}

        {(loadingRows || loadingArchive) && rows.length === 0 ? <p className="py-14 text-center text-muted-foreground">加载中…</p> : rows.length === 0 ? <div className="flex flex-col items-center gap-3 border-y py-14 text-center"><Bookmark className="size-6 text-muted-foreground" /><div><h3 className="font-semibold">{selectedWeekKey ? '本周还没有收藏' : '没有未分类收藏'}</h3><p className="mt-1 text-sm text-muted-foreground">{selectedWeekKey ? '把这一周值得留下的内容收进来。' : '所有收藏都已经整理好了。'}</p></div>{selectedWeekKey && <Button type="button" onClick={startNew}><Plus />添加到本周</Button>}</div> : renderCollectionRows(rows)}
      </section> : <section aria-label={viewMode === 'month' ? '月度收藏' : '年度收藏'} className="space-y-6">
        <header><h2 className="text-2xl font-semibold">{year} 年{viewMode === 'month' ? ` ${month} 月` : ''}</h2><p className="mt-1 text-sm text-muted-foreground">{rows.length} 篇收藏 · {viewMode === 'month' ? '按周回顾' : '按月回顾'}（未分类不计入）</p></header>
        {loadingRows && rows.length === 0 ? <p className="py-14 text-center text-muted-foreground">加载中…</p> : rows.length === 0 ? <div className="flex flex-col items-center gap-3 border-y py-14 text-center"><Bookmark className="size-6 text-muted-foreground" /><div><h3 className="font-semibold">{viewMode === 'month' ? '本月还没有收藏' : '本年还没有收藏'}</h3><p className="mt-1 text-sm text-muted-foreground">按周记录值得回顾的发现，再来这里集中阅读。</p></div></div> : <div className="space-y-10">
          {viewMode === 'month' ? weeks.map((week) => {
            const items = rows.filter((row) => row.week_key === week.key)
            if (!items.length) return null
            return <div key={week.key} className="space-y-4"><div className="flex items-center justify-between border-b pb-2"><div><h3 className="text-lg font-semibold">第 {week.index} 周</h3><p className="text-xs text-muted-foreground">{formatCollectionWeekRange(week)} · {items.length} 篇</p></div><Button type="button" variant="ghost" size="sm" aria-label={`查看 ${week.key}`} onClick={() => selectWeek(week.key)}>查看本周<ChevronRight /></Button></div>{renderCollectionRows(items)}</div>
          }) : MONTH_NAMES.map((name, index) => ({ name, month: index + 1 })).reverse().map(({ name, month: groupMonth }) => {
            const items = rows.filter((row) => row.week_key?.startsWith(`${year}M${groupMonth}W`))
            if (!items.length) return null
            return <div key={groupMonth} className="space-y-4"><div className="flex items-center justify-between border-b pb-2"><div><h3 className="text-lg font-semibold">{name}</h3><p className="text-xs text-muted-foreground">{items.length} 篇收藏</p></div><Button type="button" variant="ghost" size="sm" aria-label={`查看 ${name}`} onClick={() => { showMonth({ year, month: groupMonth }); setViewMode('month') }}>查看本月<ChevronRight /></Button></div>{renderCollectionRows(items)}</div>
          })}
        </div>}
      </section>}
    </div>
  )
}

export function CollectionsPage() {
  const { user, supabaseReady } = useAuth()
  if (!supabaseReady) return <div className="p-10 text-center text-sm text-muted-foreground">未配置 Supabase（见 .env.example），无法管理收藏。</div>
  if (!user) return <div className="p-10 text-center text-sm text-muted-foreground">请先登录后查看收藏。</div>
  return <CollectionsView key={user.id} user={user} />
}
