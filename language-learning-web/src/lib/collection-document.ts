export const COLLECTION_TEXT_COLORS = ['#243042', '#476996', '#9b596e', '#477864', '#1e293b', '#2563eb', '#be123c', '#15803d'] as const
export const COLLECTION_HIGHLIGHT_COLORS = ['#fff3d6', '#e8eefb', '#f9e9ee', '#e9f3eb', '#fef08a', '#bfdbfe', '#fecdd3', '#bbf7d0'] as const
export const COLLECTION_SUMMARY_COLORS = ['blue', 'green', 'yellow', 'rose'] as const
export type CollectionSummaryColor = typeof COLLECTION_SUMMARY_COLORS[number]

export type CollectionMark =
  | { type: 'textStyle' | 'highlight'; attrs: { color: string } }
  | { type: 'bold' | 'italic' | 'underline' | 'strike' }
  | { type: 'link'; attrs: { href: string; target?: '_blank' | null; rel?: string | null; class?: null; title?: null } }

export interface CollectionNode {
  type: 'text' | 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'listItem' | 'blockquote' | 'horizontalRule' | 'sectionDivider' | 'summaryBlock'
  text?: string
  marks?: CollectionMark[]
  attrs?: { level?: number; textAlign?: 'left' | 'center' | 'right' | null; start?: number; type?: null; title?: string; color?: CollectionSummaryColor }
  content?: CollectionNode[]
}

export interface CollectionDoc {
  type: 'doc'
  content: CollectionNode[]
}

const MAX_DEPTH = 8
const MAX_NODES = 3000
const MAX_TEXT_LENGTH = 100000
const MAX_DOCUMENT_WEIGHT = 500000
const ALIGNMENT = ['left', 'center', 'right', null]
const SIMPLE_MARKS = ['bold', 'italic', 'underline', 'strike']

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const keysAre = (value: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key))

export function parseSafeCollectionUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value) || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}

function parseMark(value: unknown): CollectionMark | null {
  if (!isObject(value)) return null
  if (SIMPLE_MARKS.includes(value.type as string) && keysAre(value, ['type'])) {
    return { type: value.type as 'bold' | 'italic' | 'underline' | 'strike' }
  }
  if (!keysAre(value, ['type', 'attrs']) || !isObject(value.attrs)) return null
  const attrs = value.attrs
  if ((value.type === 'textStyle' || value.type === 'highlight') &&
    keysAre(attrs, ['color']) && typeof attrs.color === 'string') {
    const palette: readonly string[] = value.type === 'textStyle' ? COLLECTION_TEXT_COLORS : COLLECTION_HIGHLIGHT_COLORS
    if (palette.includes(attrs.color)) return { type: value.type, attrs: { color: attrs.color } }
  }
  if (value.type === 'link' && keysAre(attrs, ['href', 'target', 'rel', 'class', 'title'])) {
    const href = parseSafeCollectionUrl(attrs.href)
    if (!href || (attrs.target !== undefined && attrs.target !== '_blank' && attrs.target !== null) ||
      (attrs.rel !== undefined && attrs.rel !== null && attrs.rel !== 'noopener noreferrer' && attrs.rel !== 'noopener noreferrer nofollow') ||
      (attrs.class !== undefined && attrs.class !== null) || (attrs.title !== undefined && attrs.title !== null)) return null
    return { type: 'link', attrs: { href, ...(attrs.target !== undefined ? { target: attrs.target as '_blank' | null } : {}),
      ...(attrs.rel !== undefined ? { rel: attrs.rel as string | null } : {}), ...(attrs.class !== undefined ? { class: null } : {}),
      ...(attrs.title !== undefined ? { title: null } : {}) } }
  }
  return null
}

export function parseCollectionDoc(value: unknown): CollectionDoc | null {
  if (!isObject(value) || value.type !== 'doc' || !keysAre(value, ['type', 'content']) ||
    !Array.isArray(value.content) || value.content.length === 0) return null
  let nodes = 0
  let characters = 0
  let weight = 0
  function parseNode(entry: unknown, parent: string, depth: number): CollectionNode | null {
    if (!isObject(entry) || ++nodes > MAX_NODES || depth > MAX_DEPTH ||
      !keysAre(entry, ['type', 'text', 'marks', 'attrs', 'content']) || typeof entry.type !== 'string') return null
    weight += 80
    if (weight > MAX_DOCUMENT_WEIGHT) return null
    const kind = entry.type
    const allowed = parent === 'doc' ? ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'horizontalRule', 'sectionDivider', 'summaryBlock']
      : parent === 'paragraph' || parent === 'heading' ? ['text']
        : parent === 'bulletList' || parent === 'orderedList' ? ['listItem']
          : parent === 'listItem' ? ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList']
            : parent === 'blockquote' ? ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList']
              : parent === 'summaryBlock' ? ['paragraph'] : []
    if (!allowed.includes(kind)) return null
    if (kind === 'text') {
      if (!keysAre(entry, ['type', 'text', 'marks']) || typeof entry.text !== 'string' ||
        (entry.marks !== undefined && (!Array.isArray(entry.marks) || entry.marks.length > 7))) return null
      characters += entry.text.length
      weight += entry.text.length
      if (characters > MAX_TEXT_LENGTH || weight > MAX_DOCUMENT_WEIGHT) return null
      const marks: CollectionMark[] = []
      for (const mark of (entry.marks ?? []) as unknown[]) {
        const parsed = parseMark(mark)
        if (!parsed || marks.some((previous) => previous.type === parsed.type)) return null
        weight += parsed.type === 'link' ? parsed.attrs.href.length + 80 : 100
        if (weight > MAX_DOCUMENT_WEIGHT) return null
        marks.push(parsed)
      }
      return { type: 'text', text: entry.text, ...(marks.length ? { marks } : {}) }
    }
    if (kind === 'horizontalRule') {
      return keysAre(entry, ['type']) ? { type: 'horizontalRule' } : null
    }
    if (kind === 'sectionDivider') {
      if (!keysAre(entry, ['type', 'attrs']) || !isObject(entry.attrs) || !keysAre(entry.attrs, ['title']) ||
        typeof entry.attrs.title !== 'string' || !entry.attrs.title.trim() || entry.attrs.title.length > 120) return null
      characters += entry.attrs.title.length
      weight += entry.attrs.title.length
      if (characters > MAX_TEXT_LENGTH || weight > MAX_DOCUMENT_WEIGHT) return null
      return { type: 'sectionDivider', attrs: { title: entry.attrs.title } }
    }
    if (kind === 'summaryBlock') {
      if (!keysAre(entry, ['type', 'attrs', 'content']) || !isObject(entry.attrs) || !keysAre(entry.attrs, ['color']) ||
        !COLLECTION_SUMMARY_COLORS.includes(entry.attrs.color as CollectionSummaryColor) || !Array.isArray(entry.content) || !entry.content.length) return null
      const children: CollectionNode[] = []
      for (const child of entry.content) {
        const parsed = parseNode(child, kind, depth + 1)
        if (!parsed) return null
        children.push(parsed)
      }
      return { type: 'summaryBlock', attrs: { color: entry.attrs.color as CollectionSummaryColor }, content: children }
    }
    if (!keysAre(entry, ['type', 'attrs', 'content']) ||
      (entry.content !== undefined && !Array.isArray(entry.content)) ||
      (entry.attrs !== undefined && !isObject(entry.attrs))) return null
    let attrs: CollectionNode['attrs'] | undefined
    if (kind === 'heading') {
      if (!isObject(entry.attrs) || !keysAre(entry.attrs, ['level', 'textAlign']) || ![1, 2, 3].includes(entry.attrs.level as number)) return null
      if (entry.attrs.textAlign !== undefined && !ALIGNMENT.includes(entry.attrs.textAlign as null)) return null
      attrs = { level: entry.attrs.level as number, ...(entry.attrs.textAlign !== undefined ? { textAlign: entry.attrs.textAlign as 'left' | 'center' | 'right' | null } : {}) }
    } else if (kind === 'paragraph') {
      if (entry.attrs !== undefined) {
        if (!isObject(entry.attrs) || !keysAre(entry.attrs, ['textAlign']) ||
          (entry.attrs.textAlign !== undefined && !ALIGNMENT.includes(entry.attrs.textAlign as null))) return null
        attrs = { ...(entry.attrs.textAlign !== undefined ? { textAlign: entry.attrs.textAlign as 'left' | 'center' | 'right' | null } : {}) }
      }
    } else if (kind === 'orderedList') {
      if (entry.attrs !== undefined) {
        if (!isObject(entry.attrs) || !keysAre(entry.attrs, ['start', 'type']) ||
          (entry.attrs.start !== undefined && (!Number.isSafeInteger(entry.attrs.start) || (entry.attrs.start as number) < 1 || (entry.attrs.start as number) > 100000)) ||
          (entry.attrs.type !== undefined && entry.attrs.type !== null)) return null
        attrs = { ...(entry.attrs.start !== undefined ? { start: entry.attrs.start as number } : {}), ...(entry.attrs.type !== undefined ? { type: null } : {}) }
      }
    } else if (entry.attrs !== undefined) {
      if (!isObject(entry.attrs) || !keysAre(entry.attrs, [])) return null
      attrs = {}
    }
    const children: CollectionNode[] = []
    for (const child of (entry.content ?? []) as unknown[]) {
      const parsed = parseNode(child, kind, depth + 1)
      if (!parsed) return null
      children.push(parsed)
    }
    if (['bulletList', 'orderedList', 'listItem', 'blockquote'].includes(kind) && !children.length) return null
    if (kind === 'listItem' && children[0]?.type !== 'paragraph') return null
    return { type: kind as CollectionNode['type'], ...(attrs !== undefined ? { attrs } : {}), ...(children.length ? { content: children } : {}) }
  }
  const content: CollectionNode[] = []
  for (const entry of value.content) {
    const node = parseNode(entry, 'doc', 1)
    if (!node) return null
    content.push(node)
  }
  return { type: 'doc', content }
}

export function collectionPlainText(doc: CollectionDoc): string {
  function lines(node: CollectionNode): string[] {
    if (node.type === 'paragraph' || node.type === 'heading') return [(node.content ?? []).map((child) => child.text ?? '').join('')]
    if (node.type === 'horizontalRule') return []
    if (node.type === 'sectionDivider') return [node.attrs?.title ?? '']
    return (node.content ?? []).flatMap(lines)
  }
  return doc.content.flatMap(lines).join('\n')
}
