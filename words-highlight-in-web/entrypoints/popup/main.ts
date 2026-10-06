import './style.css';
import type { HighlightItem } from '../../lib/types';
import { disableSite } from '../../lib/site-blocklist';

const listEl = document.getElementById('list') as HTMLUListElement;
const emptyEl = document.getElementById('empty') as HTMLDivElement;
const countEl = document.getElementById('count') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const disableSiteBtn = document.getElementById('disableSite') as HTMLButtonElement;

let currentTabId: number | null = null;
let currentHostname: string | null = null;
let currentTabUrl: string | null = null;

function hostnameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.hostname : null;
  } catch {
    return null;
  }
}

interface HighlightsResponse {
  ok: boolean;
  url?: string;
  supported?: boolean;
  disabled?: boolean;
  highlights?: HighlightItem[];
}

function activeTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(tabs?.[0] || null);
    });
  });
}

function sendToTab<T = unknown>(message: Record<string, unknown>): Promise<T | null> {
  return new Promise((resolve) => {
    if (currentTabId == null) return resolve(null);
    chrome.tabs.sendMessage(currentTabId, message, (resp: T) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(resp);
    });
  });
}

function render(highlights?: HighlightItem[]) {
  listEl.innerHTML = '';
  const items = highlights || [];
  countEl.textContent = `本页 ${items.length} 条高亮`;
  emptyEl.hidden = items.length > 0;

  for (const h of items) {
    const li = document.createElement('li');
    li.className = 'item';

    const dot = document.createElement('span');
    dot.className = 'dot ' + h.color;

    const body = document.createElement('div');
    body.className = 'body';

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = h.exact;
    body.appendChild(text);

    if (h.note && h.note.trim()) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = h.note;
      body.appendChild(note);
    }

    if (h.insight && h.insight.trim()) {
      const insight = document.createElement('div');
      insight.className = 'insight';
      insight.textContent = h.insight;
      body.appendChild(insight);
    }

    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '×';
    del.title = '删除';

    li.addEventListener('click', async () => {
      await sendToTab({ type: 'scrollTo', id: h.id });
      window.close();
    });
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      await sendToTab({ type: 'removeHighlight', id: h.id });
      li.remove();
      refresh();
    });

    li.appendChild(dot);
    li.appendChild(body);
    li.appendChild(del);
    listEl.appendChild(li);
  }
}

function showDisabled() {
  listEl.replaceChildren();
  countEl.textContent = '该网站已禁用高亮';
  statusEl.textContent = '已禁用';
  emptyEl.hidden = false;
  emptyEl.textContent = '可在管理页的禁用网站列表中移除该域名以恢复插件。';
  disableSiteBtn.hidden = true;
  (document.getElementById('clear') as HTMLButtonElement).disabled = true;
  currentHostname = null;
}

async function refresh() {
  disableSiteBtn.hidden = true;
  currentHostname = null;
  const resp = await sendToTab<HighlightsResponse>({ type: 'getHighlights' });
  const clearBtn = document.getElementById('clear') as HTMLButtonElement;
  clearBtn.disabled = !resp || !resp.ok || !!resp.disabled;
  if (!resp) {
    countEl.textContent = '此页面不支持高亮';
    emptyEl.hidden = false;
    emptyEl.textContent = '当前页面无法注入脚本（如浏览器内置页面）。';
    return;
  }
  if (!resp.ok) {
    countEl.textContent = '无法读取当前页面状态';
    emptyEl.hidden = false;
    emptyEl.textContent = '请刷新页面后重试。';
    return;
  }
  if (resp.disabled) {
    showDisabled();
    return;
  }
  if (resp.supported === false) {
    statusEl.textContent = '浏览器不支持高亮 API';
  } else {
    const hostname = hostnameOf(currentTabUrl);
    if (hostname && (!resp.url || hostnameOf(resp.url) === hostname)) {
      currentHostname = hostname;
      disableSiteBtn.hidden = false;
      disableSiteBtn.title = `在 ${hostname} 的所有页面禁用插件`;
    }
  }
  render(resp.highlights);
}

document.getElementById('clear')!.addEventListener('click', async () => {
  await sendToTab({ type: 'clearPage' });
  render([]);
});

document.getElementById('options')!.addEventListener('click', () => {
  // 用整页标签打开管理页（openOptionsPage 默认是内嵌小弹窗）
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
});

disableSiteBtn.addEventListener('click', async () => {
  const hostname = currentHostname;
  const tabId = currentTabId;
  if (!hostname || tabId == null || disableSiteBtn.disabled) return;
  if (!window.confirm(`确定在 ${hostname} 的所有页面禁用插件吗？已有高亮和笔记会保留，可在管理页恢复。`)) return;
  disableSiteBtn.disabled = true;
  try {
    const tab = await activeTab();
    if (!tab || tab.id !== tabId || hostnameOf(tab.url || null) !== hostname) {
      statusEl.textContent = '页面已变化，请重新打开弹窗';
      disableSiteBtn.hidden = true;
      currentHostname = null;
      return;
    }
    await disableSite(hostname);
    showDisabled();
  } catch {
    statusEl.textContent = '禁用失败，请重试';
  } finally {
    disableSiteBtn.disabled = false;
  }
});

void activeTab().then((tab) => {
  if (tab?.id != null) {
    currentTabId = tab.id;
    currentTabUrl = tab.url || null;
    void refresh();
  }
});
