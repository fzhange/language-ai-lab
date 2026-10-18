import { useEffect, useState } from 'react'
import { Download, Eye, FileText, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { LANGGRAPH_URL } from '../lib/config'
import { MarkdownView } from './MarkdownView'
import { Button } from './ui/button'
import { Card } from './ui/card'

function MarkdownPreview({ artifactId, accessToken, onRetry }: {
  artifactId: string
  accessToken: string | null
  onRetry: () => void
}) {
  const [result, setResult] = useState<{ token: string | null; content?: string; error?: string } | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await fetch(`${LANGGRAPH_URL.replace(/\/$/, '')}/artifacts/${artifactId}/download`, {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
          signal: controller.signal,
        })
        if (!response.ok) throw new Error('preview failed')
        const content = await response.text()
        if (!controller.signal.aborted) setResult({ token: accessToken, content })
      } catch {
        if (!controller.signal.aborted) setResult({ token: accessToken, error: '预览加载失败，请确认登录状态和服务连接后重试。' })
      }
    }
    void load()
    return () => controller.abort()
  }, [artifactId, accessToken])

  if (!result || result.token !== accessToken) return <p role="status" className="text-sm text-muted-foreground">正在加载文档…</p>
  if (result.error) return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-destructive">{result.error}</p>
      <Button type="button" variant="outline" onClick={onRetry}>重新加载</Button>
    </div>
  )
  return <MarkdownView>{result.content ?? ''}</MarkdownView>
}

export function MarkdownArtifact({ result, accessToken }: { result: string; accessToken: string | null }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  let artifact: { type?: string; artifact_id?: string; filename?: string }
  try {
    artifact = JSON.parse(result)
  } catch {
    return null
  }
  if (artifact?.type !== 'markdown_artifact' || typeof artifact.artifact_id !== 'string'
    || !/^[a-f0-9]{64}$/.test(artifact.artifact_id) || typeof artifact.filename !== 'string'
    || !artifact.filename.endsWith('.md') || [...artifact.filename].some((char) =>
      char === '/' || char === '\\' || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
  const id = artifact.artifact_id
  const filename = artifact.filename

  const download = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    let url: string | undefined
    try {
      const response = await fetch(`${LANGGRAPH_URL.replace(/\/$/, '')}/artifacts/${id}/download`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      })
      if (!response.ok) throw new Error('download failed')
      url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      setError('下载失败，请确认登录状态和服务连接后重试。')
    } finally {
      if (url) URL.revokeObjectURL(url)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={previewOpen} onOpenChange={setPreviewOpen}>
      <Card className="gap-3 border-primary/15 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <FileText className="size-5 text-primary" />
          <Dialog.Trigger asChild>
            <button type="button" aria-label={`预览 ${filename}`} className="min-w-0 flex-1 rounded-md text-left text-sm font-medium break-all hover:text-primary focus-visible:outline-2 focus-visible:outline-primary">{filename}</button>
          </Dialog.Trigger>
          <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}><Eye />预览</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void download()} aria-label={`下载 ${filename}`}><Download />下载 Markdown</Button>
        </div>
        {!previewOpen && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </Card>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex h-[85dvh] w-[85vw] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-2xl border bg-card p-5 shadow-2xl sm:p-7">
          <header className="flex shrink-0 items-start gap-3 border-b pb-4">
            <FileText className="mt-1 size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 space-y-1">
              <Dialog.Title className="text-lg font-semibold break-all">{filename}</Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">已保存文档的只读预览，不会重新生成或修改文件。</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="关闭预览"><X /></Button>
            </Dialog.Close>
          </header>
          <article className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-2">
            <MarkdownPreview key={`${id}:${previewAttempt}`} artifactId={id} accessToken={accessToken} onRetry={() => setPreviewAttempt((attempt) => attempt + 1)} />
          </article>
          <footer className="flex shrink-0 flex-col gap-3 border-t pt-4">
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end">
              <Button type="button" variant="outline" disabled={busy} onClick={() => void download()} aria-label={`下载 ${filename}`}><Download />下载 Markdown</Button>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
