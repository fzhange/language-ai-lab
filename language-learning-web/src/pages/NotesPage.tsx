/** 知识库笔记页：从 generic-agent-service 的 /notes 接口拉取 nature-of-language MD 笔记并渲染。 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpenText } from 'lucide-react'

import { Badge } from '../components/ui/badge'
import { LANGGRAPH_URL } from '../lib/config'

interface NoteMeta {
  path: string
  title: string
}

const SIDEBAR_WIDTH_KEY = 'notes-sidebar-width'
const MIN_SIDEBAR_WIDTH = 192
const MAX_SIDEBAR_WIDTH = 480
const DEFAULT_SIDEBAR_WIDTH = 256

function maxSidebarWidth(containerWidth: number) {
  return containerWidth > 0
    ? Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, containerWidth - 328))
    : MAX_SIDEBAR_WIDTH
}

function clampSidebarWidth(width: number, containerWidth: number) {
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), maxSidebarWidth(containerWidth))
}

export function NotesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [content, setContent] = useState('')
  const [loadedPath, setLoadedPath] = useState('')
  const [listError, setListError] = useState('')
  const [contentError, setContentError] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_WIDTH_KEY)
      const width = saved === null ? DEFAULT_SIDEBAR_WIDTH : Number(saved)
      return Number.isFinite(width) ? clampSidebarWidth(width, 0) : DEFAULT_SIDEBAR_WIDTH
    } catch {
      return DEFAULT_SIDEBAR_WIDTH
    }
  })
  const [availableMaxWidth, setAvailableMaxWidth] = useState(MAX_SIDEBAR_WIDTH)
  const sidebarWidth = Math.min(preferredWidth, availableMaxWidth)
  const layoutRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  const containerWidth = () => layoutRef.current?.getBoundingClientRect().width ?? 0

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(preferredWidth))
    } catch {
      return
    }
  }, [preferredWidth])

  useEffect(() => {
    if (loadingList) return
    const fitToWindow = () => setAvailableMaxWidth(maxSidebarWidth(containerWidth()))
    fitToWindow()
    window.addEventListener('resize', fitToWindow)
    return () => window.removeEventListener('resize', fitToWindow)
  }, [loadingList])

  const stopDragging = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const maxWidth = maxSidebarWidth(containerWidth())
    let nextWidth: number
    switch (event.key) {
      case 'ArrowLeft': nextWidth = sidebarWidth - 16; break
      case 'ArrowRight': nextWidth = sidebarWidth + 16; break
      case 'Home': nextWidth = MIN_SIDEBAR_WIDTH; break
      case 'End': nextWidth = maxWidth; break
      default: return
    }
    event.preventDefault()
    setAvailableMaxWidth(maxWidth)
    const adjusted = Math.min(Math.max(nextWidth, MIN_SIDEBAR_WIDTH), maxWidth)
    if (adjusted !== sidebarWidth) setPreferredWidth(adjusted)
  }

  const requestedNote = searchParams.get('note')
  const selected = notes.find((note) => note.path === requestedNote)?.path ?? notes[0]?.path ?? ''
  const loadingContent = Boolean(selected) && loadedPath !== selected

  useEffect(() => {
    fetch(`${LANGGRAPH_URL}/notes`)
      .then((res) => {
        if (!res.ok) throw new Error(`加载笔记清单失败（HTTP ${res.status}）`)
        return res.json() as Promise<NoteMeta[]>
      })
      .then((data) => setNotes(data))
      .catch((err: Error) => setListError(err.message))
      .finally(() => setLoadingList(false))
  }, [])

  useEffect(() => {
    if (!selected || requestedNote === selected) return
    setSearchParams((params) => {
      const next = new URLSearchParams(params)
      next.set('note', selected)
      return next
    }, { replace: true })
  }, [selected, requestedNote, setSearchParams])

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
    <div ref={layoutRef} className="flex h-full min-h-0 flex-col md:flex-row">
      <aside
        style={{ '--notes-sidebar-width': `${sidebarWidth}px` } as CSSProperties}
        className="max-h-44 w-full shrink-0 overflow-y-auto border-b bg-card p-4 md:max-h-none md:w-[var(--notes-sidebar-width)] md:border-r md:border-b-0 md:p-5"
      >
        <div className="mb-5 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold"><BookOpenText className="size-4 text-primary" />知识目录</h2>
          <Badge variant="secondary">{notes.length} 篇</Badge>
        </div>
        {grouped.map(([dir, items]) => (
          <section key={dir} className="mb-5">
            <h3 className="mb-2 px-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{dir}</h3>
            {items.map((note) => (
              <button
                key={note.path}
                onClick={() => setSearchParams((params) => {
                  const next = new URLSearchParams(params)
                  next.set('note', note.path)
                  return next
                })}
                className={`mb-0.5 block w-full truncate rounded-md px-3 py-2 text-left text-base transition-colors ${
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
      <div
        role="separator"
        aria-label="调整知识目录宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={availableMaxWidth}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        className="group hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center bg-border/40 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-primary md:flex"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: sidebarWidth }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current
          if (!drag || drag.pointerId !== event.pointerId) return
          const width = containerWidth()
          const nextWidth = clampSidebarWidth(drag.startWidth + event.clientX - drag.startX, width)
          setAvailableMaxWidth(maxSidebarWidth(width))
          if (nextWidth !== sidebarWidth) setPreferredWidth(nextWidth)
        }}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onLostPointerCapture={() => { dragRef.current = null }}
        onKeyDown={resizeWithKeyboard}
      >
        <span className="h-10 w-0.5 rounded-full bg-muted-foreground/50 group-hover:bg-primary group-focus-visible:bg-primary" />
      </div>
      <article className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto max-w-[96rem] rounded-xl border bg-card px-5 py-6 shadow-sm sm:px-6 sm:py-10">
          {loadingContent && <p className="text-base text-muted-foreground">加载中…</p>}
          {contentError && <p className="text-base text-destructive">{contentError}</p>}
          {!loadingContent && !contentError && (
            <div className="prose prose-lg prose-neutral mx-auto max-w-6xl prose-headings:font-semibold prose-a:text-primary prose-pre:overflow-x-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </article>
    </div>
  )
}
