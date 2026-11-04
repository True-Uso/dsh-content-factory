/**
 * Image provider — OpenAI-compatible `/images/generations`.
 *
 * Used for the cover *background only*: the Chinese headline is composited
 * locally by the cover step, because image models reliably mangle CJK glyphs and
 * rewriting a title must never cost another generation.
 */

export class ImageError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'ImageError'
    this.code = code
    this.detail = detail
  }
}

export function createImageProvider(cfg = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch
  const baseUrl = String(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const model = cfg.model || 'gpt-image-1'
  const timeoutMs = Number(cfg.timeoutMs) || 180000

  return {
    id: cfg.id || 'image',
    model,

    async healthCheck() {
      return { ok: Boolean(cfg.apiKey) || Boolean(cfg.baseUrl), detail: cfg.apiKey ? undefined : '未配置 apiKey 时将使用本地合成底图' }
    },

    /**
     * @param {{prompt: string, size?: string, signal?: AbortSignal}} req
     * @returns {Promise<{image: Buffer, contentType: string}>}
     */
    async generate(req) {
      if (!req?.prompt) throw new ImageError('EMPTY_PROMPT', '封面提示词为空')

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const onAbort = () => controller.abort()
      if (req.signal) req.signal.addEventListener('abort', onAbort, { once: true })

      try {
        const headers = { 'content-type': 'application/json', accept: 'application/json' }
        if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`
        const res = await fetchImpl(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            prompt: req.prompt,
            size: req.size || cfg.size || '1024x1536',
            n: 1,
            response_format: cfg.responseFormat || 'b64_json',
          }),
          signal: controller.signal,
        })
        const text = await res.text()
        let data
        try {
          data = text ? JSON.parse(text) : {}
        } catch {
          data = { raw: text }
        }
        if (!res.ok) throw new ImageError(`HTTP_${res.status}`, `生图请求失败：${res.status}`, String(text).slice(0, 400))

        const first = data?.data?.[0]
        if (!first) throw new ImageError('NO_IMAGE', '生图返回中没有图片', data)

        if (first.b64_json) {
          return { image: Buffer.from(first.b64_json, 'base64'), contentType: 'image/png' }
        }
        if (first.url) {
          const imageRes = await fetchImpl(first.url, { signal: controller.signal })
          if (!imageRes.ok) throw new ImageError('DOWNLOAD_FAILED', `下载封面图失败：${imageRes.status}`)
          return { image: Buffer.from(await imageRes.arrayBuffer()), contentType: imageRes.headers?.get?.('content-type') || 'image/png' }
        }
        throw new ImageError('NO_IMAGE', '生图返回既没有 b64_json 也没有 url', data)
      } finally {
        clearTimeout(timer)
        if (req.signal) req.signal.removeEventListener('abort', onAbort)
      }
    },
  }
}
