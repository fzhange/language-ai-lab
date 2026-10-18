// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import { collectionPlainText, parseCollectionDoc, parseSafeCollectionUrl } from './collection-document'

const valid = { type: 'doc', content: [
  { type: 'paragraph', content: [
    { type: 'text', text: 'Read ', marks: [{ type: 'textStyle', attrs: { color: '#2563eb' } }] },
    { type: 'text', text: 'this', marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }] },
  ] },
  { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
] }

describe('collection document', () => {
  it('extracts the original text and line breaks from colored paragraphs', () => {
    const doc = parseCollectionDoc(valid)
    expect(doc).not.toBeNull()
    expect(collectionPlainText(doc!)).toBe('Read this\n<script>alert(1)</script>')
  })

  it('accepts the foreground and highlight marks produced by Tiptap on selected words', () => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text, TextStyle, Color, Highlight.configure({ multicolor: true })], content: '<p>Select this text</p>' })
    editor.commands.setTextSelection({ from: 8, to: 12 })
    editor.commands.setColor('#2563eb')
    editor.commands.setHighlight({ color: '#fef08a' })
    const doc = parseCollectionDoc(editor.getJSON())
    expect(doc).not.toBeNull()
    expect(collectionPlainText(doc!)).toBe('Select this text')
    expect(doc?.content[0].content?.find((node) => node.text === 'this')?.marks).toEqual([
      { type: 'textStyle', attrs: { color: '#2563eb' } },
      { type: 'highlight', attrs: { color: '#fef08a' } },
    ])
    editor.commands.unsetAllMarks()
    expect(parseCollectionDoc(editor.getJSON())).not.toBeNull()
    editor.destroy()
  })

  it('accepts a safe link actually produced by Tiptap and rejects unsafe hrefs', () => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text,
      Link.configure({ autolink: false, openOnClick: false, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer', class: null },
        isAllowedUri: (value) => parseSafeCollectionUrl(value) !== null })], content: '<p>Read guide</p>' })
    editor.commands.setTextSelection({ from: 6, to: 11 })
    editor.commands.setLink({ href: 'https://example.org/guide', target: '_blank', rel: 'noopener noreferrer' })
    const doc = parseCollectionDoc(editor.getJSON())
    expect(doc).not.toBeNull()
    expect(collectionPlainText(doc!)).toBe('Read guide')
    expect(doc?.content[0].content?.find((node) => node.text === 'guide')?.marks?.find((mark) => mark.type === 'link')).toMatchObject({
      type: 'link', attrs: { href: 'https://example.org/guide' },
    })
    editor.destroy()
  })

  it('removes only the selected background mark for a white background', () => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text, TextStyle, Color, Highlight.configure({ multicolor: true })], content: '<p>Select this text</p>' })
    editor.commands.setTextSelection({ from: 8, to: 17 })
    editor.commands.setHighlight({ color: '#fef08a' })
    editor.commands.setTextSelection({ from: 8, to: 12 })
    editor.commands.setColor('#2563eb')
    editor.commands.unsetHighlight()
    const doc = parseCollectionDoc(editor.getJSON())
    expect(doc?.content[0].content?.find((node) => node.text === 'this')?.marks).toEqual([
      { type: 'textStyle', attrs: { color: '#2563eb' } },
    ])
    expect(doc?.content[0].content?.find((node) => node.text === ' text')?.marks).toEqual([
      { type: 'highlight', attrs: { color: '#fef08a' } },
    ])
    editor.destroy()
  })

  it('accepts muted new colors without hiding previously saved colors', () => {
    const oldDoc = parseCollectionDoc(valid)
    expect(oldDoc).not.toBeNull()
    const updated = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Gentle', marks: [
        { type: 'textStyle', attrs: { color: '#476996' } },
        { type: 'highlight', attrs: { color: '#fff3d6' } },
      ] },
    ] }] }
    expect(parseCollectionDoc(updated)).toEqual(updated)
  })

  it('keeps supported rich structures readable in content_text', () => {
    const rich = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'Chapter' }] },
      { type: 'paragraph', attrs: { textAlign: 'right' }, content: [
        { type: 'text', text: 'See ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'reference', marks: [{ type: 'link', attrs: { href: 'https://example.org/read' } }] },
      ] },
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
          { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child', marks: [{ type: 'italic' }] }] }] }] }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
      ] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote', marks: [{ type: 'underline' }, { type: 'strike' }] }] }] },
    ] }
    const doc = parseCollectionDoc(rich)
    expect(doc).toEqual(rich)
    expect(collectionPlainText(doc!)).toBe('Chapter\nSee reference\nFirst\nChild\n\nQuote')
  })

  it('keeps dividers, titled sections and colored summary blocks as structured content', () => {
    const structured = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Source material' }] },
      { type: 'horizontalRule' },
      { type: 'sectionDivider', attrs: { title: 'Agent architecture' } },
      { type: 'summaryBlock', attrs: { color: 'green' }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'The service exposes thread capabilities.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Keep identity in runtime config.' }] },
      ] },
    ] }
    const doc = parseCollectionDoc(structured)
    expect(doc).toEqual(structured)
    expect(collectionPlainText(doc!)).toBe('Source material\nAgent architecture\nThe service exposes thread capabilities.\nKeep identity in runtime config.')
  })

  it('rejects unsafe collection block attributes and nesting', () => {
    const paragraph = { type: 'paragraph', content: [{ type: 'text', text: 'Summary' }] }
    for (const node of [
      { type: 'horizontalRule', attrs: { onclick: 'bad' } },
      { type: 'sectionDivider', attrs: { title: '' } },
      { type: 'sectionDivider', attrs: { title: 'x'.repeat(121) } },
      { type: 'summaryBlock', attrs: { color: 'black' }, content: [paragraph] },
      { type: 'summaryBlock', attrs: { color: 'blue' }, content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'bad' }] }] },
    ]) expect(parseCollectionDoc({ type: 'doc', content: [node] })).toBeNull()
  })

  it('accepts a heading after the first paragraph inside a list item', () => {
    const rich = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'B' }] },
    ] }] }] }
    const doc = parseCollectionDoc(rich)
    expect(doc).not.toBeNull()
    expect(collectionPlainText(doc!)).toBe('A\nB')
  })

  it('accepts nested quotes within the bounded document depth', () => {
    const rich = { type: 'doc', content: [{ type: 'blockquote', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Outer' }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inner' }] }] },
    ] }] }
    expect(collectionPlainText(parseCollectionDoc(rich)!)).toBe('Outer\nInner')
  })

  it('accepts only absolute http(s) link URLs', () => {
    expect(parseSafeCollectionUrl('https://example.org/a?q=1')).toBe('https://example.org/a?q=1')
    expect(parseSafeCollectionUrl('http://example.org')).toBe('http://example.org/')
    for (const value of ['javascript:alert(1)', 'data:text/html,x', '//example.org', '/relative', 'https://', 'https://user:pass@example.org', null]) {
      expect(parseSafeCollectionUrl(value)).toBeNull()
    }
  })

  it('rejects invalid rich nodes, marks, nesting and oversized text', () => {
    const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    for (const node of [
      { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'bad' }] },
      { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: 'bad' }] },
      { type: 'image', attrs: { src: 'https://example.org/img' } },
      { type: 'bulletList', content: [paragraph('invalid child')] },
      { type: 'blockquote', content: [{ type: 'image' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'https://example.org', onclick: 'evil' } }] }] },
      paragraph('x'.repeat(100_001)),
    ]) expect(parseCollectionDoc({ type: 'doc', content: [node] })).toBeNull()
    let nested: unknown = paragraph('deep')
    for (let i = 0; i < 20; i++) nested = { type: 'blockquote', content: [nested] }
    expect(parseCollectionDoc({ type: 'doc', content: [nested] })).toBeNull()
    const emptyRich = parseCollectionDoc({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }, { type: 'blockquote', content: [paragraph(' ')] }] })
    expect(emptyRich && collectionPlainText(emptyRich).trim()).toBe('')
  })

  it('rejects a link-heavy JSON document that exceeds the serialized size budget', () => {
    const content = Array.from({ length: 850 }, (_, index) => ({ type: 'text', text: String(index), marks: [{ type: 'link', attrs: {
      href: `https://example.org/${String(index).padStart(4, '0')}/${'x'.repeat(1700)}`,
    } }] }))
    expect(parseCollectionDoc({ type: 'doc', content: [{ type: 'paragraph', content }] })).toBeNull()
  })

  it('allows empty drafts but not unexpected shapes or formatting', () => {
    expect(parseCollectionDoc({ type: 'doc', content: [{ type: 'paragraph' }] })).not.toBeNull()
    for (const bad of [
      null, [], { type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'textStyle', attrs: { color: 'red' } }] }] }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'highlight', attrs: { color: 'url(javascript:1)' } }] }] }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', attrs: { onclick: 'evil' } }] }] },
      { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 4 }] }] },
      { type: 'doc', content: 'hello' },
    ]) expect(parseCollectionDoc(bad)).toBeNull()
  })
})
