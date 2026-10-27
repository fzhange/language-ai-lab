# Translate

A macOS AI language mentor for Chinese/English words, phrases, and sentences.
It translates, explains context and structure, contrasts related expressions,
and provides English examples with Chinese explanations, streamed live.
The model runs in `generic-agent-service`, not in the desktop app.

## Teaching Modes

- Chinese-to-English helps you express an idea in English. A standalone word or
  noun phrase gets useful English equivalents, part of speech, IPA pronunciation,
  context distinctions, and short examples. A sentence gets a recommended natural
  expression, usually two alternatives, and Chinese explanations of their tone,
  register, emphasis, and when to choose each. Missing context is acknowledged.
- English-to-Chinese helps you understand what you read: translation, meaning in
  context, IPA pronunciation, useful chunks, expression contrasts, and examples.
  Words include part of speech and UK/US IPA; short phrases can include phrase
  IPA, and sentences show focus/key-word pronunciation rather than a long transcript.
- The model distinguishes vocabulary from sentences semantically, including
  unpunctuated sentences. The client does not fabricate teaching or IPA. Model
  pronunciations and alternatives can still be imperfect and should be checked
  against a dictionary when precision is important.

## Run

1. Start (or restart) the agent service so `translation-mentor` is registered:

   ```sh
   cd ../generic-agent-service
   uv sync
   uv run langgraph dev --port 2024
   ```

   Configure model credentials in that service's `.env`, using its existing
   `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and optional `CHAT_MODEL` settings.
   Its configured PostgreSQL persistence must also be available.

2. In `translate-app`:

   ```sh
   npm install
   npm run dev
   ```

   The development launcher starts Vite on a free port and opens Electron.
   The default service address is `http://127.0.0.1:2024`; change it in Settings.
   Optional `.env` values are documented in `.env.example`. They are read only by
   the Electron main process in development; packaged apps use launch environment
   variables and saved settings instead. A saved service URL takes precedence.

## macOS Behavior

- With English source, press the speaker icon beside Source to read the original
  word, phrase, or sentence aloud. It becomes a Stop reading button until playback
  finishes. Playback uses macOS's Samantha English voice locally, needs no model
  request, and never starts automatically. Changing the source, hiding the window,
  or quitting stops playback. macOS Spoken Content settings manages installed voices.
- After the mentor finishes, Ask a follow-up appears below the answer. Enter sends
  the question, Shift+Enter adds a line. You can keep asking about the same source;
  the earlier explanation and completed turns remain visible and provide context.
  Questions can use Chinese or English without changing the original direction.
- Conversation stays in memory while the app is running. Editing source/focus,
  capturing new text, re-running Explain, or quitting clears it. It is not saved to
  disk, localStorage, or Supabase. Failed/stopped turns can be retried but are not
  included in subsequent model context. Questions are limited to 2,000 characters;
  context is bounded to 20 follow-ups and 120,000 characters, then start fresh.
- Typed, pasted, and shortcut-captured input all use automatic language detection:
  English targets Chinese; Chinese targets English. Text containing Han characters
  (including mixed Chinese/English) targets English; other input defaults to English
  as the source. Language labels update immediately; no manual selection is needed.
- Typing and pasting do not send text until Explain or Enter is pressed.
  In the source editor, Enter asks the mentor and Shift+Enter inserts a new line.
  Enter during Chinese input composition only confirms the current input.
  Add an optional focus word from the source to ask about that expression in context.
- Select text in another app and press `Command+B`: Translate captures the
  selection before taking focus, fills the editor, detects Chinese/English, and
  explains automatically. The app must already be running.
- Closing the window hides it without quitting. Reopen with `Command+B` or the Dock.
- `Escape` hides the window; `Command+Enter` also remains available to ask the mentor.
- `Command+Q` quits and releases the global shortcut.
- A warning is shown if macOS cannot register the shortcut. This global binding
  takes precedence over other apps' usual Bold shortcut while Translate is running.
- Enable Translate under System Settings > Privacy & Security > Accessibility.
  Settings > Accessibility > Allow Access opens this pane. In development, macOS
  may list Electron (or the launching terminal) instead of Translate.
- Selection capture runs inside Translate through Koffi and a bundled native
  library, so the permission check and capture share the same process identity.
  No separate helper needs Accessibility access. If an old locally rebuilt app
  remains enabled but access is denied, quit Translate, remove its old entry, add
  the current `release/mac-arm64/Translate.app` again, enable it, then reopen it.
  Unsigned/ad-hoc development rebuilds may invalidate macOS's saved trust; production
  releases should use a stable Apple signing identity.
- Selection capture uses the macOS Accessibility selected-text API first, then
  a fresh Command+C for apps that do not expose selected text. The Copy fallback
  temporarily uses the clipboard and restores its previous data/formats. It
  never translates old clipboard text when capture fails. Apps that disable Copy
  or protect selections may not support capture; manual Paste remains available.
- Opening from the Dock or menu only focuses the editor; it does not capture text.
- When the Translate window itself is focused, Command+B only focuses the editor.

## API

Uses the official LangGraph JS SDK in Electron's main process. It handles native
SSE framing, UTF-8 decoding, and cancellation; no hand-written network parser.

```http
POST /runs/stream
Content-Type: application/json
```

```json
{
  "assistant_id": "translation-mentor",
  "stream_mode": ["messages-tuple", "values"],
  "on_disconnect": "cancel",
  "on_completion": "delete",
  "input": {
    "text": "Understand, don't memorize.",
    "source_language": "en",
    "target_language": "zh",
    "focus": ""
  }
}
```

Model message tokens arrive incrementally and are rendered as Markdown while the
request is still running. The final state contains `explanation`. No artificial
typewriter animation delays a completed answer. With `CHAT_DISABLE_STREAMING=1`
the model returns text in one block instead; enable streaming for token display.

Both sides enforce a 10,000 Unicode
code-point limit and require different source/target languages (`en` and `zh`).
The UI offers a 180-second timeout and Stop. Stop preserves partial teaching,
ignores late tokens, and aborts the SSE request (`on_disconnect=cancel`). A new
Command+B selection cancels/drains the prior request before starting another.
The legacy `translator` graph remains available for translation-only API clients.

For follow-ups, include `follow_up` and `history` in the same input while keeping
the original `text`, direction, and focus. History starts with the initial mentor
answer and alternates completed `assistant` / `user` messages; its last message
is the latest completed assistant answer. No system roles are accepted.
The question is sent separately so the backend answers it instead of translating it.
The graph disables checkpoints, and each transient LangGraph thread is deleted
on completion. Existing backend tracing/logging and model-provider retention still
follow their settings; in-memory client history does not imply no provider logging.

## Checks And Packaging

```sh
npm test
npm run build
npm run build:icon  # regenerate the checked-in macOS icon, if the mark changes
npm run build:native  # compile the selection library (requires Xcode Command Line Tools)
npx playwright install chromium
npm run test:e2e
npm run package:mac  # local .app bundle in release/
npm run dist:mac     # arm64 and x64 DMG builds in release/
```

UI tests use a mocked preload bridge and do not require model credentials.
The native Electron test uses an actual local SSE server, pauses after the first
token, and asserts partial content is visible before the response completes.
Backend tests include `test_translation_mentor.py` and `test_translator.py`.
OS-level selection capture requires user-granted Accessibility permission; tests
cover same-process native-library identity, capture ordering, failure handling, automatic submit,
and cancellation without granting or changing your macOS privacy permissions.

For distribution outside your own Mac, configure Apple Developer signing and
notarization in electron-builder before shipping. The generated bundle is not
automatically signed/notarized without these credentials.

## Security And Privacy

- Renderer: sandboxed, context-isolated, no Node integration; narrowly scoped
  preload bridge with sender validation. No arbitrary IPC, shell, or filesystem API.
- React Markdown + remark-gfm renders learning content without HTML execution.
  Model-provided images and links are not fetched or activated. Radix supplies
  accessible tooltips; Lucide supplies icons. esbuild bundles SDK dependencies for
  Electron packaging. The open-source-first rule is maintained in `AGENTS.md`.
- All HTTP calls and optional gateway `LANGGRAPH_API_KEY` stay in the main process.
  Remote service addresses require HTTPS; local development may use HTTP.
  Authenticated requests do not follow redirects.
- Text/output is held in memory, not saved to desktop history. It is sent to the
  configured agent service and model provider. Server/model logging and LangSmith
  retention follow the agent service's settings; this is not an offline translator.
- No model keys, Supabase service credentials, or `.env` files are bundled.
- Command+B is an explicit capture-and-translate action: its selected text is sent
  to the service automatically. Selection is not monitored between shortcut presses.
- The blue primary and accent colors match `language-learning-web/src/index.css`.
- `npm run dev:web` is a renderer-only preview. Translation and native controls
  require Electron; the browser preview does not bypass the desktop bridge.

Foundation: [Electron documentation](https://www.electronjs.org/docs/latest/),
[global shortcuts](https://www.electronjs.org/docs/latest/api/global-shortcut), and
[security checklist](https://www.electronjs.org/docs/latest/tutorial/security).
