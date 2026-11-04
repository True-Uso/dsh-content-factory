/**
 * EDL — the single input the renderer accepts (SPEC FR-07).
 *
 * Keeping the plan separate from the renderer is what makes "re-render one
 * segment" and "same plan, same output" possible. Nothing else is allowed to
 * drive ffmpeg.
 */

export const PLAN_VERSION = 1

export function createPlan(input = {}) {
  const resolution = input.resolution || { w: 1080, h: 1920 }
  const fps = Number(input.fps) || 30
  const voice = input.voice || null
  const shots = Array.isArray(input.shots) ? input.shots : []
  const durationSec = Number(input.durationSec) || (voice && voice.totalSec) || 0

  if (!voice) throw new Error('EDL 需要配音轨')
  if (shots.length === 0) throw new Error('EDL 需要至少一个镜头')
  if (!(durationSec > 0)) throw new Error('EDL 时长必须大于 0')

  const segments = distributeSegments(shots, durationSec, fps)

  return {
    version: PLAN_VERSION,
    createdAt: Date.now(),
    resolution,
    fps,
    durationSec: round3(durationSec),
    audio: {
      voice: { path: voice.path, gain: voice.gain ?? 1 },
      bgm: input.bgm ? { path: input.bgm.path, gain: input.bgm.gain ?? 0.18, duck: input.bgm.duck !== false } : null,
    },
    segments,
    subtitles: input.subtitles || null,
    overlays: input.overlays || [],
    loudness: { target: input.loudnessTarget ?? -14, truePeak: -1.5, lra: 11 },
  }
}

/** Scale shot durations so the visual track exactly covers the voice track. */
export function distributeSegments(shots, durationSec, fps) {
  const weights = shots.map((shot) => Math.max(0.5, Number(shot.durationSec) || 1))
  const totalWeight = weights.reduce((sum, value) => sum + value, 0)
  const frame = 1 / (fps || 30)

  let cursor = 0
  return shots.map((shot, index) => {
    const isLast = index === shots.length - 1
    const raw = (weights[index] / totalWeight) * durationSec
    const duration = isLast ? durationSec - cursor : Math.max(frame * 2, Math.round(raw / frame) * frame)
    const start = round3(cursor)
    cursor = Math.min(durationSec, cursor + duration)
    return {
      id: `seg${index + 1}`,
      startSec: start,
      durationSec: round3(duration),
      source: shot.path,
      kind: shot.kind || 'video',
      inSec: round3(shot.inSec ?? 0),
      speed: Number(shot.speed) || 1,
      transitionOut: index === shots.length - 1 ? null : shot.transitionOut || 'cut',
      intent: shot.intent || '',
    }
  })
}

/** Contract check before a single ffmpeg process is spawned. */
export function validatePlan(plan) {
  const errors = []
  const warnings = []
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['EDL 不是对象'], warnings }
  if (plan.version !== PLAN_VERSION) errors.push(`EDL 版本不符：${plan.version}`)
  if (!plan.resolution || !(plan.resolution.w > 0) || !(plan.resolution.h > 0)) errors.push('resolution 非法')
  if (!(plan.durationSec > 0)) errors.push('durationSec 必须大于 0')
  if (!plan.audio?.voice?.path) errors.push('缺少配音轨')

  const segments = Array.isArray(plan.segments) ? plan.segments : []
  if (segments.length === 0) errors.push('segments 为空')

  let cursor = 0
  segments.forEach((segment, index) => {
    if (!segment.source) errors.push(`segments[${index}].source 缺失`)
    if (!(segment.durationSec > 0)) errors.push(`segments[${index}].durationSec 非法`)
    if (Math.abs(Number(segment.startSec) - cursor) > 0.05) {
      errors.push(`segments[${index}].startSec 不连续（期望 ${round3(cursor)}，实际 ${segment.startSec}）`)
    }
    cursor = Number(segment.startSec) + Number(segment.durationSec)
    if (segment.speed && (segment.speed < 0.25 || segment.speed > 4)) errors.push(`segments[${index}].speed 超出 0.25–4`)
  })

  if (Math.abs(cursor - plan.durationSec) > 0.1) {
    errors.push(`镜头总时长 ${round3(cursor)} 与 durationSec ${plan.durationSec} 不一致`)
  }
  // Subtitles are optional: a batch may legitimately export a clean master.
  if (!plan.subtitles?.srtPath) warnings.push('未提供字幕，成片不会带字幕')

  return { ok: errors.length === 0, errors, warnings }
}

/** Stable hash of the parts that affect pixels — used to skip unchanged renders. */
export function planSignature(plan) {
  const material = JSON.stringify({
    resolution: plan.resolution,
    fps: plan.fps,
    durationSec: plan.durationSec,
    audio: plan.audio,
    subtitles: plan.subtitles,
    loudness: plan.loudness,
    segments: plan.segments.map((s) => [s.source, s.startSec, s.durationSec, s.inSec, s.speed, s.transitionOut]),
  })
  let hash = 5381
  for (let index = 0; index < material.length; index += 1) {
    hash = ((hash << 5) + hash + material.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000
}
