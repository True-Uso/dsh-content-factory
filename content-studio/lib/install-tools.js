import { execFile } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { clearToolCache, resolveTools } from './ffmpeg.js'
import { dataDir } from './store.js'

const run = promisify(execFile)
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DOWNLOAD_URL = process.env.CONTENT_STUDIO_FFMPEG_URL
  || 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'

async function exists(file) {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

async function works(file) {
  try {
    await run(file, ['-version'], { timeout: 15000 })
    return true
  } catch {
    return false
  }
}

async function ensureExec(file) {
  try {
    await chmod(file, 0o755)
  } catch {
    // The install tree can be read-only; a mode bit set earlier still runs.
  }
}

/** npm platform packages. ffprobe ships mode 0644, so chmod before the probe. */
async function fromInstaller() {
  const out = {}
  for (const [key, spec] of [['ffmpeg', '@ffmpeg-installer/ffmpeg'], ['ffprobe', '@ffprobe-installer/ffprobe']]) {
    try {
      const mod = await import(spec)
      const value = mod?.default || mod
      if (typeof value?.path === 'string') out[key] = value.path
    } catch {
      // optional dependency
    }
  }
  if (!out.ffmpeg || !out.ffprobe) return null
  await ensureExec(out.ffmpeg)
  await ensureExec(out.ffprobe)
  if (await works(out.ffmpeg) && await works(out.ffprobe)) return out
  return null
}

function pairIn(dir, platform = process.platform) {
  const ext = platform === 'win32' ? '.exe' : ''
  return {
    ffmpeg: join(dir, `ffmpeg${ext}`),
    ffprobe: join(dir, `ffprobe${ext}`),
  }
}

/** Find a usable ffmpeg/ffprobe pair that ships beside the plugin or in the workspace. */
async function findBundled() {
  const roots = []
  if (process.env.CONTENT_STUDIO_FFMPEG_DIR) roots.push(process.env.CONTENT_STUDIO_FFMPEG_DIR)
  try {
    let base = PLUGIN_ROOT
    for (let depth = 0; depth < 4; depth += 1) {
      roots.push(join(base, 'bin'), join(base, 'tools', 'bin'))
      const parent = dirname(base)
      if (parent === base) break
      base = parent
    }
  } catch {
    // ignore
  }
  let dir = process.cwd()
  for (let depth = 0; depth < 4; depth += 1) {
    roots.push(join(dir, 'bin'), join(dir, 'tools', 'bin'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  roots.push(join(dataDir(), 'bin'))

  for (const root of roots) {
    const pair = pairIn(root)
    if (await exists(pair.ffmpeg) && await exists(pair.ffprobe)) {
      await ensureExec(pair.ffmpeg)
      await ensureExec(pair.ffprobe)
      if (await works(pair.ffmpeg) && await works(pair.ffprobe)) return pair
    }
  }
  return null
}

async function firstWritable(destinations) {
  for (const destination of destinations) {
    try {
      await mkdir(destination, { recursive: true })
      const probe = join(destination, '.content-studio-write-test')
      await writeFile(probe, '')
      await rm(probe, { force: true })
      return destination
    } catch {
      // try the next location
    }
  }
  return null
}

async function copyPair(pair, destination) {
  await mkdir(destination, { recursive: true })
  const target = pairIn(destination)
  await copyFile(pair.ffmpeg, target.ffmpeg)
  await copyFile(pair.ffprobe, target.ffprobe)
  return target
}

async function walk(root) {
  const found = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (entry.isFile() && (entry.name === 'ffmpeg.exe' || entry.name === 'ffprobe.exe')) found.push(path)
    }
  }
  return found
}

async function extractZip(zipPath, targetDir) {
  try {
    await run('tar', ['-xf', zipPath, '-C', targetDir], { timeout: 120000 })
    return
  } catch {
    // Windows fallback; quote single quotes for PowerShell's literal string.
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`
    await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(targetDir)} -Force`,
    ], { timeout: 180000 })
  }
}

async function downloadPair(destination) {
  if (process.platform !== 'win32') {
    throw new Error('Linux 不下载 Windows 包。插件自带的 ffmpeg/ffprobe 没能运行，请检查文件是否可执行。')
  }
  const res = await fetch(DOWNLOAD_URL, { redirect: 'follow' })
  if (!res.ok) throw new Error(`下载 ffmpeg 失败：HTTP ${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  if (buffer.length < 1024 * 1024) throw new Error('下载的 ffmpeg 包异常，已中止')

  const temp = await mkdtemp(join(tmpdir(), 'content-studio-ffmpeg-'))
  try {
    const zipPath = join(temp, 'ffmpeg.zip')
    await writeFile(zipPath, buffer)
    const extracted = join(temp, 'unpacked')
    await mkdir(extracted, { recursive: true })
    await extractZip(zipPath, extracted)
    const files = await walk(extracted)
    const ffmpeg = files.find((file) => file.endsWith('ffmpeg.exe'))
    const ffprobe = files.find((file) => file.endsWith('ffprobe.exe'))
    if (!ffmpeg || !ffprobe) throw new Error('下载包中没有找到 ffmpeg.exe / ffprobe.exe')
    if (!await works(ffmpeg)) throw new Error('下载的 ffmpeg 无法运行')
    return copyPair({ ffmpeg, ffprobe }, destination)
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Install ffmpeg into ~/.content-studio/bin. Prefer a copy from the workspace
 * (the development checkout always has one); otherwise download the Windows
 * essentials build from the configured URL.
 */
export async function installFfmpeg() {
  const destinations = [...new Set([
    process.env.CONTENT_STUDIO_FFMPEG_DIR,
    join(PLUGIN_ROOT, 'bin'),
    join(dataDir(), 'bin'),
  ].filter(Boolean))]

  const packaged = await fromInstaller()
  if (packaged) {
    clearToolCache()
    const tools = await resolveTools()
    return {
      ok: tools.ok,
      source: 'package',
      ffmpeg: packaged.ffmpeg,
      ffprobe: packaged.ffprobe,
      error: tools.error,
    }
  }

  const bundled = await findBundled()
  if (bundled) {
    const destination = await firstWritable(destinations)
    if (!destination) throw new Error('没有可写的 ffmpeg 安装目录')
    const pair = pairIn(destination)
    const alreadyThere = resolve(bundled.ffmpeg) === resolve(pair.ffmpeg)
    if (!alreadyThere) await copyPair(bundled, destination)
    clearToolCache()
    const tools = await resolveTools()
    return {
      ok: tools.ok,
      source: alreadyThere ? 'existing' : 'local',
      dir: destination,
      ffmpeg: alreadyThere ? bundled.ffmpeg : pair.ffmpeg,
      ffprobe: alreadyThere ? bundled.ffprobe : pair.ffprobe,
      error: tools.error,
    }
  }

  const destination = await firstWritable(destinations)
  if (!destination) throw new Error('没有可写的 ffmpeg 安装目录')
  const target = await downloadPair(destination)
  clearToolCache()
  const tools = await resolveTools()
  return { ok: tools.ok, source: 'download', dir: destination, ffmpeg: target.ffmpeg, ffprobe: target.ffprobe, error: tools.error }
}
