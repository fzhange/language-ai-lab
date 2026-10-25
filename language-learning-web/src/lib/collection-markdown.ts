import { parseSafeCollectionUrl, type CollectionDoc, type CollectionMark, type CollectionNode } from './collection-document'

/** 富文本 <-> Markdown 的双向转换；仅覆盖标准 Markdown 子集（标题/加粗/斜体/删除线/链接/列表/引用/分隔线）。
 * 颜色标记、分节、小结区块没有标准 Markdown 语法，导出时分别降级为普通文本/标题/引用。 */

function escapeMd(text: string): string {
  return text.replace(/[\\*_~[\]]/g, '\\$&')
}

function unescapeMd(text: string): string {
  return text.replace(/\\([\\*_~[\]])/g, '$1')
}

function inlineToMarkdown(nodes: CollectionNode[]): string {
  return nodes.map((node) => {
    let text = escapeMd(node.text ?? '')
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `**${text}**`
      else if (mark.type === 'italic') text = `_${text}_`
      else if (mark.type === 'strike') text = `~~${text}~~`
      else if (mark.type === 'link') {
        const href = parseSafeCollectionUrl(mark.attrs.href)
        if (href) text = `[${text}](${href})`
      }
      // textStyle/highlight/underline 没有标准 Markdown 表示，仅保留文字
    }
    return text
  }).join('')
}

function listItemToMarkdown(item: CollectionNode, marker: string): string[] {
  const [first, ...rest] = item.content ?? []
  const firstLine = `${marker} ${first ? inlineToMarkdown(first.content ?? []) : ''}`
  return [firstLine, ...rest.flatMap((child) => blockToMarkdown(child).map((line) => `  ${line}`))]
}

function blockToMarkdown(node: CollectionNode): string[] {
  switch (node.type) {
    case 'paragraph': return [inlineToMarkdown(node.content ?? [])]
    case 'heading': return [`${'#'.repeat(node.attrs?.level ?? 1)} ${inlineToMarkdown(node.content ?? [])}`]
    case 'blockquote': return (node.content ?? []).flatMap((child) => blockToMarkdown(child).map((line) => `> ${line}`))
    case 'bulletList': return (node.content ?? []).flatMap((item) => listItemToMarkdown(item, '-'))
    case 'orderedList': {
      let n = node.attrs?.start ?? 1
      return (node.content ?? []).flatMap((item) => { const lines = listItemToMarkdown(item, `${n}.`); n += 1; return lines })
    }
    case 'horizontalRule': return ['---']
    case 'sectionDivider': return [`## ${node.attrs?.title ?? ''}`]
    case 'summaryBlock': return ['> **小结**', ...(node.content ?? []).flatMap((child) => blockToMarkdown(child).map((line) => `> ${line}`))]
    default: return []
  }
}

export function collectionDocToMarkdown(doc: CollectionDoc): string {
  return doc.content.map((node) => blockToMarkdown(node).join('\n')).join('\n\n')
}

const INLINE_PATTERN = /\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|_([^_]+)_/g

function parseInline(raw: string): CollectionNode[] {
  const nodes: CollectionNode[] = []
  const pushText = (value: string, markType?: 'bold' | 'italic' | 'strike') => {
    if (!value) return
    nodes.push({ type: 'text', text: unescapeMd(value), ...(markType ? { marks: [{ type: markType }] as CollectionMark[] } : {}) })
  }
  let lastIndex = 0
  INLINE_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = INLINE_PATTERN.exec(raw))) {
    if (match.index > lastIndex) pushText(raw.slice(lastIndex, match.index))
    if (match[1] !== undefined) {
      const href = parseSafeCollectionUrl(match[2])
      if (href) nodes.push({ type: 'text', text: unescapeMd(match[1]), marks: [{ type: 'link', attrs: { href } }] })
      else pushText(match[0])
    } else if (match[3] !== undefined) pushText(match[3], 'bold')
    else if (match[4] !== undefined) pushText(match[4], 'strike')
    else if (match[5] !== undefined) pushText(match[5], 'italic')
    else if (match[6] !== undefined) pushText(match[6], 'italic')
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < raw.length) pushText(raw.slice(lastIndex))
  return nodes
}

function parseListItem(text: string): CollectionNode {
  return { type: 'listItem', content: [{ type: 'paragraph', ...(text ? { content: parseInline(text) } : {}) }] }
}

export function markdownToCollectionDoc(markdown: string): CollectionDoc {
  const lines = markdown.replace(/\r\n|\r/g, '\n').split('\n')
  const content: CollectionNode[] = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (trimmed === '') {
      // 连续多个空行只插入一个空段落，避免粘贴/转换时出现异常大的空白。
      const previous = content[content.length - 1]
      if (!(previous?.type === 'paragraph' && !previous.content?.length)) content.push({ type: 'paragraph' })
      i += 1; continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      content.push({ type: 'heading', attrs: { level: heading[1].length as 1 | 2 | 3 }, content: parseInline(heading[2]) })
      i += 1; continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) { content.push({ type: 'horizontalRule' }); i += 1; continue }
    if (/^>\s?/.test(trimmed)) {
      const quoted: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) { quoted.push(lines[i].trim().replace(/^>\s?/, '')); i += 1 }
      content.push({ type: 'blockquote', content: quoted.map((line) => ({ type: 'paragraph', ...(line ? { content: parseInline(line) } : {}) })) })
      continue
    }
    const bullet = /^[-*]\s+(.+)$/.exec(trimmed)
    if (bullet) {
      const items: CollectionNode[] = []
      while (i < lines.length) {
        const m = /^[-*]\s+(.+)$/.exec(lines[i].trim())
        if (!m) break
        items.push(parseListItem(m[1]))
        i += 1
      }
      content.push({ type: 'bulletList', content: items })
      continue
    }
    const ordered = /^(\d+)\.\s+(.+)$/.exec(trimmed)
    if (ordered) {
      const start = Number(ordered[1])
      const items: CollectionNode[] = []
      while (i < lines.length) {
        const m = /^(\d+)\.\s+(.+)$/.exec(lines[i].trim())
        if (!m) break
        items.push(parseListItem(m[2]))
        i += 1
      }
      content.push({ type: 'orderedList', ...(start !== 1 ? { attrs: { start } } : {}), content: items })
      continue
    }
    content.push({ type: 'paragraph', content: parseInline(trimmed) })
    i += 1
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}
