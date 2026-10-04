import { defineBackground } from 'wxt/sandbox';
import { COLORS } from '../lib/colors';
import type { HighlightItem } from '../lib/types';
import * as store from '../lib/sync-store';
import * as review from '../lib/review';
import { runGraph, extractJson, pingAiService, createThread, runOnThread, streamOnThread, getThreadMessages } from '../lib/ai';
import { signIn, signUp, signOut, getAuthState, saveChatTurn, fetchChatMessages, listChatThreads } from '../lib/supabase';

// Service worker：本地缓存 + Supabase 云端同步（Supabase Auth 邮箱登录）。
async function handleLoad(url: string) {
  const highlights = await store.getPage(url);
  return { ok: true, highlights, source: 'supabase' };
}

async function handleSave(url: string, highlights: HighlightItem[], title?: string) {
  const list = Array.isArray(highlights) ? highlights : [];
  if (list.length === 0) {
    await store.deletePage(url);
    return { ok: true, deleted: true };
  }
  return store.savePage(url, list, title);
}

async function handleList() {
  const pages = await store.listPages();
  return { ok: true, pages, source: 'supabase' };
}

async function handleDeletePage(url: string) {
  await store.deletePage(url);
  return { ok: true };
}

async function handleSyncState() {
  const auth = await getAuthState();
  const lastPull = (await chrome.storage.local.get('whw:v2:lastPull'))['whw:v2:lastPull'] || null;
  return { ok: true, ...auth, lastPull };
}

/* ----------------------- AI 代理 ----------------------- */
// 所有 AI 请求统一从 background 发出，页面不直接持有服务地址之外的逻辑。

interface QuizItem {
  id: string;
  exact: string;
  note?: string;
  insight?: string;
  title?: string;
}

async function handleAiQuiz(items: QuizItem[]) {
  const payload = (Array.isArray(items) ? items : []).slice(0, 12).map((h) => ({
    id: h.id,
    exact: h.exact,
    note: h.note || '',
    insight: h.insight || '',
    title: h.title || ''
  }));
  if (!payload.length) return { ok: false, error: '没有可出题的高亮' };
  const text = await runGraph('highlight-quiz', JSON.stringify({ highlights: payload }));
  try {
    return { ok: true, quiz: extractJson(text) };
  } catch (e) {
    return { ok: false, error: 'AI 出题结果解析失败：' + (e instanceof Error ? e.message : String(e)) };
  }
}

async function handleAiReport(body: { range?: unknown; stats?: unknown; highlights?: unknown }) {
  const text = await runGraph('highlight-report', JSON.stringify(body));
  return { ok: true, report: text };
}

/* ----------------------- 高亮追问（thread 会话） ----------------------- */
// highlightId → threadId 映射存本地，每条高亮一个会话，重开面板可续聊。
const THREADS_KEY = 'whw:v2:threads';

async function getThreadId(highlightId: string): Promise<string | null> {
  const res = await chrome.storage.local.get(THREADS_KEY);
  const map = (res[THREADS_KEY] as Record<string, string>) || {};
  return map[highlightId] || null;
}

async function setThreadId(highlightId: string, threadId: string): Promise<void> {
  const res = await chrome.storage.local.get(THREADS_KEY);
  const map = (res[THREADS_KEY] as Record<string, string>) || {};
  map[highlightId] = threadId;
  await chrome.storage.local.set({ [THREADS_KEY]: map });
}

interface ChatContext {
  exact?: string;
  title?: string;
}

// 首轮把高亮原文包进 prompt 提供上下文；后续轮次直接发用户输入
function buildChatPrompt(content: string, ctx: ChatContext, withContext: boolean): string {
  if (!withContext || !ctx.exact) return content;
  return `我在网页上高亮了这段内容（出自页面《${ctx.title || '未知页面'}》）：\n「${ctx.exact}」\n\n${content}`;
}

async function ensureChatThread(highlightId: string): Promise<{ threadId: string; first: boolean }> {
  const existing = await getThreadId(highlightId);
  if (existing) return { threadId: existing, first: false };
  const threadId = await createThread();
  await setThreadId(highlightId, threadId);
  return { threadId, first: true };
}

async function handleAiChat(msg: { highlightId?: string; content?: string; context?: ChatContext }) {
  const highlightId = String(msg.highlightId || '');
  const content = String(msg.content || '').trim();
  if (!highlightId || !content) return { ok: false, error: '参数缺失' };
  const ctx = msg.context || {};

  const { threadId, first } = await ensureChatThread(highlightId);
  try {
    const reply = await runOnThread(threadId, 'highlight-buddy', buildChatPrompt(content, ctx, first));
    saveChatTurn(highlightId, threadId, content, reply).catch(() => {}); // 落 PG，不阻塞
    return { ok: true, reply };
  } catch (e) {
    // thread 可能已过期（本地 inmem 服务重启会丢会话），重建并重试一次
    try {
      const fresh = await createThread();
      await setThreadId(highlightId, fresh);
      const reply = await runOnThread(fresh, 'highlight-buddy', buildChatPrompt(content, ctx, true));
      saveChatTurn(highlightId, fresh, content, reply).catch(() => {});
      return { ok: true, reply };
    } catch (e2) {
      return { ok: false, error: e2 instanceof Error ? e2.message : String(e2) };
    }
  }
}

// 流式追问：通过 port 只传回答与可公开的真实执行进度。
// 服务端已开始运行后绝不重试，避免工具执行过但尚未输出文字时重复提交。
async function handleAiChatStream(
  port: chrome.runtime.Port,
  msg: { highlightId?: string; content?: string; context?: ChatContext }
) {
  let connected = true;
  port.onDisconnect.addListener(() => { connected = false; });
  const send = (message: Record<string, unknown>) => {
    if (!connected) return;
    try { port.postMessage(message); } catch (e) { connected = false; }
  };
  const highlightId = String(msg.highlightId || '');
  const content = String(msg.content || '').trim();
  if (!highlightId || !content) {
    send({ type: 'error', error: '参数缺失' });
    return;
  }
  const ctx = msg.context || {};
  let started = false;
  try {
    const { threadId, first } = await ensureChatThread(highlightId);
    const reply = await streamOnThread(
      threadId,
      'highlight-buddy',
      buildChatPrompt(content, ctx, first),
      (acc) => {
        started = true;
        send({ type: 'delta', text: acc });
      },
      (activity) => {
        started = true;
        send({ type: 'activity', activity });
      }
    );
    saveChatTurn(highlightId, threadId, content, reply).catch(() => {}); // 落 PG，不阻塞
    send({ type: 'done', reply });
  } catch (e) {
    if (started) {
      // 已有部分输出或服务端执行事件，不再重复发起请求
      send({ type: 'error', error: e instanceof Error ? e.message : String(e) });
      return;
    }
    try {
      const { threadId, first } = await ensureChatThread(highlightId);
      const reply = await runOnThread(threadId, 'highlight-buddy', buildChatPrompt(content, ctx, first));
      saveChatTurn(highlightId, threadId, content, reply).catch(() => {});
      send({ type: 'done', reply });
    } catch (e2) {
      send({ type: 'error', error: e2 instanceof Error ? e2.message : String(e2) });
    }
  }
}

async function handleAiChatHistory(msg: { highlightId?: string }) {
  const highlightId = String(msg.highlightId || '');
  // 优先 Supabase（跨设备的持久记录）；命中时顺带恢复 thread 映射用于续聊
  try {
    const cloud = await fetchChatMessages(highlightId);
    if (cloud.ok && cloud.messages && cloud.messages.length) {
      if (cloud.threadId && !(await getThreadId(highlightId))) {
        await setThreadId(highlightId, cloud.threadId);
      }
      return { ok: true, messages: cloud.messages };
    }
  } catch (e) { /* 未登录或网络异常，回落到 LangGraph 线程状态 */ }
  const tid = await getThreadId(highlightId);
  if (!tid) return { ok: true, messages: [] };
  try {
    return { ok: true, messages: await getThreadMessages(tid) };
  } catch (e) {
    // 服务端会话丢失时按空历史处理，前端会自动开启新会话
    return { ok: true, messages: [] };
  }
}

async function handleListChats() {
  try {
    return await listChatThreads();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/* ----------------------- 每日复习提醒 ----------------------- */
const REVIEW_ALARM = 'whw-review-daily';
const REVIEW_NOTIFICATION = 'whw-review-daily';

function nextEvening(hour = 20): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime();
}

async function countDueHighlights(): Promise<number> {
  const pages = await store.listPages();
  const stats = await review.getReviewStats();
  let n = 0;
  for (const p of pages) {
    const items = await store.getPage(p.url);
    n += review.dueItems(items, stats).length;
  }
  return n;
}

async function maybeNotifyReview() {
  if (!chrome.notifications) return;
  const due = await countDueHighlights().catch(() => 0);
  if (!due) return;
  chrome.notifications.create(REVIEW_NOTIFICATION, {
    type: 'basic',
    iconUrl: '/icons/icon128.png',
    title: '该复习啦',
    message: `你有 ${due} 条高亮待复习，点开开始今天的练习。`
  });
}

export default defineBackground(() => {
  // 启动：迁移旧数据（幂等）→ 后台增量同步
  (async () => {
    try { await store.migrateLegacy(); } catch (e) { console.warn('[whw] 迁移失败', e); }
    try { await store.syncNow(); } catch (e) { console.warn('[whw] 启动同步失败', e); }
  })();

  // 定时增量同步（每 5 分钟）+ 每日复习提醒（默认 20:00）
  if (chrome.alarms) {
    chrome.alarms.create('whw-sync', { periodInMinutes: 5 });
    chrome.alarms.create(REVIEW_ALARM, { when: nextEvening(), periodInMinutes: 24 * 60 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'whw-sync') store.syncNow().catch(() => {});
      if (alarm.name === REVIEW_ALARM) maybeNotifyReview().catch(() => {});
    });
  }

  // 点击复习提醒 → 打开管理页复习 tab
  if (chrome.notifications) {
    chrome.notifications.onClicked.addListener((id) => {
      if (id !== REVIEW_NOTIFICATION) return;
      chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + '#review' });
      chrome.notifications.clear(id);
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return;
    (async () => {
      try {
        switch (msg.type) {
          case 'load': sendResponse(await handleLoad(msg.url)); break;
          case 'save': sendResponse(await handleSave(msg.url, msg.highlights, msg.title)); break;
          case 'list': sendResponse(await handleList()); break;
          case 'deletePage': sendResponse(await handleDeletePage(msg.url)); break;
          case 'findForeign': sendResponse({ ok: true, foreign: await store.getForeignHighlights(msg.url) }); break;
          case 'relocate': sendResponse(await store.relocateHighlights(msg.moves, msg.toUrl, msg.toTitle)); break;
          case 'syncNow': sendResponse(await store.syncNow()); break;
          case 'syncState': sendResponse(await handleSyncState()); break;
          case 'authSignIn': sendResponse(await signIn(msg.email, msg.password)); break;
          case 'authSignUp': sendResponse(await signUp(msg.email, msg.password)); break;
          case 'authSignOut': sendResponse(await signOut()); break;
          case 'aiPing': sendResponse(await pingAiService()); break;
          case 'aiQuiz': sendResponse(await handleAiQuiz(msg.items)); break;
          case 'aiReport': sendResponse(await handleAiReport(msg)); break;
          case 'aiChat': sendResponse(await handleAiChat(msg)); break;
          case 'aiChatHistory': sendResponse(await handleAiChatHistory(msg)); break;
          case 'listChats': sendResponse(await handleListChats()); break;
          default: sendResponse({ ok: false, error: 'unknown type' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // 异步响应
  });

  // 流式追问的长连接入口
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'whw-ai-chat') return;
    port.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'aiChatStream') return;
      handleAiChatStream(port, msg).catch((e) => {
        port.postMessage({ type: 'error', error: String(e) });
      });
    });
  });

  /* ----------------------- 右键菜单 ----------------------- */
  function buildMenus() {
    if (!chrome.contextMenus) return;
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'whw-highlight',
        title: '高亮所选内容',
        contexts: ['selection']
      });
      chrome.contextMenus.create({
        id: 'whw-highlight-last',
        parentId: 'whw-highlight',
        title: '用上次的颜色',
        contexts: ['selection']
      });
      chrome.contextMenus.create({
        id: 'whw-sep',
        parentId: 'whw-highlight',
        type: 'separator',
        contexts: ['selection']
      });
      for (const c of COLORS) {
        chrome.contextMenus.create({
          id: 'whw-color-' + c.id,
          parentId: 'whw-highlight',
          title: c.label,
          contexts: ['selection']
        });
      }
    });
  }

  chrome.runtime.onInstalled.addListener(buildMenus);
  chrome.runtime.onStartup.addListener(buildMenus);

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab || tab.id == null) return;
    let color: string | null = null;
    if (info.menuItemId === 'whw-highlight-last') {
      color = null; // content 用上次颜色
    } else if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith('whw-color-')) {
      color = info.menuItemId.slice('whw-color-'.length);
    } else {
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'highlightSelection', color }, () => {
      void chrome.runtime.lastError;
    });
  });

  /* ----------------------- 快捷键 ----------------------- */
  function forwardToActiveTab(message: Record<string, unknown>) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || tab.id == null) return;
      chrome.tabs.sendMessage(tab.id, message, () => {
        void chrome.runtime.lastError;
      });
    });
  }

  chrome.commands.onCommand.addListener((command) => {
    if (command === 'highlight-selection') {
      forwardToActiveTab({ type: 'highlightSelection', color: null });
    } else if (command === 'delete-highlight') {
      forwardToActiveTab({ type: 'deleteHighlight' });
    }
  });
});
