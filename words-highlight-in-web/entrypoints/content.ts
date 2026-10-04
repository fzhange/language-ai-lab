import { defineContentScript } from 'wxt/sandbox';
import '../lib/content.css';
import { COLORS, COLOR_CSS, DEFAULT_COLOR, hexToRgba } from '../lib/colors';
import { quoteFromRange, rangeFromQuote, quoteMatchesStrict } from '../lib/anchor';
import { renderMarkdown } from '../lib/markdown';
import type { AgentActivity } from '../lib/ai';
import type { HighlightItem } from '../lib/types';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  cssInjectionMode: 'manifest',
  main() {
    if ((window as any).__WHW_CONTENT_LOADED__) return;
    (window as any).__WHW_CONTENT_LOADED__ = true;

    const supported =
      typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';
    // SPA（前端路由跳转不刷新页面）下 URL 会随时变化，必须动态取值，
    // 否则会把新页面的高亮错误归档到注入时的旧 URL 下。
    function currentUrl(): string {
      return location.href.split('#')[0];
    }

    interface RangeInfo {
      range: Range;
      color: string;
      note: string;
      insight: string;
    }

    let highlights: HighlightItem[] = [];
    const rangeMap = new Map<string, RangeInfo>();
    let toolbar: HTMLDivElement | null = null;
    let toolbarMode: 'create' | 'edit' = 'create';
    let pendingRange: Range | null = null;
    let editingId: string | null = null;
    let lastColor = DEFAULT_COLOR;
    let lastMouseX = 0;
    let lastMouseY = 0;

    const LAST_COLOR_KEY = 'whw:lastColor';

    // 扩展被重载/更新后，旧 content script 的 chrome 上下文会失效，
    // 再调 chrome API 会抛 "Extension context invalidated"。统一防护。
    let contextInvalid = false;

    function isContextValid(): boolean {
      try {
        return !!chrome.runtime && !!chrome.runtime.id;
      } catch (e) {
        return false;
      }
    }

    // 上下文失效时给出一次性提示，并停止后续 chrome 调用
    function onContextInvalidated() {
      if (contextInvalid) return;
      contextInvalid = true;
      hideToolbar();
      showReloadBanner();
    }

    function showReloadBanner() {
      if (!document.body || document.querySelector('.whw-reload-banner')) return;
      const el = document.createElement('div');
      el.className = 'whw-reload-banner whw-ui';
      el.textContent = '高亮插件已更新，请刷新本页面后继续使用';
      document.documentElement.appendChild(el); // 挂在 body 外，避免被挤压布局的 transform 影响定位
    }

    // 包装 chrome.runtime.sendMessage，失效时静默降级
    function sendRuntimeMessage(message: Record<string, unknown>, cb?: (resp: any) => void) {
      if (!isContextValid()) { onContextInvalidated(); return; }
      try {
        chrome.runtime.sendMessage(message, (resp: any) => {
          if (chrome.runtime.lastError) { cb && cb(null); return; }
          if (cb) cb(resp);
        });
      } catch (e) {
        onContextInvalidated();
      }
    }

    try {
      if (isContextValid()) {
        chrome.storage.local.get(LAST_COLOR_KEY, (r) => {
          const v = r && r[LAST_COLOR_KEY];
          if (v && COLOR_CSS[v]) lastColor = v;
        });
      }
    } catch (e) { onContextInvalidated(); }

    function rememberColor(color: string) {
      lastColor = color;
      try {
        if (isContextValid()) chrome.storage.local.set({ [LAST_COLOR_KEY]: color });
      } catch (e) { onContextInvalidated(); }
    }

    // 对当前选区高亮（供右键菜单 / 快捷键调用）
    function highlightCurrentSelection(color: string | null): boolean {
      const c = color && COLOR_CSS[color] ? color : lastColor;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
      if (!sel.toString().trim()) return false;
      const range = sel.getRangeAt(0);
      const id = addHighlight(range, c);
      if (id) {
        rememberColor(c);
        sel.removeAllRanges();
        return true;
      }
      return false;
    }

    /* ----------------------- 渲染 ----------------------- */
    function clearBadges() {
      document.querySelectorAll('.whw-badge').forEach((n) => n.remove());
    }

    // 角标不插入文本流：行尾高亮会把行内角标挤到下一行。
    // 改为绝对定位浮层，贴在高亮最后一行的末尾，随滚动/缩放重定位。
    function positionBadge(badge: HTMLElement, range: Range) {
      try {
        const rects = range.getClientRects();
        // 末尾可能有零宽矩形（落到下一行/下一元素起点），需取最后一个有实际宽高的
        let last: DOMRect | null = null;
        for (let i = rects.length - 1; i >= 0; i--) {
          const r = rects[i];
          if (r.width > 0 && r.height > 0) { last = r; break; }
        }
        if (!last) { badge.style.display = 'none'; return; }
        badge.style.display = '';
        badge.style.left = (last.right + window.scrollX + 2) + 'px';
        badge.style.top = (last.top + window.scrollY - 2) + 'px';
      } catch (e) { /* ignore */ }
    }

    function repositionBadges() {
      document.querySelectorAll<HTMLElement>('.whw-badge').forEach((b) => {
        const id = b.dataset.whwBadge;
        const info = id ? rangeMap.get(id) : null;
        if (info) positionBadge(b, info.range);
      });
    }

    // 在高亮结尾放一个不影响文本内容的角标
    function insertBadge(range: Range, note: boolean, insight: boolean, id: string) {
      const badge = document.createElement('span');
      badge.className = 'whw-badge whw-ui';
      badge.dataset.whwBadge = id;
      badge.setAttribute('contenteditable', 'false');
      if (note) {
        const s = document.createElement('span');
        s.className = 'whw-badge-note';
        s.textContent = '📝';
        badge.appendChild(s);
      }
      if (insight) {
        const s = document.createElement('span');
        s.className = 'whw-badge-insight';
        s.textContent = '💡';
        badge.appendChild(s);
      }
      // 点击角标 = 打开该高亮的编辑面板
      badge.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideTooltipNow();
        editingId = id;
        pendingRange = null;
        showToolbar('edit', rangeMap.get(id)?.color || DEFAULT_COLOR);
        openNotePanel(id);
      });
      // 挂在 <html> 下：body 可能有 transform，且避免污染页面文本索引
      document.documentElement.appendChild(badge);
      positionBadge(badge, range);
    }

    function renderAll() {
      if (!supported) return;
      rangeMap.clear();
      clearBadges();
      const byColor: Record<string, Range[]> = {};
      COLORS.forEach((c) => (byColor[c.id] = []));

      for (const h of highlights) {
        const range = rangeFromQuote(h);
        if (!range) continue;
        const color = COLOR_CSS[h.color] ? h.color : DEFAULT_COLOR;
        (byColor[color] || byColor[DEFAULT_COLOR]).push(range);
        const hasNote = !!(h.note && h.note.trim());
        const hasInsight = !!(h.insight && h.insight.trim());
        rangeMap.set(h.id, { range, color, note: h.note || '', insight: h.insight || '' });
        if (hasNote || hasInsight) insertBadge(range, hasNote, hasInsight, h.id);
      }

      for (const c of COLORS) {
        const name = 'whw-' + c.id;
        const ranges = byColor[c.id];
        if (ranges && ranges.length) {
          CSS.highlights.set(name, new Highlight(...ranges));
        } else {
          CSS.highlights.delete(name);
        }
      }
    }

    /* ----------------------- 数据 ----------------------- */
    function load() {
      const reqUrl = currentUrl();
      sendRuntimeMessage({ type: 'load', url: reqUrl }, (resp) => {
        // 响应回来时页面可能已再次跳转，丢弃过期数据
        if (currentUrl() !== reqUrl) return;
        if (resp && resp.ok && Array.isArray(resp.highlights)) {
          highlights = resp.highlights;
        }
        renderAll();
        maybeScrollToHash();
      });
    }

    // 从全局视图跳转过来时（url#whw=<id>）自动滚动
    function maybeScrollToHash() {
      const m = /[#&]whw=([^&]+)/.exec(location.hash || '');
      if (!m) return;
      const id = decodeURIComponent(m[1]);
      setTimeout(() => {
        const info = rangeMap.get(id);
        if (!info) return;
        try {
          const rect = info.range.getBoundingClientRect();
          window.scrollTo({
            top: rect.top + window.scrollY - window.innerHeight / 3,
            behavior: 'smooth'
          });
        } catch (e) { /* ignore */ }
      }, 300);
    }

    function persist() {
      sendRuntimeMessage({ type: 'save', url: currentUrl(), highlights });
    }

    function addHighlight(range: Range, color: string): string | null {
      const quote = quoteFromRange(range);
      if (!quote) return null;
      const item: HighlightItem = {
        id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now() + Math.random()),
        color,
        exact: quote.exact,
        prefix: quote.prefix,
        suffix: quote.suffix,
        note: '',
        insight: '',
        title: document.title,
        createdAt: Date.now()
      };
      highlights.push(item);
      persist();
      renderAll();
      return item.id;
    }

    function updateColor(id: string, color: string) {
      const h = highlights.find((x) => x.id === id);
      if (!h) return;
      h.color = color;
      persist();
      renderAll();
    }

    function updateNote(id: string, note: string, insight: string) {
      const h = highlights.find((x) => x.id === id);
      if (!h) return;
      h.note = note;
      h.insight = insight;
      h.updatedAt = Date.now();
      persist();
      renderAll();
    }

    function getHighlight(id: string): HighlightItem | null {
      return highlights.find((x) => x.id === id) || null;
    }

    function removeHighlight(id: string) {
      const before = highlights.length;
      highlights = highlights.filter((x) => x.id !== id);
      if (highlights.length !== before) {
        persist();
        renderAll();
      }
    }

    function clearPage() {
      highlights = [];
      persist();
      renderAll();
    }

    // 快捷键删除：优先删除正在编辑的高亮，否则删除鼠标悬停的高亮
    function deleteHighlightByShortcut(): boolean {
      if (toolbarMode === 'edit' && editingId && getHighlight(editingId)) {
        removeHighlight(editingId);
        hideToolbar();
        return true;
      }
      const hit = findHighlightAtPoint(lastMouseX, lastMouseY);
      if (hit) {
        removeHighlight(hit.id);
        hideToolbar();
        return true;
      }
      return false;
    }

    /* ----------------------- 工具条 UI ----------------------- */
    function buildToolbar(): HTMLDivElement {
      const el = document.createElement('div');
      el.className = 'whw-toolbar whw-ui';
      el.setAttribute('hidden', '');

      const bar = document.createElement('div');
      bar.className = 'whw-bar';

      const swatches = document.createElement('div');
      swatches.className = 'whw-swatches';

      COLORS.forEach((c) => {
        const s = document.createElement('button');
        s.className = 'whw-swatch';
        s.dataset.color = c.id;
        s.title = c.label;
        s.style.backgroundColor = COLOR_CSS[c.id];
        s.addEventListener('mousedown', (e) => {
          e.preventDefault();
          onSwatch(c.id);
        });
        swatches.appendChild(s);
      });
      bar.appendChild(swatches);

      const sep = document.createElement('div');
      sep.className = 'whw-sep';
      bar.appendChild(sep);

      const actions = document.createElement('div');
      actions.className = 'whw-toolbar-actions';
      bar.appendChild(actions);

      const noteBtn = document.createElement('button');
      noteBtn.className = 'whw-btn';
      noteBtn.textContent = '笔记';
      noteBtn.dataset.role = 'note';
      noteBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        onNoteButton();
      });
      actions.appendChild(noteBtn);

      const chatBtn = document.createElement('button');
      chatBtn.className = 'whw-btn whw-chat-action';
      chatBtn.textContent = '✨ 问 AI';
      chatBtn.dataset.role = 'chat';
      chatBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        // 新建态：先用上次的颜色落一条高亮，再打开追问抽屉
        if (toolbarMode === 'create' && pendingRange) {
          const id = addHighlight(pendingRange, lastColor);
          const sel = window.getSelection();
          if (sel) sel.removeAllRanges();
          if (!id) { hideToolbar(); return; }
          editingId = id;
          pendingRange = null;
          toolbarMode = 'edit';
          updateToolbarState(lastColor);
          openChat(id);
          return;
        }
        if (toolbarMode === 'edit' && editingId) openChat(editingId);
      });
      actions.appendChild(chatBtn);

      const pronounceBtn = document.createElement('button');
      pronounceBtn.type = 'button';
      pronounceBtn.className = 'whw-btn whw-pronounce';
      pronounceBtn.dataset.role = 'toolbar-pronounce';
      const speakerIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      speakerIcon.setAttribute('viewBox', '0 0 24 24');
      speakerIcon.setAttribute('fill', 'none');
      speakerIcon.setAttribute('stroke', 'currentColor');
      speakerIcon.setAttribute('stroke-width', '1.8');
      speakerIcon.setAttribute('stroke-linecap', 'round');
      speakerIcon.setAttribute('stroke-linejoin', 'round');
      speakerIcon.setAttribute('aria-hidden', 'true');
      const speakerPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      speakerPath.setAttribute('d', 'M11 5 6 9H3v6h3l5 4V5Zm4 4a5 5 0 0 1 0 6m3-9a9 9 0 0 1 0 12');
      speakerIcon.appendChild(speakerPath);
      const pronounceLabel = document.createElement('span');
      pronounceLabel.className = 'whw-pronounce-label';
      pronounceLabel.textContent = '朗读';
      pronounceBtn.append(speakerIcon, pronounceLabel);
      pronounceBtn.title = '朗读所选内容';
      pronounceBtn.setAttribute('aria-label', '朗读所选内容');
      pronounceBtn.setAttribute('aria-pressed', 'false');
      if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
        pronounceBtn.disabled = true;
        pronounceBtn.title = '当前浏览器不支持语音朗读';
      }
      pronounceBtn.addEventListener('mousedown', (e) => e.preventDefault());
      pronounceBtn.addEventListener('click', () => {
        const text = toolbarMode === 'create'
          ? pendingRange?.toString().trim()
          : editingId ? getHighlight(editingId)?.exact.trim() : '';
        if (text) speakText(text, pronounceBtn, '朗读所选内容');
      });
      actions.appendChild(pronounceBtn);

      const del = document.createElement('button');
      del.className = 'whw-btn whw-danger';
      del.textContent = '删除';
      del.dataset.role = 'delete';
      del.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (editingId) removeHighlight(editingId);
        hideToolbar();
      });
      actions.appendChild(del);
      el.appendChild(bar);

      // 笔记编辑面板
      const panel = document.createElement('div');
      panel.className = 'whw-note-panel';
      panel.dataset.role = 'note-panel';
      panel.setAttribute('hidden', '');

      const quoteEl = document.createElement('div');
      quoteEl.className = 'whw-note-quote';
      quoteEl.dataset.role = 'note-quote';

      // 创建一个带标签的输入区（笔记 / 心得 复用）
      function makeField(role: string, label: string, placeholder: string, rows: number, extraClass?: string) {
        const wrap = document.createElement('div');
        wrap.className = 'whw-field';

        const lab = document.createElement('div');
        lab.className = 'whw-field-label' + (extraClass ? ' ' + extraClass : '');
        lab.textContent = label;

        const ta = document.createElement('textarea');
        ta.className = 'whw-note-input';
        ta.dataset.role = role;
        ta.rows = rows;
        ta.placeholder = placeholder;
        ta.spellcheck = false;
        ta.setAttribute('autocomplete', 'off');
        ta.setAttribute('autocorrect', 'off');
        ta.setAttribute('autocapitalize', 'off');
        ta.setAttribute('data-gramm', 'false');
        ta.setAttribute('data-gramm_editor', 'false');
        ta.setAttribute('data-enable-grammarly', 'false');
        ta.addEventListener('mousedown', (e) => e.stopPropagation());
        ta.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            saveNoteFromPanel();
          }
        });

        wrap.appendChild(lab);
        wrap.appendChild(ta);
        return wrap;
      }

      const noteField = makeField(
        'note-input', '笔记 · 翻译 / 注释',
        '这段的翻译、词义、用法……', 3
      );
      const insightField = makeField(
        'insight-input', '心得 · 理解 / 感悟',
        '这个概念让你想到什么？你的理解、联想、疑问……', 4,
        'whw-field-label-insight'
      );

      const noteActions = document.createElement('div');
      noteActions.className = 'whw-note-actions';

      const hint = document.createElement('span');
      hint.className = 'whw-note-hint';
      hint.textContent = '⌘/Ctrl + Enter 保存';
      noteActions.appendChild(hint);

      const cancel = document.createElement('button');
      cancel.className = 'whw-btn';
      cancel.textContent = '取消';
      cancel.addEventListener('mousedown', (e) => {
        e.preventDefault();
        closeNotePanel();
      });

      const save = document.createElement('button');
      save.className = 'whw-btn whw-primary';
      save.textContent = '保存';
      save.addEventListener('mousedown', (e) => {
        e.preventDefault();
        saveNoteFromPanel();
      });

      noteActions.appendChild(cancel);
      noteActions.appendChild(save);
      panel.appendChild(quoteEl);
      panel.appendChild(noteField);
      panel.appendChild(insightField);
      panel.appendChild(noteActions);
      el.appendChild(panel);

      el.addEventListener('mousedown', (e) => e.stopPropagation());
      document.documentElement.appendChild(el); // 挂在 body 外，fixed 始终相对视口
      return el;
    }

    function onSwatch(color: string) {
      rememberColor(color);
      if (toolbarMode === 'create' && pendingRange) {
        const id = addHighlight(pendingRange, color);
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        // 新建后切到编辑态，方便紧接着加笔记
        if (id) {
          editingId = id;
          pendingRange = null;
          toolbarMode = 'edit';
          updateToolbarState(color);
          return;
        }
      } else if (toolbarMode === 'edit' && editingId) {
        updateColor(editingId, color);
        updateToolbarState(color);
        // 若笔记面板正打开，点缀色跟随新颜色
        const panel = toolbar && toolbar.querySelector<HTMLElement>('[data-role="note-panel"]');
        if (panel && !panel.hasAttribute('hidden')) applyAccent(panel, color);
        return;
      }
      hideToolbar();
    }

    // 点「笔记」：新建态先落一个默认色高亮，再打开面板
    function onNoteButton() {
      if (toolbarMode === 'create' && pendingRange) {
        const id = addHighlight(pendingRange, DEFAULT_COLOR);
        const sel = window.getSelection();
        if (sel) sel.removeAllRanges();
        if (!id) { hideToolbar(); return; }
        editingId = id;
        pendingRange = null;
        toolbarMode = 'edit';
        updateToolbarState(DEFAULT_COLOR);
      }
      if (editingId) openNotePanel(editingId);
    }

    function openNotePanel(id: string) {
      if (!toolbar) return;
      const h = getHighlight(id);
      if (!h) return;
      const panel = toolbar.querySelector<HTMLElement>('[data-role="note-panel"]');
      const input = toolbar.querySelector<HTMLTextAreaElement>('[data-role="note-input"]');
      const insightInput = toolbar.querySelector<HTMLTextAreaElement>('[data-role="insight-input"]');
      const quoteEl = toolbar.querySelector<HTMLElement>('[data-role="note-quote"]');
      if (!panel || !input || !quoteEl) return;
      // 面板点缀色跟随当前高亮颜色
      applyAccent(panel, h.color);
      quoteEl.textContent = h.exact.length > 60 ? h.exact.slice(0, 60) + '…' : h.exact;
      input.value = h.note || '';
      if (insightInput) insightInput.value = h.insight || '';
      panel.removeAttribute('hidden');
      // 笔记为空则先聚焦笔记，否则聚焦心得，符合"先翻译后感悟"的顺序
      const focusTarget = (h.note && h.note.trim()) ? (insightInput || input) : input;
      setTimeout(() => focusTarget.focus(), 0);
    }

    // 根据高亮色设置面板强调色变量（竖线、聚焦描边、光环）
    function applyAccent(panel: HTMLElement, colorId: string) {
      const base = COLOR_CSS[colorId] || COLOR_CSS[DEFAULT_COLOR];
      panel.style.setProperty('--whw-accent', base);
      panel.style.setProperty('--whw-accent-ring', hexToRgba(base, 0.35));
    }

    function closeNotePanel() {
      if (!toolbar) return;
      const panel = toolbar.querySelector<HTMLElement>('[data-role="note-panel"]');
      if (panel) panel.setAttribute('hidden', '');
    }

    function saveNoteFromPanel() {
      if (!toolbar || !editingId) { hideToolbar(); return; }
      const input = toolbar.querySelector<HTMLTextAreaElement>('[data-role="note-input"]');
      const insightInput = toolbar.querySelector<HTMLTextAreaElement>('[data-role="insight-input"]');
      updateNote(
        editingId,
        input ? input.value.trim() : '',
        insightInput ? insightInput.value.trim() : ''
      );
      hideToolbar();
    }

    // 切换颜色/模式后刷新工具条按钮的显隐与选中态
    function updateToolbarState(activeColor: string | null) {
      if (!toolbar) return;
      const delBtn = toolbar.querySelector<HTMLElement>('[data-role="delete"]');
      const noteBtn = toolbar.querySelector<HTMLElement>('[data-role="note"]');
      if (delBtn) delBtn.style.display = toolbarMode === 'edit' ? '' : 'none';
      if (noteBtn) {
        const h = editingId ? getHighlight(editingId) : null;
        const hasContent = h && ((h.note && h.note.trim()) || (h.insight && h.insight.trim()));
        noteBtn.textContent = hasContent ? '笔记 •' : '笔记';
      }
      toolbar.querySelectorAll<HTMLElement>('.whw-swatch').forEach((s) => {
        s.classList.toggle('whw-active', s.dataset.color === activeColor);
      });
    }

    function showToolbar(mode: 'create' | 'edit', activeColor: string | null) {
      if (currentSpeechButton && toolbar?.contains(currentSpeechButton)) stopChatSpeech();
      if (!toolbar) toolbar = buildToolbar();
      const pronounceBtn = toolbar.querySelector<HTMLButtonElement>('[data-role="toolbar-pronounce"]');
      if (pronounceBtn && !pronounceBtn.disabled) {
        setSpeechButtonLabel(pronounceBtn, '朗读');
        pronounceBtn.title = '朗读所选内容';
        pronounceBtn.setAttribute('aria-label', '朗读所选内容');
        pronounceBtn.setAttribute('aria-pressed', 'false');
      }
      toolbarMode = mode;
      closeNotePanel();
      updateToolbarState(activeColor);
      // 固定停靠在视口顶部居中，避免与豆包等划词插件在选区附近的弹窗重叠。
      toolbar.removeAttribute('hidden');
    }

    function hideToolbar() {
      if (currentSpeechButton && toolbar?.contains(currentSpeechButton)) stopChatSpeech();
      if (toolbar) {
        toolbar.setAttribute('hidden', '');
        closeNotePanel();
      }
      pendingRange = null;
      editingId = null;
    }

    /* ----------------------- 事件 ----------------------- */
    function onMouseUp(e: MouseEvent) {
      if (toolbar && toolbar.contains(e.target as Node)) return;
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
        const text = sel.toString();
        if (!text || !text.trim()) return;
        const range = sel.getRangeAt(0);
        pendingRange = range.cloneRange();
        editingId = null;
        showToolbar('create', null);
      }, 0);
    }

    function findHighlightAtPoint(x: number, y: number): { id: string; info: RangeInfo } | null {
      if (!document.caretRangeFromPoint) return null;
      const caret = document.caretRangeFromPoint(x, y);
      if (!caret) return null;
      for (const [id, info] of rangeMap.entries()) {
        try {
          if (info.range.isPointInRange(caret.startContainer, caret.startOffset)) {
            return { id, info };
          }
        } catch (e) { /* ignore */ }
      }
      return null;
    }

    function onClick(e: MouseEvent) {
      if (toolbar && toolbar.contains(e.target as Node)) return;
      if (tooltip && tooltip.contains(e.target as Node)) return;
      if (chatPanel && chatPanel.contains(e.target as Node)) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // 交给 mouseup 处理

      const hit = findHighlightAtPoint(e.clientX, e.clientY);
      if (hit) {
        hideTooltipNow();
        editingId = hit.id;
        pendingRange = null;
        showToolbar('edit', hit.info.color);
      } else {
        hideToolbar();
      }
      // 注意：点击页面不关闭右侧抽屉，用户可边读边聊；
      // 抽屉仅通过 × / Esc / SPA 跳转关闭。
    }

    /* ----------------------- 笔记悬停提示（可交互双栏） ----------------------- */
    let tooltip: HTMLDivElement | null = null;
    let tooltipId: string | null = null;
    let hideTipTimer: ReturnType<typeof setTimeout> | null = null;

    function cancelHideTooltip() {
      if (hideTipTimer) { clearTimeout(hideTipTimer); hideTipTimer = null; }
    }

    function scheduleHideTooltip() {
      cancelHideTooltip();
      hideTipTimer = setTimeout(() => {
        if (tooltip) tooltip.setAttribute('hidden', '');
        tooltipId = null;
      }, 250);
    }

    function hideTooltipNow() {
      cancelHideTooltip();
      if (tooltip) tooltip.setAttribute('hidden', '');
      tooltipId = null;
    }

    function ensureTooltip(): HTMLDivElement {
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'whw-tooltip whw-ui';
        tooltip.setAttribute('hidden', '');
        tooltip.addEventListener('mouseenter', cancelHideTooltip);
        tooltip.addEventListener('mouseleave', scheduleHideTooltip);
        document.documentElement.appendChild(tooltip); // 挂在 body 外，fixed 始终相对视口
      }
      return tooltip;
    }

    const ICON_EDIT = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
    const ICON_COPY = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const ICON_CHECK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    const ICON_SPARK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/></svg>';

    function copyText(text: string, btn: HTMLButtonElement) {
      const done = () => {
        btn.classList.add('whw-tip-btn-done');
        btn.innerHTML = ICON_CHECK + '<span>已复制</span>';
        setTimeout(() => {
          btn.classList.remove('whw-tip-btn-done');
          btn.innerHTML = ICON_COPY + '<span>复制</span>';
        }, 1200);
      };
      const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        ta.remove();
        done();
      };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else {
          fallback();
        }
      } catch (e) { fallback(); }
    }

    // 单个面板：按钮颜色区分类型（note 黄 / insight 橙）+ 内容 + 右下角 编辑/复制
    function buildTipSection(type: 'note' | 'insight', text: string, hit: { id: string; info: RangeInfo }): HTMLDivElement {
      const sec = document.createElement('div');
      sec.className = 'whw-tip-sec whw-tip-' + type;

      const body = document.createElement('div');
      body.className = 'whw-tip-body';
      body.textContent = text;

      const actions = document.createElement('div');
      actions.className = 'whw-tip-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'whw-tip-btn';
      editBtn.innerHTML = ICON_EDIT + '<span>编辑</span>';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTooltipNow();
        editingId = hit.id;
        pendingRange = null;
        showToolbar('edit', hit.info.color);
        openNotePanel(hit.id);
      });

      const copyBtn = document.createElement('button');
      copyBtn.className = 'whw-tip-btn';
      copyBtn.innerHTML = ICON_COPY + '<span>复制</span>';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyText(text, copyBtn);
      });

      const aiBtn = document.createElement('button');
      aiBtn.className = 'whw-tip-btn whw-tip-btn-ai';
      aiBtn.innerHTML = ICON_SPARK + '<span>问 AI</span>';
      aiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openChat(hit.id);
      });

      actions.appendChild(editBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(aiBtn);
      sec.appendChild(body);
      sec.appendChild(actions);
      return sec;
    }

    // 锚定在高亮文本下方（空间不足则放上方），固定不随鼠标移动
    function positionTooltip(tip: HTMLDivElement, range: Range) {
      const rect = range.getBoundingClientRect();
      const tw = tip.offsetWidth;
      const th = tip.offsetHeight;
      let left = rect.left;
      let top = rect.bottom + 8;
      if (left + tw > window.innerWidth - 8) left = window.innerWidth - tw - 8;
      if (left < 8) left = 8;
      if (top + th > window.innerHeight - 8) top = rect.top - th - 8;
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    }

    /* ----------------------- 高亮追问（AI 对话面板） ----------------------- */
    // 每条高亮一个 thread（映射存 background），面板重开可续聊；
    // 首次打开自动发一条讲解请求，之后自由追问。
    let chatPanel: HTMLDivElement | null = null;
    let chatId: string | null = null;
    let currentSpeech: SpeechSynthesisUtterance | null = null;
    let currentSpeechButton: HTMLButtonElement | null = null;

    function setSpeechButtonLabel(button: HTMLButtonElement, label: string) {
      const span = button.querySelector<HTMLElement>('.whw-pronounce-label');
      if (span) span.textContent = label;
      else button.textContent = label;
    }

    function stopChatSpeech(cancel = true) {
      if (!currentSpeech) return;
      currentSpeech = null;
      if (cancel) window.speechSynthesis.cancel();
      const button = currentSpeechButton;
      currentSpeechButton = null;
      if (button) {
        setSpeechButtonLabel(button, '朗读');
        button.title = button.dataset.idleTitle || '朗读';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', 'false');
      }
    }

    function speakText(text: string, button: HTMLButtonElement, idleTitle: string, status?: HTMLElement) {
      if (currentSpeech && currentSpeechButton === button) { stopChatSpeech(); return; }
      stopChatSpeech();
      if (status) status.textContent = '';
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      currentSpeech = utterance;
      currentSpeechButton = button;
      button.dataset.idleTitle = idleTitle;
      setSpeechButtonLabel(button, '停止');
      button.title = '停止朗读';
      button.setAttribute('aria-label', '停止朗读');
      button.setAttribute('aria-pressed', 'true');
      utterance.onend = () => {
        if (currentSpeech === utterance) stopChatSpeech(false);
      };
      const onError = () => {
        if (currentSpeech !== utterance) return;
        stopChatSpeech(false);
        setSpeechButtonLabel(button, '重试');
        button.title = '朗读失败，请检查浏览器语音设置';
        button.setAttribute('aria-label', '重试朗读');
        if (status) status.textContent = button.title;
      };
      utterance.onerror = onError;
      try {
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        onError();
      }
    }

    const CHAT_SEED = '帮我讲解一下这段内容';
    const CHAT_SUGGESTIONS = ['翻译并讲解', '给个例句', '出道题考考我'];

    function chatPart(role: string): HTMLElement | null {
      return chatPanel ? chatPanel.querySelector<HTMLElement>(`[data-role="chat-${role}"]`) : null;
    }

    function ensureChatPanel(): HTMLDivElement {
      if (!chatPanel) {
        chatPanel = document.createElement('div');
        chatPanel.className = 'whw-chat whw-ui';
        chatPanel.setAttribute('hidden', '');

        const head = document.createElement('div');
        head.className = 'whw-chat-head';
        const titleEl = document.createElement('div');
        titleEl.className = 'whw-chat-title';
        titleEl.textContent = '✨ Highlight Buddy';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'whw-chat-close';
        closeBtn.textContent = '×';
        closeBtn.title = '关闭';
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeChat();
        });
        head.appendChild(titleEl);
        head.appendChild(closeBtn);

        const quote = document.createElement('div');
        quote.className = 'whw-chat-quote';
        const quoteText = document.createElement('span');
        quoteText.className = 'whw-chat-quote-text';
        quoteText.dataset.role = 'chat-quote';
        const pronounceBtn = document.createElement('button');
        pronounceBtn.type = 'button';
        pronounceBtn.className = 'whw-chat-pronounce';
        pronounceBtn.dataset.role = 'chat-pronounce';
        pronounceBtn.textContent = '朗读';
        pronounceBtn.title = '朗读高亮内容';
        pronounceBtn.setAttribute('aria-label', '朗读高亮内容');
        pronounceBtn.setAttribute('aria-pressed', 'false');
        const speechStatus = document.createElement('span');
        speechStatus.className = 'whw-chat-speech-status';
        speechStatus.setAttribute('role', 'status');
        speechStatus.setAttribute('aria-live', 'polite');
        if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
          pronounceBtn.disabled = true;
          pronounceBtn.title = '当前浏览器不支持语音朗读';
        }
        pronounceBtn.addEventListener('click', () => {
          const text = chatId ? getHighlight(chatId)?.exact.trim() : '';
          if (text) speakText(text, pronounceBtn, '朗读高亮内容', speechStatus);
        });
        quote.append(quoteText, pronounceBtn, speechStatus);

        const msgs = document.createElement('div');
        msgs.className = 'whw-chat-msgs';
        msgs.dataset.role = 'chat-msgs';

        const chips = document.createElement('div');
        chips.className = 'whw-chat-chips';
        chips.dataset.role = 'chat-chips';

        const inputRow = document.createElement('div');
        inputRow.className = 'whw-chat-inputrow';
        const input = document.createElement('textarea');
        input.className = 'whw-chat-input';
        input.dataset.role = 'chat-input';
        input.placeholder = '追问点什么…（Enter 发送，Shift+Enter 换行）';
        input.rows = 1;
        input.setAttribute('autocomplete', 'off');
        // 随内容自动增高，上限 140px
        const autogrow = () => {
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 140) + 'px';
        };
        input.addEventListener('input', autogrow);
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          // Enter 发送，Shift+Enter 换行
          if (e.key === 'Enter' && !e.shiftKey && input.value.trim()) {
            e.preventDefault();
            const text = input.value.trim();
            input.value = '';
            autogrow();
            sendChat(text);
          }
        });
        const sendBtn = document.createElement('button');
        sendBtn.className = 'whw-chat-send';
        sendBtn.textContent = '发送';
        sendBtn.addEventListener('click', () => {
          if (!input.value.trim()) return;
          const text = input.value.trim();
          input.value = '';
          autogrow();
          sendChat(text);
        });
        inputRow.appendChild(input);
        inputRow.appendChild(sendBtn);

        chatPanel.appendChild(head);
        chatPanel.appendChild(quote);
        chatPanel.appendChild(msgs);
        chatPanel.appendChild(chips);
        chatPanel.appendChild(inputRow);
        chatPanel.addEventListener('mousedown', (e) => e.stopPropagation());
        chatPanel.addEventListener('click', (e) => e.stopPropagation());

        // 左缘拖拽调宽，宽度记忆到本地
        const resizer = document.createElement('div');
        resizer.className = 'whw-chat-resizer';
        resizer.title = '拖动调整宽度';
        resizer.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          resizer.classList.add('active');
          const prevUserSelect = document.body.style.userSelect;
          document.body.style.userSelect = 'none';
          const onMove = (ev: MouseEvent) => {
            const max = Math.min(760, window.innerWidth * 0.85);
            const w = Math.min(Math.max(window.innerWidth - ev.clientX, CHAT_MIN_W), max);
            applyChatWidth(w);
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('mouseup', onUp, true);
            document.body.style.userSelect = prevUserSelect;
            resizer.classList.remove('active');
            if (chatPanel && isContextValid()) {
              try {
                chrome.storage.local.set({ [CHAT_WIDTH_KEY]: Math.round(chatPanel.getBoundingClientRect().width) });
              } catch (err) { onContextInvalidated(); }
            }
          };
          document.addEventListener('mousemove', onMove, true);
          document.addEventListener('mouseup', onUp, true);
        });
        chatPanel.appendChild(resizer);

        // 恢复上次拖拽的宽度
        if (isContextValid()) {
          try {
            chrome.storage.local.get(CHAT_WIDTH_KEY, (r) => {
              const w = r && r[CHAT_WIDTH_KEY];
              if (typeof w === 'number' && w >= CHAT_MIN_W) applyChatWidth(w);
            });
          } catch (err) { onContextInvalidated(); }
        }

        // 挂在 <html> 下（body 之外）：body 的 transform 只压缩页面元素，
        // 抽屉 fixed 始终相对视口，滚动页面不跟随。
        document.documentElement.appendChild(chatPanel);
      }
      return chatPanel;
    }

    // 抽屉宽度记忆 + 宿主页挤压式布局（网页一分为二，而非浮层遮挡）
    const CHAT_WIDTH_KEY = 'whw:chatWidth';
    const CHAT_MIN_W = 320;
    let chatWidth = 400;

    function applyChatWidth(w: number) {
      chatWidth = w;
      if (chatPanel) chatPanel.style.width = w + 'px';
      // 抽屉四周留白 12px，页面让位需加上两侧间隙
      if (chatPanel && !chatPanel.hasAttribute('hidden')) applyPageOffset(w + 24);
    }

    // 挤压宿主页（与豆包同款做法）：
    // 1) <html> 加右边距 → body 宽度收缩，正文重排让出抽屉空间；
    // 2) body 加 transform → body 成为其内部 fixed 元素的包含块，
    //    页面的 fixed 顶栏/侧栏随之一起压缩，不会被抽屉压住。
    // 代价：fixed + bottom 定位的页面元素会相对文档底部而非视口底部，
    // 个别页面的小挂件（回到顶部按钮等）可能移位，关闭抽屉即恢复。
    function applyPageOffset(width: number | null) {
      try {
        if (width && width > 0) {
          document.documentElement.style.setProperty('margin-right', Math.round(width) + 'px', 'important');
          document.body.style.setProperty('transform', 'translateZ(0)', 'important');
        } else {
          document.documentElement.style.removeProperty('margin-right');
          document.body.style.removeProperty('transform');
        }
      } catch (e) { /* ignore */ }
    }

    // AI 气泡底部挂「存为笔记」，点击把原文并入该高亮的 note
    function attachSaveBtn(div: HTMLDivElement) {
      if (!div.dataset.raw || div.querySelector('.whw-chat-save')) return;
      const btn = document.createElement('button');
      btn.className = 'whw-chat-save';
      btn.textContent = '存为笔记';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = div.dataset.hid || chatId;
        if (!id) return;
        const h = getHighlight(id);
        if (!h) return;
        const raw = (div.dataset.raw || '').trim();
        if (!raw) return;
        const next = h.note && h.note.trim() ? h.note.trim() + '\n\n' + raw : raw;
        updateNote(id, next, h.insight || '');
        btn.textContent = '✓ 已存为笔记';
        btn.disabled = true;
      });
      div.appendChild(btn);
    }

    function appendChatMsg(role: 'user' | 'assistant', text: string, pending = false): HTMLDivElement {
      const msgs = chatPart('msgs');
      const div = document.createElement('div');
      div.className = `whw-chat-msg whw-chat-${role}` + (pending ? ' whw-chat-pending' : '');
      div.dataset.hid = chatId || '';
      if (role === 'assistant') {
        if (pending) {
          div.textContent = text;
          const dots = document.createElement('span');
          dots.className = 'whw-chat-loading-dots';
          dots.setAttribute('aria-hidden', 'true');
          for (let i = 0; i < 3; i++) dots.appendChild(document.createElement('span'));
          div.appendChild(dots);
        } else {
          div.dataset.raw = text;
          div.innerHTML = renderMarkdown(text);
          attachSaveBtn(div);
        }
      } else {
        div.textContent = text;
      }
      if (msgs) {
        msgs.appendChild(div);
        msgs.scrollTop = msgs.scrollHeight;
      }
      return div;
    }

    // 首轮 prompt 里包裹了高亮上下文，历史展示时只留用户的真实问题
    function displayChatText(m: { role: string; text: string }): string {
      if (m.role === 'user' && m.text.startsWith('我在网页上高亮了这段内容')) {
        const parts = m.text.split('\n\n');
        return parts[parts.length - 1] || m.text;
      }
      return m.text;
    }

    function renderChips() {
      const chips = chatPart('chips');
      if (!chips) return;
      chips.innerHTML = '';
      for (const s of CHAT_SUGGESTIONS) {
        const chip = document.createElement('button');
        chip.className = 'whw-chat-chip';
        chip.textContent = s;
        chip.addEventListener('click', () => sendChat(s));
        chips.appendChild(chip);
      }
    }

    function setChatBubble(div: HTMLDivElement, raw: string) {
      div.dataset.raw = raw;
      div.innerHTML = renderMarkdown(raw);
      const msgs = chatPart('msgs');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    }

    let chatSession = 0;

    function sendChat(text: string) {
      const id = chatId;
      if (!id) return;
      const h = getHighlight(id);
      if (!h) return;
      const session = chatSession;
      appendChatMsg('user', text);
      const progress = document.createElement('details');
      progress.className = 'whw-chat-activity';
      progress.open = true;
      const summary = document.createElement('summary');
      const title = document.createElement('span');
      title.textContent = '执行过程';
      const status = document.createElement('span');
      status.className = 'whw-chat-activity-status';
      status.textContent = '进行中';
      summary.append(title, status);
      const timeline = document.createElement('ol');
      progress.append(summary, timeline);
      const msgs = chatPart('msgs');
      if (msgs) msgs.appendChild(progress);
      const thinking = appendChatMsg('assistant', '正在等待服务响应', true);
      const addActivity = (activity: AgentActivity) => {
        if (!activity || typeof activity.kind !== 'string') return;
        const labels: Record<AgentActivity['kind'], string> = {
          run: '服务已接收请求',
          agent: 'Agent 已启动',
          'tool-start': `调用${activity.label || '工具'}`,
          'tool-end': `${activity.label || '工具'}调用完成`,
          'tool-error': `${activity.label || '工具'}调用失败`,
          answer: '模型开始输出内容',
          complete: '回答已完成',
          failure: '执行中断'
        };
        if (!Object.prototype.hasOwnProperty.call(labels, activity.kind)) return;
        if (thinking.classList.contains('whw-chat-pending') && thinking.firstChild) {
          if (activity.kind === 'run') thinking.firstChild.textContent = '服务正在处理';
          else if (activity.kind === 'agent') thinking.firstChild.textContent = 'Agent 正在运行';
          else if (activity.kind === 'tool-start') thinking.firstChild.textContent = '正在调用工具';
          else if (activity.kind === 'tool-end' || activity.kind === 'tool-error') thinking.firstChild.textContent = '工具已返回';
        }
        const item = document.createElement('li');
        item.textContent = labels[activity.kind];
        if (timeline.childElementCount >= 40) timeline.firstElementChild?.remove();
        timeline.appendChild(item);
        if (msgs) msgs.scrollTop = msgs.scrollHeight;
      };
      if (!isContextValid()) { onContextInvalidated(); return; }
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connect({ name: 'whw-ai-chat' });
      } catch (e) {
        onContextInvalidated();
        return;
      }
      let settled = false;
      port.onMessage.addListener((msg) => {
        if (!thinking.isConnected || chatId !== id || chatSession !== session) { port.disconnect(); return; }
        if (msg.type === 'activity') {
          addActivity(msg.activity as AgentActivity);
        } else if (msg.type === 'delta') {
          thinking.classList.remove('whw-chat-pending');
          setChatBubble(thinking, msg.text || '');
        } else if (msg.type === 'done') {
          settled = true;
          thinking.classList.remove('whw-chat-pending');
          setChatBubble(thinking, msg.reply || '');
          attachSaveBtn(thinking);
          addActivity({ kind: 'complete' });
          status.textContent = '已完成';
          progress.open = false;
          port.disconnect();
        } else if (msg.type === 'error') {
          settled = true;
          thinking.classList.remove('whw-chat-pending');
          thinking.classList.add('whw-chat-error');
          thinking.textContent = 'AI 服务不可用：' + (msg.error || '请先在管理页检查 AI 服务设置');
          addActivity({ kind: 'failure' });
          status.textContent = '已中断';
          progress.classList.add('whw-chat-activity-error');
          port.disconnect();
        }
      });
      port.onDisconnect.addListener(() => {
        if (!settled && thinking.isConnected && chatId === id && chatSession === session) {
          thinking.classList.remove('whw-chat-pending');
          thinking.classList.add('whw-chat-error');
          thinking.textContent = '连接已中断，请重新打开会话查看结果';
          addActivity({ kind: 'failure' });
          status.textContent = '已中断';
          progress.classList.add('whw-chat-activity-error');
        }
      });
      port.postMessage({
        type: 'aiChatStream',
        highlightId: id,
        content: text,
        context: { exact: h.exact, title: h.title }
      });
    }

    function openChat(id: string) {
      const h = getHighlight(id);
      if (!h) return;
      hideTooltipNow();
      stopChatSpeech();
      chatId = id;
      const session = ++chatSession;
      const panel = ensureChatPanel();
      const quoteEl = chatPart('quote');
      const msgsEl = chatPart('msgs');
      const chipsEl = chatPart('chips');
      if (quoteEl) quoteEl.textContent = h.exact.length > 60 ? h.exact.slice(0, 60) + '…' : h.exact;
      const speechStatus = chatPanel?.querySelector('.whw-chat-speech-status');
      if (speechStatus) speechStatus.textContent = '';
      const pronounceBtn = chatPart('pronounce') as HTMLButtonElement | null;
      if (pronounceBtn && !pronounceBtn.disabled) {
        pronounceBtn.textContent = '朗读';
        pronounceBtn.title = '朗读高亮内容';
        pronounceBtn.setAttribute('aria-label', '朗读高亮内容');
        pronounceBtn.setAttribute('aria-pressed', 'false');
      }
      if (msgsEl) msgsEl.innerHTML = '';
      if (chipsEl) chipsEl.innerHTML = '';
      const input = chatPart('input') as HTMLInputElement | null;
      if (input) input.value = '';
      panel.removeAttribute('hidden');

      appendChatMsg('assistant', '正在加载会话', true);
      sendRuntimeMessage({ type: 'aiChatHistory', highlightId: id }, (resp) => {
        if (chatId !== id || chatSession !== session) return;
        if (msgsEl) msgsEl.innerHTML = '';
        const history: Array<{ role: 'user' | 'assistant'; text: string }> =
          resp && resp.ok && Array.isArray(resp.messages) ? resp.messages : [];
        if (history.length) {
          for (const m of history) appendChatMsg(m.role, displayChatText(m));
        } else {
          renderChips();
          sendChat(CHAT_SEED); // 首次打开：自动基于高亮讲解
        }
      });
      setTimeout(() => input && input.focus(), 0);
      applyPageOffset(chatWidth + 24); // 挤压宿主页，让出抽屉空间（含留白）
    }

    function closeChat() {
      stopChatSpeech();
      if (chatPanel) chatPanel.setAttribute('hidden', '');
      chatId = null;
      chatSession++;
      applyPageOffset(null); // 恢复宿主页布局
    }

    function onMouseMove(e: MouseEvent) {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      if (toolbar && toolbar.contains(e.target as Node)) return;
      // 鼠标在 tooltip 内部：保持显示
      if (tooltip && !tooltip.hasAttribute('hidden') && tooltip.contains(e.target as Node)) {
        cancelHideTooltip();
        return;
      }
      const hit = findHighlightAtPoint(e.clientX, e.clientY);
      const hasNote = hit && hit.info.note && hit.info.note.trim();
      const hasInsight = hit && hit.info.insight && hit.info.insight.trim();
      if (hit && (hasNote || hasInsight)) {
        cancelHideTooltip();
        const tip = ensureTooltip();
        const isNew = tooltipId !== hit.id;
        if (isNew) {
          tip.innerHTML = '';
          if (hasNote) tip.appendChild(buildTipSection('note', hit.info.note, hit));
          if (hasInsight) tip.appendChild(buildTipSection('insight', hit.info.insight, hit));
          tooltipId = hit.id;
        }
        tip.removeAttribute('hidden');
        if (isNew) positionTooltip(tip, hit.info.range);
      } else if (tooltip && !tooltip.hasAttribute('hidden')) {
        scheduleHideTooltip();
      }
    }

    // 点击高亮打开编辑条后，按 Delete / Backspace 删除该高亮
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { closeChat(); hideToolbar(); return; }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      // 焦点在输入框 / 可编辑区域时，删除键应编辑文本而非删高亮
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (toolbarMode === 'edit' && editingId && getHighlight(editingId)) {
        e.preventDefault();
        removeHighlight(editingId);
        hideToolbar();
      }
    }

    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('keydown', onKeyDown, true);
    // tooltip 内部滚动不关闭；滚动页面其它地方才关闭
    document.addEventListener('scroll', (e) => {
      if (tooltip && e.target && tooltip.contains(e.target as Node)) return;
      hideTooltipNow();
      repositionBadges(); // 角标是浮层，滚动后需跟随高亮位置
    }, true);
    window.addEventListener('resize', repositionBadges);

    /* ----------------------- 与 popup/background 通信 ----------------------- */
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.type) return;
      switch (msg.type) {
        case 'getHighlights':
          sendResponse({ ok: true, url: currentUrl(), supported, highlights });
          return true;
        case 'removeHighlight':
          removeHighlight(msg.id);
          sendResponse({ ok: true });
          return true;
        case 'clearPage':
          clearPage();
          sendResponse({ ok: true });
          return true;
        case 'scrollTo': {
          const info = rangeMap.get(msg.id);
          if (info) {
            try {
              const rect = info.range.getBoundingClientRect();
              window.scrollTo({
                top: rect.top + window.scrollY - window.innerHeight / 3,
                behavior: 'smooth'
              });
            } catch (e) { /* ignore */ }
          }
          sendResponse({ ok: true });
          return true;
        }
        case 'refresh':
          load();
          sendResponse({ ok: true });
          return true;
        case 'highlightSelection':
          sendResponse({ ok: highlightCurrentSelection(msg.color) });
          return true;
        case 'deleteHighlight':
          sendResponse({ ok: deleteHighlightByShortcut() });
          return true;
        default:
          return;
      }
    });

    /* -------- 找回误归档到其他页面的高亮（SPA 修复前的存量数据） -------- */
    // 误归档的高亮文本锚点只在真正的页面上能强匹配命中，命中即搬迁到当前页。
    const reclaimedUrls = new Set<string>();
    function reclaimForeignHighlights() {
      if (!supported) return;
      const url = currentUrl();
      if (reclaimedUrls.has(url)) return; // 同一会话同一页面只找回一次
      reclaimedUrls.add(url);
      sendRuntimeMessage({ type: 'findForeign', url }, (resp) => {
        if (!resp || !resp.ok || !Array.isArray(resp.foreign) || !resp.foreign.length) return;
        if (currentUrl() !== url) return; // 页面已跳转，丢弃
        const byUrl = new Map<string, string[]>();
        for (const f of resp.foreign) {
          const it = f.item;
          if (!it || !it.exact) continue;
          if (quoteMatchesStrict({ exact: it.exact, prefix: it.prefix, suffix: it.suffix })) {
            if (!byUrl.has(f.url)) byUrl.set(f.url, []);
            byUrl.get(f.url)!.push(it.id);
          }
        }
        if (!byUrl.size) return;
        const moves = Array.from(byUrl.entries()).map(([fromUrl, ids]) => ({ fromUrl, ids }));
        sendRuntimeMessage(
          { type: 'relocate', moves, toUrl: url, toTitle: document.title },
          (r2) => { if (r2 && r2.ok && (r2.moved || r2.deduped)) load(); }
        );
      });
    }

    /* ---------------- SPA 路由切换：URL 变化时切换到新页面的数据 ---------------- */
    let lastKnownUrl = currentUrl();
    function onUrlMaybeChanged() {
      const u = currentUrl();
      if (u === lastKnownUrl) return;
      lastKnownUrl = u;
      // 所有变更都已即时 persist，这里直接重置并加载新页面的高亮
      hideToolbar();
      hideTooltipNow();
      closeChat();
      highlights = [];
      renderAll();
      load();
      setTimeout(reclaimForeignHighlights, 2500);
    }
    window.addEventListener('popstate', onUrlMaybeChanged);
    window.addEventListener('hashchange', onUrlMaybeChanged);
    // isolated world 里 patch 不到页面的 history.pushState，用轮询兜底
    setInterval(onUrlMaybeChanged, 800);

    /* ------- hydration / 懒加载导致锚点暂时失效：DOM 变化后自动重试渲染 ------- */
    let lastRenderRetry = 0;
    const mo = new MutationObserver(() => {
      if (!highlights.length) return;
      if (rangeMap.size >= highlights.length) return; // 全部命中，无需重试
      const now = Date.now();
      if (now - lastRenderRetry < 1000) return;
      lastRenderRetry = now;
      renderAll();
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });

    load();
    // 延迟执行，等页面主体内容渲染完成后再做找回匹配
    setTimeout(reclaimForeignHighlights, 2500);
  }
});
