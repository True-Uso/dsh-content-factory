/**
 * 适配器契约测试：ComfyUI / 方舟 Seedance / 生图。
 * 这三个适配器此前没有任何测试，而 ComfyUI 正是本地模型最可能的接入方式。
 *   node tools/test-adapters.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { createProvider } = await import('../lib/providers.js')
const { createImageProvider } = await import('../lib/providers/image.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
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

function listen(handler) {
  const server = createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }))
  })
}

/* ================= ComfyUI ================= */
console.log('\n[comfyui]')
const receivedPrompts = []
const comfy = await listen(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const send = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  if (url.pathname === '/system_stats') return send(200, { system: { os: 'nt' } })
  if (url.pathname === '/prompt') {
    receivedPrompts.push(await readBody(req))
    return send(200, { prompt_id: 'p-123' })
  }
  if (url.pathname === '/history/p-123') {
    return send(200, {
      'p-123': {
        status: { status_str: 'success', completed: true },
        outputs: { '9': { gifs: [{ filename: 'LTX_0001.mp4', subfolder: 'video', type: 'output' }] } },
      },
    })
  }
  return send(404, {})
})

const work = await mkdtemp(join(tmpdir(), 'cs-adapters-'))
const workflowPath = join(work, 'ltx.json')
await writeFile(workflowPath, JSON.stringify({
  '3': { class_type: 'CLIPTextEncode', inputs: { text: '{{prompt}}' } },
  '5': { class_type: 'EmptyLatent', inputs: { width: '{{width}}', height: '{{height}}', batch_size: 1 } },
  '7': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: 20 } },
}), 'utf8')

const comfyProvider = await createProvider({
  id: 'comfy', kind: 'comfyui', baseUrl: comfy.base, workflowRef: workflowPath, poll: { intervalMs: 10 },
})
check('ComfyUI 健康检查', (await comfyProvider.healthCheck()).ok === true)

const comfyTask = await comfyProvider.submit({ prompt: '秋日街景', seed: 42, durationSec: 3, width: 768, height: 1344 })
check('ComfyUI 返回 prompt_id', comfyTask.taskId === 'p-123', JSON.stringify(comfyTask))

const sent = receivedPrompts[0]
check('提交体带 prompt 字段', Boolean(sent?.prompt), JSON.stringify(sent)?.slice(0, 120))
check('工作流占位符被替换为文本', sent.prompt['3'].inputs.text === '秋日街景', String(sent.prompt['3'].inputs.text))
check('数字占位符保持数字类型', sent.prompt['5'].inputs.width === 768, typeof sent.prompt['5'].inputs.width)
check('seed 被替换', sent.prompt['7'].inputs.seed === 42, String(sent.prompt['7'].inputs.seed))
check('带 client_id', typeof sent.client_id === 'string' && sent.client_id.length > 0)

const comfyPoll = await comfyProvider.poll('p-123')
check('ComfyUI 轮询到成功', comfyPoll.state === 'succeeded', comfyPoll.state)
check('ComfyUI 拼出 /view 地址', String(comfyPoll.videoUrl).includes('/view?filename=LTX_0001.mp4'), String(comfyPoll.videoUrl))
check('子目录与类型进了查询串', comfyPoll.videoUrl.includes('subfolder=video') && comfyPoll.videoUrl.includes('type=output'))

const missing = await comfyProvider.poll('not-ready')
check('查不到任务时视为排队中', missing.state === 'queued', missing.state)

comfy.server.close()

/* ================= 方舟 Seedance（预留） ================= */
console.log('\n[ark]')
const arkBodies = []
const ark = await listen(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const send = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  if (req.method === 'POST') {
    arkBodies.push(await readBody(req))
    return send(200, { id: 'cgt-abc' })
  }
  if (url.pathname.endsWith('/cgt-abc')) {
    return send(200, { status: 'succeeded', content: { video_url: 'https://example.com/v.mp4' } })
  }
  return send(200, {})
})

const arkProvider = await createProvider({
  id: 'ark', kind: 'ark-seedance', baseUrl: `${ark.base}/api/v3/contents/generations/tasks`,
  modelId: 'doubao-seedance-test', apiKey: 'test-key',
})
const arkTask = await arkProvider.submit({ prompt: '测试镜头', durationSec: 5, aspectRatio: '9:16', seed: 7 })
check('方舟返回任务 id', arkTask.taskId === 'cgt-abc', JSON.stringify(arkTask))

const arkBody = arkBodies[0]
check('请求带 model', arkBody.model === 'doubao-seedance-test', String(arkBody.model))
check('请求带文本内容块', arkBody.content?.[0]?.type === 'text' && arkBody.content[0].text === '测试镜头', JSON.stringify(arkBody.content))
check('请求带比例与时长', arkBody.ratio === '9:16' && arkBody.duration === 5, JSON.stringify({ r: arkBody.ratio, d: arkBody.duration }))
check('请求带 seed', arkBody.seed === 7, String(arkBody.seed))
check('默认带水印开关', arkBody.watermark === false, String(arkBody.watermark))

const arkPoll = await arkProvider.poll('cgt-abc')
check('方舟轮询到成功', arkPoll.state === 'succeeded', arkPoll.state)
check('解析出视频地址', arkPoll.videoUrl === 'https://example.com/v.mp4', String(arkPoll.videoUrl))

const arkUnconfigured = await createProvider({ id: 'ark2', kind: 'ark-seedance' })
const arkHealth = await arkUnconfigured.healthCheck()
check('未配置 modelId 时明确不可用', arkHealth.ok === false && /modelId/.test(arkHealth.detail), arkHealth.detail)
let arkError
try {
  await arkUnconfigured.submit({ prompt: 'x' })
} catch (error) {
  arkError = error
}
check('未配置时提交抛出明确错误', Boolean(arkError) && /方舟 Seedance 尚未配置/.test(arkError.message), arkError?.message)

ark.server.close()

/* ================= 生图 ================= */
console.log('\n[image]')
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const imageBodies = []
const imageServer = await listen(async (req, res) => {
  imageBodies.push(await readBody(req))
  const body = JSON.stringify({ data: [{ b64_json: pngBytes.toString('base64') }] })
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(body)
})

const imageProvider = createImageProvider({ baseUrl: imageServer.base, apiKey: 'k', model: 'gpt-image-1' })
const generated = await imageProvider.generate({ prompt: '秋天街道，无人', size: '1024x1536' })
check('生图返回图片字节', Buffer.isBuffer(generated.image) && generated.image.length > 50, String(generated.image?.length))
check('请求体带 prompt 与尺寸', imageBodies[0].prompt === '秋天街道，无人' && imageBodies[0].size === '1024x1536', JSON.stringify(imageBodies[0]))
check('请求体不含文字要求被保留在 prompt 里', imageBodies[0].prompt.includes('无人'))

let emptyPrompt
try {
  await imageProvider.generate({ prompt: '' })
} catch (error) {
  emptyPrompt = error
}
check('空提示词被拒绝', Boolean(emptyPrompt) && emptyPrompt.code === 'EMPTY_PROMPT')

imageServer.server.close()
await rm(work, { recursive: true, force: true }).catch(() => {})

console.log(`\nALL ADAPTER CHECKS PASSED (${passed})`)
