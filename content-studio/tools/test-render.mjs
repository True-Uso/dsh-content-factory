/**
 * 渲染器端到端校验：真跑 ffmpeg，产出 master.mp4。
 *   node tools/test-render.mjs
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { resolveTools, ffmpeg, probe, meanVolumeDb } = await import('../lib/ffmpeg.js')
const { createPlan, validatePlan, planSignature } = await import('../lib/edl.js')
const { renderPlan, extractThumbnail } = await import('../lib/steps/render.js')
const { buildCues, toSrt, buildStyle } = await import('../lib/steps/subtitle.js')
const { writeWav, silence } = await import('../lib/wav.js')
const { writeFile } = await import('node:fs/promises')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

const work = await mkdtemp(join(tmpdir(), 'cs-render-'))
const tools = await resolveTools()
check('ffmpeg 可用', tools.ok, tools.error)
console.log('  ffmpeg:', tools.ffmpeg)

// 三个不同颜色的测试镜头
const shots = []
const colors = ['red', 'green', 'blue']
for (let index = 0; index < colors.length; index += 1) {
  const path = join(work, `shot${index + 1}.mp4`)
  await ffmpeg(tools, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${colors[index]}:s=720x1280:d=3:r=30`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path,
  ])
  shots.push({ path, kind: 'video', durationSec: 3, intent: colors[index] })
}
check('生成 3 个测试镜头', shots.length === 3)

// 6 秒配音轨（静音，仅用于时长）
const voicePath = join(work, 'voice.wav')
await writeFile(voicePath, writeWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, data: silence({ sampleRate: 24000, channels: 1, bitsPerSample: 16, durationSec: 6 }) }))

// 字幕
const cues = buildCues([
  { sid: 's1', text: '第一句字幕测试', start: 0, end: 2.5 },
  { sid: 's2', text: '第二句字幕测试内容长一些看看会不会换行', start: 2.5, end: 6 },
])
const srtPath = join(work, 'subs.srt')
await writeFile(srtPath, toSrt(cues), 'utf8')

const plan = createPlan({
  resolution: { w: 720, h: 1280 },
  fps: 30,
  durationSec: 6,
  voice: { path: voicePath, totalSec: 6 },
  shots,
  subtitles: { srtPath, style: buildStyle({ fontSize: 28, marginBottom: 80 }) },
  loudnessTarget: -14,
})

check('EDL 校验通过', validatePlan(plan).ok, validatePlan(plan).errors.join('；'))
check('镜头覆盖总时长', Math.abs(plan.segments.at(-1).startSec + plan.segments.at(-1).durationSec - 6) < 0.1)
check('签名稳定', planSignature(plan) === planSignature(JSON.parse(JSON.stringify(plan))))

const broken = JSON.parse(JSON.stringify(plan))
broken.segments[1].startSec += 0.5
check('不连续的 EDL 被拒绝', !validatePlan(broken).ok)

console.log('  渲染中（含烧字幕）…')
const started = Date.now()
const result = await renderPlan(plan, { tools, outDir: work, onProgress: (p) => {
  if (p.done === p.total) console.log(`  进度 ${Math.round(p.progress * 100)}% (${p.stage})`)
} })
const elapsed = Date.now() - started
console.log(`  渲染耗时 ${(elapsed / 1000).toFixed(1)}s`)

const masterStat = await stat(result.masterPath)
check('master.mp4 存在且非空', masterStat.size > 10000, `${masterStat.size} bytes`)
check('成片时长约 6s', Math.abs(result.durationSec - 6) < 0.4, String(result.durationSec))
check('分辨率正确', result.width === 720 && result.height === 1280, `${result.width}x${result.height}`)
check('有音频轨', result.hasAudio === true)
check('编码为 h264/aac', result.videoCodec === 'h264' && result.audioCodec === 'aac', `${result.videoCodec}/${result.audioCodec}`)

const volume = await meanVolumeDb(tools, result.masterPath)
check('音量可测（静音源应很低）', volume === null || volume < -30, String(volume))

// 抽帧
const thumb = await extractThumbnail(tools, result.masterPath, join(work, 'thumb.jpg'), 1)
check('抽帧成功', (await stat(thumb)).size > 1000)

// 无字幕分支：copy 视频流
const planNoSubs = createPlan({
  resolution: { w: 720, h: 1280 }, fps: 30, durationSec: 6,
  voice: { path: voicePath, totalSec: 6 }, shots,
})
const withSubs = await readFile(result.masterPath)
const out2 = join(work, 'nosubs')
const result2 = await renderPlan(planNoSubs, { tools, outDir: out2 })
check('无字幕也能渲染', result2.hasAudio === true && result2.durationSec > 5.5, String(result2.durationSec))
check('两种输出都是 mp4', withSubs.length > 0 && (await stat(result2.masterPath)).size > 0)

/* ---------- 短素材 + 长配音：必须循环补足，不能缩短成片 ---------- */
const shortClips = []
for (let index = 0; index < 3; index += 1) {
  const path = join(work, `short${index}.mp4`)
  await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${colors[index]}:s=360x640:d=2:r=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path])
  shortClips.push({ path, kind: 'video', durationSec: 2, intent: 'short' })
}
const longVoice = join(work, 'longvoice.wav')
await writeFile(longVoice, writeWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, data: silence({ sampleRate: 24000, channels: 1, bitsPerSample: 16, durationSec: 14 }) }))

const longPlan = createPlan({
  resolution: { w: 360, h: 640 }, fps: 30, durationSec: 14,
  voice: { path: longVoice, totalSec: 14 },
  shots: shortClips,
})
const longResult = await renderPlan(longPlan, { tools, outDir: join(work, 'long') })
check('素材只有 2s 也能撑满 14s', Math.abs(longResult.durationSec - 14) < 0.6, String(longResult.durationSec))

/* ---------- 转场：dip-to-black 不破坏时长 ---------- */
const fadePlan = createPlan({
  resolution: { w: 360, h: 640 }, fps: 30, durationSec: 6,
  voice: { path: voicePath, totalSec: 6 },
  shots: shots.map((shot) => ({ ...shot, transitionOut: 'fade' })),
})
const fadeResult = await renderPlan(fadePlan, { tools, outDir: join(work, 'fade') })
check('带转场仍保持 6s', Math.abs(fadeResult.durationSec - 6) < 0.4, String(fadeResult.durationSec))
check('转场成片有音频', fadeResult.hasAudio === true)

/* ---------- 图片素材 + BGM 闪避 + 16:9 ---------- */
const imagePath = join(work, 'still.png')
await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=purple:s=720x1280:d=1', '-frames:v', '1', imagePath])

const bgmPath = join(work, 'bgm.wav')
const bgmPcm = Buffer.alloc(24000 * 2 * 8)
for (let i = 0; i < 24000 * 8; i += 1) {
  bgmPcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * i) / 24000) * 6000), i * 2)
}
await writeFile(bgmPath, writeWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, data: bgmPcm }))

const mixedPlan = createPlan({
  resolution: { w: 1280, h: 720 }, fps: 25, durationSec: 6,
  voice: { path: voicePath, totalSec: 6 },
  shots: [
    { path: imagePath, kind: 'image', durationSec: 3, intent: '静态图' },
    { path: shots[0].path, kind: 'video', durationSec: 3, intent: '动态' },
  ],
  bgm: { path: bgmPath, gain: 0.2, duck: true },
  subtitles: { srtPath, style: buildStyle({ fontSize: 28, marginBottom: 60 }) },
})
const mixedResult = await renderPlan(mixedPlan, { tools, outDir: join(work, 'mixed') })
check('图片镜头能渲染', mixedResult.durationSec > 5.5, String(mixedResult.durationSec))
check('16:9 输出尺寸正确', mixedResult.width === 1280 && mixedResult.height === 720, `${mixedResult.width}x${mixedResult.height}`)
check('25fps 保持', Math.abs((mixedResult.fps || 0) - 25) <= 0.5, String(mixedResult.fps))
check('BGM 混音后仍有音频', mixedResult.hasAudio === true)
const mixedVolume = await meanVolumeDb(tools, mixedResult.masterPath)
check('BGM 带来可测音量', mixedVolume !== null && mixedVolume > -50, String(mixedVolume))

await rm(work, { recursive: true, force: true })
console.log(`\nALL RENDER CHECKS PASSED (${passed})`)
