import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createZip } from './zip.js'

/**
 * 发布包：人工发布需要的全部物料。文件名保持 ASCII，避免不同解压工具在
 * Windows 上对中文文件名处理不一致；内容里的中文照常保留。
 */

const COVER_FILES = [
  ['07-cover/cover-vertical.png', 'cover-vertical.png'],
  ['07-cover/cover-horizontal.png', 'cover-horizontal.png'],
  ['07-cover/cover-square.png', 'cover-square.png'],
]

async function readOptional(file) {
  try {
    return await readFile(file)
  } catch {
    return null
  }
}

async function readJsonOptional(file) {
  const data = await readOptional(file)
  if (!data) return null
  try {
    return JSON.parse(data.toString('utf8'))
  } catch {
    return null
  }
}

function copyText(script, item, config) {
  const lines = [
    `标题：${script?.title || item.title || ''}`,
    `简介：${script?.description || ''}`,
    `标签：${(script?.hashtags || []).join(' ')}`,
    `封面主文案：${script?.coverText?.main || ''}`,
    `封面副文案：${script?.coverText?.sub || ''}`,
  ]
  if (config?.platform) lines.push(`平台：${config.platform}`)
  if (config?.publishStartAt) lines.push(`计划发布：${config.publishStartAt}`)
  lines.push(`条目：${item.id}`)
  return `${lines.join('\n')}\n`
}

async function itemEntries(item, config, prefix = '') {
  const entries = []
  const master = await readOptional(join(item.dir, '06-render', 'master.mp4'))
  if (master) entries.push({ name: `${prefix}master.mp4`, data: master })

  for (const [relative, name] of COVER_FILES) {
    const data = await readOptional(join(item.dir, relative))
    if (data) entries.push({ name: `${prefix}${name}`, data })
  }

  const script = await readJsonOptional(join(item.dir, '01-script', 'script.json'))
  if (script) {
    entries.push({ name: `${prefix}copy.json`, data: Buffer.from(JSON.stringify(script, null, 2), 'utf8') })
  }
  entries.push({ name: `${prefix}copy.txt`, data: Buffer.from(copyText(script, item, config), 'utf8') })

  const report = await readJsonOptional(join(item.dir, '08-validate', 'report.json'))
  if (report) {
    entries.push({ name: `${prefix}validation-report.json`, data: Buffer.from(JSON.stringify(report, null, 2), 'utf8') })
  }

  const meta = {
    id: item.id,
    batchId: item.batchId,
    seq: item.seq,
    title: script?.title || item.title || '',
    platform: config?.platform || null,
    publishStartAt: config?.publishStartAt || null,
    publishIntervalMinutes: config?.publishIntervalMinutes ?? null,
    durationSec: item.durationSec ?? null,
    exportedAt: new Date().toISOString(),
  }
  entries.push({ name: `${prefix}meta.json`, data: Buffer.from(JSON.stringify(meta, null, 2), 'utf8') })
  return entries
}

export async function buildItemZip(item, config = {}) {
  const entries = await itemEntries(item, config)
  if (!entries.some((entry) => entry.name === 'master.mp4')) {
    throw Object.assign(new Error('成片尚未生成，不能导出发布包'), { status: 409 })
  }
  return createZip(entries)
}

export async function buildBatchZip(batch) {
  const entries = []
  for (const summary of batch.items || []) {
    const seq = String(summary.seq).padStart(3, '0')
    entries.push(...await itemEntries({ ...summary, batchId: batch.id, dir: summary.dir }, batch.config || {}, `item-${seq}/`))
  }
  if (!entries.some((entry) => entry.name.endsWith('master.mp4'))) {
    throw Object.assign(new Error('这个批次还没有可导出的成片'), { status: 409 })
  }
  return createZip(entries)
}

export function itemExportName(item) {
  return `content-studio-item-${String(item.seq || 1).padStart(3, '0')}.zip`
}

export function batchExportName(batch) {
  return `content-studio-${batch.id}.zip`
}
