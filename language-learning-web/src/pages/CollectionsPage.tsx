import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { Bookmark, Plus, Trash2, Pencil, ArrowDown } from 'lucide-react'
import { AlertDialog, Dialog } from 'radix-ui'

import { CollectionEditor } from '../components/CollectionEditor'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useAuth } from '../lib/auth'
import { collectionPlainText, parseCollectionDoc, parseSafeCollectionUrl, type CollectionDoc, type CollectionNode } from '../lib/collection-document'
import { createCollection, deleteCollection, listCollections, updateCollection } from '../lib/collections'
import type { CollectionRow } from '../lib/supabase'

const PAGE_SIZE = 50

type Draft = { doc: CollectionDoc; text: string }
type EditorState = { id: string | null; initialDoc: CollectionDoc | null; session: number }

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
  switch (node.type) {
    case 'paragraph': return <p key={key} style={{ textAlign: align }} className="min-h-7 whitespace-pre-wrap">{children}</p>
    case 'heading': {
      const Tag = `h${node.attrs?.level}` as 'h1' | 'h2' | 'h3'
      const size = node.attrs?.level === 1 ? 'text-2xl' : node.attrs?.level === 2 ? 'text-xl' : 'text-lg'
      return <Tag key={key} style={{ textAlign: align }} className={`mt-3 mb-1 font-semibold leading-snug ${size}`}>{children}</Tag>
    }
    case 'blockquote': return <blockquote key={key} className="my-2 border-l-2 border-primary/50 pl-4 text-muted-foreground">{children}</blockquote>
    case 'bulletList': return <ul key={key} className="my-2 list-disc space-y-1 pl-6">{children}</ul>
    case 'orderedList': return <ol key={key} start={node.attrs?.start} className="my-2 list-decimal space-y-1 pl-6">{children}</ol>
    case 'listItem': return <li key={key} className="pl-0.5">{children}</li>
    default: return null
  }
}

function Preview({ doc }: { doc: CollectionDoc }) {
  return <div className="space-y-2 break-words text-base leading-7" aria-label="收藏预览">{doc.content.map(previewNode)}</div>
}

function CollectionsView({ user }: { user: User }) {
  const [rows, setRows] = useState<CollectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [actionError, setActionError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pending, setPending] = useState(false)
  const [editing, setEditing] = useState<EditorState | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [invalidDraft, setInvalidDraft] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const busy = useRef(false)
  const session = useRef(0)
  const listVersion = useRef(0)

  useEffect(() => {
    let cancelled = false
    const version = ++listVersion.current
    void listCollections(null, PAGE_SIZE)
      .then((items) => {
        if (!cancelled && version === listVersion.current) { setRows(items); setHasMore(items.length === PAGE_SIZE); setListError('') }
      })
      .catch((cause: Error) => { if (!cancelled && version === listVersion.current) setListError(cause.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [user.id])

  async function refresh() {
    const version = ++listVersion.current
    setLoading(true)
    try {
      const items = await listCollections(null, PAGE_SIZE)
      if (version === listVersion.current) {
        setRows(items)
        setHasMore(items.length === PAGE_SIZE)
        setListError('')
      }
    } catch (cause) {
      if (version === listVersion.current) setListError((cause as Error).message)
    } finally {
      if (version === listVersion.current) setLoading(false)
    }
  }

  async function loadMore() {
    if (loadingMore || loading) return
    const version = listVersion.current
    setLoadingMore(true)
    setListError('')
    try {
      const last = rows.at(-1)
      const items = await listCollections(last ? { created_at: last.created_at, id: last.id } : null, PAGE_SIZE)
      if (version === listVersion.current) {
        setRows((current) => [...current, ...items])
        setHasMore(items.length === PAGE_SIZE)
      }
    } catch (cause) {
      if (version === listVersion.current) setListError((cause as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  function startNew() {
    setActionError('')
    setInvalidDraft(false)
    setDraft(null)
    setEditing({ id: null, initialDoc: null, session: ++session.current })
  }

  function startEdit(row: CollectionRow) {
    const doc = parseCollectionDoc(row.content_doc)
    if (!doc) return
    setActionError('')
    setInvalidDraft(false)
    setDraft({ doc, text: collectionPlainText(doc) })
    setEditing({ id: row.id, initialDoc: doc, session: ++session.current })
  }

  function discard() {
    setConfirmDiscard(false)
    setEditing(null)
    setDraft(null)
    setInvalidDraft(false)
    setActionError('')
  }

  function requestClose() {
    if (pending || !editing) return
    const original = editing.initialDoc ?? { type: 'doc', content: [{ type: 'paragraph' }] }
    if (invalidDraft || (draft && JSON.stringify(draft.doc) !== JSON.stringify(original))) {
      setConfirmDiscard(true)
    } else {
      discard()
    }
  }

  async function save() {
    const doc = draft?.doc
    if (busy.current || !user || !editing || invalidDraft || !doc || !collectionPlainText(doc).trim()) return
    busy.current = true
    setPending(true)
    setActionError('')
    try {
      const text = collectionPlainText(doc)
      const saved = editing.id
        ? await updateCollection(editing.id, user.id, text, doc)
        : await createCollection(user.id, text, doc)
      ++listVersion.current
      setRows((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
      setLoading(false)
      setEditing(null)
      setDraft(null)
      await refresh()
    } catch (cause) {
      setActionError((cause as Error).message)
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  async function remove() {
    if (busy.current || !user || !confirmId) return
    busy.current = true
    setPending(true)
    setActionError('')
    try {
      await deleteCollection(confirmId, user.id)
      ++listVersion.current
      setRows((current) => current.filter((item) => item.id !== confirmId))
      setLoading(false)
      setConfirmId(null)
      await refresh()
    } catch (cause) {
      setActionError((cause as Error).message)
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-7 px-4 py-8 pb-24 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-primary"><Bookmark className="size-6" /></span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">我的收藏</h1>
            <p className="mt-1 text-sm text-muted-foreground">把其他地方遇见的好句子收集起来，为值得记住的词句添上颜色。</p>
          </div>
        </div>
        {(loading || rows.length > 0 || editing || listError) && <Button type="button" onClick={startNew} disabled={pending}><Plus />新增收藏</Button>}
      </header>

      <Dialog.Root open={Boolean(editing)} onOpenChange={(open) => { if (!open) requestClose() }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex h-[85vh] w-[90vw] -translate-x-1/2 -translate-y-1/2 flex-col gap-5 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-7">
            <div className="shrink-0 space-y-1">
              <Dialog.Title className="text-xl font-semibold text-slate-900">{editing?.id ? '编辑收藏' : '记录新发现'}</Dialog.Title>
              <Dialog.Description className="text-sm leading-relaxed text-muted-foreground">粘贴纯文本，选中词句后使用上方色板；不保留原网页格式。</Dialog.Description>
            </div>
            {editing && <CollectionEditor key={editing.session} initialDoc={editing.initialDoc} disabled={pending} onChange={(doc) => {
              setInvalidDraft(!doc)
              setDraft(doc ? { doc, text: collectionPlainText(doc) } : null)
            }} />}
            {editing && invalidDraft && <p role="alert" className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">内容格式无效或超出长度限制，请调整后再保存。</p>}
            {editing && actionError && <p role="alert" className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{actionError}</p>}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">Enter 与 Shift + Enter 换行 · 点击保存收藏</span>
              <div className="ml-auto flex gap-3">
                <Button type="button" variant="outline" disabled={pending} onClick={requestClose}>取消</Button>
                <Button type="button" disabled={pending || invalidDraft || !draft?.text.trim()} onClick={() => void save()}>{pending ? '保存中…' : '保存收藏'}</Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <AlertDialog.Root open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-slate-950/55" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
            <AlertDialog.Title className="text-lg font-semibold text-slate-900">放弃未保存的修改？</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-muted-foreground">关闭后，本次编辑的内容将不会保存。</AlertDialog.Description>
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild><Button variant="outline">继续编辑</Button></AlertDialog.Cancel>
              <AlertDialog.Action asChild><Button variant="destructive" onClick={discard}>放弃修改</Button></AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {!editing && actionError && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{actionError}</p>}
      {listError && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">加载收藏失败：{listError}</p>}

      {loading && rows.length === 0 && !editing ? <p className="py-16 text-center text-muted-foreground">加载中…</p> : rows.length === 0 ? (!listError ? (
        <Card className="flex flex-col gap-0 rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-blue-50/70 p-0 shadow-sm sm:flex-row">
          <div className="flex flex-1 flex-col items-start gap-4 px-6 py-8 sm:px-9 sm:py-10">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-blue-50 text-primary"><Bookmark className="size-5" /></span>
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">还没有收藏</h2>
              <p className="max-w-md text-sm leading-7 text-muted-foreground">遇到值得记下的词句？粘贴在这里，挑出重点，加一点颜色。你的第一条收藏，从现在开始。</p>
            </div>
            <Button type="button" onClick={startNew}><Plus />新增收藏</Button>
          </div>
          <div className="hidden w-64 flex-col justify-center gap-5 border-l border-blue-100/70 px-7 text-sm text-slate-500 sm:flex" aria-hidden="true">
            <p><span className="mr-3 font-semibold text-primary">01</span>复制文字</p>
            <p><span className="mr-3 font-semibold text-primary">02</span>粘贴并标色</p>
            <p><span className="mr-3 font-semibold text-primary">03</span>随时回来阅读</p>
          </div>
        </Card>
      ) : null) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((row) => {
            const doc = parseCollectionDoc(row.content_doc)
            return (
              <Card key={row.id} className="justify-between gap-5 p-5 shadow-sm sm:p-6">
                {doc ? <Preview doc={doc} /> : <p role="status" className="text-sm text-destructive">内容格式无效，暂时无法预览或编辑。</p>}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <time dateTime={row.created_at} className="text-xs text-muted-foreground">{new Date(row.created_at).toLocaleString('zh-CN')}</time>
                  <div className="flex gap-2">
                    {doc && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => startEdit(row)} aria-label="编辑收藏"><Pencil />编辑</Button>}
                    {confirmId === row.id ? (
                      <>
                        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setConfirmId(null)}>取消删除</Button>
                        <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => void remove()}>确认删除</Button>
                      </>
                    ) : <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => { setConfirmId(row.id); setActionError('') }} aria-label="删除收藏"><Trash2 />删除</Button>}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {hasMore && !loading && <div className="flex justify-center"><Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}><ArrowDown />{loadingMore ? '加载中…' : '加载更多'}</Button></div>}
    </div>
  )
}

export function CollectionsPage() {
  const { user, supabaseReady } = useAuth()
  if (!supabaseReady) return <div className="p-10 text-center text-muted-foreground">未配置 Supabase，无法管理收藏。</div>
  if (!user) return <div className="p-10 text-center text-muted-foreground">请先登录，才能查看收藏。</div>
  return <CollectionsView key={user.id} user={user} />
}
