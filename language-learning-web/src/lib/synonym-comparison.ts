import { z } from 'zod/v4'

const alternativeSchema = z.strictObject({
  term: z.string().min(1).max(80),
  distinction: z.string().trim().min(1).max(350),
  example: z.string().trim().min(1).max(240),
})

const comparisonSchema = z.strictObject({
  type: z.literal('synonym_comparison'),
  version: z.literal(1),
  source: z.string().trim().min(1).max(120),
  shared_meaning: z.string().trim().min(1).max(350),
  source_distinction: z.string().trim().min(1).max(350),
  source_example: z.string().trim().min(1).max(240),
  alternatives: z.array(alternativeSchema).min(1).max(5),
})

export function parseSynonymComparison(content: string) {
  if (content.length > 8000) return null
  try {
    const parsed = comparisonSchema.safeParse(JSON.parse(content))
    if (!parsed.success) return null
    const terms = new Set([parsed.data.source.trim().replace(/\s+/g, ' ').toLocaleLowerCase()])
    for (const item of parsed.data.alternatives) {
      const term = item.term.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
      if (!term || terms.has(term)) return null
      terms.add(term)
    }
    return parsed.data
  } catch { return null }
}

export const SYNONYM_REQUEST_PREFIX = '查找近义词请求：\n'

export function synonymRequest(source: string) {
  return SYNONYM_REQUEST_PREFIX + source
}

export function synonymRequestText(content: string): string | undefined {
  return content.startsWith(SYNONYM_REQUEST_PREFIX) ? content.slice(SYNONYM_REQUEST_PREFIX.length) : undefined
}
