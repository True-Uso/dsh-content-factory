import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from './store.js'

/** Pipeline steps in execution order (SPEC §5.1). */
export const STEP_ORDER = ['script', 'voice', 'subtitle', 'visual', 'plan', 'render', 'cover', 'validate']

/** On-disk directory per step (SPEC §10). */
export const STEP_DIR = {
  script: '01-script',
  voice: '02-voice',
  subtitle: '03-subtitle',
  visual: '04-visual',
  plan: '05-edl',
  render: '06-render',
  cover: '07-cover',
  validate: '08-validate',
  review: '09-review',
}

export const ITEM_STATUS = {
  pending: 'pending',
  running: 'running',
  reviewPending: 'review_pending',
  approved: 'approved',
  rejected: 'rejected',
  failed: 'failed',
  cancelled: 'cancelled',
}

export function batchesRoot() {
  return join(dataDir(), 'batches')
}

const locks = new Map()

/** Serialise read-modify-write per file so parallel steps cannot interleave. */
async function withLock(key, operation) {
  const previous = locks.get(key) || Promise.resolve()
  let release
  const current = new Promise((resolve) => {
    release = resolve
  })
  locks.set(key, previous.then(() => current))
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (locks.get(key) === current) locks.delete(key)
  }
}

export async function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) return fallback
    throw error
  }
}

let tempCounter = 0

/**
 * Atomic-ish write: temp file + rename.
 *
 * The temp name MUST be unique per call. Two concurrent writes in the same
 * millisecond used to share a name, and on Windows the second rename then hit
 * EPERM because the first call still had the file open. Rename is also retried:
 * Windows refuses to replace a file that another handle is reading at that
 * instant, which happens routinely when several items update one batch file.
 */
export async function writeJson(file, value) {
  await mkdir(join(file, '..'), { recursive: true }).catch(() => {})
  tempCounter = (tempCounter + 1) % 1e6
  const temp = `${file}.${process.pid}.${tempCounter}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(temp, JSON.stringify(value, null, 2), 'utf8')
  await renameWithRetry(temp, file)
  return value
}

async function renameWithRetry(from, to, attempts = 6) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      lastError = error
      if (!['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(error.code)) break
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)))
    }
  }
  await rm(from, { force: true }).catch(() => {})
  throw lastError
}

export async function appendLog(file, line) {
  const stamp = new Date().toISOString()
  await mkdir(join(file, '..'), { recursive: true }).catch(() => {})
  await writeFile(file, `[${stamp}] ${line}\n`, { flag: 'a', encoding: 'utf8' }).catch(() => {})
}

export function newBatchId(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const suffix = Math.random().toString(36).slice(2, 6)
  return `batch-${stamp}-${suffix}`
}

export function itemDirName(seq) {
  return `item-${String(seq).padStart(3, '0')}`
}

/** Create the batch directory tree and its N pending items. */
export async function createBatch(input) {
  const id = input.id || newBatchId()
  const dir = join(batchesRoot(), id)
  const count = Math.max(1, Math.min(500, Number(input.count) || 1))
  const now = Date.now()

  const items = []
  for (let seq = 1; seq <= count; seq += 1) {
    const itemId = `${id}-${String(seq).padStart(3, '0')}`
    const itemDir = join(dir, itemDirName(seq))
    await mkdir(itemDir, { recursive: true })
    const item = {
      version: 1,
      id: itemId,
      batchId: id,
      seq,
      status: ITEM_STATUS.pending,
      dir: itemDir,
      title: '',
      durationSec: null,
      steps: Object.fromEntries(STEP_ORDER.map((step) => [step, { status: 'pending', attempts: 0 }])),
      error: null,
      createdAt: now,
      updatedAt: now,
    }
    await writeJson(join(itemDir, 'item.json'), item)
    items.push({ id: itemId, seq, dir: itemDir, status: item.status, title: '', updatedAt: now })
  }

  const batch = {
    version: 1,
    id,
    title: input.title || '未命名批次',
    dir,
    status: 'draft',
    config: input.config || {},
    items,
    itemCount: items.length,
    createdAt: now,
    updatedAt: now,
    cost: { estimated: Number(input.costEstimate) || 0, actual: 0 },
  }
  await writeJson(join(dir, 'batch.json'), batch)
  await appendLog(join(dir, 'batch.log'), `创建批次 ${id}，共 ${count} 条`)
  return batch
}

export async function loadBatch(batchId) {
  const dir = join(batchesRoot(), batchId)
  const batch = await readJson(join(dir, 'batch.json'))
  if (!batch) return undefined
  return { ...batch, dir }
}

export async function saveBatch(batch) {
  const next = { ...batch, updatedAt: Date.now() }
  await writeJson(join(batch.dir, 'batch.json'), next)
  return next
}

export async function updateBatch(batchId, mutate) {
  const file = join(batchesRoot(), batchId, 'batch.json')
  return withLock(file, async () => {
    const batch = await readJson(file)
    if (!batch) throw new Error(`批次不存在：${batchId}`)
    const next = { ...batch, ...mutate(batch), updatedAt: Date.now() }
    await writeJson(file, next)
    return { ...next, dir: join(batchesRoot(), batchId) }
  })
}

export async function loadItem(batchId, itemId) {
  const batch = await loadBatch(batchId)
  if (!batch) throw new Error(`批次不存在：${batchId}`)
  const summary = batch.items.find((item) => item.id === itemId)
  if (!summary) throw new Error(`条目不存在：${itemId}`)
  const item = await readJson(join(summary.dir, 'item.json'))
  if (!item) throw new Error(`条目文件缺失：${itemId}`)
  return { item: { ...item, dir: summary.dir }, batch }
}

export async function updateItem(batchId, itemId, mutate) {
  const batch = await loadBatch(batchId)
  if (!batch) throw new Error(`批次不存在：${batchId}`)
  const summary = batch.items.find((item) => item.id === itemId)
  if (!summary) throw new Error(`条目不存在：${itemId}`)
  const file = join(summary.dir, 'item.json')

  const item = await withLock(file, async () => {
    const current = await readJson(file)
    if (!current) throw new Error(`条目文件缺失：${itemId}`)
    const next = { ...current, ...mutate(current), updatedAt: Date.now() }
    await writeJson(file, next)
    return next
  })

  await updateBatch(batchId, (current) => ({
    items: current.items.map((entry) =>
      entry.id === itemId
        ? {
            ...entry,
            status: item.status,
            title: item.title || entry.title,
            durationSec: item.durationSec ?? entry.durationSec,
            usage: item.usage ?? entry.usage,
            cost: item.cost ?? entry.cost,
            error: item.error,
            updatedAt: item.updatedAt,
          }
        : entry,
    ),
  }))

  return { item: { ...item, dir: summary.dir }, batch }
}

export async function listBatches(limit = 50) {
  const root = batchesRoot()
  let entries = []
  try {
    entries = await readdir(root)
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const batches = []
  for (const name of entries) {
    const batch = await readJson(join(root, name, 'batch.json'))
    if (batch) batches.push({ ...batch, dir: join(root, name) })
  }
  return batches.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

export async function stepDir(item, step) {
  const dir = join(item.dir, STEP_DIR[step])
  await mkdir(dir, { recursive: true })
  return dir
}

/** Mark a step running/done/failed and keep the attempt counter. */
export async function markStep(batchId, itemId, step, patch) {
  return updateItem(batchId, itemId, (current) => {
    const steps = { ...(current.steps || {}) }
    const previous = steps[step] || { status: 'pending', attempts: 0 }
    const next = { ...previous, ...patch }
    if (patch.status === 'running') next.attempts = (previous.attempts || 0) + 1
    next.updatedAt = Date.now()
    steps[step] = next
    return { steps }
  })
}

export async function resetStepsFrom(batchId, itemId, fromStep) {
  const index = STEP_ORDER.indexOf(fromStep)
  if (index < 0) throw new Error(`未知步骤：${fromStep}`)
  return updateItem(batchId, itemId, (current) => {
    const steps = { ...(current.steps || {}) }
    for (const step of STEP_ORDER.slice(index)) {
      steps[step] = { status: 'pending', attempts: 0 }
    }
    return { steps, status: ITEM_STATUS.pending, error: null }
  })
}

export async function batchExists(batchId) {
  try {
    return (await stat(join(batchesRoot(), batchId, 'batch.json'))).isFile()
  } catch {
    return false
  }
}
