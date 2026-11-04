import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, open, readdir, stat } from 'node:fs/promises'
import { dirname, extname, join, relative } from 'node:path'
import { dataDir } from '../store.js'
import { probe } from '../ffmpeg.js'

export const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'])
export const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp'])
export const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac'])

const INDEX_VERSION = 1

/**
 * Material index (SPEC FR-02).
 *
 * The operator organises the library; this module only reads it. No tagging, no
 * semantic guessing — `dirGroup` is simply the first path segment under the
 * configured root, which is the operator's own classification.
 */

export function indexFile() {
  return join(dataDir(), 'materials.json')
}

export async function loadIndex() {
  const { readJson } = await import('../batch-store.js')
  const data = await readJson(indexFile())
  if (!data || data.version !== INDEX_VERSION || !Array.isArray(data.entries)) {
    return { version: INDEX_VERSION, entries: [] }
  }
  return data
}

export async function saveIndex(index) {
  const { writeJson } = await import('../batch-store.js')
  await mkdir(dirname(indexFile()), { recursive: true })
  await writeJson(indexFile(), { ...index, version: INDEX_VERSION, updatedAt: Date.now() })
  return index
}

/** Cheap identity: size + head/tail bytes. Whole-file hashing a 2GB video is pointless here. */
async function fingerprint(file, size) {
  const handle = await open(file, 'r')
  try {
    const head = Buffer.alloc(Math.min(65536, size))
    await handle.read(head, 0, head.length, 0)
    const tailLength = Math.min(65536, Math.max(0, size - head.length))
    const tail = Buffer.alloc(tailLength)
    if (tailLength > 0) await handle.read(tail, 0, tailLength, Math.max(0, size - tailLength))
    return createHash('sha1').update(String(size)).update(head).update(tail).digest('hex')
  } finally {
    await handle.close()
  }
}

async function walk(root, out) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'EACCES')) return
    throw error
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      await walk(full, out)
      continue
    }
    out.push(full)
  }
}

async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * Scan the configured roots and merge into the index.
 * Returns the merged index plus per-run statistics.
 */
export async function scanMaterials({ dirs, tools, concurrency = 4, onProgress } = {}) {
  const roots = (dirs || []).filter((dir) => typeof dir === 'string' && dir.trim())
  if (roots.length === 0) throw new Error('素材目录为空：至少配置一个目录')

  const index = await loadIndex()
  const known = new Map(index.entries.map((entry) => [entry.path, entry]))
  const stats = { scanned: 0, added: 0, updated: 0, unchanged: 0, invalid: 0, skipped: 0, removed: 0 }
  const invalid = []

  const files = []
  for (const root of roots) {
    const found = []
    await walk(root, found)
    for (const file of found) {
      const extension = extname(file).toLowerCase()
      if (!VIDEO_EXT.has(extension) && !IMAGE_EXT.has(extension) && !AUDIO_EXT.has(extension)) {
        stats.skipped += 1
        continue
      }
      files.push({ file, root })
    }
  }

  await pool(files, concurrency, async ({ file, root }, position) => {
    stats.scanned += 1
    onProgress?.({ scanned: stats.scanned, total: files.length, file })
    let info
    try {
      info = await stat(file)
    } catch {
      stats.invalid += 1
      invalid.push({ path: file, reason: '无法读取' })
      return
    }

    const previous = known.get(file)
    if (previous && previous.sizeBytes === info.size && previous.mtimeMs === Math.round(info.mtimeMs)) {
      stats.unchanged += 1
      // keep the operator-visible group in sync when a folder is renamed
      previous.dirGroup = groupOf(root, file)
      return
    }

    const extension = extname(file).toLowerCase()
    const kind = VIDEO_EXT.has(extension) ? 'video' : IMAGE_EXT.has(extension) ? 'image' : 'audio'
    let details = {}
    try {
      // 图片也走 ffprobe：能拿到尺寸，便于按分辨率过滤小图；时长恒为 0
      details = await probe(tools, file)
      if (kind === 'image') details.durationSec = 0
    } catch (error) {
      stats.invalid += 1
      invalid.push({ path: file, reason: String(error?.message || error).slice(0, 200) })
      return
    }

    const fingerprintValue = await fingerprint(file, info.size).catch(() => null)
    const entry = {
      path: file,
      relPath: relative(dirname(root), file),
      dirGroup: groupOf(root, file),
      kind,
      sizeBytes: info.size,
      mtimeMs: Math.round(info.mtimeMs),
      hash: fingerprintValue,
      durationSec: details.durationSec ?? 0,
      width: details.width ?? null,
      height: details.height ?? null,
      fps: details.fps ?? null,
      videoCodec: details.videoCodec ?? null,
      hasAudio: details.hasAudio ?? false,
      usedCount: previous?.usedCount ?? 0,
      lastUsedAt: previous?.lastUsedAt ?? null,
      indexedAt: Date.now(),
    }

    if (previous) {
      Object.assign(previous, entry)
      stats.updated += 1
    } else {
      index.entries.push(entry)
      known.set(file, entry)
      stats.added += 1
    }
  })

  // 删掉已经不存在的条目，以及这次探测失败（损坏）的条目
  const seen = new Set(files.map((entry) => entry.file))
  const broken = new Set(invalid.map((entry) => entry.path))
  index.entries = index.entries.filter((entry) => !broken.has(entry.path))
  stats.removed = pruneMissing(index, roots, seen)

  await saveIndex(index)
  return { index, stats, invalid }
}

/**
 * 只清理「本次扫过的根目录」下已经不存在的条目。
 * 不这么做的话，运营删掉/移走素材后索引仍留着旧路径，选材会选中一个不存在的文件，
 * 流水线在复制那一步才失败，错误信息还看不出是素材没了。
 */
export function pruneMissing(index, roots, seen) {
  const normalizedRoots = (roots || []).map((root) => root.replace(/\\/g, '/').replace(/\/+$/, ''))
  const before = index.entries.length
  index.entries = index.entries.filter((entry) => {
    const path = String(entry.path || '').replace(/\\/g, '/')
    if (seen.has(entry.path)) return true
    const underScannedRoot = normalizedRoots.some((root) => path === root || path.startsWith(`${root}/`))
    return !underScannedRoot
  })
  return before - index.entries.length
}

function groupOf(root, file) {
  const rel = relative(root, file)
  const parts = rel.split(/[\\/]/)
  return parts.length > 1 ? parts[0] : '未分组'
}

/** Mark a material as used so later batches prefer fresh footage. */
export async function markUsed(paths) {
  const index = await loadIndex()
  const stamp = Date.now()
  let changed = 0
  for (const entry of index.entries) {
    if (paths.includes(entry.path)) {
      entry.usedCount = (entry.usedCount || 0) + 1
      entry.lastUsedAt = stamp
      changed += 1
    }
  }
  if (changed > 0) await saveIndex(index)
  return changed
}

/**
 * Pick shots for one item (SPEC FR-02 §4).
 * `folder` keeps a batch thematically coherent; `pool` ignores grouping.
 */
export function pickMaterials(entries, options = {}) {
  const { mode = 'folder', group, minDurationSec = 0, exclude = new Set(), limit = 20, recentWindowMs = 7 * 24 * 3600 * 1000 } = options
  const now = Date.now()

  // 索引可能来自搬过家的素材库、也可能来自一块暂时拔掉的硬盘。选材时跳过
  // 不存在的文件，但不从索引里删——硬盘插回来还能继续用。否则会把一个
  // 死路径交给 ffmpeg，报错还看不出是素材没了。
  const alive = (entry) => typeof entry.path === 'string' && existsSync(entry.path)

  const select = (ignoreExclude) =>
    entries.filter((entry) => {
      if (!alive(entry)) return false
      if (!ignoreExclude && exclude.has(entry.path)) return false
      if (entry.kind !== 'video' && entry.kind !== 'image') return false
      if (entry.kind === 'video' && (entry.durationSec || 0) < Math.max(0.5, minDurationSec)) return false
      if (mode === 'folder' && group && entry.dirGroup !== group) return false
      return true
    })

  // 素材不够时宁可重复用，也不要让整条内容失败
  let usable = select(false)
  if (usable.length === 0 && exclude.size > 0) usable = select(true)

  const score = (entry) => {
    const recencyPenalty = entry.lastUsedAt && now - entry.lastUsedAt < recentWindowMs ? 1 : 0
    return recencyPenalty * 1000 + (entry.usedCount || 0)
  }

  return usable
    .sort((a, b) => score(a) - score(b) || String(a.path).localeCompare(String(b.path)))
    .slice(0, limit)
}

/** Distinct groups present in the index — what the operator can pick from. */
export function listGroups(entries) {
  const map = new Map()
  for (const entry of entries) {
    if (entry.kind !== 'video' && entry.kind !== 'image') continue
    const key = entry.dirGroup || '未分组'
    const current = map.get(key) || { group: key, count: 0, totalDurationSec: 0 }
    current.count += 1
    current.totalDurationSec += entry.durationSec || 0
    map.set(key, current)
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}
