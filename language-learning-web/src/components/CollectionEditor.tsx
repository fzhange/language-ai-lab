import { useRef, useState } from 'react'
import { FileText, PenLine } from 'lucide-react'
import { SimpleEditor } from './ui/simple-editor'
import { COLLECTION_HIGHLIGHT_COLORS, COLLECTION_TEXT_COLORS, collectionPlainText, parseCollectionDoc, type CollectionDoc } from '../lib/collection-document'
import { collectionDocToMarkdown, markdownToCollectionDoc } from '../lib/collection-markdown'

const textColors = [
  { name: '墨色', color: COLLECTION_TEXT_COLORS[4] },
  { name: '蓝色', color: COLLECTION_TEXT_COLORS[5] },
  { name: '莓红', color: COLLECTION_TEXT_COLORS[6] },
  { name: '绿色', color: COLLECTION_TEXT_COLORS[7] },
]
const backgroundColors = [
  { name: '黄色', color: COLLECTION_HIGHLIGHT_COLORS[0] },
  { name: '蓝色', color: COLLECTION_HIGHLIGHT_COLORS[1] },
  { name: '粉色', color: COLLECTION_HIGHLIGHT_COLORS[2] },
  { name: '绿色', color: COLLECTION_HIGHLIGHT_COLORS[3] },
]

const EMPTY_DOC: CollectionDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

const tabButton = (active: boolean) =>
  `flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`

export function CollectionEditor({ initialDoc, onChange, disabled = false }: { initialDoc: CollectionDoc | null; onChange: (doc: CollectionDoc | null, plainText: string) => void; disabled?: boolean }) {
  const [mode, setMode] = useState<'rich' | 'markdown'>('rich')
  // 两种模式共享同一份文档；richKey 在切回富文本时递增，强制编辑器用最新内容重新挂载。
  const docRef = useRef<CollectionDoc>(initialDoc ?? EMPTY_DOC)
  const [richKey, setRichKey] = useState(0)
  const [richInitialDoc, setRichInitialDoc] = useState<CollectionDoc>(initialDoc ?? EMPTY_DOC)
  const [markdownText, setMarkdownText] = useState(() => collectionDocToMarkdown(initialDoc ?? EMPTY_DOC))

  function emit(doc: CollectionDoc | null) {
    docRef.current = doc ?? EMPTY_DOC
    onChange(doc, doc ? collectionPlainText(doc) : '')
  }

  function switchTo(next: 'rich' | 'markdown') {
    if (next === mode) return
    if (next === 'markdown') setMarkdownText(collectionDocToMarkdown(docRef.current))
    else { setRichInitialDoc(docRef.current); setRichKey((key) => key + 1) }
    setMode(next)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div role="tablist" aria-label="编辑模式" className="flex w-fit shrink-0 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
        <button type="button" role="tab" aria-selected={mode === 'rich'} disabled={disabled} onClick={() => switchTo('rich')} className={tabButton(mode === 'rich')}>
          <PenLine className="size-4" />富文本
        </button>
        <button type="button" role="tab" aria-selected={mode === 'markdown'} disabled={disabled} onClick={() => switchTo('markdown')} className={tabButton(mode === 'markdown')}>
          <FileText className="size-4" />Markdown
        </button>
      </div>
      {mode === 'rich' ? (
        <SimpleEditor
          key={richKey}
          label="收藏内容"
          initialContent={richInitialDoc}
          textColors={textColors}
          backgroundColors={backgroundColors}
          placeholder="粘贴或输入想收藏的文字，然后选中词句上色…"
          disabled={disabled}
          onChange={(content) => emit(parseCollectionDoc(content))}
        />
      ) : (
        <textarea
          aria-label="收藏内容（Markdown）"
          disabled={disabled}
          value={markdownText}
          onChange={(event) => {
            const text = event.target.value
            setMarkdownText(text)
            emit(parseCollectionDoc(markdownToCollectionDoc(text)))
          }}
          placeholder={'支持标准 Markdown：# 标题、**加粗**、_斜体_、~~删除线~~、[链接](https://...)、- 列表、> 引用、---'}
          className="min-h-0 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-5 py-4 font-mono text-sm leading-relaxed text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-60"
        />
      )}
    </div>
  )
}
