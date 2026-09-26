import dotenv from 'dotenv'

dotenv.config()

function parseAdminIds(raw?: string): number[] {
  if (!raw) return []
  try {
    if (raw.trim().startsWith('[')) {
      return JSON.parse(raw).map(Number)
    }
    return raw.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0)
  } catch {
    return []
  }
}

export const config = {
  // Telegram Bot Token (from @BotFather)
  botToken: process.env.BOT_TOKEN || '',

  // Whitelisted Telegram User IDs who can use the bot
  adminUserIds: parseAdminIds(process.env.ADMIN_USER_IDS),

  // Target Channel ID or username (e.g. "@my_channel" or "-1001234567890")
  targetChannelId: process.env.TARGET_CHANNEL_ID || '',

  // Theme for generated tweet card: 'dark' | 'light' | 'dim'
  theme: (process.env.THEME || 'dark') as 'light' | 'dark' | 'dim',

  // Optional HTTP/HTTPS/SOCKS proxy (e.g. "http://127.0.0.1:7890")
  proxyUrl: process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '',

  // Whether to reply with the photo in admin private chat as well
  sendToAdmin: process.env.SEND_TO_ADMIN !== 'false',

  // Custom hashtag appended to Telegram caption (e.g. "#Twitter")
  tag: process.env.TAG || '#Twitter',

  // Local font cache directory
  fontDir: process.env.FONT_DIR || './data/fonts',
}
