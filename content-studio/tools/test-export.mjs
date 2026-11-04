/**
 * 发布包 ZIP：结构、CRC、缺失成片守卫。
 *   node tools/test-export.mjs
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32 } from 'node:zlib'

const { buildItemZip, buildBatchZip } = await import('../lib/export.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

function listEntries(buffer) {
  const entries = []
  let offset = 0
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8)
    const expectedCrc = buffer.readUInt32LE(offset + 14)
    const size = buffer.readUInt32LE(offset + 18)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8')
    const data = buffer.subarray(offset + 30 + nameLength + extraLength, offset + 30 + nameLength + extraLength + size)
    entries.push({ name, method, size, expectedCrc, actualCrc: crc32(data) })
    offset += 30 + nameLength + extraLength + size
  }
  return entries
}

const root = await mkdtemp(join(tmpdir(), 'cs-export-'))
const itemDir = join(root, 'item-001')
await mkdir(join(itemDir, '06-render'), { recursive: true })
await mkdir(join(itemDir, '07-cover'), { recursive: true })
await mkdir(join(itemDir, '01-script'), { recursive: true })
await mkdir(join(itemDir, '08-validate'), { recursive: true })

const master = Buffer.from('FAKE-MP4-'.repeat(200))
await writeFile(join(itemDir, '06-render', 'master.mp4'), master)
await writeFile(join(itemDir, '07-cover', 'cover-vertical.png'), Buffer.from('PNG-V'))
await writeFile(join(itemDir, '07-cover', 'cover-horizontal.png'), Buffer.from('PNG-H'))
await writeFile(join(itemDir, '07-cover', 'cover-square.png'), Buffer.from('PNG-S'))
await writeFile(join(itemDir, '01-script', 'script.json'), JSON.stringify({
  title: '标题', description: '简介', hashtags: ['#a'], coverText: { main: '主', sub: '副' },
}))
await writeFile(join(itemDir, '08-validate', 'report.json'), JSON.stringify({ status: 'passed', summary: { total: 18, passed: 18 } }))

const item = { id: 'b-001', batchId: 'b', seq: 1, title: '标题', durationSec: 7.2, dir: itemDir }
const zip = await buildItemZip(item, { platform: 'douyin', publishStartAt: '2026-11-05T10:00:00.000Z' })
const entries = listEntries(zip)
const names = entries.map((entry) => entry.name)
check('发布包包含成片', names.includes('master.mp4'))
check('发布包包含三尺寸封面', ['cover-vertical.png', 'cover-horizontal.png', 'cover-square.png'].every((name) => names.includes(name)))
check('发布包包含文案 txt 与 json', names.includes('copy.txt') && names.includes('copy.json'))
check('发布包包含校验报告', names.includes('validation-report.json'))
check('发布包包含 meta', names.includes('meta.json'))
check('全部使用 store 方法', entries.every((entry) => entry.method === 0))
check('CRC 与 zlib 一致', entries.every((entry) => entry.expectedCrc === entry.actualCrc))
check('成片字节完整', entries.find((entry) => entry.name === 'master.mp4').size === master.length)

const copy = entries.find((entry) => entry.name === 'copy.txt')
check('文案 txt 存在且含标题', Boolean(copy) && zip.includes(Buffer.from('标题')))

const batchEntries = await buildBatchZip({ id: 'b', config: { platform: 'douyin' }, items: [item] })
const batchNames = listEntries(batchEntries).map((entry) => entry.name)
check('整批导出带条目目录', batchNames.includes('item-001/master.mp4') && batchNames.includes('item-001/meta.json'))

const emptyDir = await mkdtemp(join(tmpdir(), 'cs-export-empty-'))
let missingError = null
try {
  await buildItemZip({ id: 'x', seq: 1, dir: emptyDir }, {})
} catch (error) {
  missingError = error
}
check('缺少成片时拒绝导出', missingError?.status === 409, String(missingError?.status))

await rm(root, { recursive: true, force: true }).catch(() => {})
await rm(emptyDir, { recursive: true, force: true }).catch(() => {})

console.log(`\nALL EXPORT CHECKS PASSED (${passed})`)
