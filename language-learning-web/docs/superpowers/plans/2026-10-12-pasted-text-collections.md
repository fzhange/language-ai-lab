# Pasted-text Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let signed-in users collect pasted text, color selected words, and manage their own items on a dedicated page.

**Architecture:** A separate RLS-protected Supabase table stores both readable text and Tiptap JSON. A restricted document codec/editor enforces plain-text paste and safe inline color rendering. The new page calls a small Supabase data module; existing highlights, notes, and tutor stay unchanged.

**Tech Stack:** React 19, TypeScript, Tiptap React + text-style/color + multicolor highlight extensions, Supabase JS, Postgres RLS, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-12-pasted-text-collections-design.md`

## Global Constraints

- Only text, paragraphs/line breaks, selected-word foreground and background colors; no source URLs, files, title, arbitrary HTML/CSS, or AI integration.
- `content_text` is a nonempty readable `TEXT` column; `content_doc` is structured `JSONB`. Generate both from the same editor state on every write.
- Mutations require a signed-in user; RLS enforces owner isolation even if a client submits a different `user_id`.
- Preserve existing user modifications (notably `src/App.tsx`) and do not commit unless explicitly requested.
- Database deployment requires confirming the Supabase project; no secret in repo and no fake success if deployment is unavailable.

## Review Focus

- Whitespace-only or rich HTML clipboard paste: keep line breaks, strip HTML, and refuse empty save (Tasks 1, 3, 4).
- Malformed document or unsupported color in an otherwise valid database row: show an item error, not executable markup or a broken page (Tasks 1, 4).
- Clicking a toolbar color while text is selected: selection remains active and only the selected text is formatted (Task 3).
- A save failure or double click during saving: retain edits and do not submit twice (Task 4).
- A stale/deleted item or a different owner's ID: mutations must not imply success when no owned row changed (Tasks 2, 4).

---

### Task 1: Restricted collection document format

**Files:**
- Create: `src/lib/collection-document.ts`, `src/lib/collection-document.test.ts`
- Modify: `package.json`, `package-lock.json` (install compatible Tiptap editor, document/paragraph/text or restricted StarterKit, text-style/color, highlight packages)

**Interfaces:** Export `CollectionDoc` (Tiptap document with `doc`, `paragraph`, `text`/line break nodes and only `textStyle.color` or `highlight.color` marks); `parseCollectionDoc(value: unknown): CollectionDoc | null`; `collectionPlainText(doc: CollectionDoc): string`; `COLLECTION_TEXT_COLORS`, `COLLECTION_HIGHLIGHT_COLORS` as fixed palettes. Use exactly the same extensions in editor and read-only preview; don't add an HTML rendering path.

- [ ] **Step 1: Write failing codec tests.** Valid colored spans and multiline text yield the expected plain string; script-like input remains text. Reject unexpected nodes/marks, bad attribute shapes, malformed trees, and colors not in the approved palettes; allow an empty draft document but let UI/DB reject empty saving.
- [ ] **Step 2: Run `npm test -- src/lib/collection-document.test.ts`; expect FAIL** because the module does not exist.
- [ ] **Step 3: Add dependencies and implement the narrow document codec/palettes.** Do not use untrusted stored JSON as HTML or as unsanitized inline style; invalid persisted rows are marked unreadable rather than silently converted.
- [ ] **Step 4: Run `npm test -- src/lib/collection-document.test.ts`; expect PASS.**

### Task 2: Private collections table and CRUD boundary

**Files:**
- Create: `supabase/whw_collections.sql` (versioned SQL to apply once to the existing Supabase project)
- Create: `src/lib/collections.ts`, `src/lib/collections.test.ts`
- Modify: `src/lib/supabase.ts` (add `CollectionRow` type without changing highlights)

**Interfaces:** `CollectionRow = { id: string; user_id: string; content_text: string; content_doc: unknown; created_at: string; updated_at: string }`; `listCollections(start: number, size: number): Promise<CollectionRow[]>`; `createCollection(userId: string, contentText: string, contentDoc: CollectionDoc): Promise<CollectionRow>`; `updateCollection(id: string, userId: string, contentText: string, contentDoc: CollectionDoc): Promise<CollectionRow>`; `deleteCollection(id: string, userId: string): Promise<void>`. `CollectionDoc` comes from Task 1; avoid duplicating that definition.

- [ ] **Step 1: Write failing data-module tests.** Mock Supabase and assert range/order `(created_at DESC, id DESC)`, create sends both columns and `user_id`, update/delete filter by both `id` and `user_id`, a returned zero-row mutation raises a not-found error, and Supabase failure propagates without fabricating rows.
- [ ] **Step 2: Run `npm test -- src/lib/collections.test.ts`; confirm failure** because `collections.ts` does not exist.
- [ ] **Step 3: Add SQL.** Define `public.whw_collections` UUID PK, authenticated owner FK, non-whitespace `content_text`, object `content_doc`, default timestamps, an owner/date/id index, and an update-timestamp trigger. Enable RLS; create SELECT, INSERT, UPDATE, DELETE own-row policies (UPDATE has both USING and WITH CHECK); grant authenticated CRUD only and no anon access. Make the migration reviewable before applying it; use no hardcoded credentials.
- [ ] **Step 4: Implement data boundary and type.** Use existing `supabase` client; insert/update/delete with `.select()` or equivalent result check so an RLS-filtered or stale ID cannot appear successful. Request bounded pages via `.range(start, start + size - 1)`. Return actual errors, not transformed backend data.
- [ ] **Step 5: Run `npm test -- src/lib/collections.test.ts`; expect PASS.** For live validation, inspect the intended Supabase project first, then apply SQL if authorized and verify with two test identities: each can CRUD own rows and cannot select/update/delete the other's row. If unavailable, record database validation/deployment as pending.

### Task 3: Colored-text editor

**Files:**
- Create: `src/components/CollectionEditor.tsx`, `src/components/CollectionEditor.test.tsx`

**Interfaces:** `CollectionEditor({ initialDoc, onChange }: { initialDoc: CollectionDoc | null; onChange: (doc: CollectionDoc, plainText: string) => void })`. The parent owns save/cancel; the editor owns selection, palette controls and paste handling.

- [ ] **Step 1: Write failing editor tests.** Type/paste multiline text and assert `onChange` receives plain text with line breaks; paste `<script>alert(1)</script>` as visible text; select part of a sentence, apply text/background color and clear only that span; toolbar click must not collapse the intended selection.
- [ ] **Step 2: Run `npm test -- src/components/CollectionEditor.test.tsx`; expect FAIL** because the editor does not exist.
- [ ] **Step 3: Implement Tiptap with the Task 1 restricted extensions.** Use plain-text-only clipboard handling, preserve line breaks, keep the selected range on toolbar actions (focus chain or `onMouseDown` prevention), accessible labeled controls and fixed palettes. Expose only foreground color, background highlight, and clear formatting.
- [ ] **Step 4: Run `npm test -- src/components/CollectionEditor.test.tsx`; expect PASS.** If JSDOM cannot model browser selections/paste accurately, keep codec/unit tests and verify these interactions in a real browser; do not call an unrun interaction test passing.

### Task 4: My Collections page and navigation

**Files:**
- Create: `src/pages/CollectionsPage.tsx`, `src/pages/CollectionsPage.test.tsx`
- Modify: `src/App.tsx` (targeted route and nav edit; preserve existing unrelated text sizing changes)

**Interfaces:** Use Task 2's CRUD functions and `CollectionRow`; Task 1's parser/plain-text encoder; Task 3's `CollectionEditor`. The page handles list pagination, selection, edit/save/delete state and errors; `App` adds route `/collections` with label `我的收藏` consistent with existing Chinese navigation.

- [ ] **Step 1: Write failing page tests.** Mock data boundary and editor: no-config/sign-in states, empty/loading/error list, paginated newest-first load, create/edit save both text and doc, blank save disabled, delete confirmation/cancel, mutation failure retains draft, double submit triggers one request, invalid stored document shows an item error, and unexpected stale ID error is visible. Test that `/collections` nav opens the page without changing `/notes` or `/highlights`.
- [ ] **Step 2: Run `npm test -- src/pages/CollectionsPage.test.tsx`; expect FAIL** because the page/route do not exist.
- [ ] **Step 3: Implement responsive list and edit flow.** Derive text from editor doc at save; avoid treating `content_text` from server as editable formatting. Paginate with a stable page size (50), refresh list after success, confirm destructive action, prevent duplicate requests, and keep the draft on failure. Adjust mobile nav only as needed to fit the additional item.
- [ ] **Step 4: Run `npm test -- src/pages/CollectionsPage.test.tsx` and `npm test`; expect PASS.** Run `npm run build` and `npm run lint`; fix only introduced failures and report pre-existing issues separately. Validate create/edit/reload/delete/color selection in a real browser when running services and test credentials are available, otherwise report browser/database checks skipped.

## Handoff

Before claiming completion, check the source and doc decisions against the spec, confirm user-owned data isolation in an authorized test database if available, and list any unapplied migration or skipped check. No git commit without an explicit user request.
