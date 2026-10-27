// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { UnderstandingCheck } from './UnderstandingCheck'
import { parseUnderstandingCheck, restoredUnderstandingAnswer, understandingAnswer } from '../lib/understanding-check'
import { SentenceStructure } from './SentenceStructure'
import { parseSentenceStructure } from '../lib/sentence-structure'
import { SynonymComparison } from './SynonymComparison'
import { parseSynonymComparison } from '../lib/synonym-comparison'

const content = JSON.stringify({ type: 'understanding_check', version: 1, question: 'What does probabilistic mean?', options: ['Always wrong', 'Based on probability'], response: 'root = UnderstandingCheck("Q", ["A", "B"])' })
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('OpenUI understanding check', () => {
  it('renders through OpenUI and submits a selected interpretation', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined)
    render(<UnderstandingCheck content={content} disabled={false} onAnswer={onAnswer} />)
    const button = await screen.findByRole('button', { name: '提交回答' })
    expect(button).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: /Based on probability/ }))
    await userEvent.click(button)
    expect(onAnswer).toHaveBeenCalledWith('What does probabilistic mean?', 'Based on probability')
    expect(await screen.findByText('已提交给导师')).toBeInTheDocument()
  })

  it('retains the choice on failure and permits retry', async () => {
    const onAnswer = vi.fn().mockRejectedValueOnce(new Error()).mockResolvedValueOnce(undefined)
    render(<UnderstandingCheck content={content} disabled={false} onAnswer={onAnswer} />)
    await userEvent.click(await screen.findByRole('radio', { name: /Based on probability/ }))
    await userEvent.click(screen.getByRole('button', { name: '提交回答' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('选择已保留')
    expect(screen.getByRole('radio', { name: /Based on probability/ })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: '提交回答' }))
    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(2))
  })

  it('restores the submitted answer and locks it while preserving readability', async () => {
    render(<UnderstandingCheck content={content} disabled={false} submittedAnswer="Based on probability" onAnswer={vi.fn()} />)
    expect(await screen.findByRole('radio', { name: /Based on probability/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Always wrong/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '提交回答' })).toBeNull()
    const messages = [{ type: 'human', content: understandingAnswer('check-1', 'Q', 'Based on probability') }]
    expect(restoredUnderstandingAnswer(messages, 'check-1')).toBe('Based on probability')
    expect(restoredUnderstandingAnswer(messages, 'check-2')).toBeUndefined()
  })

  it('rejects malformed data and never evaluates supplied OpenUI code', async () => {
    expect(parseUnderstandingCheck('{')).toBeNull()
    expect(parseUnderstandingCheck(JSON.stringify({ ...JSON.parse(content), options: ['A', 'A'] }))).toBeNull()
    render(<UnderstandingCheck content={JSON.stringify({ ...JSON.parse(content), response: 'root = Query("delete_all")', question: '<script>alert(1)</script>' })} disabled={false} onAnswer={vi.fn()} />)
    expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })

  it('disables interaction while the mentor is streaming', async () => {
    render(<UnderstandingCheck content={content} disabled onAnswer={vi.fn()} />)
    expect(await screen.findByRole('radio', { name: /Always wrong/ })).toBeDisabled()
  })
})

const structure = JSON.stringify({
  type: 'sentence_structure', version: 1, sentence: 'She is happy.', summary: 'is 连接主语和状态。',
  segments: [
    { text: 'She ', role: 'subject', attaches_to: 1, reason: '谁的状态？' },
    { text: 'is ', role: 'predicate', attaches_to: null, reason: '连接主语和状态。' },
    { text: 'happy.', role: 'predicative', attaches_to: 1, reason: '描述 She 的状态，而非宾语。' },
  ], uncertainty: null,
})

const synonyms = {
  type: 'synonym_comparison', version: 1, source: 'provide',
  shared_meaning: '都与提供有关，但主动提议和持续供应并不相同。',
  source_distinction: '提供某人所需之物，重在满足需要。', source_example: 'Schools provide meals.',
  alternatives: [
    { term: 'offer', distinction: '主动提出，对方可选择接受或拒绝。', example: 'She offered to help.' },
    { term: 'supply', distinction: '持续提供资源或货物，更强调供给。', example: 'They supply water to the village.' },
  ],
}

describe('OpenUI synonym comparison', () => {
  it('highlights only the outside edge of the result without blocking word selection', async () => {
    render(<SynonymComparison content={JSON.stringify(synonyms)} />)
    const card = await screen.findByRole('region', { name: '近义词辨析' })
    const beam = card.closest('[data-beam]')
    expect(beam).toHaveAttribute('data-active')
    await userEvent.click(screen.getByRole('button', { name: /offer/ }))
    expect(screen.getByRole('region', { name: '选中词的例句' })).toHaveTextContent('She offered to help.')
  })

  it('presents relevant words alongside their usage differences', async () => {
    render(<SynonymComparison content={JSON.stringify(synonyms)} />)
    const card = await screen.findByRole('region', { name: '近义词辨析' })
    expect(card).toHaveTextContent('provide')
    expect(card).toHaveTextContent('提供某人所需之物，重在满足需要。')
    expect(card).toHaveTextContent('Schools provide meals.')
    expect(card).toHaveTextContent('offer')
    expect(card).toHaveTextContent('supply')
    expect(card).toHaveTextContent('主动提出，对方可选择接受或拒绝。')
    expect(card).toHaveTextContent('持续提供资源或货物，更强调供给。')
    expect(card).toHaveTextContent('都与提供有关，但主动提议和持续供应并不相同。')
    expect(screen.getByRole('button', { name: /provide/ })).toHaveAttribute('aria-pressed', 'true')
    expect(card).toHaveTextContent('Schools provide meals.')
    await userEvent.click(screen.getByRole('button', { name: /offer/ }))
    expect(screen.getByRole('button', { name: /offer/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /provide/ })).toHaveAttribute('aria-pressed', 'false')
    expect(card).toHaveTextContent('She offered to help.')
    await userEvent.click(screen.getByRole('button', { name: /supply/ }))
    expect(card).toHaveTextContent('They supply water to the village.')
    const example = screen.getByRole('region', { name: '选中词的例句' })
    expect(example).toHaveAttribute('aria-live', 'polite')
    expect(document.getElementById(screen.getByRole('button', { name: /supply/ }).getAttribute('aria-controls')!)).toBe(example)
  })

  it('rejects missing distinctions, duplicates and model-authored UI instructions', async () => {
    expect(parseSynonymComparison(JSON.stringify({ ...synonyms, alternatives: [{ term: 'offer', example: 'She offered help.' }] }))).toBeNull()
    expect(parseSynonymComparison(JSON.stringify({ ...synonyms, alternatives: [...synonyms.alternatives, { ...synonyms.alternatives[0], term: 'Offer' }] }))).toBeNull()
    expect(parseSynonymComparison(JSON.stringify({ ...synonyms, response: 'root = Query("delete_all")' }))).toBeNull()
    const unsafe = { ...synonyms, alternatives: [{ term: '<script>alert(1)</script>', distinction: '不是 HTML。', example: 'A plain example.' }] }
    render(<SynonymComparison content={JSON.stringify(unsafe)} />)
    expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })
})

describe('OpenUI sentence structure', () => {
  it('highlights only the outside edge of the analysis while preserving phrase interaction', async () => {
    render(<SentenceStructure content={structure} />)
    const card = await screen.findByRole('region', { name: '句子结构分析' })
    expect(card.closest('[data-beam]')).toHaveAttribute('data-active')
    await userEvent.click(screen.getByRole('button', { name: /happy/ }))
    expect(screen.getByRole('region', { name: '片段解释' })).toHaveTextContent('表语')
  })

  it('lets learners inspect the attachment and reasoning of an English predicative', async () => {
    render(<SentenceStructure content={structure} />)
    expect(await screen.findByText('is 连接主语和状态。')).toBeInTheDocument()
    expect(screen.queryByText('展开完整解析')).not.toBeInTheDocument()
    expect(screen.queryByText('这处还有另一种读法')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /happy/ }))
    expect(screen.getByText('描述 She 的状态，而非宾语。')).toBeInTheDocument()
    expect(screen.getByText(/关联片段：is/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /happy/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /happy/ })).toHaveClass('min-h-11')
    expect(document.getElementById(screen.getByRole('button', { name: /happy/ }).getAttribute('aria-controls')!)).toBe(screen.getByRole('region', { name: '片段解释' }))
    expect(screen.getByRole('region', { name: '片段解释' })).toHaveTextContent('表语')
  })

  it('keeps long explanations behind disclosures while making the structure immediately visible', async () => {
    const longSummary = `先看主干：She is happy。${'这是一段展开后才需要读的详细解释。'.repeat(9)}`
    const uncertainty = '不同语境下 happy 也可能表达暂时的感受，需结合上下文判断。'
    render(<SentenceStructure content={JSON.stringify({ ...JSON.parse(structure), summary: longSummary, uncertainty })} />)
    const lead = await screen.findByRole('region', { name: '主干提示' })
    expect(lead.textContent).toBe('先看主干：She is happy。…')
    expect(screen.getByRole('button', { name: /happy/ })).toBeInTheDocument()
    const fullSummary = screen.getByText('展开完整解析').closest('details')!
    expect(fullSummary).not.toHaveAttribute('open')
    await userEvent.click(screen.getByText('展开完整解析'))
    expect(fullSummary).toHaveAttribute('open')
    const points = Array.from(fullSummary.querySelectorAll('ol > li')).map((item) => item.textContent)
    expect(points).toHaveLength(10)
    expect(points[0]).toBe('先看主干：She is happy。')
    expect(points.slice(1).join('')).toBe('这是一段展开后才需要读的详细解释。'.repeat(9))
    const alternative = screen.getByText(uncertainty).closest('details')!
    expect(alternative).not.toHaveAttribute('open')
    await userEvent.click(screen.getByText('这处还有另一种读法'))
    expect(alternative).toHaveAttribute('open')
  })

  it('shows model-provided ordered explanations without inventing missing categories', async () => {
    const explanation_steps = [
      { kind: 'backbone', text: 'She 是主语，is 连接状态 happy。' },
      { kind: 'pitfall', text: 'happy 不是宾语。' },
    ]
    const payload = { ...JSON.parse(structure), explanation_steps }
    expect(parseSentenceStructure(JSON.stringify(payload))?.explanation_steps).toEqual(explanation_steps)
    render(<SentenceStructure content={JSON.stringify(payload)} />)
    const details = (await screen.findByText('展开完整解析')).closest('details')!
    expect(details).not.toHaveAttribute('open')
    await userEvent.click(screen.getByText('展开完整解析'))
    expect(Array.from(details.querySelectorAll('ol > li')).map((item) => item.textContent)).toEqual([
      '句子主干She 是主语，is 连接状态 happy。',
      '容易误判happy 不是宾语。',
    ])
    expect(details.textContent).not.toContain('修饰与从句')
    expect(parseSentenceStructure(JSON.stringify({ ...payload, explanation_steps: [{ kind: 'html', text: '<script/>' }] }))).toBeNull()
  })

  it('preserves English periods in unstructured historical explanations', async () => {
    const summary = '先看 do-support。A. 和 B. 是并列宾语。model 不等于主语。这些 UI 不是现成素材，需要结合语境理解句子里连接的关系。用户可以再点选片段，对照词组所挂靠的位置继续分析。'
    render(<SentenceStructure content={JSON.stringify({ ...JSON.parse(structure), summary })} />)
    const details = (await screen.findByText('展开完整解析')).closest('details')!
    await userEvent.click(screen.getByText('展开完整解析'))
    expect(Array.from(details.querySelectorAll('ol > li')).map((item) => item.textContent)).toEqual([
      '先看 do-support。', 'A. 和 B. 是并列宾语。', 'model 不等于主语。', '这些 UI 不是现成素材，需要结合语境理解句子里连接的关系。', '用户可以再点选片段，对照词组所挂靠的位置继续分析。',
    ])
  })

  it('rejects invented source text, invalid references and executable responses', async () => {
    expect(parseSentenceStructure(JSON.stringify({ ...JSON.parse(structure), sentence: 'She was happy.' }))).toBeNull()
    expect(parseSentenceStructure(JSON.stringify({ ...JSON.parse(structure), segments: [
      { text: 'She ', role: 'subject', attaches_to: 1, reason: '谁？' },
      { text: 'is happy.', role: 'predicate', attaches_to: 0, reason: '谓语' },
    ] }))).toBeNull()
    expect(parseSentenceStructure(JSON.stringify({ ...JSON.parse(structure), segments: [{ text: 'She ', role: 'subject', attaches_to: 99, reason: '谁？' }] }))).toBeNull()
    render(<SentenceStructure content={JSON.stringify({ ...JSON.parse(structure), summary: '<script>alert(1)</script>', response: 'root = Query("delete_all")' })} />)
    expect(await screen.findByText('<script>alert(1)</script>')).toBeInTheDocument()
    expect(document.querySelector('script')).toBeNull()
  })
})
