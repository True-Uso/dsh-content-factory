/**
 * Usage accounting (SPEC FR-12).
 *
 * We record *measurable* quantities, never invented ones: tokens the provider
 * reported, characters actually synthesised, seconds actually generated, images
 * actually requested. Money is then a multiplication by a price table the user
 * supplies — without a price table the numbers stay zero instead of guessing.
 */

export function emptyUsage() {
  return {
    llmTokens: 0,
    llmCalls: 0,
    ttsCharacters: 0,
    ttsReusedCharacters: 0,
    ttsSeconds: 0,
    ttsCacheHits: 0,
    videoSeconds: 0,
    videoShots: 0,
    imageCount: 0,
  }
}

export function addUsage(target, patch = {}) {
  const next = { ...target }
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    next[key] = (next[key] || 0) + value
  }
  return next
}

export const DEFAULT_PRICING = {
  llmPerMTokens: 0,
  ttsPerKChars: 0,
  videoPerSecond: 0,
  imagePerImage: 0,
  currency: 'CNY',
}

/**
 * @param {object} usage
 * @param {object} pricing 见 DEFAULT_PRICING，单位：元
 */
export function computeCost(usage, pricing = {}) {
  const table = { ...DEFAULT_PRICING, ...pricing }
  const lines = [
    { key: 'llm', label: '文案与剪辑方案', amount: (usage.llmTokens / 1_000_000) * table.llmPerMTokens, quantity: usage.llmTokens, unit: 'token' },
    { key: 'tts', label: '配音', amount: (usage.ttsCharacters / 1000) * table.ttsPerKChars, quantity: usage.ttsCharacters, unit: '字符' },
    { key: 'video', label: '视频生成', amount: usage.videoSeconds * table.videoPerSecond, quantity: usage.videoSeconds, unit: '秒' },
    { key: 'image', label: '封面生图', amount: usage.imageCount * table.imagePerImage, quantity: usage.imageCount, unit: '张' },
  ]
  const total = lines.reduce((sum, line) => sum + line.amount, 0)
  return {
    currency: table.currency,
    total: round4(total),
    lines: lines.map((line) => ({ ...line, amount: round4(line.amount) })),
    priced: Object.entries(table).some(([key, value]) => key !== 'currency' && Number(value) > 0),
  }
}

/** Merge every item's usage into a batch total. */
export function sumUsage(usages = []) {
  return usages.reduce((acc, usage) => addUsage(acc, usage || {}), emptyUsage())
}

function round4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000
}
