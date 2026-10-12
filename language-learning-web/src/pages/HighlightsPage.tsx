/** 我的高亮页：读取 Supabase whw_highlights，按网址、标题、日期或高亮频次查看。 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, Highlighter, Sparkles } from 'lucide-react'

import { MarkdownView } from '../components/MarkdownView'
import { Badge } from '../components/ui/badge'
import { Card } from '../components/ui/card'
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

  const grouped = useMemo(() => {
    const map = new Map<string, HighlightRow[]>()
    if (activeTab === 'frequency') return []
    for (const row of rows) {
      const key = activeTab === 'url' ? row.page_url
        : activeTab === 'title' ? row.page_title.trim() || row.page_url
          : dayOf(row.created_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return [...map.entries()]
  }, [rows, activeTab])

  const frequencies = useMemo(() => {
    const counts = new Map<string, { text: string; items: HighlightRow[] }>()
    for (const row of rows) {
      const text = row.exact.trim()
      if (!text) continue
      const key = text.toLocaleLowerCase()
      const entry = counts.get(key)
      if (entry) entry.items.push(row)
      else counts.set(key, { text, items: [row] })
    }
    return [...counts.values()].sort((a, b) => b.items.length - a.items.length || a.text.localeCompare(b.text))
  }, [rows])

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
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary"><Highlighter className="size-5" /></span>
        <div className="flex-1">
          <h2 className="text-xl font-semibold">我的高亮</h2>
          <p className="text-base text-muted-foreground">记录阅读中的每一个重要瞬间</p>
        </div>
        <Badge variant="secondary">{rows.length} 条</Badge>
      </div>
      <div role="tablist" aria-label="高亮查看方式" className="flex flex-wrap gap-2 rounded-xl border bg-card p-1.5">
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
            className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${activeTab === id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div id="highlights-panel" role="tabpanel" aria-labelledby={`highlight-tab-${activeTab}`} className="space-y-6">
        {activeTab === 'frequency' ? (
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
                  <p className="break-words text-lg leading-8 text-foreground">
                    <mark style={{ backgroundColor: item.color }} className="rounded px-0.5">
                      {item.exact}
                    </mark>
                  </p>
                  {activeTab !== 'url' && (
                    <a href={item.page_url} target="_blank" rel="noreferrer" aria-label={`来源：${item.page_title || item.page_url}`} className="inline-flex max-w-full items-center gap-1 text-sm text-primary hover:underline">
                      <span className="truncate">{activeTab === 'title' ? item.page_url : item.page_title || item.page_url}</span><ArrowUpRight className="size-4 shrink-0" />
                    </a>
                  )}
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
