// Supabase 客户端与数据访问层。
// 注意：MV3 background 是 service worker，没有 localStorage，
// 所以用 chrome.storage.local 做 auth session 的持久化适配器。
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { HighlightItem } from './types';

const SUPABASE_URL = 'https://olmpkszathzjcvnkatzx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_ynqxkIg6dzvqSqUSuXwzww_rrZ5V4cP';
const TABLE = 'whw_highlights';

const chromeStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    const res = await chrome.storage.local.get(key);
    return (res[key] as string) ?? null;
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await chrome.storage.local.set({ [key]: value });
  },
  removeItem: async (key: string): Promise<void> => {
    await chrome.storage.local.remove(key);
  }
};

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: chromeStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});

/* ----------------------- 类型 ----------------------- */
export interface HighlightRow {
  id: string;
  user_id: string;
  page_url: string;
  page_title: string;
  color: string;
  exact: string;
  prefix: string;
  suffix: string;
  note: string;
  insight: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface AuthState {
  signedIn: boolean;
  email: string | null;
  userId: string | null;
}

/* ----------------------- Auth ----------------------- */
export async function getAuthState(): Promise<AuthState> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session || !session.user) return { signedIn: false, email: null, userId: null };
    return { signedIn: true, email: session.user.email || null, userId: session.user.id };
  } catch (e) {
    return { signedIn: false, email: null, userId: null };
  }
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  return { ok: true, email: data.user?.email || null };
}

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { ok: false, error: error.message };
  // 若项目开启邮箱验证，session 为空，提示用户去验证
  const needsConfirm = !data.session;
  return { ok: true, email: data.user?.email || null, needsConfirm };
}

export async function signOut() {
  await supabase.auth.signOut();
  return { ok: true };
}

async function getUserId(): Promise<string | null> {
  const state = await getAuthState();
  return state.userId;
}

/* ----------------------- 数据映射 ----------------------- */
export function itemToRow(item: HighlightItem, pageUrl: string, pageTitle: string, userId: string): HighlightRow {
  return {
    id: item.id,
    user_id: userId,
    page_url: pageUrl,
    page_title: pageTitle || item.title || '',
    color: item.color,
    exact: item.exact,
    prefix: item.prefix || '',
    suffix: item.suffix || '',
    note: item.note || '',
    insight: item.insight || ''
  };
}

export function rowToItem(row: HighlightRow): HighlightItem {
  return {
    id: row.id,
    color: row.color,
    exact: row.exact,
    prefix: row.prefix || '',
    suffix: row.suffix || '',
    note: row.note || '',
    insight: row.insight || '',
    title: row.page_title || '',
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now()
  };
}

/* ----------------------- 数据操作 ----------------------- */
// 批量 upsert 一组高亮（指定所属页面）
export async function upsertHighlights(items: HighlightItem[], pageUrl: string, pageTitle: string) {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not signed in' };
  if (!items.length) return { ok: true };
  const rows = items.map((it) => itemToRow(it, pageUrl, pageTitle, userId));
  const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// 软删除一组高亮 id（同步墓碑）
export async function softDeleteHighlights(ids: string[]) {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not signed in' };
  if (!ids.length) return { ok: true };
  const { error } = await supabase
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .in('id', ids)
    .eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// 拉取自 since 之后变更的行（增量同步）；since 为空则全量
export async function fetchChanges(since: string | null): Promise<{ ok: boolean; rows?: HighlightRow[]; error?: string }> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not signed in' };
  let query = supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: true });
  if (since) query = query.gt('updated_at', since);
  const { data, error } = await query;
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data as HighlightRow[]) || [] };
}

// 物理清除 deleted_at 早于 olderThanIso 的墓碑行（RLS 限制只能删自己的）
export async function purgeTombstones(olderThanIso: string) {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not signed in' };
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('user_id', userId)
    .not('deleted_at', 'is', null)
    .lt('deleted_at', olderThanIso);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/* ----------------------- 高亮追问会话（落 PG） ----------------------- */
const CHAT_TABLE = 'whw_chat_messages';

export interface ChatMessageRow {
  role: 'user' | 'assistant';
  content: string;
  thread_id: string;
  created_at?: string;
}

// 追加一轮问答（user + assistant 两条）。失败只打日志，不影响聊天主流程。
export async function saveChatTurn(
  highlightId: string,
  threadId: string,
  userText: string,
  assistantText: string
) {
  const userId = await getUserId();
  if (!userId) {
    console.warn('[whw] 会话未落库：未登录 Supabase（管理页登录后才会持久化追问记录）');
    return { ok: false, error: 'not signed in' };
  }
  const rows = [
    { user_id: userId, highlight_id: highlightId, thread_id: threadId, role: 'user', content: userText },
    { user_id: userId, highlight_id: highlightId, thread_id: threadId, role: 'assistant', content: assistantText }
  ];
  const { error } = await supabase.from(CHAT_TABLE).insert(rows);
  if (error) {
    console.warn('[whw] 会话落库失败：', error.message, error);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// 读取某条高亮的全部会话；附带最近的 threadId，用于换设备后恢复续聊
export async function fetchChatMessages(highlightId: string): Promise<{
  ok: boolean;
  messages?: Array<{ role: 'user' | 'assistant'; text: string }>;
  threadId?: string | null;
  error?: string;
}> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not signed in' };
  const { data, error } = await supabase
    .from(CHAT_TABLE)
    .select('role, content, thread_id, created_at')
    .eq('user_id', userId)
    .eq('highlight_id', highlightId)
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: error.message };
  const rows = (data as ChatMessageRow[]) || [];
  return {
    ok: true,
    messages: rows.map((r) => ({ role: r.role, text: r.content })),
    threadId: rows.length ? rows[rows.length - 1]!.thread_id : null
  };
}

// 一条会话（=一条高亮）的摘要，用于「聊天记录」列表
export interface ChatThreadSummary {
  highlightId: string;
  threadId: string;
  count: number;              // 消息条数（user + assistant）
  firstUserText: string;     // 首条用户消息（含高亮上下文前缀，展示时前端会剥离）
  lastText: string;          // 最近一条消息
  lastAt: string | null;     // 最近一条消息时间
}

// 列出当前用户的全部会话（按高亮分组，按最近活跃倒序），供管理页「聊天记录」浏览
export async function listChatThreads(): Promise<{
  ok: boolean;
  threads?: ChatThreadSummary[];
  error?: string;
}> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: 'not signed in' };
  const { data, error } = await supabase
    .from(CHAT_TABLE)
    .select('highlight_id, thread_id, role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: error.message };
  const rows = (data as Array<{
    highlight_id: string;
    thread_id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at?: string;
  }>) || [];
  const map = new Map<string, ChatThreadSummary>();
  for (const r of rows) {
    let t = map.get(r.highlight_id);
    if (!t) {
      t = { highlightId: r.highlight_id, threadId: r.thread_id, count: 0, firstUserText: '', lastText: '', lastAt: null };
      map.set(r.highlight_id, t);
    }
    t.count += 1;
    t.threadId = r.thread_id;
    t.lastText = r.content;
    t.lastAt = r.created_at || t.lastAt;
    if (!t.firstUserText && r.role === 'user') t.firstUserText = r.content;
  }
  const threads = Array.from(map.values()).sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || ''));
  return { ok: true, threads };
}
