import { useState } from 'react'
import { createLibrary, defineComponent, Renderer } from '@openuidev/react-lang'
import { z } from 'zod/v4'
import { BookOpen, CornerDownRight } from 'lucide-react'
import { parseSentenceStructure, sentenceSegmentSchema } from '../lib/sentence-structure'

const roleLabels = {
  subject: '主语', predicate: '谓语', object: '宾语', predicative: '表语', complement: '补语',
  attributive: '定语', adverbial: '状语', connective: '连接', clause: '从句', other: '其他',
} as const

const roleColors = {
  subject: 'border-sky-300 bg-sky-50 text-sky-900', predicate: 'border-violet-300 bg-violet-50 text-violet-900',
  object: 'border-emerald-300 bg-emerald-50 text-emerald-900', predicative: 'border-amber-300 bg-amber-50 text-amber-900',
  complement: 'border-orange-300 bg-orange-50 text-orange-900', attributive: 'border-pink-300 bg-pink-50 text-pink-900',
  adverbial: 'border-cyan-300 bg-cyan-50 text-cyan-900', connective: 'border-slate-300 bg-slate-50 text-slate-900',
  clause: 'border-teal-300 bg-teal-50 text-teal-900', other: 'border-border bg-muted text-foreground',
} as const

const cardSchema = z.object({
  summary: z.string(),
  segmentsJson: z.string(),
  explanationStepsJson: z.string(),
  uncertainty: z.string(),
})

const stepLabels = {
  backbone: '句子主干', modifier: '修饰与从句', pitfall: '容易误判',
} as const

type ExplanationStep = { kind: keyof typeof stepLabels; text: string }

type Segment = z.infer<typeof sentenceSegmentSchema>

function StructureCard({ summary, segmentsJson, explanationStepsJson, uncertainty }: z.infer<typeof cardSchema>) {
  const [selected, setSelected] = useState<number | null>(null)
  const segments = JSON.parse(segmentsJson) as Segment[]
  const explanationSteps = JSON.parse(explanationStepsJson) as ExplanationStep[]
  const legacyPoints = summary.match(/[^。]*。|[^。]+/g) ?? [summary]
  const current = selected === null ? null : segments[selected]
  const parent = current?.attaches_to === null || current?.attaches_to === undefined ? null : segments[current.attaches_to]
  const hasLongSummary = summary.length > 90
  const firstSentenceEnd = summary.indexOf('。')
  const leadEnd = firstSentenceEnd >= 0 && firstSentenceEnd < 90 ? firstSentenceEnd + 1 : 80
  const lead = hasLongSummary ? `${summary.slice(0, leadEnd).trimEnd()}…` : summary

  return <section aria-label="句子结构分析" className="w-full min-w-0 overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-sm">
    <header className="flex items-center gap-2 border-b bg-accent/40 px-4 py-3 font-semibold text-primary sm:px-5">
      <BookOpen className="size-4" aria-hidden="true" />句子结构分析
    </header>
    <div className="space-y-4 p-4 sm:p-5">
      <div className="rounded-xl bg-accent/40 px-4 py-3">
        <span className="text-xs font-semibold tracking-wide text-primary">先抓主干</span>
        <p role="region" aria-label="主干提示" className="mt-1 text-sm font-medium leading-relaxed text-foreground">{lead}</p>
      </div>
      <div className="rounded-xl border bg-background p-4" aria-label="选择句子片段查看解释">
        <p className="mb-3 text-xs text-muted-foreground">点选彩色片段，看它的作用与判断依据</p>
        <div className="flex flex-wrap items-baseline gap-y-2 leading-loose">
          {segments.map((part, index) => <button key={index} type="button"
            aria-pressed={selected === index}
            aria-label={`${part.text.trim() || '空格'} · ${roleLabels[part.role]}`}
            onClick={() => setSelected(index)}
            className={`rounded-md border-b-2 px-0.5 text-left text-base font-medium whitespace-pre-wrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${roleColors[part.role]} ${selected === index ? 'ring-2 ring-primary ring-offset-2' : 'hover:brightness-95'}`}>
            {part.text}
          </button>)}
        </div>
      </div>
      {current && <div aria-live="polite" className="space-y-3 rounded-xl border border-primary/20 bg-accent/30 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2 font-medium"><span>{current.text.trim()}</span><span className="rounded-full bg-card px-2 py-0.5 text-xs text-primary">{roleLabels[current.role]}</span></div>
        {parent && <p className="flex items-start gap-1 text-muted-foreground"><CornerDownRight className="mt-0.5 size-4 shrink-0" aria-hidden="true" />关联片段：{parent.text.trim()}</p>}
        <div><p className="mb-1 text-xs font-medium text-primary">为什么这样判断</p><p className="leading-relaxed">{current.reason}</p></div>
      </div>}
      {(hasLongSummary || explanationSteps.length > 0) && <details className="group rounded-xl border px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-primary marker:text-primary">展开完整解析</summary>
        {explanationSteps.length > 0 ? <div className="mt-4 space-y-3">
          {hasLongSummary && <p className="leading-relaxed whitespace-pre-wrap text-foreground">{summary}</p>}
          <ol className="list-decimal space-y-3 pl-6 marker:font-semibold marker:text-primary">
            {explanationSteps.map((step) => <li key={step.kind} className="pl-1 leading-relaxed text-foreground">
              <span className="font-semibold text-primary">{stepLabels[step.kind]}</span>
              <span className="mt-1 block whitespace-pre-wrap">{step.text}</span>
            </li>)}
          </ol>
        </div> : <ol className="mt-4 list-decimal space-y-3 pl-6 marker:font-semibold marker:text-primary">
          {legacyPoints.map((point, index) => <li key={index} className="pl-1 leading-relaxed whitespace-pre-wrap text-foreground">{point}</li>)}
        </ol>}
      </details>}
      {uncertainty && <details className="group rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-amber-900 marker:text-amber-600">这处还有另一种读法</summary>
        <p className="mt-3 leading-relaxed whitespace-pre-wrap text-foreground">{uncertainty}</p>
      </details>}
    </div>
  </section>
}

const Structure = defineComponent({
  name: 'SentenceStructure',
  description: 'Explains validated roles and attachments in an English sentence.',
  props: cardSchema,
  component: ({ props }) => <StructureCard {...props} />,
})
const library = createLibrary({ components: [Structure], root: 'SentenceStructure' })

export function SentenceStructure({ content }: { content: string }) {
  const parsed = parseSentenceStructure(content)
  if (!parsed) return <p role="status" className="mx-2 text-sm text-muted-foreground">结构图暂时无法显示，请让导师用文字解释这句话。</p>
  const response = `root = SentenceStructure(${JSON.stringify(parsed.summary)}, ${JSON.stringify(JSON.stringify(parsed.segments))}, ${JSON.stringify(JSON.stringify(parsed.explanation_steps ?? []))}, ${JSON.stringify(parsed.uncertainty ?? '')})`
  return <Renderer response={response} library={library} />
}
