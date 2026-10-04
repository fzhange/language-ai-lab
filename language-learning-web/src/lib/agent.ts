/** 一次性图谱调用：POST /runs/wait（无状态，完整历史由前端维护）。 */

import { LANGGRAPH_URL } from './config'

export interface ChatMessage {
  type: 'human' | 'ai'
  content: string
}

/** message.content 可能是 string 或内容块数组，统一取文本 */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? '')))
      .join('')
  }
  return String(content ?? '')
}

export interface RunAuth {
  userId?: string
  accessToken?: string | null
}

/**
 * 调用一次性图谱（writing-coach / vocab-quiz），返回最后一条 AI 消息文本。
 * user_id / supabase_token 经 config.configurable 传给服务端工具。
 */
export async function runOnce(
  assistantId: string,
  messages: ChatMessage[],
  auth: RunAuth,
): Promise<string> {
  const resp = await fetch(`${LANGGRAPH_URL}/runs/wait`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      assistant_id: assistantId,
      input: { messages },
      config: {
        configurable: {
          user_id: auth.userId,
          supabase_token: auth.accessToken ?? undefined,
        },
      },
    }),
  })
  if (!resp.ok) {
    throw new Error(`Agent 服务返回 HTTP ${resp.status}：${(await resp.text()).slice(0, 200)}`)
  }
  const data = (await resp.json()) as { messages?: { type: string; content: unknown }[] }
  const last = [...(data.messages ?? [])].reverse().find((m) => m.type === 'ai')
  if (!last) throw new Error('Agent 服务没有返回结果')
  return textOf(last.content)
}
