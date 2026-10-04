/** 写作批改页：提交作文给 writing-coach 图谱，按雅思 TR/CC/LR/GRA 四维度批改。 */

import { useState } from 'react'
import { ArrowRight, PenLine, Sparkles } from 'lucide-react'

import { MarkdownView } from '../components/MarkdownView'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { runOnce } from '../lib/agent'
import { useAuth } from '../lib/auth'

const ASSISTANT_ID = 'writing-coach'

export function WritingPage() {
  const { user, accessToken } = useAuth()
  const [topic, setTopic] = useState('')
  const [essay, setEssay] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!essay.trim() || loading) return
    setLoading(true)
    setError('')
    setResult('')
    try {
      const content = topic.trim()
        ? `【题目】\n${topic.trim()}\n\n【作文】\n${essay.trim()}`
        : essay.trim()
      const text = await runOnce(
        ASSISTANT_ID,
        [{ type: 'human', content }],
        { userId: user?.id, accessToken },
      )
      setResult(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const wordCount = essay.trim() ? essay.trim().split(/\s+/).length : 0

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-8">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary"><PenLine className="size-5" /></span>
          <div>
            <h2 className="text-lg font-semibold">写作批改</h2>
            <p className="mt-1 text-xs text-muted-foreground">按雅思四维度（TR / CC / LR / GRA）批改，目标 6.5 分</p>
          </div>
        </div>
        <Badge variant="outline" className="hidden sm:inline-flex">IELTS Writing</Badge>
      </header>

      <Card className="gap-5 p-6">
        <div className="space-y-2">
          <label htmlFor="writing-topic" className="text-sm font-medium">作文题目 <span className="font-normal text-muted-foreground">（可选）</span></label>
          <Input id="writing-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="输入作文题目" />
        </div>
        <div className="space-y-2">
          <label htmlFor="writing-essay" className="text-sm font-medium">你的作文</label>
          <Textarea id="writing-essay" value={essay} onChange={(e) => setEssay(e.target.value)} rows={12} placeholder="粘贴你的英文作文…" className="leading-relaxed" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{wordCount} 词</span>
          <Button onClick={() => void submit()} disabled={!essay.trim() || loading}>
            {loading ? <Sparkles className="animate-pulse" /> : <ArrowRight />}{loading ? '批改中…' : '提交批改'}
          </Button>
        </div>
      </Card>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-xs text-destructive">
          {error}（请确认 generic-agent-service 已启动）
        </p>
      )}

      {result && (
        <Card className="gap-4 p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" />批改反馈</h3>
          <MarkdownView>{result}</MarkdownView>
        </Card>
      )}
    </div>
  )
}
