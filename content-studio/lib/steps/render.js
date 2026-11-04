import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { validatePlan } from '../edl.js'
import { ffmpeg, meanVolumeDb, probe, resolveTools } from '../ffmpeg.js'

/**
 * Renderer (SPEC FR-08).
 *
 * Multi-pass on purpose — each pass is debuggable on its own and a failure names
 * the stage instead of dumping one giant filter graph:
 *
 *   pass 1..N  normalise each shot to the target raster (SPEC R1)
 *   pass N+1   concat video only (SPEC R2, cut transitions)
 *   pass N+2   mux voice + BGM with ducking, burn subtitles, normalise loudness
 *              (SPEC R4/R5/R7), write master.mp4
 */

const DEFAULT_FONT = 'Microsoft YaHei'

export class RenderError extends Error {
  constructor(stage, message, detail) {
    super(`[${stage}] ${message}`)
    this.name = 'RenderError'
    this.stage = stage
    this.detail = detail
  }
}

export async function renderPlan(plan, options = {}) {
  const check = validatePlan(plan)
  if (!check.ok) throw new RenderError('validate', `EDL 校验失败：${check.errors.join('；')}`)

  const tools = options.tools || (await resolveTools())
  if (!tools.ok) throw new RenderError('tools', tools.error)

  const workDir = options.outDir
  await mkdir(workDir, { recursive: true })
  const onProgress = options.onProgress || (() => {})

  const { width, height } = { width: plan.resolution.w, height: plan.resolution.h }
  const fps = plan.fps
  const stageTotal = plan.segments.length + 2
  let stageDone = 0

  const advance = (label) => {
    stageDone += 1
    onProgress({ stage: label, progress: Math.min(1, stageDone / stageTotal), done: stageDone, total: stageTotal })
  }

  // ---- pass 1..N: normalise each shot to one raster ----
  const clips = []
  const probeCache = new Map()
  const sourceInfo = async (path) => {
    if (!probeCache.has(path)) probeCache.set(path, await probe(tools, path).catch(() => null))
    return probeCache.get(path)
  }

  for (let index = 0; index < plan.segments.length; index += 1) {
    const segment = plan.segments[index]
    const source = options.resolvePath ? options.resolvePath(segment.source) : segment.source
    const output = `norm-${String(index + 1).padStart(3, '0')}.mp4`
    const speed = segment.speed || 1
    const duration = segment.durationSec / speed

    const filters = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `fps=${fps}`,
      'setsar=1',
      'format=yuv420p',
    ]

    // A source shorter than its slot must be looped, otherwise the normalised clip
    // comes out short and the concat total no longer matches the voice track.
    const info = segment.kind === 'image' ? null : await sourceInfo(source)
    const available = info ? Math.max(0, (info.durationSec || 0) - (segment.inSec || 0)) : Infinity
    const mustLoop = segment.kind !== 'image' && available + 0.05 < duration

    if (speed !== 1 && segment.kind !== 'image') filters.push(`setpts=(PTS-STARTPTS)/${speed}`)

    // Transition: dip to black. A true crossfade shortens the timeline, which fights
    // the hard requirement that total video length equals the voice track.
    const fade = Math.min(0.28, segment.durationSec / 6)
    if (segment.transitionOut === 'fade' && segment.durationSec > fade * 2) {
      filters.push(`fade=t=in:st=0:d=${fade.toFixed(2)}`)
      filters.push(`fade=t=out:st=${(segment.durationSec - fade).toFixed(2)}:d=${fade.toFixed(2)}`)
    }

    const args = ['-hide_banner', '-loglevel', 'error', '-y']
    if (segment.kind === 'image') {
      args.push('-loop', '1', '-t', String(duration), '-i', source)
    } else if (mustLoop) {
      // input-side looping plus output-side seek: -ss before a looped input does not work
      args.push('-stream_loop', '-1', '-i', source, '-ss', String(segment.inSec || 0))
    } else {
      args.push('-ss', String(segment.inSec || 0), '-t', String(duration), '-i', source)
    }

    args.push('-vf', filters.join(','), '-an')
    args.push('-t', String(segment.durationSec), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', output)

    await runStage(tools, args, workDir, 'normalize', `第 ${index + 1} 个镜头`)
    clips.push(output)
    advance('normalize')
  }

  // ---- pass N+1: concat ----
  const listFile = 'concat.txt'
  await writeFile(join(workDir, listFile), clips.map((clip) => `file '${clip}'`).join('\n'), 'utf8')
  const silentVideo = 'video.mp4'
  await runStage(
    tools,
    ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', silentVideo],
    workDir,
    'concat',
    '拼接镜头',
  )
  advance('concat')

  // ---- pass N+2: audio + subtitles + loudness ----
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', silentVideo]
  const voicePath = options.resolvePath ? options.resolvePath(plan.audio.voice.path) : plan.audio.voice.path
  args.push('-i', voicePath)

  const hasBgm = Boolean(plan.audio.bgm?.path)
  if (hasBgm) {
    const bgmPath = options.resolvePath ? options.resolvePath(plan.audio.bgm.path) : plan.audio.bgm.path
    args.push('-stream_loop', '-1', '-i', bgmPath)
  }

  // Subtitles are burned inside the same filter graph: ffmpeg refuses -vf on a
  // stream that a -filter_complex already maps.
  const filters = []
  let videoMap = '0:v'
  if (plan.subtitles?.assPath || plan.subtitles?.srtPath) {
    // ASS carries its own PlayRes, so the font size means pixels. SRT + force_style
    // would be scaled by libass' default PlayResY of 288 and blow up on 1080p.
    const useAss = Boolean(plan.subtitles.assPath)
    const source = options.resolvePath
      ? options.resolvePath(useAss ? plan.subtitles.assPath : plan.subtitles.srtPath)
      : useAss
        ? plan.subtitles.assPath
        : plan.subtitles.srtPath
    const target = useAss ? 'subs.ass' : 'subs.srt'
    await copyFile(source, join(workDir, target))
    const filter = useAss
      ? `subtitles=filename='${target}':fontsdir='C\\:/Windows/Fonts'`
      : subtitleFilter(target, plan.subtitles.style, plan.subtitles.font || DEFAULT_FONT, plan.resolution.h)
    filters.push(`[0:v]${filter}[v]`)
    videoMap = '[v]'
  }
  if (hasBgm) {
    const gain = clampNumber(plan.audio.bgm.gain, 0, 1, 0.18)
    filters.push(`[2:a]volume=${gain},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[bgm]`)
    filters.push('[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asplit=2[voice][key]')
    filters.push('[bgm][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked]')
    filters.push('[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0[aout]')
  } else {
    filters.push('[1:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]')
  }
  filters.push(`[aout]loudnorm=I=${plan.loudness?.target ?? -14}:TP=${plan.loudness?.truePeak ?? -1.5}:LRA=${plan.loudness?.lra ?? 11}[a]`)

  args.push('-filter_complex', filters.join(';'))
  args.push('-map', videoMap, '-map', '[a]')
  if (videoMap === '0:v') args.push('-c:v', 'copy')
  else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20')
  args.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', 'master.mp4')

  await runStage(tools, args, workDir, 'mux', '混音与烧字幕')
  advance('mux')

  const masterPath = join(workDir, 'master.mp4')
  const info = await probe(tools, masterPath)
  const volume = await meanVolumeDb(tools, masterPath).catch(() => null)

  await rm(join(workDir, listFile), { force: true }).catch(() => {})

  return {
    masterPath,
    durationSec: info.durationSec,
    width: info.width,
    height: info.height,
    fps: info.fps,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    hasAudio: info.hasAudio,
    meanVolumeDb: volume,
    bytes: info.bitrate ? null : undefined,
    clips,
  }
}

function subtitleFilter(srtName, style = {}, fontName = DEFAULT_FONT, videoHeight = 1920) {
  // libass treats SRT styles in a 288-high coordinate space unless told otherwise.
  const scale = 288 / (videoHeight || 288)
  const force = [
    `FontName=${fontName}`,
    `Fontsize=${Math.max(6, Math.round((style.fontSize ?? 22) * scale))}`,
    `PrimaryColour=${style.primaryColor || '&H00FFFFFF'}`,
    `OutlineColour=${style.outlineColor || '&H00000000'}`,
    `BorderStyle=1`,
    `Outline=${Math.max(1, Math.round((style.outline ?? 3) * scale))}`,
    `Shadow=${style.shadow ?? 1}`,
    `Alignment=2`,
    `MarginV=${Math.max(8, Math.round((style.marginBottom ?? 60) * scale))}`,
  ].join(',')
  // quoted filter argument; names here are ASCII by construction (norm-###.mp4 / subs.srt)
  return `subtitles=filename='${srtName}':force_style='${force}':fontsdir='C\\:/Windows/Fonts'`
}

async function runStage(tools, args, cwd, stage, label) {
  try {
    await ffmpeg(tools, args, { cwd, timeout: 15 * 60 * 1000 })
  } catch (error) {
    throw new RenderError(stage, `${label}失败：${error.message}`, String(error.stderr || '').slice(-1500))
  }
}

/** Cheap preview frame for the review page. */
export async function extractThumbnail(tools, masterPath, outPath, atSec = 1) {
  await ffmpeg(
    tools,
    ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(atSec), '-i', masterPath, '-frames:v', '1', '-q:v', '3', outPath],
    { timeout: 60000 },
  )
  return outPath
}

/** Convert the assembled WAV to the mp3 the spec ships in the item folder. */
export async function wavToMp3(tools, wavPath, mp3Path) {
  await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavPath, '-c:a', 'libmp3lame', '-b:a', '192k', mp3Path], {
    timeout: 120000,
  })
  return mp3Path
}

export async function readPlan(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export function relativeTo(dir, file) {
  return relative(dir, file).replace(/\\/g, '/')
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export { join }
