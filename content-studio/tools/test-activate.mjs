/**
 * 激活路径校验：用假的 ctx 调真正的 apply()，验证 index.js 的接线。
 * 覆盖：路由注册、effect 清理、启动续跑、未找到 webServer 时降级。
 *   node tools/test-activate.mjs
 */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CONTENT_STUDIO_HOME = await mkdtemp(join(tmpdir(), 'cs-activate-'))

const { apply } = await import('../index.js')
const { resolveTools, ffmpeg } = await import('../lib/ffmpeg.js')
const { createBatch, loadBatch, updateItem } = await import('../lib/batch-store.js')
const { scanMaterials } = await import('../lib/steps/scan.js')
const { writeWav } = await import('../lib/wav.js')
const { upsertProvider } = await import('../lib/store.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

const tools = await resolveTools()
check('ffmpeg 可用', tools.ok, tools.error)

function fakeCtx() {
  const routes = []
  const effects = []
  const provided = {}
  return {
    routes,
    effects,
    provided,
    get: (key) => (key === 'webServer' ? { register: (route) => (routes.push(route), () => {}) } : undefined),
    effect: (fn) => {
      const disposer = typeof fn === 'function' ? fn() : undefined
      effects.push({ fn, disposer })
      return () => disposer?.()
    },
    provide: (name, value) => {
      provided[name] = value
    },
  }
}

/* ---------- 缺 webServer 时安静降级 ---------- */
let warned = false
const originalWarn = console.warn
console.warn = () => { warned = true }
apply({ get: () => undefined, effect: () => {} })
console.warn = originalWarn
check('缺 webServer 时只告警不抛错', warned)

/* ---------- 正常激活 ---------- */
const ctx = fakeCtx()
apply(ctx)
check('注册了一条路由', ctx.routes.length === 1)
check('路由是前缀匹配 /content-studio/api', ctx.routes[0].kind === 'prefix' && ctx.routes[0].path === '/content-studio/api')
check('注册了两个 effect（路由 + 生命周期）', ctx.effects.length === 2)
check('暴露了 contentStudio 服务', Boolean(ctx.provided.contentStudio?.runner))

/* ---------- 通过真 http server 打接口 ---------- */
const server = createServer((req, res) => void ctx.routes[0].handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/content-studio/api`

const meta = await (await fetch(`${base}/meta`)).json()
check('apply 之后 meta 可用', Array.isArray(meta.steps) && meta.steps.length === 8)
check('meta 含 6 种 kind', meta.kinds.length === 6, JSON.stringify(meta.kinds))

const health = await (await fetch(`${base}/health`)).json()
check('health 报告 ffmpeg 与队列', health.ffmpeg.ok === true && Boolean(health.queue))

/* ---------- 启动续跑 ---------- */
const lib = await mkdtemp(join(tmpdir(), 'cs-activate-lib-'))
await mkdir(join(lib, '演示'), { recursive: true })
await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=360x640:d=2:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(lib, '演示', 'a.mp4')])
const scanned = await scanMaterials({ dirs: [lib], tools })
check('素材可选', scanned.index.entries.length === 1)

// 配一个本地 http-generic 视频服务？不需要——用 library 镜头即可，只需 llm + tts。
// 但真实 provider 会打网络，所以这里只验证「续跑把 running 重置为 pending 并入队」，
// 入队后因为缺 provider 会失败，这本身也是可观测行为。
await upsertProvider({ id: 'noop', kind: 'llm', enabled: false, baseUrl: 'http://127.0.0.1:1' })

const batch = await createBatch({ title: '续跑验证', count: 1, config: { topic: '演示', targetSec: 8, fps: 30 } })
await updateItem(batch.id, batch.items[0].id, () => ({ status: 'running' }))

const runner = ctx.provided.contentStudio.runner
const queueBefore = runner.snapshot().queued
check('激活前队列为空', queueBefore === 0)

const resumed = await runner.resumeUnfinished()
check('续跑发现 1 个批次', resumed.length >= 1, JSON.stringify(resumed))
check('续跑报告包含该批次 1 条', resumed.some((entry) => entry.batchId === batch.id && entry.items === 1), JSON.stringify(resumed))

await runner.waitIdle()
const after = await loadBatch(batch.id)
check('缺 provider 时条目失败而非卡死', after.items[0].status === 'failed', after.items[0].status)
check('失败原因指向缺失能力', /模型|provider|未配置/i.test(after.items[0].error || ''), after.items[0].error)

/* ---------- 清理 ---------- */
const dispose = ctx.effects[1].disposer
check('生命周期 effect 返回清理函数', typeof dispose === 'function')
dispose()
check('stop 后队列清空', runner.snapshot().queued === 0)

server.close()
await rm(lib, { recursive: true, force: true }).catch(() => {})
await rm(process.env.CONTENT_STUDIO_HOME, { recursive: true, force: true }).catch(() => {})

console.log(`\nALL ACTIVATION CHECKS PASSED (${passed})`)
