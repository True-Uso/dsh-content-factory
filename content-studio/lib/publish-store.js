import { join } from 'node:path'
import { appendLog, listBatches, loadBatch, readJson, updateBatch, updateItem, writeJson } from './batch-store.js'

export const PUBLISH_STATUS = {
  notRequested: 'not_requested',
  scheduled: 'scheduled',
  publishing: 'publishing',
  published: 'published',
  partial: 'partial',
  failed: 'failed',
  cancelled: 'cancelled',
  unknown: 'unknown',
}

const locks = new Map()

function withLock(key, operation) {
  const previous = locks.get(key) || Promise.resolve()
  let release
  const current = new Promise((resolve) => { release = resolve })
  locks.set(key, previous.then(() => current))
  return previous.then(async () => {
    try {
      return await operation()
    } finally {
      release()
      if (locks.get(key) === current) locks.delete(key)
    }
  })
}

export function publishRoot(batchDir) {
  return join(batchDir, '10-distribute')
}

export function publishJobsRoot(batchDir) {
  return join(publishRoot(batchDir), 'jobs')
}

export function publishJobFile(batchDir, jobId) {
  return join(publishJobsRoot(batchDir), `${jobId}.json`)
}

function newJobId() {
  return `publish-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeTarget(target) {
  return {
    integrationId: String(target.integrationId || target.id || ''),
    name: target.name || target.profile || target.id || '',
    identifier: target.identifier || '',
    status: target.status || PUBLISH_STATUS.scheduled,
    attempts: Number(target.attempts) || 0,
    providerPostId: target.providerPostId || null,
    mediaId: target.mediaId || null,
    url: target.url || null,
    scheduledAt: target.scheduledAt || null,
    publishedAt: target.publishedAt || null,
    lastError: target.lastError || null,
  }
}

export async function loadPublishJob(batchDir, jobId) {
  return readJson(publishJobFile(batchDir, jobId))
}

export async function listPublishJobs(batchDir) {
  const { readdir } = await import('node:fs/promises')
  let names = []
  try {
    names = await readdir(publishJobsRoot(batchDir))
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const jobs = []
  for (const name of names.filter((entry) => entry.endsWith('.json'))) {
    const job = await readJson(join(publishJobsRoot(batchDir), name))
    if (job) jobs.push(job)
  }
  return jobs.sort((a, b) => String(a.scheduleAt || '').localeCompare(String(b.scheduleAt || '')))
}

export async function createPublishJob({ batch, item, targets, scheduleAt, contentVersion = 1, policy = 'after_approval' }) {
  const normalizedTargets = (targets || []).map(normalizeTarget).filter((target) => target.integrationId)
  if (normalizedTargets.length === 0) throw new Error('至少选择一个发布账号')
  const idempotencyKey = `${batch.id}:${item.id}:${contentVersion}:${normalizedTargets.map((target) => target.integrationId).sort().join(',')}`
  const existing = (await listPublishJobs(batch.dir)).find((job) => job.idempotencyKey === idempotencyKey && job.status !== PUBLISH_STATUS.cancelled)
  if (existing) return existing

  const now = new Date().toISOString()
  const job = {
    version: 1,
    id: newJobId(),
    batchId: batch.id,
    itemId: item.id,
    contentVersion,
    idempotencyKey,
    policy,
    status: PUBLISH_STATUS.scheduled,
    scheduleAt: scheduleAt || now,
    targetIntegrationIds: normalizedTargets.map((target) => target.integrationId),
    targets: normalizedTargets.map((target) => ({ ...target, scheduledAt: scheduleAt || now })),
    attempts: 0,
    nextAttemptAt: scheduleAt || now,
    leaseUntil: null,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  }
  await writeJson(publishJobFile(batch.dir, job.id), job)
  await updateItem(batch.id, item.id, (current) => ({
    publish: {
      ...(current.publish || {}),
      status: job.status,
      scheduleAt: job.scheduleAt,
      contentVersion,
      jobId: job.id,
      idempotencyKey,
      attempts: 0,
      lastError: null,
      targets: job.targets,
    },
  }))
  await appendLog(join(item.dir, 'item.log'), `创建发布任务 ${job.id}，计划 ${job.scheduleAt}`)
  return job
}

export async function updatePublishJob(batchDir, jobId, mutate) {
  const file = publishJobFile(batchDir, jobId)
  return withLock(file, async () => {
    const current = await readJson(file)
    if (!current) throw new Error(`发布任务不存在：${jobId}`)
    const next = { ...current, ...mutate(current), updatedAt: new Date().toISOString() }
    await writeJson(file, next)
    return next
  })
}

export async function claimPublishJob(batchDir, jobId, now = Date.now(), leaseMs = 120000) {
  return updatePublishJob(batchDir, jobId, (current) => {
    const leaseUntil = current.leaseUntil ? Date.parse(current.leaseUntil) : 0
    const due = !current.nextAttemptAt || Date.parse(current.nextAttemptAt) <= now
    const recoverable = current.status === PUBLISH_STATUS.publishing && leaseUntil > 0 && leaseUntil <= now
    if (current.status === PUBLISH_STATUS.published || current.status === PUBLISH_STATUS.cancelled) return current
    if (!due && !recoverable) return current
    if (current.status === PUBLISH_STATUS.publishing && !recoverable) return current
    return {
      ...current,
      status: PUBLISH_STATUS.publishing,
      attempts: (Number(current.attempts) || 0) + 1,
      leaseUntil: new Date(now + leaseMs).toISOString(),
    }
  })
}

export async function savePublishTargets(batchDir, jobId, targets, status, error = null) {
  const job = await updatePublishJob(batchDir, jobId, (current) => ({
    targets: targets.map(normalizeTarget),
    status,
    lastError: error,
    leaseUntil: null,
  }))
  const batch = await loadBatch(job.batchId)
  if (batch) {
    const item = batch.items.find((entry) => entry.id === job.itemId)
    if (item) {
      await updateItem(job.batchId, job.itemId, (current) => ({
        publish: {
          ...(current.publish || {}),
          status,
          scheduleAt: job.scheduleAt,
          contentVersion: job.contentVersion,
          jobId,
          idempotencyKey: job.idempotencyKey,
          attempts: job.attempts,
          lastError: error,
          targets: job.targets,
        },
      }))
      await appendLog(join(item.dir, 'item.log'), `发布任务 ${jobId}：${status}${error ? `，${error}` : ''}`)
    }
    await updateBatch(job.batchId, (current) => ({
      publishStatus: summarizeBatchPublish(current.items),
    }))
  }
  return job
}

export function summarizeBatchPublish(items = []) {
  const states = items.map((item) => item.publish?.status || PUBLISH_STATUS.notRequested)
  if (states.length === 0 || states.every((status) => status === PUBLISH_STATUS.notRequested)) return PUBLISH_STATUS.notRequested
  if (states.some((status) => status === PUBLISH_STATUS.publishing)) return PUBLISH_STATUS.publishing
  if (states.some((status) => status === PUBLISH_STATUS.failed || status === PUBLISH_STATUS.unknown)) return PUBLISH_STATUS.failed
  if (states.some((status) => status === PUBLISH_STATUS.partial)) return PUBLISH_STATUS.partial
  if (states.every((status) => status === PUBLISH_STATUS.published)) return PUBLISH_STATUS.published
  if (states.some((status) => status === PUBLISH_STATUS.scheduled)) return PUBLISH_STATUS.scheduled
  return PUBLISH_STATUS.notRequested
}

export async function listDuePublishJobs(now = Date.now(), limit = 20) {
  const batches = await listBatches(200)
  const due = []
  for (const batch of batches) {
    const jobs = await listPublishJobs(batch.dir)
    for (const job of jobs) {
      if (![PUBLISH_STATUS.scheduled, PUBLISH_STATUS.failed, PUBLISH_STATUS.publishing].includes(job.status)) continue
      const when = job.status === PUBLISH_STATUS.publishing && job.leaseUntil ? Date.parse(job.leaseUntil) : Date.parse(job.nextAttemptAt || job.scheduleAt)
      if (Number.isFinite(when) && when <= now) due.push({ batch, job })
      if (due.length >= limit) return due
    }
  }
  return due
}
