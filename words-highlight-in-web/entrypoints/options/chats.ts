// 聊天记录视图：跨高亮列出全部 AI 会话，点开可回看完整对话（只读，不提问）。
import { renderMarkdown } from '../../lib/markdown';
import type { HighlightItem } from '../../lib/types';
import type { OptionsCtx, PageCache } from './ctx';

interface ChatThreadSummary {
  highlightId: string;
  threadId: string;
  count: number;
  firstUserText: string;
  lastText: string;
  lastAt: string | null;
}

interface ChatMsg {
  role: 'user' | 'assistant';
  text: string;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch (e) {
    return '';
  }
}

// 首轮 prompt 里包裹了高亮上下文，展示时只留用户的真实问题（与 content.ts displayChatText 一致）
function displayText(m: ChatMsg): string {
  if (m.role === 'user' && m.text.startsWith('我在网页上高亮了这段内容')) {
    const parts = m.text.split('\n\n');
    return parts[parts.length - 1] || m.text;
  }
  return m.text;
}

// 用 highlightId 在缓存里反查高亮原文与所属页面，作为会话标题
function findHighlight(
  ctx: OptionsCtx, id: string
): { h: HighlightItem; page: PageCache } | null {
  for (const p of ctx.getCache()) {
    for (const h of p.highlights) {
      if (h.id === id) return { h, page: p };
    }
  }
  return null;
}

/* ----------------------- 列表 ----------------------- */
export async function renderChats(root: HTMLElement, ctx: OptionsCtx): Promise<void> {
  root.innerHTML = '';
  const loading = el('div', 'panel');
  loading.appendChild(el('p', 'panel-desc', '正在加载聊天记录…'));
  root.appendChild(loading);

  const resp = await ctx.send<{ ok: boolean; threads?: ChatThreadSummary[]; error?: string }>({
    type: 'listChats'
  });

  root.innerHTML = '';

  if (!resp || !resp.ok) {
    const card = el('div', 'panel');
    card.appendChild(el('div', 'panel-title', '看不了聊天记录'));
    const isAuth = resp && resp.error === 'not signed in';
    card.appendChild(el(
      'p', 'panel-desc',
      isAuth
        ? '聊天记录保存在云端，请先在上方登录云同步账号后再查看。'
        : (resp && resp.error) || '加载失败，请稍后重试。'
    ));
    root.appendChild(card);
    return;
  }

  const threads = resp.threads || [];
  if (!threads.length) {
    const card = el('div', 'panel');
    card.appendChild(el('div', 'panel-title', '还没有聊天记录'));
    card.appendChild(el('p', 'panel-desc', '在网页上高亮文本后点「✨ 问 AI」，对话会自动保存到这里。'));
    root.appendChild(card);
    return;
  }

  const head = el('div', 'panel');
  head.appendChild(el('div', 'panel-title', `聊天记录（${threads.length} 个会话）`));
  head.appendChild(el('p', 'panel-desc', '点任意会话查看完整对话。'));
  root.appendChild(head);

  const list = el('ul', 'chat-threads');
  for (const t of threads) {
    const found = findHighlight(ctx, t.highlightId);
    const title = (found && found.h.exact) || displayText({ role: 'user', text: t.firstUserText }) || '（已删除的高亮）';
    const pageTitle = found ? found.page.title || found.page.url : '';

    const li = el('li', 'chat-thread');
    const main = el('div', 'chat-thread-main');
    main.appendChild(el('div', 'chat-thread-title', title));
    const meta = el('div', 'chat-thread-meta');
    const parts = [`${t.count} 条消息`];
    if (pageTitle) parts.push(pageTitle);
    if (t.lastAt) parts.push(fmtTime(t.lastAt));
    meta.textContent = parts.join(' · ');
    main.appendChild(meta);
    li.appendChild(main);

    li.addEventListener('click', () => {
      void renderConversation(root, ctx, t, title, found);
    });
    list.appendChild(li);
  }
  root.appendChild(list);
}

/* ----------------------- 会话详情 ----------------------- */
async function renderConversation(
  root: HTMLElement,
  ctx: OptionsCtx,
  t: ChatThreadSummary,
  title: string,
  found: { h: HighlightItem; page: PageCache } | null
): Promise<void> {
  root.innerHTML = '';

  const bar = el('div', 'chat-detail-bar');
  const back = el('button', 'btn', '← 返回列表');
  back.addEventListener('click', () => void renderChats(root, ctx));
  bar.appendChild(back);
  if (found) {
    const open = el('button', 'btn', '打开原页面');
    open.addEventListener('click', () => ctx.openAt(found.page.url, found.h.id));
    bar.appendChild(open);
  }
  root.appendChild(bar);

  const card = el('div', 'panel');
  const quote = el('div', 'chat-quote', title);
  card.appendChild(quote);

  const log = el('div', 'chat-log');
  log.appendChild(el('p', 'panel-desc', '正在加载对话…'));
  card.appendChild(log);
  root.appendChild(card);

  const resp = await ctx.send<{ ok: boolean; messages?: ChatMsg[]; error?: string }>({
    type: 'aiChatHistory',
    highlightId: t.highlightId
  });

  log.innerHTML = '';
  const messages = (resp && resp.ok && resp.messages) || [];
  if (!messages.length) {
    log.appendChild(el('p', 'panel-desc', '这段会话已无法读取（可能已在服务端过期）。'));
    return;
  }

  for (const m of messages) {
    const row = el('div', 'chat-msg ' + (m.role === 'user' ? 'me' : 'ai'));
    const bubble = el('div', 'chat-bubble');
    if (m.role === 'assistant') {
      bubble.innerHTML = renderMarkdown(m.text);
    } else {
      bubble.textContent = displayText(m);
    }
    row.appendChild(bubble);
    log.appendChild(row);
  }
}
