/**
 * 生成墙：拼接镜头 + 万相 mock 出片 + 成片入库。
 *   node tools/test-studio.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CONTENT_STUDIO_HOME = await mkdtemp(join(tmpdir(), 'cs-studio-'))

const { resolveTools, ffmpeg, concatVideos, lastFrameDataUrl, probe } = await import('../lib/ffmpeg.js')
const { createApi } = await import('../lib/api.js')
const { createRunner } = await import('../lib/worker.js')
const { wanSize } = await import('../lib/providers/wan.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

const tools = await resolveTools()
check('ffmpeg 可用', tools.ok, tools.error)
check('9:16 480P 尺寸', wanSize('9:16', '480P') === '480*832')
check('未知画幅回落到 9:16', wanSize('4:3', '1080P') === '1080*1920')

const work = await mkdtemp(join(tmpdir(), 'cs-studio-clips-'))
const a = join(work, 'a.mp4')
const b = join(work, 'b.mp4')
const out = join(work, 'out.mp4')
await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=teal:s=360x640:d=2:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', a])
await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=tomato:s=360x640:d=2:r=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', b])
await concatVideos(tools, [a, b], out, { width: 360, height: 640 })
const info = await probe(tools, out)
check('拼接后约 4 秒', info.durationSec >= 3.5 && info.durationSec <= 4.5, String(info.durationSec))
check('拼接后分辨率保持', info.width === 360 && info.height === 640, `${info.width}x${info.height}`)
{
  const frame = await lastFrameDataUrl(tools, a)
  check('能抽最后一帧', frame.startsWith('data:image/jpeg;base64,') && frame.length > 80, frame.slice(0, 40))
}

const mp4 = await readFile(out)
const mockHost = { base: '' }
let wanPosts = 0
const mock = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/clip.mp4') {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': mp4.length })
    res.end(mp4)
    return
  }
  const send = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  if (url.pathname === '/compatible-mode/v1/models') return send(200, { data: [] })
  if (req.method === 'POST' && url.pathname.includes('video-synthesis')) {
    wanPosts += 1
    req.resume()
    req.on('end', () => send(200, { output: { task_id: 't1', task_status: 'PENDING' } }))
    return
  }
  if (url.pathname.endsWith('/t1')) {
    return send(200, { output: { task_id: 't1', task_status: 'SUCCEEDED', video_url: `${mockHost.base}/clip.mp4` } })
  }
  return send(404, {})
})
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve))
mockHost.base = `http://127.0.0.1:${mock.address().port}`

const runner = createRunner({ concurrency: 1, tools, providers: {} })
const api = createApi({ runner })
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

await call('PUT', '/providers/wan', {
  id: 'wan', kind: 'dashscope-wan', enabled: true, origin: mockHost.base, apiKey: 'k', poll: { intervalMs: 30, timeoutMs: 8000 },
})

const missing = await call('POST', '/clips', { prompt: '' })
check('空提示词拒绝', missing.status === 400)

const created = await call('POST', '/clips', { prompt: '秋日街景', aspectRatio: '9:16', resolution: '480P' })
check('提交镜头 200', created.status === 200, JSON.stringify(created.json))
const clipId = created.json.clip.id
check('镜头先标记 running', created.json.clip.status === 'running')

let clip
for (let i = 0; i < 40; i += 1) {
  const listed = await call('GET', '/clips')
  clip = (listed.json.clips || []).find((item) => item.id === clipId)
  if (clip && clip.status !== 'running') break
  await new Promise((resolve) => setTimeout(resolve, 100))
}
check('镜头生成成功', clip?.status === 'succeeded', JSON.stringify(clip))
check('镜头可播地址', String(clip.url).includes(`/clips/${clipId}/file`))

const file = await fetch(base + `/clips/${clipId}/file`)
check('镜头文件 200', file.status === 200 && file.headers.get('content-type') === 'video/mp4', String(file.status))
check('镜头文件非空', (await file.arrayBuffer()).byteLength > 100)

const film = await call('POST', '/films', { clipIds: [clipId], targetSec: 15, prompt: '秋日成片' })
check('成片 200', film.status === 200, JSON.stringify(film.json).slice(0, 240))
check('成片未自动开跑（无文案配音）', film.json.started === false)
check('成片有批次', Boolean(film.json.batch?.id))
const itemDir = film.json.batch.items[0].dir
check('画面步骤已完成', (await readFile(join(itemDir, 'item.json'), 'utf8')).includes('"visual"') && JSON.parse(await readFile(join(itemDir, 'item.json'), 'utf8')).steps.visual.status === 'done')
check('成片 master 在', (await stat(join(itemDir, '06-render', 'master.mp4'))).size > 100)

const none = await call('POST', '/films', { clipIds: ['nope'] })
check('空勾选拒绝', none.status === 400)

const postsAfterOne = wanPosts
const longCreated = await call('POST', '/clips', { prompt: '长镜头', durationSec: 60 })
check('60秒提交 200', longCreated.status === 200)
let longClip
for (let i = 0; i < 80; i += 1) {
  const listed = await call('GET', '/clips')
  longClip = (listed.json.clips || []).find((item) => item.id === longCreated.json.clip.id)
  if (longClip && longClip.status !== 'running') break
  await new Promise((resolve) => setTimeout(resolve, 100))
}
check('60秒生成成功', longClip?.status === 'succeeded', JSON.stringify(longClip))
check('超过30秒会分段', wanPosts >= postsAfterOne + 2, String(wanPosts))
await call('DELETE', `/clips/${longCreated.json.clip.id}`)

const missingClip = await call('DELETE', '/clips/nope')
check('删除不存在 404', missingClip.status === 404)

const removed = await call('DELETE', `/clips/${clipId}`)
check('删除镜头 200', removed.status === 200)
const afterDelete = await call('GET', '/clips')
check('删除后列表没有它', !(afterDelete.json.clips || []).some((item) => item.id === clipId))

server.close()
mock.close()
await rm(work, { recursive: true, force: true }).catch(() => {})
console.log(`\nALL STUDIO CHECKS PASSED (${passed})`)
