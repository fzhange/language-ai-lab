import { createLibrary, defineComponent, Renderer } from '@openuidev/react-lang'
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
  return <section aria-label="近义词辨析" className="w-full min-w-0 overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-sm">
    <header className="flex items-center gap-2 border-b bg-accent/40 px-4 py-3 font-semibold text-primary sm:px-5">
      <GitCompareArrows className="size-4" aria-hidden="true" />近义词辨析
    </header>
    <div className="space-y-5 p-4 sm:p-5">
      <div className="rounded-xl bg-accent/40 px-4 py-3">
        <p className="text-xs font-semibold text-primary">你输入的词或短语</p>
        <p className="mt-1 text-xl font-semibold break-words text-foreground">{source}</p>
        <p className="mt-2 text-sm leading-relaxed text-foreground">{sharedMeaning}</p>
        <div className="mt-3 border-t border-primary/15 pt-3">
          <p className="text-xs font-semibold text-primary">这个词的侧重点</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{sourceDistinction}</p>
          <p className="mt-2 border-l-2 border-primary/40 pl-3 text-sm leading-relaxed break-words text-muted-foreground">{sourceExample}</p>
        </div>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">相近表达，有什么不同？</h3>
        <ol className="grid gap-3 md:grid-cols-2">
          {alternatives.map((item, index) => <li key={index} className="min-w-0 rounded-xl border bg-background p-4">
            <p className="text-xs font-medium text-muted-foreground">相近表达 {index + 1}</p>
            <h4 className="mt-1 text-lg font-semibold break-words text-primary">{item.term}</h4>
            <p className="mt-2 text-sm leading-relaxed text-foreground">{item.distinction}</p>
            <p className="mt-3 border-l-2 border-primary/40 pl-3 text-sm leading-relaxed break-words text-muted-foreground">{item.example}</p>
          </li>)}
        </ol>
      </div>
    </div>
  </section>
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
