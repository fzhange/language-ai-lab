// 存储层：本地缓存（chrome.storage.local）+ Supabase 云端同步。
// - 读写都先走本地缓存，保证离线/未登录也可用；
// - 本地变更即时推送云端（upsert + 软删除）；
// - 通过 updated_at 增量拉取其他设备的变更并合并进缓存。
import type { HighlightItem } from './types';
import {
  upsertHighlights,
  softDeleteHighlights,
  fetchChanges,
  purgeTombstones,
  rowToItem,
  type HighlightRow
} from './supabase';

export interface StoredPage {
  url: string;
  title: string;
  highlights: HighlightItem[];
  updatedAt: number;
}

export interface PageMeta {
  url: string;
  title: string;
  count: number;
  updatedAt: number;
}

const PAGE_PREFIX = 'whw:v2:page:';
const LAST_PULL_KEY = 'whw:v2:lastPull';
const TOMBSTONE_KEY = 'whw:v2:tombstones';
const PURGE_AFTER_DAYS = 7;

function hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function pageKey(url: string): string {
  return PAGE_PREFIX + hash(url);
}

/* ----------------------- 本地删除清单（防止离线删除被复活） ----------------------- */
interface LocalTombstone {
  id: string;
  at: number;
}

async function getTombstones(): Promise<LocalTombstone[]> {
  const r = await chrome.storage.local.get(TOMBSTONE_KEY);
  return (r[TOMBSTONE_KEY] as LocalTombstone[]) || [];
}

async function addTombstones(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const list = await getTombstones();
  const existing = new Set(list.map((t) => t.id));
  const now = Date.now();
  for (const id of ids) {
    if (!existing.has(id)) list.push({ id, at: now });
  }
  await chrome.storage.local.set({ [TOMBSTONE_KEY]: list });
}

async function removeTombstones(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const set = new Set(ids);
  const list = await getTombstones();
  await chrome.storage.local.set({ [TOMBSTONE_KEY]: list.filter((t) => !set.has(t.id)) });
}

/* ----------------------- 读取 ----------------------- */
// 同页同文本去重：历史 Bug 可能留下同页双份（同文本在本架构下都锚定到第一处，
// 双份无意义）。保留内容更全的一条，笔记/心得互补合并，副本登记墓碑并云端软删。
function normExact(s: string): string {
  return (s || '').replace(/\s+/g, ' ').trim();
}

async function dedupePageItems(url: string, page: StoredPage): Promise<HighlightItem[]> {
  const items = page.highlights || [];
  const seen = new Map<string, HighlightItem>();
  const dupeIds: string[] = [];
  const changedKeeps: HighlightItem[] = [];
  const score = (x: HighlightItem) =>
    (x.note && x.note.trim() ? 1 : 0) + (x.insight && x.insight.trim() ? 1 : 0);
  for (const it of items) {
    const k = normExact(it.exact);
    const prev = seen.get(k);
    if (!prev) { seen.set(k, it); continue; }
    const keep = score(it) > score(prev) ? it : prev;
    const drop = keep === it ? prev : it;
    let changed = false;
    if (!(keep.note && keep.note.trim()) && drop.note && drop.note.trim()) { keep.note = drop.note; changed = true; }
    if (!(keep.insight && keep.insight.trim()) && drop.insight && drop.insight.trim()) { keep.insight = drop.insight; changed = true; }
    if (changed) { keep.updatedAt = Date.now(); changedKeeps.push(keep); }
    seen.set(k, keep);
    dupeIds.push(drop.id);
  }
  if (!dupeIds.length) return items;
  const merged = Array.from(seen.values());
  await chrome.storage.local.set({
    [pageKey(url)]: { ...page, highlights: merged, updatedAt: Date.now() }
  });
  await addTombstones(dupeIds);
  try {
    await softDeleteHighlights(dupeIds);
    if (changedKeeps.length) await upsertHighlights(changedKeeps, url, page.title);
  } catch (e) {
    console.warn('[whw] 去重推送云端失败（稍后同步会重试）', e);
  }
  return merged;
}

export async function getPage(url: string): Promise<HighlightItem[]> {
  const key = pageKey(url);
  const page = (await chrome.storage.local.get(key))[key] as StoredPage | undefined;
  if (!page || page.url !== url) return [];
  return dedupePageItems(url, page);
}

export async function listPages(): Promise<PageMeta[]> {
  const all = await chrome.storage.local.get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith(PAGE_PREFIX))
    .map((k) => all[k] as StoredPage)
    .filter((p) => p && Array.isArray(p.highlights) && p.highlights.length > 0)
    .map((p) => ({
      url: p.url,
      title: p.title,
      count: p.highlights.length,
      updatedAt: p.updatedAt
    }));
}

/* ----------------------- 写入（缓存 + 推送云端） ----------------------- */
export async function savePage(
  url: string,
  highlights: HighlightItem[],
  title?: string
): Promise<{ ok: boolean; error?: string }> {
  const key = pageKey(url);
  const prev = (await chrome.storage.local.get(key))[key] as StoredPage | undefined;
  const prevIds = new Set((prev?.highlights || []).map((x) => x.id));
  const newIds = new Set(highlights.map((x) => x.id));
  const removedIds = [...prevIds].filter((id) => !newIds.has(id));

  const finalTitle = title || (highlights[0] && highlights[0].title) || (prev && prev.title) || '';
  const page: StoredPage = { url, title: finalTitle, highlights, updatedAt: Date.now() };
  await chrome.storage.local.set({ [key]: page });

  // 登记本地删除清单（防离线删除被复活）+ 推送云端（尽力而为）
  if (removedIds.length) await addTombstones(removedIds);
  try {
    if (highlights.length) await upsertHighlights(highlights, url, finalTitle);
    if (removedIds.length) await softDeleteHighlights(removedIds);
  } catch (e) {
    console.warn('[whw] 推送云端失败（稍后同步会重试）', e);
  }
  return { ok: true };
}

/* ----------------------- 误归档找回（SPA 修复前的存量数据） ----------------------- */
export interface ForeignHighlight {
  url: string;
  item: HighlightItem;
}

// 找出存储在其他页面下的全部高亮（候选找回对象）
export async function getForeignHighlights(currentUrl: string): Promise<ForeignHighlight[]> {
  const all = await chrome.storage.local.get(null);
  const out: ForeignHighlight[] = [];
  for (const k of Object.keys(all)) {
    if (!k.startsWith(PAGE_PREFIX)) continue;
    const p = all[k] as StoredPage;
    if (!p || !p.url || p.url === currentUrl) continue;
    for (const item of p.highlights || []) out.push({ url: p.url, item });
  }
  return out;
}

// 把指定高亮从源页面搬到目标页面：本地缓存搬移 + 云端 page_url 更新。
// 注意：这是"搬走"不是"删除"，正常搬移不登记墓碑，否则同步时会被重新删除。
// 但若目标页已存在相同文本的高亮（误归档期间用户重新高亮过），则合并笔记/心得
// 到现有记录，并把外来副本真正删除（登记墓碑 + 云端软删），避免同文本双份数据。
export async function relocateHighlights(
  moves: { fromUrl: string; ids: string[] }[],
  toUrl: string,
  toTitle: string
): Promise<{ ok: boolean; moved: number; deduped: number }> {
  const movedItems: HighlightItem[] = [];
  for (const m of moves) {
    const key = pageKey(m.fromUrl);
    const page = (await chrome.storage.local.get(key))[key] as StoredPage | undefined;
    if (!page || page.url !== m.fromUrl) continue;
    const idSet = new Set(m.ids);
    const taken = page.highlights.filter((x) => idSet.has(x.id));
    if (!taken.length) continue;
    movedItems.push(...taken);
    const rest = page.highlights.filter((x) => !idSet.has(x.id));
    if (rest.length) {
      await chrome.storage.local.set({ [key]: { ...page, highlights: rest, updatedAt: Date.now() } });
    } else {
      await chrome.storage.local.remove(key);
    }
  }
  if (!movedItems.length) return { ok: true, moved: 0, deduped: 0 };

  const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
  const tKey = pageKey(toUrl);
  const tPage = (await chrome.storage.local.get(tKey))[tKey] as StoredPage | undefined;
  const existing = tPage && tPage.url === toUrl ? tPage.highlights : [];
  const byExact = new Map(existing.map((x) => [norm(x.exact), x]));

  const toMove: HighlightItem[] = [];
  const dupeIds: string[] = [];
  const mergedExisting: HighlightItem[] = [];
  for (const it of movedItems) {
    const dup = byExact.get(norm(it.exact));
    if (!dup) {
      toMove.push(it);
      byExact.set(norm(it.exact), it);
      continue;
    }
    // 同文本已存在：外来副本的笔记/心得补进现有记录，然后删除副本
    let changed = false;
    if (!(dup.note && dup.note.trim()) && it.note && it.note.trim()) { dup.note = it.note; changed = true; }
    if (!(dup.insight && dup.insight.trim()) && it.insight && it.insight.trim()) { dup.insight = it.insight; changed = true; }
    if (changed) { dup.updatedAt = Date.now(); mergedExisting.push(dup); }
    dupeIds.push(it.id);
  }

  const title = toTitle || (tPage && tPage.title) || movedItems[0].title || '';
  await chrome.storage.local.set({
    [tKey]: { url: toUrl, title, highlights: existing.concat(toMove), updatedAt: Date.now() }
  });
  try {
    if (toMove.length) await upsertHighlights(toMove, toUrl, title);
    if (mergedExisting.length) await upsertHighlights(mergedExisting, toUrl, title);
    if (dupeIds.length) await softDeleteHighlights(dupeIds);
  } catch (e) {
    console.warn('[whw] 搬迁推送云端失败（稍后同步会重试）', e);
  }
  // 副本是"删除"，必须登记墓碑防止同步时复活
  if (dupeIds.length) await addTombstones(dupeIds);
  return { ok: true, moved: toMove.length, deduped: dupeIds.length };
}

export async function deletePage(url: string): Promise<void> {
  const key = pageKey(url);
  const prev = (await chrome.storage.local.get(key))[key] as StoredPage | undefined;
  await chrome.storage.local.remove(key);
  if (prev && prev.highlights.length) {
    await addTombstones(prev.highlights.map((x) => x.id));
  }
  try {
    if (prev && prev.highlights.length) {
      await softDeleteHighlights(prev.highlights.map((x) => x.id));
    }
  } catch (e) {
    console.warn('[whw] 删除推送云端失败', e);
  }
}

/* ----------------------- 双向全量对齐同步 ----------------------- */
let syncing = false;

// 双向 reconciliation：本地 <-> 云端 按 id 对齐，新的覆盖旧的，墓碑传播删除。
// 个人数据量小，全量对齐最稳妥，能修正"只拉不推 / 水印跳过旧数据"导致的对不上。
export async function syncNow(): Promise<{ ok: boolean; pulled?: number; pushed?: number; error?: string }> {
  if (syncing) return { ok: false, error: 'sync in progress' };
  syncing = true;
  try {
    // 1. 拉全部云端行（含软删除墓碑）+ 本地删除清单
    const res = await fetchChanges(null);
    if (!res.ok) return { ok: false, error: res.error };
    const cloudRows = res.rows || [];
    const cloudById = new Map(cloudRows.map((r) => [r.id, r]));
    const tombstones = await getTombstones();
    const tombstoneIds = new Set(tombstones.map((t) => t.id));

    // 2. 读全部本地缓存页
    const all = await chrome.storage.local.get(null);
    const pages = new Map<string, StoredPage>();
    for (const k of Object.keys(all)) {
      if (!k.startsWith(PAGE_PREFIX)) continue;
      const p = all[k] as StoredPage;
      if (p && p.url) pages.set(p.url, p);
    }
    const localById = new Map<string, { item: HighlightItem; url: string }>();
    for (const [url, p] of pages) {
      for (const item of p.highlights) localById.set(item.id, { item, url });
    }

    const toPush: { item: HighlightItem; url: string; title: string }[] = [];
    const reDeleteIds: string[] = [];   // 本地已删但云端仍活，需重新推送删除
    const resolvedTombIds: string[] = []; // 可从本地删除清单移除的 id
    const touched = new Set<string>();

    // 3a. 处理云端行：墓碑删除本地；本地已删的云端活行不复活并重新删除；其余按时间对齐
    for (const row of cloudRows) {
      const url = row.page_url;
      const local = localById.get(row.id);

      if (row.deleted_at) {
        // 云端已是墓碑：本地清单可移除该 id；本地若仍有数据则一并删
        if (tombstoneIds.has(row.id)) resolvedTombIds.push(row.id);
        if (local) {
          const page = pages.get(local.url)!;
          const idx = page.highlights.findIndex((x) => x.id === row.id);
          if (idx >= 0) { page.highlights.splice(idx, 1); touched.add(local.url); }
        }
        continue;
      }

      // 云端是活行，但本地已标记删除（可能离线删除推送失败）→ 不复活，重新推送删除
      if (tombstoneIds.has(row.id)) {
        reDeleteIds.push(row.id);
        continue;
      }

      const cloudTime = row.updated_at ? Date.parse(row.updated_at) : 0;
      const localTime = local ? (local.item.updatedAt || local.item.createdAt || 0) : 0;

      if (!local) {
        // 云端有本地无：补到本地
        let page = pages.get(url);
        if (!page) {
          page = { url, title: row.page_title || '', highlights: [], updatedAt: 0 };
          pages.set(url, page);
        }
        page.highlights.push(rowToItem(row));
        touched.add(url);
      } else if (cloudTime > localTime) {
        // 云端更新：覆盖本地
        const page = pages.get(local.url)!;
        const idx = page.highlights.findIndex((x) => x.id === row.id);
        page.highlights[idx] = rowToItem(row);
        touched.add(local.url);
      } else if (localTime > cloudTime) {
        // 本地更新：推送到云端
        toPush.push({ item: local.item, url: local.url, title: pages.get(local.url)!.title });
      }
      // 时间相等则不动
    }

    // 3b. 本地有云端无：推送到云端
    for (const [id, local] of localById) {
      if (!cloudById.has(id)) {
        toPush.push({ item: local.item, url: local.url, title: pages.get(local.url)!.title });
      }
    }

    // 4. 推送本地变更到云端（按页面分组 upsert）
    if (toPush.length) {
      const byUrl = new Map<string, { items: HighlightItem[]; title: string }>();
      for (const r of toPush) {
        if (!byUrl.has(r.url)) byUrl.set(r.url, { items: [], title: r.title });
        byUrl.get(r.url)!.items.push(r.item);
      }
      for (const [url, g] of byUrl) {
        await upsertHighlights(g.items, url, g.title);
      }
    }

    // 4b. 重新推送"本地已删但云端仍活"的删除（修复离线删除被复活）
    if (reDeleteIds.length) {
      const r = await softDeleteHighlights(reDeleteIds);
      if (r.ok) resolvedTombIds.push(...reDeleteIds);
    }

    // 4c. 云端已无此行的本地墓碑也视为已解决（例如云端已被清理）
    for (const t of tombstones) {
      if (!cloudById.has(t.id)) resolvedTombIds.push(t.id);
    }
    if (resolvedTombIds.length) {
      await removeTombstones(Array.from(new Set(resolvedTombIds)));
    }

    // 5. 写回本地缓存（空页删除）
    const writes: Record<string, StoredPage> = {};
    const removals: string[] = [];
    for (const url of touched) {
      const page = pages.get(url)!;
      const key = pageKey(url);
      if (page.highlights.length === 0) removals.push(key);
      else writes[key] = page;
    }
    if (Object.keys(writes).length) await chrome.storage.local.set(writes);
    if (removals.length) await chrome.storage.local.remove(removals);

    // 6. 定期物理清理云端老墓碑（超过 PURGE_AFTER_DAYS 天）
    try {
      const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 86400000).toISOString();
      await purgeTombstones(cutoff);
    } catch (e) { /* ignore */ }

    // 7. 记录本次同步时间
    await chrome.storage.local.set({ [LAST_PULL_KEY]: new Date().toISOString() });

    return { ok: true, pulled: cloudRows.length, pushed: toPush.length };
  } catch (e) {
    return { ok: false, error: String(e) };
  } finally {
    syncing = false;
  }
}

/* ----------------------- 旧数据迁移（一次性，幂等） ----------------------- */
// 旧版 v1：chrome.storage.sync 分片存储（whw:m:<hash> / whw:d:<hash>:<i>）
// 旧版 v0：chrome.storage.local 直接存数组/对象（whw:<url>）
export async function migrateLegacy(): Promise<void> {
  // v1: chrome.storage.sync
  try {
    const syncAll = await chrome.storage.sync.get(null);
    const headerKeys = Object.keys(syncAll).filter((k) => k.startsWith('whw:m:'));
    const toClear: string[] = [];
    for (const hk of headerKeys) {
      const header = syncAll[hk] as { url?: string; title?: string; chunks?: number } | undefined;
      if (!header || !header.url) continue;
      const items: HighlightItem[] = [];
      const chunks = header.chunks || 0;
      const chunkKeys: string[] = [];
      for (let i = 0; i < chunks; i++) chunkKeys.push(hk.replace('whw:m:', 'whw:d:') + ':' + i);
      const chunkData = await chrome.storage.sync.get(chunkKeys);
      for (let i = 0; i < chunks; i++) {
        const c = chunkData[hk.replace('whw:m:', 'whw:d:') + ':' + i] as { items?: HighlightItem[] } | undefined;
        if (c && Array.isArray(c.items)) items.push(...c.items);
      }
      if (items.length) {
        // 归一化：补 insight 字段
        items.forEach((it) => { if (it.insight == null) it.insight = ''; });
        await savePage(header.url, items, header.title || '');
      }
      toClear.push(hk, ...chunkKeys);
    }
    // 迁移 lastColor
    if (typeof syncAll['whw:lastColor'] === 'string') {
      await chrome.storage.local.set({ 'whw:lastColor': syncAll['whw:lastColor'] });
      toClear.push('whw:lastColor');
    }
    if (toClear.length) await chrome.storage.sync.remove(toClear);
  } catch (e) {
    console.warn('[whw] v1 迁移失败', e);
  }

  // v0: chrome.storage.local 旧键（非 v2）
  try {
    const localAll = await chrome.storage.local.get(null);
    const oldKeys = Object.keys(localAll).filter(
      (k) => k.startsWith('whw:') && !k.startsWith(PAGE_PREFIX) && k !== LAST_PULL_KEY && k !== 'whw:lastColor'
    );
    for (const k of oldKeys) {
      const url = k.slice('whw:'.length);
      const val = localAll[k];
      let items: HighlightItem[] = [];
      let title = '';
      if (Array.isArray(val)) {
        items = val as HighlightItem[];
      } else if (val && typeof val === 'object' && Array.isArray((val as { highlights?: HighlightItem[] }).highlights)) {
        items = (val as { highlights: HighlightItem[] }).highlights;
        title = (val as { title?: string }).title || '';
      }
      if (items.length) {
        items.forEach((it) => { if (it.insight == null) it.insight = ''; });
        await savePage(url, items, title);
      }
      await chrome.storage.local.remove(k);
    }
  } catch (e) {
    console.warn('[whw] v0 迁移失败', e);
  }
}
