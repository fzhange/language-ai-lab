import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import type { JSONContent } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Heading from '@tiptap/extension-heading'
import Blockquote from '@tiptap/extension-blockquote'
import { BulletList, OrderedList, ListItem, ListKeymap } from '@tiptap/extension-list'
import Bold from '@tiptap/extension-bold'
import Italic from '@tiptap/extension-italic'
import Strike from '@tiptap/extension-strike'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import { Color, TextStyle } from '@tiptap/extension-text-style'
import { PaletteHighlight } from './palette-highlight'
import { UndoRedo } from '@tiptap/extensions'
import { AlignCenter, AlignLeft, AlignRight, Bold as BoldIcon, Check, Italic as ItalicIcon, Link2, List, ListOrdered, Quote, Redo2, Strikethrough, Underline as UnderlineIcon, Undo2 } from 'lucide-react'
import { parseSafeCollectionUrl } from '../../lib/collection-document'

type ColorOption = { name: string; color: string }

interface SimpleEditorProps {
  label: string
  initialContent: JSONContent | null
  onChange: (content: JSONContent) => void
  textColors: readonly ColorOption[]
  backgroundColors: readonly ColorOption[]
  placeholder: string
  disabled?: boolean
}

const extensions = [
  Document, Paragraph, Text, Heading.configure({ levels: [1, 2, 3] }), Blockquote,
  BulletList, OrderedList, ListItem, ListKeymap, Bold, Italic, Strike, Underline,
  Link.configure({ autolink: false, linkOnPaste: false, openOnClick: false,
    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer', class: null },
    isAllowedUri: (value) => parseSafeCollectionUrl(value) !== null }),
  TextAlign.configure({ types: ['paragraph', 'heading'], alignments: ['left', 'center', 'right'] }),
  TextStyle, Color, PaletteHighlight, UndoRedo,
]
const toolbarButton = 'flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40'

export function SimpleEditor({ label, initialContent, onChange, textColors, backgroundColors, placeholder, disabled = false }: SimpleEditorProps) {
  const onChangeRef = useRef(onChange)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [linkError, setLinkError] = useState('')
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  const editor = useEditor({
    extensions,
    content: initialContent ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: false,
    editable: !disabled,
    editorProps: {
      attributes: { 'aria-label': label, role: 'textbox', class: 'min-h-full whitespace-pre-wrap break-words px-5 py-4 outline-none' },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain') ?? ''
        if (text && editor?.isEditable) {
          const lines = text.split(/\r\n|\r|\n/)
          const content = lines.length === 1 ? { type: 'text', text } : lines.map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) }))
          editor.chain().focus().insertContentAt({ from: editor.state.selection.from, to: editor.state.selection.to }, content).run()
        }
        return true
      },
      handleDrop: () => true,
      handleKeyDown: (_view, event) => {
        if (event.key !== 'Enter') return false
        if (event.isComposing || event.keyCode === 229) return true
        if (event.altKey || event.ctrlKey || event.metaKey || !editor?.isEditable) return false
        if (!event.shiftKey) return false
        event.preventDefault()
        editor.commands.splitBlock()
        return true
      },
    },
    onUpdate: ({ editor: current }) => onChangeRef.current(current.getJSON()),
  })

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      textColor: current?.getAttributes('textStyle').color as string | undefined,
      backgroundColor: current?.getAttributes('highlight').color as string | undefined,
      empty: current?.isEmpty ?? !initialContent,
      canUndo: current?.can().undo() ?? false,
      canRedo: current?.can().redo() ?? false,
      heading: ([1, 2, 3] as const).find((level) => current?.isActive('heading', { level })) ?? 0,
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      underline: current?.isActive('underline') ?? false,
      strike: current?.isActive('strike') ?? false,
      bulletList: current?.isActive('bulletList') ?? false,
      orderedList: current?.isActive('orderedList') ?? false,
      blockquote: current?.isActive('blockquote') ?? false,
      alignment: (current?.getAttributes('paragraph').textAlign || current?.getAttributes('heading').textAlign || 'left') as string,
      link: current?.isActive('link') ?? false,
    }),
  })

  useEffect(() => { editor?.setEditable(!disabled) }, [editor, disabled])

  const formats = [
    { label: '正文', icon: 'P', active: state?.heading === 0, action: () => editor?.chain().focus().setParagraph().run() },
    ...([1, 2, 3] as const).map((level) => ({ label: `标题 ${level}`, icon: `H${level}`, active: state?.heading === level,
      action: () => editor?.chain().focus().toggleHeading({ level }).run() })),
    { label: '粗体', icon: <BoldIcon className="size-4" />, active: state?.bold, action: () => editor?.chain().focus().toggleBold().run() },
    { label: '斜体', icon: <ItalicIcon className="size-4" />, active: state?.italic, action: () => editor?.chain().focus().toggleItalic().run() },
    { label: '下划线', icon: <UnderlineIcon className="size-4" />, active: state?.underline, action: () => editor?.chain().focus().toggleUnderline().run() },
    { label: '删除线', icon: <Strikethrough className="size-4" />, active: state?.strike, action: () => editor?.chain().focus().toggleStrike().run() },
    { label: '无序列表', icon: <List className="size-4" />, active: state?.bulletList, action: () => editor?.chain().focus().toggleBulletList().run() },
    { label: '有序列表', icon: <ListOrdered className="size-4" />, active: state?.orderedList, action: () => editor?.chain().focus().toggleOrderedList().run() },
    { label: '引用', icon: <Quote className="size-4" />, active: state?.blockquote, action: () => editor?.chain().focus().toggleBlockquote().run() },
    ...(['left', 'center', 'right'] as const).map((alignment) => ({
      label: ({ left: '左对齐', center: '居中对齐', right: '右对齐' })[alignment],
      icon: ({ left: <AlignLeft className="size-4" />, center: <AlignCenter className="size-4" />, right: <AlignRight className="size-4" /> })[alignment],
      active: state?.alignment === alignment, action: () => editor?.chain().focus().setTextAlign(alignment).run(),
    })),
  ]

  function applyLink() {
    const href = parseSafeCollectionUrl(linkValue)
    if (!href) { setLinkError('仅支持完整的 http:// 或 https:// 链接'); return }
    if (!editor || editor.state.selection.empty) { setLinkError('请先选中要添加链接的文字'); return }
    editor.chain().focus().setLink({ href, target: '_blank', rel: 'noopener noreferrer' }).run()
    setLinkError('')
    setLinkOpen(false)
    setLinkValue('')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div role="toolbar" aria-label="文本格式" aria-disabled={disabled} className="flex max-h-[35vh] shrink-0 flex-wrap items-center gap-1 overflow-y-auto border-b border-slate-200 bg-white px-3 py-2 sm:max-h-[24vh]">
        <button type="button" className={toolbarButton} title="撤销" aria-label="撤销" disabled={disabled || !state?.canUndo} onClick={() => editor?.chain().focus().undo().run()}><Undo2 className="size-4" /></button>
        <button type="button" className={toolbarButton} title="重做" aria-label="重做" disabled={disabled || !state?.canRedo} onClick={() => editor?.chain().focus().redo().run()}><Redo2 className="size-4" /></button>
        <span aria-hidden="true" className="mx-2 h-6 w-px bg-slate-200" />
        {formats.map(({ label, icon, active, action }) => <button key={label} type="button" title={label} aria-label={label} aria-pressed={Boolean(active)} disabled={disabled}
          onMouseDown={(event) => event.preventDefault()} onClick={action} className={`${toolbarButton} ${active ? 'bg-indigo-50 text-primary' : ''}`}>{icon}</button>)}
        <span aria-hidden="true" className="mx-2 h-6 w-px bg-slate-200" />
        <button type="button" title="插入链接" aria-label="插入链接" aria-pressed={Boolean(state?.link)} disabled={disabled} onMouseDown={(event) => event.preventDefault()}
          onClick={() => { setLinkOpen((open) => !open); setLinkError('') }} className={`${toolbarButton} ${state?.link ? 'bg-indigo-50 text-primary' : ''}`}><Link2 className="size-4" /></button>
        {state?.link && <button type="button" title="移除链接" aria-label="移除链接" disabled={disabled} onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().unsetLink().run()} className={`${toolbarButton} w-auto px-2 text-xs`}>移除链接</button>}
        <span aria-hidden="true" className="mx-2 h-6 w-px bg-slate-200" />
        <div role="group" aria-label="文字颜色" className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-medium text-slate-500">文字</span>
          {textColors.map(({ name, color }) => {
            const selected = state?.textColor === color || (!state?.textColor && color === textColors[0]?.color)
            return <button key={color} type="button" disabled={disabled} title={`文字颜色 ${name}`} aria-label={`文字颜色 ${name}`} aria-pressed={selected} onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor?.chain().focus().setColor(color).run()}
              className={`${toolbarButton} font-semibold ${selected ? 'bg-indigo-50 text-primary' : ''}`}
              style={{ color }}>A</button>
          })}
        </div>
        <span aria-hidden="true" className="mx-2 h-6 w-px bg-slate-200" />
        <div role="group" aria-label="背景颜色" className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs font-medium text-slate-500">背景</span>
          <button type="button" disabled={disabled} title="背景颜色 白色" aria-label="背景颜色 白色" aria-pressed={!state?.backgroundColor} onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor?.chain().focus().unsetHighlight().run()} className={`${toolbarButton} border border-slate-200 text-xs ${!state?.backgroundColor ? 'ring-2 ring-slate-300' : ''}`}
            style={{ backgroundColor: '#ffffff' }}>{!state?.backgroundColor ? <Check className="size-4" aria-hidden="true" /> : 'Aa'}</button>
          {backgroundColors.map(({ name, color }) => {
            const selected = state?.backgroundColor === color
            return <button key={color} type="button" disabled={disabled} title={`背景颜色 ${name}`} aria-label={`背景颜色 ${name}`} aria-pressed={selected} onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor?.chain().focus().setHighlight({ color }).run()}
              className={`${toolbarButton} border border-slate-200 text-xs ${selected ? 'ring-2 ring-slate-300' : ''}`}
              style={{ backgroundColor: color }}>{selected ? <Check className="size-4" aria-hidden="true" /> : 'Aa'}</button>
          })}
        </div>
        <span aria-hidden="true" className="mx-2 h-6 w-px bg-slate-200" />
        <button type="button" disabled={disabled} className={`${toolbarButton} w-auto px-2 text-xs`} onMouseDown={(event) => event.preventDefault()} onClick={() => editor?.chain().focus().unsetAllMarks().run()}>清除选中格式</button>
      </div>
      {linkOpen && <form onSubmit={(event) => { event.preventDefault(); applyLink() }} className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <label htmlFor="simple-editor-link" className="text-sm text-slate-600">链接地址</label>
        <input id="simple-editor-link" aria-label="链接地址" type="url" value={linkValue} onChange={(event) => { setLinkValue(event.target.value); setLinkError('') }}
          placeholder="https://example.com" className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" />
        <button type="submit" disabled={disabled} className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">应用链接</button>
        <button type="button" onClick={() => { setLinkOpen(false); setLinkError('') }} className="rounded-lg px-3 py-1.5 text-sm text-slate-600">取消</button>
        {linkError && <span role="alert" className="w-full text-sm text-destructive">{linkError}</span>}
      </form>}
      <div className="relative flex min-h-0 flex-1 flex-col bg-white">
        {state?.empty && <span className="pointer-events-none absolute left-5 top-4 text-lg leading-8 text-slate-400">{placeholder}</span>}
        <EditorContent editor={editor} className="min-h-0 flex-1 overflow-y-auto text-lg leading-8 text-slate-800 [&_h1]:mt-5 [&_h1]:mb-3 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/50 [&_blockquote]:pl-4 [&_blockquote]:text-slate-600 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2" />
      </div>
    </div>
  )
}
