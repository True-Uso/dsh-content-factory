/**
 * Postiz 分发：不打真实网。
 *   node tools/test-postiz.mjs
 */
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.CONTENT_STUDIO_HOME = await mkdtemp(join(tmpdir(), 'cs-postiz-'))

const {
  postizApiRoot, postCopy, settingsFor, publicPostiz, listChannels, distributeItem, savePostiz, loadPostiz,
} = await import('../lib/postiz.js')

let passed = 0
function check(name, condition, extra = '') {
  if (!condition) throw new Error(`FAIL ${name}${extra ? ` — ${extra}` : ''}`)
  passed += 1
  console.log(`  ok  ${name}`)
}

check('云地址补 public/v1', postizApiRoot('https://api.postiz.com') === 'https://api.postiz.com/public/v1')
check('已带 public/v1 不重复', postizApiRoot('https://api.postiz.com/public/v1') === 'https://api.postiz.com/public/v1')
check('自建 /api 补 public/v1', postizApiRoot('http://localhost:5000/api') === 'http://localhost:5000/api/public/v1')
check('文案打成 HTML', postCopy({ title: '标题', description: '简介', hashtags: ['#a'] }) === '<p>标题</p><p>简介</p><p>#a</p>')
check('HTML 转义', postCopy({ title: 'a<b>' }).includes('a&lt;b&gt;'))
check('TikTok 用直发', settingsFor('tiktok').content_posting_method === 'DIRECT_POST')
check('YouTube 带标题', settingsFor('youtube', { title: '游乐园' }).title === '游乐园')
check('未配密钥时 public 标记未连接', publicPostiz({ apiUrl: 'https://api.postiz.com', apiKey: '' }).configured === false)

const calls = []
const fakeFetch = async (url, options = {}) => {
  calls.push({ url, method: options.method || 'GET', body: options.body })
  if (String(url).endsWith('/integrations')) {
    return { ok: true, text: async () => JSON.stringify([
      { id: 'tk1', name: '工场号', identifier: 'tiktok', disabled: false },
      { id: 'off', name: '停用', identifier: 'x', disabled: true },
    ]) }
  }
  if (String(url).endsWith('/upload')) {
    return { ok: true, text: async () => JSON.stringify({ id: 'm1', path: 'https://uploads.postiz.com/master.mp4' }) }
  }
  if (String(url).endsWith('/posts')) {
    return { ok: true, text: async () => JSON.stringify({ id: 'p1' }) }
  }
  return { ok: false, status: 404, text: async () => '{"error":"no"}' }
}

const listed = await listChannels({ apiUrl: 'https://api.postiz.com', apiKey: 'k' }, { fetch: fakeFetch })
check('列出账号时丢掉停用的', listed.length === 1 && listed[0].id === 'tk1')

const video = join(process.env.CONTENT_STUDIO_HOME, 'master.mp4')
await writeFile(video, 'mp4')
const sent = await distributeItem(
  { apiUrl: 'https://api.postiz.com', apiKey: 'k' },
  { videoPath: video, script: { title: '游乐园日记', description: '玩一天', hashtags: ['#游乐园'] }, integrationIds: ['tk1'] },
  { fetch: fakeFetch },
)
check('分发回传频道', sent.channels[0].identifier === 'tiktok')
const postCall = calls.find((call) => String(call.url).endsWith('/posts'))
const payload = JSON.parse(postCall.body)
check('立即发', payload.type === 'now')
check('带上上传后的视频', payload.posts[0].value[0].image[0].id === 'm1')
check('TikTok settings 是直发', payload.posts[0].settings.content_posting_method === 'DIRECT_POST')

let missing
try {
  await distributeItem({ apiUrl: 'https://api.postiz.com', apiKey: 'k' }, { videoPath: video, script: {}, integrationIds: [] }, { fetch: fakeFetch })
} catch (error) {
  missing = error
}
check('没勾账号被拒', Boolean(missing) && missing.status === 400)

await savePostiz({ apiUrl: 'https://api.postiz.com', apiKey: 'secret-key' })
const loaded = await loadPostiz()
check('密钥落盘', loaded.apiKey === 'secret-key')
await savePostiz({ apiUrl: 'https://api.postiz.com', apiKey: '__stored__' })
check('掩码不覆盖密钥', (await loadPostiz()).apiKey === 'secret-key')

await rm(process.env.CONTENT_STUDIO_HOME, { recursive: true, force: true })
console.log(`\nALL POSTIZ CHECKS PASSED (${passed})`)
