import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import type { BotSettings } from './types.js'

const SETTINGS_FILE = path.resolve(process.cwd(), './data/settings.json')

let currentSettings: BotSettings = {
  renderCard: process.env.RENDER_CARD !== 'false',
  includeSource: process.env.INCLUDE_SOURCE !== 'false',
  includeTag: process.env.INCLUDE_TAG !== 'false',
  enableTranslation: config.enableTranslation,
  enableSpoiler: config.enableSpoiler,
  videoMode: config.videoMode,
  attachPhotos: config.attachPhotos,
  theme: config.theme,
}

// Load persisted settings from disk if available
try {
  if (fs.existsSync(SETTINGS_FILE)) {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    currentSettings = { ...currentSettings, ...parsed }
  }
} catch (err: any) {
  console.warn('[Settings] Failed to load settings.json, using defaults:', err.message)
}

export function getSettings(): BotSettings {
  return { ...currentSettings }
}

export function updateSettings(partial: Partial<BotSettings>): BotSettings {
  currentSettings = { ...currentSettings, ...partial }
  try {
    const dir = path.dirname(SETTINGS_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(currentSettings, null, 2), 'utf8')
  } catch (err: any) {
    console.error('[Settings] Failed to save settings to disk:', err.message)
  }
  return { ...currentSettings }
}
