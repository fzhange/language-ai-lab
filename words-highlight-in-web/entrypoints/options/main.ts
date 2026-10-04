import './style.css';
import { COLOR_CSS } from '../../lib/colors';
import type { HighlightItem } from '../../lib/types';
import { getAiConfig, setAiConfig } from '../../lib/ai';
import { renderReview } from './review';
import { renderReport } from './report';
import { renderChats } from './chats';
import { renderRelate } from './relate';
import type { OptionsCtx, PageCache } from './ctx';

const pagesEl = document.getElementById('pages') as HTMLUListElement;
const itemsEl = document.getElementById('items') as HTMLUListElement;
const emptyEl = document.getElementById('empty') as HTMLDivElement;
const pageCountEl = document.getElementById('pageCount') as HTMLSpanElement;
const searchEl = document.getElementById('search') as HTMLInputElement;
const toastEl = document.getElementById('toast') as HTMLDivElement;
const reviewEl = document.getElementById('reviewView') as HTMLDivElement;
const reportEl = document.getElementById('reportView') as HTMLDivElement;
const chatsEl = document.getElementById('chatsView') as HTMLDivElement;
const relateEl = document.getElementById('relateView') as HTMLDivElement;
const searchbarEl = document.querySelector('.searchbar') as HTMLDivElement;

type View = 'all' | 'pages' | 'review' | 'report' | 'chats' | 'relate';

interface ListPage {
  url: string;
  title?: string;
  count?: number;
  updatedAt?: number;
}

let view: View = 'all';
let cache: PageCache[] = [];
let keyword = '';
let toastTimer: ReturnType<typeof setTimeout> | undefined;

function send<T = any>(message: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (resp: T) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(resp);
    });
  });
}

function toast(text: string) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2400);
}

/* ----------------------- 账号与云同步 ----------------------- */
interface SyncState {
  ok: boolean;
  signedIn?: boolean;
  email?: string | null;
  userId?: string | null;
  lastPull?: string | null;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch (e) {
    return '—';
  }
}

async function refreshAccount() {
  const resp = await send<SyncState>({ type: 'syncState' });
  const loginEl = document.getElementById('accLogin')!;
  const userEl = document.getElementById('accUser')!;
  if (resp && resp.ok && resp.signedIn) {
    loginEl.hidden = true;
    userEl.hidden = false;
    document.getElementById('accEmail2')!.textContent = resp.email || '—';
    document.getElementById('accLast')!.textContent = '上次同步：' + fmtTime(resp.lastPull);
  } else {
    loginEl.hidden = false;
    userEl.hidden = true;
  }
}

function showAccMsg(text: string, isError = true) {
  const msg = document.getElementById('accMsg')!;
  msg.textContent = text;
  msg.hidden = false;
  msg.style.color = isError ? '#c0392b' : '#2e7d32';
}

async function doAuth(kind: 'signIn' | 'signUp') {
  const email = (document.getElementById('accEmail') as HTMLInputElement).value.trim();
  const password = (document.getElementById('accPassword') as HTMLInputElement).value;
  if (!email || !password) { showAccMsg('请输入邮箱和密码'); return; }
  if (password.length < 6) { showAccMsg('密码至少 6 位'); return; }
  const resp = await send<{ ok: boolean; error?: string; needsConfirm?: boolean }>({
    type: kind === 'signIn' ? 'authSignIn' : 'authSignUp', email, password
  });
  if (!resp) { showAccMsg('请求失败'); return; }
  if (!resp.ok) { showAccMsg(resp.error || '失败'); return; }
  if (kind === 'signUp' && resp.needsConfirm) {
    showAccMsg('注册成功，请先到邮箱完成验证再登录', false);
    return;
  }
  showAccMsg(kind === 'signIn' ? '登录成功' : '注册成功', false);
  // 登录/注册成功后立即同步一次
  await send({ type: 'syncNow' });
  await refreshAccount();
  await loadData();
}

async function doSignOut() {
  await send({ type: 'authSignOut' });
  await refreshAccount();
  toast('已退出登录（数据仍保留在本机）');
}

async function doSyncNow() {
  const btn = document.getElementById('accSyncNow') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = '同步中…';
  const resp = await send<{ ok: boolean; pulled?: number; pushed?: number; error?: string }>({ type: 'syncNow' });
  btn.disabled = false;
  btn.textContent = '立即同步';
  if (resp && resp.ok) {
    const parts: string[] = [];
    if (resp.pushed) parts.push(`上行 ${resp.pushed}`);
    if (resp.pulled) parts.push(`下行 ${resp.pulled}`);
    toast(parts.length ? `同步完成：${parts.join('，')} 条` : '同步完成，已是最新');
    await refreshAccount();
    await loadData();
  } else {
    toast('同步失败：' + ((resp && resp.error) || '未知错误'));
  }
}

// 拉取所有页面及其高亮，构建统一缓存
async function loadData() {
  const resp = await send<{ ok: boolean; pages?: ListPage[] }>({ type: 'list' });
  const pages = (resp && resp.pages) || [];
  const result: PageCache[] = [];
  for (const p of pages) {
    const data = await send<{ ok: boolean; highlights?: HighlightItem[] }>({ type: 'load', url: p.url });
    const highlights = (data && data.highlights) || [];
    result.push({
      url: p.url,
      title: p.title || (highlights[0] && highlights[0].title) || '',
      updatedAt: p.updatedAt || 0,
      count: highlights.length,
      highlights
    });
  }
  result.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  cache = result;
  render();
}

function matches(h: HighlightItem): boolean {
  if (!keyword) return true;
  const k = keyword.toLowerCase();
  return (!!h.exact && h.exact.toLowerCase().includes(k)) ||
         (!!h.note && h.note.toLowerCase().includes(k)) ||
         (!!h.insight && h.insight.toLowerCase().includes(k));
}

function openAt(url: string, id?: string) {
  const target = id ? url + '#whw=' + encodeURIComponent(id) : url;
  chrome.tabs.create({ url: target });
}

// 新视图共享的上下文
const ctx: OptionsCtx = {
  getCache: () => cache,
  send,
  toast,
  openAt
};

function makeHighlightRow(h: HighlightItem, page: PageCache | null): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'hi';

  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = COLOR_CSS[h.color] || COLOR_CSS.yellow;

  const body = document.createElement('div');
  body.className = 'hi-body';

  const text = document.createElement('div');
  text.className = 'hi-text';
  text.textContent = h.exact;
  body.appendChild(text);

  if (h.note && h.note.trim()) {
    const note = document.createElement('div');
    note.className = 'hi-note';
    note.textContent = h.note;
    body.appendChild(note);
  }

  if (h.insight && h.insight.trim()) {
    const insight = document.createElement('div');
    insight.className = 'hi-insight';
    insight.textContent = h.insight;
    body.appendChild(insight);
  }

  if (page) {
    const src = document.createElement('a');
    src.className = 'hi-src';
    src.href = page.url;
    src.textContent = page.title || page.url;
    src.title = page.url;
    src.addEventListener('click', (e) => {
      e.preventDefault();
      openAt(page.url, h.id);
    });
    body.appendChild(src);
  }

  li.appendChild(dot);
  li.appendChild(body);
  return li;
}

function renderAllView() {
  itemsEl.innerHTML = '';
  let total = 0;
  for (const page of cache) {
    for (const h of page.highlights) {
      if (!matches(h)) continue;
      itemsEl.appendChild(makeHighlightRow(h, page));
      total++;
    }
  }
  pageCountEl.textContent = total ? `${total} 条高亮` : '';
  emptyEl.hidden = total > 0;
  emptyEl.textContent = keyword ? '没有匹配的高亮。' : '还没有任何高亮记录。';
}

function renderPagesView() {
  pagesEl.innerHTML = '';
  let shown = 0;
  for (const page of cache) {
    const hits = page.highlights.filter(matches);
    if (!hits.length) continue;
    shown++;

    const li = document.createElement('li');
    li.className = 'page';

    const head = document.createElement('div');
    head.className = 'page-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'page-title';
    const a = document.createElement('a');
    a.href = page.url;
    a.target = '_blank';
    a.rel = 'noreferrer';
    a.textContent = page.title || page.url;
    const urlLine = document.createElement('div');
    urlLine.className = 'page-url';
    urlLine.textContent = page.url;
    titleWrap.appendChild(a);
    titleWrap.appendChild(urlLine);

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = `${hits.length} 条`;

    const del = document.createElement('button');
    del.className = 'btn danger';
    del.textContent = '删除';
    del.addEventListener('click', async () => {
      await send({ type: 'deletePage', url: page.url });
      cache = cache.filter((p) => p.url !== page.url);
      render();
    });

    head.appendChild(titleWrap);
    head.appendChild(badge);
    head.appendChild(del);
    li.appendChild(head);

    const ul = document.createElement('ul');
    ul.className = 'page-hits';
    for (const h of hits) ul.appendChild(makeHighlightRow(h, null));
    li.appendChild(ul);

    pagesEl.appendChild(li);
  }
  pageCountEl.textContent = shown ? `${shown} 个页面` : '';
  emptyEl.hidden = shown > 0;
  emptyEl.textContent = keyword ? '没有匹配的高亮。' : '还没有任何高亮记录。';
}

function render() {
  const isAll = view === 'all';
  const isPages = view === 'pages';
  const isDataView = isAll || isPages;
  itemsEl.hidden = !isAll;
  pagesEl.hidden = !isPages;
  reviewEl.hidden = view !== 'review';
  reportEl.hidden = view !== 'report';
  chatsEl.hidden = view !== 'chats';
  relateEl.hidden = view !== 'relate';
  emptyEl.hidden = true;
  searchbarEl.hidden = !isDataView;
  if (isAll) renderAllView();
  else if (isPages) renderPagesView();
  else if (view === 'review') void renderReview(reviewEl, ctx);
  else if (view === 'report') renderReport(reportEl, ctx);
  else if (view === 'chats') void renderChats(chatsEl, ctx);
  else renderRelate(relateEl, ctx);
}

/* ----------------------- 视图切换 ----------------------- */
function switchView(next: View) {
  document.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === next);
  });
  view = next;
  render();
}

document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchView(tab.dataset.view as View));
});

/* ----------------------- 搜索 ----------------------- */
searchEl.addEventListener('input', () => {
  keyword = searchEl.value.trim();
  render();
});

/* ----------------------- 导出 ----------------------- */
document.getElementById('export')!.addEventListener('click', () => {
  const out = cache.map((p) => ({
    url: p.url, title: p.title || '', highlights: p.highlights
  }));
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = `words-highlight-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

/* ----------------------- 导入 ----------------------- */
const importFile = document.getElementById('importFile') as HTMLInputElement;
document.getElementById('import')!.addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const file = importFile.files && importFile.files[0];
  importFile.value = '';
  if (!file) return;
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch (e) {
    toast('导入失败：不是有效的 JSON');
    return;
  }
  if (!Array.isArray(data)) {
    toast('导入失败：格式应为页面数组');
    return;
  }

  // 以 url 建立现有数据索引，按 id 合并去重
  const byUrl = new Map(cache.map((p) => [p.url, p]));
  let pageCount = 0;
  let addCount = 0;

  for (const entry of data as Array<{ url?: unknown; title?: unknown; highlights?: unknown }>) {
    if (!entry || typeof entry.url !== 'string' || !Array.isArray(entry.highlights)) continue;
    const existing = byUrl.get(entry.url);
    const merged: HighlightItem[] = existing ? existing.highlights.slice() : [];
    const ids = new Set(merged.map((h) => h.id));
    for (const h of entry.highlights as HighlightItem[]) {
      if (!h || typeof h.exact !== 'string') continue;
      if (h.id && ids.has(h.id)) continue;
      merged.push(h);
      if (h.id) ids.add(h.id);
      addCount++;
    }
    await send({
      type: 'save',
      url: entry.url,
      highlights: merged,
      title: typeof entry.title === 'string' ? entry.title : ''
    });
    pageCount++;
  }

  toast(`导入完成：${pageCount} 个页面，新增 ${addCount} 条高亮`);
  await loadData();
});

/* ----------------------- 账号按钮事件 ----------------------- */
document.getElementById('accSignIn')!.addEventListener('click', () => doAuth('signIn'));
document.getElementById('accSignUp')!.addEventListener('click', () => doAuth('signUp'));
document.getElementById('accSignOut')!.addEventListener('click', doSignOut);
document.getElementById('accSyncNow')!.addEventListener('click', doSyncNow);
// 密码框回车 = 登录
document.getElementById('accPassword')!.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doAuth('signIn');
});

/* ----------------------- AI 服务设置 ----------------------- */
const aiBaseEl = document.getElementById('aiBase') as HTMLInputElement;
const aiTokenEl = document.getElementById('aiToken') as HTMLInputElement;
const aiMsgEl = document.getElementById('aiMsg')!;

function showAiMsg(text: string, isError = true) {
  aiMsgEl.textContent = text;
  aiMsgEl.hidden = false;
  aiMsgEl.style.color = isError ? '#c0392b' : '#2e7d32';
}

getAiConfig().then((cfg) => {
  aiBaseEl.value = cfg.baseUrl;
  aiTokenEl.value = cfg.token;
});

document.getElementById('aiSave')!.addEventListener('click', async () => {
  const cfg = await setAiConfig({ baseUrl: aiBaseEl.value, token: aiTokenEl.value });
  aiBaseEl.value = cfg.baseUrl;
  showAiMsg('已保存', false);
});

document.getElementById('aiTest')!.addEventListener('click', async () => {
  await setAiConfig({ baseUrl: aiBaseEl.value, token: aiTokenEl.value });
  showAiMsg('测试中…', false);
  const resp = await send<{ ok: boolean; error?: string }>({ type: 'aiPing' });
  if (resp && resp.ok) showAiMsg('连接成功', false);
  else showAiMsg('连接失败：' + ((resp && resp.error) || '无法访问服务'));
});

// 通知点击跳转：#review 直接进入复习 tab
if (location.hash === '#review') switchView('review');

refreshAccount();
loadData();
