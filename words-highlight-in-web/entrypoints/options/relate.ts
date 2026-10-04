// 关联视图：把跨页面重复出现的高亮聚类（纯本地计算，不调 AI）。
import type { HighlightItem } from '../../lib/types';
import { normalizeExact } from '../../lib/review';
import { COLOR_CSS } from '../../lib/colors';
import type { OptionsCtx } from './ctx';

interface GroupEntry {
  h: HighlightItem;
  url: string;
  title: string;
}

interface Group {
  key: string;
  display: string;
  entries: GroupEntry[];
  pageCount: number;
}

export function renderRelate(root: HTMLElement, ctx: OptionsCtx): void {
  root.innerHTML = '';

  const groups = new Map<string, Group>();
  for (const p of ctx.getCache()) {
    for (const h of p.highlights) {
      const key = normalizeExact(h.exact);
      if (!key) continue;
      let g = groups.get(key);
      if (!g) {
        g = { key, display: h.exact.trim(), entries: [], pageCount: 0 };
        groups.set(key, g);
      }
      g.entries.push({ h, url: p.url, title: p.title });
    }
  }

  const list = [...groups.values()]
    .filter((g) => g.entries.length > 1)
    .map((g) => ({ ...g, pageCount: new Set(g.entries.map((e) => e.url)).size }))
    .sort((a, b) => b.entries.length - a.entries.length);

  const summary = document.createElement('div');
  summary.className = 'panel';
  const titleEl = document.createElement('div');
  titleEl.className = 'panel-title';
  titleEl.textContent = '知识关联';
  const desc = document.createElement('p');
  desc.className = 'panel-desc';
  desc.textContent = list.length
    ? `发现 ${list.length} 组重复出现的高亮——同一内容在多处划过，往往是你真正关心的点。`
    : '还没有重复出现的高亮。同一个词或句子在不同页面划过多次时，会自动聚类到这里。';
  summary.appendChild(titleEl);
  summary.appendChild(desc);
  root.appendChild(summary);

  for (const g of list) {
    const card = document.createElement('div');
    card.className = 'panel group';

    const head = document.createElement('div');
    head.className = 'group-head';
    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = g.display;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = `${g.entries.length} 条 · ${g.pageCount} 个页面`;
    head.appendChild(name);
    head.appendChild(badge);
    card.appendChild(head);

    const ul = document.createElement('ul');
    ul.className = 'group-items';
    for (const e of g.entries) {
      const li = document.createElement('li');
      li.className = 'group-item';

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = COLOR_CSS[e.h.color] || COLOR_CSS.yellow;
      li.appendChild(dot);

      const body = document.createElement('div');
      body.className = 'group-item-body';
      if (e.h.note && e.h.note.trim()) {
        const note = document.createElement('div');
        note.className = 'group-item-note';
        note.textContent = e.h.note;
        body.appendChild(note);
      }
      const src = document.createElement('a');
      src.className = 'hi-src';
      src.href = e.url;
      src.textContent = e.title || e.url;
      src.title = e.url;
      src.addEventListener('click', (ev) => {
        ev.preventDefault();
        ctx.openAt(e.url, e.h.id);
      });
      body.appendChild(src);
      li.appendChild(body);
      ul.appendChild(li);
    }
    card.appendChild(ul);
    root.appendChild(card);
  }
}
