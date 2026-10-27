const { Client } = require('@langchain/langgraph-sdk')
const { validateUrl, validateRequest } = require('./service.cjs')

function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('')
}

function validateMentorRequest(request) {
  const input = validateRequest(request)
  const focus = request.focus ?? ''
  if (typeof focus !== 'string' || [...focus].length > 200) throw new Error('Focus is limited to 200 characters.')
  if (focus.trim() && !input.text.toLowerCase().includes(focus.trim().toLowerCase())) {
    throw new Error('The focus word or phrase must appear in the source text.')
  }
  const followUp = request.follow_up ?? ''
  const history = request.history ?? []
  if (typeof followUp !== 'string' || [...followUp].length > 2000 || (followUp && !followUp.trim())) {
    throw new Error('Follow-up questions must contain 1-2,000 characters.')
  }
  if (!Array.isArray(history) || history.length > 41) throw new Error('Conversation is too long. Start a new explanation.')
  if (Boolean(history.length) !== Boolean(followUp.trim()) || (history.length && history.length % 2 !== 1)) {
    throw new Error('Follow-ups require completed conversation history.')
  }
  const messages = history.map((message, index) => {
    const expected = index % 2 === 0 ? 'assistant' : 'user'
    if (!message || message.role !== expected || typeof message.content !== 'string' || !message.content.trim()
        || [...message.content].length > 40000 || Object.keys(message).some((key) => !['role', 'content'].includes(key))) {
      throw new Error('Invalid conversation history. Start a new explanation.')
    }
    return { role: message.role, content: message.content }
  })
  if (messages.reduce((sum, message) => sum + [...message.content].length, 0) > 120000) {
    throw new Error('Conversation is too long. Start a new explanation.')
  }
  return { ...input, focus: focus.trim(), ...(followUp ? { follow_up: followUp.trim(), history: messages } : {}) }
}

async function explain(url, request, { signal, apiKey, onText = () => {}, fetchImpl = fetch, client } = {}) {
  const input = validateMentorRequest(request)
  const sdk = client ?? new Client({
    apiUrl: validateUrl(url), apiKey: apiKey || null,
    callerOptions: { maxRetries: 0, fetch: (resource, init) => fetchImpl(resource, { ...init, redirect: 'error' }) },
    onRequest: (_url, init) => ({ ...init, redirect: 'error' }),
  })
  let text = ''
  let final = false
  for await (const event of sdk.runs.stream(null, 'translation-mentor', {
    input, streamMode: ['messages-tuple', 'values'], onDisconnect: 'cancel', onCompletion: 'delete', signal,
  })) {
    signal?.throwIfAborted()
    if (event.event === 'error') throw new Error('The mentor could not finish. Check the agent service logs and retry.')
    if (event.event === 'messages') {
      const [message, metadata] = event.data ?? []
      if (metadata?.langgraph_node === 'explain' && ['ai', 'AIMessageChunk'].includes(message?.type)) {
        const delta = textOf(message.content)
        if (delta) { text += delta; onText(text) }
      }
    }
    if (event.event === 'values' && typeof event.data?.explanation === 'string') {
      text = event.data.explanation
      final = true
      onText(text)
    }
  }
  signal?.throwIfAborted()
  if (!final) throw new Error('The mentor stream ended before completion. Retry to receive the full explanation.')
  if (!text.trim()) throw new Error('The mentor returned no explanation.')
  return text
}

module.exports = { explain, textOf, validateMentorRequest }
