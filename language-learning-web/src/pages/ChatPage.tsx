/** 导师对话页：useStream 直连 LangGraph Server 的 language-mentor 图谱（SSE 流式）。 */

import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStream } from '@langchain/react'
import { BorderBeam } from 'border-beam'
import { ThinkingOrb } from 'thinking-orbs'
import { Dialog } from 'radix-ui'
import { ArrowUp, BookOpen, CircleStop, GitCompareArrows, ImagePlus, LoaderCircle, MessageCircle, Plus, Sparkles, Trash2, X } from 'lucide-react'

import { MarkdownView } from '../components/MarkdownView'
import { MarkdownApproval } from '../components/MarkdownApproval'
import { MarkdownArtifact } from '../components/MarkdownArtifact'
import { restoredUnderstandingAnswer, understandingAnswer, understandingAnswerText } from '../lib/understanding-check'
import { parseSentenceStructure, sentenceRequest, sentenceRequestText } from '../lib/sentence-structure'
import { parseSynonymComparison, synonymRequest, synonymRequestText, SYNONYM_REQUEST_PREFIX } from '../lib/synonym-comparison'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Textarea } from '../components/ui/textarea'
import { useAuth } from '../lib/auth'
import { LANGGRAPH_URL, MENTOR_ASSISTANT_ID } from '../lib/config'

const UnderstandingCheck = lazy(() => import('../components/UnderstandingCheck').then((module) => ({ default: module.UnderstandingCheck })))
const SentenceStructure = lazy(() => import('../components/SentenceStructure').then((module) => ({ default: module.SentenceStructure })))
const SynonymComparison = lazy(() => import('../components/SynonymComparison').then((module) => ({ default: module.SynonymComparison })))

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

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_IMAGE_SIZE = 2 * 1024 * 1024

function imageOf(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  const part = content.find((item) => item?.type === 'image_url') as { image_url?: { url?: unknown } } | undefined
  const url = part?.image_url?.url
  return typeof url === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url) ? url : null
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
  const recoveryNumber = useRef(0)
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

  const recoverThread = (id: string) => {
    recoveryNumber.current += 1
    setCurrent({ id, key: `${id}:recovered:${recoveryNumber.current}`, ignorePrefill: true })
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
      <MentorThread key={current.key} threadId={current.id} onThreadId={onThreadId} onRecoverThread={recoverThread} userId={userId} accessToken={accessToken} ignorePrefill={current.ignorePrefill} />
    </div>
  )
}

function MentorThread({ threadId, onThreadId, onRecoverThread, userId, accessToken, ignorePrefill }: {
  threadId: string | null
  onThreadId: (id: string) => void
  onRecoverThread: (id: string) => void
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
  const [toolMode, setToolMode] = useState<'sentence' | 'synonym' | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [sending, setSending] = useState(false)
  const [deletingReply, setDeletingReply] = useState<string | null>(null)
  const [replyDeleteError, setReplyDeleteError] = useState('')
  const [lastSentImage, setLastSentImage] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const imageSelection = useRef(0)
  const cancelled = useRef(false)
  const recoveryAttempt = useRef(0)
  const bottomRef = useRef<HTMLDivElement>(null)
  const pendingInterrupts = stream.interrupts ?? []
  const hasPendingApproval = pendingInterrupts.length > 0

  // 从「我的高亮」跳转过来时预填问题
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill
    if (prefill && !ignorePrefill) setInput(prefill)
  }, [location.state, ignorePrefill])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [stream.messages.length])

  useEffect(() => () => { recoveryAttempt.current += 1 }, [])

  const recoverCompletedImageRun = async (knownMessageIds: Set<string>) => {
    const currentThreadId = stream.threadId
    if (!currentThreadId) {
      setImageError('导师回复未能完成。图片和问题已保留，请重试。')
      return false
    }
    const attempt = ++recoveryAttempt.current
    setRecovering(true)
    setImageError('连接暂时中断，正在同步导师已完成的回复…')

    for (let retry = 0; retry < 20; retry += 1) {
      if (retry > 0) await new Promise((resolve) => window.setTimeout(resolve, 1000))
      if (recoveryAttempt.current !== attempt) return true
      try {
        const state = await stream.client.threads.getState<{ messages?: { id?: string; type?: string; content?: unknown }[] }>(currentThreadId)
        const messages = state.values?.messages
        const hasNewReply = Array.isArray(messages) && messages.some((message) =>
          message.type === 'ai'
          && typeof message.id === 'string'
          && !knownMessageIds.has(message.id)
          && textOf(message.content).trim().length > 0,
        )
        if (hasNewReply) {
          setImageError('')
          setRecovering(false)
          setInput('')
          setImage(null)
          if (imageInputRef.current) imageInputRef.current.value = ''
          onRecoverThread(currentThreadId)
          return true
        }
      } catch {
        // A temporary state-read failure is expected while the stream reconnects.
      }
    }

    if (recoveryAttempt.current === attempt) {
      setRecovering(false)
      setImageError('导师回复未能完成。图片和问题已保留，请重试。')
    }
    return false
  }

  const selectImage = (file?: File) => {
    if (!file) return
    const selection = ++imageSelection.current
    setImage(null)
    setImageLoading(false)
    setImageError('')
    if (!IMAGE_TYPES.has(file.type)) {
      setImageError('仅支持 PNG、JPEG 或 WebP 图片。')
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setImageError('图片不能超过 2 MB。')
      return
    }
    setImageLoading(true)
    const reader = new FileReader()
    reader.onload = () => {
      if (imageSelection.current !== selection) return
      setImageLoading(false)
      if (typeof reader.result === 'string') setImage(reader.result)
      else setImageError('图片读取失败，请重试。')
    }
    reader.onerror = () => {
      if (imageSelection.current !== selection) return
      setImageLoading(false)
      setImageError('图片读取失败，请重试。')
    }
    reader.readAsDataURL(file)
  }

  const pasteImage = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = Array.from(e.clipboardData.files).find((item) => item.type.startsWith('image/'))
      ?? Array.from(e.clipboardData.items).find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    if (file) {
      e.preventDefault()
      selectImage(file)
    }
  }

  const toolLimit = toolMode === 'sentence' ? 1600 : 120
  const toolLength = toolMode === 'sentence' ? input.length : input.trim().length
  const overLimit = toolMode !== null && toolLength > toolLimit

  const selectTool = (mode: 'sentence' | 'synonym') => {
    setToolMode((current) => current === mode ? null : mode)
    composerRef.current?.focus()
  }

  const send = (e: FormEvent) => {
    e.preventDefault()
    const text = input.trim()
    if ((!text && !image) || imageLoading || stream.isLoading || stream.isThreadLoading || hasPendingApproval || sending || deletingReply) return
    if (toolMode && (image || overLimit)) return
    const ordinaryText = text.startsWith('句子结构分析请求：\n') ? `用户原文（非句子结构工具请求）：\n${text}`
      : text.startsWith(SYNONYM_REQUEST_PREFIX) ? `用户原文（非工具请求）：\n${text}` : text
    const content = toolMode === 'sentence' ? sentenceRequest(input) : toolMode === 'synonym' ? synonymRequest(text) : image ? [
      { type: 'text', text: ordinaryText || '请讲解这张图片中的英语内容。' },
      { type: 'image_url', image_url: { url: image } },
    ] : ordinaryText
    cancelled.current = false
    setSending(true)
    setRecovering(false)
    setImageError('')
    setLastSentImage(Boolean(image))
    const knownMessageIds = new Set(stream.messages.map((message) => message.id).filter((id): id is string => typeof id === 'string'))
    let runFailed = false
    // user_id / supabase_token 经 config.configurable 传给服务端工具
    //（服务端不采信对话文本里的身份；token 用于 RLS 授权读 whw_highlights）
    void stream.submit(
      { messages: [{ type: 'human', content }] },
      {
        config: {
          configurable: { user_id: userId ?? undefined, supabase_token: accessToken ?? undefined },
        },
        onError: () => {
          runFailed = true
          if (image) void recoverCompletedImageRun(knownMessageIds)
          else setImageError('发送失败，请重试。')
        },
      },
    ).then(() => {
      if (runFailed || cancelled.current) return
      setInput('')
      if (toolMode) setToolMode(null)
      ++imageSelection.current
      setImage(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }).catch(() => {
      if (image) void recoverCompletedImageRun(knownMessageIds)
      else setImageError('发送失败，请重试。')
    }).finally(() => setSending(false))
  }

  // human / ai / tool 全部展示：tool 消息就是"思考过程"（检索了哪篇笔记、读到了什么）
  const visibleMessages = stream.messages.filter(
    (m) => m.type === 'human' || m.type === 'ai' || m.type === 'tool',
  )

  async function answerCheck(checkId: string, question: string, answer: string) {
    if (sending || deletingReply || stream.isLoading || stream.isThreadLoading || hasPendingApproval) throw new Error('Mentor is busy')
    setSending(true)
    let failed = false
    try {
      await stream.submit({ messages: [{ type: 'human', content: understandingAnswer(checkId, question, answer) }] }, {
        config: { configurable: { user_id: userId ?? undefined, supabase_token: accessToken ?? undefined } },
        onError: () => { failed = true },
      })
      if (failed) throw new Error('Answer submission failed')
    } finally { setSending(false) }
  }

  // 删除整轮问答：导师回复与其上方的近义词/句子结构卡片属于同一次提问，只删回复会留下孤立卡片。
  async function deleteTurn(humanId: string) {
    const id = stream.threadId ?? threadId
    if (!id || deletingReply || sending || stream.isLoading || stream.isThreadLoading || hasPendingApproval) return
    if (!window.confirm('确定永久删除这一轮问答吗？你提的问题、导师回复及相关卡片都会移除，此操作无法撤销。')) return
    setDeletingReply(humanId)
    setReplyDeleteError('')
    try {
      const state = await stream.client.threads.getState(id)
      const response = await fetch(`${LANGGRAPH_URL.replace(/\/$/, '')}/chat/${encodeURIComponent(id)}/turns/${encodeURIComponent(humanId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ checkpoint_id: state.checkpoint?.checkpoint_id }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      onRecoverThread(id)
    } catch {
      setReplyDeleteError('删除这一轮问答失败，内容仍保留。请刷新对话后重试。')
    } finally { setDeletingReply(null) }
  }

  // 每个气泡/卡片都能删除它所属的这一轮：用户提问取自身，其余取往上最近的提问。
  // 垃圾桶放在气泡/卡片之外的一侧，不占用气泡内部空间，也不会被气泡底色吞掉。
  function turnTrash(index: number, className = 'shrink-0 self-end pb-1') {
    const own = visibleMessages[index]
    const questionId = own?.type === 'human' ? own.id : [...visibleMessages.slice(0, index)].reverse().find((item) => item.type === 'human')?.id
    if (!questionId) return null
    return <div className={className}>
      <Button type="button" variant="ghost" size="icon" aria-label="删除这一轮问答" title="删除这一轮问答（永久，无法撤销）"
        disabled={(!stream.threadId && !threadId) || deletingReply !== null || sending || stream.isLoading || stream.isThreadLoading || hasPendingApproval}
        onClick={() => void deleteTurn(questionId)} className="size-8 text-muted-foreground hover:text-destructive">
        {deletingReply === questionId ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </Button>
    </div>
  }

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
      {replyDeleteError && <p role="alert" className="text-sm text-destructive">{replyDeleteError}</p>}

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-2">
        {stream.isThreadLoading && <p role="status" className="text-sm text-muted-foreground">正在加载对话…</p>}
        {!stream.isThreadLoading && !hasPendingApproval && visibleMessages.length === 0 && (
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
            if (name === 'present_understanding_check') {
              const checkId = (msg as { tool_call_id?: string }).tool_call_id ?? msg.id
              if (!checkId) return null
              return <div key={msg.id ?? i} className="mx-2 flex min-w-0 items-start gap-1 sm:mx-8">
                <div className="min-w-0 max-w-2xl flex-1">
                  <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">正在加载理解检查…</p>}><UnderstandingCheck content={text} disabled={sending || stream.isLoading || stream.isThreadLoading || hasPendingApproval}
                    submittedAnswer={restoredUnderstandingAnswer(stream.messages, checkId)}
                    onAnswer={(question, answer) => answerCheck(checkId, question, answer)} /></Suspense>
                </div>
                {turnTrash(i)}
              </div>
            }
            if (name === 'present_sentence_structure') {
              const requested = visibleMessages.slice(0, i).reverse().find((item) => item.type === 'human')
              const source = requested ? sentenceRequestText(textOf(requested.content)) : undefined
              const structure = parseSentenceStructure(text)
              if (source !== undefined && structure?.sentence === source) {
                return <div key={msg.id ?? i} className="flex w-full min-w-0 items-start gap-1 px-2 sm:px-8">
                  <div className="min-w-0 flex-1">
                    <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">正在加载句子结构…</p>}>
                      <SentenceStructure content={text} />
                    </Suspense>
                  </div>
                  {turnTrash(i)}
                </div>
              }
              return <div key={msg.id ?? i} className="mx-2 flex items-center gap-1 sm:mx-8"><p role="status" className="min-w-0 flex-1 text-sm text-muted-foreground">结构图暂时无法显示，请让导师用文字解释这句话。</p>{turnTrash(i)}</div>
            }
            if (name === 'present_synonyms') {
              const requested = visibleMessages.slice(0, i).reverse().find((item) => item.type === 'human')
              const source = requested ? synonymRequestText(textOf(requested.content)) : undefined
              const comparison = parseSynonymComparison(text)
              if (source !== undefined && comparison?.source === source) {
                return <div key={msg.id ?? i} className="flex w-full min-w-0 items-start gap-1 px-2 sm:px-8">
                  <div className="min-w-0 flex-1">
                    <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">正在加载近义词辨析…</p>}>
                      <SynonymComparison content={text} />
                    </Suspense>
                  </div>
                  {turnTrash(i)}
                </div>
              }
              return <div key={msg.id ?? i} className="mx-2 flex items-center gap-1 sm:mx-8"><p role="status" className="min-w-0 flex-1 text-sm text-muted-foreground">近义词卡片暂时无法显示，请让导师用文字解释。</p>{turnTrash(i)}</div>
            }
            if (name === 'create_markdown' && text.includes('"markdown_artifact"')) {
              return <MarkdownArtifact key={msg.id ?? i} result={text} accessToken={accessToken} />
            }
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
          const messageImage = isHuman ? imageOf(msg.content) : null
          const toolCalls = (msg as { tool_calls?: { name?: string; args?: unknown }[] })
            .tool_calls
          // 本轮提问：往上找最近的一条用户消息；整轮删除以它为准。

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
          if (!text.trim() && !messageImage && !(toolCalls && toolCalls.length > 0)) return null

          return (
            <div key={msg.id ?? i} className={`flex items-end gap-1 ${isHuman ? 'justify-end' : 'justify-start'}`}>
              {isHuman && !(toolCalls && toolCalls.length > 0) && msg.id && turnTrash(i)}
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
                  <div className="space-y-2">
                    {messageImage && <img src={messageImage} alt="已发送图片" className="max-h-60 max-w-full rounded-lg object-contain" />}
                    {text && <p className="whitespace-pre-wrap">{understandingAnswerText(text) ?? sentenceRequestText(text) ?? synonymRequestText(text) ?? text}</p>}
                  </div>
                ) : (
                  <MarkdownView>{text}</MarkdownView>
                )}
              </div>
              {!isHuman && !(toolCalls && toolCalls.length > 0) && msg.id && turnTrash(i)}
            </div>
          )
        })}
        <MarkdownApproval interrupts={pendingInterrupts} disabled={stream.isLoading || stream.isThreadLoading}
          onRespond={(responses) => stream.respondAll(responses, {
            config: { configurable: { user_id: userId ?? undefined, supabase_token: accessToken ?? undefined } },
          })} />
        {stream.isLoading && <p role="status" className="mx-2 flex items-center gap-2 text-xs text-muted-foreground sm:mx-8"><ThinkingOrb state="working" size={20} aria-label="导师正在思考" />导师思考中…</p>}
        {stream.error != null && !recovering && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {lastSentImage ? '导师回复未能完成。图片和问题已保留，请重试。' : `连接出错，请确认服务已在 ${LANGGRAPH_URL} 启动。`}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <BorderBeam size="pulse-inner" colorVariant="ocean" theme="light" staticColors strength={toolMode ? 1 : 0.8} brightness={1.55} duration={3.6}
        style={{ boxShadow: toolMode
          ? '0 0 22px -5px rgba(89, 94, 232, 0.36), 0 0 42px -20px rgba(79, 137, 245, 0.4)'
          : '0 0 18px -6px rgba(89, 94, 232, 0.27), 0 0 36px -18px rgba(79, 137, 245, 0.32)' }}
        className="shrink-0 min-w-0 motion-safe:transition-shadow motion-safe:duration-700">
        <form onSubmit={send} className="space-y-2 rounded-xl border bg-card p-3 shadow-sm">
        {image && (
          <Dialog.Root>
            <div className="relative w-fit">
              <Dialog.Trigger asChild>
                <button type="button" aria-label="放大图片" className="block cursor-zoom-in rounded-lg focus-visible:outline-2 focus-visible:outline-primary">
                  <img src={image} alt="待发送图片" className="max-h-28 max-w-36 rounded-lg border object-contain" />
                </button>
              </Dialog.Trigger>
              <Button type="button" variant="secondary" size="icon" aria-label="移除图片" disabled={sending || stream.isLoading}
                onClick={() => { ++imageSelection.current; setImage(null); if (imageInputRef.current) imageInputRef.current.value = '' }}
                className="absolute -right-2 -top-2 size-7 rounded-full shadow-sm">
                <X className="size-4" />
              </Button>
            </div>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-[2px]" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[95dvh] w-[92vw] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 rounded-2xl bg-card p-3 shadow-2xl sm:p-5">
                <div className="flex w-full items-center justify-between gap-3">
                  <Dialog.Title className="text-sm font-medium">图片预览</Dialog.Title>
                  <Dialog.Close asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="关闭图片预览"><X /></Button>
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">待发送图片的大图预览。</Dialog.Description>
                <img src={image} alt="放大的待发送图片" className="max-h-[85dvh] max-w-full rounded-lg object-contain" />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
        {imageLoading && (
          <div role="status" className="flex h-20 w-fit min-w-36 items-center justify-center gap-2 rounded-lg border bg-accent/40 px-3 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />正在处理图片…
          </div>
        )}
        {imageError && <p role={recovering ? 'status' : 'alert'} className={`text-xs ${recovering ? 'text-amber-700' : 'text-destructive'}`}>{imageError}</p>}
        <div className="flex items-end gap-2">
          <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="选择图片"
            disabled={Boolean(toolMode) || sending || stream.isLoading} className="sr-only" onChange={(e: ChangeEvent<HTMLInputElement>) => selectImage(e.target.files?.[0])} />
          {!toolMode && (
            <Button type="button" variant="ghost" size="icon" aria-label="添加图片" title="添加图片（也可粘贴截图）"
              disabled={sending || stream.isLoading || stream.isThreadLoading || hasPendingApproval}
              onClick={() => imageInputRef.current?.click()} className="mb-1 shrink-0">
              <ImagePlus className="size-5" />
            </Button>
          )}
          <Textarea
            ref={composerRef}
            aria-label="输入问题"
            aria-describedby={toolMode ? 'mentor-tool-status' : undefined}
            aria-invalid={overLimit || undefined}
            disabled={sending || deletingReply !== null || stream.isLoading}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={toolMode ? undefined : pasteImage}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            rows={toolMode === 'synonym' ? 1 : 2}
            placeholder={toolMode === 'sentence' ? '粘贴一条英文句子，发送后分析主干与修饰关系…' : toolMode === 'synonym' ? '英文单词或短语，如 provide、take into account' : '输入你的问题或粘贴截图…（Enter 发送，Shift + Enter 换行）'}
            className={`max-h-40 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0 ${toolMode === 'synonym' ? 'min-h-12 resize-none' : 'resize-y'}`}
          />
          {stream.isLoading || sending ? (
            <Button variant="outline" type="button" onClick={() => { cancelled.current = true; void stream.stop() }} className="mb-1">
              <CircleStop />停止
            </Button>
          ) : (
            <Button type="submit" disabled={(!input.trim() && !image) || overLimit || imageLoading || sending || deletingReply !== null || stream.isThreadLoading || hasPendingApproval} className="mb-1 shrink-0">
              {toolMode === 'synonym' ? <GitCompareArrows /> : <ArrowUp />}{toolMode === 'synonym' ? '查找' : '发送'}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
          <Button type="button" size="sm" variant={toolMode === 'sentence' ? 'secondary' : 'ghost'} aria-pressed={toolMode === 'sentence'}
            disabled={Boolean(image) || imageLoading || sending || stream.isLoading || stream.isThreadLoading || hasPendingApproval}
            onClick={() => selectTool('sentence')} className={`min-h-10 rounded-full text-xs ${toolMode === 'sentence' ? 'ring-1 ring-primary/30' : ''}`}>
            <BookOpen className="size-3.5" />句子结构分析
          </Button>
          <Button type="button" size="sm" variant={toolMode === 'synonym' ? 'secondary' : 'ghost'} aria-pressed={toolMode === 'synonym'}
            disabled={Boolean(image) || imageLoading || sending || stream.isLoading || stream.isThreadLoading || hasPendingApproval}
            onClick={() => selectTool('synonym')} className={`min-h-10 rounded-full text-xs ${toolMode === 'synonym' ? 'ring-1 ring-primary/30' : ''}`}>
            <GitCompareArrows className="size-3.5" />查找近义词
          </Button>
          {toolMode && <>
            <span role="status" className="sr-only">{toolMode === 'sentence' ? '句子结构分析' : '查找近义词'}</span>
            <span id="mentor-tool-status" role={overLimit ? 'alert' : undefined}
              className={`ml-auto text-xs tabular-nums ${overLimit ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
              {overLimit ? `已输入 ${toolLength}/${toolLimit} 字，超出限制，请缩短后发送` : `${toolLength}/${toolLimit}`}
            </span>
            <Button type="button" variant="ghost" size="icon" aria-label="取消工具选择" title="取消工具选择"
              disabled={sending || stream.isLoading}
              onClick={() => { setToolMode(null); composerRef.current?.focus() }} className="size-8 shrink-0">
              <X className="size-3.5" />
            </Button>
          </>}
        </div>
        </form>
      </BorderBeam>
    </div>
  )
}
