import type http from 'node:http'
import { createBot } from './bot/index.js'
import { createApiServer } from './server.js'
import { config } from './config.js'

async function bootstrap() {
  console.log('----------------------------------------------------')
  console.log('🚀 Starting Tweet to Channel Service...')
  console.log(`- Theme: ${config.theme}`)
  console.log(`- Target Channel: ${config.targetChannelId || '(None - direct reply)'}`)
  console.log(`- Admin IDs: ${config.adminUserIds.join(', ') || '(All users allowed)'}`)
  console.log(`- Proxy: ${config.proxyUrl || '(Direct connection)'}`)
  console.log(`- HTTP API: ${config.enableApi ? `Port ${config.apiPort}` : 'Disabled'}`)
  console.log('----------------------------------------------------')

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
