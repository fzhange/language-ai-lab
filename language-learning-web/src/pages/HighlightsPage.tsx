/** 我的高亮页：读取 Supabase whw_highlights，按网址、标题、日期或高亮频次查看。 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, Highlighter, Search, Sparkles, X } from 'lucide-react'

import { MarkdownView } from '../components/MarkdownView'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { useAuth } from '../lib/auth'
import { supabase, type HighlightRow } from '../lib/supabase'

type HighlightTab = 'url' | 'title' | 'time' | 'frequency'

const TABS: { id: HighlightTab; label: string }[] = [
  { id: 'url', label: '按网址' },
  { id: 'title', label: '按标题' },
  { id: 'time', label: '按时间' },
  { id: 'frequency', label: '高亮频次' },
]
const PAGE_SIZE = 1000

function dayOf(value?: string): string {
  if (!value) return '未知日期'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '未知日期'
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function HighlightsPage() {
  const { user, supabaseReady } = useAuth()
  const [rows, setRows] = useState<HighlightRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<HighlightTab>('url')
  const [search, setSearch] = useState('')
  const [expandedSelection, setExpandedSelection] = useState<string | null>(null)

  useEffect(() => {
    const client = supabase
    if (!client || !user) {
      setLoading(false)
      return
    }
    let cancelled = false
    const load = async () => {
      const all: HighlightRow[] = []
      for (let start = 0; ; start += PAGE_SIZE) {
        const { data, error } = await client
          .from('whw_highlights')
          .select('*')
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(start, start + PAGE_SIZE - 1)
        if (error) throw error
        all.push(...((data as HighlightRow[]) ?? []))
        if (!data || data.length < PAGE_SIZE) break
      }
      if (!cancelled) setRows(all)
    }
    void load()
      .catch((cause: Error) => { if (!cancelled) setError(cause.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user])

  const query = search.trim().toLocaleLowerCase()
  const matchingRows = useMemo(() => query
    ? rows.filter((row) => row.exact.toLocaleLowerCase().includes(query))
    : rows, [rows, query])

  const grouped = useMemo(() => {
    const map = new Map<string, HighlightRow[]>()
    if (activeTab === 'frequency') return []
    for (const row of matchingRows) {
      const key = activeTab === 'url' ? row.page_url
        : activeTab === 'title' ? row.page_title.trim() || row.page_url
          : dayOf(row.created_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return [...map.entries()]
  }, [matchingRows, activeTab])

  const frequencies = useMemo(() => {
    const counts = new Map<string, { text: string; items: HighlightRow[] }>()
    for (const row of matchingRows) {
      const text = row.exact.trim()
      if (!text) continue
      const key = text.toLocaleLowerCase()
      const entry = counts.get(key)
      if (entry) entry.items.push(row)
      else counts.set(key, { text, items: [row] })
    }
    return [...counts.values()].sort((a, b) => b.items.length - a.items.length || a.text.localeCompare(b.text))
  }, [matchingRows])

  if (!supabaseReady) {
    return (
      <div className="p-10 text-center text-sm text-muted-foreground">
        未配置 Supabase（见 .env.example），无法展示插件同步的高亮数据。
      </div>
    )
  }
  if (!user) {
    return <div className="p-10 text-center text-sm text-muted-foreground">请先登录。</div>
  }
  if (loading) return <div className="p-10 text-center text-sm text-muted-foreground">加载中…</div>
  if (error) return <div className="p-10 text-center text-sm text-destructive">{error}</div>
  if (rows.length === 0) {
    return (
      <Card className="mx-auto mt-16 max-w-md items-center px-6 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-primary"><Highlighter className="size-6" /></span>
        <h2 className="text-xl font-semibold">你的收藏从这里开始</h2>
        <p className="text-base text-muted-foreground">先用 Words Highlight 插件在网页上划一些内容吧。</p>
      </Card>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[96rem] space-y-4 px-4 py-4 sm:px-6">
      <section aria-label="高亮浏览工具" className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-white to-blue-50/70 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Highlighter className="size-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold tracking-tight">我的高亮</h2>
              <p className="text-sm text-muted-foreground">记录阅读中的每一个重要瞬间</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
              {query && <span role="status" className="text-xs text-muted-foreground">找到 {matchingRows.length} 条</span>}
              <Badge variant="secondary" className="rounded-full border border-primary/10 bg-accent px-3 py-1 text-primary">{rows.length} 条</Badge>
            </div>
          </div>
          <div className="relative w-full lg:w-80 xl:w-96">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="搜索高亮" placeholder="搜索高亮的词语或短语" value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 rounded-xl border-blue-100 bg-white pl-10 pr-10 shadow-sm" />
            {search && <Button type="button" size="icon-sm" variant="ghost" aria-label="清空搜索" onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="size-4" /></Button>}
          </div>
        </div>
        <div role="tablist" aria-label="高亮查看方式" className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-slate-100/80 p-1 sm:grid-cols-4">
          {TABS.map(({ id, label }, index) => (
            <button
              key={id}
              id={`highlight-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls="highlights-panel"
              tabIndex={activeTab === id ? 0 : -1}
              onClick={() => setActiveTab(id)}
              onKeyDown={(event) => {
                const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length
                  : event.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length
                    : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1
                if (next < 0) return
                event.preventDefault()
                setActiveTab(TABS[next].id)
                document.getElementById(`highlight-tab-${TABS[next].id}`)?.focus()
              }}
              className={`min-h-9 rounded-lg px-3 py-2 text-center text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${activeTab === id ? 'bg-white text-primary shadow-sm ring-1 ring-primary/10' : 'text-muted-foreground hover:bg-white/70 hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <div id="highlights-panel" role="tabpanel" aria-labelledby={`highlight-tab-${activeTab}`} className="space-y-6">
        {query && matchingRows.length === 0 ? (
          <Card className="items-center gap-2 px-5 py-12 text-center">
            <Search aria-hidden="true" className="size-6 text-muted-foreground" />
            <p className="font-medium">没有找到匹配的高亮</p>
            <p className="text-sm text-muted-foreground">试试其他词语，或清空搜索查看全部高亮。</p>
          </Card>
        ) : activeTab === 'frequency' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/10 bg-gradient-to-r from-accent/70 via-card to-card px-5 py-5 sm:px-6">
              <div>
                <h3 className="text-lg font-semibold">高亮频次</h3>
                <p className="mt-1 text-sm text-muted-foreground">按完整选中文本统计，忽略首尾空格与大小写；点击条目查看笔记和上下文。</p>
              </div>
              <Badge variant="secondary">{frequencies.length} 条不同的高亮</Badge>
            </div>
            {frequencies.length === 0 ? (
              <Card className="items-center px-5 py-10 text-muted-foreground">暂无可统计的高亮文本。</Card>
            ) : (
              <ul className="space-y-3">
                {frequencies.map(({ text, items }, index) => {
                  const key = text.toLocaleLowerCase()
                  const expanded = expandedSelection === key
                  return (
                    <li key={key} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={expanded ? `frequency-details-${index}` : undefined}
                        onClick={() => setExpandedSelection(expanded ? null : key)}
                        className="flex w-full min-w-0 items-start gap-3 px-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:items-center sm:gap-5 sm:px-6 sm:py-5"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent font-semibold text-primary">{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-lg leading-7 font-semibold text-foreground [overflow-wrap:anywhere]">{text}</span>
                          <span className="mt-1 block text-sm text-muted-foreground">{items.length} 条记录 · {expanded ? '点击收起详情' : '点击查看笔记与上下文'}</span>
                        </span>
                        <Badge variant={items.length > 1 ? 'secondary' : 'outline'} className="mt-1 shrink-0 sm:mt-0">{items.length} 次</Badge>
                        <ChevronDown aria-hidden="true" className={`mt-1 size-5 shrink-0 text-muted-foreground transition-transform sm:mt-0 ${expanded ? 'rotate-180' : ''}`} />
                      </button>
                      {expanded && (
                        <div id={`frequency-details-${index}`} className="space-y-3 border-t bg-secondary/30 px-4 py-4 sm:px-6 sm:py-5">
                          {items.map((item) => (
                            <div key={item.id} className="min-w-0 space-y-3 rounded-xl border border-border bg-card px-4 py-4 sm:px-5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="min-w-0 truncate font-medium text-foreground" title={item.page_title || item.page_url}>{item.page_title || item.page_url}</span>
                                {item.created_at && <time className="text-sm text-muted-foreground" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>}
                              </div>
                              <p className="break-words rounded-lg bg-accent/40 px-3 py-2 leading-relaxed whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
                                {item.prefix && <span className="text-muted-foreground">{item.prefix}</span>}
                                <mark style={{ backgroundColor: item.color }} className="rounded px-0.5">{item.exact}</mark>
                                {item.suffix && <span className="text-muted-foreground">{item.suffix}</span>}
                              </p>
                              {item.note && <div className="border-l-2 border-primary/40 pl-3"><span className="font-semibold text-foreground">笔记：</span><MarkdownView compact>{item.note}</MarkdownView></div>}
                              {item.insight && <div className="border-l-2 border-amber-400 pl-3"><span className="font-semibold text-foreground">心得：</span><MarkdownView compact>{item.insight}</MarkdownView></div>}
                              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                                <a href={item.page_url} target="_blank" rel="noreferrer" aria-label={`来源：${item.page_title || item.page_url}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">打开原网页<ArrowUpRight className="size-4" /></a>
                                <Link to="/" state={{ prefill: `帮我讲讲这句话：${item.exact}` }} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Sparkles className="size-4" />问导师</Link>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : grouped.map(([key, items]) => (
          <Card key={key} className="gap-0 overflow-hidden py-0">
            <header className="flex items-center justify-between gap-3 border-b bg-secondary/40 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-lg font-semibold">
                  {activeTab === 'url' ? (
                    <a href={key} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-primary hover:underline">
                      <span className="truncate">{items[0].page_title || key}</span><ArrowUpRight className="size-4 shrink-0" />
                    </a>
                  ) : key}
                </h3>
                {activeTab === 'url' && <p className="truncate text-sm text-muted-foreground" title={key}>{key}</p>}
              </div>
              <Badge variant="outline">{items.length} 条</Badge>
            </header>
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id} className="space-y-3 px-5 py-5">
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <p className="min-w-0 flex-1 break-words text-lg leading-8 text-foreground">
                      <mark style={{ backgroundColor: item.color }} className="rounded px-0.5">
                        {item.exact}
                      </mark>
                    </p>
                    <a href={item.page_url} target="_blank" rel="noreferrer" title={item.page_url} aria-label={`来源：${item.page_title || item.page_url}`} className="inline-flex min-w-0 max-w-full items-center gap-1 self-start text-sm text-primary hover:underline sm:ml-auto sm:max-w-[40%] sm:shrink-0">
                      <span className="truncate">{activeTab === 'url' ? '打开原网页' : activeTab === 'title' ? item.page_url : item.page_title || item.page_url}</span><ArrowUpRight className="size-4 shrink-0" />
                    </a>
                  </div>
                  {item.note && (
                    <div className="text-base leading-relaxed text-foreground">
                      <span className="font-medium">笔记：</span><MarkdownView compact>{item.note}</MarkdownView>
                    </div>
                  )}
                  {item.insight && (
                    <div className="text-base leading-relaxed text-foreground">
                      <span className="font-medium">心得：</span><MarkdownView compact>{item.insight}</MarkdownView>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</span>
                    <Link
                      to="/"
                      state={{ prefill: `帮我讲讲这句话：${item.exact}` }}
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <Sparkles className="size-3.5" />问导师
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
