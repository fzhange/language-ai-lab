// 高亮数据模型
export interface HighlightItem {
  id: string;
  color: string;
  exact: string;
  prefix: string;
  suffix: string;
  note: string;      // 笔记：针对原文的翻译、注释
  insight: string;   // 心得：对内容的概念理解、感悟
  title: string;
  createdAt: number;
  updatedAt?: number;
}

// 文本锚点（用于跨刷新定位）
export interface TextQuote {
  exact: string;
  prefix: string;
  suffix: string;
}

// background / content 之间消息
export type BgMessage =
  | { type: 'load'; url: string }
  | { type: 'save'; url: string; highlights: HighlightItem[]; title?: string }
  | { type: 'list' }
  | { type: 'deletePage'; url: string };

export type ContentMessage =
  | { type: 'getHighlights' }
  | { type: 'removeHighlight'; id: string }
  | { type: 'clearPage' }
  | { type: 'scrollTo'; id: string }
  | { type: 'refresh' }
  | { type: 'highlightSelection'; color: string | null }
  | { type: 'deleteHighlight' };
