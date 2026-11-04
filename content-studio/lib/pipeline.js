import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createPlan } from './edl.js'
import { probe, resolveTools } from './ffmpeg.js'
import { ITEM_STATUS, loadItem, markStep, stepDir, updateItem, appendLog, writeJson } from './batch-store.js'
import { generateScript } from './steps/script.js'
import { synthesizeVoice } from './steps/voice.js'
import { buildCues, buildStyle, toAss, toSrt } from './steps/subtitle.js'
import { renderPlan, extractThumbnail, wavToMp3 } from './steps/render.js'
import { runToCompletion } from './runner.js'
import { composeCover, fallbackBackground, COVER_VARIANTS } from './steps/cover.js'
import { validateItem } from './steps/validate.js'
import { getPlatform } from './platforms.js'
import { markUsed, pickMaterials } from './steps/scan.js'
import { addUsage, computeCost, emptyUsage } from './cost.js'

/**
 * Item pipeline (SPEC §5.1).
 *
 * Order is not negotiable: 文案 → 配音 → 字幕 → 画面 → 剪辑方案 → 渲染。
 * Voice comes before visuals because the voice track defines the timeline.
 *
 * Every step is idempotent and resumable: `steps[step].status === 'done'` skips
 * it unless the caller asks for a rerun from that step.
 */
export async function runItem(options) {
  const {
    batchId,
    itemId,
    providers = {},
    materials = [],
    tools: providedTools,
    onProgress = () => {},
    force = false,
    signal,
    excludeMaterials,
  } = options

  const tools = providedTools || (await resolveTools())
  const { item, batch } = await loadItem(batchId, itemId)
  const config = batch.config || {}
  const log = (line) => appendLog(join(item.dir, 'item.log'), line)

  if (item.status === ITEM_STATUS.cancelled) return { skipped: true, reason: 'cancelled' }

  await updateItem(batchId, itemId, () => ({ status: ITEM_STATUS.running, error: null }))
  onProgress({ itemId, phase: 'start' })

  const done = (step) => !force && item.steps?.[step]?.status === 'done'

  /**
   * Loaders rebuild a step's result from disk. A skipped step must return the
   * real artifact — returning a `{skipped:true}` sentinel would hand garbage to
   * the next step whenever a run resumes after a partial failure.
   */
  const loaders = {
    script: () => readJsonSafe(join(item.dir, '01-script', 'script.json')),
    voice: async () => {
      const meta = await readJsonSafe(join(item.dir, '02-voice', 'duration.json'))
      if (!meta) throw new Error('duration.json 缺失')
      return { ...meta, wavPath: join(item.dir, '02-voice', 'voice.wav') }
    },
    subtitle: async () => {
      const data = await readJsonSafe(join(item.dir, '03-subtitle', 'subtitle.json'))
      if (!data) throw new Error('subtitle.json 缺失')
      return {
        ...data,
        srtPath: join(item.dir, '03-subtitle', 'subtitle.srt'),
        assPath: join(item.dir, '03-subtitle', 'subtitle.ass'),
      }
    },
    visual: async () => {
      const data = await readJsonSafe(join(item.dir, '04-visual', 'manifest.json'))
      if (!data) throw new Error('manifest.json 缺失')
      return data
    },
    plan: () => readJsonSafe(join(item.dir, '05-edl', 'edit-plan.json')),
    render: async () => {
      const masterPath = join(item.dir, '06-render', 'master.mp4')
      const info = await probe(tools, masterPath)
      return { masterPath, durationSec: info.durationSec, width: info.width, height: info.height }
    },
    cover: async () => {
      const files = {}
      for (const [variant, size] of Object.entries(COVER_VARIANTS)) {
        const path = join(item.dir, '07-cover', `cover-${variant}.png`)
        if (await exists(path)) files[variant] = { path, ...size }
      }
      if (Object.keys(files).length === 0) throw new Error('封面产物缺失')
      return { files, degraded: Boolean((await readJsonSafe(join(item.dir, '07-cover', 'bg.json')))?.degraded) }
    },
    validate: () => readJsonSafe(join(item.dir, '08-validate', 'report.json')),
  }

  const step = async (name, fn) => {
    if (done(name)) {
      try {
        const cached = await loaders[name]()
        if (cached) {
          onProgress({ itemId, phase: 'skip', step: name })
          return cached
        }
      } catch (error) {
        await appendLog(join(item.dir, 'item.log'), `步骤 ${name} 标记完成但产物缺失，重跑：${error.message}`)
      }
    }
    await markStep(batchId, itemId, name, { status: 'running', error: null })
    const startedAt = Date.now()
    try {
      const result = await fn()
      await markStep(batchId, itemId, name, { status: 'done', ms: Date.now() - startedAt, error: null })
      onProgress({ itemId, phase: 'done', step: name, ms: Date.now() - startedAt })
      return result
    } catch (error) {
      const message = String(error?.message || error)
      await markStep(batchId, itemId, name, { status: 'failed', ms: Date.now() - startedAt, error: message })
      await appendLog(join(item.dir, 'item.log'), `步骤 ${name} 失败：${message}`)
      throw Object.assign(new Error(`[${name}] ${message}`), { step: name, cause: error })
    }
  }

  try {
    // Only real runs contribute: a skipped step adds nothing, so the numbers stay
    // honest when a batch is resumed halfway.
    const usage = emptyUsage()
    const track = (patch) => Object.assign(usage, addUsage(usage, patch))

    /* ---------- 1. 文案 ---------- */
    const scriptStep = await step('script', async () => {
      const dir = await stepDir(item, 'script')
      const existing = await readJsonSafe(join(dir, 'script.json'))
      if (existing && !force) return existing
      if (!providers.llm) throw new Error('未配置文案模型（llm provider）')
      const result = await generateScript(
        providers.llm,
        {
          topic: config.topic || batch.title,
          style: config.style,
          targetSec: config.targetSec || 35,
          aspectRatio: config.aspectRatio || '9:16',
          shotCount: config.shotCount || 8,
          groups: config.groups || [],
          materialCount: materials.length,
        },
        { signal, maxAttempts: 2 },
      )
      const payload = { ...result.script, _meta: { attempts: result.attempts, generatedAt: Date.now() } }
      await writeJson(join(dir, 'script.json'), payload)
      const tokens = (result.attempts || []).reduce((sum, attempt) => sum + (Number(attempt.usage?.total_tokens) || 0), 0)
      track({ llmTokens: tokens, llmCalls: (result.attempts || []).length })
      return payload
    })
    const script = scriptStep

    /* ---------- 2. 配音 ---------- */
    const voice = await step('voice', async () => {
      const dir = await stepDir(item, 'voice')
      const manifest = await readJsonSafe(join(dir, 'duration.json'))
      if (manifest && !force) return { ...manifest, wavPath: join(dir, 'voice.wav') }
      if (!providers.tts) throw new Error('未配置配音模型（tts provider）')
      const result = await synthesizeVoice({
        tts: providers.tts,
        narration: script.narration || [],
        outDir: dir,
        voice: config.voice || providers.tts.voice || 'default',
        speed: config.speechSpeed || 1,
        gapMs: config.gapMs ?? 180,
        signal,
        onProgress: (p) => onProgress({ itemId, phase: 'voice', ...p }),
      })
      await writeJson(join(dir, 'voice.segments.json'), result.segments)
      await writeJson(join(dir, 'duration.json'), { totalSec: result.totalSec, sampleRate: result.sampleRate, gapMs: result.gapMs })
      if (tools?.ok) await wavToMp3(tools, result.wavPath, join(dir, 'voice.mp3')).catch(() => {})
      track({
        ttsCharacters: result.synthesizedCharacters || 0,
        ttsReusedCharacters: result.reusedCharacters || 0,
        ttsSeconds: result.totalSec,
        ttsCacheHits: result.cacheHits || 0,
      })
      return { ...result, wavPath: result.wavPath }
    })

    /* ---------- 3. 字幕 ---------- */
    const subtitle = await step('subtitle', async () => {
      const dir = await stepDir(item, 'subtitle')
      const cues = buildCues(voice.segments, { maxChars: config.subtitleMaxChars || 16 })
      const style = buildStyle(config.subtitleStyle || {})
      const size = resolutionOf(config.aspectRatio || '9:16')
      const srtPath = join(dir, 'subtitle.srt')
      const assPath = join(dir, 'subtitle.ass')
      await writeFile(srtPath, toSrt(cues), 'utf8')
      await writeFile(assPath, toAss(cues, style, size), 'utf8')
      await writeJson(join(dir, 'subtitle.json'), { cues, style, size, estimated: cues.some((cue) => cue.timing === 'estimated') })
      return { srtPath, assPath, cues, style, size }
    })

    /* ---------- 4. 画面 ---------- */
    const visuals = await step('visual', async () => {
      const dir = await stepDir(item, 'visual')
      const shots = await prepareShots({
        item,
        batch,
        script,
        providers,
        materials,
        dirs: { visual: dir },
        tools,
        config,
        signal,
        onProgress,
        exclude: excludeMaterials,
      })
      await writeJson(join(dir, 'manifest.json'), shots)
      const usedPaths = shots.filter((shot) => shot.source === 'library' && shot.sourcePath).map((shot) => shot.sourcePath)
      if (usedPaths.length > 0) await markUsed(usedPaths).catch(() => {})
      const generated = shots.filter((shot) => shot.source === 'generate')
      track({ videoSeconds: generated.reduce((sum, shot) => sum + (Number(shot.durationSec) || 0), 0), videoShots: generated.length })
      return shots
    })

    /* ---------- 5. 剪辑方案 ---------- */
    const plan = await step('plan', async () => {
      const dir = await stepDir(item, 'plan')
      const built = createPlan({
        resolution: resolutionOf(config.aspectRatio || '9:16'),
        fps: config.fps || 30,
        durationSec: voice.totalSec,
        voice: { path: relative(item.dir, voice.wavPath), totalSec: voice.totalSec },
        shots: visuals.map((shot) => ({
          path: relative(item.dir, shot.path),
          kind: shot.kind,
          durationSec: shot.durationSec,
          inSec: shot.inSec || 0,
          intent: shot.intent,
          transitionOut: config.transition === 'fade' ? 'fade' : 'cut',
        })),
        subtitles: {
          srtPath: relative(item.dir, subtitle.srtPath),
          assPath: relative(item.dir, subtitle.assPath),
          style: { ...subtitle.style, fontSize: config.subtitleFontSize || subtitle.style.fontSize },
        },
        bgm: config.bgmPath ? { path: config.bgmPath, gain: config.bgmGain ?? 0.18 } : null,
        loudnessTarget: config.loudnessTarget ?? -14,
      })
      await writeJson(join(dir, 'edit-plan.json'), built)
      return built
    })

    /* ---------- 6. 渲染 ---------- */
    const render = await step('render', async () => {
      const dir = await stepDir(item, 'render')
      const result = await renderPlan(plan, {
        tools,
        outDir: dir,
        onProgress: (p) => onProgress({ itemId, phase: 'render', ...p }),
        resolvePath: (path) => join(item.dir, path),
      })
      await extractThumbnail(tools, result.masterPath, join(dir, 'thumb.jpg'), Math.min(1, result.durationSec / 3)).catch(() => {})
      return result
    })

    /* ---------- 7. 封面 ---------- */
    const cover = await step('cover', async () => {
      const dir = await stepDir(item, 'cover')
      const text = script.coverText || { main: script.title || '封面', sub: '' }
      const cachedBg = await readJsonSafe(join(dir, 'bg.json'))

      let bgPath
      if (cachedBg?.path && !force) {
        bgPath = join(dir, 'bg.png')
      } else if (providers.image) {
        const generated = await providers.image.generate({ prompt: script.coverPrompt, size: '1024x1536', signal })
        await writeFile(join(dir, 'bg.png'), generated.image)
        await writeJson(join(dir, 'bg.json'), { source: 'provider', degraded: false })
        track({ imageCount: 1 })
        bgPath = join(dir, 'bg.png')
      } else {
        bgPath = await fallbackBackground({ tools, outDir: dir, variant: 'vertical' })
        await writeJson(join(dir, 'bg.json'), { source: 'fallback', degraded: true })
      }

      const composed = await composeCover({
        tools,
        bgPath,
        text: { main: text.main || script.title, sub: text.sub || '' },
        outDir: dir,
        template: config.coverTemplate || 'default',
        variants: ['vertical', 'horizontal', 'square'],
      })
      return { ...composed, bgPath, degraded: Boolean((await readJsonSafe(join(dir, 'bg.json')))?.degraded) }
    })

    /* ---------- 8. 校验 ---------- */
    const report = await step('validate', async () => {
      const dir = await stepDir(item, 'validate')
      const result = await validateItem({
        tools,
        itemDir: item.dir,
        ctx: { script, plan, masterPath: render.masterPath, cover: cover.files, voicePath: voice.wavPath },
        rules: config.validationRules || {},
        platform: config.platform ? getPlatform(config.platform) : null,
      })
      await writeJson(join(dir, 'report.json'), result)
      return result
    })

    // 自动放行：校验通过的条目直接进入待发布，跳过人工审核台。
    const autoApproved = config.reviewMode === 'auto' && report.status !== 'failed'
    const finalStatus = report.status === 'failed'
      ? ITEM_STATUS.failed
      : autoApproved
        ? ITEM_STATUS.approved
        : ITEM_STATUS.reviewPending
    if (autoApproved) {
      await writeJson(join(item.dir, '09-review', 'review.json'), {
        decision: 'approved',
        mode: 'auto',
        decidedAt: Date.now(),
        note: '批次配置为自动放行',
      })
    }
    const itemUsage = addUsage(emptyUsage(), usage)
    const cost = computeCost(itemUsage, config.pricing || {})
    await updateItem(batchId, itemId, () => ({
      status: finalStatus,
      title: script.title,
      durationSec: render.durationSec,
      usage: itemUsage,
      cost,
      error: report.status === 'failed' ? report.errors.map((e) => `${e.id}:${e.detail}`).join('；') : null,
    }))
    await log(`完成：${finalStatus}，时长 ${render.durationSec}s，用量 ${JSON.stringify(itemUsage)}`)

    return { itemId, status: finalStatus, script, voice, subtitle, visuals, plan, render, cover, report }
  } catch (error) {
    await updateItem(batchId, itemId, () => ({ status: ITEM_STATUS.failed, error: String(error.message || error) }))
    await appendLog(join(item.dir, 'item.log'), `失败：${error.message}`)
    return { itemId, status: ITEM_STATUS.failed, error: error.message, step: error.step }
  }
}

/** Resolve the shot list into real files on disk. */
async function prepareShots(options) {
  const { item, script, providers, materials, dirs, tools, config, signal, onProgress, exclude } = options
  const shots = Array.isArray(script.shotList) ? script.shotList : []
  const genDir = join(dirs.visual, 'gen')
  const pickedDir = join(dirs.visual, 'picked')
  await mkdir(genDir, { recursive: true })
  await mkdir(pickedDir, { recursive: true })

  const candidates = pickMaterials(materials, {
    mode: config.materialMode || 'folder',
    group: config.group,
    limit: Math.max(shotCount(shots), 20),
  })

  /**
   * 每次取镜头时才看 exclude。
   * 预先按 exclude 过滤出一个池是错的：并发跑的两条内容会同时算池、同时挑中同一个素材。
   */
  const pickNext = () => {
    if (candidates.length === 0) return undefined
    const fresh = candidates.filter((entry) => !exclude || !exclude.has(entry.path))
    const pool = fresh.length > 0 ? fresh : candidates
    const chosen = pool[libraryCursor % pool.length]
    libraryCursor += 1
    exclude?.add(chosen.path)
    return chosen
  }

  const resolved = []
  let libraryCursor = 0

  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index]
    const durationSec = Math.max(0.5, Number(shot.durationSec) || 3)

    if (shot.source === 'library') {
      const material = pickNext()
      if (!material) {
        throw new Error('素材库没有可用素材，但脚本要求 library 镜头')
      }
      const target = join(pickedDir, `shot-${String(index + 1).padStart(2, '0')}${extOf(material.path)}`)
      await copyFile(material.path, target).catch(async () => {
        // cross-device or locked file: fall back to a copy through ffmpeg
        const { ffmpeg } = await import('./ffmpeg.js')
        await ffmpeg(tools, ['-hide_banner', '-loglevel', 'error', '-y', '-i', material.path, '-c', 'copy', target])
      })
      const inSec = pickInSec(material, durationSec, item.seq, index)
      resolved.push({ index, path: target, kind: material.kind, durationSec, inSec, intent: shot.intent, source: 'library', sourcePath: material.path })
      continue
    }

    if (!providers.video) throw new Error('脚本要求生成镜头，但未配置视频模型')
    const target = join(genDir, `shot-${String(index + 1).padStart(2, '0')}.mp4`)
    onProgress({ itemId: item.id, phase: 'visual', index: index + 1, total: shots.length })
    // 与 provider 的「测试」按钮共用同一套提交/轮询逻辑，避免两处实现各自漂移
    const finished = await runToCompletion(providers.video, {
      prompt: buildShotPrompt(shot, config),
      durationSec: Math.min(10, Math.max(2, durationSec)),
      aspectRatio: config.aspectRatio || '9:16',
      resolution: config.resolution,
      seed: config.seed,
    }, {
      signal,
      onProgress: (progress) => onProgress({ itemId: item.id, phase: 'visual-poll', ...progress }),
    })
    await materializeVideo(finished, target)
    resolved.push({ index, path: target, kind: 'video', durationSec, inSec: 0, intent: shot.intent, source: 'generate', taskId: finished.taskId, seed: finished.seed })
  }

  // 素材库镜头不够时保持顺序稳定
  return resolved.sort((a, b) => a.index - b.index)
}

async function materializeVideo(finished, target) {
  if (finished.localPath) {
    await copyFile(finished.localPath, target)
    return target
  }
  if (finished.videoUrl) {
    const res = await fetch(finished.videoUrl)
    if (!res.ok) throw new Error(`下载生成视频失败：${res.status}`)
    await writeFile(target, Buffer.from(await res.arrayBuffer()))
    return target
  }
  throw new Error('视频任务成功但既没有 videoUrl 也没有 localPath')
}

function buildShotPrompt(shot, config) {
  const parts = [shot.intent]
  if (config.visualStyle) parts.push(config.visualStyle)
  if (config.aspectRatio) parts.push(`${config.aspectRatio} 构图`)
  parts.push('画面干净，不要出现文字、字幕、水印')
  return parts.join('，')
}

export function resolutionOf(aspectRatio) {
  switch (aspectRatio) {
    case '16:9':
      return { w: 1920, h: 1080 }
    case '1:1':
      return { w: 1080, h: 1080 }
    case '4:5':
      return { w: 1080, h: 1350 }
    case '9:16':
    default:
      return { w: 1080, h: 1920 }
  }
}

function shotCount(shots) {
  return Array.isArray(shots) ? shots.length : 0
}

function extOf(path) {
  const match = /\.[A-Za-z0-9]+$/.exec(path)
  return match ? match[0] : '.mp4'
}

/**
 * Where to start inside a library clip.
 *
 * Always starting at 0 makes a batch look like the same footage on repeat, so
 * the offset is spread deterministically across items — same input, same output.
 */
export function pickInSec(material, needSec, seq = 0, index = 0) {
  if (!material || material.kind !== 'video') return 0
  const available = (Number(material.durationSec) || 0) - (Number(needSec) || 0) - 0.2
  if (!(available > 0.5)) return 0
  const seed = ((Number(seq) || 1) * 37 + (Number(index) || 0) * 11) % 997
  return Math.round(((seed / 997) * available) * 10) / 10
}

function relative(from, to) {
  const base = from.replace(/\\/g, '/')
  const target = to.replace(/\\/g, '/')
  if (target.startsWith(base)) return target.slice(base.length).replace(/^\//, '')
  return target
}

async function readJsonSafe(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

async function exists(path) {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}
