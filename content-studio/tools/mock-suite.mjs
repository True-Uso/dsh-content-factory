/**
 * 一站式 mock 模型服务：让「真实宿主内」的端到端验证不需要任何外部 key。
 *   node tools/mock-suite.mjs [port]
 *
 * 提供：
 *   POST /v1/chat/completions   → OpenAI 兼容文案
 *   POST /v1/audio/speech       → 24k 单声道 WAV
 *   POST /video/generate        → 异步任务
 *   GET  /video/tasks/:id       → 任务状态
 *   GET  /video/file.mp4        → 生成好的视频
 *   GET  /health
 */
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const port = Number(process.argv[2] || 9300)
const WORK = join(process.env.TEMP || '.', 'cs-mock-suite')
await mkdir(WORK, { recursive: true })

const FFMPEG = process.env.CONTENT_STUDIO_FFMPEG
  || join(process.env.USERPROFILE || '', '.content-studio', 'bin', 'ffmpeg.exe')

const VIDEO = join(WORK, 'generated.mp4')
if (!existsSync(VIDEO)) {
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=540x960:r=30:d=4',
    '-vf', 'hue=h=210,eq=brightness=-0.12',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', VIDEO,
  ])
}

const TITLES = ['通勤三件套这样搭', '玄关收纳只做两件事', '换季衣柜断舍离']
let llmCount = 0
const tasks = new Map()
let taskCount = 0

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      try {
        resolve(text ? JSON.parse(text) : {})
      } catch {
        resolve({})
      }
    })
  })
}

function toneWav(seconds, sampleRate = 24000) {
  const frames = Math.round(sampleRate * seconds)
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i += 1) {
    const env = Math.min(1, i / 600) * Math.min(1, (frames - i) / 900)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 196 * i) / sampleRate) * 9500 * env), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)

  if (url.pathname === '/health') return json(res, 200, { ok: true })

  if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
    await readBody(req)
    const title = TITLES[llmCount % TITLES.length]
    llmCount += 1
    const script = {
      title,
      hook: `${title}，先说结论`,
      narration: [
        { id: 's1', text: `${title}，先说结论。` },
        { id: 's2', text: '第一眼看版型，第二眼看材质。' },
        { id: 's3', text: '记住这两点，基本不会踩坑。' },
      ],
      description: `${title} — 三分钟讲清楚`,
      hashtags: ['#生活技巧', '#好物分享'],
      coverText: { main: title.slice(0, 4), sub: title.slice(4) || '看结论' },
      coverPrompt: 'clean editorial photo, soft daylight, no text',
      shotList: [
        { id: 'a', intent: '开场画面', source: 'library', durationSec: 3 },
        { id: 'b', intent: '细节特写', source: 'library', durationSec: 3 },
        { id: 'c', intent: '收尾画面', source: 'generate', durationSec: 3 },
      ],
    }
    return json(res, 200, {
      id: `chat-${llmCount}`,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(script) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 300, total_tokens: 400 },
    })
  }

  if (url.pathname === '/v1/audio/speech' && req.method === 'POST') {
    const body = await readBody(req)
    const seconds = Math.max(0.6, Array.from(String(body.input || '')).length * 0.16)
    const wav = toneWav(seconds)
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length })
    return res.end(wav)
  }

  if (url.pathname === '/video/generate' && req.method === 'POST') {
    await readBody(req)
    taskCount += 1
    const id = `t${taskCount}`
    tasks.set(id, 0)
    return json(res, 200, { task_id: id, status: 'pending' })
  }

  const taskMatch = /^\/video\/tasks\/([^/]+)$/.exec(url.pathname)
  if (taskMatch) {
    const id = taskMatch[1]
    if (!tasks.has(id)) return json(res, 404, { data: { status: 'error', message: 'task not found' } })
    const polls = tasks.get(id) + 1
    tasks.set(id, polls)
    if (polls < 2) return json(res, 200, { data: { status: 'running' } })
    return json(res, 200, { data: { status: 'success', video_url: `http://127.0.0.1:${port}/video/file.mp4` } })
  }

  if (url.pathname === '/video/file.mp4') {
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(VIDEO)
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': bytes.length })
    return res.end(bytes)
  }

  return json(res, 404, { error: 'not found' })
}).listen(port, '127.0.0.1', () => console.log(`mock suite on http://127.0.0.1:${port}`))

void writeFile
