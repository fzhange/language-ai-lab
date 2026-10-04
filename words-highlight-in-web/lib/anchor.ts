// 文本锚点：把一次选区序列化为 {exact, prefix, suffix}，
// 并能在页面刷新后根据它重新定位到 Range。
// 不依赖 DOM 结构，跨刷新、跨小改动仍能较稳定地命中。
import type { TextQuote } from './types';

const BLOCK_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'IFRAME',
  'CANVAS', 'SVG', 'MATH', 'HEAD', 'TITLE'
]);
const CONTEXT_LEN = 40;

interface TextNodeEntry {
  node: Text;
  start: number;
  end: number;
}

interface TextIndex {
  text: string;
  nodes: TextNodeEntry[];
  startMap: Map<Text, number>;
}

// 收集页面中参与高亮的所有文本节点，并拼成一段连续文本，
// 记录每个节点在整段文本中的 [start, end) 区间。
function collectTextNodes(): TextIndex {
  const root = document.body;
  if (!root) return { text: '', nodes: [], startMap: new Map() };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node as Text;
      if (!text.nodeValue) return NodeFilter.FILTER_REJECT;
      const parent = text.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (BLOCK_TAGS.has(parent.nodeName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('.whw-toolbar, .whw-ui')) return NodeFilter.FILTER_REJECT;
      // 跳过不可见节点
      const view = parent.ownerDocument.defaultView;
      const style = view ? view.getComputedStyle(parent) : null;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes: TextNodeEntry[] = [];
  const startMap = new Map<Text, number>();
  let text = '';
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    const start = text.length;
    text += t.nodeValue;
    nodes.push({ node: t, start, end: text.length });
    startMap.set(t, start);
  }
  return { text, nodes, startMap };
}

// 二分查找：全局 offset -> {node, offset}
function locate(offset: number, nodes: TextNodeEntry[]): { node: Text; offset: number } {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const nd = nodes[mid];
    if (offset < nd.start) hi = mid - 1;
    else if (offset >= nd.end) lo = mid + 1;
    else return { node: nd.node, offset: offset - nd.start };
  }
  const last = nodes[nodes.length - 1];
  return { node: last.node, offset: last.node.nodeValue!.length };
}

// DOM point (container, offset) -> 全局文本 offset
function pointToGlobal(container: Node, offset: number, nodes: TextNodeEntry[], startMap: Map<Text, number>): number {
  if (container.nodeType === Node.TEXT_NODE && startMap.has(container as Text)) {
    return startMap.get(container as Text)! + offset;
  }
  const point = document.createRange();
  try {
    point.setStart(container, offset);
  } catch (e) {
    return 0;
  }
  let total = 0;
  for (const nd of nodes) {
    const node = nd.node;
    const len = node.nodeValue!.length;
    let endCmp = -1;
    try { endCmp = point.comparePoint(node, len); } catch (e) { /* ignore */ }
    if (endCmp < 0) { total += len; continue; }
    let startCmp = 1;
    try { startCmp = point.comparePoint(node, 0); } catch (e) { /* ignore */ }
    if (startCmp > 0) break; // 该节点整体在 point 之后
    if (container === node) {
      total += offset;
    } else {
      const sub = document.createRange();
      try {
        sub.setStart(node, 0);
        sub.setEnd(container, offset);
        total += sub.toString().length;
      } catch (e) { /* ignore */ }
    }
    break;
  }
  return total;
}

// 在整段文本中定位 quote，返回命中的全局 start offset（找不到返回 -1）
function findIndex(text: string, quote: TextQuote): number {
  const exact = quote.exact || '';
  const prefix = quote.prefix || '';
  const suffix = quote.suffix || '';
  if (!exact) return -1;

  let i = text.indexOf(prefix + exact + suffix);
  if (i >= 0) return i + prefix.length;

  if (prefix) {
    i = text.indexOf(prefix + exact);
    if (i >= 0) return i + prefix.length;
  }
  if (suffix) {
    i = text.indexOf(exact + suffix);
    if (i >= 0) return i;
  }
  return text.indexOf(exact);
}

// 由当前 Range 生成 quote
export function quoteFromRange(range: Range): TextQuote | null {
  const { text, nodes, startMap } = collectTextNodes();
  if (!nodes.length) return null;
  const startGlobal = pointToGlobal(range.startContainer, range.startOffset, nodes, startMap);
  const endGlobal = pointToGlobal(range.endContainer, range.endOffset, nodes, startMap);
  if (endGlobal <= startGlobal) return null;
  const exact = text.slice(startGlobal, endGlobal);
  if (!exact.trim()) return null;
  const prefix = text.slice(Math.max(0, startGlobal - CONTEXT_LEN), startGlobal);
  const suffix = text.slice(endGlobal, Math.min(text.length, endGlobal + CONTEXT_LEN));
  return { exact, prefix, suffix };
}

// 强匹配校验：仅接受带上下文的命中（用于跨页找回误归档的高亮，
// 避免"Get your tickets"这类通用短句在别的页面误命中）。
export function quoteMatchesStrict(quote: TextQuote): boolean {
  const { text, nodes } = collectTextNodes();
  if (!nodes.length) return false;
  const exact = quote.exact || '';
  const prefix = quote.prefix || '';
  const suffix = quote.suffix || '';
  if (!exact) return false;
  if (prefix && suffix && text.indexOf(prefix + exact + suffix) >= 0) return true;
  if (prefix && text.indexOf(prefix + exact) >= 0) return true;
  if (suffix && text.indexOf(exact + suffix) >= 0) return true;
  // 无上下文可用时，要求 exact 全页唯一才算命中
  if (!prefix && !suffix) {
    const i = text.indexOf(exact);
    return i >= 0 && text.indexOf(exact, i + 1) < 0;
  }
  return false;
}

// 由 quote 还原出 Range
export function rangeFromQuote(quote: TextQuote): Range | null {
  const { text, nodes } = collectTextNodes();
  if (!nodes.length) return null;
  const idx = findIndex(text, quote);
  if (idx < 0) return null;
  const len = quote.exact.length;
  const startInfo = locate(idx, nodes);
  // 结束点用"最后一个字符所在节点内的位置 +1"，避免落到边界时跳到
  // 下一个文本节点的 offset 0，导致 range 跨块、角标/高亮溢出到下一行。
  const lastCharInfo = locate(idx + len - 1, nodes);
  const range = document.createRange();
  try {
    range.setStart(startInfo.node, startInfo.offset);
    range.setEnd(lastCharInfo.node, lastCharInfo.offset + 1);
  } catch (e) {
    return null;
  }
  return range;
}
