/**
 * Subtitle generation (SPEC FR-05).
 *
 * Single source of truth: the per-sentence timestamps produced by the TTS step.
 * No ASR anywhere — that would add cost and lower accuracy at the same time.
 */

const SENTENCE_END = /[。！？!?…]/
const SOFT_BREAK = /[，,、；;：:\s]/

/** Split one narration sentence into subtitle-sized chunks, keeping order. */
export function splitText(text, maxChars = 16) {
  const clean = String(text || '').trim()
  if (!clean) return []
  if (countChars(clean) <= maxChars) return [clean]

  const chunks = []
  let buffer = ''
  const push = () => {
    const value = buffer.trim()
    if (value) chunks.push(value)
    buffer = ''
  }

  for (const char of Array.from(clean)) {
    buffer += char
    if (countChars(buffer) >= maxChars) {
      // prefer breaking right after punctuation, otherwise hard-break
      push()
    } else if (SOFT_BREAK.test(char) && countChars(buffer) >= Math.floor(maxChars * 0.6)) {
      push()
    }
  }
  push()
  return chunks
}

export function countChars(text) {
  return Array.from(String(text || '')).filter((char) => char.trim() !== '').length
}

/** Distribute a [start,end] window across chunks proportionally to their char counts. */
export function distributeTimes(chunks, start, end) {
  const total = chunks.reduce((sum, chunk) => sum + Math.max(1, countChars(chunk)), 0)
  const span = Math.max(0.05, end - start)
  let cursor = start
  return chunks.map((chunk, index) => {
    const weight = Math.max(1, countChars(chunk)) / total
    const duration = index === chunks.length - 1 ? Math.max(0.05, end - cursor) : Math.max(0.05, span * weight)
    const cue = { text: chunk, start: round3(cursor), end: round3(Math.min(end, cursor + duration)) }
    cursor = cue.end
    return cue
  })
}

/**
 * Turn voice segments into subtitle cues.
 * Uses word timings when the TTS provider returned them; otherwise the sentence
 * window is split proportionally and each cue is flagged `timing: 'estimated'`.
 */
export function buildCues(segments, options = {}) {
  const maxChars = options.maxChars ?? 16
  const cues = []

  for (const segment of segments || []) {
    const text = String(segment.text || '').trim()
    if (!text) continue
    const start = Number(segment.start) || 0
    const end = Number(segment.end) || start + 0.5
    const words = Array.isArray(segment.words) && segment.words.length > 0 ? segment.words : null
    const chunks = splitText(text, maxChars)

    if (chunks.length <= 1) {
      cues.push({ text, start: round3(start), end: round3(end), sid: segment.sid, timing: words ? 'provider' : 'segment' })
      continue
    }

    if (words) {
      const grouped = groupWords(words, maxChars)
      grouped.forEach((group, index) => {
        const fallback = distributeTimes(chunks, start, end)[index]
        cues.push({
          text: group.text || fallback.text,
          start: round3(group.start ?? fallback.start),
          end: round3(group.end ?? fallback.end),
          sid: segment.sid,
          timing: 'provider',
        })
      })
      continue
    }

    for (const cue of distributeTimes(chunks, start, end)) {
      cues.push({ ...cue, sid: segment.sid, timing: 'estimated' })
    }
  }

  return normalizeCues(cues)
}

function groupWords(words, maxChars) {
  const groups = []
  let current = null
  for (const word of words) {
    const text = String(word.text || '')
    if (!current) current = { text, start: word.start, end: word.end }
    else if (countChars(current.text + text) <= maxChars) {
      current.text += text
      current.end = word.end
    } else {
      groups.push(current)
      current = { text, start: word.start, end: word.end }
    }
  }
  if (current) groups.push(current)
  return groups
}

/** Enforce monotonic, non-overlapping, minimum-duration cues. */
export function normalizeCues(cues) {
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  const out = []
  let cursor = 0
  for (const cue of sorted) {
    const start = Math.max(round3(cue.start), cursor)
    const end = Math.max(round3(cue.end), round3(start + 0.3))
    out.push({ ...cue, start, end })
    cursor = end
  }
  return out
}

export function formatTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = Math.floor(safe % 60)
  const millis = Math.round((safe - Math.floor(safe)) * 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${String(Math.min(999, millis)).padStart(3, '0')}`
}

export function toSrt(cues) {
  return (
    normalizeCues(cues)
      .map((cue, index) => `${index + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}\n`)
      .join('\n')
  )
}

/**
 * ASS output — what the renderer actually burns.
 *
 * SRT + `force_style` is a trap: libass assigns a default PlayResY of 288 when
 * the script has none, so a "64px" font is scaled by videoHeight/288 (≈6.7× on a
 * 1920-high frame) and swallows the screen. An ASS header that declares
 * PlayResX/PlayResY makes the font size mean what we wrote.
 */
export function toAss(cues, style = {}, size = { width: 1080, height: 1920 }) {
  const playW = size.width || 1080
  const playH = size.height || 1920
  const font = style.font || 'Microsoft YaHei'
  const fontsize = Math.round(style.fontSize ?? Math.max(28, Math.round(playH / 32)))
  const outline = Math.round(style.outline ?? Math.max(2, Math.round(fontsize / 12)))
  const shadow = Math.round(style.shadow ?? 1)
  const marginV = Math.round(style.marginBottom ?? Math.round(playH * 0.14))

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${playW}`,
    `PlayResY: ${playH}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${font},${fontsize},${style.primaryColor || '&H00FFFFFF'},${style.outlineColor || '&H00000000'},&H64000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},2,${Math.round(playW * 0.06)},${Math.round(playW * 0.06)},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const events = normalizeCues(cues).map((cue) => {
    const text = escapeAss(cue.text)
    return `Dialogue: 0,${formatAssTime(cue.start)},${formatAssTime(cue.end)},Default,,0,0,0,,${text}`
  })

  return `${header.join('\n')}\n${events.join('\n')}\n`
}

function escapeAss(text) {
  return String(text || '')
    .replace(/\\/g, '＼')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝')
    .replace(/\r?\n/g, ' ')
}

export function formatAssTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = Math.floor(safe % 60)
  const centis = Math.round((safe - Math.floor(safe)) * 100)
  return `${hours}:${pad(minutes)}:${pad(secs)}.${pad(Math.min(99, centis))}`
}

/** Styling payload the renderer turns into ASS overrides. */
export function buildStyle(options = {}) {
  return {
    preset: options.preset || 'vertical-bold',
    fontSize: options.fontSize ?? 64,
    marginBottom: options.marginBottom ?? 260,
    outline: options.outline ?? 4,
    shadow: options.shadow ?? 1,
    primaryColor: options.primaryColor || '&H00FFFFFF',
    outlineColor: options.outlineColor || '&H00000000',
    highlightColor: options.highlightColor || '&H0000E5FF',
  }
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000
}
