import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import React from 'react'
import { ProxyAgent } from 'undici'
import { config } from '../config.js'
import { loadFonts } from './fonts.js'
import { getEmojiAsset } from './emoji.js'
import { TweetCard } from './card.js'
import { getCachedBuffer, setCachedBuffer } from '../cache.js'
import type { TweetData, RenderOptions } from '../types.js'

let proxyDispatcher: ProxyAgent | undefined
if (config.proxyUrl) {
  proxyDispatcher = new ProxyAgent(config.proxyUrl)
}

/**
 * Normalizes text to replace characters that are missing in Noto Sans SC (such as box-drawing characters and Japanese IME symbols)
 * with their visually identical CJK-supported counterparts.
 */
export function normalizeTextForCard(text?: string | null): string {
  if (!text) return ''
  return text
    // Box-drawing vertical bars and Japanese vertical separators (e.g. │ U+2502) -> Fullwidth vertical line (｜ U+FF5C)
    .replace(/[│┃┆┇┊┋∣❘❙❚]/g, '｜')
    // Box-drawing horizontal lines and horizontal bars (e.g. ─ U+2500, ― U+2015) -> Em dash (— U+2014)
    .replace(/[─━┄┅┈┉―]/g, '—')
    // Japanese wave dash (〜 U+301C) -> Fullwidth tilde (～ U+FF5E)
    .replace(/〜/g, '～')
    // Double vertical lines -> Double fullwidth vertical line
    .replace(/[‖∥]/g, '｜｜')
}

/**
 * Fetch remote image and convert to Base64 data URL to satisfy Satori's local-only constraint.
 */
async function toDataUrl(url?: string): Promise<string> {
  if (!url) return ''
  try {
    const cached = getCachedBuffer(url)
    if (cached) {
      const ext = url.split('?')[0].split('.').pop()?.toLowerCase() || 'png'
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png'
      return `data:${mime};base64,${cached.toString('base64')}`
    }

    const fetchOptions: RequestInit & { dispatcher?: any } = {
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TweetCardRenderer/1.0)',
      },
    }
    if (proxyDispatcher) {
      fetchOptions.dispatcher = proxyDispatcher
    }

    const res = await fetch(url, fetchOptions)
    if (!res.ok) return ''
    const contentType = res.headers.get('content-type') || 'image/png'
    const arrayBuffer = await res.arrayBuffer()
    const buf = Buffer.from(arrayBuffer)
    setCachedBuffer(url, buf)
    return `data:${contentType};base64,${buf.toString('base64')}`
  } catch (err) {
    console.warn(`[Render] Failed to fetch image ${url}:`, (err as Error).message)
    return ''
  }
}

/**
 * Clones TweetData and converts all remote image URLs to Base64 Data URLs.
 */
async function prepareTweetImages(tweet: TweetData): Promise<TweetData> {
  const [avatarDataUrl, quotedAvatarDataUrl, ...mediaDataUrls] = await Promise.all([
    toDataUrl(tweet.author.avatarUrl),
    toDataUrl(tweet.quotedTweet?.author.avatarUrl),
    ...tweet.media.map(m => toDataUrl(m.url)),
  ])

  const cloned: TweetData = {
    ...tweet,
    text: normalizeTextForCard(tweet.text),
    translation: tweet.translation ? normalizeTextForCard(tweet.translation) : tweet.translation,
    author: {
      ...tweet.author,
      name: normalizeTextForCard(tweet.author.name),
      avatarUrl: avatarDataUrl || tweet.author.avatarUrl,
    },
    media: tweet.media.map((m, idx) => ({
      ...m,
      url: mediaDataUrls[idx] || m.url,
    })),
  }

  if (cloned.quotedTweet) {
    cloned.quotedTweet = {
      ...cloned.quotedTweet,
      text: normalizeTextForCard(cloned.quotedTweet.text),
      translation: cloned.quotedTweet.translation
        ? normalizeTextForCard(cloned.quotedTweet.translation)
        : cloned.quotedTweet.translation,
      author: {
        ...cloned.quotedTweet.author,
        name: normalizeTextForCard(cloned.quotedTweet.author.name),
        avatarUrl: quotedAvatarDataUrl || cloned.quotedTweet.author.avatarUrl,
      },
    }
  }

  return cloned
}

/**
 * Renders a TweetData object into a high-resolution PNG image buffer.
 */
export async function renderTweetToPng(
  tweet: TweetData,
  options: RenderOptions = {}
): Promise<Buffer> {
  const theme = options.theme || config.theme || 'dark'
  const scale = options.scale || 2 // 2x for crisp Retina rendering

  const [fonts, preparedTweet] = await Promise.all([
    loadFonts(),
    prepareTweetImages(tweet),
  ])

  const fullText = options.fullText !== undefined ? options.fullText : false

  const cardElement = React.createElement(TweetCard, {
    tweet: preparedTweet,
    theme,
    fullText,
  })

  const svg = await satori(cardElement, {
    width: 600,
    fonts: fonts.map(f => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
    loadAdditionalAsset: async (languageCode, segment) => {
      if (languageCode === 'emoji' || languageCode === 'symbol') {
        const asset = await getEmojiAsset(segment)
        if (asset) return asset
      }
      return ''
    },
  })

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 600 * scale },
    shapeRendering: 2,
    textRendering: 2,
    imageRendering: 0,
  })

  const pngData = resvg.render()
  return pngData.asPng()
}
