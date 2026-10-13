# Collections text-only rich editor: design

## Intent and boundaries

Give `/collections` the text-based editing experience the user identified in Tiptap's Agent Editor, **without AI**. Users continue collecting pasted material and formatting it afterward. Preserve every existing collection and the existing CRUD/auth flow. This spec extends `2026-10-12-pasted-text-collections-design.md` only where it narrows the original paragraph-and-color editing restrictions; it does not add sources, files, images, tables, AI, collaboration, or new collection types.

The first release supports paragraphs, headings (levels 1–3), bullet and numbered lists, block quotes, text alignment (left/center/right), bold, italic, underline, strikethrough, safe web links, approved foreground colors, approved background highlights, and undo/redo. Do not display a control for a feature the editor cannot save and preview. No image or file uploads, tables, code execution/embeds, task lists, or AI tools.

## Choice of editor UI

Adapt the installable, MIT-licensed official Tiptap Simple Editor template/components (not the hosted Agent Editor demo, which is not a drop-in project component) to a reusable text-only editor module. Retain the current shared editor boundary in `src/components/ui/simple-editor.tsx`; the collection-specific adapter in `src/components/CollectionEditor.tsx` owns the document/palette contract. Use Tiptap extensions only for the enabled nodes/marks. Keep the current modal at **90vw × 85vh** with an independently scrollable document, accessible toolbar labels and focus, and visible save/cancel controls. Rich formatting commands operate on the current selection and show active state. The editor appearance should remain consistent with the existing web app; no brand-matching claim about the hosted Agent Editor screenshot is implied.

Both Enter and Shift+Enter create a new line/paragraph in the editable document; neither submits. Only the Save button persists. Cancel/close retains the existing unsaved-change confirmation; failed saves leave the editor and draft open; pending saves block duplicate submission and edits.

## Data and trusted boundary

Reuse `public.whw_collections` unchanged: `content_text TEXT` is the readable text and `content_doc JSONB` is a Tiptap document. Derive both from the **same validated editor document** on save; use the resulting plain text for blank-content checks and later tutor integration. No SQL migration or change to `whw_highlights` is necessary for this editor upgrade. Existing paragraph documents and old color marks must load and render without conversion or loss.

Expand the strict collection-document validator to a recursive allowlist for the exact supported Tiptap node/mark shapes, heading levels, alignment values, list nesting, colors, and link attributes. Bound recursion/document size to prevent pathological stored JSON from freezing the client. Reject unknown nodes/marks/attributes, malformed nesting and unsafe URLs; never silently discard unsupported formatting then overwrite a collection. Validate link input before insertion and saved link attributes before rendering. Allow only `https:` and `http:` absolute URLs; exclude `javascript:`, `data:`, protocol-relative, and other schemes. Render validated structure using safe React/Tiptap nodes, not untrusted `dangerouslySetInnerHTML`; open links safely (`rel="noopener noreferrer"` when opening a new tab). Bad records display an item-level error without exposing or modifying their content.

Paste **text/plain only**, including when the clipboard also offers HTML. Insert literal text nodes (never parse the pasted string as HTML) and preserve newline boundaries; pasted formatting and links do not carry over. A user can apply supported rich formatting after paste. Unsupported drops/embeds are ignored rather than creating unsavable content.

## Preview and UX

Upgrade collection cards to render every allowed node/mark: headings, paragraphs, nested lists, quotes, alignment, inline styles and safe links. A reloaded edited collection must look consistent with the editor and remain editable. Keep the current empty state, pagination, user-scoped RLS, and CRUD/confirmation behavior. A collection saved under the previous text-and-color-only editor remains unchanged unless the user edits it.

## Verification

- Paste single- and multi-line HTML-looking text as literal plain text; confirm no HTML is executed or inherited from the source.
- Format supported features, save and reload; verify `content_text` stays readable, `content_doc` retains marks/structure, preview and reopening agree.
- Open pre-existing colored paragraph documents and verify they still render/edit/save; reject unsafe links and malformed/oversized nested JSON without damaging other items.
- Test Enter/Shift+Enter, disabled and pending states, Save/Cancel/unsaved-change flows and responsive modal layout.
- Run targeted component/codec/page tests, then full tests, build, and lint. Check keyboard, selection, paste, and link behavior in a real browser when feasible. No claim of database migration or two-user RLS testing is implied by frontend unit tests; report any skipped live validation explicitly.
