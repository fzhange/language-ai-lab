# Collections Text-Only Rich Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the requested text-only rich-formatting controls and persistent previews to `/collections` without AI, files, or a database migration.

**Architecture:** Extend the strict Tiptap JSON codec, then adapt the existing reusable `SimpleEditor` with official MIT-licensed Tiptap UI primitives for only the supported formatting commands. `CollectionEditor` remains the collection-specific adapter, and `CollectionsPage` renders validated documents as safe React elements. Keep the existing Supabase CRUD/RLS unchanged.

**Tech Stack:** React 19, TypeScript, Tiptap v3, Tailwind CSS v4, Supabase JS, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-12-collections-text-rich-editor-design.md` (extends `docs/superpowers/specs/2026-10-12-pasted-text-collections-design.md`)

## Global Constraints

- Only paragraphs, headings 1–3, bullet/ordered lists, block quotes, alignment left/center/right, bold/italic/underline/strike, safe absolute HTTP(S) links, approved text/background colors, undo/redo; no tables, images, AI, uploads, embeds, or new tables/columns.
- Pasted material enters as `text/plain`, retaining literal `<...>` and newline boundaries. Enter/Shift+Enter add lines; only the Save button persists.
- Keep the `90vw × 85vh` collection dialog and existing pending/cancel/error behavior. Preserve previously saved colored paragraphs and all unrelated working changes in the dirty `main` checkout.
- Validate every untrusted JSON node/mark, attribute, color, alignment, URL, nesting depth and document size before rendering. Only `http:`/`https:` absolute links; render via React nodes, not untrusted HTML. Derive `content_text` from exactly the validated document being saved.
- Do not commit or push without a new explicit user request. Do not run the official CLI with an overwrite flag: inspect generated files/required CSS first and port only needed free UI components so existing files remain intact.

## Review Focus

- A link entered as `javascript:`, protocol-relative URL, or a link with dangerous stored attributes must not become clickable (Tasks 1–3).
- Multiline paste into a list or quote must not create an unsupported node or silently discard text (Task 2).
- Unknown nested nodes, excessive depth, or oversized JSON must show an item-level error without freezing the list (Tasks 1, 3).
- Undo/redo of a link or mark and reopened older colored documents must preserve text and supported formatting (Tasks 2–3).
- Empty text represented only by formatting blocks must not be saved; failed mutation must retain the draft (Tasks 1, 3).

---

### Task 1: Supported document contract

**Files:**
- Modify: `src/lib/collection-document.ts`, `src/lib/collection-document.test.ts`

**Interfaces:** Retain exports `CollectionDoc`, `CollectionMark`, `parseCollectionDoc(value: unknown): CollectionDoc | null`, `collectionPlainText(doc: CollectionDoc): string`, and the color palettes. Extend the typed node/mark unions to the spec's shapes; define and export `parseSafeCollectionUrl(value: unknown): string | null` for both editing and preview. `parseCollectionDoc` returns null for unsupported structures rather than deleting nodes/marks.

- [ ] **Step 1: Add failing tests** with literal fixtures for legacy paragraphs, heading levels 1–3, aligned paragraphs/headings, nested bullet/ordered lists, quote, links and inline marks; assert expected line-separated `content_text` (including empty blocks and list items). Reject unsupported node/mark/attribute, `javascript:`/`data:`/`//...` links, malformed depth/oversized documents, and whitespace-only rich structures. Define explicit max depth/node/text budgets in this file and test values at the boundary.
- [ ] **Step 2: Run `npm test -- src/lib/collection-document.test.ts`; expect FAIL** on the new node/URL cases, not a test harness error.
- [ ] **Step 3: Implement the type extensions, recursive allowlisted validator, safe URL parser and readable text extraction** in `src/lib/collection-document.ts`; preserve the old color choices for existing JSON. Keep recursion bounded, reject unknown attrs and detect text-empty docs through `collectionPlainText(doc).trim()` at the save boundary.
- [ ] **Step 4: Run `npm test -- src/lib/collection-document.test.ts`; expect PASS.** Run `npm test` for existing behavior; record any pre-existing failure separately.

### Task 2: Reusable rich-text-only editor

**Files:**
- Modify: `src/components/ui/simple-editor.tsx`, `src/components/ui/simple-editor.test.tsx`, `src/components/CollectionEditor.tsx`, `src/components/CollectionEditor.test.tsx`, `package.json`, `package-lock.json`

**Interfaces:** `SimpleEditor` retains `{ label, initialContent, onChange, textColors, backgroundColors, placeholder, disabled }`; `CollectionEditor` retains `{ initialDoc, onChange, disabled }`. It emits Tiptap JSON; `CollectionEditor` parses/forwards only documents accepted by Task 1. New document controls call Task 1's `parseSafeCollectionUrl` before setting links.

- [ ] **Step 1: Write failing editor tests** asserting controls actually apply headings, lists, quote, bold/italic/underline/strike, safe link, alignment and color, undo/redo; link input rejects unsafe URLs; paste `<p>x</p>\ny` as literal plain text; Enter/Shift+Enter add paragraphs and never save. Assert previously saved colored text is editable and a disabled editor cannot change it. Test that generated JSON passes Task 1's parser.
- [ ] **Step 2: Run `npm test -- src/components/ui/simple-editor.test.tsx src/components/CollectionEditor.test.tsx`; expect FAIL** only on new functionality.
- [ ] **Step 3: Add only required official open-source Tiptap extensions/UI pieces**, after verifying source/dependency/license and CSS integration; adapt rather than overwrite existing components. Implement controls and link input in `simple-editor.tsx` and the collection-specific boundary in `CollectionEditor.tsx`; keep selected text through toolbar clicks and preserve plain-text-only paste, including inside lists/quotes. Do not install any Tiptap Pro/AI SDK or enable image/table extensions.
- [ ] **Step 4: Run both targeted test files and `npm test`; expect PASS.** If JSDOM cannot reliably model selection, retain command-level tests and record real-browser selection checks as pending until run.

### Task 3: Safe rich collection previews and existing CRUD

**Files:**
- Modify: `src/pages/CollectionsPage.tsx`, `src/pages/CollectionsPage.test.tsx`

**Interfaces:** `Preview({ doc }: { doc: CollectionDoc })` renders only validated Task 1 node/mark unions with React elements; `CollectionsPage` still calls `createCollection`/`updateCollection` with `content_text = collectionPlainText(doc)` and unchanged `content_doc`.

- [ ] **Step 1: Write failing page tests** for heading/quote/list/link/alignment/inline marks in previews; old colored paragraphs still render; unsafe/malformed/deep JSON shows an item error rather than a live link/HTML. Assert create/edit/save and reload preserve rich content, empty rich documents keep Save disabled, error leaves editor open, and the dialog remains `90vw × 85vh` with Enter/Shift+Enter newline guidance and Save button.
- [ ] **Step 2: Run `npm test -- src/pages/CollectionsPage.test.tsx`; expect FAIL** on new preview/format assertions.
- [ ] **Step 3: Extend `Preview` with narrowly typed safe React elements** and accessible readable formatting; use `parseSafeCollectionUrl` for hrefs and safe `rel` for new-tab targets, no `dangerouslySetInnerHTML` or invalid document fallback. Keep other collection behavior and Supabase calls unchanged.
- [ ] **Step 4: Run `npm test`, `npm run build`, `npm run lint`, and `git diff --check`; expect 0 test/build errors.** Record the baseline lint warnings if still present; verify paste, selection, Save/Cancel and links in a browser with an available test account, or mark those checks skipped. Review the full diff for unintended changes and remain uncommitted.

## Handoff

Get the user's approval of this plan and execution method before changing product code. The already-uncommitted collections work stays in place; no commits, database deployment, or remote push are authorized by this plan.
