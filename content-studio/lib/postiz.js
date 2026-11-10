import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from './store.js'

const DEFAULT_URL = 'https://api.postiz.com'

export function postizFile() {
  return join(dataDir(), 'postiz.json')
}

export function postizApiRoot(apiUrl) {
  const raw = String(apiUrl || DEFAULT_URL).trim().replace(/\/+$/, '')
  if (/\/public\/v1$/i.test(raw)) return raw
  if (/\/api$/i.test(raw)) return `${raw}/public/v1`
  return `${raw}/public/v1`
}

export async function loadPostiz() {
  let saved = {}
  try {
    saved = JSON.parse(await readFile(postizFile(), 'utf8')) || {}
  } catch (error) {
    if (error && error.code !== 'ENOENT') throw error
  }
  return {
    apiUrl: process.env.POSTIZ_API_URL || saved.apiUrl || DEFAULT_URL,
    apiKey: process.env.POSTIZ_API_KEY || saved.apiKey || '',
  }
}

export async function savePostiz(patch) {
  const previous = await loadPostiz()
  const next = {
    apiUrl: String(patch.apiUrl || previous.apiUrl || DEFAULT_URL).trim() || DEFAULT_URL,
    apiKey: patch.apiKey === '' || patch.apiKey === null
      ? ''
      : (patch.apiKey && patch.apiKey !== '__stored__' ? String(patch.apiKey) : previous.apiKey),
  }
  await mkdir(dataDir(), { recursive: true })
  await writeFile(postizFile(), JSON.stringify({ ...next, updatedAt: Date.now() }, null, 2), 'utf8')
  return next
}

export function publicPostiz(cfg) {
  return {
    configured: Boolean(cfg?.apiKey),
    apiUrl: cfg?.apiUrl || DEFAULT_URL,
    hasApiKey: Boolean(cfg?.apiKey),
  }
}

function htmlLine(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function postCopy(script = {}) {
  const blocks = [script.title, script.description, (script.hashtags || []).join(' ')]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .map((part) => `<p>${htmlLine(part)}</p>`)
  return blocks.join('') || '<p></p>'
}

export function settingsFor(identifier, script = {}) {
  const title = String(script.title || '').slice(0, 100) || '短视频'
  if (identifier === 'tiktok') {
    return {
      __type: 'tiktok',
      content_posting_method: 'DIRECT_POST',
      privacy_level: 'PUBLIC_TO_EVERYONE',
      duet: true,
      stitch: true,
      comment: true,
      brand_content_toggle: false,
      brand_organic_toggle: false,
    }
  }
  if (identifier === 'youtube') {
    return {
      __type: 'youtube',
      title,
      type: 'public',
      selfDeclaredMadeForKids: false,
      tags: (script.hashtags || []).map((tag) => String(tag).replace(/^#/, '')).filter(Boolean).slice(0, 10),
    }
  }
  if (identifier === 'instagram' || identifier === 'instagram-standalone') {
    return { __type: identifier, post_type: 'reel' }
  }
  return { __type: identifier }
}

async function postizFetch(cfg, path, options = {}) {
  const key = cfg.apiKey
  if (!key) {
    const error = new Error('还没接 Postiz。在待分发页填 API 地址和密钥。')
    error.status = 400
    throw error
  }
  const headers = { Authorization: key, ...(options.headers || {}) }
  const res = await (options.fetch || fetch)(`${postizApiRoot(cfg.apiUrl)}${path}`, { ...options, headers })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  if (!res.ok) {
    const detail = json.error || json.message || json.raw || text
    const error = new Error(`Postiz ${res.status}：${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    error.status = res.status === 401 ? 400 : res.status
    throw error
  }
  return json
}

export async function listChannels(cfg, deps = {}) {
  const rows = await postizFetch(cfg, '/integrations', { fetch: deps.fetch })
  const list = Array.isArray(rows) ? rows : []
  return list.filter((row) => row && row.id && row.disabled !== true).map((row) => ({
    id: row.id,
    name: row.name || row.profile || row.id,
    identifier: row.identifier,
    profile: row.profile || '',
  }))
}

export async function uploadVideo(cfg, filePath, deps = {}) {
  const bytes = await readFile(filePath)
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'master.mp4')
  const uploaded = await postizFetch(cfg, '/upload', { method: 'POST', body: form, fetch: deps.fetch })
  if (!uploaded?.id || !uploaded?.path) throw new Error('Postiz 上传成功但没有返回文件地址')
  return { id: uploaded.id, path: uploaded.path }
}

export async function publishToChannel(cfg, input, channel, deps = {}) {
  const media = input.media || await uploadVideo(cfg, input.videoPath, deps)
  const content = postCopy(input.script)
  const payload = {
    type: 'now',
    date: new Date().toISOString(),
    shortLink: false,
    tags: [],
    posts: [{
      integration: { id: channel.id },
      value: [{ content, image: [media] }],
      settings: settingsFor(channel.identifier, input.script),
    }],
  }
  const created = await postizFetch(cfg, '/posts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    fetch: deps.fetch,
  })
  return {
    at: Date.now(),
    channel: { id: channel.id, name: channel.name, identifier: channel.identifier },
    media,
    posts: created,
  }
}

export async function distributeItem(cfg, input, deps = {}) {
  const ids = [...new Set((input.integrationIds || []).filter(Boolean))]
  if (ids.length === 0) {
    const error = new Error('先勾选要发到的账号')
    error.status = 400
    throw error
  }
  const channels = await listChannels(cfg, deps)
  const picked = ids.map((id) => {
    const channel = channels.find((row) => row.id === id)
    if (!channel) {
      const error = new Error(`找不到 Postiz 账号：${id}`)
      error.status = 400
      throw error
    }
    return channel
  })
  let media = null
  const results = []
  for (const channel of picked) {
    const result = await publishToChannel(cfg, { ...input, media }, channel, deps)
    media = result.media
    results.push(result)
  }
  return {
    at: Date.now(),
    channels: picked.map((channel) => ({ id: channel.id, name: channel.name, identifier: channel.identifier })),
    media,
    posts: results.map((result) => result.posts),
  }
}
