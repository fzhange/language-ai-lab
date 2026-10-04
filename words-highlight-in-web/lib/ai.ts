// AI 服务客户端：连接 generic-agent-service（LangGraph Server）。
// 所有 AI 请求都应由 background 发起（见 entrypoints/background.ts），
// 配置存 chrome.storage.local，扩展页面只允许读写配置，不直接调 AI。

export interface AiConfig {
  baseUrl: string; // LangGraph Server 地址，langgraph dev 默认 http://localhost:2024
  token: string;   // Bearer 令牌，本地 dev 可为空
}

const CONFIG_KEY = 'whw:aiConfig';
const DEFAULT_CONFIG: AiConfig = { baseUrl: 'http://localhost:2024', token: '' };

export async function getAiConfig(): Promise<AiConfig> {
  const res = await chrome.storage.local.get(CONFIG_KEY);
  const saved = res[CONFIG_KEY] as Partial<AiConfig> | undefined;
  return { ...DEFAULT_CONFIG, ...(saved || {}) };
}

export async function setAiConfig(cfg: Partial<AiConfig>): Promise<AiConfig> {
  const next = { ...(await getAiConfig()), ...cfg };
  next.baseUrl = next.baseUrl.trim().replace(/\/+$/, '');
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  return next;
}

interface LgMessage {
  role?: string;
  type?: string;
  content?: unknown;
}

function extractText(msg: LgMessage | undefined): string {
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => (p && typeof p === 'object' && (p as { type?: string }).type === 'text' && typeof (p as { text?: unknown }).text === 'string'
        ? (p as { text: string }).text : ''))
      .join('');
  }
  return '';
}

// 无状态调用一个 assistant，返回最后一条 AI 消息的文本
export async function runGraph(assistantId: string, userContent: string): Promise<string> {
  const cfg = await getAiConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const resp = await fetch(`${cfg.baseUrl}/runs/wait`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {})
      },
      body: JSON.stringify({
        assistant_id: assistantId,
        input: { messages: [{ role: 'user', content: userContent }] }
      }),
      signal: controller.signal
    });
    if (!resp.ok) throw new Error(`AI 服务返回 HTTP ${resp.status}`);
    const data = (await resp.json()) as { messages?: LgMessage[] };
    const msgs = data.messages || [];
    const text = extractText(msgs[msgs.length - 1]);
    if (!text) throw new Error('AI 服务未返回内容');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// 连通性检查（LangGraph Server 的健康检查端点）
export async function pingAiService(): Promise<{ ok: boolean; error?: string }> {
  const cfg = await getAiConfig();
  try {
    const resp = await fetch(`${cfg.baseUrl}/ok`, {
      headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}
    });
    return resp.ok ? { ok: true } : { ok: false, error: `HTTP ${resp.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function authHeaders(cfg: AiConfig): Record<string, string> {
  return cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {};
}

/* ----------------------- Thread（有状态会话） ----------------------- */

export async function createThread(): Promise<string> {
  const cfg = await getAiConfig();
  const resp = await fetch(`${cfg.baseUrl}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
    body: '{}'
  });
  if (!resp.ok) throw new Error(`创建会话失败 HTTP ${resp.status}`);
  const data = (await resp.json()) as { thread_id?: string };
  if (!data.thread_id) throw new Error('创建会话失败：缺少 thread_id');
  return data.thread_id;
}

// 在既有 thread 上追加一轮对话，返回 AI 回复文本
export async function runOnThread(threadId: string, assistantId: string, content: string): Promise<string> {
  const cfg = await getAiConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const resp = await fetch(`${cfg.baseUrl}/threads/${threadId}/runs/wait`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
      body: JSON.stringify({
        assistant_id: assistantId,
        input: { messages: [{ role: 'user', content }] }
      }),
      signal: controller.signal
    });
    if (!resp.ok) throw new Error(`AI 服务返回 HTTP ${resp.status}`);
    const data = (await resp.json()) as { messages?: LgMessage[] };
    const msgs = data.messages || [];
    const text = extractText(msgs[msgs.length - 1]);
    if (!text) throw new Error('AI 服务未返回内容');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export interface AgentActivity {
  kind: 'run' | 'agent' | 'tool-start' | 'tool-end' | 'tool-error' | 'answer' | 'complete' | 'failure';
  label?: string;
}

// 只展示可公开的工具名称；绝不向页面转发参数、结果或推理内容。
function toolLabel(name: unknown): string {
  const labels: Record<string, string> = {
    write_todos: '任务规划',
    task: '子任务',
    read_file: '资料读取',
    search_knowledge: '知识库检索'
  };
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(labels, name)
    ? labels[name] : '工具';
}

// 流式对话：只转发回答正文与服务端真实执行事件。
export async function streamOnThread(
  threadId: string,
  assistantId: string,
  content: string,
  onDelta: (accumulated: string) => void,
  onActivity: (activity: AgentActivity) => void
): Promise<string> {
  const cfg = await getAiConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const resp = await fetch(`${cfg.baseUrl}/threads/${threadId}/runs/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...authHeaders(cfg)
      },
      body: JSON.stringify({
        assistant_id: assistantId,
        input: { messages: [{ role: 'user', content }] },
        stream_mode: ['messages', 'updates']
      }),
      signal: controller.signal
    });
    if (!resp.ok || !resp.body) throw new Error(`AI 服务返回 HTTP ${resp.status}`);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = '';
    let dataLines: string[] = [];
    const byMsg = new Map<string, string>();
    const toolNames = new Map<string, string>();
    let latestId = '';
    let answerStarted = false;

    const handleFrame = () => {
      if (!dataLines.length) return;
      let parsed: unknown;
      try { parsed = JSON.parse(dataLines.join('\n')); } catch (e) { return; }
      if (eventName === 'metadata') {
        onActivity({ kind: 'run' });
        return;
      }
      if (eventName === 'updates' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [node, value] of Object.entries(parsed)) {
          if (node.endsWith('.before_agent') || node === 'before_agent') {
            onActivity({ kind: 'agent' });
          }
          if (!value || typeof value !== 'object') continue;
          const messages = (value as { messages?: unknown }).messages;
          if (!Array.isArray(messages)) continue;
          for (const m of messages) {
            if (!m || typeof m !== 'object') continue;
            const msg = m as Record<string, unknown>;
            const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
            for (const call of calls) {
              if (!call || typeof call !== 'object') continue;
              const c = call as Record<string, unknown>;
              const label = toolLabel(c.name);
              if (typeof c.id === 'string') toolNames.set(c.id, label);
              onActivity({ kind: 'tool-start', label });
            }
            if (msg.type === 'tool') {
              const label = toolNames.get(String(msg.tool_call_id || '')) || toolLabel(msg.name);
              onActivity({ kind: msg.status === 'error' ? 'tool-error' : 'tool-end', label });
            }
          }
        }
        return;
      }
      if (eventName !== 'messages' && eventName !== 'messages/partial') return;
      const chunk = Array.isArray(parsed) ? parsed[0] : parsed;
      if (!chunk || typeof chunk !== 'object') return;
      const c = chunk as Record<string, unknown>;
      const idStr = Array.isArray(c.id) ? c.id.join('.') : String(c.id || '');
      const src = (c.kwargs && typeof c.kwargs === 'object' ? c.kwargs : c) as LgMessage;
      if (src.type !== 'ai' && src.type !== 'AIMessageChunk' && !idStr.includes('AIMessageChunk')) return;
      const piece = extractText(src);
      if (!piece) return;
      if (!answerStarted) {
        answerStarted = true;
        onActivity({ kind: 'answer' });
      }
      latestId = idStr || latestId;
      // messages/partial 是截至当前的完整快照；messages 才是逐块增量。
      const next = eventName === 'messages/partial' ? piece : (byMsg.get(latestId) || '') + piece;
      if (next === byMsg.get(latestId)) return;
      byMsg.set(latestId, next);
      onDelta(next);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        else if (!line) {
          handleFrame();
          eventName = '';
          dataLines = [];
        }
      }
    }
    buffer += decoder.decode();
    if (buffer) {
      const line = buffer.replace(/\r$/, '');
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    handleFrame();
    const final = byMsg.get(latestId) || '';
    if (!final) throw new Error('流式响应为空');
    return final;
  } finally {
    clearTimeout(timer);
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

// 拉取 thread 的会话历史（服务端 checkpointer 持久化）
export async function getThreadMessages(threadId: string): Promise<ChatMessage[]> {
  const cfg = await getAiConfig();
  const resp = await fetch(`${cfg.baseUrl}/threads/${threadId}/state`, {
    headers: authHeaders(cfg)
  });
  if (!resp.ok) throw new Error(`读取会话失败 HTTP ${resp.status}`);
  const data = (await resp.json()) as { values?: { messages?: Array<Record<string, unknown>> } };
  const msgs = data.values?.messages || [];
  const out: ChatMessage[] = [];
  for (const m of msgs) {
    const kind = String(m.type || m.role || '');
    const role = kind === 'human' || kind === 'user' ? 'user'
      : kind === 'ai' || kind === 'assistant' ? 'assistant'
      : null;
    if (!role) continue;
    const text = extractText(m as LgMessage);
    if (text) out.push({ role, text });
  }
  return out;
}

// 从模型输出中提取 JSON 对象（容忍 ```json 围栏和前后噪声）
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 输出中没有 JSON');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
