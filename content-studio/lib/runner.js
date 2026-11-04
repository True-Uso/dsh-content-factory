import { ProviderError } from './providers.js'

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(new ProviderError('ABORTED', '任务已取消'))
      return
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new ProviderError('ABORTED', '任务已取消'))
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * Submit one generation and poll until it settles.
 *
 * `queued` never counts as a failure — only `failed` does. This is the single
 * rule that keeps a slow cloud queue from turning into a retry storm.
 */
export async function runToCompletion(provider, input, options = {}) {
  const startedAt = Date.now()
  const intervalMs = options.intervalMs ?? provider.intervalMs ?? 3000
  const timeoutMs = options.timeoutMs ?? provider.timeoutMs ?? 15 * 60 * 1000
  const onProgress = options.onProgress
  const signal = options.signal

  const { taskId } = await provider.submit(input, signal)
  onProgress?.({ phase: 'submitted', taskId })

  let polls = 0
  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new ProviderError('TIMEOUT', `任务 ${taskId} 超时（${Math.round(timeoutMs / 1000)}s 未完成）`)
    }
    const result = await provider.poll(taskId, signal)
    polls += 1
    onProgress?.({ phase: 'poll', taskId, polls, state: result.state })

    if (result.state === 'succeeded') {
      return {
        taskId,
        videoUrl: result.videoUrl,
        localPath: result.localPath,
        polls,
        elapsedMs: Date.now() - startedAt,
      }
    }
    if (result.state === 'failed') {
      throw new ProviderError('GENERATION_FAILED', result.error || `任务 ${taskId} 生成失败`, result.raw)
    }
    await sleep(intervalMs, signal)
  }
}
