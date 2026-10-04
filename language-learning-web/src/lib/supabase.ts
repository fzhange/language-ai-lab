/** Supabase 客户端：与 words-highlight-in-web 插件共用同一项目（whw_* 表，RLS 按 user_id 隔离）。 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { SUPABASE_ANON_KEY, SUPABASE_READY, SUPABASE_URL } from './config'

export const supabase: SupabaseClient | null = SUPABASE_READY
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)
  : null

/** 插件高亮表（schema 见 words-highlight-in-web/AGENTS.md） */
export interface HighlightRow {
  id: string
  user_id: string
  page_url: string
  page_title: string
  color: string
  exact: string
  prefix: string
  suffix: string
  note: string
  insight: string
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}
