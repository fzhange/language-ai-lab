import type { CollectionDoc } from './collection-document'
import { supabase, type CollectionRow } from './supabase'

function client() {
  if (!supabase) throw new Error('未配置 Supabase，无法管理收藏。')
  return supabase
}

function requireRow<T>(data: T | null, error: Error | null): T {
  if (error) throw error
  if (!data) throw new Error('收藏不存在或无权操作。')
  return data
}

export type CollectionCursor = Pick<CollectionRow, 'created_at' | 'id'>

export async function listCollections(before: CollectionCursor | null, size: number): Promise<CollectionRow[]> {
  let query = client().from('whw_collections')
    .select('id,user_id,content_text,content_doc,created_at,updated_at')
  if (before) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(before.created_at) ||
      !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(before.id)) {
      throw new Error('收藏分页游标无效。')
    }
    query = query.or(`created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`)
  }
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, size - 1)
  if (error) throw error
  return (data ?? []) as CollectionRow[]
}

export async function createCollection(userId: string, contentText: string, contentDoc: CollectionDoc): Promise<CollectionRow> {
  const { data, error } = await client().from('whw_collections')
    .insert({ user_id: userId, content_text: contentText, content_doc: contentDoc })
    .select('id,user_id,content_text,content_doc,created_at,updated_at').maybeSingle()
  return requireRow(data as CollectionRow | null, error)
}

export async function updateCollection(id: string, userId: string, contentText: string, contentDoc: CollectionDoc): Promise<CollectionRow> {
  const { data, error } = await client().from('whw_collections')
    .update({ content_text: contentText, content_doc: contentDoc })
    .eq('id', id).eq('user_id', userId)
    .select('id,user_id,content_text,content_doc,created_at,updated_at').maybeSingle()
  return requireRow(data as CollectionRow | null, error)
}

export async function deleteCollection(id: string, userId: string): Promise<void> {
  const { data, error } = await client().from('whw_collections')
    .delete().eq('id', id).eq('user_id', userId)
    .select('id').maybeSingle()
  requireRow(data, error)
}
