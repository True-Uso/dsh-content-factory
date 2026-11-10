import { getPlatform, normalizeBatchConfig } from './platforms.js'

/**
 * Turn a one-line brief into a batch plan. The LLM is optional: the local
 * parser is the fallback and also the contract the LLM result is merged into,
 * so the confirmation card always has a complete config.
 */

const PLATFORM_WORDS = [
  ['抖音', 'douyin'],
  ['小红书', 'xiaohongshu'],
  ['视频号', 'shipinhao'],
  ['TikTok', 'tiktok'],
  ['tiktok', 'tiktok'],
  ['Instagram', 'instagram'],
  ['Reels', 'instagram'],
  ['YouTube', 'youtube'],
  ['Shorts', 'youtube'],
  ['LinkedIn', 'linkedin'],
]

function clampInt(value, min, max) {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, number))
}

function detectPlatform(text) {
  for (const [word, id] of PLATFORM_WORDS) if (text.includes(word)) return id
  return null
}

function detectCount(text) {
  const match = /(\d+)\s*(条|个|支|期)/.exec(text)
  return match ? Number(match[1]) : null
}

function detectSeconds(text) {
  const match = /(\d+)\s*(秒|s\b|sec\b)/i.exec(text)
  return match ? Number(match[1]) : null
}

function detectBudget(text) {
  const match = /(?:预算|成本上限|花费)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/.exec(text)
  return match ? Number(match[1]) : null
}

function nextAt(hour, minute) {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString()
}

function detectSchedule(text) {
  const time = /(\d{1,2})\s*[:：点]\s*(\d{0,2})/.exec(text)
  const explicit = /(?:每天|每日|每周)/.test(text) || /(\d{1,2})\s*[:：点]\s*(\d{0,2})\s*(?:发|发布)/.test(text)
  if (!time || !explicit) {
    if (/每小时/.test(text)) return { start: nextAt(new Date().getHours() + 1, 0), interval: 60 }
    const interval = /每隔?\s*(\d+)\s*分钟/.exec(text)
    if (interval) return { start: null, interval: Number(interval[1]) }
    return null
  }
  const hour = Math.min(23, Math.max(0, Number(time[1])))
  const minute = Math.min(59, Math.max(0, Number(time[2] || 0)))
  const interval = /每小时/.test(text) ? 60 : /每隔?\s*(\d+)\s*分钟/.test(text) ? Number(/(\d+)\s*分钟/.exec(text)[1]) : 1440
  return { start: nextAt(hour, minute), interval }
}

function cleanTopic(text) {
  const topic = text
    .replace(/^(帮我|请|麻烦)?\s*(做|生成|制作|批量生产|生产)?\s*/, '')
    .replace(/\d+\s*(条|个|支|期)/g, '')
    .replace(/[一二三四五六七八九十两]+\s*(条|个|支|期)/g, '')
    .replace(/抖音|小红书|视频号|TikTok|tiktok|Instagram|Reels|YouTube|Shorts|LinkedIn/g, '')
    .replace(/(每天|每日)\s*\d{1,2}\s*[:：点]\s*\d{0,2}/g, '')
    .replace(/\d{1,2}\s*[:：点]\s*\d{0,2}\s*(发|发布)/g, '')
    .replace(/(预算|成本上限|花费)\s*[¥￥]?\s*\d+(?:\.\d+)?\s*元?/g, '')
    .replace(/\d+\s*(秒|s\b|sec\b)/gi, '')
    .replace(/自动放行|自动审核|免审|不需审核|需人工审核|人工审核/g, '')
    .replace(/主题是|主题[:：]/g, '')
    .replace(/(^|\s)(发|发布|上传)(\s|$)/g, ' ')
    .replace(/\b视频\b/g, '')
    .replace(/[，,。；;、]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return topic || text.trim()
}

function localPlan(text, overrides = {}) {
  const platformId = overrides.platform || detectPlatform(text) || 'douyin'
  const platform = getPlatform(platformId)
  const count = clampInt(overrides.count ?? detectCount(text) ?? 5, 1, 200)
  const seconds = detectSeconds(text)
  const budget = detectBudget(text)
  const schedule = detectSchedule(text)
  const reviewMode = overrides.reviewMode || (/自动|直接发|免审|不需审核/.test(text) ? 'auto' : 'required')
  const topic = cleanTopic(text)

  const config = normalizeBatchConfig({
    platform: platform.id,
    topic,
    targetSec: seconds || platform.targetSec,
    reviewMode,
    publishStartAt: schedule?.start || null,
    publishIntervalMinutes: schedule?.interval ?? 1440,
    costCap: budget,
    materialMode: 'pool',
    shotCount: 8,
  })

  const assumptions = []
  if (!detectCount(text)) assumptions.push(`未指定条数，默认 ${count} 条`)
  if (!detectPlatform(text)) assumptions.push(`未指定平台，默认${platform.label}`)
  if (!seconds) assumptions.push(`未指定时长，按平台默认 ${platform.targetSec} 秒`)
  if (!schedule) assumptions.push('未指定发布时间，先不排期')
  if (!budget) assumptions.push('未设置成本上限')

  const summary = `准备生产 ${count} 条${platform.label}内容，主题「${topic}」，${reviewMode === 'auto' ? '自动放行' : '需人工审核'}。`
  return {
    source: 'local',
    count,
    config,
    plan: { summary, assumptions, warnings: [] },
  }
}

const SYSTEM_PROMPT = `你是短视频批量生产助手。把用户的一句话需求解析成 JSON，只输出 JSON，不要解释。
字段：
{
  "topic": "内容主题（去掉数量、平台、时间、预算等指令）",
  "count": 1-200 的整数,
  "platform": "douyin" | "xiaohongshu" | "shipinhao",
  "targetSec": 正整数，单条目标秒数,
  "reviewMode": "required" | "auto",
  "publishStartAt": ISO 8601 或 null,
  "publishIntervalMinutes": 非负整数,
  "costCap": 正数或 null,
  "summary": "一句中文摘要，说明你理解的生产计划",
  "assumptions": ["你补充的默认值，最多 4 条"]
}
用户没说的字段按常识补默认值，并在 assumptions 里说明。`

function mergeLlm(data, local, overrides = {}) {
  const source = data && typeof data === 'object' ? data : {}
  const platform = getPlatform(overrides.platform || source.platform || local.config.platform)
  const count = clampInt(overrides.count ?? source.count ?? local.count, 1, 200)
  const reviewMode = overrides.reviewMode || (source.reviewMode === 'auto' ? 'auto' : 'required')
  const seconds = Number(source.targetSec)
  const interval = Number(source.publishIntervalMinutes)
  const cap = Number(source.costCap)
  const start = source.publishStartAt ? Date.parse(source.publishStartAt) : NaN

  const config = normalizeBatchConfig({
    ...local.config,
    platform: platform.id,
    topic: typeof source.topic === 'string' && source.topic.trim() ? source.topic.trim() : local.config.topic,
    targetSec: Number.isFinite(seconds) && seconds > 0 ? seconds : local.config.targetSec,
    reviewMode,
    publishStartAt: Number.isFinite(start) ? new Date(start).toISOString() : local.config.publishStartAt,
    publishIntervalMinutes: Number.isFinite(interval) && interval >= 0 ? interval : local.config.publishIntervalMinutes,
    costCap: Number.isFinite(cap) && cap > 0 ? cap : local.config.costCap,
    materialMode: 'pool',
    shotCount: 8,
  })

  const assumptions = Array.isArray(source.assumptions)
    ? source.assumptions.map(String).filter(Boolean).slice(0, 4)
    : local.plan.assumptions
  const summary = typeof source.summary === 'string' && source.summary.trim()
    ? source.summary.trim()
    : `准备生产 ${count} 条${platform.label}内容，主题「${config.topic}」。`

  return {
    source: 'llm',
    count,
    config,
    plan: { summary, assumptions, warnings: [] },
  }
}

/**
 * @param {{brief: string, overrides?: object, llm?: object}} options
 */
export async function parseBrief(options = {}) {
  const text = String(options.brief || '').trim()
  const local = localPlan(text, options.overrides || {})
  if (!options.llm) return local

  try {
    const out = await options.llm.complete({
      system: SYSTEM_PROMPT,
      user: text,
      json: true,
      temperature: 0.2,
      maxTokens: 600,
    })
    if (!out?.json || typeof out.json !== 'object') throw new Error('AI 没有返回 JSON')
    return mergeLlm(out.json, local, options.overrides || {})
  } catch (error) {
    return {
      ...local,
      plan: {
        ...local.plan,
        warnings: [`AI 解析失败，已用本地规则：${error.message}`],
      },
    }
  }
}
