import { describe, expect, it } from 'vitest'
import { collectionDocToMarkdown, markdownToCollectionDoc } from './collection-markdown'
import { parseCollectionDoc, type CollectionDoc } from './collection-document'

describe('collection markdown conversion', () => {
  it('round-trips headings, inline marks, links, lists, quotes and rules', () => {
    const markdown = [
      '# Title',
      '',
      'A **bold** and _italic_ and ~~strike~~ word with a [link](https://example.com).',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted line',
      '',
      '---',
    ].join('\n')
    const doc = markdownToCollectionDoc(markdown)
    expect(parseCollectionDoc(doc)).not.toBeNull()
    expect(doc.content.some((n) => n.type === 'heading' && n.attrs?.level === 1)).toBe(true)
    expect(doc.content.some((n) => n.type === 'bulletList')).toBe(true)
    expect(doc.content.some((n) => n.type === 'orderedList')).toBe(true)
    expect(doc.content.some((n) => n.type === 'blockquote')).toBe(true)
    expect(doc.content.some((n) => n.type === 'horizontalRule')).toBe(true)

    const paragraph = doc.content.find((n) => n.type === 'paragraph' && n.content?.some((child) => child.text?.includes('bold')))!
    const marks = (paragraph.content ?? []).flatMap((n) => n.marks?.map((m) => m.type) ?? [])
    expect(marks).toEqual(expect.arrayContaining(['bold', 'italic', 'strike', 'link']))

    const backToMarkdown = collectionDocToMarkdown(doc)
    expect(backToMarkdown).toContain('**bold**')
    expect(backToMarkdown).toContain('[link](https://example.com/)')
    expect(backToMarkdown).toContain('- one')
  })

  it('rejects unsafe link protocols while parsing', () => {
    const doc = markdownToCollectionDoc('Click [here](javascript:alert(1)) now.')
    const marks = doc.content[0].content?.flatMap((n) => n.marks ?? []) ?? []
    expect(marks.some((m) => m.type === 'link')).toBe(false)
    expect(doc.content[0].content?.map((n) => n.text).join('')).toContain('[here](javascript:alert(1))')
  })

  it('converts an existing rich-text document to readable markdown', () => {
    const doc: CollectionDoc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Notes' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Plain and ', }, { type: 'text', text: 'bold', marks: [{ type: 'bold' }] }] },
      ],
    }
    expect(collectionDocToMarkdown(doc)).toBe('## Notes\n\nPlain and **bold**')
  })

  it('escapes markdown-significant characters when exporting plain text', () => {
    const doc: CollectionDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a*b_c~d[e]' }] }] }
    const markdown = collectionDocToMarkdown(doc)
    const reparsed = markdownToCollectionDoc(markdown)
    expect(reparsed.content[0].content?.map((n) => n.text).join('')).toBe('a*b_c~d[e]')
  })

  it('collapses runs of blank lines into a single empty paragraph', () => {
    const doc = markdownToCollectionDoc('First block\n\n\n\n\nSecond block')
    const emptyParagraphs = doc.content.filter((n) => n.type === 'paragraph' && !n.content?.length)
    expect(emptyParagraphs).toHaveLength(1)
    expect(doc.content.map((n) => n.content?.map((c) => c.text).join(''))).toEqual(['First block', undefined, 'Second block'])
  })
})
