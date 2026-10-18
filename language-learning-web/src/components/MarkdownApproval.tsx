import { useRef, useState } from 'react'
import { FileText, ShieldCheck } from 'lucide-react'
import { MarkdownView } from './MarkdownView'
import { Button } from './ui/button'
import { Card } from './ui/card'

interface PendingInterrupt {
  id?: string
  value?: unknown
}
interface Action {
  name: string
  args: { filename?: string; content?: string }
}

function actionsOf(value: unknown): Action[] | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as { action_requests?: unknown; actionRequests?: unknown }
  const actions = payload.action_requests ?? payload.actionRequests
  if (!Array.isArray(actions) || actions.length === 0) return null
  if (!actions.every((action) => typeof action?.name === 'string')) return null
  return actions.map((action) => ({ name: action.name, args: {
    filename: typeof action.args?.filename === 'string' ? action.args.filename : undefined,
    content: typeof action.args?.content === 'string' ? action.args.content : undefined,
  } }))
}

export function MarkdownApproval({ interrupts, disabled, onRespond }: {
  interrupts: readonly PendingInterrupt[]
  disabled: boolean
  onRespond: (responses: Record<string, unknown>) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState('')
  if (interrupts.length === 0) return null
  const requests = interrupts.map((interrupt) => ({ id: interrupt.id, actions: actionsOf(interrupt.value) }))
  const canRespond = requests.every((request) => request.id && request.actions)
  const canApprove = canRespond && requests.every((request) => request.actions!.every((action) =>
    action.name === 'create_markdown' && typeof action.args.filename === 'string' && typeof action.args.content === 'string'))

  const decide = async (type: 'approve' | 'reject') => {
    if (!canRespond || (type === 'approve' && !canApprove) || submitting.current || disabled) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      const responses = Object.fromEntries(requests.map((request) => [request.id!, {
        decisions: request.actions!.map(() => type === 'approve' ? { type } : {
          type, message: '用户拒绝创建该 Markdown 文件。不要重试或使用其他工具绕过审批，等待用户新的明确要求。',
        }),
      }]))
      await onRespond(responses)
    } catch {
      setError('审批提交失败，请重试。')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  return (
    <Card className="gap-4 border-primary/20 bg-accent/30 p-5">
      <div className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-5 text-primary" />创建 Markdown 需要你的批准</div>
      <p className="text-sm text-muted-foreground">请检查以下文件内容。批准后才会保存到服务器，拒绝不会创建文件。</p>
      {requests.map((request, i) => request.actions?.map((action, j) => (
        <section key={`${request.id ?? i}:${j}`} className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium"><FileText className="size-4" />{action.args.filename ?? action.name}</div>
          {action.args.content !== undefined && <div className="max-h-72 overflow-y-auto rounded-lg border bg-card p-4"><MarkdownView>{action.args.content}</MarkdownView></div>}
        </section>
      )))}
      {!canApprove && <p role="alert" className="text-sm text-destructive">审批请求参数不完整或无法识别，不能批准；可识别的请求仍可拒绝。</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" disabled={!canApprove || disabled || busy} onClick={() => void decide('approve')}>批准创建</Button>
        <Button type="button" variant="outline" disabled={!canRespond || disabled || busy} onClick={() => void decide('reject')}>拒绝</Button>
      </div>
      {busy && <p role="status" className="text-xs text-muted-foreground">正在提交审批…</p>}
    </Card>
  )
}
