/**
 * 适配器集成测试：用 http-generic 适配器跑一遍「提交 → 轮询 → 成功」。
 * 需要先启动 tools/mock-video-server.js。
 *
 *   node tools/test-adapter.mjs [port]
 */
import { createProvider, createHttpGeneric, ProviderError } from '../lib/providers.js'
import { runToCompletion } from '../lib/runner.js'

const port = Number(process.argv[2] || 9100)
const base = `http://127.0.0.1:${port}`

const providerConfig = {
  id: 'local-http',
  kind: 'http-generic',
  enabled: true,
  baseUrl: base,
  defaults: { width: 768, height: 1344, durationSec: 5, fps: 24 },
  poll: { intervalMs: 200, timeoutMs: 20000 },
  protocol: {
    health: { method: 'GET', path: '/health' },
    submit: {
      method: 'POST',
      path: '/generate',
      body: { prompt: '${prompt}', width: '${width}', height: '${height}', num_frames: '${frames}', seed: '${seed}' },
    },
    poll: { method: 'GET', path: '/tasks/${taskId}' },
    extract: { taskId: '$.task_id', state: '$.data.status', videoUrl: '$.data.video_url', error: '$.data.message' },
    stateMap: {
      queued: ['pending', 'queued', 'waiting'],
      running: ['running', 'processing', 'in_progress'],
      succeeded: ['done', 'success', 'completed'],
      failed: ['error', 'failed', 'cancelled'],
    },
  },
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`)
}

const instance = await createProvider(providerConfig)
assert(instance.kind === 'http-generic', 'factory 应返回 http-generic 适配器')

const health = await instance.healthCheck()
console.log('health:', JSON.stringify(health))
assert(health.ok === true, '健康检查应通过')

const progress = []
const result = await runToCompletion(instance, { prompt: '测试镜头', durationSec: 5 }, {
  onProgress: (p) => progress.push(p.state || p.phase),
})
console.log('states:', progress.join(' → '))
console.log('result:', JSON.stringify(result))

assert(progress.includes('queued'), '轮询应观察到 queued 状态（排队不算失败）')
assert(/\/files\/mock-\d+\.mp4$/.test(result.videoUrl || ''), '应解析出视频地址')

// 失败路径：把状态映射成失败，确认异常带 code
const failing = createHttpGeneric({
  ...providerConfig,
  protocol: {
    ...providerConfig.protocol,
    poll: { method: 'GET', path: '/tasks/${taskId}' },
    extract: { ...providerConfig.protocol.extract, state: '$.data.status' },
    stateMap: { ...providerConfig.protocol.stateMap, succeeded: ['never-happens'] },
  },
})

let failure
try {
  await runToCompletion(failing, { prompt: 'x' }, { intervalMs: 50, timeoutMs: 600 })
} catch (error) {
  failure = error
}
assert(failure instanceof ProviderError, '超时应抛 ProviderError')
console.log('timeout path code:', failure.code)

console.log('\nALL ADAPTER CHECKS PASSED')
