import { z } from 'zod/v4'

export const sentenceSegmentSchema = z.object({
  text: z.string().min(1).max(500),
  role: z.enum(['subject', 'predicate', 'object', 'predicative', 'complement', 'attributive', 'adverbial', 'connective', 'clause', 'other']),
  attaches_to: z.number().int().nullable(),
  reason: z.string().trim().min(1).max(300),
})

const explanationStepSchema = z.object({
  kind: z.enum(['backbone', 'modifier', 'pitfall']),
  text: z.string().trim().min(1).max(500),
})

const structureSchema = z.object({
  type: z.literal('sentence_structure'),
  version: z.literal(1),
  sentence: z.string().min(1).max(1600),
  summary: z.string().trim().min(1).max(600),
  segments: z.array(sentenceSegmentSchema).min(1).max(48),
  explanation_steps: z.array(explanationStepSchema).max(3).optional(),
  uncertainty: z.string().max(500).nullable().optional(),
})

export function parseSentenceStructure(content: string) {
  if (content.length > 30000) return null
  try {
    const parsed = structureSchema.safeParse(JSON.parse(content))
    if (!parsed.success) return null
    const { sentence, segments, explanation_steps } = parsed.data
    if (explanation_steps) {
      const order = { backbone: 0, modifier: 1, pitfall: 2 }
      const positions = explanation_steps.map(({ kind }) => order[kind])
      if (positions.some((position, index) => index > 0 && position <= positions[index - 1])) return null
    }
    if (segments.map((part) => part.text).join('') !== sentence) return null
    if (segments.some((part, index) => part.attaches_to !== null &&
      (part.attaches_to < 0 || part.attaches_to >= segments.length || part.attaches_to === index))) return null
    for (let index = 0; index < segments.length; index += 1) {
      const seen = new Set([index])
      let parent = segments[index].attaches_to
      while (parent !== null) {
        if (seen.has(parent)) return null
        seen.add(parent)
        parent = segments[parent].attaches_to
      }
    }
    return parsed.data
  } catch { return null }
}

export const SENTENCE_REQUEST_PREFIX = '句子结构分析请求：\n'

export function sentenceRequest(sentence: string) {
  return SENTENCE_REQUEST_PREFIX + sentence
}

export function sentenceRequestText(content: string): string | undefined {
  return content.startsWith(SENTENCE_REQUEST_PREFIX) ? content.slice(SENTENCE_REQUEST_PREFIX.length) : undefined
}
