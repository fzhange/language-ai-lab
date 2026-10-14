/** 导师对话页：useStream 直连 LangGraph Server 的 language-mentor 图谱（SSE 流式）。 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStream } from '@langchain/react'
import { ArrowUp, CircleStop, MessageCircle, Plus, Sparkles, Trash2 } from 'lucide-react'

import { MarkdownView } from '../components/MarkdownView'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Textarea } from '../components/ui/textarea'
import { useAuth } from '../lib/auth'
import { LANGGRAPH_URL, MENTOR_ASSISTANT_ID } from '../lib/config'

/** message.content 可能是 string 或内容块数组，统一取文本 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? '')))
      .join('')
  }
  return String(content ?? '')
}

interface TodoItem {
  content?: string
  status?: string
}

function TodosPanel({ values }: { values: unknown }) {
  const todos = (values as { todos?: TodoItem[] } | undefined)?.todos
  if (!Array.isArray(todos) || todos.length === 0) return null
  return (
    <Card className="gap-2 border-primary/10 bg-accent/40 px-5 py-4 text-sm shadow-none">
      <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" />导师的任务清单</h3>
      <ul className="space-y-2">
        {todos.map((todo, i) => (
          <li key={i} className="flex items-start gap-2 text-muted-foreground">
            <span
              className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${
                todo.status === 'completed'
                  ? 'bg-emerald-500'
                  : todo.status === 'in_progress'
                    ? 'bg-primary'
                    : 'bg-muted-foreground/40'
              }`}
            />
            <span>{todo.content ?? JSON.stringify(todo)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function ChatPage() {
  const { user, accessToken, supabaseReady } = useAuth()
  return <MentorChat key={user?.id ?? 'guest'} userId={user?.id ?? null} accessToken={accessToken} anonymous={!supabaseReady} />
}

function MentorChat({ userId, accessToken, anonymous }: { userId: string | null; accessToken: string | null; anonymous: boolean }) {
  const location = useLocation()
  const navigate = useNavigate()
  const storageKey = `mentor-thread:${LANGGRAPH_URL}:${MENTOR_ASSISTANT_ID}:${userId ?? 'guest'}`
  const getStorage = () => userId ? window.localStorage : anonymous ? window.sessionStorage : null
  const [saved] = useState(() => {
    let active: string | null = null
    let ids: string[] = []
    try {
      const storage = getStorage()
      active = storage?.getItem(storageKey) || null
      const value: unknown = JSON.parse(storage?.getItem(`${storageKey}:threads`) ?? '[]')
      if (Array.isArray(value)) ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0)
    } catch {
      ids = []
    }
    if (active && !ids.includes(active)) ids.push(active)
    return { active, ids }
  })
  const [threads, setThreads] = useState(saved.ids)
  const [activeId, setActiveId] = useState(saved.active)
  const [current, setCurrent] = useState(() => ({ id: saved.active, key: saved.active ?? 'draft:0', ignorePrefill: false }))
  const draftNumber = useRef(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const saveActive = (id: string | null) => {
    try {
      if (id) getStorage()?.setItem(storageKey, id)
      else getStorage()?.removeItem(storageKey)
    } catch {
      return
    }
  }

  const onThreadId = (id: string) => {
    const next = threads.includes(id) ? threads : [...threads, id]
    setThreads(next)
    setActiveId(id)
    saveActive(id)
    try {
      getStorage()?.setItem(`${storageKey}:threads`, JSON.stringify(next))
    } catch {
      return
    }
  }

  const selectThread = (id: string) => {
    if (activeId === id) return
    setActiveId(id)
    setCurrent({ id, key: id, ignorePrefill: false })
    saveActive(id)
  }

  const newThread = () => {
    if (location.state) navigate(location.pathname + location.search, { replace: true, state: null })
    draftNumber.current += 1
    setActiveId(null)
    setCurrent({ id: null, key: `draft:${draftNumber.current}`, ignorePrefill: true })
    saveActive(null)
  }

  const deleteThread = async (id: string, number: number) => {
    if (deletingId !== null || !threads.includes(id)) return
    if (!window.confirm(`确定永久删除对话 ${number} 及其所有消息吗？此操作无法撤销。`)) return
    setDeleteError('')
    setDeletingId(id)
    try {
      const response = await fetch(`${LANGGRAPH_URL.replace(/\/$/, '')}/threads/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const next = threads.filter((threadId) => threadId !== id)
      setThreads(next)
      if (activeId === id) newThread()
      try {
        getStorage()?.setItem(`${storageKey}:threads`, JSON.stringify(next))
      } catch {
        return
      }
    } catch {
      setDeleteError('删除对话失败，请重试。')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[96rem] flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6 lg:flex-row">
      <aside aria-label="对话历史" className="flex max-h-44 shrink-0 flex-col gap-3 rounded-xl border bg-card p-3 lg:max-h-none lg:w-52">
        <Button variant="outline" type="button" onClick={newThread} disabled={deletingId !== null} className="w-full justify-start">
          <Plus />新对话
        </Button>
        {deleteError && <p role="alert" className="px-2 text-xs text-destructive">{deleteError}</p>}
        {deletingId && <p role="status" className="px-2 text-xs text-muted-foreground">正在删除对话…</p>}
        <div className="min-h-0 space-y-1 overflow-y-auto" aria-label="历史对话">
          {threads.length === 0 && <p className="px-2 text-xs text-muted-foreground">还没有历史对话</p>}
          {threads.map((id, index) => (
            <div key={id} className="flex min-w-0 items-center gap-1">
              <Button type="button" variant="ghost" onClick={() => selectThread(id)} disabled={deletingId !== null}
                aria-current={activeId === id ? 'true' : undefined}
                className={`min-w-0 flex-1 justify-start truncate ${activeId === id ? 'bg-accent text-primary' : ''}`}>
                <MessageCircle className="size-4 shrink-0" />对话 {index + 1}
              </Button>
              <Button type="button" variant="ghost" size="icon" disabled={deletingId !== null}
                aria-label={`删除对话 ${index + 1}`} title={`删除对话 ${index + 1}`}
                onClick={() => void deleteThread(id, index + 1)}
                className="size-8 shrink-0 text-muted-foreground hover:text-destructive">
                <Trash2 className="size-4" />
              </Button>
            </div>
          )).reverse()}
        </div>
      </aside>
      <MentorThread key={current.key} threadId={current.id} onThreadId={onThreadId} userId={userId} accessToken={accessToken} ignorePrefill={current.ignorePrefill} />
    </div>
  )
}

function MentorThread({ threadId, onThreadId, userId, accessToken, ignorePrefill }: {
  threadId: string | null
  onThreadId: (id: string) => void
  userId: string | null
  accessToken: string | null
  ignorePrefill: boolean
}) {
  const location = useLocation()
  const stream = useStream({
    apiUrl: LANGGRAPH_URL,
    assistantId: MENTOR_ASSISTANT_ID,
    threadId,
    onThreadId,
  })
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // 从「我的高亮」跳转过来时预填问题
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill
    if (prefill && !ignorePrefill) setInput(prefill)
  }, [location.state, ignorePrefill])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [stream.messages.length])

  const send = (e: FormEvent) => {
    e.preventDefault()
    const content = input.trim()
    if (!content || stream.isLoading || stream.isThreadLoading) return
    setInput('')
    // user_id / supabase_token 经 config.configurable 传给服务端工具
    //（服务端不采信对话文本里的身份；token 用于 RLS 授权读 whw_highlights）
    void stream.submit(
      { messages: [{ type: 'human', content }] },
      {
        config: {
          configurable: { user_id: userId ?? undefined, supabase_token: accessToken ?? undefined },
        },
      },
    )
  }

  // human / ai / tool 全部展示：tool 消息就是"思考过程"（检索了哪篇笔记、读到了什么）
  const visibleMessages = stream.messages.filter(
    (m) => m.type === 'human' || m.type === 'ai' || m.type === 'tool',
  )

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col gap-4">
      <div className="flex items-center gap-3 border-b pb-4">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary"><MessageCircle className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">和语言导师聊聊</h2>
          <p className="text-sm text-muted-foreground">从原理出发，让每一个疑问都有答案</p>
        </div>
        <Badge variant="outline" className="hidden border-primary/20 bg-accent/50 text-primary sm:inline-flex"><Sparkles />AI 导师</Badge>
      </div>
      <TodosPanel values={stream.values} />

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-2">
        {stream.isThreadLoading && <p role="status" className="text-sm text-muted-foreground">正在加载对话…</p>}
        {!stream.isThreadLoading && visibleMessages.length === 0 && (
          <Card className="mx-auto mt-8 max-w-lg items-center gap-3 border-primary/10 bg-card px-6 py-10 text-center shadow-sm sm:mt-16">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-primary"><Sparkles className="size-6" /></span>
            <h3 className="text-xl font-semibold">好奇，是学习的开始</h3>
            <p className="text-base leading-relaxed text-muted-foreground">你可以问我任何英语学习中的疑问。<br />试试「in 和 on 到底怎么区分？」或「帮我讲讲现在完成时」。</p>
          </Card>
        )}
        {visibleMessages.map((msg, i) => {
          const text = textOf(msg.content)

          // 工具调用失败（如代理偶发丢工具名）：渲染成低调的重试提示，不刷屏原始报错
          if (msg.type === 'tool' && text.includes('not a valid tool')) {
            return (
              <p key={msg.id ?? i} className="mx-2 text-xs text-muted-foreground/70 sm:mx-8">
                一次工具调用失败，导师正在换方式重试…
              </p>
            )
          }

          // 工具返回：可折叠的"过程记录"，默认收起，点开看检索/读取到的内容
          if (msg.type === 'tool') {
            const name = (msg as { name?: string }).name ?? 'tool'
            return (
              <details key={msg.id ?? i} className="group mx-2 text-xs sm:mx-8">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  <Badge variant="secondary" className="font-mono">{name}</Badge>
                  <span className="ml-2">返回 {text.length} 字（点击展开）</span>
                </summary>
                <pre className="mt-2 max-h-64 overflow-y-auto rounded-lg border bg-card p-3 whitespace-pre-wrap text-muted-foreground">
                  {text}
                </pre>
              </details>
            )
          }

          const isHuman = msg.type === 'human'
          const toolCalls = (msg as { tool_calls?: { name?: string; args?: unknown }[] })
            .tool_calls

          // AI 消息无正文、只有工具调用：渲染成一行过程状态，不再留空气泡
          if (!isHuman && !text.trim() && toolCalls && toolCalls.length > 0) {
            return (
              <div key={msg.id ?? i} className="mx-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:mx-8">
                <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />
                正在调用
                {toolCalls.map((call, j) => (
                  <Badge key={j} variant="secondary" className="font-mono text-primary">{call.name || 'tool'}</Badge>
                ))}
              </div>
            )
          }

          // 彻底空的消息不渲染
          if (!text.trim() && !(toolCalls && toolCalls.length > 0)) return null

          return (
            <div key={msg.id ?? i} className={`flex ${isHuman ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[95%] rounded-xl px-4 py-3 text-base leading-relaxed sm:max-w-[85%] ${
                  isHuman
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'border bg-card text-card-foreground shadow-sm'
                }`}
              >
                {!isHuman && toolCalls && toolCalls.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1">
                    {toolCalls.map((call, j) => (
                      <Badge key={j} variant="secondary" className="font-mono text-primary">{call.name || 'tool'}</Badge>
                    ))}
                  </div>
                )}
                {isHuman ? (
                  <p className="whitespace-pre-wrap">{text}</p>
                ) : (
                  <MarkdownView>{text}</MarkdownView>
                )}
              </div>
            </div>
          )
        })}
        {stream.isLoading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 animate-pulse rounded-full bg-primary" />导师思考中…</p>}
        {stream.error != null && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            连接出错：{String(stream.error)}（请确认 generic-agent-service 已在 {LANGGRAPH_URL} 启动）
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={send} className="flex shrink-0 items-end gap-2 rounded-xl border bg-card p-3 shadow-sm">
        <Textarea
          aria-label="输入问题"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          rows={2}
          placeholder="输入你的问题…（Enter 发送，Shift + Enter 换行）"
          className="max-h-40 min-w-0 flex-1 resize-y border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0"
        />
        {stream.isLoading ? (
          <Button variant="outline" type="button" onClick={() => void stream.stop()} className="mb-1">
            <CircleStop />停止
          </Button>
        ) : (
          <Button type="submit" disabled={!input.trim() || stream.isThreadLoading} className="mb-1">
            <ArrowUp />发送
          </Button>
        )}
      </form>
    </div>
  )
}
