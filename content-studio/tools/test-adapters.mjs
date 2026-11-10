/**
 * 适配器契约测试：ComfyUI / 方舟 Seedance / 生图。
 * 这三个适配器此前没有任何测试，而 ComfyUI 正是本地模型最可能的接入方式。
 *   node tools/test-adapters.mjs
 */
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { createProvider, listUpstreamModels, resolveRoleProviders } = await import('../lib/providers.js')
const { createImageProvider } = await import('../lib/providers/image.js')
const { createSpeechProvider } = await import('../lib/providers/tts.js')

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
  if (url.pathname === '/models/checkpoints') return send(200, ['ltx-video.safetensors'])
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
const comfyHealthOnly = await createProvider({ id: 'comfy-h', kind: 'comfyui', baseUrl: comfy.base })
check('无工作流也能健康检查', (await comfyHealthOnly.healthCheck()).ok === true)

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
check('ComfyUI 列出上游模型', (await listUpstreamModels({ kind: 'comfyui', baseUrl: comfy.base })).includes('ltx-video.safetensors'))

comfy.server.close()
{
  const dead = await createProvider({ id: 'dead-comfy', kind: 'comfyui', baseUrl: 'http://127.0.0.1:1' })
  const deadHealth = await dead.healthCheck()
  check('ComfyUI 连不上时带原因', /连不上|ECONNREFUSED/.test(deadHealth.detail || ''), deadHealth.detail)
}

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

/* ================= 百炼万相 ================= */
console.log('\n[wan]')
const wanBodies = []
const wanPollHeaders = []
const wan = await listen(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  const send = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(payload))
  }
  if (url.pathname === '/compatible-mode/v1/models') return send(200, { data: [{ id: 'wan2.2-t2v-plus' }] })
  if (url.pathname === '/api/v1/models') {
    return send(200, {
      success: true,
      output: {
        total: 2, page_no: 1, page_size: 100,
        models: [
          { model: 'qwen-plus', name: 'Qwen' },
          { model: 'wan2.7-image-pro', name: 'Wan Image' },
          { model: 'wan2.7-videoedit', name: 'Wan Edit' },
          { model: 'wan2.6-t2v', name: 'Wan-T2V' },
          { model: 'wan2.2-t2v-plus', name: 'Wan 2.2 T2V' },
        ],
      },
    })
  }
  if (url.pathname === '/api/v1/services/aigc/video-generation/video-synthesis') {
    wanBodies.push(await readBody(req))
    return send(200, { output: { task_id: 'wan-1', task_status: 'PENDING' } })
  }
  if (url.pathname === '/api/v1/tasks/wan-1') {
    wanPollHeaders.push(req.headers['x-dashscope-async'] || '')
    return send(200, { output: { task_id: 'wan-1', task_status: 'SUCCEEDED', video_url: 'https://example.com/wan.mp4' } })
  }
  return send(404, {})
})

const wanProvider = await createProvider({
  id: 'wan', kind: 'dashscope-wan', origin: wan.base, apiKey: 'sk-test', poll: { intervalMs: 20 },
})
check('万相健康检查', (await wanProvider.healthCheck()).ok === true)
{
  const listed = await listUpstreamModels({ kind: 'dashscope-wan', origin: wan.base, apiKey: 'sk-test' })
  check('万相列出上游模型', listed.includes('wan2.2-t2v-plus'))
  check('万相目录含视频模型', listed.includes('wan2.6-t2v'))
  check('万相不列对话/图片/剪辑', !listed.includes('qwen-plus') && !listed.includes('wan2.7-image-pro') && !listed.includes('wan2.7-videoedit'), listed.join(','))
}
check('万相地址可填兼容路径', (await listUpstreamModels({
  kind: 'dashscope-wan', origin: `${wan.base}/compatible-mode/v1`, apiKey: 'sk-test',
})).includes('wan2.6-t2v'))
const wanTask = await wanProvider.submit({ prompt: '秋日街景', aspectRatio: '9:16', resolution: '480P' })
check('万相返回任务 id', wanTask.taskId === 'wan-1')
check('万相默认 t2v 模型', wanBodies[0].model === 'wan2.2-t2v-plus', JSON.stringify(wanBodies[0]))
check('万相 9:16 480P 尺寸', wanBodies[0].parameters.size === '480*832', JSON.stringify(wanBodies[0].parameters))
check('万相时长 5 秒', wanBodies[0].parameters.duration === 5)
const wanPoll = await wanProvider.poll('wan-1')
check('万相轮询成功', wanPoll.state === 'succeeded' && wanPoll.videoUrl.endsWith('/wan.mp4'), JSON.stringify(wanPoll))
check('轮询不带异步头', wanPollHeaders[0] === '', JSON.stringify(wanPollHeaders))

await wanProvider.submit({ prompt: '跟拍', aspectRatio: '16:9', resolution: '1080P', imageRef: 'https://example.com/a.jpg' })
check('有参考图走 i2v', wanBodies[1].model === 'wan2.2-i2v-plus', JSON.stringify(wanBodies[1]))
check('i2v 带 img_url', wanBodies[1].input.img_url === 'https://example.com/a.jpg')
check('16:9 1080P 尺寸', wanBodies[1].parameters.size === '1920*1080', JSON.stringify(wanBodies[1].parameters))

{
  const wanLong = await createProvider({
    id: 'wan-long', kind: 'dashscope-wan', origin: wan.base, apiKey: 'sk-test', model: 'wan2.2-t2v-plus',
  })
  await wanLong.submit({ prompt: '游乐园', aspectRatio: '9:16', resolution: '480P', durationSec: 30 })
  check('30秒改走 wan3.0', wanBodies.at(-1).model === 'wan3.0-video', JSON.stringify(wanBodies.at(-1)))
  check('30秒时长参数', wanBodies.at(-1).parameters.duration === 30)
  check('30秒用 ratio', wanBodies.at(-1).parameters.ratio === '9:16' && !wanBodies.at(-1).parameters.size)
  await wanLong.submit({ prompt: '接龙', aspectRatio: '9:16', durationSec: 20, imageRef: 'data:image/jpeg;base64,aaaa' })
  check('接龙走首帧', wanBodies.at(-1).input?.media?.[0]?.type === 'first_frame', JSON.stringify(wanBodies.at(-1).input))
  check('不足30秒按实长', wanBodies.at(-1).parameters.duration === 20, JSON.stringify(wanBodies.at(-1).parameters))
}

const wanImage = await createProvider({
  id: 'wan-img', kind: 'dashscope-wan', origin: wan.base, apiKey: 'sk-test', model: 'wan2.7-image-pro',
})
let imgErr
try { await wanImage.submit({ prompt: '秋日' }) } catch (error) { imgErr = error }
check('图片模型不能视频合成', Boolean(imgErr) && /图片模型/.test(imgErr.message), imgErr?.message)

const wanI2v = await createProvider({
  id: 'wan-i2v', kind: 'dashscope-wan', origin: wan.base, apiKey: 'sk-test', model: 'wan2.2-i2v-flash',
})
await wanI2v.submit({ prompt: '奶龙' })
check('无参考图时 i2v-flash 改 t2v-plus', wanBodies.at(-1).model === 'wan2.2-t2v-plus', JSON.stringify(wanBodies.at(-1)))

const wanNoKey = await createProvider({ id: 'wan2', kind: 'dashscope-wan' })
check('无密钥时健康检查失败', (await wanNoKey.healthCheck()).ok === false)

{
  const picked = await resolveRoleProviders([
    { id: 'local-comfyui', kind: 'comfyui', enabled: true, baseUrl: 'http://127.0.0.1:1' },
    { id: 'bailian-wan', kind: 'dashscope-wan', enabled: true, origin: wan.base, apiKey: 'sk-test' },
  ])
  check('ComfyUI 挂了就用万相', picked.video?.__id === 'bailian-wan', picked.video?.__id)
}

wan.server.close()

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

/* ================= 百炼配音 ================= */
console.log('\n[tts]')
const wav = Buffer.alloc(44 + 4800)
wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(36 + 4800, 4); wav.write('WAVE', 8, 'ascii')
wav.write('fmt ', 12, 'ascii'); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36, 'ascii'); wav.writeUInt32LE(4800, 40)
const ttsBodies = []
const ttsServer = await listen(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/tone.wav') {
    res.writeHead(200, { 'content-type': 'audio/wav' })
    return res.end(wav)
  }
  if (url.pathname === '/api/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ output: { total: 1, models: [{ model: 'qwen3-tts-flash' }] } }))
  }
  if (url.pathname === '/api/v1/services/aigc/multimodal-generation/generation') {
    ttsBodies.push(await readBody(req))
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ output: { audio: { url: `http://${req.headers.host}/tone.wav` } } }))
  }
  if (url.pathname === '/audio/speech') {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(404)
  res.end()
})
const dashTts = createSpeechProvider({
  baseUrl: `${ttsServer.base}/compatible-mode/v1`, apiKey: 'k', model: 'qwen-tts', voice: 'Cherry',
})
check('百炼配音健康检查不合成', (await dashTts.healthCheck()).ok === true && ttsBodies.length === 0)
const spoken = await dashTts.synthesize({ text: '测试' })
check('百炼配音走原生接口', ttsBodies[0]?.model === 'qwen3-tts-flash', JSON.stringify(ttsBodies[0]))
check('百炼配音带文本和音色', ttsBodies[0]?.input?.text === '测试' && ttsBodies[0]?.input?.voice === 'Cherry')
check('百炼配音下载到音频', spoken.audio.length > 64)
const openaiTtsServer = await listen(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/v1/audio/speech') {
    res.writeHead(200, { 'content-type': 'audio/wav' })
    return res.end(wav)
  }
  res.writeHead(404)
  res.end()
})
const openaiTts = createSpeechProvider({ baseUrl: `${openaiTtsServer.base}/v1`, model: 'tts-1', voice: 'alloy' })
const openaiSpoken = await openaiTts.synthesize({ text: 'hi' })
check('OpenAI 兼容配音仍走 /audio/speech', openaiSpoken.audio.length > 64)
ttsServer.server.close()
openaiTtsServer.server.close()

await rm(work, { recursive: true, force: true }).catch(() => {})

console.log(`\nALL ADAPTER CHECKS PASSED (${passed})`)
