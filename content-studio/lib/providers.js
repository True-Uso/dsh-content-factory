/**
 * Video provider adapters.
 *
 * Three kinds, one contract:
 *   - `ark-seedance`  ByteDance Volcengine Ark (cloud, async task API) — reserved,
 *                     needs the model id from the Ark console before it can run.
 *   - `comfyui`       Local ComfyUI (the usual runtime for locally deployed
 *                     video models such as LTX). Workflow JSON + node outputs.
 *   - `http-generic`  Any self-hosted HTTP service, mapped by template + JSONPath.
 *
 * Contract (see SPEC FR-06):
 *   healthCheck(): Promise<{ ok, detail? }>
 *   submit(input): Promise<{ taskId }>
 *   poll(taskId):  Promise<{ state, videoUrl?, localPath?, error?, raw? }>
 *
 * `state` is always one of queued | running | succeeded | failed.
 */

import { pick } from './jsonpath.js'

export const PROVIDER_KINDS = ['ark-seedance', 'comfyui', 'http-generic']

export class ProviderError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.detail = detail
  }
}

const STATE_ALIASES = {
  queued: ['queued', 'pending', 'waiting', 'submitted', 'in_queue', 'inqueue'],
  running: ['running', 'processing', 'in_progress', 'inprogress', 'started', 'generating'],
  succeeded: ['succeeded', 'success', 'done', 'completed', 'complete', 'finished', 'ok'],
  failed: ['failed', 'failure', 'error', 'cancelled', 'canceled', 'timeout', 'rejected'],
}

/**
 * Map whatever a service calls its state onto our four states.
 *
 * A configured `stateMap` is authoritative: an unmapped value stays `running`
 * rather than silently matching a built-in alias — otherwise one typo in the
 * mapping would look like success.
 */
export function normalizeState(rawValue, stateMap) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return 'running'
  const key = String(rawValue).trim().toLowerCase()
  const core = ['queued', 'running', 'succeeded', 'failed']

  if (stateMap && typeof stateMap === 'object' && Object.keys(stateMap).length > 0) {
    for (const [state, aliases] of Object.entries(stateMap)) {
      if (!Array.isArray(aliases)) continue
      if (aliases.some((alias) => String(alias).trim().toLowerCase() === key)) return state
    }
    return core.includes(key) ? key : 'running'
  }

  for (const [state, aliases] of Object.entries(STATE_ALIASES)) {
    if (aliases.includes(key)) return state
  }
  return 'running'
}

/** `${name}` inside strings; a whole-string placeholder keeps the value's type. */
export function interpolate(value, vars) {
  if (typeof value === 'string') {
    const whole = /^\$\{([A-Za-z0-9_]+)\}$/.exec(value)
    if (whole) return vars[whole[1]]
    return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, key) => (vars[key] === undefined || vars[key] === null ? '' : String(vars[key])))
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, vars))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = interpolate(item, vars)
    return out
  }
  return value
}

function clamp(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function timing(cfg) {
  const poll = cfg.poll || {}
  return {
    intervalMs: clamp(poll.intervalMs, 250, 60000, 3000),
    timeoutMs: clamp(poll.timeoutMs, 5000, 6 * 3600 * 1000, 15 * 60 * 1000),
  }
}

function truncate(text, max = 600) {
  if (typeof text !== 'string') return text
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function buildVars(cfg, input) {
  const defaults = cfg.defaults || {}
  const vars = { ...defaults, ...input }
  const fps = Number(input.fps ?? defaults.fps ?? 24)
  const durationSec = Number(input.durationSec ?? defaults.durationSec ?? 5)
  vars.prompt = input.prompt ?? defaults.prompt ?? ''
  vars.negativePrompt = input.negativePrompt ?? defaults.negativePrompt ?? ''
  vars.seed = input.seed ?? defaults.seed ?? -1
  vars.durationSec = durationSec
  vars.aspectRatio = input.aspectRatio ?? defaults.aspectRatio ?? '9:16'
  vars.resolution = input.resolution ?? defaults.resolution ?? ''
  vars.width = Number(input.width ?? defaults.width ?? 1080)
  vars.height = Number(input.height ?? defaults.height ?? 1920)
  vars.fps = fps
  vars.frames = Math.max(1, Math.round(durationSec * fps))
  vars.imageUrl = input.imageRef ?? defaults.imageUrl ?? ''
  vars.firstFrame = input.imageRef ?? defaults.firstFrame ?? ''
  vars.lastFrame = input.lastFrameRef ?? defaults.lastFrame ?? ''
  vars.watermark = input.watermark ?? defaults.watermark ?? false
  return vars
}

async function requestJson(fetchImpl, url, init, signal) {
  const res = await fetchImpl(url, { ...init, signal })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    throw new ProviderError(`HTTP_${res.status}`, `${init.method || 'GET'} ${url} → ${res.status}`, truncate(text))
  }
  return data
}

function joinUrl(base, path) {
  if (/^https?:\/\//i.test(path)) return path
  return base + (path.startsWith('/') ? path : `/${path}`)
}

/* ------------------------------------------------------------------ */
/* http-generic                                                        */
/* ------------------------------------------------------------------ */

export function createHttpGeneric(cfg, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new ProviderError('BAD_CONFIG', 'http-generic 需要 baseUrl')
  const protocol = cfg.protocol || {}
  const extract = protocol.extract || {}

  async function call(spec, vars, signal) {
    const method = String(spec.method || 'GET').toUpperCase()
    const headers = { accept: 'application/json', ...(spec.headers || {}) }
    const url = joinUrl(base, String(interpolate(spec.path || '/', vars)))
    const init = { method, headers }
    if (spec.body !== undefined) {
      init.body = JSON.stringify(interpolate(spec.body, vars))
      headers['content-type'] = 'application/json'
    }
    return requestJson(fetchImpl, url, init, signal)
  }

  return {
    kind: 'http-generic',
    ...timing(cfg),

    async healthCheck() {
      if (!protocol.health) return { ok: true, detail: '未配置 protocol.health，跳过探测' }
      try {
        await call(protocol.health, buildVars(cfg, {}))
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: error.message }
      }
    },

    async submit(input, signal) {
      const vars = buildVars(cfg, input)
      const data = await call(protocol.submit || { method: 'POST', path: '/generate' }, vars, signal)
      const taskId = pickValue(data, extract.taskId || '$.id')
      if (taskId === undefined || taskId === null || taskId === '') {
        throw new ProviderError('NO_TASK_ID', '服务返回中没有解析到 taskId，请检查 protocol.extract.taskId', data)
      }
      return { taskId: String(taskId) }
    },

    async poll(taskId, signal) {
      const vars = buildVars(cfg, {})
      vars.taskId = taskId
      const data = await call(protocol.poll || { method: 'GET', path: '/tasks/${taskId}' }, vars, signal)
      const state = normalizeState(pickValue(data, extract.state || '$.status'), protocol.stateMap)
      const videoUrl = pickValue(data, extract.videoUrl)
      const localPath = pickValue(data, extract.localPath)
      const error = pickValue(data, extract.error)
      return {
        state,
        videoUrl: videoUrl ? String(videoUrl) : undefined,
        localPath: localPath ? String(localPath) : undefined,
        error: error ? String(error) : undefined,
        raw: data,
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* comfyui                                                             */
/* ------------------------------------------------------------------ */

function applyWorkflowVars(node, vars) {
  if (typeof node === 'string') {
    const whole = /^\{\{\s*([A-Za-z0-9_]+)\s*\}\}$/.exec(node)
    if (whole) return vars[whole[1]]
    return node.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => (vars[key] === undefined || vars[key] === null ? '' : String(vars[key])))
  }
  if (Array.isArray(node)) return node.map((item) => applyWorkflowVars(item, vars))
  if (node && typeof node === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(node)) out[key] = applyWorkflowVars(item, vars)
    return out
  }
  return node
}

function firstOutputFile(outputs) {
  if (!outputs || typeof outputs !== 'object') return undefined
  const wanted = ['gifs', 'videos', 'video', 'images']
  for (const key of wanted) {
    for (const node of Object.values(outputs)) {
      const files = node && node[key]
      if (Array.isArray(files) && files.length > 0) {
        const file = files[files.length - 1]
        if (file && file.filename) return file
      }
    }
  }
  return undefined
}

export async function createComfyUI(cfg, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new ProviderError('BAD_CONFIG', 'comfyui 需要 baseUrl')

  let workflow = cfg.workflow
  if (!workflow && cfg.workflowRef) {
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(cfg.workflowRef, 'utf8')
    workflow = JSON.parse(text)
  }
  if (!workflow || typeof workflow !== 'object') {
    throw new ProviderError('BAD_CONFIG', 'comfyui 需要 workflow 对象或 workflowRef 文件路径')
  }

  return {
    kind: 'comfyui',
    ...timing(cfg),

    async healthCheck() {
      try {
        await requestJson(fetchImpl, joinUrl(base, '/system_stats'), { method: 'GET', headers: { accept: 'application/json' } })
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: `${error.message}（检查 ComfyUI 是否已启动：${base}）` }
      }
    },

    async submit(input, signal) {
      const vars = buildVars(cfg, input)
      const body = { prompt: applyWorkflowVars(workflow, vars), client_id: 'content-studio' }
      const data = await requestJson(fetchImpl, joinUrl(base, '/prompt'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      }, signal)
      const taskId = data && (data.prompt_id || data.promptId)
      if (!taskId) throw new ProviderError('NO_TASK_ID', 'ComfyUI /prompt 未返回 prompt_id', data)
      return { taskId: String(taskId) }
    },

    async poll(taskId, signal) {
      let data
      try {
        data = await requestJson(fetchImpl, joinUrl(base, `/history/${encodeURIComponent(taskId)}`), {
          method: 'GET',
          headers: { accept: 'application/json' },
        }, signal)
      } catch (error) {
        // 任务还没进历史时，ComfyUI 可能返回空对象，也可能 404。
        // 404 是"还没轮到"，不是失败——按失败处理会让第一次轮询直接终止整条内容。
        if (error && error.code === 'HTTP_404') return { state: 'queued' }
        throw error
      }
      const entry = data && data[taskId]
      if (!entry) return { state: 'queued', raw: data }

      const status = entry.status || {}
      if (status.status_str === 'error') {
        return { state: 'failed', error: JSON.stringify(status.messages || 'ComfyUI 执行失败').slice(0, 600), raw: data }
      }
      const file = firstOutputFile(entry.outputs)
      if (!file) {
        return { state: status.completed ? 'failed' : 'running', error: status.completed ? '工作流没有输出视频文件' : undefined, raw: data }
      }
      const query = new URLSearchParams({
        filename: file.filename,
        subfolder: file.subfolder || '',
        type: file.type || 'output',
      })
      return { state: 'succeeded', videoUrl: `${base}/view?${query.toString()}`, raw: data }
    },
  }
}

/* ------------------------------------------------------------------ */
/* ark-seedance (reserved)                                             */
/* ------------------------------------------------------------------ */

/**
 * Reserved: the Ark console model id has not been issued yet. The adapter is
 * written against the documented async task API (create / query / cancel) and
 * refuses to run — loudly — until `modelId` and `apiKey` are configured.
 * Response field names follow the Ark task shape; recalibrate against the
 * console output for the exact model once the id exists.
 */
export function createArkSeedance(cfg, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch
  const base = String(cfg.baseUrl || 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks').replace(/\/+$/, '')
  const modelId = cfg.modelId
  const apiKey = cfg.apiKey || deps.apiKey

  function authHeaders() {
    const headers = { 'content-type': 'application/json', accept: 'application/json' }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    return headers
  }

  function notReady() {
    const missing = []
    if (!modelId) missing.push('modelId（方舟控制台的 Seedance 模型 ID）')
    if (!apiKey) missing.push('apiKey')
    if (missing.length === 0) return undefined
    return new ProviderError('ARK_NOT_CONFIGURED', `方舟 Seedance 尚未配置：缺少 ${missing.join('、')}。适配器已预留，填入后即可使用。`)
  }

  return {
    kind: 'ark-seedance',
    ...timing(cfg),

    async healthCheck() {
      const error = notReady()
      if (error) return { ok: false, detail: error.message }
      try {
        await requestJson(fetchImpl, base, { method: 'GET', headers: authHeaders() })
        return { ok: true }
      } catch (error) {
        return { ok: false, detail: error.message }
      }
    },

    async submit(input, signal) {
      const error = notReady()
      if (error) throw error
      const vars = buildVars(cfg, input)
      const content = [{ type: 'text', text: vars.prompt }]
      if (vars.imageUrl) content.push({ type: 'image_url', image_url: { url: vars.imageUrl } })
      const body = {
        model: modelId,
        content,
        ratio: vars.aspectRatio,
        duration: Math.round(vars.durationSec),
        watermark: Boolean(vars.watermark),
      }
      if (vars.seed >= 0) body.seed = vars.seed
      const data = await requestJson(fetchImpl, base, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      }, signal)
      const taskId = data && (data.id || data.task_id)
      if (!taskId) throw new ProviderError('NO_TASK_ID', '方舟未返回任务 id', data)
      return { taskId: String(taskId) }
    },

    async poll(taskId, signal) {
      const data = await requestJson(fetchImpl, `${base}/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: authHeaders(),
      }, signal)
      const state = normalizeState(data && data.status, {
        queued: ['queued', 'pending'],
        running: ['running', 'processing'],
        succeeded: ['succeeded'],
        failed: ['failed', 'cancelled'],
      })
      const videoUrl = data && data.content && data.content.video_url
      return {
        state,
        videoUrl: videoUrl ? String(videoUrl) : undefined,
        error: data && data.error ? JSON.stringify(data.error) : undefined,
        raw: data,
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* factory                                                             */
/* ------------------------------------------------------------------ */

/** Kinds that participate in one role each. `role` overrides the mapping. */
export const KIND_ROLE = {
  'ark-seedance': 'video',
  comfyui: 'video',
  'http-generic': 'video',
  llm: 'llm',
  tts: 'tts',
  image: 'image',
}

export function roleOf(cfg) {
  return cfg.role || KIND_ROLE[cfg.kind] || cfg.kind
}

export async function createProvider(cfg, deps = {}) {
  if (!cfg || typeof cfg !== 'object') throw new ProviderError('BAD_CONFIG', 'provider 配置缺失')
  switch (cfg.kind) {
    case 'ark-seedance':
      return createArkSeedance(cfg, deps)
    case 'comfyui':
      return createComfyUI(cfg, deps)
    case 'http-generic':
      return createHttpGeneric(cfg, deps)
    case 'llm': {
      const { createLlmProvider } = await import('./providers/llm.js')
      return createLlmProvider(cfg, deps)
    }
    case 'tts': {
      const { createSpeechProvider } = await import('./providers/tts.js')
      return createSpeechProvider(cfg, deps)
    }
    case 'image': {
      const { createImageProvider } = await import('./providers/image.js')
      return createImageProvider(cfg, deps)
    }
    default:
      throw new ProviderError('BAD_KIND', `未知适配器：${cfg.kind}`)
  }
}

/**
 * Build the role → instance map one pipeline run needs.
 * Enabled providers only; a disabled provider is the same as "not configured".
 */
export async function resolveRoleProviders(list, deps = {}) {
  const roles = {}
  for (const cfg of list) {
    if (cfg.enabled === false) continue
    const role = roleOf(cfg)
    if (roles[role]) continue
    try {
      roles[role] = await createProvider(cfg, deps)
      roles[role].__id = cfg.id
    } catch (error) {
      roles[`${role}:error`] = error.message
    }
  }
  return roles
}

function pickValue(data, path) {
  return pick(data, path)
}
