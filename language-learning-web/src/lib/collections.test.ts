import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection, deleteCollection, listCollections, updateCollection } from './collections'

const db = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as Error | null },
  calls: [] as [string, unknown][],
}))

vi.mock('./supabase', () => ({
  supabase: {
    from(table: string) {
      db.calls.push(['from', table])
      const chain = {
        select(columns?: string) { db.calls.push(['select', columns]); return chain },
        order(column: string, options: unknown) { db.calls.push(['order', [column, options]]); return chain },
        or(filter: string) { db.calls.push(['or', filter]); return chain },
        range(start: number, end: number) { db.calls.push(['range', [start, end]]); return Promise.resolve(db.result) },
        insert(payload: unknown) { db.calls.push(['insert', payload]); return chain },
        update(payload: unknown) { db.calls.push(['update', payload]); return chain },
        delete() { db.calls.push(['delete', null]); return chain },
        eq(column: string, value: string) { db.calls.push(['eq', [column, value]]); return chain },
        maybeSingle() { db.calls.push(['maybeSingle', null]); return Promise.resolve(db.result) },
      }
      return chain
    },
  },
}))

const doc = { type: 'doc' as const, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: 'Example' }] }] }
const row = { id: 'entry-id', user_id: 'reader', content_text: 'Example', content_doc: doc, created_at: '2026-01-01', updated_at: '2026-01-01' }

afterEach(() => { db.calls.length = 0; db.result = { data: null, error: null } })

describe('collection persistence', () => {
  it('lists a bounded page in stable newest-first order', async () => {
    db.result.data = [row]
    expect(await listCollections(null, 50)).toEqual([row])
    expect(db.calls).toContainEqual(['from', 'whw_collections'])
    expect(db.calls).toContainEqual(['order', ['created_at', { ascending: false }]])
    expect(db.calls).toContainEqual(['order', ['id', { ascending: false }]])
    expect(db.calls).toContainEqual(['range', [0, 49]])
    db.calls.length = 0
    await listCollections({ created_at: '2026-01-01T12:00:00+00:00', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, 50)
    expect(db.calls).toContainEqual(['or', 'created_at.lt.2026-01-01T12:00:00+00:00,and(created_at.eq.2026-01-01T12:00:00+00:00,id.lt.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa)'])
    expect(db.calls).toContainEqual(['range', [0, 49]])
  })

  it('inserts both text and formatting for the signed-in owner', async () => {
    db.result.data = row
    expect(await createCollection('reader', 'Example', doc)).toEqual(row)
    expect(db.calls).toContainEqual(['insert', { user_id: 'reader', content_text: 'Example', content_doc: doc }])
  })

  it('requires both ownership and a matching row for update and delete', async () => {
    db.result.data = row
    await updateCollection('entry-id', 'reader', 'Example', doc)
    expect(db.calls).toContainEqual(['update', { content_text: 'Example', content_doc: doc }])
    expect(db.calls).toContainEqual(['eq', ['id', 'entry-id']])
    expect(db.calls).toContainEqual(['eq', ['user_id', 'reader']])
    db.calls.length = 0
    await deleteCollection('entry-id', 'reader')
    expect(db.calls).toContainEqual(['delete', null])
    expect(db.calls).toContainEqual(['eq', ['id', 'entry-id']])
    expect(db.calls).toContainEqual(['eq', ['user_id', 'reader']])
  })

  it('reports not-found and server failures instead of claiming success', async () => {
    await expect(updateCollection('missing', 'reader', 'Example', doc)).rejects.toThrow('不存在')
    await expect(deleteCollection('missing', 'reader')).rejects.toThrow('不存在')
    db.result.error = new Error('permission denied')
    await expect(listCollections(null, 50)).rejects.toThrow('permission denied')
    await expect(createCollection('reader', 'Example', doc)).rejects.toThrow('permission denied')
  })
})
