-- 高亮追问会话表：每条高亮一个会话（thread_id 对应 LangGraph 线程），
-- 消息按 user/assistant 成对追加。在 Supabase SQL Editor 执行本文件。

create table if not exists public.whw_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  highlight_id text not null,
  thread_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists whw_chat_messages_user_highlight_idx
  on public.whw_chat_messages (user_id, highlight_id, created_at);

-- 行级安全：只能读写自己的会话
alter table public.whw_chat_messages enable row level security;

create policy "whw_chat_select_own" on public.whw_chat_messages
  for select using (auth.uid() = user_id);
create policy "whw_chat_insert_own" on public.whw_chat_messages
  for insert with check (auth.uid() = user_id);
create policy "whw_chat_delete_own" on public.whw_chat_messages
  for delete using (auth.uid() = user_id);
