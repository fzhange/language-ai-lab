/** 知识库笔记页：从 generic-agent-service 的 /notes 接口拉取 nature-of-language MD 笔记并渲染。 */

import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpenText } from 'lucide-react'

import { Badge } from '../components/ui/badge'
import { LANGGRAPH_URL } from '../lib/config'

interface NoteMeta {
  path: string
  title: string
}

export function NotesPage() {
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [selected, setSelected] = useState<string>('')
  const [content, setContent] = useState('')
  const [loadedPath, setLoadedPath] = useState('')
  const [listError, setListError] = useState('')
  const [contentError, setContentError] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const loadingContent = Boolean(selected) && loadedPath !== selected

  useEffect(() => {
    fetch(`${LANGGRAPH_URL}/notes`)
      .then((res) => {
        if (!res.ok) throw new Error(`加载笔记清单失败（HTTP ${res.status}）`)
        return res.json() as Promise<NoteMeta[]>
      })
      .then((data) => {
        setNotes(data)
        if (data.length > 0) setSelected(data[0].path)
      })
      .catch((err: Error) => setListError(err.message))
      .finally(() => setLoadingList(false))
  }, [])

  useEffect(() => {
    if (!selected) return
    fetch(`${LANGGRAPH_URL}/notes/${encodeURIComponent(selected)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`加载笔记失败（HTTP ${res.status}）`)
        return res.text()
      })
      .then((text) => {
        setContent(text)
        setContentError('')
      })
      .catch((err: Error) => setContentError(err.message))
      .finally(() => setLoadedPath(selected))
  }, [selected])

  const grouped = useMemo(() => {
    const map = new Map<string, NoteMeta[]>()
    for (const note of notes) {
      const dir = note.path.includes('/') ? note.path.split('/')[0] : '根目录'
      if (!map.has(dir)) map.set(dir, [])
      map.get(dir)!.push(note)
    }
    return [...map.entries()]
  }, [notes])

  if (loadingList) return <div className="p-10 text-center text-sm text-muted-foreground">加载中…</div>
  if (listError) {
    return (
      <div className="p-10 text-center text-sm text-destructive">
        {listError}。请确认 generic-agent-service 已启动（uv run langgraph dev）。
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="max-h-44 w-full shrink-0 overflow-y-auto border-b bg-card p-4 md:max-h-none md:w-64 md:border-r md:border-b-0 md:p-5">
        <div className="mb-5 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><BookOpenText className="size-4 text-primary" />知识目录</h2>
          <Badge variant="secondary">{notes.length} 篇</Badge>
        </div>
        {grouped.map(([dir, items]) => (
          <section key={dir} className="mb-5">
            <h3 className="mb-2 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{dir}</h3>
            {items.map((note) => (
              <button
                key={note.path}
                onClick={() => setSelected(note.path)}
                className={`mb-0.5 block w-full truncate rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  selected === note.path
                    ? 'bg-accent font-medium text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
                title={note.title}
              >
                {note.path.split('/').pop()}
              </button>
            ))}
          </section>
        ))}
      </aside>
      <article className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-8">
        <div className="mx-auto max-w-4xl rounded-xl border bg-card px-5 py-6 shadow-sm sm:px-10 sm:py-10">
          {loadingContent && <p className="text-sm text-muted-foreground">加载中…</p>}
          {contentError && <p className="text-sm text-destructive">{contentError}</p>}
          {!loadingContent && !contentError && (
            <div className="prose prose-neutral max-w-none prose-headings:font-semibold prose-a:text-primary prose-pre:overflow-x-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </article>
    </div>
  )
}
