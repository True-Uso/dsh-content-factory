/**
 * Platform presets (SPEC FR-01 / 2026-11-04 alignment).
 *
 * v1 deliberately reuses the values the renderer has already been verified
 * with; per-platform differences start as title-length hints and can be tuned
 * later without changing the pipeline.
 */

export const PLATFORMS = [
  {
    id: 'douyin',
    label: '抖音',
    aspectRatio: '9:16',
    targetSec: 26,
    titleMaxLength: 30,
    minDurationSec: 5,
    maxDurationSec: 180,
    coverWidth: 1080,
    coverHeight: 1920,
  },
  {
    id: 'xiaohongshu',
    label: '小红书',
    aspectRatio: '9:16',
    targetSec: 26,
    titleMaxLength: 20,
    minDurationSec: 5,
    maxDurationSec: 180,
    coverWidth: 1080,
    coverHeight: 1920,
  },
  {
    id: 'shipinhao',
    label: '视频号',
    aspectRatio: '9:16',
    targetSec: 26,
    titleMaxLength: 30,
    minDurationSec: 5,
    maxDurationSec: 180,
    coverWidth: 1080,
    coverHeight: 1920,
  },
]

export const DEFAULT_PLATFORM = 'douyin'

export function getPlatform(id) {
  return PLATFORMS.find((platform) => platform.id === id) || PLATFORMS.find((platform) => platform.id === DEFAULT_PLATFORM)
}

export function listPlatforms() {
  return PLATFORMS.map((platform) => ({ ...platform }))
}

function validIso(value) {
  if (!value) return null
  const stamp = Date.parse(value)
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null
}

/**
 * Fill platform defaults and normalise the new batch fields. Called once when
 * a batch is created, so every downstream step sees the same effective config.
 */
export function normalizeBatchConfig(config = {}) {
  const platform = getPlatform(config.platform)
  const targetSec = Number(config.targetSec)
  const interval = Number(config.publishIntervalMinutes)
  const cap = Number(config.costCap)

  return {
    ...config,
    platform: platform.id,
    aspectRatio: config.aspectRatio || platform.aspectRatio,
    targetSec: Number.isFinite(targetSec) && targetSec > 0 ? targetSec : platform.targetSec,
    publishStartAt: validIso(config.publishStartAt),
    publishIntervalMinutes: Number.isFinite(interval) && interval >= 0 ? interval : 1440,
    reviewMode: config.reviewMode === 'auto' ? 'auto' : 'required',
    costCap: Number.isFinite(cap) && cap > 0 ? cap : null,
    // 平台标题上限只做警告；显式传入的规则优先。
    validationRules: {
      maxTitleLength: platform.titleMaxLength,
      ...(config.validationRules || {}),
    },
  }
}
