import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { assembleFilm, clipFile, clipsRoot, generateClip, getClip, listClips, newClipId, normalizeClipSec, publicClip, removeClip, upsertClip } from './clips.js'
import {
  ITEM_STATUS,
  STEP_ORDER,
  createBatch,
  listBatches,
  loadBatch,
  loadItem,
  resetStepsFrom,
  updateBatch,
  updateItem,
  writeJson,
} from './batch-store.js'
import { checkCapabilities, resolveTools } from './ffmpeg.js'
import { PROVIDER_KINDS, createProvider, listUpstreamModels, resolveRoleProviders, roleOf } from './providers.js'
import { dataDir, loadProviders, providersFile, removeProvider, upsertProvider } from './store.js'
import { computeCost, sumUsage } from './cost.js'
import { preflight } from './preflight.js'
import { listGroups, loadIndex, scanMaterials } from './steps/scan.js'
import { listPlatforms, normalizeBatchConfig } from './platforms.js'
import { parseBrief } from './brief.js'
import { installFfmpeg } from './install-tools.js'
import { batchExportName, buildBatchZip, buildItemZip, itemExportName } from './export.js'
import { distributeItem, listChannels, loadPostiz, publicPostiz, savePostiz } from './postiz.js'
import { PUBLISH_STATUS, createPublishJob, listPublishJobs, loadPublishJob, savePublishTargets, updatePublishJob } from './publish-store.js'

const MASK = '__stored__'
const MAX_BODY = 1024 * 1024

/** 密钥不回传给页面：列表里只说明「已保存」，编辑时留空表示不修改。 */
function maskProvider(provider) {
  if (!provider || typeof provider !== 'object') return provider
  const { apiKey, ...rest } = provider
  return { ...rest, hasApiKey: Boolean(apiKey), apiKey: apiKey ? MASK : undefined }
}

function unmaskProvider(next, previous) {
  const merged = { ...next }
  if (merged.apiKey === MASK) {
    merged.apiKey = previous && previous.apiKey ? previous.apiKey : undefined
  } else if (merged.apiKey === '' || merged.apiKey === null) {
    // 必须显式置 undefined 而不是 delete：upsert 是 {...existing, ...record}，
    // 删掉字段会让旧密钥从 existing 里活下来。
    merged.apiKey = undefined
  }
  return merged
}
const REVIEW_REASONS = ['文案质量', '画面质量', '封面问题', '配音问题', '字幕错误', '时长不符', '其他']

/**
 * HTTP surface for the workbench (SPEC §11.2).
 * Plain node handlers so it works behind `webServer.register`.
 */
export function createApi({ runner, publisher = null, prefix = '/content-studio/api', allowedOrigin = null }) {
  const streams = new Set()

  function broadcast(event) {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const res of streams) {
      try {
        res.write(payload)
      } catch {
        streams.delete(res)
      }
    }
  }

  async function handler(req, res) {
    try {
      if (!isLoopback(req)) return sendJson(res, 403, { error: '仅允许本机访问' })
      // Loopback is not enough: any page in the browser can reach 127.0.0.1.
      // Gate on Origin when the caller sends one.
      const origin = req.headers?.origin
      if (allowedOrigin && origin && origin !== allowedOrigin) {
        return sendJson(res, 403, { error: '来源不被允许' })
      }
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      const path = url.pathname.slice(prefix.length) || '/'
      const method = (req.method || 'GET').toUpperCase()

      if (method === 'GET' && path === '/events') return openStream(req, res)
      return await route(method, path, url, req, res)
    } catch (error) {
      return sendJson(res, error.status || 500, { error: messageOf(error) })
    }
  }

  async function schedulePublication(batchId, itemId, body = {}) {
    if (!publisher) throw Object.assign(new Error('发布服务未就绪'), { status: 503 })
    const batch = await loadBatch(batchId)
    const { item } = await loadItem(batchId, itemId)
    if (item.status !== ITEM_STATUS.approved) throw Object.assign(new Error(`只有审核通过的条目能发布，当前是 ${item.status}`), { status: 409 })
    const channels = await listChannels(await loadPostiz())
    const ids = [...new Set((body.integrationIds || batch.config?.publish?.targetIntegrationIds || []).filter(Boolean))]
    if (ids.length === 0) throw Object.assign(new Error('请先选择至少一个发布账号'), { status: 400 })
    const targets = ids.map((id) => {
      const channel = channels.find((entry) => entry.id === id)
      if (!channel) throw Object.assign(new Error(`找不到发布账号：${id}`), { status: 400 })
      return channel
    })
    const start = body.scheduleAt || batch.config?.publishStartAt || new Date().toISOString()
    const parsedStart = Date.parse(start)
    const interval = Number(batch.config?.publishIntervalMinutes) || 0
    const scheduleAt = body.scheduleAt || (Number.isFinite(parsedStart)
      ? new Date(parsedStart + Math.max(0, item.seq - 1) * interval * 60 * 1000).toISOString()
      : new Date().toISOString())
    return publisher.scheduleItem({
      batch,
      item,
      targets,
      scheduleAt,
      contentVersion: item.publish?.contentVersion || 1,
      policy: body.policy || 'after_approval',
    })
  }

  async function route(method, path, url, req, res) {
    /* ---------------- meta ---------------- */
    if (method === 'GET' && path === '/meta') {
      return sendJson(res, 200, {
        kinds: [...PROVIDER_KINDS, 'llm', 'tts', 'image'],
        roles: ['video', 'llm', 'tts', 'image'],
        steps: STEP_ORDER,
        reviewReasons: REVIEW_REASONS,
        platforms: listPlatforms(),
        specs: {
          aspects: ['9:16', '16:9', '1:1'],
          resolutions: ['480P', '1080P'],
          clipSec: 5,
          filmSec: [15, 30],
        },
        reviewModes: [
          { id: 'required', label: '需人工审核' },
          { id: 'auto', label: '自动放行' },
        ],
        dataDir: dataDir(),
        providersFile: providersFile(),
        note: '视频默认百炼 wan2.2-t2v-plus（5 秒，480P/1080P）',
      })
    }

    if (method === 'GET' && path === '/health') {
      const tools = await resolveTools()
      const caps = await checkCapabilities(tools)
      const providers = await loadProviders()
      return sendJson(res, 200, {
        ffmpeg: { ok: tools.ok, path: tools.ffmpeg, error: tools.error },
        capabilities: caps,
        providers: providers.map((p) => ({ id: p.id, kind: p.kind, role: roleOf(p), enabled: p.enabled !== false })),
        queue: runner ? runner.snapshot() : null,
      })
    }

    if (method === 'POST' && path === '/tools/install-ffmpeg') {
      const result = await installFfmpeg()
      return sendJson(res, result.ok ? 200 : 500, result)
    }

    /* ---------------- postiz ---------------- */
    if (method === 'GET' && path === '/postiz') {
      return sendJson(res, 200, publicPostiz(await loadPostiz()))
    }
    if (method === 'POST' && path === '/postiz') {
      const body = await readJson(req)
      const saved = await savePostiz(body)
      return sendJson(res, 200, publicPostiz(saved))
    }
    if (method === 'GET' && path === '/postiz/channels') {
      try {
        return sendJson(res, 200, { channels: await listChannels(await loadPostiz()) })
      } catch (error) {
        return sendJson(res, error.status || 502, { error: messageOf(error), channels: [] })
      }
    }
    if (method === 'GET' && path === '/publish/channels') {
      try {
        return sendJson(res, 200, { channels: await listChannels(await loadPostiz()) })
      } catch (error) {
        return sendJson(res, error.status || 502, { error: messageOf(error), channels: [] })
      }
    }
    if (method === 'GET' && path === '/publish/jobs') {
      const batches = await listBatches(200)
      const jobs = []
      for (const batch of batches) jobs.push(...await listPublishJobs(batch.dir))
      return sendJson(res, 200, { jobs })
    }

    /* ---------------- providers ---------------- */
    if (method === 'GET' && path === '/providers') {
      const providers = await loadProviders()
      return sendJson(res, 200, { providers: providers.map(maskProvider) })
    }

    if (method === 'POST' && (path === '/probe' || path === '/providers/probe')) {
      return probeFromBody(req, res)
    }

    const providerMatch = /^\/providers\/([^/]+)(\/health|\/test)?$/.exec(path)
    if (providerMatch) {
      const id = decodeURIComponent(providerMatch[1])
      const action = providerMatch[2]
      if (id === 'probe' && method === 'POST' && !action) return probeFromBody(req, res)

      if (method === 'PUT' && !action) {
        if (!/^[\p{L}\p{N}._-]{1,64}$/u.test(id)) return sendJson(res, 400, { error: '配置名称支持中文、字母、数字、点、下划线和短横线（≤64）' })
        const body = await readJson(req)
        const previous = (await loadProviders()).find((p) => p.id === id)
        const record = await upsertProvider({ ...unmaskProvider(body, previous), id })
        return sendJson(res, 200, { provider: maskProvider(record) })
      }

      if (method === 'DELETE' && !action) {
        return sendJson(res, (await removeProvider(id)) ? 200 : 404, { removed: true })
      }

      const provider = (await loadProviders()).find((p) => p.id === id)
      if (!provider) return sendJson(res, 404, { error: `未找到 provider：${id}` })

      if (method === 'POST' && action === '/health') {
        try {
          const instance = await createProvider(provider)
          return sendJson(res, 200, { id, health: await instance.healthCheck() })
        } catch (error) {
          return sendJson(res, 200, { id, health: { ok: false, detail: messageOf(error) } })
        }
      }

      if (method === 'POST' && action === '/test') {
        if (provider.enabled === false) return sendJson(res, 409, { error: `provider ${id} 已停用` })
        const body = await readJson(req)
        const job = await runProviderTest(provider, body)
        return sendJson(res, 200, { job })
      }
    }

    /* ---------------- materials ---------------- */
    if (method === 'POST' && path === '/materials/scan') {
      const body = await readJson(req)
      const dirs = Array.isArray(body.dirs) ? body.dirs : []
      if (dirs.length === 0) return sendJson(res, 400, { error: 'dirs 不能为空' })
      const tools = await resolveTools()
      if (!tools.ok) return sendJson(res, 400, { error: tools.error })
      const result = await scanMaterials({ dirs, tools })
      return sendJson(res, 200, {
        stats: result.stats,
        invalid: result.invalid.slice(0, 50),
        groups: listGroups(result.index.entries),
        total: result.index.entries.length,
      })
    }

    if (method === 'GET' && path === '/materials/groups') {
      const index = await loadIndex()
      return sendJson(res, 200, { groups: listGroups(index.entries), total: index.entries.length })
    }

    /* ---------------- batches ---------------- */
    if (method === 'GET' && path === '/batches') {
      const batches = await listBatches(100)
      return sendJson(res, 200, {
        batches: batches.map((batch) => ({ ...batch, totals: batchTotals(batch) })),
      })
    }

    if (method === 'POST' && path === '/batches/parse') {
      const body = await readJson(req)
      const brief = String(body.brief || '').trim()
      if (!brief) return sendJson(res, 400, { error: 'brief 不能为空' })
      let llm = null
      try {
        const roles = await resolveRoleProviders(await loadProviders())
        llm = roles.llm || null
      } catch {
        llm = null
      }
      const result = await parseBrief({
        brief,
        overrides: { platform: body.platform, count: body.count, reviewMode: body.reviewMode },
        llm,
      })
      return sendJson(res, 200, result)
    }

    if (method === 'POST' && path === '/batches/preflight') {
      const body = await readJson(req)
      let config = normalizeBatchConfig(body.config || {})
      const tools = await resolveTools()
      const injected = runner?.roles?.()
      const roles = injected || new Set((await loadProviders()).filter((p) => p.enabled !== false).map((p) => roleOf(p)))
      let index = await loadIndex()
      const dirs = Array.isArray(config.materialsDirs) ? config.materialsDirs.filter(Boolean) : []
      if (dirs.length > 0) {
        const scanned = await scanMaterials({ dirs, tools })
        index = scanned.index
        config = { ...config, materialsSnapshotAt: Date.now() }
      }
      const count = Number(body.count) || 1
      const check = await preflight({ tools, roles, materials: index.entries, config, count })
      return sendJson(res, 200, { preflight: check, config, materials: { count: index.entries.length } })
    }

    if (method === 'POST' && path === '/batches') {
      const body = await readJson(req)
      if (!body.title && !body.config?.topic) return sendJson(res, 400, { error: '需要 title 或 config.topic' })
      let config = normalizeBatchConfig(body.config || {})
      const tools = await resolveTools()
      const injected = runner?.roles?.()
      const roles = injected || new Set((await loadProviders()).filter((p) => p.enabled !== false).map((p) => roleOf(p)))
      let index = await loadIndex()
      let materialsSnapshot = null
      const materialDirs = Array.isArray(config.materialsDirs) ? config.materialsDirs.filter(Boolean) : []
      if (materialDirs.length > 0) {
        const scanned = await scanMaterials({ dirs: materialDirs, tools })
        index = scanned.index
        materialsSnapshot = {
          sourceDirs: materialDirs,
          scannedAt: Date.now(),
          entries: index.entries,
          invalid: scanned.invalid,
        }
        config = { ...config, materialsSnapshotAt: materialsSnapshot.scannedAt }
      }
      const count = Number(body.count) || 1
      const check = await preflight({
        tools,
        roles,
        materials: index.entries,
        config,
        count,
      })
      const batch = await createBatch({
        title: body.title || body.config?.topic,
        count,
        config,
        materialsSnapshot,
      })
      return sendJson(res, 200, { batch, preflight: check, materials: { count: index.entries.length, snapshotAt: materialsSnapshot?.scannedAt || null } })
    }

    const batchMatch = /^\/batches\/([^/]+)(?:\/(start|pause|resume|cancel|items|config|log|export))?$/.exec(path)
    if (batchMatch) {
      const batchId = decodeURIComponent(batchMatch[1])
      const action = batchMatch[2]
      const batch = await loadBatch(batchId)
      if (!batch) return sendJson(res, 404, { error: `批次不存在：${batchId}` })

      if (method === 'GET' && !action) {
        const items = []
        for (const summary of batch.items) {
          const { item } = await loadItem(batchId, summary.id)
          items.push({
            ...summary,
            steps: item.steps,
            error: item.error,
            usage: item.usage || summary.usage || null,
            cost: item.cost || summary.cost || null,
            report: await readJsonSafe(join(item.dir, '08-validate', 'report.json')),
            review: await readJsonSafe(join(item.dir, '09-review', 'review.json')),
          })
        }
        const enriched = { ...batch, items }
        return sendJson(res, 200, { batch: { ...enriched, totals: batchTotals(enriched) }, queue: runner ? runner.snapshot() : null })
      }

      if (method === 'DELETE' && !action) {
        runner?.cancelBatch(batchId)
        if (url.searchParams.get('purge') === '1') {
          // 正在跑的条目还在往这个目录写文件，删了就变成对已删除目录的写入
          const inFlight = (runner?.snapshot?.().active || []).filter((itemId) => itemId.startsWith(batchId))
          if (inFlight.length > 0) {
            return sendJson(res, 409, { error: `批次还有 ${inFlight.length} 条正在运行，等它们结束再删除` })
          }
          const { rm } = await import('node:fs/promises')
          await rm(batch.dir, { recursive: true, force: true })
          return sendJson(res, 200, { cancelled: true, purged: true })
        }
        await updateBatch(batchId, () => ({ status: 'cancelled' }))
        return sendJson(res, 200, { cancelled: true, purged: false })
      }

      if (method === 'POST' && action === 'start') {
        if (!runner) return sendJson(res, 503, { error: '队列未就绪' })
        return sendJson(res, 200, await runner.startBatch(batchId))
      }
      if (method === 'POST' && action === 'pause') {
        return sendJson(res, 200, runner ? runner.pauseBatch(batchId, 'user') : { paused: true, reason: 'user' })
      }
      if (method === 'POST' && action === 'resume') {
        if (!runner) return sendJson(res, 503, { error: '队列未就绪' })
        return sendJson(res, 200, await runner.resumeBatch(batchId))
      }
      if (method === 'POST' && action === 'cancel') {
        runner?.cancelBatch(batchId)
        return sendJson(res, 200, { cancelled: true })
      }

      if (method === 'POST' && action === 'config') {
        const body = await readJson(req)
        const patch = {}
        if (body.costCap !== undefined) {
          const value = Number(body.costCap)
          patch.costCap = Number.isFinite(value) && value > 0 ? value : null
        }
        if (body.reviewMode !== undefined) patch.reviewMode = body.reviewMode === 'auto' ? 'auto' : 'required'
        if (body.publishStartAt !== undefined) {
          const stamp = body.publishStartAt ? Date.parse(body.publishStartAt) : null
          patch.publishStartAt = stamp !== null && Number.isFinite(stamp) ? new Date(stamp).toISOString() : null
        }
        if (body.publishIntervalMinutes !== undefined) {
          const value = Number(body.publishIntervalMinutes)
          patch.publishIntervalMinutes = Number.isFinite(value) && value >= 0 ? value : 1440
        }
        if (Object.keys(patch).length === 0) return sendJson(res, 400, { error: '没有可更新的配置' })

        const next = await updateBatch(batchId, (current) => {
          const config = { ...(current.config || {}), ...patch }
          const cleared = current.pauseReason === 'cost_cap' && patch.costCap !== undefined ? null : current.pauseReason
          return { config, pauseReason: cleared }
        })
        return sendJson(res, 200, { batch: next })
      }

      if (method === 'GET' && action === 'log') {
        const items = []
        for (const summary of batch.items) {
          items.push({
            id: summary.id,
            seq: summary.seq,
            log: await readText(join(summary.dir, 'item.log')),
          })
        }
        return sendJson(res, 200, {
          batchId,
          batch: await readText(join(batch.dir, 'batch.log')),
          items,
        })
      }

      if (method === 'GET' && action === 'export') {
        const zip = await buildBatchZip(batch)
        return sendZip(res, zip, batchExportName(batch))
      }
    }

    /* ---------------- items ---------------- */
    const itemMatch = /^\/items\/([^/]+)(?:\/(rerun|approve|reject|retry|script|unapprove|log|export|distribute|publish|publish\/retry|publish\/cancel))?$/.exec(path)
    if (itemMatch) {
      const itemId = decodeURIComponent(itemMatch[1])
      const action = itemMatch[2]
      const located = await findItem(itemId)
      if (!located) return sendJson(res, 404, { error: `条目不存在：${itemId}` })
      const { batchId, item } = located

      if (method === 'GET' && !action) {
        return sendJson(res, 200, {
          item,
          script: await readJsonSafe(join(item.dir, '01-script', 'script.json')),
          plan: await readJsonSafe(join(item.dir, '05-edl', 'edit-plan.json')),
          report: await readJsonSafe(join(item.dir, '08-validate', 'report.json')),
          review: await readJsonSafe(join(item.dir, '09-review', 'review.json')),
          media: await mediaIndex(item),
        })
      }

      if (method === 'POST' && action === 'rerun') {
        const body = await readJson(req)
        const from = body.from || 'render'
        if (!STEP_ORDER.includes(from)) return sendJson(res, 400, { error: `未知步骤：${from}` })
        if (item.status === ITEM_STATUS.approved) return sendJson(res, 409, { error: '已通过的条目不能重做，请先撤回' })
        if (item.status === ITEM_STATUS.running) return sendJson(res, 409, { error: '条目正在运行，等它结束再重做' })
        await resetStepsFrom(batchId, item.id, from)
        if (runner) {
          runner.enqueue(batchId, [item.id])
          await updateBatch(batchId, () => ({ status: 'running' }))
        }
        return sendJson(res, 200, { itemId: item.id, from, enqueued: Boolean(runner) })
      }

      if (method === 'POST' && action === 'approve') {
        if (item.status !== ITEM_STATUS.reviewPending) {
          return sendJson(res, 409, { error: `只有待审核的条目能通过，当前是 ${item.status}` })
        }
        const review = {
          decision: 'approved',
          decidedAt: Date.now(),
          note: (await readJson(req)).note || '',
        }
        await writeJson(join(item.dir, '09-review', 'review.json'), review)
        await updateItem(batchId, item.id, () => ({ status: ITEM_STATUS.approved }))
        let publishJob = null
        const approvedBatch = await loadBatch(batchId)
        if (approvedBatch?.config?.publish?.enabled && (approvedBatch.config.publish.targetIntegrationIds || []).length > 0) {
          try {
            publishJob = await schedulePublication(batchId, item.id, {
              integrationIds: approvedBatch.config.publish.targetIntegrationIds,
              policy: 'after_approval',
            })
          } catch (publishError) {
            console.warn('[content-studio] 创建发布任务失败:', publishError.message)
          }
        }
        await runner?.refreshBatchStatus(batchId)
        return sendJson(res, 200, { itemId: item.id, status: ITEM_STATUS.approved, publishJob })
      }

      if (method === 'POST' && action === 'reject') {
        if (item.status !== ITEM_STATUS.reviewPending) {
          return sendJson(res, 409, { error: `只有待审核的条目能驳回，当前是 ${item.status}` })
        }
        const body = await readJson(req)
        if (!body.reason) return sendJson(res, 400, { error: '驳回需要原因' })
        const previousScript = await readJsonSafe(join(item.dir, '01-script', 'script.json'))
        const review = {
          decision: 'rejected',
          reason: body.reason,
          note: body.note || '',
          decidedAt: Date.now(),
          previous: previousScript
            ? {
                title: previousScript.title || '',
                narration: (previousScript.narration || []).map((line) => line.text).filter(Boolean),
                shots: (previousScript.shotList || []).map((shot) => shot.intent).filter(Boolean),
              }
            : null,
        }
        await writeJson(join(item.dir, '09-review', 'review.json'), review)
        await resetStepsFrom(batchId, item.id, 'script')
        if (runner) {
          runner.enqueue(batchId, [item.id])
          await updateBatch(batchId, () => ({ status: 'running' }))
        }
        return sendJson(res, 200, { itemId: item.id, status: ITEM_STATUS.pending, revising: true })
      }

      if (method === 'POST' && action === 'retry') {
        if (item.status === ITEM_STATUS.approved) return sendJson(res, 409, { error: '已通过的条目不能重新入队，请先撤回' })
        const review = await readJsonSafe(join(item.dir, '09-review', 'review.json'))
        if (review?.decision === 'rejected') {
          await resetStepsFrom(batchId, item.id, 'script')
        } else {
          await updateItem(batchId, item.id, () => ({ status: ITEM_STATUS.pending, error: null }))
        }
        runner?.enqueue(batchId, [item.id])
        return sendJson(res, 200, { itemId: item.id, enqueued: Boolean(runner) })
      }

      /**
       * Edit the copy in place. Only the text fields are writable — the render is
       * untouched, so only validation has to run again.
       */
      if (method === 'POST' && action === 'script') {
        if (item.status === ITEM_STATUS.approved) return sendJson(res, 409, { error: '已通过的条目不能改文案，请先撤回' })
        const body = await readJson(req)
        const scriptPath = join(item.dir, '01-script', 'script.json')
        const script = await readJsonSafe(scriptPath)
        if (!script) return sendJson(res, 404, { error: 'script.json 不存在，先跑一次文案步骤' })

        const writable = ['title', 'description', 'hashtags', 'coverText', 'hook']
        const changed = writable.filter((key) => body[key] !== undefined)
        if (changed.length === 0) return sendJson(res, 400, { error: `可编辑字段：${writable.join(' / ')}` })

        const next = { ...script }
        for (const key of changed) next[key] = body[key]
        next._editedAt = Date.now()
        await writeJson(scriptPath, next)
        await resetStepsFrom(batchId, item.id, 'validate')
        if (runner) {
          runner.enqueue(batchId, [item.id])
          await updateBatch(batchId, () => ({ status: 'running' }))
        }
        return sendJson(res, 200, { itemId: item.id, changed, enqueued: Boolean(runner) })
      }

      if (method === 'POST' && action === 'unapprove') {
        if (item.status !== ITEM_STATUS.approved) return sendJson(res, 409, { error: '只有已通过的条目才能撤回' })
        const reviewPath = join(item.dir, '09-review', 'review.json')
        const review = (await readJsonSafe(reviewPath)) || {}
        await writeJson(reviewPath, { ...review, decision: 'withdrawn', withdrawnAt: Date.now() })
        await updateItem(batchId, item.id, () => ({ status: ITEM_STATUS.reviewPending }))
        const withdrawnBatch = await loadBatch(batchId)
        if (withdrawnBatch) {
          const jobs = await listPublishJobs(withdrawnBatch.dir)
          for (const job of jobs.filter((entry) => entry.itemId === item.id && [PUBLISH_STATUS.scheduled, PUBLISH_STATUS.publishing].includes(entry.status))) {
            await updatePublishJob(withdrawnBatch.dir, job.id, () => ({ status: PUBLISH_STATUS.cancelled, leaseUntil: null, nextAttemptAt: null }))
          }
        }
        await runner?.refreshBatchStatus(batchId)
        return sendJson(res, 200, { itemId: item.id, status: ITEM_STATUS.reviewPending })
      }

      if (method === 'GET' && action === 'log') {
        return sendJson(res, 200, {
          itemId: item.id,
          title: item.title,
          log: await readText(join(item.dir, 'item.log')),
        })
      }

      if (method === 'GET' && action === 'export') {
        const parent = await loadBatch(batchId)
        const zip = await buildItemZip(item, parent?.config || {})
        return sendZip(res, zip, itemExportName(item))
      }

      if (method === 'GET' && action === 'publish') {
        const batch = await loadBatch(batchId)
        return sendJson(res, 200, { jobs: batch ? await listPublishJobs(batch.dir) : [] })
      }

      if (method === 'POST' && action === 'publish') {
        const body = await readJson(req)
        const job = await schedulePublication(batchId, item.id, body)
        return sendJson(res, 200, { itemId: item.id, job })
      }

      if (method === 'POST' && action === 'publish/retry') {
        const batch = await loadBatch(batchId)
        const jobs = batch ? await listPublishJobs(batch.dir) : []
        const current = jobs.filter((job) => job.itemId === item.id).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
        if (!current) return sendJson(res, 404, { error: '没有可重试的发布任务' })
        const job = await updatePublishJob(batch.dir, current.id, (existing) => ({
          status: PUBLISH_STATUS.scheduled,
          nextAttemptAt: new Date().toISOString(),
          leaseUntil: null,
          lastError: null,
        }))
        await publisher?.tick()
        return sendJson(res, 200, { itemId: item.id, job })
      }

      if (method === 'POST' && action === 'publish/cancel') {
        const batch = await loadBatch(batchId)
        const jobs = batch ? await listPublishJobs(batch.dir) : []
        const active = jobs.filter((job) => job.itemId === item.id && [PUBLISH_STATUS.scheduled, PUBLISH_STATUS.publishing].includes(job.status))
        for (const job of active) {
          await updatePublishJob(batch.dir, job.id, () => ({ status: PUBLISH_STATUS.cancelled, leaseUntil: null, nextAttemptAt: null }))
        }
        return sendJson(res, 200, { itemId: item.id, cancelled: active.length })
      }

      if (method === 'POST' && action === 'distribute') {
        if (item.status !== ITEM_STATUS.approved) {
          return sendJson(res, 409, { error: `只有审核通过的条目能分发，当前是 ${item.status}` })
        }
        const body = await readJson(req)
        const videoPath = join(item.dir, '06-render', 'master.mp4')
        if (!(await fileSize(videoPath))) return sendJson(res, 409, { error: '成片还没生成，不能分发' })
        const script = await readJsonSafe(join(item.dir, '01-script', 'script.json')) || {}
        try {
          const result = await distributeItem(await loadPostiz(), {
            videoPath,
            script,
            integrationIds: body.integrationIds,
          })
          await writeJson(join(item.dir, '10-distribute', 'result.json'), result)
          await updateItem(batchId, item.id, () => ({ distribute: { at: result.at, channels: result.channels } }))
          return sendJson(res, 200, { itemId: item.id, distribute: result })
        } catch (error) {
          return sendJson(res, error.status || 502, { error: messageOf(error) })
        }
      }
    }

    /* ---------------- clips / films ---------------- */
    if (method === 'GET' && path === '/clips') {
      const clips = await listClips()
      return sendJson(res, 200, { clips: clips.map((clip) => publicClip(clip, prefix)) })
    }

    if (method === 'POST' && path === '/clips') {
      const body = await readJson(req)
      const prompt = String(body.prompt || '').trim()
      if (!prompt) return sendJson(res, 400, { error: '提示词不能为空' })
      const roles = await resolveRoleProviders(await loadProviders())
      if (!roles.video) return sendJson(res, 400, { error: '未配置视频模型。到设置里加百炼万相。' })
      const aspectRatio = body.aspectRatio === '16:9' || body.aspectRatio === '1:1' ? body.aspectRatio : '9:16'
      const resolution = body.resolution === '1080P' ? '1080P' : '480P'
      const durationSec = normalizeClipSec(body.durationSec, 5)
      const clip = await upsertClip({
        id: newClipId(),
        prompt,
        status: 'running',
        aspectRatio,
        resolution,
        durationSec,
        imageUrl: /^https?:\/\//i.test(String(body.imageUrl || '')) ? String(body.imageUrl) : undefined,
        createdAt: Date.now(),
      })
      void generateClip(clip, roles.video).then((next) => {
        broadcast({ type: 'clip', clip: publicClip(next, prefix) })
      })
      return sendJson(res, 200, { clip: publicClip(clip, prefix) })
    }

    const clipMatch = /^\/clips\/([^/]+)(?:\/(file|retry))?$/.exec(path)
    if (clipMatch) {
      const id = decodeURIComponent(clipMatch[1])
      const clip = await getClip(id)
      if (!clip) return sendJson(res, 404, { error: `镜头不存在：${id}` })
      if (method === 'DELETE' && !clipMatch[2]) {
        await removeClip(id)
        return sendJson(res, 200, { ok: true })
      }
      if (method === 'POST' && clipMatch[2] === 'retry') {
        const roles = await resolveRoleProviders(await loadProviders())
        if (!roles.video) return sendJson(res, 400, { error: '未配置视频模型。到设置里加百炼万相。' })
        const next = await upsertClip({ id, status: 'running', error: null })
        void generateClip(next, roles.video).then((updated) => {
          broadcast({ type: 'clip', clip: publicClip(updated, prefix) })
        })
        return sendJson(res, 200, { clip: publicClip(next, prefix) })
      }
      if (method === 'GET' && clipMatch[2] === 'file') {
        const target = resolve(clip.file || clipFile(id))
        const root = resolve(clipsRoot())
        if (!target.startsWith(root + sep)) return sendJson(res, 403, { error: '路径越界' })
        return serveLocalFile(req, res, target)
      }
      if (method === 'GET' && !clipMatch[2]) {
        return sendJson(res, 200, { clip: publicClip(clip, prefix) })
      }
    }

    if (method === 'POST' && path === '/films') {
      const body = await readJson(req)
      const result = await assembleFilm({
        clipIds: body.clipIds,
        targetSec: body.targetSec,
        prompt: body.prompt,
        aspectRatio: body.aspectRatio,
        resolution: body.resolution,
      })
      const roles = await resolveRoleProviders(await loadProviders())
      const started = Boolean(runner && roles.llm && roles.tts)
      if (started) await runner.startBatch(result.batch.id)
      return sendJson(res, 200, {
        batch: await loadBatch(result.batch.id),
        started,
        durationSec: result.durationSec,
        clipIds: result.clipIds,
        notice: [
          started ? '已开始配音和封面' : '镜头已拼接。配置文案和配音模型后可继续成片。',
          result.shortfall ? `画面只有 ${Math.round(result.visualSec)} 秒，成片按这个时长，不再循环同一镜。要 ${result.requested} 秒请先点生成出够长的镜头。` : '',
        ].filter(Boolean).join(' '),
      })
    }

    /* ---------------- media ---------------- */
    const mediaMatch = /^\/media\/([^/]+)\/([^/]+)\/(.+)$/.exec(path)
    if (method === 'GET' && mediaMatch) {
      const [, batchId, itemId, rest] = mediaMatch
      return serveMedia(req, res, batchId, decodeURIComponent(itemId), rest)
    }

    return sendJson(res, 404, { error: `未知接口 ${method} ${path}` })
  }

  async function findItem(itemId) {
    const batches = await listBatches(200)
    for (const batch of batches) {
      const summary = batch.items.find((entry) => entry.id === itemId)
      if (!summary) continue
      const { item } = await loadItem(batch.id, itemId)
      return { batchId: batch.id, item }
    }
    return null
  }

  async function mediaIndex(item) {
    return {
      master: await fileSize(join(item.dir, '06-render', 'master.mp4')),
      thumb: await fileSize(join(item.dir, '06-render', 'thumb.jpg')),
      covers: {
        vertical: await fileSize(join(item.dir, '07-cover', 'cover-vertical.png')),
        horizontal: await fileSize(join(item.dir, '07-cover', 'cover-horizontal.png')),
        square: await fileSize(join(item.dir, '07-cover', 'cover-square.png')),
      },
      base: `/content-studio/api/media/${encodeURIComponent(item.batchId)}/${encodeURIComponent(item.id)}`,
    }
  }

  async function serveMedia(req, res, batchId, itemId, rest) {
    const batch = await loadBatch(batchId)
    if (!batch) return sendJson(res, 404, { error: '批次不存在' })
    const located = await findItem(itemId)
    if (!located || located.batchId !== batchId) return sendJson(res, 404, { error: '条目不存在' })

    const root = resolve(located.item.dir)
    const target = resolve(join(root, normalize(rest)))
    if (!target.startsWith(root + sep)) return sendJson(res, 403, { error: '路径越界' })
    return serveLocalFile(req, res, target)
  }

  async function serveLocalFile(req, res, target) {
    let info
    try {
      info = await stat(target)
    } catch {
      return sendJson(res, 404, { error: '文件不存在' })
    }
    if (!info.isFile()) return sendJson(res, 404, { error: '不是文件' })

    const type = contentTypeOf(target)
    const range = req.headers?.range
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match) {
        const start = match[1] ? Number(match[1]) : 0
        const end = match[2] ? Number(match[2]) : Math.min(info.size - 1, start + 4 * 1024 * 1024)
        res.writeHead(206, {
          'content-type': type,
          'content-range': `bytes ${start}-${end}/${info.size}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
        })
        createReadStream(target, { start, end }).pipe(res)
        return
      }
    }

    res.writeHead(200, { 'content-type': type, 'content-length': info.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' })
    createReadStream(target).pipe(res)
  }

  function openStream(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    })
    res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`)
    streams.add(res)
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        clearInterval(ping)
      }
    }, 20000)
    req.on('close', () => {
      clearInterval(ping)
      streams.delete(res)
    })
  }

  return { handler, broadcast, stats: () => ({ streams: streams.size }) }
}

async function probeFromBody(req, res) {
  const body = await readJson(req)
  const existing = body.id ? (await loadProviders()).find((row) => row.id === body.id) : null
  const cfg = { ...(existing || {}), ...body }
  if (!cfg.apiKey || cfg.apiKey === MASK) cfg.apiKey = existing?.apiKey
  delete cfg.want
  delete cfg._existing
  delete cfg.hasApiKey
  if (cfg.kind === 'dashscope-wan' && !cfg.origin && cfg.baseUrl) cfg.origin = cfg.baseUrl
  if (body.want === 'test') {
    const job = await runProviderTest(cfg, body)
    return sendJson(res, 200, { job, health: { ok: job.status === 'succeeded', detail: job.detail || job.error } })
  }
  if (body.want === 'models') {
    try {
      const models = await listUpstreamModels(cfg)
      return sendJson(res, 200, {
        models,
        health: { ok: models.length > 0, detail: models.length ? `${models.length} 个模型` : '没有模型' },
      })
    } catch (error) {
      return sendJson(res, 200, { models: [], health: { ok: false, detail: messageOf(error) } })
    }
  }
  try {
    const instance = await createProvider(cfg)
    return sendJson(res, 200, { health: await instance.healthCheck(), models: [] })
  } catch (error) {
    return sendJson(res, 200, { health: { ok: false, detail: messageOf(error) }, models: [] })
  }
}

async function runProviderTest(provider, body) {
  const job = { id: `test-${Date.now()}`, providerId: provider.id, kind: provider.kind, status: 'running', startedAt: Date.now() }
  try {
    const instance = await createProvider(provider)
    const health = await instance.healthCheck()
    if (!health.ok) throw new Error(health.detail || '健康检查未通过')
    const role = roleOf(provider)
    if (role === 'llm') {
      const out = await instance.complete({ system: '只回复 OK', user: 'ping', maxTokens: 5 })
      Object.assign(job, { status: 'succeeded', detail: String(out.text).slice(0, 120) })
    } else if (role === 'tts') {
      const out = await instance.synthesize({ text: '测试', voice: body.voice || instance.voice })
      Object.assign(job, { status: 'succeeded', detail: `${out.audio.length} 字节音频` })
    } else if (role === 'image') {
      const out = await instance.generate({ prompt: body.prompt || 'a plain blue gradient, no text' })
      Object.assign(job, { status: 'succeeded', detail: `${out.image.length} 字节图片` })
    } else if (role === 'video') {
      // 真跑一次短生成：这是"填完配置就能用"的验证按钮，不是健康探测。
      const started = await instance.submit({
        prompt: body.prompt || '一个简单的测试镜头，纯色背景，画面里没有文字',
        durationSec: Number(body.durationSec) || 3,
        aspectRatio: body.aspectRatio || '9:16',
        resolution: provider.defaults?.resolution,
        seed: body.seed,
      })
      const deadline = Date.now() + Math.min(Number(body.timeoutMs) || 90000, 5 * 60 * 1000)
      const interval = Number(instance.intervalMs) || 2000
      let state = { state: 'queued' }
      while (Date.now() < deadline) {
        state = await instance.poll(started.taskId)
        if (state.state === 'succeeded') break
        if (state.state === 'failed') throw new Error(state.error || `视频任务 ${started.taskId} 失败`)
        await new Promise((resolve) => setTimeout(resolve, interval))
      }
      if (state.state !== 'succeeded') throw new Error(`测试生成超时（${started.taskId} 仍是 ${state.state}）`)
      Object.assign(job, {
        status: 'succeeded',
        taskId: started.taskId,
        detail: state.videoUrl || state.localPath || '已生成（未返回地址）',
        videoUrl: state.videoUrl,
        localPath: state.localPath,
      })
    } else {
      Object.assign(job, { status: 'succeeded', detail: '健康检查通过（视频生成请在建批次后验证）' })
    }
  } catch (error) {
    Object.assign(job, { status: 'failed', error: messageOf(error) })
  }
  job.finishedAt = Date.now()
  return job
}

/** Aggregate per-item usage into one batch total, priced by the batch's own table. */
function batchTotals(batch) {
  const items = Array.isArray(batch?.items) ? batch.items : []
  const usage = sumUsage(items.map((item) => item.usage))
  const cost = computeCost(usage, batch?.config?.pricing || {})
  const rawCap = Number(batch?.config?.costCap)
  const costCap = Number.isFinite(rawCap) && rawCap > 0 ? rawCap : null
  const ratio = costCap && cost.priced ? cost.total / costCap : 0
  const publish = items.reduce((acc, item) => {
    const status = item.publish?.status || 'not_requested'
    acc[status] = (acc[status] || 0) + 1
    return acc
  }, {})
  return {
    usage,
    cost,
    items: items.length,
    publish,
    costCap,
    capRatio: ratio,
    capWarning: ratio >= 0.8,
    capReached: ratio >= 1,
  }
}

async function readText(file, limit = 200_000) {
  try {
    const text = await readFile(file, 'utf8')
    return text.length > limit ? text.slice(-limit) : text
  } catch {
    return ''
  }
}

function sendZip(res, buffer, filename) {
  res.writeHead(200, {
    'content-type': 'application/zip',
    'content-length': buffer.length,
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  })
  res.end(buffer)
}

function contentTypeOf(file) {
  switch (extname(file).toLowerCase()) {
    case '.mp4': return 'video/mp4'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.json': return 'application/json; charset=utf-8'
    case '.srt': return 'text/plain; charset=utf-8'
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    default: return 'application/octet-stream'
  }
}

async function fileSize(path) {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

async function readJsonSafe(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress || ''
  return address === '' || address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.')
}

function readJson(req) {
  return new Promise((resolveFn, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体超过 1MB'), { status: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolveFn({})
      try {
        resolveFn(JSON.parse(text))
      } catch (error) {
        reject(Object.assign(new Error(`请求体不是合法 JSON：${error.message}`), { status: 400 }))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

function messageOf(error) {
  if (!error) return 'unknown error'
  return error.detail
    ? `${error.message} — ${typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail)}`
    : error.message || String(error)
}

export { resolveRoleProviders, writeFile }
