import { useId, useState } from 'react'
import { createLibrary, defineComponent, Renderer } from '@openuidev/react-lang'
import { BorderBeam } from 'border-beam'
import { z } from 'zod/v4'
import { GitCompareArrows } from 'lucide-react'
import { parseSynonymComparison } from '../lib/synonym-comparison'

const cardSchema = z.object({
  source: z.string(),
  sharedMeaning: z.string(),
  sourceDistinction: z.string(),
  sourceExample: z.string(),
  alternativesJson: z.string(),
})

type Alternative = { term: string; distinction: string; example: string }

function SynonymCard({ source, sharedMeaning, sourceDistinction, sourceExample, alternativesJson }: z.infer<typeof cardSchema>) {
  const alternatives = JSON.parse(alternativesJson) as Alternative[]
  const entries = [{ term: source, distinction: sourceDistinction, example: sourceExample }, ...alternatives]
  const [selected, setSelected] = useState(0)
  const exampleId = useId()
  const current = entries[selected] ?? entries[0]
  return <BorderBeam size="pulse-inner" colorVariant="ocean" theme="auto" strength={0.35} className="w-full min-w-0">
    <section aria-label="近义词辨析" className="w-full min-w-0 overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-sm">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b bg-accent/40 px-4 py-3 sm:px-5">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-primary"><GitCompareArrows className="size-4 shrink-0" aria-hidden="true" />近义词辨析</span>
        <h3 lang="en" className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{source}</h3>
        <p className="w-full text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{sharedMeaning}</p>
      </header>
      <div className="space-y-3 p-4 sm:p-5">
        <p className="text-xs text-muted-foreground">点选一个表达，看它的例句</p>
        <ol aria-label="近义表达对照" className="divide-y overflow-hidden rounded-xl border bg-background">
          {entries.map((item, index) => <li key={item.term}>
            <button type="button"
              aria-pressed={selected === index}
              aria-controls={exampleId}
              aria-label={`${item.term} · ${index === 0 ? '原表达' : '相近表达'}`}
              onClick={() => setSelected(index)}
              className={`flex min-h-11 w-full items-start gap-3 px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${selected === index ? 'bg-accent' : 'hover:bg-secondary/50'}`}>
              <span className="min-w-0 flex-1">
                <span lang="en" className={`block text-sm font-semibold [overflow-wrap:anywhere] ${selected === index ? 'text-primary' : ''}`}>{item.term}</span>
                <span className="mt-1 block text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{item.distinction}</span>
              </span>
              <span className={`mt-0.5 shrink-0 text-[11px] ${selected === index ? 'text-primary' : 'text-muted-foreground'}`}>{index === 0 ? '原表达' : '相近表达'}</span>
            </button>
          </li>)}
        </ol>
        <div id={exampleId} role="region" aria-label="选中词的例句" aria-live="polite" className="space-y-3 rounded-xl border border-primary/20 bg-accent/30 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 font-medium"><span lang="en" className="[overflow-wrap:anywhere]">{current.term}</span><span className="rounded-full bg-card px-2 py-0.5 text-xs text-primary">例句</span></div>
          <p lang="en" className="border-l-2 border-primary/30 pl-3 leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{current.example}</p>
        </div>
      </div>
    </section>
  </BorderBeam>
}

const Synonyms = defineComponent({
  name: 'SynonymComparison',
  description: 'Compare validated English expressions and when they differ in use.',
  props: cardSchema,
  component: ({ props }) => <SynonymCard {...props} />,
})
const library = createLibrary({ components: [Synonyms], root: 'SynonymComparison' })

export function SynonymComparison({ content }: { content: string }) {
  const parsed = parseSynonymComparison(content)
  if (!parsed) return <p role="status" className="px-2 text-sm text-muted-foreground">近义词卡片暂时无法显示，请让导师用文字解释。</p>
  const response = `root = SynonymComparison(${JSON.stringify(parsed.source)}, ${JSON.stringify(parsed.shared_meaning)}, ${JSON.stringify(parsed.source_distinction)}, ${JSON.stringify(parsed.source_example)}, ${JSON.stringify(JSON.stringify(parsed.alternatives))})`
  return <Renderer response={response} library={library} />
}
