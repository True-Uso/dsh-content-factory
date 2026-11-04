import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { validatePlan } from '../edl.js'
import { frameLuma, meanVolumeDb, measureLoudness, probe } from '../ffmpeg.js'

/**
 * Validation (SPEC FR-10).
 *
 * L1 产物完整性 · L2 视频规格 · L3 文案与平台约束
 *
 * Errors block the item from review; warnings surface to the reviewer. The
 * distinction matters: a title that is 3 characters too long should not burn a
 * whole production run, but a silent video must.
 */

export const DEFAULT_RULES = {
  maxTitleLength: 30,
  maxHashtags: 10,
  minDurationSec: 5,
  maxDurationSec: 180,
  loudnessRange: [-16, -12],
  minMeanVolumeDb: -50,
  blackFrameLuma: 12,
  forbiddenWords: [],
}

export async function validateItem(options) {
  const { tools, itemDir, ctx = {}, rules: overrideRules = {} } = options
  const rules = { ...DEFAULT_RULES, ...overrideRules }
  const checks = []
  const add = (id, level, status, detail) => checks.push({ id, level, status, detail })

  /* ---------------- L1: 产物完整性 ---------------- */
  const script = ctx.script
  if (!script || typeof script !== 'object') add('L1.script', 'L1', 'failed', 'script.json 缺失或不可解析')
  else if (!Array.isArray(script.narration) || script.narration.length === 0) add('L1.script', 'L1', 'failed', 'script.narration 为空')
  else add('L1.script', 'L1', 'passed', `${script.narration.length} 句旁白`)

  const plan = ctx.plan
  if (!plan) add('L1.plan', 'L1', 'failed', 'edit-plan.json 缺失')
  else {
    const planCheck = validatePlan(plan)
    add('L1.plan', 'L1', planCheck.ok ? 'passed' : 'failed', planCheck.ok ? `${plan.segments.length} 个镜头` : planCheck.errors.join('；'))
    for (const warning of planCheck.warnings || []) add('L1.plan.warn', 'L1', 'warning', warning)
  }

  const voicePath = ctx.voicePath || join(itemDir, '02-voice', 'voice.wav')
  const voiceSize = await sizeOf(voicePath)
  add('L1.voice', 'L1', voiceSize > 0 ? 'passed' : 'failed', voiceSize > 0 ? `${Math.round(voiceSize / 1024)} KB` : '配音文件缺失')

  const masterPath = ctx.masterPath || join(itemDir, '06-render', 'master.mp4')
  const masterSize = await sizeOf(masterPath)
  add('L1.master', 'L1', masterSize > 0 ? 'passed' : 'failed', masterSize > 0 ? `${(masterSize / 1024 / 1024).toFixed(1)} MB` : '成片缺失')

  const coverFiles = ctx.cover || {}
  const verticalCover = coverFiles.vertical?.path
  const coverSize = verticalCover ? await sizeOf(verticalCover) : 0
  add('L1.cover', 'L1', coverSize > 0 ? 'passed' : 'failed', coverSize > 0 ? `${coverFiles.vertical.w}x${coverFiles.vertical.h}` : '封面缺失')

  /* ---------------- L2: 视频规格 ---------------- */
  if (masterSize > 0 && tools?.ok) {
    let info
    try {
      info = await probe(tools, masterPath)
    } catch (error) {
      add('L2.probe', 'L2', 'failed', `ffprobe 失败：${error.message}`)
      info = null
    }

    if (info) {
      const expected = plan?.resolution
      if (expected) {
        const ok = info.width === expected.w && info.height === expected.h
        add('L2.resolution', 'L2', ok ? 'passed' : 'failed', `${info.width}x${info.height}（期望 ${expected.w}x${expected.h}）`)
      }

      if (plan?.fps) {
        const ok = Math.abs((info.fps || 0) - plan.fps) <= 0.5
        add('L2.fps', 'L2', ok ? 'passed' : 'warning', `${info.fps}（期望 ${plan.fps}）`)
      }

      if (plan?.durationSec) {
        const delta = Math.abs(info.durationSec - plan.durationSec)
        add('L2.duration', 'L2', delta <= 0.5 ? 'passed' : 'failed', `${info.durationSec}s（期望 ${plan.durationSec}s）`)
      }

      add('L2.audioTrack', 'L2', info.hasAudio ? 'passed' : 'failed', info.hasAudio ? info.audioCodec : '没有音频轨')

      const limits = { min: rules.minDurationSec, max: rules.maxDurationSec }
      const inRange = info.durationSec >= limits.min && info.durationSec <= limits.max
      add('L2.durationRange', 'L2', inRange ? 'passed' : 'warning', `${info.durationSec}s 应落在 ${limits.min}–${limits.max}s`)

      if (info.hasAudio) {
        const mean = await meanVolumeDb(tools, masterPath).catch(() => null)
        if (mean === null) add('L2.volume', 'L2', 'warning', '无法测量音量')
        else add('L2.volume', 'L2', mean > rules.minMeanVolumeDb ? 'passed' : 'failed', `均值 ${mean} dBFS`)

        const loudness = await measureLoudness(tools, masterPath).catch(() => null)
        if (!loudness) add('L2.loudness', 'L2', 'warning', '无法测量响度')
        else {
          const [low, high] = rules.loudnessRange
          const ok = loudness.integratedLufs >= low && loudness.integratedLufs <= high
          add('L2.loudness', 'L2', ok ? 'passed' : 'warning', `${loudness.integratedLufs} LUFS（期望 ${low}~${high}）`)
        }
      }

      const headLuma = await frameLuma(tools, masterPath, 0).catch(() => null)
      const tailLuma = await frameLuma(tools, masterPath, Math.max(0, info.durationSec - 0.2)).catch(() => null)
      if (headLuma !== null) add('L2.blackStart', 'L2', headLuma > rules.blackFrameLuma ? 'passed' : 'warning', `首帧亮度 ${headLuma}`)
      if (tailLuma !== null) add('L2.blackEnd', 'L2', tailLuma > rules.blackFrameLuma ? 'passed' : 'warning', `末帧亮度 ${tailLuma}`)
    }
  } else if (!tools?.ok) {
    add('L2.tools', 'L2', 'failed', tools?.error || 'ffmpeg 不可用，无法校验视频规格')
  }

  /* ---------------- L3: 文案与平台约束 ---------------- */
  const title = String(script?.title || '').trim()
  if (!title) add('L3.title', 'L3', 'failed', '标题为空')
  else {
    const length = Array.from(title).length
    add('L3.titleLength', 'L3', length <= rules.maxTitleLength ? 'passed' : 'warning', `${length} 字（上限 ${rules.maxTitleLength}）`)
  }

  const hashtags = Array.isArray(script?.hashtags) ? script.hashtags : []
  add('L3.hashtags', 'L3', hashtags.length <= rules.maxHashtags ? 'passed' : 'warning', `${hashtags.length} 个标签（上限 ${rules.maxHashtags}）`)

  const coverText = String(script?.coverText?.main || '').trim()
  add('L3.coverText', 'L3', coverText ? 'passed' : 'warning', coverText ? coverText : '封面文案缺失')

  const haystack = [title, script?.description, ...(script?.narration || []).map((line) => line?.text)].join('\n')
  const hits = rules.forbiddenWords.filter((word) => word && haystack.includes(word))
  add('L3.forbidden', 'L3', hits.length === 0 ? 'passed' : 'failed', hits.length === 0 ? '未命中违禁词' : `命中：${hits.join('、')}`)

  /* ---------------- 汇总 ---------------- */
  const errors = checks.filter((check) => check.status === 'failed')
  const warnings = checks.filter((check) => check.status === 'warning')
  const status = errors.length > 0 ? 'failed' : warnings.length > 0 ? 'warning' : 'passed'

  return {
    version: 1,
    status,
    generatedAt: Date.now(),
    summary: { total: checks.length, passed: checks.filter((c) => c.status === 'passed').length, warnings: warnings.length, errors: errors.length },
    checks,
    errors: errors.map((check) => ({ id: check.id, detail: check.detail })),
    warnings: warnings.map((check) => ({ id: check.id, detail: check.detail })),
  }
}

async function sizeOf(path) {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}
