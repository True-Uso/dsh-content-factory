/**
 * 批量并发 + 断点续跑校验。
 *   node tools/test-worker.mjs
 */
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CONTENT_STUDIO_HOME = await mkdtemp(join(tmpdir(), 'cs-worker-'))

const { resolveTools, ffmpeg } = await import('../lib/ffmpeg.js')
const { createBatch, loadBatch, loadItem, updateItem } = await import('../lib/batch-store.js')
const { scanMaterials } = await import('../lib/steps/scan.js')
const { createRunner } = await import('../lib/worker.js')
const { writeWav } = await import('../lib/wav.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

const tools = await resolveTools()
check('ffmpeg 可用', tools.ok, tools.error)

const lib = await mkdtemp(join(tmpdir(), 'cs-worker-lib-'))
await mkdir(join(lib, '日常'), { recursive: true })
for (const color of ['goldenrod', 'seagreen', 'indianred', 'steelblue', 'darkorange', 'mediumseagreen', 'orchid', 'slategray']) {
  await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=360x640:d=2:r=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(lib, '日常', `${color}.mp4`)])
}
const scanned = await scanMaterials({ dirs: [lib], tools })
check('素材索引 8 条', scanned.index.entries.length === 8, String(scanned.index.entries.length))

function toneWav(seconds, freq = 220, sampleRate = 24000) {
  const frames = Math.round(sampleRate * seconds)
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 8000), i * 2)
  return writeWav({ sampleRate, channels: 1, bitsPerSample: 16, data })
}

let llmCalls = 0
const llm = {
  async complete() {
    llmCalls += 1
    return {
      json: {
        title: `批量测试 ${llmCalls}`,
        narration: [{ id: 's1', text: '第一句。' }, { id: 's2', text: '第二句。' }],
        description: 'd',
        hashtags: ['#测试'],
        coverText: { main: '批量', sub: '测试' },
        coverPrompt: 'plain background, no text',
        shotList: [
          { id: 'a', intent: '街景', source: 'library', durationSec: 2 },
          { id: 'b', intent: '细节', source: 'library', durationSec: 2 },
        ],
      },
    }
  },
}
const tts = { voice: 'mock', async synthesize({ text }) { return { audio: toneWav(Math.max(0.5, Array.from(text).length * 0.14)) } } }

const videoDir = await mkdtemp(join(tmpdir(), 'cs-worker-vid-'))
await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=teal:s=360x640:d=3:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(videoDir, 'g.mp4')])
let submits = 0
const video = {
  async submit() { submits += 1; return { taskId: `t${submits}` } },
  async poll() { return { state: 'succeeded', localPath: join(videoDir, 'g.mp4') } },
  intervalMs: 5,
  timeoutMs: 5000,
}

/* ---------- 批量 3 条，并发 2 ---------- */
const batch = await createBatch({
  title: '批量测试',
  count: 3,
  config: { topic: '日常', targetSec: 12, aspectRatio: '9:16', materialMode: 'folder', group: '日常', fps: 30, voice: 'mock' },
})

const events = []
const runner = createRunner({
  concurrency: 2,
  tools,
  materials: scanned.index.entries,
  providers: { llm, tts },
  onEvent: (event) => events.push(event),
})

const started = Date.now()
const enqueued = await runner.startBatch(batch.id)
check('入队 3 条', enqueued.enqueued === 3, JSON.stringify(enqueued))
await runner.waitIdle()
const elapsed = Date.now() - started
console.log(`  3 条耗时 ${(elapsed / 1000).toFixed(1)}s`)

const after = await loadBatch(batch.id)
check('三条全部待审', after.items.every((item) => item.status === 'review_pending'), JSON.stringify(after.items.map((i) => ({ s: i.status, e: i.error }))))
check('批次状态为 review', after.status === 'review', after.status)
check('三条都产出了成片', after.items.length === 3)

for (const item of after.items) {
  const master = await stat(join(item.dir, '06-render/master.mp4')).catch(() => null)
  check(`${item.id} 成片存在`, Boolean(master && master.size > 10000))
}
check('模型被调用 3 次', llmCalls === 3, String(llmCalls))

/* ---------- 同批次不重复用同一份素材 ---------- */
const sourcePaths = []
for (const item of after.items) {
  const manifest = JSON.parse(await readFile(join(item.dir, '04-visual', 'manifest.json'), 'utf8'))
  for (const shot of manifest) if (shot.sourcePath) sourcePaths.push(shot.sourcePath)
}
check('三条内容共用了 6 个镜头', sourcePaths.length === 6, String(sourcePaths.length))
check('同批次素材不重复', new Set(sourcePaths).size === sourcePaths.length, JSON.stringify(sourcePaths.map((p) => p.split('\\').pop())))

const progressEvents = events.filter((e) => e.type === 'item:progress')
check('有进度事件', progressEvents.length > 0)
const maxConcurrent = (() => {
  let current = 0
  let peak = 0
  for (const event of events) {
    if (event.type === 'item:start') peak = Math.max(peak, ++current)
    if (event.type === 'item:end') current -= 1
  }
  return peak
})()
check('并发不超过 2', maxConcurrent <= 2, String(maxConcurrent))
check('并发确实用到了 2', maxConcurrent === 2, String(maxConcurrent))

/* ---------- 断点续跑 ---------- */
const batch2 = await createBatch({ title: '续跑批次', count: 2, config: { topic: '日常', targetSec: 12, materialMode: 'pool', fps: 30, voice: 'mock' } })
// 模拟进程崩溃：一条停在 running，另一条 pending
await updateItem(batch2.id, batch2.items[0].id, () => ({ status: 'running' }))
const runner2 = createRunner({ concurrency: 2, tools, materials: scanned.index.entries, providers: { llm, tts } })
const resumed = await runner2.resumeUnfinished()
check('续跑发现未完成批次', resumed.some((r) => r.batchId === batch2.id), JSON.stringify(resumed))
await runner2.waitIdle()
const resumedBatch = await loadBatch(batch2.id)
check('崩溃后继续跑完', resumedBatch.items.every((item) => item.status === 'review_pending'), JSON.stringify(resumedBatch.items.map((i) => i.status)))
const crashedItem = (await loadItem(batch2.id, batch2.items[0].id)).item
check('崩溃条目从 pending 重跑', crashedItem.status === 'review_pending')

/* ---------- 批次级并发配置 ---------- */
const batchC = await createBatch({
  title: '并发配置批次', count: 2,
  config: { topic: '日常', targetSec: 10, materialMode: 'pool', fps: 30, voice: 'mock', concurrency: 4 },
})
const runnerC = createRunner({ concurrency: 2, tools, materials: scanned.index.entries, providers: { llm, tts } })
await runnerC.startBatch(batchC.id)
check('批次配置的并发度生效', runnerC.concurrency === 4, String(runnerC.concurrency))
runnerC.cancelBatch(batchC.id)
await runnerC.waitIdle()

/* ---------- 暂停 / 取消 ---------- */
const batch3 = await createBatch({ title: '暂停批次', count: 2, config: { topic: '日常', targetSec: 10, materialMode: 'pool', fps: 30, voice: 'mock' } })
const runner3 = createRunner({ concurrency: 1, tools, materials: scanned.index.entries, providers: { llm, tts } })
await runner3.startBatch(batch3.id)
runner3.pauseBatch(batch3.id)
await new Promise((resolve) => setTimeout(resolve, 400))
const pausedBatch = await loadBatch(batch3.id)
// 暂停语义：不再取新任务；已在跑的那条会跑完
check('暂停后不再推进新条目', pausedBatch.items[1].status === 'pending', JSON.stringify(pausedBatch.items.map((i) => i.status)))
check('暂停状态可见', runner3.snapshot().paused.includes(batch3.id))
const stillQueued = runner3.snapshot().queued
check('暂停后队列保留', stillQueued >= 1, String(stillQueued))

runner3.cancelBatch(batch3.id)
await new Promise((resolve) => setTimeout(resolve, 150))
check('取消清空该批次队列', runner3.snapshot().queued === 0, JSON.stringify(runner3.snapshot()))
const cancelledBatch = await loadBatch(batch3.id)
check('批次标记为已取消', cancelledBatch.status === 'cancelled', cancelledBatch.status)

await runner3.waitIdle().catch(() => {})
await rm(lib, { recursive: true, force: true }).catch(() => {})
await rm(videoDir, { recursive: true, force: true }).catch(() => {})
await rm(process.env.CONTENT_STUDIO_HOME, { recursive: true, force: true }).catch(() => {})

console.log(`\nALL WORKER CHECKS PASSED (${passed})`)
