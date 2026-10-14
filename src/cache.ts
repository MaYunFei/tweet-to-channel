import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'

export interface CacheDirs {
  root: string
  media: string
  tweets: string
  trans: string
}

export function getCacheDirs(customRoot?: string): CacheDirs {
  const root = customRoot
    ? path.resolve(customRoot)
    : path.resolve(process.cwd(), config.cacheDir || './data/cache')
  return {
    root,
    media: path.join(root, 'media'),
    tweets: path.join(root, 'tweets'),
    trans: path.join(root, 'trans'),
  }
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function hashKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

/**
 * Returns cached buffer if file exists and has not exceeded maxAgeHours.
 * Updates file mtime/atime upon cache hit for accurate LRU recency tracking.
 */
export function getCachedBuffer(
  key: string,
  maxAgeHours = config.cacheTtlHours,
  customRoot?: string
): Buffer | null {
  try {
    const dirs = getCacheDirs(customRoot)
    const file = path.join(dirs.media, hashKey(key))
    if (!fs.existsSync(file)) return null

    const stat = fs.statSync(file)
    const ageMs = Date.now() - stat.mtimeMs
    if (maxAgeHours > 0 && ageMs > maxAgeHours * 3600 * 1000) {
      try {
        fs.unlinkSync(file)
      } catch {}
      return null
    }

    // Touch file access/mod time for LRU tracking
    try {
      const now = new Date()
      fs.utimesSync(file, now, now)
    } catch {}

    return fs.readFileSync(file)
  } catch (err: any) {
    console.warn(`[Cache] Error reading buffer for ${key.slice(0, 40)}:`, err.message)
    return null
  }
}

/**
 * Persists buffer to disk cache using atomic file writing (.tmp file + rename).
 */
export function setCachedBuffer(key: string, buffer: Buffer, customRoot?: string): void {
  const dirs = getCacheDirs(customRoot)
  ensureDir(dirs.media)
  const targetFile = path.join(dirs.media, hashKey(key))
  const tmpFile = path.join(dirs.media, `${hashKey(key)}.${crypto.randomUUID()}.tmp`)

  try {
    fs.writeFileSync(tmpFile, buffer)
    fs.renameSync(tmpFile, targetFile)
  } catch (err: any) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
    } catch {}
    console.warn(`[Cache] Error writing buffer for ${key.slice(0, 40)}:`, err.message)
  }
}

/**
 * Deletes a cached buffer by its key/URL.
 */
export function deleteCachedBuffer(key: string, customRoot?: string): boolean {
  try {
    const dirs = getCacheDirs(customRoot)
    const file = path.join(dirs.media, hashKey(key))
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
      return true
    }
  } catch (err: any) {
    console.warn(`[Cache] Error deleting buffer for ${key.slice(0, 40)}:`, err.message)
  }
  return false
}

/**
 * Returns cached JSON object if file exists and has not exceeded maxAgeHours.
 */
export function getCachedJson<T>(
  key: string,
  maxAgeHours = config.cacheTtlHours,
  customRoot?: string
): T | null {
  try {
    const dirs = getCacheDirs(customRoot)
    const isTrans = key.startsWith('trans:')
    const dir = isTrans ? dirs.trans : dirs.tweets
    const file = path.join(dir, `${hashKey(key)}.json`)
    if (!fs.existsSync(file)) return null

    const stat = fs.statSync(file)
    const ageMs = Date.now() - stat.mtimeMs
    if (maxAgeHours > 0 && ageMs > maxAgeHours * 3600 * 1000) {
      try {
        fs.unlinkSync(file)
      } catch {}
      return null
    }

    try {
      const now = new Date()
      fs.utimesSync(file, now, now)
    } catch {}

    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw) as T
  } catch (err: any) {
    console.warn(`[Cache] Error reading json for ${key.slice(0, 40)}:`, err.message)
    return null
  }
}

/**
 * Persists JSON object to disk cache using atomic file writing.
 */
export function setCachedJson<T>(key: string, data: T, customRoot?: string): void {
  const dirs = getCacheDirs(customRoot)
  const isTrans = key.startsWith('trans:')
  const dir = isTrans ? dirs.trans : dirs.tweets
  ensureDir(dir)
  const targetFile = path.join(dir, `${hashKey(key)}.json`)
  const tmpFile = path.join(dir, `${hashKey(key)}.${crypto.randomUUID()}.tmp`)

  try {
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmpFile, targetFile)
  } catch (err: any) {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
    } catch {}
    console.warn(`[Cache] Error writing json for ${key.slice(0, 40)}:`, err.message)
  }
}

/**
 * Calculates current cache statistics (file count and total size in bytes).
 */
export function getCacheStats(customRoot?: string): { fileCount: number; totalSizeBytes: number } {
  const dirs = getCacheDirs(customRoot)
  let fileCount = 0
  let totalSizeBytes = 0

  function scan(dir: string) {
    if (!fs.existsSync(dir)) return
    try {
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
    } catch {}
  }

  scan(dirs.root)
  return { fileCount, totalSizeBytes }
}

/**
 * Clears all cached files on disk.
 */
export function clearCache(customRoot?: string): { fileCount: number; totalSizeBytes: number } {
  const dirs = getCacheDirs(customRoot)
  const stats = getCacheStats(customRoot)
  try {
    if (fs.existsSync(dirs.root)) {
      fs.rmSync(dirs.root, { recursive: true, force: true })
    }
  } catch (err: any) {
    console.warn(`[Cache] Error clearing cache:`, err.message)
  }
  return stats
}

export interface PruneOptions {
  customRoot?: string
  maxAgeHours?: number
  maxSizeMb?: number
  lowWatermarkRatio?: number
  gracePeriodMs?: number
  cleanOrphanTmp?: boolean
}

export interface PruneResult {
  ttlDeletedFiles: number
  ttlFreedBytes: number
  lruDeletedFiles: number
  lruFreedBytes: number
  orphanTmpDeletedFiles: number
  orphanTmpFreedBytes: number
  totalDeletedFiles: number
  totalFreedBytes: number
  remainingFiles: number
  remainingBytes: number
}

interface FileEntry {
  path: string
  size: number
  mtimeMs: number
}

/**
 * Prunes the cache directory with TTL expiration, orphan temp file removal,
 * and LRU capacity watermark eviction.
 */
export function pruneCache(options: PruneOptions = {}): PruneResult {
  const customRoot = options.customRoot
  const dirs = getCacheDirs(customRoot)
  const maxAgeHours = options.maxAgeHours !== undefined ? options.maxAgeHours : config.cacheTtlHours
  const maxSizeMb = options.maxSizeMb !== undefined ? options.maxSizeMb : config.cacheMaxSizeMb
  const lowWatermarkRatio = options.lowWatermarkRatio !== undefined ? options.lowWatermarkRatio : 0.8
  const gracePeriodMs = options.gracePeriodMs !== undefined ? options.gracePeriodMs : 10 * 60 * 1000 // 10 min
  const cleanOrphanTmp = options.cleanOrphanTmp !== undefined ? options.cleanOrphanTmp : true

  let ttlDeletedFiles = 0
  let ttlFreedBytes = 0
  let lruDeletedFiles = 0
  let lruFreedBytes = 0
  let orphanTmpDeletedFiles = 0
  let orphanTmpFreedBytes = 0

  if (!fs.existsSync(dirs.root)) {
    return {
      ttlDeletedFiles: 0,
      ttlFreedBytes: 0,
      lruDeletedFiles: 0,
      lruFreedBytes: 0,
      orphanTmpDeletedFiles: 0,
      orphanTmpFreedBytes: 0,
      totalDeletedFiles: 0,
      totalFreedBytes: 0,
      remainingFiles: 0,
      remainingBytes: 0,
    }
  }

  const now = Date.now()
  const survivingFiles: FileEntry[] = []

  function scanAndFilter(dir: string) {
    if (!fs.existsSync(dir)) return
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          scanAndFilter(fullPath)
        } else if (entry.isFile()) {
          try {
            const stat = fs.statSync(fullPath)
            const isTmp = entry.name.endsWith('.tmp') || entry.name.includes('.tmp.')

            // 1. Clean orphan temp files
            if (isTmp && cleanOrphanTmp) {
              if (now - stat.mtimeMs > gracePeriodMs) {
                fs.unlinkSync(fullPath)
                orphanTmpDeletedFiles++
                orphanTmpFreedBytes += stat.size
                continue
              }
              // If temp file is within grace period, keep it (active write in progress)
              continue
            }

            // 2. TTL Expiration Check
            if (maxAgeHours > 0 && now - stat.mtimeMs > maxAgeHours * 3600 * 1000) {
              fs.unlinkSync(fullPath)
              ttlDeletedFiles++
              ttlFreedBytes += stat.size
              continue
            }

            survivingFiles.push({
              path: fullPath,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
            })
          } catch {}
        }
      }
    } catch {}
  }

  scanAndFilter(dirs.root)

  // 3. LRU Watermark Check
  let currentTotalBytes = survivingFiles.reduce((sum, f) => sum + f.size, 0)
  let remainingCount = survivingFiles.length

  if (maxSizeMb > 0) {
    const highWatermarkBytes = maxSizeMb * 1024 * 1024
    const lowWatermarkBytes = highWatermarkBytes * lowWatermarkRatio

    if (currentTotalBytes > highWatermarkBytes) {
      // Sort oldest mtime first
      survivingFiles.sort((a, b) => a.mtimeMs - b.mtimeMs)

      for (const file of survivingFiles) {
        // Protect recently active files within grace period
        if (gracePeriodMs > 0 && now - file.mtimeMs < gracePeriodMs) {
          continue
        }

        try {
          fs.unlinkSync(file.path)
          lruDeletedFiles++
          lruFreedBytes += file.size
          currentTotalBytes -= file.size
          remainingCount--

          if (currentTotalBytes <= lowWatermarkBytes) {
            break
          }
        } catch {}
      }
    }
  }

  const totalDeletedFiles = ttlDeletedFiles + lruDeletedFiles + orphanTmpDeletedFiles
  const totalFreedBytes = ttlFreedBytes + lruFreedBytes + orphanTmpFreedBytes

  const result: PruneResult = {
    ttlDeletedFiles,
    ttlFreedBytes,
    lruDeletedFiles,
    lruFreedBytes,
    orphanTmpDeletedFiles,
    orphanTmpFreedBytes,
    totalDeletedFiles,
    totalFreedBytes,
    remainingFiles: remainingCount,
    remainingBytes: currentTotalBytes,
  }

  if (totalDeletedFiles > 0) {
    console.log(
      `[Cache] Prune finished: freed ${(totalFreedBytes / 1024 / 1024).toFixed(2)} MB (${totalDeletedFiles} files: ` +
      `TTL: ${ttlDeletedFiles}, LRU: ${lruDeletedFiles}, Tmp: ${orphanTmpDeletedFiles}). ` +
      `Remaining: ${(currentTotalBytes / 1024 / 1024).toFixed(2)} MB (${remainingCount} files).`
    )
  }

  return result
}

let activeCleanerTimer: NodeJS.Timeout | null = null

/**
 * Starts periodic background cache auto-cleaner.
 */
export function startCacheCleaner(intervalMinutes = config.cacheCleanIntervalMinutes): NodeJS.Timeout | null {
  if (intervalMinutes <= 0) {
    console.log('[Cache] Auto-cleaner disabled (interval <= 0)')
    return null
  }
  if (activeCleanerTimer) {
    clearInterval(activeCleanerTimer)
    activeCleanerTimer = null
  }

  const intervalMs = intervalMinutes * 60 * 1000
  console.log(
    `[Cache] Starting periodic auto-cleaner (interval: ${intervalMinutes} min, quota: ${config.cacheMaxSizeMb > 0 ? `${config.cacheMaxSizeMb} MB` : 'unlimited'}, TTL: ${config.cacheTtlHours > 0 ? `${config.cacheTtlHours}h` : 'disabled'})`
  )

  activeCleanerTimer = setInterval(() => {
    try {
      pruneCache()
    } catch (err: any) {
      console.error('[Cache] Auto-cleaner execution error:', err.message)
    }
  }, intervalMs)

  activeCleanerTimer.unref()
  return activeCleanerTimer
}

/**
 * Stops periodic background cache cleaner.
 */
export function stopCacheCleaner(): void {
  if (activeCleanerTimer) {
    clearInterval(activeCleanerTimer)
    activeCleanerTimer = null
    console.log('[Cache] Auto-cleaner stopped.')
  }
}
