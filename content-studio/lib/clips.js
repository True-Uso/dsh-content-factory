/**
 * 镜头墙：生成的 5 秒片落在 ~/.content-studio/clips，成片再拼进批次。
 */

import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dataDir } from './store.js'
import { createBatch, markStep, writeJson } from './batch-store.js'
import { concatVideos, lastFrameDataUrl, probe, resolveTools } from './ffmpeg.js'
import { extractThumbnail } from './steps/render.js'
import { runToCompletion } from './runner.js'

export function clipsRoot() {
  return join(dataDir(), 'clips')
}

export function clipFile(id) {
  return join(clipsRoot(), `${id}.mp4`)
}

function indexFile() {
  return join(clipsRoot(), 'index.json')
}

let chain = Promise.resolve()
function lock(fn) {
  const run = chain.then(fn, fn)
  chain = run.then(() => {}, () => {})
  return run
}

async function readIndex() {
  try {
    const parsed = JSON.parse(await readFile(indexFile(), 'utf8'))
    return Array.isArray(parsed?.clips) ? parsed.clips : []
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
}

export async function listClips() {
  return lock(() => readIndex())
}

export async function getClip(id) {
  return (await listClips()).find((clip) => clip.id === id)
}

export async function upsertClip(patch) {
  return lock(async () => {
    await mkdir(clipsRoot(), { recursive: true })
    const clips = await readIndex()
    const index = clips.findIndex((clip) => clip.id === patch.id)
    const next = { ...(index >= 0 ? clips[index] : {}), ...patch, updatedAt: Date.now() }
    if (index >= 0) clips[index] = next
    else clips.unshift(next)
    await writeFile(indexFile(), JSON.stringify({ version: 1, clips }, null, 2), 'utf8')
    return next
  })
}

export function publicClip(clip, prefix = '/content-studio/api') {
  if (!clip) return clip
  return {
    id: clip.id,
    prompt: clip.prompt,
    status: clip.status,
    error: clip.error,
    durationSec: clip.durationSec,
    aspectRatio: clip.aspectRatio,
    resolution: clip.resolution,
    createdAt: clip.createdAt,
    updatedAt: clip.updatedAt,
    url: clip.status === 'succeeded' ? `${prefix}/clips/${encodeURIComponent(clip.id)}/file` : undefined,
  }
}

export function newClipId(now = Date.now()) {
  return `clip-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export async function removeClip(id) {
  return lock(async () => {
    const clips = await readIndex()
    await writeFile(indexFile(), JSON.stringify({ version: 1, clips: clips.filter((clip) => clip.id !== id) }, null, 2), 'utf8')
    await rm(clipFile(id), { force: true })
  })
}

export async function materializeVideo(finished, dest) {
  await mkdir(dirname(dest), { recursive: true })
  if (finished.localPath) {
    await copyFile(finished.localPath, dest)
    return dest
  }
  if (finished.videoUrl) {
    const res = await fetch(finished.videoUrl)
    if (!res.ok) throw new Error(`下载生成视频失败：${res.status}`)
    await writeFile(dest, Buffer.from(await res.arrayBuffer()))
    return dest
  }
  throw new Error('视频任务成功但既没有 videoUrl 也没有 localPath')
}

export const MAX_CLIP_SEC = 180
export const WAN_CHUNK_SEC = 30

export function normalizeClipSec(n, fallback = 30) {
  const x = Math.round(Number(n))
  if (!Number.isFinite(x) || x <= 0) return fallback
  if (x < 5) return 5
  return Math.min(MAX_CLIP_SEC, x)
}

export async function generateClip(clip, video) {
  try {
    const durationSec = normalizeClipSec(clip.durationSec, 5)
    const dest = clipFile(clip.id)
    const tools = await resolveTools()
    const taskIds = []
    if (durationSec <= WAN_CHUNK_SEC) {
      const finished = await runToCompletion(video, {
        prompt: clip.prompt,
        durationSec,
        aspectRatio: clip.aspectRatio || '9:16',
        resolution: clip.resolution || '480P',
        imageRef: clip.imageUrl,
      })
      taskIds.push(finished.taskId)
      await materializeVideo(finished, dest)
    } else {
      if (!tools.ok) throw new Error(tools.error)
      const parts = []
      let remain = durationSec
      let frame = clip.imageUrl
      let index = 0
      try {
        while (remain > 0) {
          const dur = Math.min(WAN_CHUNK_SEC, remain)
          const finished = await runToCompletion(video, {
            prompt: index === 0 ? clip.prompt : `${clip.prompt}。承接上一镜最后一帧继续拍，动作连贯。`,
            durationSec: dur,
            aspectRatio: clip.aspectRatio || '9:16',
            resolution: clip.resolution || '480P',
            imageRef: frame,
          })
          taskIds.push(finished.taskId)
          const part = join(clipsRoot(), `${clip.id}-p${index}.mp4`)
          await materializeVideo(finished, part)
          parts.push(part)
          remain -= dur
          index += 1
          if (remain > 0) frame = await lastFrameDataUrl(tools, part)
        }
        const first = await probe(tools, parts[0])
        await concatVideos(tools, parts, dest, { width: first.width, height: first.height })
      } finally {
        await Promise.all(parts.map((part) => rm(part, { force: true })))
      }
    }
    const info = tools.ok ? await probe(tools, dest).catch(() => ({})) : {}
    return upsertClip({
      id: clip.id,
      status: 'succeeded',
      file: dest,
      taskId: taskIds.filter(Boolean).join(','),
      durationSec: info.durationSec || durationSec,
      width: info.width,
      height: info.height,
      error: null,
    })
  } catch (error) {
    const who = video.__id || video.kind || 'video'
    return upsertClip({ id: clip.id, status: 'failed', error: `${who}: ${error.message || error}` })
  }
}

export async function assembleFilm(input = {}) {
  const ids = Array.isArray(input.clipIds) ? input.clipIds : []
  const all = await listClips()
  const selected = ids
    .map((id) => all.find((clip) => clip.id === id))
    .filter((clip) => clip && clip.status === 'succeeded' && clip.file)
  if (selected.length === 0) {
    throw Object.assign(new Error('请勾选已生成的镜头'), { status: 400 })
  }

  const requested = normalizeClipSec(input.targetSec, 30)
  const picked = []
  let total = 0
  for (const clip of selected) {
    picked.push(clip)
    total += Number(clip.durationSec) || 5
    if (total >= requested) break
  }
  // 画面不够长就按实际时长成片，不再循环同一镜去凑 30 秒。
  const wanted = total >= requested - 0.8 ? requested : Math.max(5, Math.round(total))

  const tools = await resolveTools()
  if (!tools.ok) throw Object.assign(new Error(tools.error), { status: 400 })

  const first = await probe(tools, picked[0].file)
  const prompt = String(input.prompt || picked[0].prompt || '成片').trim()
  const aspectRatio = input.aspectRatio || picked[0].aspectRatio || '9:16'
  const resolution = input.resolution || picked[0].resolution || '480P'

  const batch = await createBatch({
    title: prompt.slice(0, 40),
    count: 1,
    config: {
      topic: prompt.slice(0, 80),
      aspectRatio,
      resolution,
      targetSec: wanted,
      shotCount: picked.length,
      materialMode: 'pool',
      reviewMode: 'required',
      clipIds: picked.map((clip) => clip.id),
    },
  })
  const item = batch.items[0]
  const visualDir = join(item.dir, '04-visual')
  await mkdir(visualDir, { recursive: true })

  const shots = []
  for (let index = 0; index < picked.length; index += 1) {
    const dest = join(visualDir, `shot-${String(index + 1).padStart(2, '0')}.mp4`)
    await copyFile(picked[index].file, dest)
    shots.push({
      index,
      path: dest,
      kind: 'video',
      durationSec: picked[index].durationSec || 5,
      inSec: 0,
      intent: picked[index].prompt || '',
      source: 'generate',
      clipId: picked[index].id,
    })
  }
  await writeJson(join(visualDir, 'manifest.json'), shots)
  await markStep(batch.id, item.id, 'visual', { status: 'done', error: null })

  const filmPath = join(dataDir(), 'films', `${batch.id}.mp4`)
  await concatVideos(tools, shots.map((shot) => shot.path), filmPath, {
    width: first.width,
    height: first.height,
  })
  const renderDir = join(item.dir, '06-render')
  await mkdir(renderDir, { recursive: true })
  await copyFile(filmPath, join(renderDir, 'master.mp4'))
  await extractThumbnail(tools, filmPath, join(renderDir, 'thumb.jpg'), 1).catch(() => {})

  const info = await probe(tools, filmPath)
  return {
    batch, filmPath, durationSec: info.durationSec || total, clipIds: picked.map((clip) => clip.id),
    visualSec: total, requested, shortfall: total + 0.8 < requested,
  }
}
