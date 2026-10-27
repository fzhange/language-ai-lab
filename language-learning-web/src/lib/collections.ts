import type { CollectionDoc } from './collection-document'
import { collectionWeekForDate, isCollectionWeekKey } from './collection-weeks'
import { supabase, type CollectionRow, type CollectionWeekRow } from './supabase'

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
export interface CollectionArchive {
  counts: Record<string, number>
  summaries: Record<string, string>
  unassignedCount: number
}

const COLLECTION_COLUMNS = 'id,user_id,week_key,content_text,content_doc,created_at,updated_at'
const LEGACY_COLLECTION_COLUMNS = 'id,user_id,content_text,content_doc,created_at,updated_at'

function isMissingWeekSchema(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : ''
  return /(?:whw_collections\.week_key|whw_collection_weeks).*(?:does not exist|schema cache)|(?:does not exist|schema cache).*(?:whw_collections\.week_key|whw_collection_weeks)/i.test(message)
}

function legacyWeekKey(row: Pick<CollectionRow, 'created_at'>): string {
  const instant = new Date(row.created_at)
  if (Number.isNaN(instant.getTime())) return ''
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(instant).map((part) => [part.type, part.value]))
  const shanghai = new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day))
  return collectionWeekForDate(shanghai).key
}

async function listLegacyCollections(): Promise<CollectionRow[]> {
  const { data, error } = await client().from('whw_collections')
    .select(LEGACY_COLLECTION_COLUMNS)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, 9999)
  if (error) throw error
  return ((data ?? []) as Omit<CollectionRow, 'week_key'>[]).map((row) => ({ ...row, week_key: legacyWeekKey(row) || null }))
}

function legacyCollectionRow(row: Omit<CollectionRow, 'week_key'>): CollectionRow {
  return { ...row, week_key: legacyWeekKey(row) || null }
}

function monthPrefix(year: number, month: number): string {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('收藏月份无效。')
  }
  return `${year}M${month}W%`
}

async function ensureCollectionWeek(userId: string, weekKey: string | null): Promise<void> {
  if (weekKey === null) return
  if (!isCollectionWeekKey(weekKey)) throw new Error('收藏周分类无效。')
  const { error } = await client().from('whw_collection_weeks')
    .upsert({ user_id: userId, week_key: weekKey }, { onConflict: 'user_id,week_key', ignoreDuplicates: true })
  if (error) throw error
}

export async function listCollectionArchive(year: number, month: number): Promise<CollectionArchive> {
  const prefix = monthPrefix(year, month)
  try {
    const [weekResult, collectionResult, unassignedResult] = await Promise.all([
      client().from('whw_collection_weeks')
        .select('user_id,week_key,summary,created_at,updated_at')
        .like('week_key', prefix)
        .range(0, 99),
      client().from('whw_collections')
        .select('week_key')
        .like('week_key', prefix)
        .range(0, 9999),
      client().from('whw_collections')
        .select('id', { count: 'exact', head: true })
        .is('week_key', null),
    ])
    if (weekResult.error) throw weekResult.error
    if (collectionResult.error) throw collectionResult.error
    if (unassignedResult.error) throw unassignedResult.error
    const summaries: Record<string, string> = {}
    for (const week of (weekResult.data ?? []) as CollectionWeekRow[]) summaries[week.week_key] = week.summary
    const counts: Record<string, number> = {}
    for (const row of (collectionResult.data ?? []) as Pick<CollectionRow, 'week_key'>[]) {
      if (row.week_key) counts[row.week_key] = (counts[row.week_key] ?? 0) + 1
    }
    return { counts, summaries, unassignedCount: unassignedResult.count ?? 0 }
  } catch (cause) {
    if (!isMissingWeekSchema(cause)) throw cause
    const counts: Record<string, number> = {}
    for (const row of await listLegacyCollections()) {
      if (row.week_key?.startsWith(`${year}M${month}W`)) counts[row.week_key] = (counts[row.week_key] ?? 0) + 1
    }
    return { counts, summaries: {}, unassignedCount: 0 }
  }
}

export async function listCollectionsForPeriod(year: number, month?: number): Promise<CollectionRow[]> {
  if (!Number.isInteger(year) || year < 1 || year > 9999) throw new Error('收藏年份无效。')
  const prefix = month === undefined ? `${year}M%` : monthPrefix(year, month)
  try {
    const rows: CollectionRow[] = []
    const pageSize = 1000
    for (let start = 0; ; start += pageSize) {
      const { data, error } = await client().from('whw_collections')
        .select(COLLECTION_COLUMNS)
        .like('week_key', prefix)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(start, start + pageSize - 1)
      if (error) throw error
      const page = (data ?? []) as CollectionRow[]
      rows.push(...page)
      if (page.length < pageSize) return rows
    }
  } catch (cause) {
    if (!isMissingWeekSchema(cause)) throw cause
    const prefixWithoutWildcard = prefix.slice(0, -1)
    return (await listLegacyCollections()).filter((row) => row.week_key?.startsWith(prefixWithoutWildcard))
  }
}

export async function listCollectionsForWeek(weekKey: string | null, size = 100): Promise<CollectionRow[]> {
  if (weekKey !== null && !isCollectionWeekKey(weekKey)) throw new Error('收藏周分类无效。')
  try {
    let query = client().from('whw_collections').select(COLLECTION_COLUMNS)
    query = weekKey === null ? query.is('week_key', null) : query.eq('week_key', weekKey)
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(0, size - 1)
    if (error) throw error
    return (data ?? []) as CollectionRow[]
  } catch (cause) {
    if (!isMissingWeekSchema(cause)) throw cause
    const rows = await listLegacyCollections()
    return rows.filter((row) => row.week_key === weekKey).slice(0, size)
  }
}

export async function listCollections(before: CollectionCursor | null, size: number): Promise<CollectionRow[]> {
  let query = client().from('whw_collections')
    .select(COLLECTION_COLUMNS)
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

export async function createCollection(userId: string, contentText: string, contentDoc: CollectionDoc, weekKey: string | null): Promise<CollectionRow> {
  try {
    await ensureCollectionWeek(userId, weekKey)
    const { data, error } = await client().from('whw_collections')
      .insert({ user_id: userId, week_key: weekKey, content_text: contentText, content_doc: contentDoc })
      .select(COLLECTION_COLUMNS).maybeSingle()
    return requireRow(data as CollectionRow | null, error)
  } catch (cause) {
    if (!isMissingWeekSchema(cause)) throw cause
    const { data, error } = await client().from('whw_collections')
      .insert({ user_id: userId, content_text: contentText, content_doc: contentDoc })
      .select(LEGACY_COLLECTION_COLUMNS).maybeSingle()
    return legacyCollectionRow(requireRow(data as Omit<CollectionRow, 'week_key'> | null, error))
  }
}

export async function updateCollection(id: string, userId: string, contentText: string, contentDoc: CollectionDoc, weekKey: string | null): Promise<CollectionRow> {
  try {
    await ensureCollectionWeek(userId, weekKey)
    const { data, error } = await client().from('whw_collections')
      .update({ week_key: weekKey, content_text: contentText, content_doc: contentDoc })
      .eq('id', id).eq('user_id', userId)
      .select(COLLECTION_COLUMNS).maybeSingle()
    return requireRow(data as CollectionRow | null, error)
  } catch (cause) {
    if (!isMissingWeekSchema(cause)) throw cause
    const { data, error } = await client().from('whw_collections')
      .update({ content_text: contentText, content_doc: contentDoc })
      .eq('id', id).eq('user_id', userId)
      .select(LEGACY_COLLECTION_COLUMNS).maybeSingle()
    return legacyCollectionRow(requireRow(data as Omit<CollectionRow, 'week_key'> | null, error))
  }
}

export async function saveCollectionWeekSummary(userId: string, weekKey: string, summary: string): Promise<CollectionWeekRow> {
  if (!isCollectionWeekKey(weekKey)) throw new Error('收藏周分类无效。')
  const { data, error } = await client().from('whw_collection_weeks')
    .upsert({ user_id: userId, week_key: weekKey, summary }, { onConflict: 'user_id,week_key' })
    .select('user_id,week_key,summary,created_at,updated_at').maybeSingle()
  if (isMissingWeekSchema(error)) throw new Error('周分类数据库迁移尚未部署，暂时无法保存本周总结。文章内容仍可正常保存。')
  return requireRow(data as CollectionWeekRow | null, error)
}

export async function deleteCollection(id: string, userId: string): Promise<void> {
  const { data, error } = await client().from('whw_collections')
    .delete().eq('id', id).eq('user_id', userId)
    .select('id').maybeSingle()
  requireRow(data, error)
}
