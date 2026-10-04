/** 认证上下文：Supabase 邮箱密码登录。未配置 Supabase 时降级为免登录（仅聊天可用）。 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'

import { SUPABASE_READY } from './config'
import { supabase } from './supabase'

interface AuthState {
  user: User | null
  /** 用户会话 JWT：透传给 Agent 服务做 RLS 授权（读取 whw_highlights） */
  accessToken: string | null
  loading: boolean
  supabaseReady: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  accessToken: null,
  loading: true,
  supabaseReady: SUPABASE_READY,
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(SUPABASE_READY)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setAccessToken(data.session?.access_token ?? null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setAccessToken(session?.access_token ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        loading,
        supabaseReady: SUPABASE_READY,
        signOut: async () => {
          await supabase?.auth.signOut()
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
