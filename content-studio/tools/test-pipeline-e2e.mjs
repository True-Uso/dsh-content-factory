/**
 * 单条全链路（P2 验收）：素材 → 文案 → 配音 → 字幕 → 画面 → EDL → 渲染 → 封面 → 校验。
 * 用 mock 的 LLM / TTS / 视频模型，其余全部真跑（含 ffmpeg 渲染）。
 *   node tools/test-pipeline-e2e.mjs
 */
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CONTENT_STUDIO_HOME = await mkdtemp(join(tmpdir(), 'cs-e2e-'))

const { resolveTools, ffmpeg } = await import('../lib/ffmpeg.js')
const { createBatch, loadItem, loadBatch } = await import('../lib/batch-store.js')
const { scanMaterials } = await import('../lib/steps/scan.js')
const { runItem } = await import('../lib/pipeline.js')
const { writeWav } = await import('../lib/wav.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

const tools = await resolveTools()
check('ffmpeg 可用', tools.ok, tools.error)

/* ---------- 素材库 ---------- */
const lib = await mkdtemp(join(tmpdir(), 'cs-e2e-lib-'))
await mkdir(join(lib, '穿搭'), { recursive: true })
for (const [index, color] of ['olive', 'crimson', 'slategray'].entries()) {
  await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=360x640:d=3:r=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(lib, '穿搭', `m${index}.mp4`)])
}
const scanned = await scanMaterials({ dirs: [lib], tools })
check('素材库索引 3 条', scanned.index.entries.length === 3)

/* ---------- mock providers ---------- */
function toneWav(seconds, freq = 220, sampleRate = 24000) {
  const frames = Math.round(sampleRate * seconds)
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 9000), i * 2)
  return writeWav({ sampleRate, channels: 1, bitsPerSample: 16, data })
}

const llm = {
  async complete() {
    return {
      json: {
        title: '秋日通勤三件套',
        hook: '秋天最怕什么',
        narration: [
          { id: 's1', text: '秋天最怕的是什么？' },
          { id: 's2', text: '穿多了显胖，穿少了打哆嗦。' },
          { id: 's3', text: '这三件套刚刚好。' },
        ],
        description: '通勤穿搭分享',
        hashtags: ['#秋季穿搭', '#通勤穿搭'],
        coverText: { main: '三件套', sub: '通勤不显胖' },
        coverPrompt: 'autumn street fashion, soft light, no text',
        shotList: [
          { id: 'shot1', intent: '通勤街景', source: 'generate', durationSec: 4 },
          { id: 'shot2', intent: '服装细节', source: 'library', durationSec: 3 },
          { id: 'shot3', intent: '全身镜头', source: 'library', durationSec: 3 },
        ],
      },
    }
  },
}

const tts = {
  voice: 'mock',
  async synthesize({ text }) {
    const seconds = Math.max(0.4, Array.from(text).length * 0.16)
    return { audio: toneWav(seconds), contentType: 'audio/wav' }
  },
}

const videoDir = await mkdtemp(join(tmpdir(), 'cs-e2e-vid-'))
const video = {
  async submit() {
    return { taskId: 'mock-task-1' }
  },
  async poll() {
    return { state: 'succeeded', localPath: join(videoDir, 'generated.mp4'), seed: 42 }
  },
  intervalMs: 10,
  timeoutMs: 5000,
}
await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=goldenrod:s=360x640:d=4:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(videoDir, 'generated.mp4')])

/* ---------- 跑一条 ---------- */
const batch = await createBatch({
  title: 'E2E 批次',
  count: 1,
  config: { topic: '秋季通勤穿搭', style: '轻快口播', targetSec: 20, aspectRatio: '9:16', voice: 'mock', materialMode: 'folder', fps: 30 },
})

const result = await runItem({
  batchId: batch.id,
  itemId: batch.items[0].id,
  tools,
  materials: scanned.index.entries,
  providers: { llm, tts, video },
})

console.log('  status:', result.status, result.error || '')
check('单条跑到 review_pending', result.status === 'review_pending', result.error)

const { item } = await loadItem(batch.id, batch.items[0].id)
check('全部步骤 done', Object.values(item.steps).every((s) => s.status === 'done'), JSON.stringify(item.steps))

const read = async (rel) => JSON.parse(await readFile(join(item.dir, rel), 'utf8'))
const script = await read('01-script/script.json')
const duration = await read('02-voice/duration.json')
const subtitle = await read('03-subtitle/subtitle.json')
const manifest = await read('04-visual/manifest.json')
const plan = await read('05-edl/edit-plan.json')
const report = await read('08-validate/report.json')

check('script.json 落盘', script.title === '秋日通勤三件套')
check('duration.json 有总时长', duration.totalSec > 3, String(duration.totalSec))
check('字幕有 cue', subtitle.cues.length >= 3)
check('画面 3 个镜头', manifest.length === 3, String(manifest.length))
check('生成了 1 个、素材库 2 个', manifest.filter((m) => m.source === 'generate').length === 1 && manifest.filter((m) => m.source === 'library').length === 2)
check('EDL 覆盖配音时长', Math.abs(plan.durationSec - duration.totalSec) < 0.01)
check('EDL 镜头数一致', plan.segments.length === 3)

const master = await stat(join(item.dir, '06-render/master.mp4'))
check('成片存在', master.size > 20000, `${master.size} bytes`)
check('缩略图存在', (await stat(join(item.dir, '06-render/thumb.jpg'))).size > 500)
const covers = ['07-cover/cover-vertical.png', '07-cover/cover-horizontal.png', '07-cover/cover-square.png']
for (const cover of covers) check(`封面 ${cover} 存在`, (await stat(join(item.dir, cover))).size > 5000)

console.log('  report:', JSON.stringify(report.summary), report.status)
check('校验未失败', report.status !== 'failed', report.errors.map((e) => `${e.id}:${e.detail}`).join('；'))
check('校验覆盖三级', new Set(report.checks.map((c) => c.level)).size === 3)

const batchAfter = await loadBatch(batch.id)
check('批次摘要同步标题', batchAfter.items[0].title === '秋日通勤三件套')
check('批次摘要同步时长', batchAfter.items[0].durationSec > 3)

/* ---------- 用量核算 ---------- */
const usage = item.usage
check('记录了大模型调用次数', usage.llmCalls === 1, JSON.stringify(usage))
check('记录了配音字符数', usage.ttsCharacters > 10, String(usage.ttsCharacters))
check('记录了配音时长', usage.ttsSeconds > 3, String(usage.ttsSeconds))
check('记录了生成镜头数', usage.videoShots === 1, String(usage.videoShots))
check('素材库镜头不计费', usage.videoSeconds > 0 && usage.videoSeconds < 10, String(usage.videoSeconds))
check('无价目表时成本为 0 且标记未定价', item.cost.total === 0 && item.cost.priced === false, JSON.stringify(item.cost))
check('成本明细四行', item.cost.lines.length === 4)
check('批次摘要带用量', Boolean(batchAfter.items[0].usage?.ttsSeconds))

/* ---------- 幂等：再跑一次应跳过所有步骤 ---------- */
const again = await runItem({
  batchId: batch.id,
  itemId: batch.items[0].id,
  tools,
  materials: scanned.index.entries,
  providers: { llm: { async complete() { throw new Error('不应该再调用') } }, tts, video },
})
check('二次运行跳过全部步骤', again.status === 'review_pending')
check('正文模型未被再次调用', again.script.title === '秋日通勤三件套')

/* ---------- 失败路径 ---------- */
const batch2 = await createBatch({ title: '失败批次', count: 1, config: { topic: 'x', targetSec: 10 } })
const failed = await runItem({
  batchId: batch2.id,
  itemId: batch2.items[0].id,
  tools,
  materials: [],
  providers: { llm: { async complete() { return { json: { title: 't', narration: [{ id: 's', text: 'a' }], coverPrompt: 'p', shotList: [{ id: 'x', intent: 'i', source: 'generate', durationSec: 3 }] } } } }, tts, video: null },
})
check('缺视频模型时报错', failed.status === 'failed' && /视频模型/.test(failed.error || ''), failed.error)

const failedItem = (await loadItem(batch2.id, batch2.items[0].id)).item
check('失败步骤被标记', failedItem.steps.visual.status === 'failed')
check('错误写入条目', /视频模型/.test(failedItem.error || ''))
check('前序步骤保留 done', failedItem.steps.script.status === 'done' && failedItem.steps.voice.status === 'done')

await rm(lib, { recursive: true, force: true })
await rm(videoDir, { recursive: true, force: true })
await rm(process.env.CONTENT_STUDIO_HOME, { recursive: true, force: true })

console.log(`\nALL E2E CHECKS PASSED (${passed})`)
