// options 页各视图共享的上下文类型。
import type { HighlightItem } from '../../lib/types';

export interface PageCache {
  url: string;
  title: string;
  updatedAt: number;
  count: number;
  highlights: HighlightItem[];
}

export interface OptionsCtx {
  getCache(): PageCache[];
  send<T = any>(message: Record<string, unknown>): Promise<T | null>;
  toast(text: string): void;
  openAt(url: string, id?: string): void;
}
