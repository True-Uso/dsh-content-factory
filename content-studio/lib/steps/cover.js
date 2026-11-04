import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ffmpeg, probe } from '../ffmpeg.js'

/**
 * Cover step (SPEC FR-09).
 *
 * Two phases on purpose:
 *   1. the image model draws a background with **no text** (it cannot render CJK)
 *   2. ffmpeg composites the Chinese headline locally
 *
 * Phase 2 is cheap (<1s), so editing a title never re-triggers a paid generation.
 */

export const COVER_VARIANTS = {
  vertical: { w: 1080, h: 1920 },
  horizontal: { w: 1280, h: 720 },
  square: { w: 1080, h: 1080 },
}

const FONTS = {
  bold: 'C\\:/Windows/Fonts/msyhbd.ttc',
  regular: 'C\\:/Windows/Fonts/msyh.ttc',
}

const TEMPLATES = {
  default: {
    scrimFrom: 0.52,
    mainY: 0.655,
    gap: 0.055,
    mainScale: 0.105,
    subScale: 0.045,
    align: 'center',
  },
  magazine: {
    scrimFrom: 0.45,
    mainY: 0.55,
    gap: 0.06,
    mainScale: 0.12,
    subScale: 0.05,
    align: 'left',
  },
  minimal: {
    scrimFrom: 0.74,
    mainY: 0.82,
    gap: 0.05,
    mainScale: 0.062,
    subScale: 0.032,
    align: 'center',
  },
}

/**
 * @param {object} options
 * @param {string} options.bgPath 无文字底图
 * @param {{main:string, sub?:string}} options.text
 * @param {string} options.outDir
 * @param {string[]} [options.variants]
 * @param {string} [options.template]
 */
export async function composeCover(options) {
  const { tools, bgPath, text = {}, outDir, variants = ['vertical', 'horizontal', 'square'], template = 'default' } = options
  const preset = TEMPLATES[template] || TEMPLATES.default

  const main = String(text.main || '').trim()
  const sub = String(text.sub || '').trim()
  if (!main) throw new Error('封面主文案为空')

  await writeFile(join(outDir, 'main.txt'), main, 'utf8')
  if (sub) await writeFile(join(outDir, 'sub.txt'), sub, 'utf8')

  const base = await probe(tools, bgPath)
  if (!base.width || !base.height) throw new Error(`封面底图不可读：${bgPath}`)

  const files = {}
  for (const variant of variants) {
    const size = COVER_VARIANTS[variant]
    if (!size) continue
    const output = `cover-${variant}.png`
    await ffmpeg(tools, buildCoverArgs({ bgPath, output, size, preset, hasSub: Boolean(sub) }), {
      cwd: outDir,
      timeout: 120000,
    })
    files[variant] = { path: join(outDir, output), ...size }
  }

  return { files, template }
}

function buildCoverArgs({ bgPath, output, size, preset, hasSub }) {
  const { w, h } = size
  const mainSize = Math.round(w * preset.mainScale)
  const subSize = Math.round(w * preset.subScale)
  const stroke = Math.max(2, Math.round(mainSize * 0.06))
  const scrimY = Math.round(h * preset.scrimFrom)
  const mainY = Math.round(h * preset.mainY)
  const subY = mainY + mainSize + Math.round(h * preset.gap)

  const x = preset.align === 'left' ? `${Math.round(w * 0.07)}` : '(w-text_w)/2'

  const filters = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    `drawbox=x=0:y=${scrimY}:w=iw:h=ih-${scrimY}:color=black@0.42:t=fill`,
    `drawtext=fontfile='${FONTS.bold}':textfile='main.txt':fontcolor=white:fontsize=${mainSize}` +
      `:borderw=${stroke}:bordercolor=black@0.85:x=${x}:y=${mainY}`,
  ]
  if (hasSub) {
    filters.push(
      `drawtext=fontfile='${FONTS.regular}':textfile='sub.txt':fontcolor=white@0.92:fontsize=${subSize}` +
        `:borderw=${Math.max(1, Math.round(stroke / 2))}:bordercolor=black@0.8:x=${x}:y=${subY}`,
    )
  }

  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', bgPath,
    '-vf', filters.join(','),
    '-frames:v', '1',
    output,
  ]
}

/**
 * Offline background when no image provider is configured.
 * Deliberately plain — a degraded cover is reported as degraded, not hidden.
 */
export async function fallbackBackground(options) {
  const { tools, outDir, variant = 'vertical', accent = '0x1F6FEB', base = '0x0E1524' } = options
  const size = COVER_VARIANTS[variant]
  const output = join(outDir, 'bg-fallback.png')
  await ffmpeg(tools, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi',
    '-i', `color=c=${base}:s=${size.w}x${size.h}:d=1`,
    '-vf',
    [
      `drawbox=x=0:y=0:w=iw:h=${Math.round(size.h * 0.18)}:color=${accent}@0.85:t=fill`,
      `drawbox=x=0:y=${Math.round(size.h * 0.18)}:w=iw:h=6:color=white@0.55:t=fill`,
    ].join(','),
    '-frames:v', '1',
    output,
  ], { timeout: 60000 })
  return output
}
