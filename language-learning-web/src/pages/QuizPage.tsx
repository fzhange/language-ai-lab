/** 复习测验页：基于插件沉淀的高亮出题（vocab-quiz 图谱），两阶段交互：出题 → 答题 → 批改。 */

import { useState } from 'react'
import { ArrowRight, ListChecks, RotateCw, Sparkles } from 'lucide-react'

import { MarkdownView } from '../components/MarkdownView'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Textarea } from '../components/ui/textarea'
import { runOnce, type ChatMessage } from '../lib/agent'
import { useAuth } from '../lib/auth'

const ASSISTANT_ID = 'vocab-quiz'

type Phase = 'idle' | 'loading' | 'answering' | 'grading'

export function QuizPage() {
  const { user, accessToken, supabaseReady } = useAuth()
  const [phase, setPhase] = useState<Phase>('idle')
  const [history, setHistory] = useState<ChatMessage[]>([])
  const [quiz, setQuiz] = useState('')
  const [grading, setGrading] = useState('')
  const [answers, setAnswers] = useState('')
  const [error, setError] = useState('')

  const auth = { userId: user?.id, accessToken }

  const start = async () => {
    setPhase('loading')
    setError('')
    setQuiz('')
    setGrading('')
    setAnswers('')
    try {
      const messages: ChatMessage[] = [{ type: 'human', content: '请基于我的高亮出题' }]
      const text = await runOnce(ASSISTANT_ID, messages, auth)
      setHistory([...messages, { type: 'ai', content: text }])
      setQuiz(text)
      setPhase('answering')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('idle')
    }
  }

  const submitAnswers = async () => {
    if (!answers.trim()) return
    setPhase('grading')
    setError('')
    try {
      const messages: ChatMessage[] = [
        ...history,
        { type: 'human', content: `我的答案：\n${answers.trim()}` },
      ]
      const text = await runOnce(ASSISTANT_ID, messages, auth)
      setHistory([...messages, { type: 'ai', content: text }])
      setGrading(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('answering')
    }
  }

  if (supabaseReady && !user) {
    return <div className="p-10 text-center text-sm text-muted-foreground">请先登录后再开始测验。</div>
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-primary"><ListChecks className="size-5" /></span>
          <div>
            <h2 className="text-lg font-semibold">复习测验</h2>
            <p className="mt-1 text-xs text-muted-foreground">题目来自你在 Words Highlight 插件里划过的高亮</p>
          </div>
        </div>
        <Button onClick={() => void start()} disabled={phase === 'loading' || phase === 'grading'}>
          {phase === 'idle' ? <Sparkles /> : <RotateCw />}{phase === 'idle' ? '开始测验' : '换一批题'}
        </Button>
      </header>

      {error && (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-xs text-destructive">
          {error}（请确认 generic-agent-service 已启动且已登录）
        </p>
      )}

      {phase === 'loading' && (
        <Card className="items-center px-6 py-16 text-center text-sm text-muted-foreground"><Sparkles className="size-6 animate-pulse text-primary" />正在读取你的高亮并出题…</Card>
      )}

      {quiz && (
        <Card className="p-6"><MarkdownView>{quiz}</MarkdownView></Card>
      )}

      {phase === 'answering' && (
        <Card className="gap-4 p-6">
          <label htmlFor="quiz-answers" className="text-sm font-medium">你的答案（如：1A 2B 3. …）</label>
          <Textarea id="quiz-answers" value={answers} onChange={(e) => setAnswers(e.target.value)} rows={4} placeholder="1A 2C 3. The word abandon means..." />
          <Button onClick={() => void submitAnswers()} disabled={!answers.trim()} className="self-start"><ArrowRight />提交答案</Button>
        </Card>
      )}

      {phase === 'grading' && (
        <p className="py-6 text-center text-sm text-muted-foreground">导师批改中…</p>
      )}

      {grading && (
        <Card className="gap-3 border-primary/20 bg-accent/30 p-6">
          <h3 className="text-sm font-semibold text-primary">批改结果</h3>
          <MarkdownView>{grading}</MarkdownView>
        </Card>
      )}

      {phase === 'idle' && !quiz && !error && (
        <Card className="items-center gap-3 px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-primary"><ListChecks className="size-6" /></span>
          <h3 className="font-semibold">准备好检验学习成果了吗？</h3>
          <p className="text-sm text-muted-foreground">点击「开始测验」，导师会基于你划过的高亮生成 5-8 道题</p>
        </Card>
      )}
    </div>
  )
}
