/**
 * DashScope 万相文生视频（wan2.2-t2v-plus，5 秒无声）。
 *
 * 480P / 1080P；720P 没有，UI 不要开。有公网参考图时改走 i2v。
 */

import { ProviderError, describeFetchError, normalizeState } from '../providers.js'

const T2V = 'wan2.2-t2v-plus'
const I2V = 'wan2.2-i2v-plus'
const ORIGIN = 'https://dashscope.aliyuncs.com'

const SIZE = {
  '9:16': { '480P': '480*832', '720P': '720*1280', '1080P': '1080*1920' },
  '16:9': { '480P': '832*480', '720P': '1280*720', '1080P': '1920*1080' },
  '1:1': { '480P': '624*624', '720P': '960*960', '1080P': '1440*1440' },
}

export function wanSize(aspectRatio = '9:16', resolution = '480P') {
  const res = resolution === '1080P' ? '1080P' : resolution === '720P' ? '720P' : '480P'
  const table = SIZE[aspectRatio] || SIZE['9:16']
  return table[res]
}

function isImageOnly(model) {
  const s = String(model || '').toLowerCase()
  return /image/.test(s) && !/(t2v|i2v|r2v|video)/.test(s)
}

function pairI2v(model) {
  const m = String(model || '')
  if (/wan3\.0-video/i.test(m)) return m
  if (/t2v/i.test(m)) return m.replace(/t2v/i, 'i2v')
  return m || I2V
}

/** 没参考图时不能打 i2v。2.2 没有 t2v-flash，落到 t2v-plus。 */
function pairT2v(model) {
  const m = String(model || '')
  if (/wan3\.0-video/i.test(m)) return m
  const swapped = m.replace(/i2v-flash/i, 't2v').replace(/i2v/i, 't2v')
  if (/wan2\.2-t2v$/i.test(swapped)) return 'wan2.2-t2v-plus'
  return swapped || T2V
}

function maxDuration(model) {
  const id = String(model || '').toLowerCase()
  if (/wan3\.0/.test(id)) return 30
  if (/wan2\.[67]/.test(id)) return 15
  if (/wan2\.5/.test(id)) return 10
  return 5
}

function clampDuration(model, sec) {
  const n = Math.round(Number(sec) || 5)
  const max = maxDuration(model)
  if (/wan3\.0/.test(String(model || ''))) return Math.min(30, Math.max(2, n))
  if (/wan2\.7/.test(String(model || ''))) return Math.min(15, Math.max(2, n))
  if (max <= 5) return 5
  if (n >= 15 && max >= 15) return 15
  if (n >= 10 && max >= 10) return 10
  return 5
}

/** 2.2 只有 5 秒。要 15/30 秒就换能出够长的万相，避免成片循环同一镜。 */
function pickLongModel(model, durationSec) {
  const want = Number(durationSec) || 5
  if (want <= maxDuration(model)) return model
  return want > 15 ? 'wan3.0-video' : 'wan2.6-t2v'
}

function isImageRef(value) {
  const s = String(value || '')
  return /^https?:\/\//i.test(s) || /^data:image\//i.test(s)
}

function wanInput(model, prompt, imageUrl) {
  if (!imageUrl) return { prompt }
  if (/wan3\.0/.test(String(model || ''))) return { prompt, media: [{ type: 'first_frame', url: imageUrl }] }
  return { prompt, img_url: imageUrl }
}

function wanParams(model, input) {
  const id = String(model || '').toLowerCase()
  const aspect = input.aspectRatio || '9:16'
  const duration = clampDuration(model, input.durationSec)
  let res = input.resolution === '1080P' ? '1080P' : input.resolution === '720P' ? '720P' : '480P'
  if ((/wan2\.[67]|wan3\.0|wanx?2\.1/.test(id)) && res === '480P') res = '720P'
  if (/wan3\.0|wan2\.7/.test(id)) {
    return { resolution: res, ratio: aspect, duration, prompt_extend: true }
  }
  return { size: wanSize(aspect, res), duration, prompt_extend: true }
}

/** 百炼源站。表单填 origin；误把兼容/提交地址贴进来时剥掉路径。 */
export function wanOrigin(cfg = {}) {
  const raw = String(cfg.origin || cfg.baseUrl || ORIGIN).trim() || ORIGIN
  return raw
    .replace(/\/+$/, '')
    .replace(/\/compatible-mode\/v1$/i, '')
    .replace(/\/api\/v1\/services\/aigc\/video-generation\/video-synthesis$/i, '')
}

export function createWanT2v(cfg = {}, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch
  const origin = wanOrigin(cfg)
  const submitUrl = String(cfg.baseUrl || '').includes('video-synthesis')
    ? String(cfg.baseUrl)
    : `${origin}/api/v1/services/aigc/video-generation/video-synthesis`
  const taskUrl = String(cfg.taskUrl || `${origin}/api/v1/tasks`).replace(/\/+$/, '')
  const apiKey = cfg.apiKey || deps.apiKey
  const t2v = cfg.model || T2V

  function headers(async = false) {
    const out = { accept: 'application/json' }
    if (apiKey) out.authorization = `Bearer ${apiKey}`
    if (async) {
      out['content-type'] = 'application/json'
      out['x-dashscope-async'] = 'enable'
    }
    return out
  }

  return {
    kind: 'dashscope-wan',
    intervalMs: Number(cfg.poll?.intervalMs) > 0 ? Number(cfg.poll.intervalMs) : 5000,
    timeoutMs: Number(cfg.poll?.timeoutMs) > 0 ? Number(cfg.poll.timeoutMs) : 15 * 60 * 1000,

    async healthCheck() {
      if (!apiKey) return { ok: false, detail: '缺少 apiKey（百炼 DashScope）' }
      try {
        await requestJson(fetchImpl, `${origin}/compatible-mode/v1/models`, {
          method: 'GET',
          headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: error.message }
      }
    },

    async submit(input, signal) {
      if (!apiKey) throw new ProviderError('NO_KEY', '未配置百炼 apiKey')
      const prompt = String(input.prompt || '').trim()
      if (!prompt) throw new ProviderError('EMPTY_PROMPT', '提示词不能为空')
      const imageUrl = isImageRef(input.imageRef) ? String(input.imageRef) : ''
      const want = Number(input.durationSec) || 5
      const model = imageUrl
        ? (want > 5 || /^data:image\//i.test(imageUrl) ? 'wan3.0-video' : (cfg.i2vModel || pairI2v(t2v)))
        : pickLongModel(pairT2v(t2v), want)
      if (isImageOnly(model)) {
        throw new ProviderError('NOT_VIDEO', `「${model}」是图片模型，不能走视频接口。请改选 wan2.6-t2v 或 wan3.0-video，保存后再试生成。`)
      }
      const body = {
        model,
        input: wanInput(model, prompt, imageUrl),
        parameters: wanParams(model, input),
      }
      const data = await requestJson(fetchImpl, submitUrl, {
        method: 'POST',
        headers: headers(true),
        body: JSON.stringify(body),
      }, signal)
      const taskId = data?.output?.task_id || data?.task_id || data?.output?.taskId
      if (!taskId) throw new ProviderError('NO_TASK_ID', '万相未返回任务 id', data)
      return { taskId: String(taskId) }
    },

    async poll(taskId, signal) {
      const data = await requestJson(fetchImpl, `${taskUrl}/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: headers(false),
      }, signal)
      const output = data?.output || data || {}
      const state = normalizeState(output.task_status || output.status, {
        queued: ['pending', 'queued', 'pending_queued'],
        running: ['running', 'processing'],
        succeeded: ['succeeded', 'success'],
        failed: ['failed', 'canceled', 'cancelled', 'unknown'],
      })
      const videoUrl = output.video_url || output.videoUrl || output.results?.video_url
      return {
        state,
        videoUrl: videoUrl ? String(videoUrl) : undefined,
        error: output.message || output.code || (data && data.message) || undefined,
        raw: data,
      }
    },
  }
}

async function requestJson(fetchImpl, url, init, signal) {
  let res
  try {
    res = await fetchImpl(url, { ...init, signal })
  } catch (error) {
    throw new ProviderError('FETCH', describeFetchError(error, url), error && error.cause)
  }
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const detail = data.message || data.code || text.slice(0, 400)
    throw new ProviderError(`HTTP_${res.status}`, `${init.method || 'GET'} ${url} → ${res.status} ${detail}`)
  }
  return data
}
