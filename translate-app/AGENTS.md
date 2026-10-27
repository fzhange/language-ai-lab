# Translate Desktop App

Read `../AGENTS.md` first. This folder owns the macOS Electron translation client.

- Renderer: React + TypeScript + Vite in `src/`; never import Electron/Node here.
- Native APIs: `electron/main.cjs` and a sandbox-compatible CommonJS preload.
- Mentor: native LangGraph `POST /runs/stream`, graph ID `translation-mentor`.
  Official `@langchain/langgraph-sdk` handles SSE in the main process; the renderer
  receives scoped text updates. The legacy `translator` graph stays compatible.
- Backend ownership: `../generic-agent-service/assistants/translator/`.
- Keep model credentials in the agent service. Optional gateway credentials stay
  in main-process environment variables, never IPC responses or renderer storage.
- Closing hides the window. Command+B captures the external selection before
  waking and translates automatically; Command+Q quits. Dock/menu wake never captures.
- Selection library: `native/SelectionCapture.m`, compiled with `build:native` and
  loaded inside Electron's main process through Koffi. Capture and permission checks
  must use Translate's process identity, never a child executable with separate TCC
  authorization. Requires Accessibility permission; never use stale clipboard text.
- Theme primary/accent matches `language-learning-web/src/index.css` (blue).
- All input paths use `src/language.ts` for automatic Chinese/English direction.
  Source/target labels are derived from text, never independent manual state.
- Source editor: Enter invokes Explain, Shift+Enter inserts a newline. Do not
  submit during IME composition or hijack Enter in Settings/other controls.
- English source supports explicit read-aloud via macOS `/usr/bin/say` in the main
  process. Never auto-play; stop on text changes/hide/quit. Use a fixed English
  voice and stdin for text, never a shell. English comprehension prompts include
  IPA/part of speech; the renderer must not fabricate phonetic transcriptions.
- Follow-up questions keep the original source and direction; send bounded
  completed user/assistant history plus `follow_up` with each stateless SSE run.
  Keep conversation in renderer memory only, not files/localStorage/Supabase.
  Use `on_completion=delete`; the mentor graph disables checkpoints. Failed or
  stopped replies are not committed to model history. New source/focus clears it.
- Keep unrelated workspaces unchanged. Never modify the knowledge base or plugin.
- Verify with `npm test`, `npm run build`, and `npm run test:e2e`.

## Open-Source First / 优先复用开源

- Before implementing transport, parsing, UI primitives, rendering, or domain logic,
  look for an existing project dependency or a maintained open-source solution.
  Prefer building on proven tools over reimplementing their functionality.
- Use the official LangGraph SDK for REST/SSE and cancellation; do not hand-write
  an SSE parser. Use React Markdown + remark-gfm for Markdown, Radix for accessible
  UI primitives, and Lucide for icons. Keep Electron's secure preload boundary.
- Add a dependency only when it addresses a concrete need. Check compatibility,
  maintenance, license, bundle cost, and security; document meaningful tradeoffs.
- Write custom code for application-specific behavior and integration only. Native
  macOS selection capture is a bounded OS integration, not a general UI/transport
  framework. Do not rewrite working components solely to introduce a library.
- Product principle: be a language mentor, not a dictionary-only translator.
  Explain context, meaning, structure, usage, and transferable distinctions with
  Chinese explanations and English examples. Preserve the user's source text.
- Chinese-to-English is expression coaching: a word gets English equivalents,
  part of speech and IPA; a sentence gets a recommended English expression,
  natural alternatives and practical comparisons. English-to-Chinese remains
  comprehension coaching. This policy lives in the backend direction-specific
  prompts, not renderer-generated explanations or character-count heuristics.
