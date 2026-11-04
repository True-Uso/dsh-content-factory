/**
 * LLM adapter — OpenAI-compatible chat completions.
 *
 * Works with the official OpenAI endpoint, Azure-style gateways, and any
 * self-hosted `/v1/chat/completions` server, which is what the content pipeline
 * needs for script writing and EDL planning.
 */

export class LlmError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'LlmError'
    this.code = code
    this.detail = detail
  }
}

export function createLlmProvider(cfg = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch
  const baseUrl = String(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = cfg.model || 'gpt-4.1-mini'
  const timeoutMs = Number(cfg.timeoutMs) || 120000

  async function post(body, signal) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    try {
      const headers = { 'content-type': 'application/json', accept: 'application/json' }
      if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const text = await res.text()
      let data
      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { raw: text }
      }
      if (!res.ok) {
        throw new LlmError(`HTTP_${res.status}`, `LLM 请求失败：${res.status}`, String(text).slice(0, 600))
      }
      return data
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }

  return {
    id: cfg.id || 'llm',
    model,

    async healthCheck() {
      try {
        await post({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: error.message }
      }
    },

    /**
     * @param {{system: string, user: string, json?: boolean, temperature?: number, maxTokens?: number}} req
     */
    async complete(req, signal) {
      const body = {
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        temperature: req.temperature ?? cfg.temperature ?? 0.8,
      }
      if (req.maxTokens || cfg.maxTokens) body.max_tokens = req.maxTokens || cfg.maxTokens
      if (req.json) body.response_format = { type: 'json_object' }

      const data = await post(body, signal)
      const text = data?.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text.trim()) {
        throw new LlmError('EMPTY_RESPONSE', 'LLM 返回空内容', data)
      }
      return {
        text,
        json: req.json ? extractJson(text) : undefined,
        usage: data.usage || null,
      }
    },
  }
}

/** Pull the first JSON object/array out of a possibly fenced response. */
export function extractJson(text) {
  const raw = String(text || '').trim()
  if (!raw) throw new LlmError('EMPTY_RESPONSE', 'LLM 返回空内容')

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
  const candidate = fenced ? fenced[1].trim() : raw
  try {
    return JSON.parse(candidate)
  } catch {
    // fall through to bracket scan
  }
  const start = candidate.search(/[{[]/)
  if (start < 0) throw new LlmError('NO_JSON', 'LLM 返回中没有 JSON', raw.slice(0, 400))
  const open = candidate[start]
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escape = false
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index]
    if (inString) {
      if (escape) escape = false
      else if (char === '\\') escape = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) {
        const slice = candidate.slice(start, index + 1)
        try {
          return JSON.parse(slice)
        } catch (error) {
          throw new LlmError('BAD_JSON', `LLM 返回的 JSON 无法解析：${error.message}`, slice.slice(0, 400))
        }
      }
    }
  }
  throw new LlmError('NO_JSON', 'LLM 返回的 JSON 不完整', raw.slice(0, 400))
}
