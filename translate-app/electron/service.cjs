const MAX_TEXT_LENGTH = 10000
const DEFAULT_URL = 'http://127.0.0.1:2024'

function validateUrl(value) {
  if (typeof value !== 'string') throw new Error('Enter a valid service URL.')
  let url
  try { url = new URL(value) } catch { throw new Error('Enter a valid service URL.') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !local)) {
    throw new Error('Use HTTPS for remote services, or HTTP for localhost.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('The service URL must not contain credentials, a query, or a fragment.')
  }
  return url.toString().replace(/\/+$/, '')
}

function validateRequest(request) {
  if (!request || typeof request.text !== 'string' || !request.text.trim()) {
    throw new Error('Enter some text to translate.')
  }
  if ([...request.text].length > MAX_TEXT_LENGTH) throw new Error('Text is limited to 10,000 characters.')
  if (!['en', 'zh'].includes(request.source_language) || !['en', 'zh'].includes(request.target_language)
      || request.source_language === request.target_language) {
    throw new Error('Choose English to Chinese or Chinese to English.')
  }
  return { text: request.text, source_language: request.source_language, target_language: request.target_language }
}

function headers(apiKey) {
  return { 'Content-Type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) }
}

async function translate(url, request, { signal, apiKey, fetchImpl = fetch } = {}) {
  const input = validateRequest(request)
  const response = await fetchImpl(`${validateUrl(url)}/runs/wait`, {
    method: 'POST', headers: headers(apiKey), signal, redirect: 'error',
    body: JSON.stringify({ assistant_id: 'translator', input }),
  })
  if (!response.ok) {
    if (response.status === 400) {
      const detail = await response.json().catch(() => ({}))
      if (typeof detail.detail === 'string' && detail.detail.startsWith("Invalid assistant: 'translator'")) {
        throw new Error('Translation graph not found. Update and restart generic-agent-service.')
      }
    }
    if (response.status === 404) throw new Error('Translation graph not found. Update and restart generic-agent-service.')
    if ([401, 403].includes(response.status)) throw new Error('Service access denied. Check the gateway authentication.')
    throw new Error(`Translation service returned HTTP ${response.status}. Check the agent service logs.`)
  }
  const result = await response.json()
  if (result?.__error__ || result?.error) throw new Error('Translation failed. Check the agent service logs.')
  if (typeof result?.translation !== 'string' || !result.translation.trim()) {
    throw new Error('The service returned no translation. Check the translator graph.')
  }
  return result.translation
}

async function checkConnection(url, { apiKey, fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${validateUrl(url)}/ok`, {
    headers: headers(apiKey), signal: AbortSignal.timeout(5000), redirect: 'error',
  })
  if (!response.ok) throw new Error(`Service returned HTTP ${response.status}.`)
  const body = await response.json()
  if (body?.ok !== true) throw new Error('This address is not a healthy LangGraph service.')
  return true
}

module.exports = { DEFAULT_URL, MAX_TEXT_LENGTH, validateUrl, validateRequest, translate, checkConnection }
