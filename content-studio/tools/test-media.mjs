/**
 * 素材扫描 / 封面 / 校验 三步的真实校验（真跑 ffmpeg）。
 *   node tools/test-media.mjs
 */
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CONTENT_STUDIO_HOME = await mkdtemp(join(tmpdir(), 'cs-media-'))

const { resolveTools, ffmpeg, probe } = await import('../lib/ffmpeg.js')
const { scanMaterials, pickMaterials, listGroups, loadIndex } = await import('../lib/steps/scan.js')
const { composeCover, fallbackBackground, COVER_VARIANTS } = await import('../lib/steps/cover.js')
const { validateItem, DEFAULT_RULES } = await import('../lib/steps/validate.js')
const { createPlan } = await import('../lib/edl.js')
const { renderPlan } = await import('../lib/steps/render.js')
const { buildCues, toSrt, buildStyle } = await import('../lib/steps/subtitle.js')
const { writeWav, silence } = await import('../lib/wav.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

const tools = await resolveTools()
check('ffmpeg 可用', tools.ok, tools.error)

const root = await mkdtemp(join(tmpdir(), 'cs-lib-'))
const outfit = join(root, '穿搭')
const food = join(root, '美食')
await mkdir(outfit, { recursive: true })
await mkdir(food, { recursive: true })

async function makeClip(path, color, seconds) {
  await ffmpeg(tools, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=${color}:s=360x640:d=${seconds}:r=30`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path,
  ])
}

await makeClip(join(outfit, 'a1.mp4'), 'orange', 2)
await makeClip(join(outfit, 'a2.mp4'), 'purple', 3)
await makeClip(join(food, 'b1.mp4'), 'teal', 2)
await writeFile(join(root, 'broken.mp4'), 'not a video', 'utf8')
await writeFile(join(root, 'notes.txt'), 'ignored', 'utf8')
// 同一份文件换个名字，用于验证去重（字节级：复制粘贴，不是重新封装）
await copyFile(join(food, 'b1.mp4'), join(food, 'b1-copy.mp4'))

/* ---------------- scan ---------------- */
console.log('\n[scan]')
const first = await scanMaterials({ dirs: [root], tools })
check('扫到 4 个媒体文件', first.index.entries.length === 4, String(first.index.entries.length))
check('坏文件被记为无效', first.stats.invalid === 1, JSON.stringify(first.stats))
check('文本文件被跳过', first.stats.skipped >= 1)
check('分组正确', new Set(first.index.entries.map((e) => e.dirGroup)).size === 2)

const groups = listGroups(first.index.entries)
check('分组统计', groups.length === 2 && groups.every((g) => g.count === 2), JSON.stringify(groups))

const dupHashes = first.index.entries.map((e) => e.hash)
check('复制文件哈希相同（可去重）', new Set(dupHashes).size < dupHashes.length, `${new Set(dupHashes).size}/${dupHashes.length}`)
check('记录了时长', first.index.entries.every((e) => e.durationSec > 0))
check('记录了分辨率', first.index.entries.every((e) => e.width === 360 && e.height === 640))

const second = await scanMaterials({ dirs: [root], tools })
check('二次扫描全部命中缓存', second.stats.unchanged === 4 && second.stats.added === 0, JSON.stringify(second.stats))

/* ---------- 删掉素材后索引要跟着清理 ---------- */
await rm(join(food, 'b1-copy.mp4'), { force: true })
const third = await scanMaterials({ dirs: [root], tools })
check('被删素材的索引条目被移除', third.stats.removed === 1, JSON.stringify(third.stats))
check('索引里不再有已删文件', !third.index.entries.some((e) => e.path.endsWith('b1-copy.mp4')))
check('其余素材仍在索引', third.index.entries.length === 3, String(third.index.entries.length))
const afterPrune = pickMaterials(third.index.entries, { mode: 'pool', limit: 10 })
check('选材不会选到已删文件', afterPrune.every((e) => !e.path.endsWith('b1-copy.mp4')))

const folderPicked = pickMaterials(first.index.entries, { mode: 'folder', group: '穿搭' })
check('folder 模式只取本组', folderPicked.every((e) => e.dirGroup === '穿搭') && folderPicked.length === 2)
const poolPicked = pickMaterials(first.index.entries, { mode: 'pool', limit: 10 })
check('pool 模式跨组', new Set(poolPicked.map((e) => e.dirGroup)).size === 2)

const excluded = pickMaterials(first.index.entries, { mode: 'pool', limit: 10, exclude: new Set(first.index.entries.slice(0, 3).map((e) => e.path)) })
check('排除已用素材', excluded.every((e) => !first.index.entries.slice(0, 3).some((x) => x.path === e.path)), JSON.stringify(excluded.map((e) => e.relPath)))
const allExcluded = pickMaterials(first.index.entries, { mode: 'pool', limit: 10, exclude: new Set(first.index.entries.map((e) => e.path)) })
check('素材全被排除时回退而不是返回空', allExcluded.length > 0, String(allExcluded.length))

// 索引还在、文件被外部移走（搬库 / 拔硬盘）：选材要跳过死路径
await rm(join(outfit, 'a2.mp4'), { force: true })
const missingPicked = pickMaterials(first.index.entries, { mode: 'pool', limit: 10 })
check('选材跳过已不存在的文件', missingPicked.every((e) => !e.path.endsWith('a2.mp4')), JSON.stringify(missingPicked.map((e) => e.relPath)))
check('其余可用素材仍能选中', missingPicked.length === 2, String(missingPicked.length))

const { pickInSec } = await import('../lib/pipeline.js')
check('镜头与素材等长时从 0 开始', pickInSec({ kind: 'video', durationSec: 3 }, 3) === 0)
const offsetA = pickInSec({ kind: 'video', durationSec: 10 }, 2, 1, 0)
const offsetB = pickInSec({ kind: 'video', durationSec: 10 }, 2, 2, 0)
check('长素材的取用起点按条目分散', offsetA !== offsetB, `${offsetA} vs ${offsetB}`)
check('起点落在可用范围内', offsetA >= 0 && offsetA < 8 && offsetB >= 0 && offsetB < 8, `${offsetA},${offsetB}`)
check('图片没有起点', pickInSec({ kind: 'image' }, 2) === 0)

/* ---------------- cover ---------------- */
console.log('\n[cover]')
const coverDir = await mkdtemp(join(tmpdir(), 'cs-cover-'))
const bg = await fallbackBackground({ tools, outDir: coverDir })
check('fallback 底图生成', (await stat(bg)).size > 1000)

const cover = await composeCover({
  tools,
  bgPath: bg,
  text: { main: '秋日三件套', sub: '通勤不显胖' },
  outDir: coverDir,
  template: 'default',
  variants: ['vertical', 'horizontal', 'square'],
})
check('三个尺寸都产出', Object.keys(cover.files).length === 3)
for (const [name, file] of Object.entries(cover.files)) {
  const info = await probe(tools, file.path)
  const expect = COVER_VARIANTS[name]
  check(`封面 ${name} 尺寸 ${expect.w}x${expect.h}`, info.width === expect.w && info.height === expect.h, `${info.width}x${info.height}`)
  check(`封面 ${name} 非空`, (await stat(file.path)).size > 5000)
}

// 换标题不应该重新生图：只重跑合成
const before = (await stat(cover.files.vertical.path)).mtimeMs
await composeCover({ tools, bgPath: bg, text: { main: '换个标题', sub: '同样底图' }, outDir: coverDir, variants: ['vertical'] })
const after = (await stat(cover.files.vertical.path)).mtimeMs
check('改标题可复用底图重排', after >= before)

let emptyText
try {
  await composeCover({ tools, bgPath: bg, text: { main: '' }, outDir: coverDir })
} catch (error) {
  emptyText = error
}
check('空主文案被拒绝', Boolean(emptyText))

/* ---------------- validate ---------------- */
console.log('\n[validate]')
const workDir = await mkdtemp(join(tmpdir(), 'cs-val-'))
const shotA = join(workDir, 'shotA.mp4')
const shotB = join(workDir, 'shotB.mp4')
await makeClip(shotA, 'navy', 3)
await makeClip(shotB, 'seagreen', 3)
const voicePath = join(workDir, 'voice.wav')
// 有声的正弦波：静音会被 L2 音量检查正确判为失败
function tonePcm({ sampleRate = 24000, durationSec = 4, freq = 220 }) {
  const frames = Math.round(sampleRate * durationSec)
  const data = Buffer.alloc(frames * 2)
  for (let index = 0; index < frames; index += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * freq * index) / sampleRate) * 12000)
    data.writeInt16LE(value, index * 2)
  }
  return writeWav({ sampleRate, channels: 1, bitsPerSample: 16, data })
}
await writeFile(voicePath, tonePcm({}))
const srtPath = join(workDir, 'subs.srt')
await writeFile(srtPath, toSrt(buildCues([{ sid: 's1', text: '校验测试', start: 0, end: 4 }])), 'utf8')

const plan = createPlan({
  resolution: { w: 360, h: 640 }, fps: 30, durationSec: 4,
  voice: { path: voicePath, totalSec: 4 },
  shots: [{ path: shotA, kind: 'video', durationSec: 3 }, { path: shotB, kind: 'video', durationSec: 3 }],
  subtitles: { srtPath, style: buildStyle({ fontSize: 18, marginBottom: 40 }) },
})
const rendered = await renderPlan(plan, { tools, outDir: workDir })

const script = {
  title: '秋日通勤三件套',
  narration: [{ id: 's1', text: '秋天最怕的是什么？' }],
  description: '简介',
  hashtags: ['#穿搭', '#通勤'],
  coverText: { main: '三件套', sub: '不显胖' },
}
const itemDir = workDir
const report = await validateItem({
  tools, itemDir,
  ctx: { script, plan, masterPath: rendered.masterPath, cover: cover.files, voicePath },
})
console.log('  summary:', JSON.stringify(report.summary), report.status)
check('校验产出报告', report.version === 1 && Array.isArray(report.checks))
check('正常成片通过或仅告警', report.status === 'passed' || report.status === 'warning', report.errors.map((e) => `${e.id}:${e.detail}`).join('；'))
check('分辨率检查存在', report.checks.some((c) => c.id === 'L2.resolution' && c.status === 'passed'))
check('时长检查存在', report.checks.some((c) => c.id === 'L2.duration'))
check('音量检查存在', report.checks.some((c) => c.id === 'L2.volume'))
check('三级都覆盖', new Set(report.checks.map((c) => c.level)).size === 3, JSON.stringify([...new Set(report.checks.map((c) => c.level))]))

// 违禁词 → failed
const forbidden = await validateItem({
  tools, itemDir,
  ctx: { script: { ...script, title: '这里有违禁词', narration: [{ id: 's1', text: '包含违禁词的内容' }] }, plan, masterPath: rendered.masterPath, cover: cover.files },
  rules: { forbiddenWords: ['违禁词'] },
})
check('违禁词判失败', forbidden.status === 'failed')
check('失败项可定位', forbidden.errors.some((e) => e.id === 'L3.forbidden'))

// 缺成片 → failed
const missing = await validateItem({
  tools, itemDir,
  ctx: { script, plan, masterPath: join(workDir, 'nope.mp4'), cover: cover.files },
})
check('缺成片判失败', missing.status === 'failed' && missing.errors.some((e) => e.id === 'L1.master'))

// 标题过长 → warning 不阻断
const longTitle = await validateItem({
  tools, itemDir,
  ctx: { script: { ...script, title: '标'.repeat(DEFAULT_RULES.maxTitleLength + 5) }, plan, masterPath: rendered.masterPath, cover: cover.files, voicePath },
})
check('标题过长只告警', longTitle.status !== 'failed' && longTitle.warnings.some((w) => w.id === 'L3.titleLength'))

// 平台封面尺寸 → 硬失败
const wrongCover = await validateItem({
  tools, itemDir,
  platform: { id: 'test', coverWidth: 1, coverHeight: 1, minDurationSec: 0, maxDurationSec: 999 },
  ctx: { script, plan, masterPath: rendered.masterPath, cover: cover.files, voicePath },
})
check('平台封面尺寸不符判失败', wrongCover.status === 'failed' && wrongCover.errors.some((e) => e.id === 'L2.coverSize'), JSON.stringify(wrongCover.errors))

// 平台时长区间 → 硬失败（没有平台时同一项只警告）
const shortForPlatform = await validateItem({
  tools, itemDir,
  platform: { id: 'test', coverWidth: 1080, coverHeight: 1920, minDurationSec: 10, maxDurationSec: 20 },
  ctx: { script, plan, masterPath: rendered.masterPath, cover: cover.files, voicePath },
})
check('平台时长区间不符判失败', shortForPlatform.status === 'failed' && shortForPlatform.errors.some((e) => e.id === 'L2.durationRange'), JSON.stringify(shortForPlatform.errors))
check('报告带平台 id', shortForPlatform.platform === 'test')

/* ---------------- 图片素材探测 ---------------- */
const imgDir = await mkdtemp(join(tmpdir(), 'cs-img-'))
await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=navy:s=540x960:d=1', '-frames:v', '1', join(imgDir, 'still.png')])
const imgScan = await scanMaterials({ dirs: [imgDir], tools })
const still = imgScan.index.entries.find((entry) => entry.path.endsWith('still.png'))
check('图片被识别为 image', still?.kind === 'image', JSON.stringify(still?.kind))
check('图片记录到尺寸', still?.width === 540 && still?.height === 960, `${still?.width}x${still?.height}`)
check('图片时长记为 0', still?.durationSec === 0, String(still?.durationSec))
await rm(imgDir, { recursive: true, force: true })

await rm(root, { recursive: true, force: true })
await rm(coverDir, { recursive: true, force: true })
await rm(workDir, { recursive: true, force: true })
await rm(process.env.CONTENT_STUDIO_HOME, { recursive: true, force: true })

console.log(`\nALL MEDIA CHECKS PASSED (${passed})`)
