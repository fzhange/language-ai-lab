/** 登录门：Supabase 已配置时要求邮箱登录；未配置时放行（仅聊天可用）。 */

import { useState, type FormEvent, type ReactNode } from 'react'
import { GraduationCap, Sparkles } from 'lucide-react'

import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading, supabaseReady } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!supabaseReady) return <>{children}</>
  if (loading) {
    return <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">加载中…</div>
  }
  if (user) return <>{children}</>

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setSubmitting(true)
    setMessage('')
    const { error } =
      mode === 'signIn'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    setSubmitting(false)
    if (error) setMessage(error.message)
    else if (mode === 'signUp') setMessage('注册成功，请查收验证邮件后登录。')
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm gap-4 py-8 shadow-lg shadow-primary/5">
        <CardHeader className="gap-3 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground"><GraduationCap className="size-6" /></span>
          <CardTitle className="text-2xl tracking-tight">Language Lab</CardTitle>
          <CardDescription>与浏览器插件共用同一账号，继续你的学习旅程。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="login-email" className="text-sm font-medium">邮箱</label>
              <Input id="login-email" type="email" required autoComplete="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label htmlFor="login-password" className="text-sm font-medium">密码</label>
              <Input id="login-password" type="password" required autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'} placeholder="输入密码" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={submitting} className="w-full"><Sparkles />{submitting ? '请稍候…' : mode === 'signIn' ? '登录' : '注册'}</Button>
            <Button variant="link" type="button" onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setMessage('') }} className="w-full text-xs">
              {mode === 'signIn' ? '没有账号？去注册' : '已有账号？去登录'}
            </Button>
            {message && <p role="status" className="text-center text-xs text-destructive">{message}</p>}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
