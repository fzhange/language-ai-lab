// 复习调度：轻量间隔重复 + 跨页聚类所需的归一化。
// 统计只存本地 chrome.storage（不同步），key = whw:v2:reviewStats。

import type { HighlightItem } from './types';

export interface ReviewStat {
  streak: number;      // 连续答对次数
  wrong: number;       // 累计答错次数
  lastAt: number;      // 上次复习时间（ms）
}

export type ReviewStats = Record<string, ReviewStat>;

const KEY = 'whw:v2:reviewStats';
const DAY = 24 * 60 * 60 * 1000;

export async function getReviewStats(): Promise<ReviewStats> {
  const res = await chrome.storage.local.get(KEY);
  return (res[KEY] as ReviewStats) || {};
}

export async function recordResult(id: string, correct: boolean): Promise<void> {
  const stats = await getReviewStats();
  const s = stats[id] || { streak: 0, wrong: 0, lastAt: 0 };
  if (correct) {
    s.streak += 1;
  } else {
    s.streak = 0;
    s.wrong += 1;
  }
  s.lastAt = Date.now();
  stats[id] = s;
  await chrome.storage.local.set({ [KEY]: stats });
}

// 间隔天数：从未复习过的立即到期；之后按 2^streak 增长，封顶 30 天
function intervalDays(stat: ReviewStat | undefined): number {
  if (!stat || !stat.lastAt) return 0;
  return Math.min(Math.pow(2, stat.streak), 30);
}

export function isDue(item: HighlightItem, stat: ReviewStat | undefined, now = Date.now()): boolean {
  const last = stat && stat.lastAt ? stat.lastAt : item.createdAt || 0;
  return now - last >= intervalDays(stat) * DAY;
}

// 到期高亮：从未复习的优先（按创建时间从旧到新），已复习的按逾期程度排序
export function dueItems(items: HighlightItem[], stats: ReviewStats): HighlightItem[] {
  return items
    .filter((h) => isDue(h, stats[h.id]))
    .sort((a, b) => {
      const la = stats[a.id]?.lastAt || a.createdAt || 0;
      const lb = stats[b.id]?.lastAt || b.createdAt || 0;
      return la - lb;
    });
}

// P3：归一化原文用于跨页聚类（大小写/引号/多余空白不敏感）
export function normalizeExact(exact: string): string {
  return exact
    .trim()
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, '')
    .replace(/\s+/g, ' ');
}
