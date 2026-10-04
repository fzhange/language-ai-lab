/** 我的高亮页：读取 Supabase whw_highlights（插件同步的数据），按页面分组展示。 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Highlighter, Sparkles } from 'lucide-react'

import { MarkdownView } from '../components/MarkdownView'
import { Badge } from '../components/ui/badge'
import { Card } from '../components/ui/card'
import { useAuth } from '../lib/auth'
import { supabase, type HighlightRow } from '../lib/supabase'

export function HighlightsPage() {
  const { user, supabaseReady } = useAuth()
  const [rows, setRows] = useState<HighlightRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase || !user) {
      setLoading(false)
      return
    }
    supabase
      .from('whw_highlights')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else setRows((data as HighlightRow[]) ?? [])
        setLoading(false)
      })
  }, [user])

  const grouped = useMemo(() => {
    const map = new Map<string, HighlightRow[]>()
    for (const row of rows) {
      const key = row.page_url
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(row)
    }
    return [...map.entries()]
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
        <h2 className="text-lg font-semibold">你的收藏从这里开始</h2>
        <p className="text-sm text-muted-foreground">先用 Words Highlight 插件在网页上划一些内容吧。</p>
      </Card>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-8">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary"><Highlighter className="size-5" /></span>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">我的高亮</h2>
          <p className="text-sm text-muted-foreground">记录阅读中的每一个重要瞬间</p>
        </div>
        <Badge variant="secondary">{rows.length} 条</Badge>
      </div>
      {grouped.map(([url, items]) => (
        <Card key={url} className="gap-0 overflow-hidden py-0">
          <header className="flex items-center justify-between gap-3 border-b bg-secondary/40 px-5 py-4">
            <a href={url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 text-base font-semibold text-primary hover:underline">
              <span className="truncate">{items[0].page_title || url}</span><ArrowUpRight className="size-4 shrink-0" />
            </a>
            <Badge variant="outline">{items.length} 条</Badge>
          </header>
          <ul className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="space-y-3 px-5 py-5">
                <p className="text-base leading-7 text-foreground">
                  <mark style={{ backgroundColor: item.color }} className="rounded px-0.5">
                    {item.exact}
                  </mark>
                </p>
                {item.note && (
                  <div className="text-sm leading-relaxed text-foreground">
                    <span className="font-medium">笔记：</span><MarkdownView compact>{item.note}</MarkdownView>
                  </div>
                )}
                {item.insight && (
                  <div className="text-sm leading-relaxed text-foreground">
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
  )
}
