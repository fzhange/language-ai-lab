import type { Language } from './types'

export function detectLanguage(text: string): Language {
  return /\p{Script=Han}/u.test(text) ? 'zh' : 'en'
}
