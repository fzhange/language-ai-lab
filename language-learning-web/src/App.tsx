import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { BookOpenText, Bookmark, ChevronRight, GraduationCap, Highlighter, LogOut, Sparkles, UserRound } from 'lucide-react'

import { AuthGate } from './components/AuthGate'
import { Button } from './components/ui/button'
import { useAuth } from './lib/auth'
import { CollectionsPage } from './pages/CollectionsPage'
import { HighlightsPage } from './pages/HighlightsPage'
import { NotesPage } from './pages/NotesPage'

const NAV_ITEMS = [
  { to: '/notes', label: '知识库笔记', description: '整理知识，建立语言直觉', icon: BookOpenText, end: false },
  { to: '/highlights', label: '我的高亮', description: '从你的阅读中发现新知', icon: Highlighter, end: false },
  { to: '/collections', label: '我的收藏', description: '留住好词好句，标出灵感', icon: Bookmark, end: false },
]

function Shell() {
  const { user, supabaseReady, signOut } = useAuth()
  const location = useLocation()

  useEffect(() => {
    document.title = 'Language Lab'
  }, [location])

  const current = NAV_ITEMS.find((item) => item.to === location.pathname) ?? NAV_ITEMS[0]

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background md:flex-row">
      <nav aria-label="主导航" className="flex w-full shrink-0 flex-col border-b bg-card px-4 py-3 md:w-60 md:border-r md:border-b-0 md:px-3 md:py-6">
        <div className="flex items-center gap-3 px-2 md:mb-10">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/20">
            <GraduationCap className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight">Language Lab</h1>
            <p className="text-xs text-muted-foreground">Understand, don't memorize.</p>
          </div>
        </div>
        <p className="hidden px-3 pb-3 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase md:block">学习空间</p>
        <div className="mt-3 grid grid-cols-3 gap-1 md:mt-0 md:flex md:flex-col">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex min-w-0 flex-col items-center gap-1 rounded-lg px-0.5 py-2 text-xs whitespace-nowrap transition-colors md:w-full md:flex-row md:gap-3 md:px-3 md:py-2.5 md:text-base ${
                    isActive
                      ? 'bg-accent font-semibold text-primary'
                      : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`
                }
              >
                <Icon className="size-4" />
                {item.label}
              </NavLink>
            )
          })}
        </div>
        <div className="mt-auto hidden border-t px-2 pt-5 md:block">
          {supabaseReady && user ? (
            <div className="flex items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-primary"><UserRound className="size-4" /></span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={user.email}>{user.email}</span>
              <Button variant="ghost" size="icon" className="size-8" aria-label="退出登录" title="退出登录" onClick={() => void signOut()}><LogOut /></Button>
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">每天一点点，让语言成为直觉。</p>
          )}
        </div>
      </nav>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card/80 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 text-base">
            <span className="hidden text-muted-foreground sm:inline">学习空间</span>
            <ChevronRight className="hidden size-4 text-muted-foreground/60 sm:inline" />
            <span className="font-semibold">{current.label}</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="size-4 text-primary" />
            <span className="hidden sm:inline">{current.description}</span>
            {supabaseReady && user && <Button variant="ghost" size="icon" className="size-8 md:hidden" aria-label="退出登录" onClick={() => void signOut()}><LogOut /></Button>}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/notes" replace />} />
            <Route path="/notes" element={<NotesPage />} />
            <Route path="/highlights" element={<HighlightsPage />} />
            <Route path="/collections" element={<CollectionsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  )
}
