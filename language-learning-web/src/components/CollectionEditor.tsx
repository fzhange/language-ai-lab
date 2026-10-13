import { SimpleEditor } from './ui/simple-editor'
import { COLLECTION_HIGHLIGHT_COLORS, COLLECTION_TEXT_COLORS, collectionPlainText, parseCollectionDoc, type CollectionDoc } from '../lib/collection-document'

const textColors = [
  { name: '深色', color: COLLECTION_TEXT_COLORS[0] },
  { name: '蓝色', color: COLLECTION_TEXT_COLORS[1] },
  { name: '玫瑰', color: COLLECTION_TEXT_COLORS[2] },
  { name: '绿松', color: COLLECTION_TEXT_COLORS[3] },
]
const backgroundColors = [
  { name: '黄色', color: COLLECTION_HIGHLIGHT_COLORS[0] },
  { name: '蓝色', color: COLLECTION_HIGHLIGHT_COLORS[1] },
  { name: '粉色', color: COLLECTION_HIGHLIGHT_COLORS[2] },
  { name: '绿色', color: COLLECTION_HIGHLIGHT_COLORS[3] },
]

export function CollectionEditor({ initialDoc, onChange, disabled = false }: { initialDoc: CollectionDoc | null; onChange: (doc: CollectionDoc | null, plainText: string) => void; disabled?: boolean }) {
  return <SimpleEditor
    label="收藏内容"
    initialContent={initialDoc}
    textColors={textColors}
    backgroundColors={backgroundColors}
    placeholder="粘贴或输入想收藏的文字，然后选中词句上色…"
    disabled={disabled}
    onChange={(content) => {
      const doc = parseCollectionDoc(content)
      onChange(doc, doc ? collectionPlainText(doc) : '')
    }}
  />
}
