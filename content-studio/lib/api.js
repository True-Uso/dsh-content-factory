import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
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
import { PROVIDER_KINDS, createProvider, resolveRoleProviders, roleOf } from './providers.js'
import { dataDir, loadProviders, providersFile, removeProvider, upsertProvider } from './store.js'
import { computeCost, sumUsage } from './cost.js'
import { preflight } from './preflight.js'
import { listGroups, loadIndex, scanMaterials } from './steps/scan.js'
import { listPlatforms, normalizeBatchConfig } from './platforms.js'
import { batchExportName, buildBatchZip, buildItemZip, itemExportName } from './export.js'

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
export function createApi({ runner, prefix = '/content-studio/api', allowedOrigin = null }) {
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

  async function route(method, path, url, req, res) {
    /* ---------------- meta ---------------- */
    if (method === 'GET' && path === '/meta') {
      return sendJson(res, 200, {
        kinds: [...PROVIDER_KINDS, 'llm', 'tts', 'image'],
        roles: ['video', 'llm', 'tts', 'image'],
        steps: STEP_ORDER,
        reviewReasons: REVIEW_REASONS,
        platforms: listPlatforms(),
        reviewModes: [
          { id: 'required', label: '需人工审核' },
          { id: 'auto', label: '自动放行' },
        ],
        dataDir: dataDir(),
        providersFile: providersFile(),
        note: 'ark-seedance 已预留，需要方舟控制台的模型 ID 才能启用',
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

    /* ---------------- providers ---------------- */
    if (method === 'GET' && path === '/providers') {
      const providers = await loadProviders()
      return sendJson(res, 200, { providers: providers.map(maskProvider) })
    }

    const providerMatch = /^\/providers\/([^/]+)(\/health|\/test)?$/.exec(path)
    if (providerMatch) {
      const id = decodeURIComponent(providerMatch[1])
      const action = providerMatch[2]

      if (method === 'PUT' && !action) {
        if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) return sendJson(res, 400, { error: 'id 只能包含字母、数字、点、下划线、短横线（≤64）' })
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

    if (method === 'POST' && path === '/batches') {
      const body = await readJson(req)
      if (!body.title && !body.config?.topic) return sendJson(res, 400, { error: '需要 title 或 config.topic' })
      const config = normalizeBatchConfig(body.config || {})
      const tools = await resolveTools()
      const injected = runner?.roles?.()
      const roles = injected || new Set((await loadProviders()).filter((p) => p.enabled !== false).map((p) => roleOf(p)))
      const index = await loadIndex()
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
      })
      return sendJson(res, 200, { batch, preflight: check })
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
    const itemMatch = /^\/items\/([^/]+)(?:\/(rerun|approve|reject|retry|script|unapprove|log|export))?$/.exec(path)
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
        await runner?.refreshBatchStatus(batchId)
        return sendJson(res, 200, { itemId: item.id, status: ITEM_STATUS.approved })
      }

      if (method === 'POST' && action === 'reject') {
        if (item.status !== ITEM_STATUS.reviewPending) {
          return sendJson(res, 409, { error: `只有待审核的条目能驳回，当前是 ${item.status}` })
        }
        const body = await readJson(req)
        if (!body.reason) return sendJson(res, 400, { error: '驳回需要原因' })
        const review = {
          decision: 'rejected',
          reason: body.reason,
          note: body.note || '',
          decidedAt: Date.now(),
        }
        await writeJson(join(item.dir, '09-review', 'review.json'), review)
        await updateItem(batchId, item.id, () => ({ status: ITEM_STATUS.rejected }))
        await runner?.refreshBatchStatus(batchId)
        return sendJson(res, 200, { itemId: item.id, status: ITEM_STATUS.rejected })
      }

      if (method === 'POST' && action === 'retry') {
        if (item.status === ITEM_STATUS.approved) return sendJson(res, 409, { error: '已通过的条目不能重新入队，请先撤回' })
        await updateItem(batchId, item.id, () => ({ status: ITEM_STATUS.pending, error: null }))
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
  return {
    usage,
    cost,
    items: items.length,
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
