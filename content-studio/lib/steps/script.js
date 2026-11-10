/**
 * Script step (SPEC FR-03).
 *
 * The LLM writes the narration and the shot list; this module owns the contract
 * (what a valid script is) so a bad generation never reaches the renderer.
 */

/** Chinese speech lands around 4.5 characters per second at speed 1.0. */
export const CHARS_PER_SECOND = 4.5

export const SCRIPT_SYSTEM_PROMPT = `你是一个短视频内容策划。你只输出 JSON，不输出任何解释。

输出结构：
{
  "title": "标题，≤ 30 字",
  "hook": "开头 3 秒钩子语",
  "narration": [{ "id": "s1", "text": "一句口播，口语化，一句不超过 30 字" }],
  "description": "视频简介，≤ 100 字",
  "hashtags": ["#标签1", "#标签2"],
  "coverText": { "main": "封面主文案，≤ 6 字", "sub": "封面副文案，≤ 12 字" },
  "coverPrompt": "英文生图提示词，描述场景与构图，画面里不要出现任何文字",
  "shotList": [{ "id": "shot1", "intent": "这一个镜头拍什么", "source": "generate 或 library", "durationSec": 4 }]
}

硬性要求：
- narration 每句独立可配音，不要编号、不要括号说明。
- shotList 的 durationSec 之和要接近配音总时长。
- 画面里不要出现文字、水印、字幕。
- 只输出 JSON。`

/** Build the user prompt from the batch configuration. */
export function buildScriptPrompt(input = {}) {
  const {
    topic = '',
    style = '',
    targetSec = 35,
    aspectRatio = '9:16',
    groups = [],
    materialCount = 0,
    shotCount = 8,
    avoidTitles = [],
    revision,
  } = input

  const lines = [
    `主题：${topic}`,
    `目标时长：${Math.round(targetSec)} 秒左右（±20% 可接受）`,
    `画幅：${aspectRatio}`,
    `镜头数量：约 ${shotCount} 个`,
  ]
  if (style) lines.push(`风格要求：${style}`)
  if (groups.length > 0) lines.push(`素材库现有分类：${groups.join('、')}（library 镜头的 intent 请落在这些分类上）`)
  if (materialCount > 0) lines.push(`素材库可用素材约 ${materialCount} 个`)
  if (avoidTitles.length > 0) lines.push(`避免与这些已用标题重复：${avoidTitles.slice(0, 10).join(' / ')}`)
  if (revision && (revision.reason || revision.note || revision.previous)) {
    lines.push('上次被驳回，必须按审核意见改写整条脚本（口播、镜头、封面都改到位），不要只改标题，也不要原样照抄上一版。')
    if (revision.reason) lines.push(`驳回原因：${revision.reason}`)
    if (revision.note) lines.push(`修改要求：${revision.note}`)
    if (revision.previous) {
      const prev = revision.previous
      if (prev.title) lines.push(`上一版标题：${prev.title}`)
      if (Array.isArray(prev.narration) && prev.narration.length) lines.push(`上一版口播：${prev.narration.join('/')}`)
      if (Array.isArray(prev.shots) && prev.shots.length) lines.push(`上一版镜头：${prev.shots.join('/')}`)
    }
  }
  lines.push('请按系统提示的 JSON 结构输出这一条视频的完整脚本。')
  return lines.join('\n')
}

/** Estimated spoken length of a Chinese sentence. */
export function estimateSeconds(text, speed = 1) {
  const chars = Array.from(String(text || '')).filter((char) => char.trim() !== '').length
  return Math.round((chars / (CHARS_PER_SECOND * (speed || 1))) * 100) / 100
}

/**
 * Validate a generated script against the contract.
 * Returns `{ ok, errors, warnings, durationSec }`.
 */
export function validateScript(script, options = {}) {
  const targetSec = Number(options.targetSec) || 35
  const tolerance = options.tolerance ?? 0.2
  const errors = []
  const warnings = []

  if (!script || typeof script !== 'object') return { ok: false, errors: ['脚本不是对象'], warnings, durationSec: 0 }

  if (typeof script.title !== 'string' || !script.title.trim()) errors.push('title 缺失')
  else if (Array.from(script.title).length > 30) warnings.push('标题超过 30 字，发布时可能被截断')

  const narration = Array.isArray(script.narration) ? script.narration : []
  if (narration.length === 0) errors.push('narration 为空')
  narration.forEach((line, index) => {
    if (!line || typeof line.text !== 'string' || !line.text.trim()) errors.push(`narration[${index}].text 缺失`)
    else if (Array.from(line.text).length > 40) warnings.push(`narration[${index}] 超过 40 字，逐句配音会过长`)
  })

  const shotList = Array.isArray(script.shotList) ? script.shotList : []
  if (shotList.length === 0) errors.push('shotList 为空')
  shotList.forEach((shot, index) => {
    if (!shot || typeof shot.intent !== 'string' || !shot.intent.trim()) errors.push(`shotList[${index}].intent 缺失`)
    if (!shot || (shot.source !== 'generate' && shot.source !== 'library')) errors.push(`shotList[${index}].source 必须是 generate 或 library`)
    if (!shot || !(Number(shot.durationSec) > 0)) errors.push(`shotList[${index}].durationSec 必须大于 0`)
  })

  if (!script.coverText || typeof script.coverText.main !== 'string') warnings.push('coverText 缺失，封面只能用默认标题')
  if (typeof script.coverPrompt !== 'string' || !script.coverPrompt.trim()) errors.push('coverPrompt 缺失')

  const durationSec = narration.reduce((sum, line) => sum + estimateSeconds(line?.text || ''), 0)
  const low = targetSec * (1 - tolerance)
  const high = targetSec * (1 + tolerance)
  if (durationSec > 0 && (durationSec < low || durationSec > high)) {
    warnings.push(`配音预估 ${durationSec.toFixed(1)}s，偏离目标 ${targetSec}s 超过 ${Math.round(tolerance * 100)}%`)
  }

  return { ok: errors.length === 0, errors, warnings, durationSec: Math.round(durationSec * 100) / 100 }
}

/**
 * Generate and validate a script, retrying once on contract failure.
 * A duration deviation is only a warning — the renderer adapts to the real
 * audio length, so a slightly long script is not worth another API call.
 */
export async function generateScript(llm, input, options = {}) {
  const attempts = []
  const maxAttempts = options.maxAttempts ?? 2
  let last

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { json, usage } = await llm.complete(
      {
        system: SCRIPT_SYSTEM_PROMPT,
        user: buildScriptPrompt(input),
        json: true,
        temperature: attempt === 1 ? 0.85 : 0.6,
      },
      options.signal,
    )
    const check = validateScript(json, { targetSec: input.targetSec })
    attempts.push({ attempt, usage, errors: check.errors, warnings: check.warnings, durationSec: check.durationSec })
    last = { script: json, check, usage }
    if (check.ok) return { ...last, attempts }
  }

  const error = new Error(`脚本生成未通过校验：${last?.check?.errors?.join('；') || '未知原因'}`)
  error.code = 'SCRIPT_INVALID'
  error.attempts = attempts
  throw error
}
