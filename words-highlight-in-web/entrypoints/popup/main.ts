import './style.css';
import type { HighlightItem } from '../../lib/types';

const listEl = document.getElementById('list') as HTMLUListElement;
const emptyEl = document.getElementById('empty') as HTMLDivElement;
const countEl = document.getElementById('count') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

let currentTabId: number | null = null;

interface HighlightsResponse {
  ok: boolean;
  supported?: boolean;
  highlights?: HighlightItem[];
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

async function refresh() {
  const resp = await sendToTab<HighlightsResponse>({ type: 'getHighlights' });
  if (!resp) {
    countEl.textContent = '此页面不支持高亮';
    emptyEl.hidden = false;
    emptyEl.textContent = '当前页面无法注入脚本（如浏览器内置页面）。';
    return;
  }
  if (resp.supported === false) {
    statusEl.textContent = '浏览器不支持高亮 API';
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

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs && tabs[0] && tabs[0].id != null) {
    currentTabId = tabs[0].id;
    refresh();
  }
});
