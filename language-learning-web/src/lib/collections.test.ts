import { afterEach, describe, expect, it, vi } from 'vitest'

import { createCollection, deleteCollection, listCollectionArchive, listCollectionsForWeek, saveCollectionWeekSummary, updateCollection } from './collections'

const db = vi.hoisted(() => ({
  results: [] as { data?: unknown; error?: Error | null; count?: number | null }[],
  calls: [] as [string, unknown][],
}))

vi.mock('./supabase', () => ({
  supabase: {
    from(table: string) {
      db.calls.push(['from', table])
      let head = false
      const result = () => Promise.resolve({ data: null, error: null, count: null, ...db.results.shift() })
      const chain = {
        select(columns?: string, options?: { head?: boolean }) { head = Boolean(options?.head); db.calls.push(['select', [columns, options]]); return chain },
        order(column: string, options: unknown) { db.calls.push(['order', [column, options]]); return chain },
        like(column: string, value: string) { db.calls.push(['like', [column, value]]); return chain },
        range(start: number, end: number) { db.calls.push(['range', [start, end]]); return result() },
        insert(payload: unknown) { db.calls.push(['insert', payload]); return chain },
        upsert(payload: unknown, options: unknown) { db.calls.push(['upsert', [payload, options]]); return chain },
        update(payload: unknown) { db.calls.push(['update', payload]); return chain },
        delete() { db.calls.push(['delete', null]); return chain },
        eq(column: string, value: string) { db.calls.push(['eq', [column, value]]); return chain },
        is(column: string, value: null) { db.calls.push(['is', [column, value]]); return head ? result() : chain },
        maybeSingle() { db.calls.push(['maybeSingle', null]); return result() },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) { return result().then(resolve, reject) },
      }
      return chain
    },
  },
}))

const doc = { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Example' }] }] }
const row = { id: 'entry-id', user_id: 'reader', week_key: '2026M10W3', content_text: 'Example', content_doc: doc, created_at: '2026-10-15T04:00:00Z', updated_at: '2026-10-15T04:00:00Z' }

afterEach(() => { db.calls.length = 0; db.results.length = 0 })

describe('collection persistence', () => {
  it('loads week summaries, counts, unassigned count and selected articles', async () => {
    db.results.push(
      { data: [{ user_id: 'reader', week_key: '2026M10W3', summary: 'Learned agents', created_at: '', updated_at: '' }] },
      { data: [{ week_key: '2026M10W3' }, { week_key: '2026M10W3' }] },
      { count: 2 },
    )
    await expect(listCollectionArchive(2026, 10)).resolves.toEqual({ counts: { '2026M10W3': 2 }, summaries: { '2026M10W3': 'Learned agents' }, unassignedCount: 2 })
    expect(db.calls).toContainEqual(['like', ['week_key', '2026M10W%']])

    db.results.push({ data: [row] })
    await expect(listCollectionsForWeek('2026M10W3')).resolves.toEqual([row])
    expect(db.calls).toContainEqual(['eq', ['week_key', '2026M10W3']])
    expect(db.calls).toContainEqual(['order', ['created_at', { ascending: false }]])
  })

  it('creates the category before inserting an article into it', async () => {
    db.results.push({}, { data: row })
    await expect(createCollection('reader', 'Example', doc, '2026M10W3')).resolves.toEqual(row)
    expect(db.calls).toContainEqual(['upsert', [{ user_id: 'reader', week_key: '2026M10W3' }, { onConflict: 'user_id,week_key', ignoreDuplicates: true }]])
    expect(db.calls).toContainEqual(['insert', { user_id: 'reader', week_key: '2026M10W3', content_text: 'Example', content_doc: doc }])
  })

  it('moves an article, saves a summary, and preserves ownership checks', async () => {
    db.results.push({}, { data: row })
    await updateCollection('entry-id', 'reader', 'Example', doc, '2026M10W3')
    expect(db.calls).toContainEqual(['update', { week_key: '2026M10W3', content_text: 'Example', content_doc: doc }])
    expect(db.calls).toContainEqual(['eq', ['user_id', 'reader']])

    db.results.push({ data: { user_id: 'reader', week_key: '2026M10W3', summary: 'Summary', created_at: '', updated_at: '' } })
    await expect(saveCollectionWeekSummary('reader', '2026M10W3', 'Summary')).resolves.toMatchObject({ summary: 'Summary' })

    db.results.push({ data: { id: 'entry-id' } })
    await deleteCollection('entry-id', 'reader')
    expect(db.calls).toContainEqual(['delete', null])
  })

  it('rejects invalid week keys and reports missing rows', async () => {
    await expect(listCollectionsForWeek('bad-week')).rejects.toThrow('周分类无效')
    await expect(createCollection('reader', 'Example', doc, '2026M10W8')).rejects.toThrow('周分类无效')
    db.results.push({ data: null })
    await expect(updateCollection('missing', 'reader', 'Example', doc, null)).rejects.toThrow('不存在')
  })

  it('keeps legacy articles visible before the week migration is deployed', async () => {
    const missingColumn = new Error('column whw_collections.week_key does not exist')
    db.results.push({ error: missingColumn }, { error: missingColumn }, { error: missingColumn }, { data: [{ ...row, week_key: undefined }] })
    const archive = await listCollectionArchive(2026, 10)
    expect(archive.counts).toEqual({ '2026M10W3': 1 })
    expect(archive.summaries).toEqual({})

    db.results.push({ error: missingColumn }, { data: [{ ...row, week_key: undefined }] })
    await expect(listCollectionsForWeek('2026M10W3')).resolves.toEqual([{ ...row, week_key: '2026M10W3' }])
    expect(db.calls).toContainEqual(['select', ['id,user_id,content_text,content_doc,created_at,updated_at', undefined]])
  })

  it('creates and updates article content through the legacy schema when week tables are absent', async () => {
    const missingTable = new Error("Could not find the table 'public.whw_collection_weeks' in the schema cache")
    const legacyRow = { id: row.id, user_id: row.user_id, content_text: row.content_text, content_doc: row.content_doc, created_at: row.created_at, updated_at: row.updated_at }

    db.results.push({ error: missingTable }, { data: legacyRow })
    await expect(createCollection('reader', 'Example', doc, '2026M10W2')).resolves.toEqual(row)
    expect(db.calls).toContainEqual(['insert', { user_id: 'reader', content_text: 'Example', content_doc: doc }])

    db.results.push({ error: missingTable }, { data: legacyRow })
    await expect(updateCollection('entry-id', 'reader', 'Example', doc, '2026M10W2')).resolves.toEqual(row)
    expect(db.calls).toContainEqual(['update', { content_text: 'Example', content_doc: doc }])
  })
})
