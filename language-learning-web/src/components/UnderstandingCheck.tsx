import { createContext, useContext, useId, useState } from 'react'
import { createLibrary, defineComponent, Renderer } from '@openuidev/react-lang'
import { z } from 'zod/v4'
import { ArrowUp, CircleCheck, LoaderCircle } from 'lucide-react'
import { Button } from './ui/button'
import { parseUnderstandingCheck, questionSchema } from '../lib/understanding-check'

const InteractionContext = createContext<{
  disabled: boolean
  submittedAnswer?: string
  onAnswer: (question: string, answer: string) => Promise<void>
} | null>(null)

function CheckQuestion({ question, options }: z.infer<typeof questionSchema>) {
  const interaction = useContext(InteractionContext)!
  const radioName = useId()
  const [choice, setChoice] = useState<string | undefined>(interaction.submittedAnswer)
  const [sent, setSent] = useState<string | undefined>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const submitted = interaction.submittedAnswer ?? sent
  const locked = interaction.disabled || pending || Boolean(submitted)

  async function submit() {
    if (!choice || locked) return
    setPending(true)
    setError('')
    try {
      await interaction.onAnswer(question, choice)
      setSent(choice)
    } catch { setError('回答发送失败，选择已保留，请重试。') }
    finally { setPending(false) }
  }

  return <section aria-label="理解检查" className="min-w-0 border-y border-primary/20 py-5">
    <p className="mb-2 flex items-center gap-2 text-sm font-medium text-primary"><CircleCheck className="size-4" />理解检查</p>
    <fieldset disabled={locked} className="min-w-0 space-y-3">
      <legend className="mb-3 whitespace-pre-wrap break-words text-base font-medium">{question}</legend>
      {options.map((option, index) => <label key={option} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-3 text-sm transition-colors ${option === (submitted ?? choice) ? 'border-primary bg-accent' : 'border-border hover:bg-secondary/50'}`}>
        <input type="radio" name={radioName} checked={option === (submitted ?? choice)} onChange={() => setChoice(option)} className="mt-1 shrink-0 accent-blue-600" />
        <span className="shrink-0 font-medium text-muted-foreground">{String.fromCharCode(65 + index)}.</span>
        <span className="min-w-0 whitespace-pre-wrap break-words">{option}</span>
      </label>)}
    </fieldset>
    <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
      {submitted ? <p role="status" className="text-sm text-muted-foreground">已提交给导师</p> : <Button type="button" size="sm" disabled={!choice || locked} onClick={() => void submit()}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}提交回答</Button>}
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </section>
}

const Check = defineComponent({
  name: 'UnderstandingCheck',
  description: 'A single-choice English understanding check; the mentor provides feedback after submission.',
  props: questionSchema,
  component: ({ props }) => <CheckQuestion {...props} />,
})
const library = createLibrary({ components: [Check], root: 'UnderstandingCheck' })

export function UnderstandingCheck({ content, disabled, submittedAnswer, onAnswer }: {
  content: string
  disabled: boolean
  submittedAnswer?: string
  onAnswer: (question: string, answer: string) => Promise<void>
}) {
  const check = parseUnderstandingCheck(content)
  if (!check) return <p role="status" className="text-sm text-muted-foreground">理解检查暂时无法显示，请让导师重新出题。</p>
  // Only validated data enters the program; no generated queries or mutations are registered.
  const response = `root = UnderstandingCheck(${JSON.stringify(check.question)}, ${JSON.stringify(check.options)})`
  return <InteractionContext.Provider value={{ disabled, submittedAnswer, onAnswer }}>
    <Renderer response={response} library={library} isStreaming={disabled} />
  </InteractionContext.Provider>
}
