import { ITEM_STATUS, listBatches, loadBatch, updateBatch, updateItem } from './batch-store.js'
import { runItem } from './pipeline.js'
import { loadProviders } from './store.js'
import { loadIndex } from './steps/scan.js'

/**
 * Batch runner.
 *
 * v0.1 runs in the Harness host process and resumes unfinished items on boot
 * (SPEC FR-13 的常驻独立进程是后续升级项). What it already guarantees:
 *
 *   - concurrency limit across items
 *   - one item never runs twice at the same time (in-flight set)
 *   - `queued`/`running` batches resume after a restart instead of being lost
 *   - pause / cancel per batch
 */

export function createRunner(options = {}) {
  const { tools, providers = {}, materials = [], onEvent = () => {} } = options
  // 可变：批次可以在启动时改并发度
  let concurrency = Math.max(1, Math.min(16, Number(options.concurrency) || 2))

  const queue = []
  const active = new Map()
  const paused = new Set()
  const cancelled = new Set()
  const costWarned = new Set()
  const failures = []
  let running = false
  let stopped = false

  // One batch must not reuse the same source footage across its items.
  const usedByBatch = new Map()
  const excludeFor = (batchId) => {
    if (!usedByBatch.has(batchId)) usedByBatch.set(batchId, new Set())
    return usedByBatch.get(batchId)
  }

  function snapshot() {
    return {
      queued: queue.length,
      active: [...active.keys()],
      paused: [...paused],
      cancelled: [...cancelled],
      concurrency,
      failures: failures.slice(-20),
    }
  }

  function enqueue(batchId, itemIds) {
    for (const itemId of itemIds) {
      if (queue.some((job) => job.itemId === itemId) || active.has(itemId)) continue
      queue.push({ batchId, itemId })
    }
    kick()
  }

  function kick() {
    if (running) return
    running = true
    // fire and forget: the loop drains the queue then returns
    void drain()
  }

  async function drain() {
    try {
      while (queue.length > 0 && !stopped) {
        const available = concurrency - active.size
        if (available <= 0) {
          await Promise.race([...active.values()].map((p) => p.catch(() => {})))
          continue
        }
        const job = nextRunnable()
        if (!job) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          continue
        }
        let retry = false
        const promise = execute(job)
          .then((result) => {
            retry = Boolean(result?.retry)
          })
          .finally(() => {
            active.delete(job.itemId)
            // 自动重试必须等 active 释放后再入队，否则会被当成重复任务跳过。
            if (retry && !stopped && !cancelled.has(job.batchId) && !paused.has(job.batchId)) {
              queue.push({ ...job, retried: true })
            }
            if (queue.length > 0) kick()
          })
        active.set(job.itemId, promise)
      }
    } finally {
      running = false
      if (queue.length > 0) kick()
    }
  }

  function nextRunnable() {
    for (let index = 0; index < queue.length; index += 1) {
      const job = queue[index]
      if (paused.has(job.batchId) || cancelled.has(job.batchId)) continue
      queue.splice(index, 1)
      return job
    }
    return null
  }

  async function execute(job) {
    onEvent({ type: 'item:start', ...job })
    try {
      // Providers and the material index are read at execution time so a batch
      // picks up a provider the user just configured, without a restart.
      const providers = typeof options.providers === 'function' ? await options.providers() : options.providers || (await defaultProviders())
      const materials = typeof options.materials === 'function' ? await options.materials() : options.materials || (await loadIndex()).entries
      const tools = options.tools || (await import('./ffmpeg.js')).resolveTools()
      const result = await runItem({
        batchId: job.batchId,
        itemId: job.itemId,
        tools: await tools,
        materials,
        providers,
        force: false,
        excludeMaterials: excludeFor(job.batchId),
        onProgress: (progress) => onEvent({ type: 'item:progress', ...job, progress }),
      })

      // 失败自动重试一次：条目回到 pending，失败的步骤会在下一次执行时重跑。
      if (result.status === ITEM_STATUS.failed && !job.retried && !cancelled.has(job.batchId) && !stopped) {
        const updated = await updateItem(job.batchId, job.itemId, (current) => ({
          status: ITEM_STATUS.pending,
          error: null,
          autoRetries: (current.autoRetries || 0) + 1,
        }))
        onEvent({ type: 'item:retry', ...job, error: result.error, autoRetries: updated.item?.autoRetries })
        return { ...result, status: ITEM_STATUS.pending, retry: true }
      }

      onEvent({ type: 'item:end', ...job, status: result.status, error: result.error })
      if (result.status === ITEM_STATUS.failed) failures.push({ ...job, error: result.error })
      return result
    } catch (error) {
      const message = String(error.message || error)
      if (!job.retried && !cancelled.has(job.batchId) && !stopped) {
        const updated = await updateItem(job.batchId, job.itemId, (current) => ({
          status: ITEM_STATUS.pending,
          error: null,
          autoRetries: (current.autoRetries || 0) + 1,
        })).catch(() => null)
        onEvent({ type: 'item:retry', ...job, error: message, autoRetries: updated?.item?.autoRetries })
        return { status: ITEM_STATUS.pending, error: message, retry: true }
      }
      failures.push({ ...job, error: message })
      onEvent({ type: 'item:error', ...job, error: message })
      return { status: ITEM_STATUS.failed, error: message }
    } finally {
      await refreshBatchStatus(job.batchId).catch(() => {})
    }
  }

  /** Derive the batch status from its items so the UI never shows a stale one. */
  async function refreshBatchStatus(batchId) {
    const batch = await loadBatch(batchId)
    if (!batch) return

    // 成本护栏：80% 提示，100% 暂停。没有价目表时 totals 为 0，不会误触发。
    const cap = Number(batch.config?.costCap)
    if (Number.isFinite(cap) && cap > 0) {
      const spent = batch.items.reduce((sum, item) => sum + (Number(item.cost?.total) || 0), 0)
      const hasWork =
        batch.items.some((item) => item.status === ITEM_STATUS.pending || item.status === ITEM_STATUS.running) ||
        queue.some((job) => job.batchId === batchId) ||
        [...active.keys()].some((itemId) => itemId.startsWith(batchId))

      if (spent >= cap * 0.8 && !costWarned.has(batchId)) {
        costWarned.add(batchId)
        onEvent({ type: 'batch:cost-warning', batchId, spent, cap })
      }
      if (spent >= cap && hasWork && !paused.has(batchId) && !cancelled.has(batchId)) {
        pauseBatch(batchId, 'cost_cap')
      }
    }

    const statuses = batch.items.map((item) => item.status)
    const busy = statuses.some((s) => s === ITEM_STATUS.running || s === ITEM_STATUS.pending)
    let status = batch.status
    if (cancelled.has(batchId)) status = 'cancelled'
    else if (paused.has(batchId)) status = 'paused'
    else if (busy) status = 'running'
    else if (statuses.every((s) => s === ITEM_STATUS.approved)) status = 'done'
    else if (statuses.some((s) => s === ITEM_STATUS.reviewPending)) status = 'review'
    else if (statuses.every((s) => s === ITEM_STATUS.failed)) status = 'failed'
    else status = 'partial'

    if (status !== batch.status) {
      await updateBatch(batchId, () => ({ status }))
      onEvent({ type: 'batch:status', batchId, status })
    }
  }

  async function startBatch(batchId) {
    const batch = await loadBatch(batchId)
    if (!batch) throw new Error(`批次不存在：${batchId}`)
    paused.delete(batchId)
    cancelled.delete(batchId)
    usedByBatch.delete(batchId)
    costWarned.delete(batchId)
    // 批次可以指定并发度：素材多、机器强的时候跑快一点
    const requested = Number(batch.config?.concurrency)
    if (Number.isFinite(requested) && requested >= 1) setConcurrency(requested)
    await updateBatch(batchId, (current) => ({
      status: 'running',
      pauseReason: null,
      startedAt: current.startedAt || Date.now(),
    }))
    const pending = batch.items.filter((item) => item.status === ITEM_STATUS.pending || item.status === ITEM_STATUS.failed)
    enqueue(batchId, pending.map((item) => item.id))
    return { batchId, enqueued: pending.length }
  }

  function pauseBatch(batchId, reason = 'user') {
    paused.add(batchId)
    onEvent({ type: 'batch:pause', batchId, reason })
    void updateBatch(batchId, () => ({ status: 'paused', pauseReason: reason, pausedAt: Date.now() })).catch(() => {})
    return { batchId, paused: true, reason }
  }

  async function resumeBatch(batchId) {
    paused.delete(batchId)
    return startBatch(batchId)
  }

  function cancelBatch(batchId) {
    cancelled.add(batchId)
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index].batchId === batchId) queue.splice(index, 1)
    }
    onEvent({ type: 'batch:cancel', batchId })
    void updateBatch(batchId, () => ({ status: 'cancelled' }))
    return { batchId, cancelled: true }
  }

  /** Re-enqueue everything a previous process left unfinished. */
  async function resumeUnfinished() {
    const batches = await listBatches(200)
    const resumed = []
    for (const batch of batches) {
      if (batch.status === 'cancelled' || batch.status === 'done') continue
      const pending = batch.items.filter((item) => item.status === ITEM_STATUS.pending || item.status === ITEM_STATUS.running || item.status === ITEM_STATUS.failed)
      if (pending.length === 0) continue
      for (const item of pending) {
        if (item.status === ITEM_STATUS.running) {
          // a crash mid-step: put it back to pending so the step re-runs
          await updateItem(batch.id, item.id, () => ({ status: ITEM_STATUS.pending }))
        }
      }
      enqueue(batch.id, pending.map((item) => item.id))
      resumed.push({ batchId: batch.id, items: pending.length })
    }
    return resumed
  }

  async function waitIdle() {
    while (queue.length > 0 || active.size > 0) {
      await Promise.all([...active.values()].map((p) => p.catch(() => {})))
      if (active.size === 0 && queue.length === 0) break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  /** 并发度可运行时调整，批次配置里也能带。 */
  function setConcurrency(next) {
    concurrency = Math.max(1, Math.min(16, Number(next) || 1))
  }

  return {
    enqueue,
    startBatch,
    pauseBatch,
    resumeBatch,
    cancelBatch,
    resumeUnfinished,
    waitIdle,
    snapshot,
    refreshBatchStatus,
    /** 显式注入的 provider 角色（测试或嵌入场景）；生产返回 null 表示走注册表。 */
    roles() {
      const injected = options.providers
      if (!injected || typeof injected !== 'object') return null
      return new Set(Object.keys(injected))
    },
    /** 并发度可运行时调整，批次配置里也能带。 */
    setConcurrency,
    /** Stop accepting work; in-flight items finish. Used on plugin unload. */
    stop() {
      stopped = true
      queue.length = 0
    },
    get concurrency() {
      return concurrency
    },
  }
}

/** Load materials + providers once per run so a batch is not re-scanning per item. */
export async function loadRunContext() {
  const providers = await loadProviders()
  const index = await loadIndex()
  return { providerList: providers, materials: index.entries }
}

async function defaultProviders() {
  const { resolveRoleProviders } = await import('./providers.js')
  const list = await loadProviders()
  return resolveRoleProviders(list)
}
