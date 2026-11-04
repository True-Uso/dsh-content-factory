import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dataDir } from '../store.js'
import { parseWav, silence, writeWav } from '../wav.js'

/**
 * Voice step (SPEC FR-04).
 *
 * One TTS request per narration sentence, then a PCM concatenation with a fixed
 * gap. Sentence-level timing is therefore *measured*, not estimated — which is
 * what makes the subtitle track line up without a provider timestamp API.
 *
 * 接口不返回整段总时长，最后一条字幕的 end_time 也不等于总长（SPEC FR-04），
 * 所以总长一律由拼装结果计算，不采信任何返回字段。
 */

export function voiceCacheDir() {
  return join(dataDir(), 'voice-cache')
}

export function cacheKey({ text, voice, speed }) {
  return createHash('sha1').update(`${voice}|${speed}|${text}`).digest('hex')
}

/**
 * @param {object} options
 * @param {{synthesize: Function}} options.tts
 * @param {Array<{sid: string, text: string}>} options.narration
 * @param {string} options.outDir
 * @param {string} options.voice
 * @param {number} [options.speed]
 * @param {number} [options.gapMs]
 * @param {boolean} [options.useCache]
 */
export async function synthesizeVoice(options) {
  const {
    tts,
    narration = [],
    outDir,
    voice,
    speed = 1,
    gapMs = 180,
    useCache = true,
    signal,
    onProgress,
  } = options

  if (!Array.isArray(narration) || narration.length === 0) throw new Error('旁白为空，无法配音')
  await mkdir(outDir, { recursive: true })
  await mkdir(voiceCacheDir(), { recursive: true })

  const pieces = []
  const segments = []
  let format = null
  let cacheHits = 0
  let synthesizedCharacters = 0
  let reusedCharacters = 0

  for (let index = 0; index < narration.length; index += 1) {
    const line = narration[index]
    const text = String(line?.text || '').trim()
    if (!text) continue

    const key = cacheKey({ text, voice, speed })
    const cachePath = join(voiceCacheDir(), `${key}.wav`)
    let buffer = null
    let wav = null

    if (useCache) {
      try {
        const cached = await readFile(cachePath)
        wav = parseWav(cached)
        buffer = cached
        cacheHits += 1
        reusedCharacters += charCount(text)
      } catch {
        // missing OR half-written cache entry: treat as a miss and re-synthesise
        buffer = null
        wav = null
      }
    }

    if (!buffer) {
      const result = await tts.synthesize({ text, voice, speed, signal })
      buffer = Buffer.isBuffer(result.audio) ? result.audio : Buffer.from(result.audio)
      wav = parseWav(buffer)
      synthesizedCharacters += charCount(text)
      if (useCache) {
        // atomic: two items in one batch often share the same sentence
        const tempPath = `${cachePath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
        await writeFile(tempPath, buffer)
          .then(() => rename(tempPath, cachePath))
          .catch(() => {})
      }
    }

    if (!format) format = { sampleRate: wav.sampleRate, channels: wav.channels, bitsPerSample: wav.bitsPerSample }
    else if (
      wav.sampleRate !== format.sampleRate ||
      wav.channels !== format.channels ||
      wav.bitsPerSample !== format.bitsPerSample
    ) {
      throw new Error(
        `配音片段格式不一致：期望 ${format.sampleRate}Hz/${format.channels}ch/${format.bitsPerSample}bit，` +
          `第 ${index + 1} 句是 ${wav.sampleRate}Hz/${wav.channels}ch/${wav.bitsPerSample}bit`,
      )
    }

    pieces.push(wav.data)
    segments.push({ sid: line.sid || `s${index + 1}`, text, durationSec: wav.durationSec, pcm: wav.data })
    onProgress?.({ index: index + 1, total: narration.length, sid: line.sid })
  }

  if (segments.length === 0) throw new Error('没有可配音的句子')

  const gap = silence({ ...format, durationSec: gapMs / 1000 })
  const parts = []
  let cursorSec = 0
  const timeline = []

  segments.forEach((segment, index) => {
    if (index > 0) {
      parts.push(gap)
      cursorSec += gapMs / 1000
    }
    parts.push(segment.pcm)
    const start = cursorSec
    const end = cursorSec + segment.durationSec
    timeline.push({ sid: segment.sid, text: segment.text, start: round3(start), end: round3(end) })
    cursorSec = end
  })

  const pcm = Buffer.concat(parts)
  const wavBuffer = writeWav({ ...format, data: pcm })
  const wavPath = join(outDir, 'voice.wav')
  await writeFile(wavPath, wavBuffer)

  // write the per-sentence audio too, so a single sentence can be re-synthesised
  for (let index = 0; index < segments.length; index += 1) {
    await writeFile(join(outDir, `seg-${String(index + 1).padStart(3, '0')}.wav`), segments[index].pcm)
  }

  const totalSec = round3(pcm.length / (format.sampleRate * format.channels * (format.bitsPerSample / 8)))

  return {
    wavPath,
    totalSec,
    segments: timeline,
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitsPerSample: format.bitsPerSample,
    cacheHits,
    synthesizedCharacters,
    reusedCharacters,
    gapMs,
  }
}

function charCount(text) {
  return Array.from(String(text || '')).length
}

/**
 * 配音缓存会无限增长（每句一个 WAV）。启动时清掉一个月前的和残留的临时文件，
 * 只按时间清理、不按数量淘汰——按数量淘汰会删掉最近还在用的热门句子。
 */
export async function pruneVoiceCache({ maxAgeDays = 30 } = {}) {
  const dir = voiceCacheDir()
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return { removed: 0, kept: 0 }
  }
  const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000
  let removed = 0
  let kept = 0
  for (const name of names) {
    const full = join(dir, name)
    try {
      const info = await stat(full)
      if (!info.isFile()) continue
      if (name.endsWith('.tmp') || info.mtimeMs < cutoff) {
        await unlink(full)
        removed += 1
      } else {
        kept += 1
      }
    } catch {
      // 并发访问导致的状态变化，忽略
    }
  }
  return { removed, kept }
}

/** Confirm the assembled file on disk matches what we computed. */export async function verifyVoiceFile(wavPath, expectedSec, tolerance = 0.05) {
  const info = await stat(wavPath)
  const wav = parseWav(await readFile(wavPath))
  const delta = Math.abs(wav.durationSec - expectedSec)
  return {
    ok: info.size > 0 && delta <= Math.max(0.05, expectedSec * tolerance),
    sizeBytes: info.size,
    actualSec: round3(wav.durationSec),
    expectedSec,
    deltaSec: round3(delta),
  }
}

function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000
}
