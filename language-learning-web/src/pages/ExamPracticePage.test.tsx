// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../lib/auth', () => ({
  useAuth: () => ({ user: { id: 'user-one' }, accessToken: 'token', supabaseReady: true }),
}))
vi.mock('../lib/exam', async () => {
  const original = await vi.importActual<typeof import('../lib/exam')>('../lib/exam')
  return { ...original, createExam: vi.fn(), submitExam: vi.fn() }
})

import { createExam, submitExam, type ExamPaper } from '../lib/exam'
import { ExamPracticePage } from './ExamPracticePage'

const paper: ExamPaper = {
  status: 'ready', session: 'sealed-session', level: 'cet', topic: 'reading', source: 'simulated',
  passage: 'The town library began lending tools to residents. Many people now share tools rather than buy their own.',
  origin: null,
  questions: Array.from({ length: 4 }, (_, index) => ({
    id: `q${index + 1}`, stem: `What does the passage suggest in question ${index + 1}?`,
    options: { A: 'They share tools', B: 'They buy twice', C: 'They move away', D: 'They stop reading' },
    topic: '细节理解',
  })),
}

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ExamPracticePage', () => {
  it('switches exam tabs and issues simulated reading questions without revealing answers', async () => {
    vi.mocked(createExam).mockResolvedValue(paper)
    const user = userEvent.setup()
    render(<ExamPracticePage />)
    expect(screen.getByRole('button', { name: '雅思' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '四六级' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '高中' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '初中' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '四六级' }))
    await user.click(screen.getByRole('button', { name: '阅读理解' }))
    await user.click(screen.getByRole('button', { name: '开始练习' }))
    await waitFor(() => expect(createExam).toHaveBeenCalledWith({ level: 'cet', topic: 'reading', source: 'simulated' }, 'token'))
    expect(screen.getByText(/town library began lending tools/)).toBeTruthy()
    expect(screen.getByText('What does the passage suggest in question 1?')).toBeTruthy()
    expect(screen.queryByText('正确答案')).toBeNull()
  })

  it('allows point-and-click answers and shows score plus Chinese explanations after submission', async () => {
    vi.mocked(createExam).mockResolvedValue(paper)
    vi.mocked(submitExam).mockResolvedValue({ score: 1, total: 4, results: paper.questions.map((question, index) => ({
      id: question.id, selected: index === 0 ? 'A' : null, correctAnswer: 'A', correct: index === 0,
      explanation: '根据文章线索推断。', topic: '细节理解',
    })) })
    const user = userEvent.setup()
    render(<ExamPracticePage />)
    await user.click(screen.getByRole('button', { name: '四六级' }))
    await user.click(screen.getByRole('button', { name: '阅读理解' }))
    await user.click(screen.getByRole('button', { name: '开始练习' }))
    const question = await screen.findByRole('group', { name: /第 1 题/ })
    await user.click(within(question).getByRole('radio', { name: /A.*They share tools/ }))
    await user.click(screen.getByRole('button', { name: '提交答案' }))
    await waitFor(() => expect(submitExam).toHaveBeenCalledWith('sealed-session', { q1: 'A' }, 'token'))
    expect(screen.getByText('1 / 4')).toBeTruthy()
    expect(screen.getAllByText(/根据文章线索推断/).length).toBe(4)
    expect(screen.getAllByText(/3 道待复习/).length).toBeGreaterThan(0)
  })

  it('shows an explicit empty state for unlicensed originals, never a simulated paper', async () => {
    vi.mocked(createExam).mockResolvedValue({ status: 'empty', message: '当前范围尚无获得授权的真题。' })
    const user = userEvent.setup()
    render(<ExamPracticePage />)
    await user.click(screen.getByRole('button', { name: '真题' }))
    await user.click(screen.getByRole('button', { name: '开始练习' }))
    expect(await screen.findByText('当前范围尚无获得授权的真题。')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '提交答案' })).toBeNull()
  })

  it('labels licensed reading passages without falsely calling them original', async () => {
    vi.mocked(createExam).mockResolvedValue({ ...paper, source: 'authentic', origin: {
      name: '授权卷', year: '2024', region: '全国', url: 'https://example.com/paper',
    } })
    const user = userEvent.setup()
    render(<ExamPracticePage />)
    await user.click(screen.getByRole('button', { name: '真题' }))
    await user.click(screen.getByRole('button', { name: '开始练习' }))
    expect(await screen.findByText(/town library began lending tools/)).toBeTruthy()
    expect(screen.getByText('READING PASSAGE · 已授权原题')).toBeTruthy()
    expect(screen.queryByText('READING PASSAGE · 原创阅读材料')).toBeNull()
  })

  it('locks exam scope while answering to keep provenance consistent', async () => {
    vi.mocked(createExam).mockResolvedValue(paper)
    const user = userEvent.setup()
    render(<ExamPracticePage />)
    await user.click(screen.getByRole('button', { name: '四六级' }))
    await user.click(screen.getByRole('button', { name: '阅读理解' }))
    await user.click(screen.getByRole('button', { name: '开始练习' }))
    expect(await screen.findByText(/town library began lending tools/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '高中' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('can abandon an unsubmitted reading paper and return to setup', async () => {
    vi.mocked(createExam).mockResolvedValue(paper)
    const user = userEvent.setup()
    render(<ExamPracticePage />)
    await user.click(screen.getByRole('button', { name: '开始练习' }))
    expect(await screen.findByText(/town library began lending tools/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '返回设置' }))
    expect(screen.getByRole('button', { name: '高中' })).toHaveProperty('disabled', false)
    expect(screen.queryByText(/town library began lending tools/)).toBeNull()
  })

  it('does not silently replace a failed request with fabricated questions', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(createExam).mockRejectedValue(new Error('登录已失效，请重新登录'))
    const user = userEvent.setup()
    render(<ExamPracticePage />)
    await user.click(screen.getByRole('button', { name: '开始练习' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '登录已失效，请重新登录')
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})
