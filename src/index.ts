import { createBot } from './bot/index.js'
import { config } from './config.js'

async function bootstrap() {
  console.log('----------------------------------------------------')
  console.log('🚀 Starting Tweet to Image Telegram Bot...')
  console.log(`- Theme: ${config.theme}`)
  console.log(`- Target Channel: ${config.targetChannelId || '(None - direct reply)'}`)
  console.log(`- Admin IDs: ${config.adminUserIds.join(', ') || '(All users allowed)'}`)
  console.log(`- Proxy: ${config.proxyUrl || '(Direct connection)'}`)
  console.log('----------------------------------------------------')

  const bot = createBot()

  // Graceful shutdown
  const stop = () => {
    console.log('\n🛑 Stopping bot...')
    bot.stop()
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
  console.error('Fatal error starting bot:', err)
  process.exit(1)
})
