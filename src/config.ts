import dotenv from 'dotenv'
import type { ThemeMode, VideoMode } from './types.js'

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

function parseTargetChannels(raw?: string): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

export const config = {
  // Telegram Bot Token (from @BotFather)
  botToken: process.env.BOT_TOKEN || '',

  // Whitelisted Telegram User IDs who can use the bot
  adminUserIds: parseAdminIds(process.env.ADMIN_USER_IDS),

  // Target Channel IDs or usernames (e.g. "@my_channel" or "-1001234567890", supports comma-separated list)
  targetChannelIds: parseTargetChannels(process.env.TARGET_CHANNEL_ID),

  get targetChannelId(): string {
    return this.targetChannelIds[0] || ''
  },

  // Theme for generated tweet card: 'dark' | 'light' | 'dim'
  theme: (process.env.THEME || 'dark') as ThemeMode,

  // Handling mode when tweet contains a video:
  // - 'video': Downloads high-res MP4 and posts as Telegram native video (playable in BroadcastChannel!)
  // - 'card': Generates a tweet card image with video poster & play badge
  // - 'both': Posts both the card image and the video
  videoMode: (process.env.VIDEO_MODE || 'video') as VideoMode,

  // Optional HTTP/HTTPS/SOCKS proxy (e.g. "http://127.0.0.1:7890")
  proxyUrl: process.env.PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '',

  // Whether to reply with the media in admin private chat as well
  sendToAdmin: process.env.SEND_TO_ADMIN !== 'false',

  // Custom hashtag appended to Telegram caption (e.g. "#Twitter")
  tag: process.env.TAG || '#Twitter',

  // Custom Telegram Bot API root (for self-hosted local Bot API server)
  // Increases file upload limit from 50MB to 2000MB (2GB)
  telegramApiRoot: process.env.TELEGRAM_API_ROOT || '',

  // Local font cache directory
  fontDir: process.env.FONT_DIR || './data/fonts',

  // Whether to enable bilingual translation by default (free Google Translate)
  enableTranslation: process.env.ENABLE_TRANSLATION !== 'false',

  // Whether to attach original high-res photos alongside card image (as a media album)
  attachPhotos: process.env.ATTACH_PHOTOS !== 'false',

  // Whether to automatically blur sensitive/NSFW media with Telegram spoiler (true / false)
  enableSpoiler: process.env.ENABLE_SPOILER !== 'false',

  // Local media & metadata cache directory
  cacheDir: process.env.CACHE_DIR || './data/cache',

  // Cache expiration time in hours (default: 24 hours)
  cacheTtlHours: Number(process.env.CACHE_TTL_HOURS) || 24,
}
