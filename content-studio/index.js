import { createApi } from './lib/api.js'
import { createRunner } from './lib/worker.js'

const API_PREFIX = '/content-studio/api'

/**
 * Host half of Content Studio.
 *
 * Wires three things and nothing else:
 *   1. the batch runner (in-process queue, resumes unfinished work on activation)
 *   2. the HTTP surface the workbench page talks to
 *   3. lifecycle cleanup so unloading the plugin stops accepting work
 *
 * Everything is wrapped so a failure here degrades the plugin instead of
 * breaking the profile at activation time.
 */
export function apply(ctx) {
  const web = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (!web) {
    console.warn('[content-studio] 未找到 webServer，工作台不可用')
    return
  }

  // runner is built first, but its events need api.broadcast — one mutable seam.
  const sink = { emit: () => {} }
  const runner = createRunner({ concurrency: 2, onEvent: (event) => sink.emit(event) })
  let origin = null
  try {
    origin = typeof web.getOrigin === 'function' ? web.getOrigin() : null
  } catch {
    origin = null
  }
  const api = createApi({ runner, prefix: API_PREFIX, allowedOrigin: origin })
  sink.emit = api.broadcast

  const register = () => web.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req, res) => {
      void api.handler(req, res)
    },
  })

  if (typeof ctx.effect === 'function') ctx.effect(register)
  else register()

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      // Pick up anything a previous process left unfinished. A crash mid-item
      // leaves status=running, which resumeUnfinished resets to pending.
      runner
        .resumeUnfinished()
        .then((resumed) => {
          if (resumed.length > 0) console.info(`[content-studio] 续跑 ${resumed.length} 个批次`)
        })
        .catch((error) => console.warn('[content-studio] 续跑失败:', error.message))

      // 配音缓存清理放后台：不影响启动
      import('./lib/steps/voice.js')
        .then(({ pruneVoiceCache }) => pruneVoiceCache())
        .then((result) => {
          if (result.removed > 0) console.info(`[content-studio] 清理配音缓存 ${result.removed} 个`)
        })
        .catch(() => {})

      return () => runner.stop()
    })
  }

  if (typeof ctx.provide === 'function') {
    try {
      ctx.provide('contentStudio', { runner, api })
    } catch {
      // providing a service is optional; ignore collisions
    }
  }
}
