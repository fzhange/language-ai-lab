import { LANGGRAPH_URL } from './config'

export type Level = 'ielts' | 'cet' | 'senior' | 'junior'
export type Topic = 'grammar' | 'reading'
export type Source = 'authentic' | 'simulated'
export type Choice = 'A' | 'B' | 'C' | 'D'

export interface ExamQuestionData {
  id: string
  stem: string
  options: Record<Choice, string>
  topic: string
}

export interface ExamPaper {
  status: 'ready'
  session: string
  level: Level
  topic: Topic
  source: Source
  passage: string | null
  origin: { name: string; url: string; year: string; region: string } | null
  questions: ExamQuestionData[]
}

export type ExamResponse = ExamPaper | { status: 'empty'; message: string }

export interface ExamResult {
  score: number
  total: number
  results: {
    id: string
    selected: Choice | null
    correctAnswer: Choice
    correct: boolean
    explanation: string
    topic: string
  }[]
}

async function postExam<T>(path: string, data: object, token: string): Promise<T> {
  const response = await fetch(`${LANGGRAPH_URL}/exam/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(body?.detail ?? `练习服务暂不可用（HTTP ${response.status}）`)
  }
  return response.json() as Promise<T>
}

export function createExam(options: { level: Level; topic: Topic; source: Source }, token: string): Promise<ExamResponse> {
  return postExam<ExamResponse>('papers', options, token)
}

export function submitExam(session: string, answers: Record<string, Choice>, token: string): Promise<ExamResult> {
  return postExam<ExamResult>('grade', { session, answers }, token)
}
