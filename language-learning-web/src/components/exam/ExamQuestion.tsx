import { CheckCircle2, XCircle } from 'lucide-react'

import type { Choice, ExamQuestionData, ExamResult } from '../../lib/exam'

type QuestionResult = ExamResult['results'][number]

export function ExamQuestion({ question, index, value, onChange, result }: {
  question: ExamQuestionData
  index: number
  value?: Choice
  onChange: (choice: Choice) => void
  result?: QuestionResult
}) {
  return (
    <fieldset aria-label={`第 ${index + 1} 题：${question.stem}`} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-shadow hover:shadow-md sm:p-6">
      <legend className="sr-only">第 {index + 1} 题</legend>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-[#365CF2]">{String(index + 1).padStart(2, '0')}</span>
        <span className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{question.topic}</span>
        {result && <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-slate-600">{result.correct ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-rose-600" />}{result.correct ? '回答正确' : '需要复习'}</span>}
      </div>
      <p className="mb-5 text-[15px] leading-7 font-semibold text-[#20232B]">{question.stem}</p>
      <div className="flex flex-col gap-2.5">
        {(['A', 'B', 'C', 'D'] as const).map((choice) => {
          const selected = value === choice
          const correct = result?.correctAnswer === choice
          return (
            <label key={choice} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm leading-6 transition-all focus-within:ring-2 focus-within:ring-[#365CF2]/50 ${correct ? 'border-emerald-400 bg-emerald-50' : result && selected ? 'border-rose-300 bg-rose-50' : selected ? 'border-[#365CF2] bg-blue-50 shadow-sm' : 'border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'} ${result ? 'cursor-default' : ''}`}>
              <input type="radio" name={question.id} value={choice} checked={selected} disabled={Boolean(result)} onChange={() => onChange(choice)} className="size-4 shrink-0 accent-[#365CF2]" />
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white text-xs font-bold text-slate-600">{choice}</span>
              <span className="text-[#20232B]">{question.options[choice]}</span>
              {result && correct && <CheckCircle2 aria-label="正确选项" className="ml-auto size-4 shrink-0 text-emerald-600" />}
            </label>
          )
        })}
      </div>
      {result && <div className="mt-5 rounded-xl border-l-2 border-[#365CF2] bg-blue-50/70 p-4 text-sm leading-7 text-slate-700"><p className="font-semibold text-[#2646BD]">正确答案 {result.correctAnswer} · 你的选择 {result.selected ?? '未作答'}</p><p className="mt-1">{result.explanation}</p></div>}
    </fieldset>
  )
}
