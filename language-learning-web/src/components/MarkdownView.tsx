/** 统一的 Markdown 渲染：GFM（表格/删除线/任务列表）+ Tailwind typography 排版。 */

import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function MarkdownView({ children, compact = false }: { children: string; compact?: boolean }) {
  return (
    <div
      className={[
        'prose prose-neutral prose-sm max-w-none leading-relaxed text-foreground',
        'prose-headings:font-semibold prose-headings:text-foreground',
        compact
          ? 'inline !text-sm prose-headings:my-1 prose-p:my-0 prose-p:text-foreground prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-li:text-foreground [&>p:first-child]:inline'
          : 'prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
        // 行内代码
        'prose-code:rounded prose-code:bg-accent prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:text-primary prose-code:before:content-none prose-code:after:content-none',
        // 代码块
        'prose-pre:rounded-lg prose-pre:bg-neutral-900 prose-pre:text-neutral-100',
        // 表格
        'prose-table:my-3 prose-table:block prose-table:overflow-x-auto prose-th:bg-muted prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5 prose-td:align-top',
        // 引用块
        'prose-blockquote:border-l-primary/40 prose-blockquote:text-muted-foreground prose-blockquote:not-italic',
        // 链接
        'prose-a:text-primary prose-a:no-underline hover:prose-a:underline',
        // 分隔线
        'prose-hr:my-4',
      ].join(' ')}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  )
}
