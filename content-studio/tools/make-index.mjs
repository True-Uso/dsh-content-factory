/**
 * 生成 DSH format-1 插件索引。
 *
 *   node tools/make-index.mjs \
 *     --repo https://github.com/your-org/content-studio \
 *     --commit <40位 sha> \
 *     --output ../content-studio-index/index.json
 *
 * 索引文件可以放在公开静态页（GitHub Pages / 内网静态主机）；代码仓库保持私有。
 * 不传 --commit 时读取当前仓库 HEAD。
 */
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const repo = arg('repo')
const output = resolve(arg('output', 'index.json'))
const commit = arg('commit') || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const here = dirname(fileURLToPath(import.meta.url))
const packageFile = resolve(here, '..', 'package.json')
const pkg = JSON.parse(await readFile(packageFile, 'utf8'))

if (!repo) {
  console.error('缺少 --repo https://github.com/org/repo')
  process.exit(2)
}
if (!/^https:\/\//.test(repo)) {
  console.error('--repo 必须是 https:// URL')
  process.exit(2)
}
if (!/^[0-9a-f]{40}$/i.test(commit)) {
  console.error('--commit 必须是 40 位 commit SHA')
  process.exit(2)
}

let icon
try {
  const svg = await readFile(new URL('../icon.svg', import.meta.url))
  if (svg.length <= 32 * 1024) icon = `data:image/svg+xml;base64,${svg.toString('base64')}`
} catch {
  // icon is optional
}

const index = {
  format: 1,
  title: '内容生产插件',
  plugins: [
    {
      name: pkg.name,
      title: '内容生产',
      description: '批量生产社交媒体短视频：文案、配音、混剪、封面、校验、人工审核与发布包导出。',
      ...(icon ? { icon } : {}),
      repository: { url: repo },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: Math.floor(Date.now() / 1000),
          source: { type: 'git', url: repo, commit },
          ...(pkg.engines?.dsh ? { engines: { dsh: pkg.engines.dsh } } : {}),
        },
      ],
    },
  ],
}

await writeFile(output, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
console.log(`写入 ${output}（${pkg.name}@${pkg.version} @ ${commit.slice(0, 7)}）`)
