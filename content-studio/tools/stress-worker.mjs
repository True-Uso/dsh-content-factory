/**
 * 并发压力测试：重复跑批量，任何一条失败就打印错误，用于定位竞态。
 *   node tools/stress-worker.mjs [rounds]
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CONTENT_STUDIO_HOME = await mkdtemp(join(tmpdir(), 'cs-stress-'))

const { resolveTools, ffmpeg } = await import('../lib/ffmpeg.js')
const { createBatch, loadBatch } = await import('../lib/batch-store.js')
const { scanMaterials } = await import('../lib/steps/scan.js')
const { createRunner } = await import('../lib/worker.js')
const { writeWav } = await import('../lib/wav.js')

const rounds = Number(process.argv[2] || 4)
const tools = await resolveTools()

const lib = await mkdtemp(join(tmpdir(), 'cs-stress-lib-'))
await mkdir(join(lib, '日常'), { recursive: true })
for (const color of ['goldenrod', 'seagreen', 'indianred', 'steelblue']) {
  await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=360x640:d=2:r=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(lib, '日常', `${color}.mp4`)])
}
const scanned = await scanMaterials({ dirs: [lib], tools })

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
        title: '压力测试',
        narration: [{ id: 's1', text: '第一句。' }, { id: 's2', text: '第二句。' }],
        description: 'd',
        hashtags: ['#测试'],
        coverText: { main: '压力', sub: '测试' },
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

let failures = 0
for (let round = 1; round <= rounds; round += 1) {
  const batch = await createBatch({
    title: `压力 ${round}`,
    count: 3,
    config: { topic: '日常', targetSec: 12, materialMode: 'folder', group: '日常', fps: 30, voice: 'mock' },
  })
  const runner = createRunner({ concurrency: 2, tools, materials: scanned.index.entries, providers: { llm, tts } })
  await runner.startBatch(batch.id)
  await runner.waitIdle()
  const after = await loadBatch(batch.id)
  const bad = after.items.filter((item) => item.status !== 'review_pending')
  if (bad.length > 0) {
    failures += bad.length
    console.log(`round ${round}: ${bad.length} 条失败`)
    for (const item of bad) console.log(`   ${item.id} → ${item.error}`)
  } else {
    console.log(`round ${round}: ok`)
  }
}

await rm(lib, { recursive: true, force: true }).catch(() => {})
await rm(process.env.CONTENT_STUDIO_HOME, { recursive: true, force: true }).catch(() => {})
console.log(failures === 0 ? '\nNO FAILURES' : `\nFAILURES: ${failures}`)
