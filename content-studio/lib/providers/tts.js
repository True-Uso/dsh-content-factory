/**
 * TTS adapter — OpenAI-compatible `/audio/speech`.
 *
 * Covers the DashScope compatible endpoint (`qwen-tts` on Bailian) and the
 * official OpenAI speech endpoint. Sentence-level timing comes from measuring the
 * returned audio, so no provider timestamp API is required; that keeps this
 * adapter usable with any speech service that can return WAV.
 */

export class TtsError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'TtsError'
    this.code = code
    this.detail = detail
  }
}

export function createSpeechProvider(cfg = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch
  const baseUrl = String(cfg.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')
  const model = cfg.model || 'qwen-tts'
  const voice = cfg.voice || 'Cherry'
  const format = cfg.format || 'wav'
  const timeoutMs = Number(cfg.timeoutMs) || 120000

  return {
    id: cfg.id || 'tts',
    model,
    voice,

    async healthCheck() {
      try {
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

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const onAbort = () => controller.abort()
      if (req.signal) req.signal.addEventListener('abort', onAbort, { once: true })

      try {
        const headers = { 'content-type': 'application/json', accept: 'audio/*' }
        if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
        const res = await fetchImpl(`${baseUrl}/audio/speech`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            input: text,
            voice: req.voice || voice,
            response_format: format,
            speed: req.speed ?? cfg.speed ?? 1,
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw new TtsError(`HTTP_${res.status}`, `TTS 请求失败：${res.status}`, String(detail).slice(0, 400))
        }
        const arrayBuffer = await res.arrayBuffer()
        const audio = Buffer.from(arrayBuffer)
        if (audio.length < 64) throw new TtsError('EMPTY_AUDIO', 'TTS 返回的音频为空')
        return {
          audio,
          contentType: res.headers?.get?.('content-type') || 'application/octet-stream',
          voiceUsed: req.voice || voice,
        }
      } finally {
        clearTimeout(timer)
        if (req.signal) req.signal.removeEventListener('abort', onAbort)
      }
    },
  }
}
