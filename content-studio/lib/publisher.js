import { join } from 'node:path'
import { listBatches, loadBatch, loadItem, readJson } from './batch-store.js'
import { listChannels, loadPostiz, publishToChannel } from './postiz.js'
import {
  PUBLISH_STATUS,
  claimPublishJob,
  createPublishJob,
  listDuePublishJobs,
  savePublishTargets,
  updatePublishJob,
} from './publish-store.js'

const RETRY_LIMIT = 4
const LEASE_MS = 120000

function asError(error) {
  return String(error?.message || error || '未知发布错误').slice(0, 500)
}

function isRetryable(error) {
  const status = Number(error?.status)
  return !status || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function backoff(attempts) {
  return Math.min(60 * 60 * 1000, 5000 * (2 ** Math.max(0, attempts - 1)))
}

function extractRemoteId(value) {
  if (!value || typeof value !== 'object') return null
  for (const key of ['id', 'postId', 'post_id', 'remoteId', 'remote_id']) {
    if (value[key] !== undefined && value[key] !== null) return String(value[key])
  }
  for (const child of Object.values(value)) {
    const found = extractRemoteId(child)
    if (found) return found
  }
  return null
}

async function loadPublishInput(batch, item) {
  const script = await readJson(join(item.dir, '01-script', 'script.json'))
  if (!script) throw new Error('缺少文案产物，无法发布')
  const videoPath = join(item.dir, '06-render', 'master.mp4')
  const { stat } = await import('node:fs/promises')
  await stat(videoPath)
  return { script, videoPath }
}

export function createPublisher({ onEvent = () => {}, intervalMs = 5000 } = {}) {
  let timer = null
  let stopped = true
  let ticking = false

  async function processJob(entry) {
    const { batch, job } = entry
    const claimed = await claimPublishJob(batch.dir, job.id, Date.now(), LEASE_MS)
    if (!claimed || claimed.status !== PUBLISH_STATUS.publishing || claimed.attempts !== job.attempts + 1) return null

    onEvent({ type: 'publish:start', batchId: job.batchId, itemId: job.itemId, jobId: job.id })
    let itemData
    try {
      itemData = await loadItem(job.batchId, job.itemId)
      if (itemData.item.status !== 'approved') {
        await savePublishTargets(batch.dir, job.id, claimed.targets, PUBLISH_STATUS.cancelled, '条目尚未通过审核或已撤回')
        onEvent({ type: 'publish:cancel', batchId: job.batchId, itemId: job.itemId, jobId: job.id })
        return null
      }
      const cfg = await loadPostiz()
      const channels = await listChannels(cfg)
      const input = await loadPublishInput(batch, itemData.item)
      const targets = (claimed.targets || []).map((target) => ({ ...target }))
      let media = null
      let anyRetry = false
      let lastError = null
      for (const target of targets) {
        if (target.status === PUBLISH_STATUS.published) continue
        const channel = channels.find((row) => row.id === target.integrationId)
        if (!channel) {
          target.status = PUBLISH_STATUS.failed
          target.lastError = `找不到发布账号：${target.integrationId}`
          lastError = target.lastError
          continue
        }
        try {
          target.attempts = (Number(target.attempts) || 0) + 1
          const result = await publishToChannel(cfg, { ...input, media }, channel)
          target.status = PUBLISH_STATUS.published
          target.publishedAt = new Date().toISOString()
          target.lastError = null
          target.mediaId = result.media?.id || result.media?.path || null
          target.providerPostId = extractRemoteId(result.posts)
          target.url = result.url || null
          onEvent({ type: 'publish:target', batchId: job.batchId, itemId: job.itemId, jobId: job.id, target: { ...target } })
        } catch (error) {
          target.lastError = asError(error)
          lastError = target.lastError
          target.status = isRetryable(error) && claimed.attempts < RETRY_LIMIT
            ? PUBLISH_STATUS.scheduled
            : PUBLISH_STATUS.failed
          anyRetry = anyRetry || target.status === PUBLISH_STATUS.scheduled
        }
      }

      const published = targets.filter((target) => target.status === PUBLISH_STATUS.published).length
      const pending = targets.filter((target) => target.status === PUBLISH_STATUS.scheduled).length
      const status = published === targets.length
        ? PUBLISH_STATUS.published
        : published > 0
          ? PUBLISH_STATUS.partial
          : pending > 0
            ? PUBLISH_STATUS.failed
            : PUBLISH_STATUS.failed
      const nextAttemptAt = anyRetry ? new Date(Date.now() + backoff(claimed.attempts)).toISOString() : null
      const saved = await updatePublishJob(batch.dir, job.id, (current) => ({
        ...current,
        targets,
        status,
        nextAttemptAt,
        leaseUntil: null,
        lastError,
      }))
      await savePublishTargets(batch.dir, job.id, targets, status, lastError)
      if (anyRetry) {
        onEvent({ type: 'publish:retry', batchId: job.batchId, itemId: job.itemId, jobId: job.id, nextAttemptAt, error: lastError })
      } else if (status === PUBLISH_STATUS.published) {
        onEvent({ type: 'publish:success', batchId: job.batchId, itemId: job.itemId, jobId: job.id })
      } else {
        onEvent({ type: 'publish:failure', batchId: job.batchId, itemId: job.itemId, jobId: job.id, error: lastError })
      }
      return saved
    } catch (error) {
      const message = asError(error)
      const retry = isRetryable(error) && claimed.attempts < RETRY_LIMIT
      const status = retry ? PUBLISH_STATUS.failed : PUBLISH_STATUS.failed
      await updatePublishJob(batch.dir, job.id, (current) => ({
        ...current,
        status,
        lastError: message,
        nextAttemptAt: retry ? new Date(Date.now() + backoff(claimed.attempts)).toISOString() : null,
        leaseUntil: null,
      }))
      await savePublishTargets(batch.dir, job.id, claimed.targets || [], status, message)
      onEvent({ type: retry ? 'publish:retry' : 'publish:failure', batchId: job.batchId, itemId: job.itemId, jobId: job.id, error: message })
      return null
    }
  }

  async function recoverApproved() {
    const batches = await listBatches(200)
    for (const batch of batches) {
      const publish = batch.config?.publish
      if (!publish?.enabled || !Array.isArray(publish.targetIntegrationIds) || publish.targetIntegrationIds.length === 0) continue
      const channels = await listChannels(await loadPostiz()).catch(() => [])
      const targets = channels.filter((channel) => publish.targetIntegrationIds.includes(channel.id))
      if (targets.length === 0) continue
      const jobs = await import('./publish-store.js').then(({ listPublishJobs }) => listPublishJobs(batch.dir))
      for (const item of batch.items || []) {
        if (item.status !== 'approved') continue
        const hasActive = jobs.some((job) => job.itemId === item.id && ![PUBLISH_STATUS.cancelled, PUBLISH_STATUS.failed].includes(job.status))
        if (hasActive) continue
        const start = Date.parse(batch.config.publishStartAt || new Date().toISOString())
        const interval = Number(batch.config.publishIntervalMinutes) || 0
        const scheduleAt = Number.isFinite(start)
          ? new Date(start + Math.max(0, item.seq - 1) * interval * 60 * 1000).toISOString()
          : new Date().toISOString()
        await scheduleItem({ batch, item, targets, scheduleAt, contentVersion: item.publish?.contentVersion || 1 }).catch(() => {})
      }
    }
  }

  async function tick() {
    if (stopped || ticking) return
    ticking = true
    try {
      await recoverApproved()
      const due = await listDuePublishJobs(Date.now(), 10)
      for (const entry of due) {
        if (stopped) break
        await processJob(entry)
      }
    } finally {
      ticking = false
    }
  }

  function start() {
    if (!stopped) return
    stopped = false
    timer = setInterval(() => { void tick() }, intervalMs)
    void recoverApproved().then(() => tick()).catch(() => tick())
  }

  function stop() {
    stopped = true
    if (timer) clearInterval(timer)
    timer = null
  }

  async function scheduleItem({ batch, item, targets, scheduleAt, contentVersion = 1, policy = 'after_approval' }) {
    const job = await createPublishJob({ batch, item, targets, scheduleAt, contentVersion, policy })
    onEvent({ type: 'publish:scheduled', batchId: batch.id, itemId: item.id, jobId: job.id, scheduleAt: job.scheduleAt })
    return job
  }

  return { start, stop, tick, scheduleItem, processJob }
}
