---
tags:
  - tech
  - writing
  - expression
created: 2026-07-13
---

# High-Quality Expressions

> [!abstract] Purpose
> Sentences worth re-reading — recorded as encountered.

---

## 1. Tracing a Performance Issue — Two Delay Sources

I've now traced the issue. There are two delay sources:

The modal's `useEffect` deliberately defers data fetching one animation frame via `requestAnimationFrame` + `dataFetchEnabled` gating. The intent was "show shell first, then fetch", but in practice it just delays both the column-config fetch and the detail fetch by ~1 frame, with no UX benefit (we already show a `Spin`).

Both `useInitCustomerGroupTable` and `useCustomerGroupTableStore()` subscribe to the whole zustand store (no selector). So when `openDetail()` flips two store fields, the entire `CustomerGroupTable` (toolbar + heavy `ConfigurableTable`) re-renders synchronously before React can paint the modal opening — that's what makes the click→modal transition feel sluggish.

---

## 2. Wasteful Re-fetch on `closeDetail`

> [!quote]
> Right — `closeDetail` unconditionally triggers a list re-fetch, which is wasteful (and visually annoying) when the user just peeked at the details without changing anything.

---

## 3. Folder Structure as Methodology

The folder structure encodes the methodology's core thesis: knowledge should be compiled once, interlinked, and incrementally maintained — not re-derived from scratch on every query. Each folder/file enforces one part of that thesis (immutability of sources, persistent intent, fixed schema, typed pages, navigable catalog, operation history, cross-references). Remove any one of them and the system degrades toward "just a pile of notes" or "just RAG."

---

## 4. Aphorisms

> [!quote]
> I want it orgnized rather than scattered.

> [!quote]
> The LLM is rediscovering knowledge from scratch on every question.

> [!quote]
> Workers stand on scaffolding
