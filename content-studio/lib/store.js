import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Provider registry storage.
 *
 * v0.1 keeps the registry in one JSON file so the adapters stay dependency-free.
 * The spec (§8.4) migrates this onto the Harness storage domain once the batch
 * pipeline lands; the shape below is already the shape that table stores.
 */
export function dataDir() {
  return process.env.CONTENT_STUDIO_HOME || join(homedir(), '.content-studio')
}

export function providersFile() {
  return join(dataDir(), 'providers.json')
}

export async function loadProviders() {
  try {
    const raw = await readFile(providersFile(), 'utf8')
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed?.providers) ? parsed.providers : []
    return list.filter((p) => p && typeof p.id === 'string' && p.id.length > 0)
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
}

export async function saveProviders(list) {
  await mkdir(dataDir(), { recursive: true })
  const payload = { version: 1, updatedAt: Date.now(), providers: list }
  await writeFile(providersFile(), JSON.stringify(payload, null, 2), 'utf8')
  return payload
}

export async function upsertProvider(next) {
  const list = await loadProviders()
  const index = list.findIndex((p) => p.id === next.id)
  const record = { ...next, updatedAt: Date.now() }
  if (index >= 0) list[index] = { ...list[index], ...record }
  else list.push(record)
  await saveProviders(list)
  return record
}

export async function removeProvider(id) {
  const list = await loadProviders()
  const next = list.filter((p) => p.id !== id)
  if (next.length === list.length) return false
  await saveProviders(next)
  return true
}
