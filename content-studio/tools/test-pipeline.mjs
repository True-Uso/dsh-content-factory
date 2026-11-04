/**
 * P0 单元与集成校验（无需网络、无需 ffmpeg）。
 *   node tools/test-pipeline.mjs
 */
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CONTENT_STUDIO_HOME = await mkdtemp(join(tmpdir(), 'cs-test-'))

const { splitText, buildCues, toSrt, formatTimestamp, buildStyle, toAss, formatAssTime } = await import('../lib/steps/subtitle.js')
const { parseWav, writeWav, silence } = await import('../lib/wav.js')
const { validateScript, estimateSeconds, generateScript } = await import('../lib/steps/script.js')
const { createBatch, loadBatch, updateItem, listBatches, markStep, resetStepsFrom, STEP_ORDER } = await import('../lib/batch-store.js')
const { synthesizeVoice, verifyVoiceFile, pruneVoiceCache, voiceCacheDir } = await import('../lib/steps/voice.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

/* ---------------- subtitle ---------------- */
console.log('\n[subtitle]')
check('短句不切分', splitText('你好', 16).length === 1)
const chunks = splitText('秋天最怕的是什么？穿多了显胖，穿少了打哆嗦，这就是换季的终极难题。', 16)
check('长句被切分', chunks.length >= 2, JSON.stringify(chunks))
check('切分不丢字', chunks.join('').replace(/\s/g, '') === '秋天最怕的是什么？穿多了显胖，穿少了打哆嗦，这就是换季的终极难题。')

const cues = buildCues([
  { sid: 's1', text: '秋天最怕的是什么？', start: 0, end: 2.1 },
  { sid: 's2', text: '穿多了显胖穿少了打哆嗦这就是换季的终极难题', start: 2.1, end: 8.0 },
])
check('cue 数量合理', cues.length >= 3, String(cues.length))
check('时间单调不重叠', cues.every((cue, i) => i === 0 || cue.start >= cues[i - 1].end - 1e-6))
check('最小时长 0.3s', cues.every((cue) => cue.end - cue.start >= 0.3 - 1e-6))
check('无字级时间戳时标记 estimated', cues[1].timing === 'estimated')

const srt = toSrt(cues)
check('SRT 段数正确', srt.trim().split('\n\n').length === cues.length)
check('SRT 首行是序号 1', srt.startsWith('1\n'))
check('SRT 时间格式', /^00:00:00,000 --> 00:00:02,100$/m.test(srt), srt.split('\n')[1])
check('formatTimestamp 舍入', formatTimestamp(3661.5) === '01:01:01,500')
check('样式默认值', buildStyle().preset === 'vertical-bold')

// ASS 回归：必须自带 PlayRes，否则 libass 按 288 高解释字号，1080p 上会放大 6.7 倍
const ass = toAss(cues, buildStyle({ fontSize: 64 }), { width: 1080, height: 1920 })
check('ASS 声明 PlayResY', ass.includes('PlayResY: 1920'), ass.slice(0, 200))
check('ASS 声明 PlayResX', ass.includes('PlayResX: 1080'))
check('ASS 字号按像素', /Style: Default,[^,]+,64,/.test(ass), ass.split('\n').find((line) => line.startsWith('Style:')))
check('ASS 事件数正确', ass.split('\n').filter((line) => line.startsWith('Dialogue:')).length === cues.length)
check('ASS 时间格式', /Dialogue: 0,0:00:00\.00,0:00:02\.10,/.test(ass))
check('ASS 转义控制字符', !toAss([{ start: 0, end: 1, text: 'a{b}c\\d' }]).includes('{b}'))
check('formatAssTime', formatAssTime(3661.5) === '1:01:01.50', formatAssTime(3661.5))

/* ---------------- wav ---------------- */
console.log('\n[wav]')
const tone = silence({ sampleRate: 24000, channels: 1, bitsPerSample: 16, durationSec: 0.5 })
const wavBytes = writeWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, data: tone })
const parsed = parseWav(wavBytes)
check('WAV 往返时长', Math.abs(parsed.durationSec - 0.5) < 1e-6, String(parsed.durationSec))
check('WAV 采样率', parsed.sampleRate === 24000)

/* ---------------- script ---------------- */
console.log('\n[script]')
check('中文字数估时', Math.abs(estimateSeconds('一' .repeat(9)) - 2) < 0.05, String(estimateSeconds('一'.repeat(9))))

const goodScript = {
  title: '秋日通勤三件套',
  narration: [{ id: 's1', text: '秋天最怕的是什么？' }, { id: 's2', text: '穿多了显胖，穿少了打哆嗦。' }],
  description: '简介',
  hashtags: ['#穿搭'],
  coverText: { main: '三件套', sub: '通勤不显胖' },
  coverPrompt: 'a woman walking in autumn street, no text',
  shotList: [
    { id: 'shot1', intent: '通勤街景', source: 'generate', durationSec: 4 },
    { id: 'shot2', intent: '服装细节', source: 'library', durationSec: 3 },
  ],
}
const good = validateScript(goodScript, { targetSec: 12 })
check('合法脚本通过', good.ok, good.errors.join('；'))

const bad = validateScript({ ...goodScript, shotList: [{ id: 's', source: 'weird', durationSec: 0 }] }, { targetSec: 12 })
check('非法 source 被拦', !bad.ok)
check('durationSec=0 被拦', bad.errors.some((e) => e.includes('durationSec')))
check('标题过长只告警', validateScript({ ...goodScript, title: '标'.repeat(40) }, { targetSec: 12 }).warnings.length > 0)

const fakeLlm = {
  async complete() {
    return { json: goodScript, usage: { total_tokens: 10 } }
  },
}
const generated = await generateScript(fakeLlm, { topic: '秋季穿搭', targetSec: 12 })
check('生成脚本返回 attempts', generated.attempts.length === 1)

/* ---------------- batch store ---------------- */
console.log('\n[batch-store]')
const batch = await createBatch({ title: '测试批次', count: 3, config: { topic: '测试' } })
check('批次 id 前缀', batch.id.startsWith('batch-'))
check('条目数量', batch.items.length === 3)
const initial = await (await import('../lib/batch-store.js')).loadItem(batch.id, batch.items[0].id)
check('步骤初始化完整', STEP_ORDER.every((step) => initial.item.steps[step]?.status === 'pending'))

const loaded = await loadBatch(batch.id)
check('批次可回读', loaded.title === '测试批次')

const first = loaded.items[0]
await markStep(batch.id, first.id, 'script', { status: 'running' })
const afterMark = await (await import('../lib/batch-store.js')).loadItem(batch.id, first.id)
check('步骤状态写入', afterMark.item.steps.script.status === 'running')
check('尝试次数累加', afterMark.item.steps.script.attempts === 1)

await (await import('../lib/batch-store.js')).updateItem(batch.id, first.id, () => ({ status: 'failed', error: 'boom' }))
const failed = await (await import('../lib/batch-store.js')).loadItem(batch.id, first.id)
check('条目失败状态', failed.item.status === 'failed')
const summary = (await loadBatch(batch.id)).items.find((i) => i.id === first.id)
check('批次摘要同步', summary.status === 'failed' && summary.error === 'boom')

await resetStepsFrom(batch.id, first.id, 'voice')
const afterVoiceReset = await (await import('../lib/batch-store.js')).loadItem(batch.id, first.id)
check('从 voice 重置不影响 script', afterVoiceReset.item.steps.script.status === 'running')
check('从 voice 重置清空 voice', afterVoiceReset.item.steps.voice.status === 'pending')

await resetStepsFrom(batch.id, first.id, 'script')
const reset = await (await import('../lib/batch-store.js')).loadItem(batch.id, first.id)
check('从 script 重置清空 script', reset.item.steps.script.status === 'pending')
check('重置回 pending', reset.item.status === 'pending')
check('步骤总数固定 8', STEP_ORDER.length === 8)
check('批次列表可用', (await listBatches()).length === 1)

/* ---------------- voice ---------------- */
console.log('\n[voice]')
const fakeTts = {
  calls: 0,
  async synthesize({ text }) {
    this.calls += 1
    const seconds = Math.max(0.2, Array.from(text).length * 0.15)
    const data = silence({ sampleRate: 24000, channels: 1, bitsPerSample: 16, durationSec: seconds })
    return { audio: writeWav({ sampleRate: 24000, channels: 1, bitsPerSample: 16, data }), contentType: 'audio/wav' }
  },
}

const voiceOut = join(process.env.CONTENT_STUDIO_HOME, 'voice-test')
const narration = [
  { sid: 's1', text: '秋天最怕的是什么？' },
  { sid: 's2', text: '穿多了显胖。' },
  { sid: 's3', text: '穿少了打哆嗦。' },
]
const voice = await synthesizeVoice({ tts: fakeTts, narration, outDir: voiceOut, voice: 'test', gapMs: 180 })
check('三句各合成一次', fakeTts.calls === 3)
check('片段数正确', voice.segments.length === 3)
const expected =
  narration.reduce((sum, line) => sum + Math.max(0.2, Array.from(line.text).length * 0.15), 0) + 2 * 0.18
check('总时长 = 片段 + 间隔', Math.abs(voice.totalSec - expected) < 0.01, `${voice.totalSec} vs ${expected.toFixed(3)}`)
check('时间轴单调', voice.segments.every((s, i) => i === 0 || s.start >= voice.segments[i - 1].end - 1e-6))
check('最后一段结束时等于总长', Math.abs(voice.segments.at(-1).end - voice.totalSec) < 0.01)

const verified = await verifyVoiceFile(voice.wavPath, voice.totalSec)
check('落盘文件与计算一致', verified.ok, JSON.stringify(verified))

const cached = await synthesizeVoice({ tts: fakeTts, narration, outDir: voiceOut, voice: 'test', gapMs: 180 })
check('缓存命中不再请求', fakeTts.calls === 3 && cached.cacheHits === 3, `calls=${fakeTts.calls} hits=${cached.cacheHits}`)
check('缓存命中不计费字符', cached.synthesizedCharacters === 0, String(cached.synthesizedCharacters))
check('缓存命中记入复用字符', cached.reusedCharacters > 0, String(cached.reusedCharacters))
check('首次合成计入计费字符', voice.synthesizedCharacters === narration.reduce((sum, line) => sum + Array.from(line.text).length, 0), String(voice.synthesizedCharacters))

let mismatch
let callIndex = 0
try {
  await synthesizeVoice({
    tts: {
      async synthesize() {
        callIndex += 1
        const sampleRate = callIndex === 1 ? 24000 : 48000
        const channels = callIndex === 1 ? 1 : 2
        const data = Buffer.alloc(sampleRate * channels * 2 * 0.2)
        return { audio: writeWav({ sampleRate, channels, bitsPerSample: 16, data }) }
      },
    },
    narration: [{ sid: 's1', text: 'a' }, { sid: 's2', text: 'b' }],
    outDir: join(voiceOut, 'mismatch'),
    voice: 'other',
    useCache: false,
  })
} catch (error) {
  mismatch = error
}
check('不同采样率的片段被拒绝', Boolean(mismatch) && /格式不一致/.test(mismatch.message), mismatch?.message)

/* ---------- 缓存清理 ---------- */
const cacheDir = voiceCacheDir()
await utimes(join(cacheDir, `${'a'.repeat(40)}.wav`), new Date(Date.now() - 60 * 86400e3), new Date(Date.now() - 60 * 86400e3)).catch(() => {})
const staleName = `${'b'.repeat(40)}.wav`
await writeFile(join(cacheDir, staleName), 'stale')
await utimes(join(cacheDir, staleName), new Date(Date.now() - 60 * 86400e3), new Date(Date.now() - 60 * 86400e3))
await writeFile(join(cacheDir, 'leftover.tmp'), 'tmp')
const pruned = await pruneVoiceCache({ maxAgeDays: 30 })
check('清掉过期缓存', pruned.removed >= 1, JSON.stringify(pruned))
check('保留近期缓存', pruned.kept >= 1, JSON.stringify(pruned))
let staleGone = false
try {
  await stat(join(cacheDir, staleName))
} catch {
  staleGone = true
}
check('过期文件确实被删掉', staleGone)
let tmpGone = false
try {
  await stat(join(cacheDir, 'leftover.tmp'))
} catch {
  tmpGone = true
}
check('残留临时文件被清掉', tmpGone)

await rm(process.env.CONTENT_STUDIO_HOME, { recursive: true, force: true })
console.log(`\nALL PIPELINE CHECKS PASSED (${passed})`)
