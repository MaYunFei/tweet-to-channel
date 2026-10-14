import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {
  getCacheDirs,
  getCachedBuffer,
  setCachedBuffer,
  deleteCachedBuffer,
  getCachedJson,
  setCachedJson,
  getCacheStats,
  clearCache,
  pruneCache,
} from '../src/cache.js'

function createTempCacheDir(): string {
  const dir = path.join(os.tmpdir(), `test-cache-${crypto.randomUUID()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

test('Cache: atomic write and read of buffer', () => {
  const testRoot = createTempCacheDir()
  try {
    const key = 'https://twitter.com/example/video.mp4'
    const data = Buffer.from('fake-video-content-12345')

    setCachedBuffer(key, data, testRoot)

    const dirs = getCacheDirs(testRoot)
    const files = fs.readdirSync(dirs.media)
    assert.equal(files.length, 1, 'Only the target file should exist, no .tmp leftover')
    assert.ok(!files[0].endsWith('.tmp'), 'File must not be a .tmp file')

    const readBuf = getCachedBuffer(key, 24, testRoot)
    assert.ok(readBuf, 'Should retrieve buffer from cache')
    assert.deepEqual(readBuf, data)
  } finally {
    clearCache(testRoot)
  }
})

test('Cache: deleteCachedBuffer removes targeted file', () => {
  const testRoot = createTempCacheDir()
  try {
    const key = 'https://twitter.com/example/image.jpg'
    setCachedBuffer(key, Buffer.from('image-bytes'), testRoot)

    assert.ok(getCachedBuffer(key, 24, testRoot))
    const deleted = deleteCachedBuffer(key, testRoot)
    assert.equal(deleted, true)
    assert.equal(getCachedBuffer(key, 24, testRoot), null)
  } finally {
    clearCache(testRoot)
  }
})

test('Cache: atomic write and read of JSON', () => {
  const testRoot = createTempCacheDir()
  try {
    const key = 'tweet:123456789'
    const payload = { id: '123456789', text: 'Hello World', count: 42 }

    setCachedJson(key, payload, testRoot)

    const read = getCachedJson<typeof payload>(key, 24, testRoot)
    assert.deepEqual(read, payload)
  } finally {
    clearCache(testRoot)
  }
})

test('Cache: TTL expiration unlinks expired files', () => {
  const testRoot = createTempCacheDir()
  try {
    const freshKey = 'https://example.com/fresh.jpg'
    const expiredKey = 'https://example.com/expired.jpg'

    setCachedBuffer(freshKey, Buffer.from('fresh-data'), testRoot)
    setCachedBuffer(expiredKey, Buffer.from('expired-data'), testRoot)

    const dirs = getCacheDirs(testRoot)
    const expiredHash = crypto.createHash('sha256').update(expiredKey).digest('hex')
    const expiredFilePath = path.join(dirs.media, expiredHash)

    // Set mtime to 30 hours ago
    const thirtyHoursAgo = new Date(Date.now() - 30 * 3600 * 1000)
    fs.utimesSync(expiredFilePath, thirtyHoursAgo, thirtyHoursAgo)

    // pruneCache with 24 hours TTL
    const res = pruneCache({
      customRoot: testRoot,
      maxAgeHours: 24,
      maxSizeMb: 0, // disable size limit to test TTL only
      gracePeriodMs: 0,
    })

    assert.equal(res.ttlDeletedFiles, 1, 'Should delete exactly 1 expired file')
    assert.equal(getCachedBuffer(expiredKey, 24, testRoot), null, 'Expired file should be gone')
    assert.ok(getCachedBuffer(freshKey, 24, testRoot), 'Fresh file should remain')
  } finally {
    clearCache(testRoot)
  }
})

test('Cache: LRU capacity watermark eviction prunes oldest files down to low watermark', () => {
  const testRoot = createTempCacheDir()
  try {
    // We create 4 files of ~500KB each = ~2.0 MB total
    // We set maxSizeMb = 1.5 MB, lowWatermarkRatio = 0.8 (target: 1.2 MB)
    const chunkSize = 512 * 1024 // 512 KB
    const key1 = 'file-1-oldest'
    const key2 = 'file-2-middle'
    const key3 = 'file-3-newer'
    const key4 = 'file-4-newest'

    setCachedBuffer(key1, Buffer.alloc(chunkSize, '1'), testRoot)
    setCachedBuffer(key2, Buffer.alloc(chunkSize, '2'), testRoot)
    setCachedBuffer(key3, Buffer.alloc(chunkSize, '3'), testRoot)
    setCachedBuffer(key4, Buffer.alloc(chunkSize, '4'), testRoot)

    const dirs = getCacheDirs(testRoot)
    const hash = (k: string) => path.join(dirs.media, crypto.createHash('sha256').update(k).digest('hex'))

    // Set timestamps in strictly ascending order (past to present)
    const now = Date.now()
    fs.utimesSync(hash(key1), new Date(now - 4000), new Date(now - 4000))
    fs.utimesSync(hash(key2), new Date(now - 3000), new Date(now - 3000))
    fs.utimesSync(hash(key3), new Date(now - 2000), new Date(now - 2000))
    fs.utimesSync(hash(key4), new Date(now - 1000), new Date(now - 1000))

    // Total size is 2.0 MB. Quota is 1.5 MB.
    // Prune should evict key1 and key2 until remaining <= 1.2 MB.
    const res = pruneCache({
      customRoot: testRoot,
      maxAgeHours: 0, // disable TTL
      maxSizeMb: 1.5,
      lowWatermarkRatio: 0.8, // 1.2 MB target
      gracePeriodMs: 0,
    })

    assert.equal(res.lruDeletedFiles, 2, 'Should evict 2 oldest files to hit low watermark')
    assert.equal(getCachedBuffer(key1, 0, testRoot), null, 'Oldest file 1 should be evicted')
    assert.equal(getCachedBuffer(key2, 0, testRoot), null, 'Oldest file 2 should be evicted')
    assert.ok(getCachedBuffer(key3, 0, testRoot), 'Newer file 3 should remain')
    assert.ok(getCachedBuffer(key4, 0, testRoot), 'Newest file 4 should remain')
    assert.ok(res.remainingBytes <= 1.5 * 1024 * 1024 * 0.8, 'Remaining bytes must be <= low watermark')
  } finally {
    clearCache(testRoot)
  }
})

test('Cache: Grace period protects active files from premature eviction', () => {
  const testRoot = createTempCacheDir()
  try {
    const chunkSize = 512 * 1024
    const oldKey = 'file-old'
    const activeKey = 'file-active'

    setCachedBuffer(oldKey, Buffer.alloc(chunkSize, 'A'), testRoot)
    setCachedBuffer(activeKey, Buffer.alloc(chunkSize, 'B'), testRoot)

    const dirs = getCacheDirs(testRoot)
    const hash = (k: string) => path.join(dirs.media, crypto.createHash('sha256').update(k).digest('hex'))

    const now = Date.now()
    // oldKey was modified 1 hour ago
    fs.utimesSync(hash(oldKey), new Date(now - 3600 * 1000), new Date(now - 3600 * 1000))
    // activeKey was modified 10 seconds ago (well inside 10 min grace period)
    fs.utimesSync(hash(activeKey), new Date(now - 10 * 1000), new Date(now - 10 * 1000))

    // Set max size to 0.4 MB so at least 1 file needs eviction
    const res = pruneCache({
      customRoot: testRoot,
      maxAgeHours: 0,
      maxSizeMb: 0.4,
      gracePeriodMs: 5 * 60 * 1000, // 5 min grace period
    })

    assert.equal(res.lruDeletedFiles, 1, 'Should delete only the old file')
    assert.equal(getCachedBuffer(oldKey, 0, testRoot), null, 'Old file was deleted')
    assert.ok(getCachedBuffer(activeKey, 0, testRoot), 'Active file in grace period must be preserved')
  } finally {
    clearCache(testRoot)
  }
})

test('Cache: Orphan temp files cleanup', () => {
  const testRoot = createTempCacheDir()
  try {
    const dirs = getCacheDirs(testRoot)
    fs.mkdirSync(dirs.media, { recursive: true })

    const staleTmp = path.join(dirs.media, 'download-12345.tmp')
    const recentTmp = path.join(dirs.media, 'download-67890.tmp')
    fs.writeFileSync(staleTmp, 'stale-data')
    fs.writeFileSync(recentTmp, 'recent-data')

    const now = Date.now()
    // staleTmp is 30 minutes old
    fs.utimesSync(staleTmp, new Date(now - 30 * 60 * 1000), new Date(now - 30 * 60 * 1000))
    // recentTmp is 1 minute old
    fs.utimesSync(recentTmp, new Date(now - 60 * 1000), new Date(now - 60 * 1000))

    const res = pruneCache({
      customRoot: testRoot,
      maxAgeHours: 0,
      maxSizeMb: 0,
      gracePeriodMs: 10 * 60 * 1000, // 10 min grace
      cleanOrphanTmp: true,
    })

    assert.equal(res.orphanTmpDeletedFiles, 1, 'Should delete only the stale tmp file')
    assert.equal(fs.existsSync(staleTmp), false, 'Stale tmp file should be unlinked')
    assert.equal(fs.existsSync(recentTmp), true, 'Recent tmp file should be kept')
  } finally {
    clearCache(testRoot)
  }
})

test('Cache: Break-by-hand resilience (corrupted files return null without crashing)', () => {
  const testRoot = createTempCacheDir()
  try {
    const dirs = getCacheDirs(testRoot)
    fs.mkdirSync(dirs.tweets, { recursive: true })

    const key = 'tweet:corrupted'
    const keyHash = crypto.createHash('sha256').update(key).digest('hex')
    const filePath = path.join(dirs.tweets, `${keyHash}.json`)
    // Write invalid JSON bytes
    fs.writeFileSync(filePath, '{ "truncated_json": true, ')

    const res = getCachedJson(key, 24, testRoot)
    assert.equal(res, null, 'Corrupted JSON should gracefully return null')
  } finally {
    clearCache(testRoot)
  }
})
