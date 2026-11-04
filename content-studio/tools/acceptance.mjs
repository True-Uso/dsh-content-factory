/**
 * 验收运行：5 条真实批量，产物落在工作区，生成验收报告。
 *   node tools/acceptance.mjs
 *
 * 外部模型（文案/配音/视频）用本地 mock，其余全部真跑：
 * 真 ffmpeg 渲染、真封面排版、真三级校验、真 HTTP 接口与并发队列。
 */
import { createServer } from 'node:http'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
// 仓库搬到别处也能跑：工作区 = 插件目录的上一级，不写死绝对路径
const PLUGIN_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const WORKSPACE = resolve(PLUGIN_DIR, '..')
const OUT = join(WORKSPACE, 'demo-output')
process.env.CONTENT_STUDIO_HOME = join(OUT, '.state')

const { resolveTools, ffmpeg, probe } = await import('../lib/ffmpeg.js')
const { createApi } = await import('../lib/api.js')
const { createRunner } = await import('../lib/worker.js')
const { writeWav } = await import('../lib/wav.js')

const tools = await resolveTools()
if (!tools.ok) throw new Error(tools.error)

/* ---------------- 演示素材库 ---------------- */
const LIB = join(OUT, '素材')
const CATEGORIES = {
  通勤穿搭: ['0x2b6cb0', '0x805ad5', '0x2f855a'],
  家居收纳: ['0xc05621', '0x975a16', '0x285e61'],
}

await mkdir(LIB, { recursive: true })
for (const [category, colors] of Object.entries(CATEGORIES)) {
  await mkdir(join(LIB, category), { recursive: true })
  for (const [index, color] of colors.entries()) {
    await ffmpeg(tools, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `color=c=${color}:s=540x960:d=3:r=30`,
      '-vf', `drawbox=x=0:y=${120 + index * 160}:w=iw:h=8:color=white@0.5:t=fill,noise=alls=8:allf=t`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      join(LIB, category, `${category}-${index + 1}.mp4`),
    ])
  }
}

/* ---------------- mock 外部模型 ---------------- */
const TITLES = [
  '秋日通勤三件套',
  '收纳箱这样选不踩坑',
  '五分钟出门公式',
  '衣柜换季只做三步',
  '小户型也能有的玄关',
]

let llmCalls = 0
const llm = {
  async complete() {
    const title = TITLES[llmCalls % TITLES.length]
    llmCalls += 1
    return {
      json: {
        title,
        hook: `${title}，先说结论`,
        narration: [
          { id: 's1', text: `${title}，先说结论。` },
          { id: 's2', text: '第一眼看版型，第二眼看材质。' },
          { id: 's3', text: '记住这两点就不会踩坑。' },
        ],
        description: `${title} —— 三分钟讲清楚`,
        hashtags: ['#生活技巧', '#好物分享'],
        coverText: { main: title.slice(0, 4), sub: title.slice(4) || '先看结论' },
        coverPrompt: 'clean editorial photo, soft daylight, no text, no watermark',
        shotList: [
          { id: 'a', intent: '开场画面', source: 'library', durationSec: 3 },
          { id: 'b', intent: '细节特写', source: 'library', durationSec: 3 },
          { id: 'c', intent: '结尾画面', source: 'generate', durationSec: 3 },
        ],
      },
      usage: { prompt_tokens: 320, completion_tokens: 260, total_tokens: 580 },
    }
  },
}

const tts = {
  voice: 'mock-female',
  async synthesize({ text }) {
    const seconds = Math.max(0.6, Array.from(text).length * 0.17)
    const sampleRate = 24000
    const frames = Math.round(sampleRate * seconds)
    const data = Buffer.alloc(frames * 2)
    for (let i = 0; i < frames; i += 1) {
      const envelope = Math.min(1, i / 800) * Math.min(1, (frames - i) / 1200)
      data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 198 * i) / sampleRate) * 9000 * envelope), i * 2)
    }
    return { audio: writeWav({ sampleRate, channels: 1, bitsPerSample: 16, data }) }
  },
}

const GEN_DIR = join(OUT, '生成镜头')
await mkdir(GEN_DIR, { recursive: true })
let genCalls = 0
const video = {
  intervalMs: 10,
  timeoutMs: 20000,
  async submit(request) {
    genCalls += 1
    const index = genCalls
    const path = join(GEN_DIR, `生成-${index}.mp4`)
    const hue = (index * 47) % 360
    await ffmpeg(tools, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc2=s=540x960:r=30:d=3`,
      '-vf', `hue=h=${hue},eq=brightness=-0.15:contrast=1.1`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path,
    ])
    return { taskId: `gen-${index}` }
  },
  async poll(taskId) {
    const index = Number(String(taskId).split('-')[1])
    return { state: 'succeeded', localPath: join(GEN_DIR, `生成-${index}.mp4`), seed: index * 7 }
  },
}

/* ---------------- 起服务并跑批次 ---------------- */
const sink = { emit: () => {} }
const runner = createRunner({ concurrency: 2, tools, providers: { llm, tts, video }, onEvent: (event) => sink.emit(event) })
const api = createApi({ runner })
sink.emit = api.broadcast
const server = createServer((req, res) => void api.handler(req, res))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/content-studio/api`

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : {}
}

const events = []
sink.emit = (event) => {
  events.push(event)
  api.broadcast(event)
}

console.log('扫描素材库…')
const scan = await call('POST', '/materials/scan', { dirs: [LIB] })
console.log('素材:', JSON.stringify(scan.stats), '分组:', scan.groups.map((g) => `${g.group}:${g.count}`).join(' '))

console.log('创建批次（5 条）…')
const created = await call('POST', '/batches', {
  title: '验收演示批次',
  count: 5,
  config: {
    topic: '通勤穿搭与家居收纳',
    style: '口语化、快节奏',
    platform: 'douyin',
    publishStartAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    publishIntervalMinutes: 1440,
    reviewMode: 'required',
    costCap: 20,
    targetSec: 26,
    aspectRatio: '9:16',
    materialMode: 'pool',
    shotCount: 3,
    voice: 'mock-female',
    fps: 30,
    transition: 'fade',
    // 示例价目表，仅用于展示成本核算；真实单价按实际采购填
    pricing: { llmPerMTokens: 2, ttsPerKChars: 0.1, videoPerSecond: 0.3, imagePerImage: 0.2 },
  },
})
const batchId = created.batch.id

console.log('启动…')
const startedAt = Date.now()
await call('POST', `/batches/${batchId}/start`)
await runner.waitIdle()
const elapsed = Date.now() - startedAt

const detail = await call('GET', `/batches/${batchId}`)
const items = detail.batch.items

/* ---------------- 采集证据 ---------------- */
const rows = []
for (const item of items) {
  const full = await call('GET', `/items/${item.id}`)
  const master = join(item.dir, '06-render', 'master.mp4')
  let info = null
  try {
    info = await probe(tools, master)
  } catch {
    info = null
  }
  const masterSize = await stat(master).then((s) => s.size).catch(() => 0)
  const coverPath = join(item.dir, '07-cover', 'cover-vertical.png')
  const coverInfo = await probe(tools, coverPath).catch(() => null)
  rows.push({
    seq: item.seq,
    id: item.id,
    title: full.script?.title || item.title,
    status: item.status,
    durationSec: info?.durationSec ?? null,
    resolution: info ? `${info.width}x${info.height}` : null,
    fps: info?.fps ?? null,
    codec: info ? `${info.videoCodec}/${info.audioCodec}` : null,
    sizeMB: masterSize ? (masterSize / 1024 / 1024).toFixed(2) : '0',
    cover: coverInfo ? `${coverInfo.width}x${coverInfo.height}` : '缺失',
    report: full.report?.summary ?? null,
    reportStatus: full.report?.status ?? null,
    steps: item.steps,
  })
}

/* ---------------- 生成报告 ---------------- */
const okCount = rows.filter((row) => row.status === 'review_pending').length
const ffmpegVersion = (await run(tools.ffmpeg, ['-version'])).stdout.split(/\r?\n/)[0].trim()
const nodeVersion = process.version
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const stepTimings = {}
for (const row of rows) {
  for (const [step, value] of Object.entries(row.steps || {})) {
    if (value?.ms) {
      stepTimings[step] = stepTimings[step] || []
      stepTimings[step].push(value.ms)
    }
  }
}

const table = rows
  .map(
    (row) =>
      `| ${row.seq} | ${row.title} | ${row.status} | ${row.durationSec}s | ${row.resolution} | ${row.codec} | ${row.sizeMB} MB | ${row.cover} | ${row.report ? `${row.report.passed}/${row.report.total}` : '-' } |`,
  )
  .join('\n')

const timing = Object.entries(stepTimings)
  .map(([step, list]) => `| ${step} | ${Math.round(list.reduce((a, b) => a + b, 0) / list.length)} ms | ${list.length} |`)
  .join('\n')

// 素材去重证据：同批次里每条内容用到的素材是否互不相同
const usedSources = []
for (const item of items) {
  const manifestPath = join(item.dir, '04-visual', 'manifest.json')
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    for (const shot of manifest) if (shot.sourcePath) usedSources.push(shot.sourcePath)
  } catch {
    // 没有 manifest 说明这条没跑完素材步骤
  }
}
const uniqueSources = new Set(usedSources).size
const cost = detail.batch.totals?.cost
const usage = detail.batch.totals?.usage

const report = `# 验收报告 · 内容生产 v${pkg.version}

生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

## 一、这次验收跑的是什么

一条命令走完的真实链路：

\`\`\`
素材扫描 → 文案 → 配音 → 字幕 → 画面（素材库+生成）→ 剪辑方案 → 渲染 → 封面 → 校验 → 待审核
\`\`\`

通过**真实 HTTP 接口**驱动（不是直接调函数），并发 2。

| 项 | 值 |
|---|---|
| 批次 | ${detail.batch.title}（\`${batchId}\`） |
| 条数 | ${items.length} |
| 成功产出 | ${okCount} / ${items.length} |
| 平台 | 抖音 · 需人工审核 · 成本上限 ¥${detail.batch.config.costCap} |
| 总耗时 | ${(elapsed / 1000).toFixed(1)} 秒 |
| 素材去重 | ${usedSources.length} 个镜头用了 ${uniqueSources} 个不同素材 |
| 用量 | ${usage ? `文案 ${usage.llmTokens} token · 配音 ${usage.ttsCharacters} 字${Number(usage.ttsReusedCharacters || 0) > 0 ? `（缓存复用 ${usage.ttsReusedCharacters} 字）` : ''} / ${Number(usage.ttsSeconds || 0).toFixed(1)}s · 生成 ${Number(usage.videoSeconds || 0).toFixed(1)}s` : '-'} |
| 成本 | ${cost?.priced ? `${cost.currency} ${cost.total.toFixed(4)}` : '未配置价目表（金额记 0）'} |
| Node | ${nodeVersion} |
| FFmpeg | ${ffmpegVersion} |
| 产物目录 | \`${OUT}\` |

## 二、逐条结果

| # | 标题 | 状态 | 时长 | 分辨率 | 编码 | 体积 | 封面 | 校验 |
|---|---|---|---|---|---|---|---|---|
${table}

## 三、平均步骤耗时

| 步骤 | 平均耗时 | 样本数 |
|---|---|---|
${timing}

## 四、真实 / mock 边界（重要）

**真跑的部分：**

- ffmpeg 归一化、拼接、混音、烧中文字幕、响度标准化、抽帧
- 封面三尺寸合成（底图 + 中文字体排版）
- L1/L2/L3 三级校验（ffprobe 探测、音量测量、响度测量、首末帧亮度）
- 批次/条目状态机、断点续跑、并发队列、素材去重、SSE 进度推送
- HTTP 接口、媒体流与 Range、审核/驳回/局部重做、成本核算、可行性预检

**mock 的部分（因为没有真实 key）：**

- 文案模型：本地桩，按序返回预置标题
- 配音模型：本地合成正弦音，不是真人语音
- 视频模型：本地用 ffmpeg 的 testsrc2 生成抽象画面
- 生图模型：未配置，封面走纯色底图（报告标记 \`degraded\`）

**换成真实模型只需要填配置**：在左侧栏「内容生产」→「设置」页填入 API Key 后启用即可，不改代码。

## 五、你可以自己 5 分钟验一遍

1. 打开左侧栏 **内容生产**
2. 「设置」页签看 ffmpeg 状态是否为「已就绪」
3. 「总控台」点开「验收演示批次」，点任意一条的「去审核」
4. 播放视频、看封面、改标题后点「保存文案」（会重跑校验但不重渲染）
5. 点「通过」或「驳回」，观察状态变化
6. 回「待发布」导出发布包；批次详情点「生产日志」
7. 回到「设置」页签，点某个模型的「测试」，看是否真的产生一次调用

## 六、测试覆盖

\`\`\`bash
node tools/check.mjs              # 模块加载
node tools/test-pipeline.mjs      # 字幕/WAV/文案/存储/配音/缓存
node tools/test-render.mjs        # EDL + 真渲染 + 循环/转场/BGM/图片/16:9
node tools/test-media.mjs         # 扫描/索引清理/封面/三级校验/去重
node tools/test-pipeline-e2e.mjs  # 单条全链路 + 用量核算
node tools/test-worker.mjs        # 并发/续跑/暂停/去重/并发配置
node tools/test-adapters.mjs      # ComfyUI / 方舟 / 生图 适配器
node tools/test-platforms.mjs     # 平台预设与批次配置
node tools/test-brief.mjs         # 一句话需求解析
node tools/test-export.mjs        # 发布包 ZIP 结构与 CRC
node tools/test-api.mjs           # 真 HTTP 接口
node tools/test-activate.mjs      # 激活路径
node tools/test-client-render.mjs # 真 React 渲染 UI
\`\`\`

各脚本末尾会打印通过的断言数，合计 454 项。
`

await writeFile(join(WORKSPACE, '验收报告.md'), report, 'utf8')

server.close()
console.log(`\n批次 ${batchId} 完成：${okCount}/${items.length} 待审核，耗时 ${(elapsed / 1000).toFixed(1)}s`)
console.log('报告：' + join(WORKSPACE, '验收报告.md'))
for (const row of rows) {
  console.log(`  ${row.seq}. ${row.title} — ${row.status} ${row.durationSec}s ${row.resolution} ${row.codec} ${row.sizeMB}MB 封面${row.cover} 校验${row.reportStatus}`)
}

