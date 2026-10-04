// 较新 / 非标准 Web API 的类型补充（CSS Custom Highlight API、caretRangeFromPoint）

interface HighlightRegistry {
  readonly size: number;
  set(name: string, highlight: Highlight): HighlightRegistry;
  get(name: string): Highlight | undefined;
  has(name: string): boolean;
  delete(name: string): boolean;
  clear(): void;
  forEach(cb: (highlight: Highlight, name: string) => void): void;
}

declare class Highlight {
  constructor(...ranges: Range[]);
  priority: number;
  type: string;
  add(range: Range): void;
  delete(range: Range): void;
  clear(): void;
  readonly size: number;
}

interface CSS {
  highlights: HighlightRegistry;
}

interface Document {
  caretRangeFromPoint?(x: number, y: number): Range | null;
}
