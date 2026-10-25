import { z } from 'zod/v4'

export const questionSchema = z.object({
  question: z.string().trim().min(1).max(1200),
  options: z.array(z.string().trim().min(1).max(600)).min(2).max(4)
    .refine((values) => new Set(values).size === values.length),
})

const envelopeSchema = questionSchema.extend({
  type: z.literal('understanding_check'),
  version: z.literal(1),
  response: z.string().max(10000),
})

export function parseUnderstandingCheck(content: string) {
  if (content.length > 15000) return null
  try {
    const result = envelopeSchema.safeParse(JSON.parse(content))
    return result.success ? result.data : null
  } catch { return null }
}

export function understandingAnswer(checkId: string, question: string, answer: string) {
  return `理解检查回答：\n${JSON.stringify({ check_id: checkId, question, answer })}`
}

export function understandingAnswerText(content: string): string | undefined {
  if (!content.startsWith('理解检查回答：\n')) return
  try {
    const value = JSON.parse(content.slice('理解检查回答：\n'.length))
    if (typeof value.check_id === 'string' && typeof value.answer === 'string') return `我的理解：${value.answer}`
  } catch { /* Leave ordinary messages unchanged. */ }
}

export function restoredUnderstandingAnswer(messages: { type: string; content: unknown }[], checkId: string): string | undefined {
  for (const message of [...messages].reverse()) {
    if (message.type !== 'human' || typeof message.content !== 'string' || !message.content.startsWith('理解检查回答：\n')) continue
    try {
      const value = JSON.parse(message.content.slice('理解检查回答：\n'.length))
      if (value.check_id === checkId && typeof value.answer === 'string') return value.answer
    } catch { /* Ignore unrelated or malformed historical messages. */ }
  }
}
