import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'content-studio-publisher-'))
process.env.CONTENT_STUDIO_HOME = home

const { createBatch, loadBatch, loadItem, readJson, writeJson } = await import('../lib/batch-store.js')
const { savePostiz } = await import('../lib/postiz.js')
const { createPublisher } = await import('../lib/publisher.js')
const { listPublishJobs } = await import('../lib/publish-store.js')

let postCount = 0
const fakeFetch = async (url) => {
  const path = new URL(url).pathname
  if (path.endsWith('/integrations')) {
    return new Response(JSON.stringify([{ id: 'channel-1', name: '测试频道', identifier: 'youtube', disabled: false }]), { status: 200 })
  }
  if (path.endsWith('/upload')) {
    return new Response(JSON.stringify({ id: 'media-1', path: '/media/media-1' }), { status: 200 })
  }
  if (path.endsWith('/posts')) {
    postCount += 1
    return new Response(JSON.stringify({ id: `post-${postCount}` }), { status: 200 })
  }
  return new Response('{}', { status: 200 })
}
globalThis.fetch = fakeFetch

await savePostiz({ apiUrl: 'https://postiz.test', apiKey: 'test-key' })
const batch = await createBatch({
  title: '发布测试',
  count: 1,
  config: { topic: '测试', publishStartAt: new Date().toISOString(), publishIntervalMinutes: 0 },
})
const itemId = batch.items[0].id
const { item } = await loadItem(batch.id, itemId)
await mkdir(join(item.dir, '01-script'), { recursive: true })
await writeFile(join(item.dir, '01-script', 'script.json'), JSON.stringify({ title: '测试标题', description: '测试正文', hashtags: ['#测试'] }))
await mkdir(join(item.dir, '06-render'), { recursive: true })
await writeFile(join(item.dir, '06-render', 'master.mp4'), 'fake-video')
await writeJson(join(item.dir, 'item.json'), { ...item, status: 'approved' })
await writeJson(join(batch.dir, 'batch.json'), { ...(await loadBatch(batch.id)), items: [{ ...batch.items[0], status: 'approved' }] })

const publisher = createPublisher({ intervalMs: 60_000 })
const currentBatch = await loadBatch(batch.id)
const currentItem = (await loadItem(batch.id, itemId)).item
const job = await publisher.scheduleItem({
  batch: currentBatch,
  item: currentItem,
  targets: [{ id: 'channel-1', name: '测试频道', identifier: 'youtube' }],
  scheduleAt: new Date().toISOString(),
})
assert.equal(job.status, 'scheduled')
publisher.start()
await new Promise((resolve) => setTimeout(resolve, 50))
publisher.stop()
const jobs = await listPublishJobs(batch.dir)
assert.equal(jobs.length, 1)
assert.equal(jobs[0].status, 'published')
assert.equal(jobs[0].targets[0].providerPostId, 'post-1')
assert.equal(postCount, 1)
const savedItem = await readJson(join(item.dir, 'item.json'))
assert.equal(savedItem.publish.status, 'published')
console.log('ALL PUBLISHER CHECKS PASSED (8)')
