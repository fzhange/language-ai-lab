// 周报视图：本地统计 + AI 生成周报 + Canvas 分享卡片。
import type { HighlightItem } from '../../lib/types';
import { normalizeExact } from '../../lib/review';
import { renderMarkdown } from '../../lib/markdown';
import type { OptionsCtx, PageCache } from './ctx';

interface WeekRange {
  from: number;
  to: number;
  label: string;
}

interface WeekStats {
  total: number;
  pages: number;
  words: number;
  sentences: number;
  topTerms: Array<{ term: string; count: number }>;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function weekRange(offsetWeeks: number): WeekRange {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 周一为一周起点
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() - day - offsetWeeks * 7);
  const end = new Date(monday);
  end.setDate(monday.getDate() + 7);
  const to = Math.min(end.getTime(), now.getTime());
  return { from: monday.getTime(), to, label: `${fmtDate(monday.getTime())} – ${fmtDate(to)}` };
}

function collectWeek(cache: PageCache[], range: WeekRange) {
  const items: Array<{ h: HighlightItem; page: PageCache }> = [];
  for (const p of cache) {
    for (const h of p.highlights) {
      const t = h.createdAt || 0;
      if (t >= range.from && t <= range.to) items.push({ h, page: p });
    }
  }
  return items;
}

function computeStats(items: Array<{ h: HighlightItem; page: PageCache }>): WeekStats {
  const pages = new Set(items.map((e) => e.page.url));
  let words = 0;
  let sentences = 0;
  const counter = new Map<string, { term: string; count: number }>();
  for (const { h } of items) {
    const isWord = h.exact.trim().split(/\s+/).length <= 3;
    if (isWord) words++; else sentences++;
    const key = normalizeExact(h.exact);
    if (!key) continue;
    const entry = counter.get(key) || { term: h.exact.trim(), count: 0 };
    entry.count++;
    counter.set(key, entry);
  }
  const topTerms = [...counter.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  return { total: items.length, pages: pages.size, words, sentences, topTerms };
}

// 从周报正文中提取「本周金句」一节的一行文本
function extractQuote(md: string): string {
  const m = md.match(/##\s*本周金句\s*\n+([^\n#]+)/);
  if (!m) return '';
  return m[1]!.trim().replace(/^[>\-*\s]+/, '').replace(/\*\*/g, '');
}

export function renderReport(root: HTMLElement, ctx: OptionsCtx): void {
  let offset = 0;
  let lastMarkdown = '';

  const draw = () => {
    const range = weekRange(offset);
    const items = collectWeek(ctx.getCache(), range);
    const stats = computeStats(items);

    root.innerHTML = '';

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.appendChild(title('每周阅读报告'));
    const desc = document.createElement('p');
    desc.className = 'panel-desc';
    desc.textContent = `${range.label} · 新增 ${stats.total} 条高亮`;
    panel.appendChild(desc);

    const statRow = document.createElement('div');
    statRow.className = 'stat-row';
    statRow.appendChild(statCell(String(stats.total), '高亮'));
    statRow.appendChild(statCell(String(stats.words), '单词/短语'));
    statRow.appendChild(statCell(String(stats.sentences), '句子'));
    statRow.appendChild(statCell(String(stats.pages), '页面'));
    panel.appendChild(statRow);

    if (stats.topTerms.length) {
      const top = document.createElement('p');
      top.className = 'panel-tip';
      top.textContent = '高频：' + stats.topTerms.map((t) => `${t.term} ×${t.count}`).join('、');
      panel.appendChild(top);
    }

    const btns = document.createElement('div');
    btns.className = 'btn-row';
    const prevBtn = button('上一周', 'btn');
    const nextBtn = button('下一周', 'btn');
    nextBtn.disabled = offset === 0;
    const genBtn = button('生成 AI 周报', 'btn primary');
    genBtn.disabled = !items.length;
    const cardBtn = button('生成分享卡片', 'btn');
    cardBtn.disabled = !items.length;
    prevBtn.addEventListener('click', () => { offset++; draw(); });
    nextBtn.addEventListener('click', () => { if (offset > 0) { offset--; draw(); } });
    genBtn.addEventListener('click', () => void generate(range, items, stats));
    cardBtn.addEventListener('click', () => shareCard(range, stats, items, lastMarkdown));
    btns.appendChild(prevBtn);
    btns.appendChild(nextBtn);
    btns.appendChild(genBtn);
    btns.appendChild(cardBtn);
    panel.appendChild(btns);
    root.appendChild(panel);

    const reportEl = document.createElement('div');
    reportEl.className = 'panel report-body';
    reportEl.id = 'reportBody';
    reportEl.hidden = true;
    root.appendChild(reportEl);
  };

  const generate = async (
    range: WeekRange,
    items: Array<{ h: HighlightItem; page: PageCache }>,
    stats: WeekStats
  ) => {
    const reportEl = root.querySelector<HTMLElement>('#reportBody');
    if (!reportEl) return;
    reportEl.hidden = false;
    reportEl.textContent = 'AI 正在撰写周报，请稍候…';

    const resp = await ctx.send<{ ok: boolean; report?: string; error?: string }>({
      type: 'aiReport',
      range: { from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() },
      stats,
      highlights: items.slice(0, 60).map(({ h, page }) => ({
        exact: h.exact,
        note: h.note || '',
        insight: h.insight || '',
        title: page.title || h.title || '',
        pageUrl: page.url,
        createdAt: h.createdAt
      }))
    });

    if (!resp || !resp.ok || !resp.report) {
      reportEl.textContent = '生成失败：' + ((resp && resp.error) || 'AI 服务不可用，请检查上方 AI 服务设置。');
      return;
    }
    lastMarkdown = resp.report;
    reportEl.innerHTML = renderMarkdown(resp.report);
  };

  draw();
}

function title(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'panel-title';
  d.textContent = text;
  return d;
}

function statCell(num: string, label: string): HTMLDivElement {
  const cell = document.createElement('div');
  cell.className = 'stat-cell';
  const n = document.createElement('div');
  n.className = 'stat-num';
  n.textContent = num;
  const l = document.createElement('div');
  l.className = 'stat-label';
  l.textContent = label;
  cell.appendChild(n);
  cell.appendChild(l);
  return cell;
}

function button(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  return b;
}

/* ----------------------- 分享卡片（Canvas 手绘，无第三方依赖） ----------------------- */
function wrapLines(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ch === '\n') { lines.push(line); line = ''; continue; }
    if (g.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function shareCard(
  range: WeekRange,
  stats: WeekStats,
  items: Array<{ h: HighlightItem; page: PageCache }>,
  markdown: string
) {
  const W = 800;
  const H = 1000;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) return;

  // 背景与顶部色带
  g.fillStyle = '#fafaf7';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1a1a1a';
  g.fillRect(0, 0, W, 120);

  g.fillStyle = '#ffffff';
  g.font = 'bold 34px -apple-system, "PingFang SC", sans-serif';
  g.fillText('Words Highlight 周报', 48, 62);
  g.font = '20px -apple-system, "PingFang SC", sans-serif';
  g.fillStyle = '#bbbbbb';
  g.fillText(range.label, 48, 96);

  // 统计四宫格
  const cells: Array<[string, string]> = [
    [String(stats.total), '高亮'],
    [String(stats.words), '单词/短语'],
    [String(stats.sentences), '句子'],
    [String(stats.pages), '页面']
  ];
  const cw = (W - 96 - 3 * 16) / 4;
  cells.forEach(([num, label], i) => {
    const x = 48 + i * (cw + 16);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#e5e5e0';
    g.beginPath();
    g.roundRect(x, 160, cw, 110, 12);
    g.fill();
    g.stroke();
    g.fillStyle = '#1a1a1a';
    g.font = 'bold 40px -apple-system, sans-serif';
    g.textAlign = 'center';
    g.fillText(num, x + cw / 2, 215);
    g.fillStyle = '#999999';
    g.font = '16px -apple-system, "PingFang SC", sans-serif';
    g.fillText(label, x + cw / 2, 246);
    g.textAlign = 'left';
  });

  // 金句（优先 AI 周报提取，否则取本周第一条高亮）
  let quote = extractQuote(markdown);
  if (!quote && items.length) quote = items[0]!.h.exact;
  let y = 330;
  if (quote) {
    g.fillStyle = '#1a1a1a';
    g.font = 'bold 26px -apple-system, "PingFang SC", sans-serif';
    g.fillText('本周金句', 48, y);
    y += 20;
    g.fillStyle = '#f5a97f';
    g.fillRect(48, y, 6, 30 + 34 * Math.min(wrapLines(g, quote, W - 150).length, 4));
    g.fillStyle = '#333333';
    g.font = '24px -apple-system, "PingFang SC", sans-serif';
    for (const line of wrapLines(g, quote, W - 150).slice(0, 4)) {
      y += 36;
      g.fillText(line, 76, y);
    }
    y += 30;
  }

  // 高频词
  if (stats.topTerms.length) {
    y += 40;
    g.fillStyle = '#1a1a1a';
    g.font = 'bold 26px -apple-system, "PingFang SC", sans-serif';
    g.fillText('高频关注', 48, y);
    y += 42;
    g.font = '22px -apple-system, "PingFang SC", sans-serif';
    g.fillStyle = '#555555';
    g.fillText(stats.topTerms.map((t) => `${t.term} ×${t.count}`).join('    '), 48, y);
  }

  // 页脚
  g.fillStyle = '#aaaaaa';
  g.font = '18px -apple-system, "PingFang SC", sans-serif';
  g.fillText('由 Words Highlight in Web 生成', 48, H - 40);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `words-highlight-weekly-${new Date(range.from).toISOString().slice(0, 10)}.png`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/png');
}
