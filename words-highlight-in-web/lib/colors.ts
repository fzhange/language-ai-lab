// 高亮配色，全工程共用（content / popup / options / background 菜单）
export interface ColorDef {
  id: string;
  label: string;
}

export const COLORS: ColorDef[] = [
  { id: 'yellow', label: '黄' },
  { id: 'amber', label: '琥珀' },
  { id: 'orange', label: '橙' },
  { id: 'red', label: '红' },
  { id: 'pink', label: '粉' },
  { id: 'rose', label: '玫红' },
  { id: 'purple', label: '紫' },
  { id: 'violet', label: '靛紫' },
  { id: 'blue', label: '蓝' },
  { id: 'sky', label: '天蓝' },
  { id: 'cyan', label: '青' },
  { id: 'teal', label: '蓝绿' },
  { id: 'green', label: '绿' },
  { id: 'lime', label: '黄绿' },
  { id: 'gray', label: '灰' }
];

export const COLOR_CSS: Record<string, string> = {
  yellow: '#ffe08a', amber: '#ffd24d', orange: '#ffc17a', red: '#ff9e9e',
  pink: '#f7b0cd', rose: '#f58fb4', purple: '#d7b3f0', violet: '#c0a6f0',
  blue: '#a6d3f7', sky: '#8ec9ff', cyan: '#9fe4e8', teal: '#8fd6c4',
  green: '#bfe6a6', lime: '#d8ec8a', gray: '#d5d9de'
};

export const DEFAULT_COLOR = 'yellow';

// 把 #rrggbb 转成 rgba 字符串
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(47, 107, 255, ${alpha})`;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
