/** 全局配置：全部经 Vite 环境变量注入，见 .env.example */

export const LANGGRAPH_URL: string =
  import.meta.env.VITE_LANGGRAPH_URL ?? 'http://localhost:2024'

export const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL
export const SUPABASE_ANON_KEY: string | undefined = import.meta.env.VITE_SUPABASE_ANON_KEY

export const SUPABASE_READY = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)
