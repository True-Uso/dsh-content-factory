/**
 * 本地视频模型 mock 服务 —— 用来验证 http-generic 适配器。
 *
 * 它模拟一个典型的自建生成服务：异步提交 → 轮询状态 → 返回视频地址。
 * 真正的 LTX 服务换成它自己的字段即可，适配器侧只改配置。
 *
 * 用法：node tools/mock-video-server.js [port]
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] || 9100)
const tasks = new Map()
let counter = 0

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
        resolve({ raw: text })
      }
    })
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`)

  if (url.pathname === '/health') {
    return json(res, 200, { ok: true, service: 'mock-video', queued: tasks.size })
  }

  if (url.pathname === '/generate' && req.method === 'POST') {
    const body = await readBody(req)
    const id = `mock-${++counter}`
    // 3 次轮询后完成：queued → running → running → succeeded
    tasks.set(id, { polls: 0, body })
    console.log(`[mock] submit ${id} prompt=${JSON.stringify(body.prompt)} frames=${body.num_frames}`)
    return json(res, 200, { task_id: id, status: 'pending' })
  }

  const match = /^\/tasks\/([^/]+)$/.exec(url.pathname)
  if (match) {
    const id = decodeURIComponent(match[1])
    const task = tasks.get(id)
    if (!task) return json(res, 404, { data: { status: 'error', message: 'task not found' } })
    task.polls += 1
    if (task.polls < 3) {
      return json(res, 200, { data: { status: task.polls === 1 ? 'queued' : 'running' } })
    }
    return json(res, 200, {
      data: {
        status: 'success',
        video_url: `http://127.0.0.1:${port}/files/${id}.mp4`,
      },
    })
  }

  if (url.pathname.startsWith('/files/')) {
    res.writeHead(200, { 'content-type': 'video/mp4' })
    res.end('fake-mp4-bytes')
    return
  }

  return json(res, 404, { error: 'not found' })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock video server listening on http://127.0.0.1:${port}`)
})
