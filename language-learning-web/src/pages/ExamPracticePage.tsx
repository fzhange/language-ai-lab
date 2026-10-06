import { useRef, useState } from 'react'
import { ArrowRight, BookOpen, CheckCircle2, ClipboardList, RotateCw, Sparkles } from 'lucide-react'

import { ExamQuestion } from '../components/exam/ExamQuestion'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { useAuth } from '../lib/auth'
import { createExam, submitExam, type Choice, type ExamPaper, type ExamResult, type Level, type Source, type Topic } from '../lib/exam'

const LEVELS: { id: Level; label: string; subtitle: string }[] = [
  { id: 'ielts', label: '雅思', subtitle: '学术阅读 · 语言运用' },
  { id: 'cet', label: '四六级', subtitle: '大学英语 · 进阶训练' },
  { id: 'senior', label: '高中', subtitle: '语篇理解 · 语法应用' },
  { id: 'junior', label: '初中', subtitle: '基础巩固 · 阅读入门' },
]

export function ExamPracticePage() {
  const { accessToken, user } = useAuth()
  const [level, setLevel] = useState<Level>('ielts')
  const [topic, setTopic] = useState<Topic>('grammar')
  const [source, setSource] = useState<Source>('simulated')
  const [paper, setPaper] = useState<ExamPaper | null>(null)
  const [answers, setAnswers] = useState<Record<string, Choice>>({})
  const [result, setResult] = useState<ExamResult | null>(null)
  const [phase, setPhase] = useState<'setup' | 'loading' | 'answering' | 'grading' | 'result'>('setup')
  const [error, setError] = useState('')
  const [empty, setEmpty] = useState('')
  const pending = useRef(false)
  const selectedLevel = LEVELS.find((entry) => entry.id === level)!
  const unanswered = result?.results.filter((entry) => !entry.correct).length ?? 0

  const start = () => {
    if (pending.current || !accessToken) return
    pending.current = true
    setPhase('loading')
    setError('')
    setEmpty('')
    setPaper(null)
    setAnswers({})
    setResult(null)
    void createExam({ level, topic, source }, accessToken)
      .then((response) => {
        if (response.status === 'empty') {
          setEmpty(response.message)
          setPhase('setup')
          return
        }
        setPaper(response)
        setPhase('answering')
      })
      .catch((cause: Error) => { console.error('练习出题失败', cause); setError(cause.message); setPhase('setup') })
      .finally(() => { pending.current = false })
  }

  const submit = () => {
    if (!paper || pending.current || !accessToken) return
    pending.current = true
    setPhase('grading')
    setError('')
    void submitExam(paper.session, answers, accessToken)
      .then((response) => { setResult(response); setPhase('result') })
      .catch((cause: Error) => { console.error('练习交卷失败', cause); setError(cause.message); setPhase('answering') })
      .finally(() => { pending.current = false })
  }

  const back = () => { setPaper(null); setResult(null); setAnswers({}); setError(''); setEmpty(''); setPhase('setup') }
  const pickLevel = (next: Level) => { setLevel(next); setEmpty(''); setError('') }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-7 px-4 py-7 pb-24 sm:px-8 lg:px-10">
      <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#2646BD] via-[#365CF2] to-[#6783FF] px-7 py-9 text-white shadow-xl shadow-blue-500/15 sm:px-10">
        <div className="pointer-events-none absolute -top-24 right-0 size-72 rounded-full border border-white/20 bg-white/10 blur-2xl" />
        <p className="relative mb-3 flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-blue-100 uppercase"><Sparkles className="size-4" /> LANGUAGE LAB · PRACTICE</p>
        <h1 className="relative text-[28px] leading-tight font-bold tracking-tight sm:text-3xl">让每一道题，都成为理解的起点。</h1>
        <p className="relative mt-3 max-w-2xl text-sm leading-7 text-blue-50/90">聚焦语法与阅读理解。选择适合你的考试范围，点选作答，交卷后查看逐题中文解析。</p>
        <div className="relative mt-6 flex flex-wrap gap-3 text-xs"><span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur-sm">四类学习阶段</span><span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur-sm">四选一 · 即时反馈</span><span className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur-sm">理解，而非死记</span></div>
      </section>

      <section aria-label="考试范围" className="flex flex-col gap-3">
        <div><h2 className="text-lg font-semibold text-[#20232B]">选择考试范围</h2><p className="mt-1 text-sm text-slate-500">按目标切换，题目难度随之调整</p></div>
        <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {LEVELS.map((item) => <button key={item.id} type="button" aria-label={item.label} disabled={phase !== 'setup'} aria-pressed={level === item.id} onClick={() => pickLevel(item.id)} className={`flex min-w-[120px] flex-1 cursor-pointer flex-col items-start rounded-xl px-4 py-3 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#365CF2] disabled:cursor-not-allowed ${level === item.id ? 'bg-[#365CF2] text-white shadow-md shadow-blue-500/20' : 'text-[#20232B] hover:bg-slate-50'}`}><span className="text-sm font-semibold">{item.label}</span><span className={`mt-1 text-xs ${level === item.id ? 'text-blue-100' : 'text-slate-500'}`}>{item.subtitle}</span></button>)}
        </div>
      </section>

      {phase === 'setup' && <section className="grid gap-5 md:grid-cols-2">
        <Card className="gap-3 rounded-2xl border-slate-200 p-6 shadow-sm"><div className="flex items-center gap-2"><ClipboardList className="size-5 text-[#365CF2]" /><h2 className="font-semibold">练习考点</h2></div><p className="text-sm text-slate-500">先锁定想要强化的能力</p><div className="flex flex-wrap gap-2">{([['grammar', '语法'], ['reading', '阅读理解']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={topic === id} onClick={() => { setTopic(id); setEmpty('') }} className={`cursor-pointer rounded-xl border px-4 py-2.5 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-[#365CF2] ${topic === id ? 'border-[#365CF2] bg-blue-50 text-[#2646BD]' : 'border-slate-200 hover:border-blue-200'}`}>{label}</button>)}</div></Card>
        <Card className="gap-3 rounded-2xl border-slate-200 p-6 shadow-sm"><div className="flex items-center gap-2"><BookOpen className="size-5 text-[#365CF2]" /><h2 className="font-semibold">题目来源</h2></div><p className="text-sm text-slate-500">仿真原创与真实原题严格区分</p><div className="flex flex-wrap gap-2">{([['simulated', 'AI 仿真原创'], ['authentic', '真题']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={source === id} onClick={() => { setSource(id); setEmpty('') }} className={`cursor-pointer rounded-xl border px-4 py-2.5 text-sm font-medium transition-all focus-visible:outline-2 focus-visible:outline-[#365CF2] ${source === id ? 'border-[#365CF2] bg-blue-50 text-[#2646BD]' : 'border-slate-200 hover:border-blue-200'}`}>{label}</button>)}</div></Card>
      </section>}

      {phase === 'setup' && <div className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 to-white p-5 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm leading-6 text-slate-600">{source === 'authentic' ? '真题仅展示已获本站使用许可的内容；无授权题目时会明确告知。' : 'AI 仿真原创题由模型生成，并非历年考试原题。'}{level === 'ielts' && topic === 'grammar' && source === 'authentic' ? ' 雅思没有独立的官方语法选择题科目。' : ''}</p><Button className="h-10 cursor-pointer px-5" onClick={start} disabled={!user || !accessToken}><Sparkles />开始练习<ArrowRight /></Button></div>}

      {!accessToken && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">请先登录并配置 Supabase 后再开始专项练习。</p>}
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
      {empty && <Card className="items-center gap-3 rounded-2xl border-dashed p-10 text-center"><BookOpen className="size-8 text-[#365CF2]" /><h3 className="font-semibold">暂时没有可用真题</h3><p className="text-sm text-slate-600">{empty}</p></Card>}
      {phase === 'loading' && <Card className="items-center gap-3 rounded-2xl p-14 text-sm text-slate-500"><RotateCw className="size-6 animate-spin text-[#365CF2]" />正在准备 {selectedLevel.label} {topic === 'reading' ? '阅读理解' : '语法'}练习…</Card>}

      {paper && <section className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${paper.source === 'authentic' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-[#2646BD]'}`}>{paper.source === 'authentic' ? '已授权真实原题' : 'AI 仿真原创 · 非历年真题'}</span><span className="text-sm text-slate-500">{selectedLevel.label} · {paper.topic === 'reading' ? '阅读理解' : '语法'} · 共 {paper.questions.length} 题</span>{paper.origin && <a className="text-xs text-[#2646BD] underline-offset-4 hover:underline" href={paper.origin.url} target="_blank" rel="noopener noreferrer">出处：{paper.origin.name} · {paper.origin.year} · {paper.origin.region}</a>}</div>
        {result && <Card className="flex flex-col gap-2 rounded-2xl border-blue-200 bg-blue-50 p-6"><p className="flex items-center gap-2 text-sm font-semibold text-[#2646BD]"><CheckCircle2 className="size-5" />本次练习成绩</p><p className="text-3xl font-bold tracking-tight text-[#20232B]">{result.score} / {result.total}</p><p className="text-sm text-slate-600">{unanswered} 道待复习 · 下方可查看每题的正确选项与中文解析</p></Card>}
        <div className={paper.passage ? 'flex flex-col gap-6 lg:flex-row lg:items-start' : 'flex flex-col gap-6'}>
          {paper.passage && <article className="w-full min-w-0 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-5 lg:max-h-[calc(100vh-7rem)] lg:w-[42%] lg:overflow-y-auto"><p className="mb-4 text-xs font-bold tracking-widest text-[#365CF2] uppercase">READING PASSAGE · {paper.source === 'authentic' ? '已授权原题' : '原创阅读材料'}</p><h2 className="mb-4 text-lg font-semibold">阅读材料</h2><div className="whitespace-pre-wrap text-[15px] leading-8 text-[#20232B]">{paper.passage}</div></article>}
          <div className={`flex w-full min-w-0 flex-col gap-4 ${paper.passage ? 'lg:w-[58%]' : 'max-w-4xl'}`}>{paper.questions.map((question, index) => <ExamQuestion key={question.id} question={question} index={index} value={answers[question.id]} onChange={(choice) => setAnswers((current) => ({ ...current, [question.id]: choice }))} result={result?.results.find((item) => item.id === question.id)} />)}</div>
        </div>
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/95 px-5 py-4 shadow-xl shadow-slate-900/10 backdrop-blur-md"><div className="text-sm text-slate-600">{result ? `本次 ${result.score} 题正确，${unanswered} 题待复习` : `已答 ${Object.keys(answers).length} / ${paper.questions.length} 题`}</div><div className="flex gap-2"><Button variant="outline" onClick={back} disabled={phase === 'grading'} className="cursor-pointer">返回设置</Button>{result ? <Button onClick={start} className="cursor-pointer"><RotateCw />重新出题</Button> : <Button onClick={submit} disabled={phase === 'grading' || Object.keys(answers).length === 0} className="cursor-pointer"><ArrowRight />{phase === 'grading' ? '正在批改…' : '提交答案'}</Button>}</div></div>
      </section>}
    </div>
  )
}
