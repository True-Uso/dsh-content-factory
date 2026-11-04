/**
 * HTTP 接口校验：起一个真 http server，用 fetch 打真实请求。
 *   node tools/test-api.mjs
 */
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CONTENT_STUDIO_HOME = await mkdtemp(join(tmpdir(), 'cs-api-'))

const { resolveTools, ffmpeg } = await import('../lib/ffmpeg.js')
const { createApi } = await import('../lib/api.js')
const { createRunner } = await import('../lib/worker.js')
const { scanMaterials } = await import('../lib/steps/scan.js')
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
const lib = await mkdtemp(join(tmpdir(), 'cs-api-lib-'))
await mkdir(join(lib, '旅行'), { recursive: true })
for (const color of ['teal', 'tomato', 'slateblue']) {
  await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=360x640:d=2:r=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(lib, '旅行', `${color}.mp4`)])
}

function toneWav(seconds, sampleRate = 24000) {
  const frames = Math.round(sampleRate * seconds)
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i += 1) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 8000), i * 2)
  return writeWav({ sampleRate, channels: 1, bitsPerSample: 16, data })
}

const llm = {
  async complete() {
    return {
      json: {
        title: '接口测试',
        narration: [
          { id: 's1', text: '第一句旁白，用来把这一条内容的时长拉到平台允许的范围。' },
          { id: 's2', text: '第二句旁白，继续补充信息，保证成片不会太短。' },
        ],
        description: 'd',
        hashtags: ['#测试'],
        coverText: { main: '接口', sub: '测试' },
        coverPrompt: 'plain, no text',
        shotList: [
          { id: 'a', intent: '街景', source: 'library', durationSec: 2 },
          { id: 'b', intent: '细节', source: 'library', durationSec: 2 },
        ],
      },
    }
  },
}
const tts = { voice: 'mock', async synthesize({ text }) { return { audio: toneWav(Math.max(0.5, Array.from(text).length * 0.14)) } } }

/* ---------- 起服务 ---------- */
// 不传 materials：让 runner 在每条执行时读取刚扫描出来的索引
const sink = { emit: () => {} }
const runner = createRunner({ concurrency: 2, tools, providers: { llm, tts }, onEvent: (event) => sink.emit(event) })
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
  let json
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    json = { raw: text }
  }
  return { status: res.status, json, headers: res.headers }
}

/* ---------- meta / health ---------- */
const meta = await call('GET', '/meta')
check('meta 200', meta.status === 200)
check('meta 含 llm/tts/image 类型', ['llm', 'tts', 'image'].every((kind) => meta.json.kinds.includes(kind)))
check('meta 含步骤列表', meta.json.steps.length === 8)
check('meta 含平台预设', meta.json.platforms?.length === 3 && meta.json.platforms.some((p) => p.id === 'douyin'), JSON.stringify(meta.json.platforms))
check('meta 含审核模式', meta.json.reviewModes?.some((m) => m.id === 'auto'))

const health = await call('GET', '/health')
check('health 报告 ffmpeg 可用', health.json.ffmpeg.ok === true)
check('health 报告滤镜齐备', health.json.capabilities.ok === true, JSON.stringify(health.json.capabilities))

/* ---------- 素材 ---------- */
const scan = await call('POST', '/materials/scan', { dirs: [lib] })
check('扫描 3 个素材', scan.json.total === 3, JSON.stringify(scan.json.stats))
check('分组返回', scan.json.groups[0].group === '旅行')

const groups = await call('GET', '/materials/groups')
check('分组查询', groups.json.total === 3)

const badScan = await call('POST', '/materials/scan', { dirs: [] })
check('空目录被拒绝', badScan.status === 400)

/* ---------- 建批次 ---------- */
const created = await call('POST', '/batches', {
  title: '接口批次',
  count: 2,
  config: { topic: '旅行', targetSec: 12, materialMode: 'folder', group: '旅行', fps: 30, voice: 'mock' },
})
check('建批次 200', created.status === 200, JSON.stringify(created.json).slice(0, 200))
const batchId = created.json.batch.id
check('批次 2 条', created.json.batch.items.length === 2)
check('批次写入平台', created.json.batch.config.platform === 'douyin', JSON.stringify(created.json.batch.config))
check('默认审核模式 required', created.json.batch.config.reviewMode === 'required')
check('默认发布间隔 1440', created.json.batch.config.publishIntervalMinutes === 1440)

const noTitle = await call('POST', '/batches', { count: 1 })
check('缺主题被拒绝', noTitle.status === 400)

/* ---------- 建批次前的可行性提示 ---------- */
check('创建批次带回可行性检查', Array.isArray(created.json.preflight?.warnings), JSON.stringify(created.json.preflight))
const bigBatch = await call('POST', '/batches', { title: '大批次', count: 60, config: { topic: '旅行' } })
check('大批次给出耗时提醒', bigBatch.json.preflight.warnings.some((w) => /小时/.test(w)), JSON.stringify(bigBatch.json.preflight.warnings))
check('大量条目给出估算', bigBatch.json.preflight.estimate.items === 60, JSON.stringify(bigBatch.json.preflight.estimate))
await call('DELETE', `/batches/${bigBatch.json.batch.id}?purge=1`)

const fewShot = await call('POST', '/batches', { title: '素材不足', count: 2, config: { topic: '旅行', shotCount: 8, materialMode: 'folder', group: '不存在的分类' } })
check('分类无素材时给出回退提示', fewShot.json.preflight.warnings.some((w) => /没有素材/.test(w)), JSON.stringify(fewShot.json.preflight.warnings))
await call('DELETE', `/batches/${fewShot.json.batch.id}?purge=1`)

/* ---------- 启动 ---------- */
const started = await call('POST', `/batches/${batchId}/start`)
check('启动入队 2 条', started.json.enqueued === 2, JSON.stringify(started.json))
await runner.waitIdle()

const detail = await call('GET', `/batches/${batchId}`)
check('批次详情 200', detail.status === 200)
check('两条待审', detail.json.batch.items.every((item) => item.status === 'review_pending'), JSON.stringify(detail.json.batch.items.map((i) => i.status)))
check('详情带步骤状态', detail.json.batch.items[0].steps.render.status === 'done')
check('详情带校验报告', Boolean(detail.json.batch.items[0].report?.status))
check('批次状态 review', detail.json.batch.status === 'review', detail.json.batch.status)

const itemId = detail.json.batch.items[0].id

/* ---------- 条目详情与媒体 ---------- */
const item = await call('GET', `/items/${itemId}`)
check('条目详情 200', item.status === 200)
check('条目带 script', item.json.script.title === '接口测试')
check('条目带媒体索引', item.json.media.master > 10000, String(item.json.media.master))

const video = await fetch(`${base}/media/${batchId}/${itemId}/06-render/master.mp4`)
check('成片可播放（200）', video.status === 200, String(video.status))
check('成片 content-type 正确', video.headers.get('content-type') === 'video/mp4')
const bytes = (await video.arrayBuffer()).byteLength
check('成片有字节', bytes > 10000, String(bytes))

const range = await fetch(`${base}/media/${batchId}/${itemId}/06-render/master.mp4`, { headers: { range: 'bytes=0-1023' } })
check('Range 请求 206', range.status === 206, String(range.status))
check('Range 长度 1024', (await range.arrayBuffer()).byteLength === 1024)

const cover = await fetch(`${base}/media/${batchId}/${itemId}/07-cover/cover-vertical.png`)
check('封面可访问', cover.status === 200 && cover.headers.get('content-type') === 'image/png')

/* ---------- 发布包与生产日志 ---------- */
const itemZip = await fetch(`${base}/items/${itemId}/export`)
const itemZipBytes = Buffer.from(await itemZip.arrayBuffer())
check('条目导出 200', itemZip.status === 200, String(itemZip.status))
check('条目导出是 zip', itemZip.headers.get('content-type') === 'application/zip' && itemZipBytes.readUInt32LE(0) === 0x04034b50)
check('条目导出包含成片', itemZipBytes.includes(Buffer.from('master.mp4')))

const batchZip = await fetch(`${base}/batches/${batchId}/export`)
const batchZipBytes = Buffer.from(await batchZip.arrayBuffer())
check('整批导出 200', batchZip.status === 200, String(batchZip.status))
check('整批导出带条目目录', batchZipBytes.includes(Buffer.from('item-001/master.mp4')))

const batchLog = await call('GET', `/batches/${batchId}/log`)
check('批次日志 200', batchLog.status === 200)
check('批次日志含创建记录', String(batchLog.json.batch).includes('创建批次'))
check('批次日志含条目日志', batchLog.json.items.length === 2 && String(batchLog.json.items[0].log).includes('完成'))
const itemLog = await call('GET', `/items/${itemId}/log`)
check('条目日志 200', itemLog.status === 200 && String(itemLog.json.log).includes('完成'))

/* ---------- 批次配置更新 ---------- */
const configUpdate = await call('POST', `/batches/${batchId}/config`, { costCap: 5 })
check('更新成本上限 200', configUpdate.status === 200 && configUpdate.json.batch.config.costCap === 5, JSON.stringify(configUpdate.json))

const traversal = await call('GET', `/media/${batchId}/${itemId}/..%2F..%2Fbatch.json`)
check('路径穿越被拒绝', traversal.status === 403 || traversal.status === 404, String(traversal.status))

/* ---------- 审核 ---------- */
const approved = await call('POST', `/items/${itemId}/approve`, { note: '可以' })
check('通过 200', approved.status === 200 && approved.json.status === 'approved')
const afterApprove = await call('GET', `/items/${itemId}`)
check('审核记录落盘', afterApprove.json.review.decision === 'approved')

const secondId = detail.json.batch.items[1].id
const noReason = await call('POST', `/items/${secondId}/reject`, {})
check('驳回缺原因被拒', noReason.status === 400)
const rejected = await call('POST', `/items/${secondId}/reject`, { reason: '封面问题', note: '字太小' })
check('驳回 200', rejected.status === 200 && rejected.json.status === 'rejected')
const afterReject = await call('GET', `/items/${secondId}`)
check('驳回原因落盘', afterReject.json.review.reason === '封面问题')

/* ---------- 局部重做 ---------- */
const rerun = await call('POST', `/items/${secondId}/rerun`, { from: 'cover' })
check('重做入队', rerun.status === 200 && rerun.json.enqueued === true, JSON.stringify(rerun.json))
await runner.waitIdle()
const afterRerun = await call('GET', `/items/${secondId}`)
check('重做后回到待审', afterRerun.json.item.status === 'review_pending', afterRerun.json.item.status)
check('重做只重跑了 cover/validate', afterRerun.json.item.steps.cover.status === 'done' && afterRerun.json.item.steps.render.status === 'done')
check('未重跑文案', afterRerun.json.item.steps.script.attempts === 1, String(afterRerun.json.item.steps.script.attempts))

const badRerun = await call('POST', `/items/${secondId}/rerun`, { from: 'nope' })
check('未知步骤被拒', badRerun.status === 400)

const rerunApproved = await call('POST', `/items/${itemId}/rerun`, { from: 'cover' })
check('已通过条目不能重做', rerunApproved.status === 409, String(rerunApproved.status))
const editApproved = await call('POST', `/items/${itemId}/script`, { title: '不该生效' })
check('已通过条目不能改文案', editApproved.status === 409, String(editApproved.status))
const retryApproved = await call('POST', `/items/${itemId}/retry`)
check('已通过条目不能重新入队', retryApproved.status === 409, String(retryApproved.status))
const approveApproved = await call('POST', `/items/${itemId}/approve`, {})
check('已通过条目不能重复通过', approveApproved.status === 409, String(approveApproved.status))
const rejectApproved = await call('POST', `/items/${itemId}/reject`, { reason: '其他' })
check('已通过条目不能驳回', rejectApproved.status === 409, String(rejectApproved.status))

/* ---------- 文案编辑：只重跑校验 ---------- */
const edited = await call('POST', `/items/${secondId}/script`, {
  title: '改过的标题',
  hashtags: ['#a', '#b'],
  description: '改过的简介',
})
check('文案编辑 200', edited.status === 200 && edited.json.changed.includes('title'), JSON.stringify(edited.json))
await runner.waitIdle()
const afterEdit = await call('GET', `/items/${secondId}`)
check('标题已更新', afterEdit.json.script.title === '改过的标题', afterEdit.json.script.title)
check('标签已更新', afterEdit.json.script.hashtags.join() === '#a,#b')
check('校验重跑', afterEdit.json.report.generatedAt > afterRerun.json.report.generatedAt, `${afterRerun.json.report.generatedAt} → ${afterEdit.json.report.generatedAt}`)
check('渲染未重跑', afterEdit.json.item.steps.render.attempts === 1, String(afterEdit.json.item.steps.render.attempts))
check('编辑后回到待审', afterEdit.json.item.status === 'review_pending', afterEdit.json.item.status)

const badEdit = await call('POST', `/items/${secondId}/script`, { narration: [] })
check('不可编辑字段被拒绝', badEdit.status === 400)

/* ---------- 撤回通过 ---------- */
const unapprove = await call('POST', `/items/${itemId}/unapprove`)
check('撤回通过 200', unapprove.status === 200 && unapprove.json.status === 'review_pending')
const unapproveAgain = await call('POST', `/items/${itemId}/unapprove`)
check('未通过状态不能撤回', unapproveAgain.status === 409, String(unapproveAgain.status))
const afterWithdraw = await call('GET', `/items/${itemId}`)
check('撤回记录落盘', afterWithdraw.json.review.decision === 'withdrawn')

/* ---------- 暂停 / 取消 ---------- */
const created2 = await call('POST', '/batches', {
  title: '暂停批次', count: 2,
  config: { topic: '旅行', targetSec: 10, materialMode: 'pool', fps: 30, voice: 'mock' },
})
const batch2 = created2.json.batch.id
await call('POST', `/batches/${batch2}/start`)
const paused = await call('POST', `/batches/${batch2}/pause`)
check('暂停 200', paused.status === 200)
const cancelled = await call('POST', `/batches/${batch2}/cancel`)
check('取消 200', cancelled.status === 200)
await new Promise((resolve) => setTimeout(resolve, 300))
const afterCancel = await call('GET', `/batches/${batch2}`)
check('取消后批次状态', ['cancelled', 'partial', 'review'].includes(afterCancel.json.batch.status), afterCancel.json.batch.status)

const notFound = await call('GET', '/batches/不存在的批次')
check('未知批次 404', notFound.status === 404)

/* ---------- 密钥不回传 ---------- */
const { readFile: readFileAsync } = await import('node:fs/promises')
await call('PUT', '/providers/secret-test', {
  id: 'secret-test', kind: 'llm', enabled: false, baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'sk-real-key',
})
const listed = await call('GET', '/providers')
const secretEntry = listed.json.providers.find((p) => p.id === 'secret-test')
check('列表不回传明文密钥', secretEntry.apiKey !== 'sk-real-key', JSON.stringify(secretEntry.apiKey))
check('列表标记已存密钥', secretEntry.hasApiKey === true)

await call('PUT', '/providers/secret-test', secretEntry)
const raw1 = JSON.parse(await readFileAsync(join(process.env.CONTENT_STUDIO_HOME, 'providers.json'), 'utf8'))
const stored1 = raw1.providers.find((p) => p.id === 'secret-test')
check('掩码回写保留原密钥', stored1.apiKey === 'sk-real-key', JSON.stringify(stored1.apiKey))

await call('PUT', '/providers/secret-test', { ...secretEntry, apiKey: '' })
const raw2 = JSON.parse(await readFileAsync(join(process.env.CONTENT_STUDIO_HOME, 'providers.json'), 'utf8'))
const stored2 = raw2.providers.find((p) => p.id === 'secret-test')
check('空字符串清除密钥', stored2.apiKey === undefined, JSON.stringify(stored2.apiKey))
await call('DELETE', '/providers/secret-test')

/* ---------- provider 测试：llm / tts / image 三个分支 ---------- */
const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const modelMock = createServer((req, res) => {
  const send = (code, payload, type = 'application/json') => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
    res.writeHead(code, { 'content-type': type })
    res.end(body)
  }
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/v1/chat/completions') {
      return send(200, { choices: [{ message: { role: 'assistant', content: 'OK' } }], usage: { total_tokens: 3 } })
    }
    if (url.pathname === '/v1/audio/speech') {
      const wav = Buffer.alloc(44 + 4800)
      wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(36 + 4800, 4); wav.write('WAVE', 8, 'ascii')
      wav.write('fmt ', 12, 'ascii'); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
      wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
      wav.write('data', 36, 'ascii'); wav.writeUInt32LE(4800, 40)
      return send(200, wav, 'audio/wav')
    }
    if (url.pathname === '/v1/images/generations') {
      return send(200, { data: [{ b64_json: pngBase64 }] })
    }
    return send(404, { error: 'nope' })
  })
})
await new Promise((resolve) => modelMock.listen(0, '127.0.0.1', resolve))
const modelBase = `http://127.0.0.1:${modelMock.address().port}`

await call('PUT', '/providers/t-llm', { id: 't-llm', kind: 'llm', enabled: true, baseUrl: `${modelBase}/v1`, model: 'm', apiKey: 'k' })
await call('PUT', '/providers/t-tts', { id: 't-tts', kind: 'tts', enabled: true, baseUrl: `${modelBase}/v1`, model: 'qwen-tts', voice: 'v', apiKey: 'k' })
await call('PUT', '/providers/t-image', { id: 't-image', kind: 'image', enabled: true, baseUrl: `${modelBase}/v1`, model: 'gpt-image-1', apiKey: 'k' })

const llmTest = await call('POST', '/providers/t-llm/test', {})
check('文案模型测试通过', llmTest.json.job.status === 'succeeded' && llmTest.json.job.detail === 'OK', JSON.stringify(llmTest.json.job))
const ttsTest = await call('POST', '/providers/t-tts/test', {})
check('配音模型测试返回音频大小', ttsTest.json.job.status === 'succeeded' && /字节音频/.test(ttsTest.json.job.detail), JSON.stringify(ttsTest.json.job))
const imageTest = await call('POST', '/providers/t-image/test', {})
check('生图模型测试返回图片大小', imageTest.json.job.status === 'succeeded' && /字节图片/.test(imageTest.json.job.detail), JSON.stringify(imageTest.json.job))

for (const id of ['t-llm', 't-tts', 't-image']) await call('DELETE', `/providers/${id}`)
modelMock.close()

/* ---------- 缩略图也能取 ---------- */
const thumbRes = await fetch(`${base}/media/${batchId}/${itemId}/06-render/thumb.jpg`)
check('缩略图可访问', thumbRes.status === 200 && thumbRes.headers.get('content-type') === 'image/jpeg', String(thumbRes.status))
await thumbRes.arrayBuffer()

/* ---------- provider 测试：视频适配器真跑一次生成 ---------- */
const videoMock = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const send = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  if (url.pathname === '/health') return send(200, { ok: true })
  if (url.pathname === '/generate') {
    req.resume()
    req.on('end', () => send(200, { task_id: 'vt-1', status: 'pending' }))
    return
  }
  if (url.pathname === '/tasks/vt-1') return send(200, { data: { status: 'success', video_url: 'http://127.0.0.1:1/mock.mp4' } })
  return send(404, { error: 'nope' })
})
await new Promise((resolve) => videoMock.listen(0, '127.0.0.1', resolve))
const videoBase = `http://127.0.0.1:${videoMock.address().port}`

const videoProvider = {
  id: 'test-video',
  kind: 'http-generic',
  enabled: true,
  baseUrl: videoBase,
  poll: { intervalMs: 50, timeoutMs: 10000 },
  protocol: {
    health: { method: 'GET', path: '/health' },
    submit: { method: 'POST', path: '/generate', body: { prompt: '${prompt}', duration: '${durationSec}' } },
    poll: { method: 'GET', path: '/tasks/${taskId}' },
    extract: { taskId: '$.task_id', state: '$.data.status', videoUrl: '$.data.video_url' },
    stateMap: { queued: ['pending'], running: ['running'], succeeded: ['success'], failed: ['error'] },
  },
}
await call('PUT', '/providers/test-video', videoProvider)
const videoTest = await call('POST', '/providers/test-video/test', { durationSec: 2 })
check('视频测试真跑生成并返回地址', videoTest.json.job.status === 'succeeded' && String(videoTest.json.job.detail).includes('.mp4'), JSON.stringify(videoTest.json.job))

await call('PUT', '/providers/test-video', { ...videoProvider, enabled: false })
const disabledTest = await call('POST', '/providers/test-video/test', {})
check('停用的 provider 不能测试', disabledTest.status === 409, String(disabledTest.status))
videoMock.close()

/* ---------- 自动放行批次 ---------- */
const autoCreated = await call('POST', '/batches', {
  title: '自动放行批次', count: 1,
  config: { topic: '旅行', targetSec: 12, materialMode: 'pool', fps: 30, voice: 'mock', reviewMode: 'auto' },
})
const autoBatchId = autoCreated.json.batch.id
check('自动放行配置写入', autoCreated.json.batch.config.reviewMode === 'auto')
await call('POST', `/batches/${autoBatchId}/start`)
await runner.waitIdle()
const autoDetail = await call('GET', `/batches/${autoBatchId}`)
check('自动放行条目直接通过', autoDetail.json.batch.items[0].status === 'approved', autoDetail.json.batch.items[0].status)
check('自动放行批次完成', autoDetail.json.batch.status === 'done', autoDetail.json.batch.status)
check('自动放行记录放行方式', autoDetail.json.batch.items[0].review?.mode === 'auto', JSON.stringify(autoDetail.json.batch.items[0].review))
await call('DELETE', `/batches/${autoBatchId}?purge=1`)

/* ---------- SSE：真的能收到进度事件 ---------- */
const sseBatch = await call('POST', '/batches', {
  title: 'SSE 批次', count: 1,
  config: { topic: '旅行', targetSec: 10, materialMode: 'pool', fps: 30, voice: 'mock' },
})
const sseRes = await fetch(`${base}/events`)
check('SSE 连接建立', sseRes.status === 200 && String(sseRes.headers.get('content-type')).includes('text/event-stream'))
const reader = sseRes.body.getReader()
const first = await reader.read()
check('SSE 首帧是 hello', Buffer.from(first.value).toString('utf8').includes('hello'))

// 触发一次运行，应当能收到 item 事件
void call('POST', `/batches/${sseBatch.json.batch.id}/start`)
let collected = ''
let sawItemEvent = false
const deadline = Date.now() + 30000
while (Date.now() < deadline && !sawItemEvent) {
  const chunk = await Promise.race([
    reader.read(),
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 5000)),
  ])
  if (chunk.timeout) break
  if (chunk.done) break
  collected += Buffer.from(chunk.value).toString('utf8')
  if (collected.includes('item:start') || collected.includes('item:progress')) sawItemEvent = true
}
check('SSE 收到运行事件', sawItemEvent, collected.slice(0, 300))
await reader.cancel().catch(() => {})
await runner.waitIdle()

server.close()
await rm(lib, { recursive: true, force: true }).catch(() => {})
await rm(process.env.CONTENT_STUDIO_HOME, { recursive: true, force: true }).catch(() => {})

console.log(`\nALL API CHECKS PASSED (${passed})`)
