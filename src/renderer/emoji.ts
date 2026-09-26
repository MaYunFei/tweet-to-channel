import fs from 'node:fs'
import path from 'node:path'
import { ProxyAgent } from 'undici'
import { config } from '../config.js'

let proxyDispatcher: ProxyAgent | undefined
if (config.proxyUrl) {
  proxyDispatcher = new ProxyAgent(config.proxyUrl)
}

const memoryEmojiCache = new Map<string, string>()

function toTwemojiCode(text: string, preserveFe0f = false): string {
  const codePoints: string[] = []
  for (const char of text) {
    const cp = char.codePointAt(0)
    if (cp === undefined) continue
    if (!preserveFe0f && cp === 0xfe0f) continue
    codePoints.push(cp.toString(16))
  }
  return codePoints.join('-')
}

export async function getEmojiAsset(segment: string): Promise<string | undefined> {
  const code = toTwemojiCode(segment, false)
  if (!code) return undefined

  // 1. Check in-memory cache
  if (memoryEmojiCache.has(code)) {
    return memoryEmojiCache.get(code)
  }

  // 2. Check disk cache
  const emojiDir = path.resolve(process.cwd(), './data/emojis')
  if (!fs.existsSync(emojiDir)) {
    fs.mkdirSync(emojiDir, { recursive: true })
  }

  const diskPath = path.join(emojiDir, `${code}.svg`)
  if (fs.existsSync(diskPath)) {
    const svgText = fs.readFileSync(diskPath, 'utf8')
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}`
    memoryEmojiCache.set(code, dataUrl)
    return dataUrl
  }

  // 3. Fetch from Twemoji CDN
  try {
    const fetchOptions: RequestInit & { dispatcher?: any } = {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (TweetToImage/1.0)',
      },
    }
    if (proxyDispatcher) {
      fetchOptions.dispatcher = proxyDispatcher
    }

    let res = await fetch(`https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${code}.svg`, fetchOptions)
    if (!res.ok) {
      // Try with fe0f preserved (for sequences like 🏳️‍🌈)
      const codeWithFe0f = toTwemojiCode(segment, true)
      if (codeWithFe0f !== code) {
        res = await fetch(`https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${codeWithFe0f}.svg`, fetchOptions)
      }
    }

    if (res.ok) {
      const svgText = await res.text()
      fs.writeFileSync(diskPath, svgText, 'utf8')
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}`
      memoryEmojiCache.set(code, dataUrl)
      return dataUrl
    }
  } catch (err: any) {
    console.warn(`[Emoji] Failed to load emoji for segment "${segment}":`, err.message)
  }

  return undefined
}
