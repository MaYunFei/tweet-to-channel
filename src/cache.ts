import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'

const CACHE_ROOT = path.resolve(process.cwd(), config.cacheDir || './data/cache')
const MEDIA_DIR = path.join(CACHE_ROOT, 'media')
const TWEETS_DIR = path.join(CACHE_ROOT, 'tweets')
const TRANS_DIR = path.join(CACHE_ROOT, 'trans')

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

/**
 * Returns cached buffer if file exists and has not exceeded maxAgeHours.
 */
export function getCachedBuffer(key: string, maxAgeHours = config.cacheTtlHours): Buffer | null {
  try {
    const file = path.join(MEDIA_DIR, hashKey(key))
    if (!fs.existsSync(file)) return null

    const stat = fs.statSync(file)
    const ageMs = Date.now() - stat.mtimeMs
    if (ageMs > maxAgeHours * 3600 * 1000) {
      fs.unlinkSync(file)
      return null
    }

    return fs.readFileSync(file)
  } catch (err: any) {
    console.warn(`[Cache] Error reading buffer for ${key.slice(0, 40)}:`, err.message)
    return null
  }
}

/**
 * Persists buffer to disk cache.
 */
export function setCachedBuffer(key: string, buffer: Buffer): void {
  try {
    ensureDir(MEDIA_DIR)
    const file = path.join(MEDIA_DIR, hashKey(key))
    fs.writeFileSync(file, buffer)
  } catch (err: any) {
    console.warn(`[Cache] Error writing buffer for ${key.slice(0, 40)}:`, err.message)
  }
}

/**
 * Returns cached JSON object if file exists and has not exceeded maxAgeHours.
 */
export function getCachedJson<T>(key: string, maxAgeHours = config.cacheTtlHours): T | null {
  try {
    const isTrans = key.startsWith('trans:')
    const dir = isTrans ? TRANS_DIR : TWEETS_DIR
    const file = path.join(dir, `${hashKey(key)}.json`)
    if (!fs.existsSync(file)) return null

    const stat = fs.statSync(file)
    const ageMs = Date.now() - stat.mtimeMs
    if (ageMs > maxAgeHours * 3600 * 1000) {
      fs.unlinkSync(file)
      return null
    }

    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw) as T
  } catch (err: any) {
    console.warn(`[Cache] Error reading json for ${key.slice(0, 40)}:`, err.message)
    return null
  }
}

/**
 * Persists JSON object to disk cache.
 */
export function setCachedJson<T>(key: string, data: T): void {
  try {
    const isTrans = key.startsWith('trans:')
    const dir = isTrans ? TRANS_DIR : TWEETS_DIR
    ensureDir(dir)
    const file = path.join(dir, `${hashKey(key)}.json`)
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
  } catch (err: any) {
    console.warn(`[Cache] Error writing json for ${key.slice(0, 40)}:`, err.message)
  }
}

/**
 * Calculates current cache statistics (file count and total size in bytes).
 */
export function getCacheStats(): { fileCount: number; totalSizeBytes: number } {
  let fileCount = 0
  let totalSizeBytes = 0

  function scan(dir: string) {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scan(full)
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full)
          fileCount++
          totalSizeBytes += stat.size
        } catch {}
      }
    }
  }

  scan(CACHE_ROOT)
  return { fileCount, totalSizeBytes }
}

/**
 * Clears all cached files on disk.
 */
export function clearCache(): { fileCount: number; totalSizeBytes: number } {
  const stats = getCacheStats()
  try {
    if (fs.existsSync(CACHE_ROOT)) {
      fs.rmSync(CACHE_ROOT, { recursive: true, force: true })
    }
  } catch (err: any) {
    console.warn(`[Cache] Error clearing cache:`, err.message)
  }
  return stats
}
