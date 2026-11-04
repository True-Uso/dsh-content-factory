import { statfs } from 'node:fs/promises'
import { dataDir } from './store.js'

/**
 * 建批次前的可行性检查（SPEC FR-12 的前置部分）。
 *
 * 只做 warn，不阻断：真正会让批次必挂的问题由页面顶部的「就绪检查」负责挡住，
 * 这里补的是「配置看着齐了但配置本身不匹配」这类问题，例如分类下没有素材。
 */
export async function preflight(options = {}) {
  const { tools, roles = new Set(), materials = [], config = {}, count = 1 } = options
  const warnings = []

  if (tools && !tools.ok) warnings.push(`ffmpeg 未就绪：${tools.error || '找不到 ffmpeg'}`)
  if (!roles.has('llm')) warnings.push('未配置文案模型，文案步骤会失败')
  if (!roles.has('tts')) warnings.push('未配置配音模型，配音步骤会失败')

  const usable = materials.filter((entry) => entry.kind === 'video' || entry.kind === 'image')
  const scoped =
    config.materialMode === 'folder' && config.group
      ? usable.filter((entry) => entry.dirGroup === config.group)
      : usable
  const shotsPerItem = Math.max(1, Number(config.shotCount) || 8)

  if (usable.length === 0) {
    warnings.push('素材库为空，全部画面都要靠视频模型生成')
    if (!roles.has('video')) warnings.push('素材库为空且未配置视频模型，画面步骤会失败')
  } else if (scoped.length === 0) {
    warnings.push(`分类「${config.group}」下没有素材，会回退到全库取材`)
  } else if (scoped.length < shotsPerItem) {
    const where = config.materialMode === 'folder' && config.group ? `该分类只有 ${scoped.length} 个素材` : `素材库只有 ${scoped.length} 个可用素材`
    warnings.push(`${where}，少于单条 ${shotsPerItem} 个镜头，会有重复画面`)
  }

  if (usable.length > 0 && !roles.has('video') && scoped.length < shotsPerItem) {
    warnings.push('未配置视频模型，且素材不足以覆盖全部镜头')
  }

  const free = await freeBytes().catch(() => null)
  if (free !== null && free < 1024 ** 3) {
    warnings.push(`磁盘剩余 ${(free / 1024 ** 3).toFixed(1)} GB，可能不够本批次产物（每条约 5–20 MB）`)
  }

  if (count > 50) {
    warnings.push(`一次 ${count} 条，按每条 1–3 分钟估算至少要 ${Math.round((count * 2) / 60)} 小时`)
  }

  return {
    ok: warnings.length === 0,
    warnings: warnings.slice(0, 6),
    // 估算：不猜单价，只按已有的默认规格给个量级
    estimate: {
      items: count,
      minutes: Math.round((count * 2) / Math.max(1, Number(config.concurrency) || 2)),
    },
  }
}

async function freeBytes() {
  const stats = await statfs(dataDir())
  return stats.bavail * stats.bsize
}
