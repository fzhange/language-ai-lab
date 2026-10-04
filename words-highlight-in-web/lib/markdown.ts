// Markdown 渲染：marked 解析 + DOMPurify 消毒（防 XSS），业界标准组合。
// 支持标题、列表、引用、代码块、表格等完整 CommonMark/GFM 语法。
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false, breaks: true, gfm: true });
  return DOMPurify.sanitize(html);
}
