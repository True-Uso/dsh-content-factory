import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * FFmpeg resolution order (SPEC §13):
 *   1. explicit config path
 *   2. CONTENT_STUDIO_FFMPEG / CONTENT_STUDIO_FFPROBE env
 *   3. PATH
 *   4. <workspace>/tools/bin (the development static build)
 *   5. common Windows install locations
 */
const CACHE = new Map()

function candidates(name, explicit, extras = []) {
  const fileName = `${name}.exe`
  const list = []
  if (explicit) list.push(explicit)
  const env = process.env[name === 'ffmpeg' ? 'CONTENT_STUDIO_FFMPEG' : 'CONTENT_STUDIO_FFPROBE']
  if (env) list.push(env)
  const envDir = process.env.CONTENT_STUDIO_FFMPEG_DIR
  if (envDir) list.push(join(envDir, fileName))
  list.push(name)

  // The plugin's own location: cwd inside the Harness process is the install dir,
  // not the workspace, so relative-to-cwd lookup alone fails in production.
  try {
    let base = dirname(fileURLToPath(import.meta.url))
    for (let depth = 0; depth < 4; depth += 1) {
      list.push(join(base, 'bin', fileName))
      list.push(join(base, 'tools', 'bin', fileName))
      const parent = dirname(base)
      if (parent === base) break
      base = parent
    }
  } catch {
    // ignore: resolution continues with the other candidates
  }

  // walk up from cwd so a workspace-level tools/bin is found during development
  let dir = process.cwd()
  for (let depth = 0; depth < 4; depth += 1) {
    list.push(join(dir, 'tools', 'bin', fileName))
    list.push(join(dir, 'bin', fileName))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // npm-installed platform binary (ADR 0003); explicit/PATH/workspace still win.
  for (const extra of extras) if (extra) list.push(extra)

  if (process.env.CONTENT_STUDIO_HOME) list.push(join(process.env.CONTENT_STUDIO_HOME, 'bin', fileName))
  list.push(join(homedir(), '.content-studio', 'bin', fileName))
  return [...new Set(list.filter(Boolean))]
}

async function installerPath(pkg) {
  try {
    const mod = await import(pkg)
    const value = mod?.default || mod
    return typeof value?.path === 'string' ? value.path : null
  } catch {
    return null
  }
}

async function works(command) {
  try {
    await run(command, ['-version'], { timeout: 15000 })
    return true
  } catch {
    return false
  }
}

/** Resolve both binaries once per process. Returns `{ ffmpeg, ffprobe, ok, error }`. */
export async function resolveTools(config = {}) {
  const key = `${config.ffmpegPath || ''}|${config.ffprobePath || ''}`
  if (CACHE.has(key)) return CACHE.get(key)

  const result = { ffmpeg: null, ffprobe: null, ok: false, error: null, searched: [] }
  const [ffmpegInstalled, ffprobeInstalled] = await Promise.all([
    installerPath('@ffmpeg-installer/ffmpeg'),
    installerPath('@ffprobe-installer/ffprobe'),
  ])
  for (const candidate of candidates('ffmpeg', config.ffmpegPath, [ffmpegInstalled])) {
    result.searched.push(candidate)
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (!existsSync(candidate)) continue
    }
    if (await works(candidate)) {
      result.ffmpeg = candidate
      break
    }
  }
  for (const candidate of candidates('ffprobe', config.ffprobePath, [ffprobeInstalled])) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (!existsSync(candidate)) continue
    }
    if (await works(candidate)) {
      result.ffprobe = candidate
      break
    }
  }
  result.ok = Boolean(result.ffmpeg && result.ffprobe)
  if (!result.ok) {
    result.error =
      '找不到 ffmpeg/ffprobe。请安装 ffmpeg 并加入 PATH，或在设置里指定路径（环境变量 CONTENT_STUDIO_FFMPEG / CONTENT_STUDIO_FFPROBE 亦可）。'
  }
  CACHE.set(key, result)
  return result
}

export function clearToolCache() {
  CACHE.clear()
}

/** Run ffmpeg with an argv array; never a shell string. */
export async function ffmpeg(tools, args, options = {}) {
  if (!tools.ok) throw new Error(tools.error)
  return run(tools.ffmpeg, args, {
    timeout: options.timeout ?? 10 * 60 * 1000,
    maxBuffer: 8 * 1024 * 1024,
    cwd: options.cwd,
  })
}

/** ffprobe one file into the fields the pipeline needs. */
export async function probe(tools, file) {
  if (!tools.ok) throw new Error(tools.error)
  const { stdout } = await run(
    tools.ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
  )
  const data = JSON.parse(stdout)
  const video = (data.streams || []).find((s) => s.codec_type === 'video')
  const audio = (data.streams || []).find((s) => s.codec_type === 'audio')
  const duration = Number(data.format?.duration) || Number(video?.duration) || 0
  const fps = parseFps(video?.avg_frame_rate || video?.r_frame_rate)
  return {
    path: file,
    name: basename(file),
    durationSec: round(duration, 3),
    width: video?.width ? Number(video.width) : null,
    height: video?.height ? Number(video.height) : null,
    fps,
    videoCodec: video?.codec_name || null,
    audioCodec: audio?.codec_name || null,
    hasAudio: Boolean(audio),
    bitrate: Number(data.format?.bit_rate) || null,
    kind: video ? 'video' : audio ? 'audio' : 'other',
  }
}

function parseFps(text) {
  if (!text || typeof text !== 'string') return null
  const [num, den] = text.split('/').map(Number)
  if (!num) return null
  if (!den) return num
  return round(num / den, 3)
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Mean volume in dBFS, used by L2 validation to catch silent audio. */
export async function meanVolumeDb(tools, file) {
  if (!tools.ok) throw new Error(tools.error)
  try {
    const { stderr } = await run(
      tools.ffmpeg,
      ['-hide_banner', '-nostats', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
      { timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
    )
    const match = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(stderr || '')
    return match ? Number(match[1]) : null
  } catch (error) {
    const text = String(error?.stderr || error?.message || '')
    const match = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(text)
    return match ? Number(match[1]) : null
  }
}

/** Integrated loudness (LUFS) and true peak from a single analysis pass. */
export async function measureLoudness(tools, file) {
  if (!tools.ok) throw new Error(tools.error)
  const args = [
    '-hide_banner', '-nostats', '-i', file,
    '-af', 'loudnorm=print_format=json',
    '-f', 'null', '-',
  ]
  let text = ''
  try {
    const result = await run(tools.ffmpeg, args, { timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
    text = result.stderr || ''
  } catch (error) {
    text = String(error?.stderr || '')
  }
  const block = /\{[\s\S]*?"input_i"[\s\S]*?\}/.exec(text)
  if (!block) return null
  try {
    const data = JSON.parse(block[0])
    return {
      integratedLufs: Number(data.input_i),
      truePeak: Number(data.input_tp),
      lra: Number(data.input_lra),
    }
  } catch {
    return null
  }
}

/** Average luma (0–255) of one frame — catches a black first/last frame. */
export async function frameLuma(tools, file, atSec = 0) {
  if (!tools.ok) throw new Error(tools.error)
  const args = [
    '-hide_banner', '-nostats',
    '-ss', String(Math.max(0, atSec)), '-i', file,
    '-frames:v', '1',
    '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG',
    '-f', 'null', '-',
  ]
  let text = ''
  try {
    const result = await run(tools.ffmpeg, args, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 })
    text = result.stderr || ''
  } catch (error) {
    text = String(error?.stderr || '')
  }
  const match = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(text)
  return match ? Number(match[1]) : null
}

/** True when the built-in filters the renderer relies on exist. */
export async function checkCapabilities(tools) {
  if (!tools.ok) return { ok: false, missing: ['ffmpeg'], error: tools.error }
  try {
    const { stdout } = await run(tools.ffmpeg, ['-hide_banner', '-filters'], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 })
    const required = ['drawtext', 'subtitles', 'sidechaincompress', 'loudnorm', 'signalstats', 'xfade']
    const missing = required.filter((name) => !new RegExp(`\\b${name}\\b`).test(stdout))
    return { ok: missing.length === 0, missing }
  } catch (error) {
    return { ok: false, missing: [], error: error.message }
  }
}
