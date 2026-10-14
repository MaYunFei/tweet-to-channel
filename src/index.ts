import type http from 'node:http'
import { createBot } from './bot/index.js'
import { createApiServer } from './server.js'
import { config } from './config.js'
import { pruneCache, startCacheCleaner, stopCacheCleaner } from './cache.js'

async function bootstrap() {
  console.log('----------------------------------------------------')
  console.log('🚀 Starting Tweet to Channel Service...')
  console.log(`- Theme: ${config.theme}`)
  console.log(`- Target Channel: ${config.targetChannelId || '(None - direct reply)'}`)
  console.log(`- Admin IDs: ${config.adminUserIds.join(', ') || '(All users allowed)'}`)
  console.log(`- Proxy: ${config.proxyUrl || '(Direct connection)'}`)
  console.log(`- HTTP API: ${config.enableApi ? `Port ${config.apiPort}` : 'Disabled'}`)
  console.log(`- Cache Quota: ${config.cacheMaxSizeMb > 0 ? `${config.cacheMaxSizeMb} MB` : 'Unlimited'} (TTL: ${config.cacheTtlHours}h, Auto-Clean: ${config.cacheCleanIntervalMinutes}m)`)
  console.log('----------------------------------------------------')

  // Run initial cache maintenance (prune expired files and orphan tmp files)
  try {
    const initialPrune = pruneCache()
    if (initialPrune.totalDeletedFiles > 0) {
      console.log(`🧹 Cache maintenance on startup: freed ${(initialPrune.totalFreedBytes / 1024 / 1024).toFixed(2)} MB (${initialPrune.totalDeletedFiles} files)`)
    }
  } catch (err: any) {
    console.warn('[Cache] Startup prune warning:', err.message)
  }

  // Start periodic background cache cleaner
  startCacheCleaner()

  const bot = createBot()
  let apiServer: http.Server | undefined

  if (config.enableApi) {
    apiServer = createApiServer(bot)
    apiServer.listen(config.apiPort, () => {
      console.log(`🌐 HTTP API server is listening on port ${config.apiPort}`)
      if (config.apiAuthToken) {
        console.log(`🔒 API Authentication: Token configured (Bearer / ?token=...)`)
      } else {
        console.warn(`⚠️ API Authentication: API_AUTH_TOKEN is not set in .env! (Requests will be rejected)`)
      }
    })
  }

  // Graceful shutdown
  const stop = () => {
    console.log('\n🛑 Stopping bot and services...')
    stopCacheCleaner()
    bot.stop()
    if (apiServer) {
      apiServer.close()
    }
    process.exit(0)
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  await bot.start({
    onStart: botInfo => {
      console.log(`✅ Bot @${botInfo.username} is running and listening for messages!`)
    },
  })
}

bootstrap().catch(err => {
  console.error('Fatal error starting service:', err)
  process.exit(1)
})
