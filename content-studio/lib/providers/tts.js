/**
 * TTS adapter.
 *
 * OpenAI-compatible hosts: POST `{base}/audio/speech`.
 * 百炼 / DashScope 的 compatible-mode 没有这条路径（404）。改打原生
 * `/api/v1/services/aigc/multimodal-generation/generation`，再下载返回的音频 URL。
 */

export class TtsError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'TtsError'
    this.code = code
    this.detail = detail
  }
}

function isDashScope(url) {
  return /dashscope\.aliyuncs\.com|maas\.aliyuncs\.com|\/compatible-mode\//i.test(url)
}

function dashOrigin(baseUrl) {
  return String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/compatible-mode\/v1$/i, '')
}

/** 工作空间里已经没有 qwen-tts 这个 id。 */
function resolveDashScopeTtsModel(model) {
  if (!model || model === 'qwen-tts' || model === 'qwen-tts-latest') return 'qwen3-tts-flash'
  return model
}

export function createSpeechProvider(cfg = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch
  const baseUrl = String(cfg.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')
  const model = cfg.model || 'qwen3-tts-flash'
  const voice = cfg.voice || 'Cherry'
  const format = cfg.format || 'wav'
  const timeoutMs = Number(cfg.timeoutMs) || 120000
  const native = isDashScope(baseUrl)

  return {
    id: cfg.id || 'tts',
    model: native ? resolveDashScopeTtsModel(model) : model,
    voice,

    async healthCheck() {
      try {
        if (native) {
          const origin = dashOrigin(baseUrl)
          const res = await fetchImpl(`${origin}/api/v1/models?capabilities=TTS&page_no=1&page_size=1`, {
            headers: { accept: 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
          })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return { ok: true }
        }
        await this.synthesize({ text: '测试', voice })
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: error.message }
      }
    },

    /**
     * @param {{text: string, voice?: string, speed?: number, signal?: AbortSignal}} req
     * @returns {Promise<{audio: Buffer, contentType: string, voiceUsed: string}>}
     */
    async synthesize(req) {
      const text = String(req.text || '').trim()
      if (!text) throw new TtsError('EMPTY_TEXT', '待合成文本为空')
      const voiceUsed = req.voice || voice

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const onAbort = () => controller.abort()
      if (req.signal) req.signal.addEventListener('abort', onAbort, { once: true })

      try {
        if (native) return await synthDashScope(fetchImpl, cfg, { text, voice: voiceUsed, signal: controller.signal })
        return await synthOpenAi(fetchImpl, { baseUrl, model, format, speed: req.speed ?? cfg.speed ?? 1, apiKey: cfg.apiKey }, { text, voice: voiceUsed, signal: controller.signal })
      } finally {
        clearTimeout(timer)
        if (req.signal) req.signal.removeEventListener('abort', onAbort)
      }
    },
  }
}

async function synthOpenAi(fetchImpl, cfg, req) {
  const headers = { 'content-type': 'application/json', accept: 'audio/*' }
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
  const res = await fetchImpl(`${cfg.baseUrl}/audio/speech`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      input: req.text,
      voice: req.voice,
      response_format: cfg.format,
      speed: cfg.speed,
    }),
    signal: req.signal,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new TtsError(`HTTP_${res.status}`, `TTS 请求失败：${res.status}`, String(detail).slice(0, 400))
  }
  const audio = Buffer.from(await res.arrayBuffer())
  if (audio.length < 64) throw new TtsError('EMPTY_AUDIO', 'TTS 返回的音频为空')
  return {
    audio,
    contentType: res.headers?.get?.('content-type') || 'application/octet-stream',
    voiceUsed: req.voice,
  }
}

async function synthDashScope(fetchImpl, cfg, req) {
  const origin = dashOrigin(cfg.baseUrl)
  const model = resolveDashScopeTtsModel(cfg.model)
  const headers = { 'content-type': 'application/json', accept: 'application/json' }
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
  const res = await fetchImpl(`${origin}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input: { text: req.text, voice: req.voice } }),
    signal: req.signal,
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) {
    throw new TtsError(`HTTP_${res.status}`, `TTS 请求失败：${res.status} ${data.message || data.code || ''}`.trim(), String(text).slice(0, 400))
  }
  const audioUrl = data?.output?.audio?.url
  if (!audioUrl) throw new TtsError('NO_AUDIO_URL', '百炼未返回音频地址', data)
  const audioRes = await fetchImpl(audioUrl, { signal: req.signal })
  if (!audioRes.ok) throw new TtsError('AUDIO_FETCH', `下载合成音频失败：${audioRes.status}`)
  const audio = Buffer.from(await audioRes.arrayBuffer())
  if (audio.length < 64) throw new TtsError('EMPTY_AUDIO', 'TTS 返回的音频为空')
  return { audio, contentType: audioRes.headers?.get?.('content-type') || 'audio/wav', voiceUsed: req.voice }
}
