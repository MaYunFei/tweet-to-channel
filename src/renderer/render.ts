import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import React from 'react'
import { ProxyAgent } from 'undici'
import { config } from '../config.js'
import { loadFonts } from './fonts.js'
import { TweetCard } from './card.js'
import type { TweetData, RenderOptions } from '../types.js'

let proxyDispatcher: ProxyAgent | undefined
if (config.proxyUrl) {
  proxyDispatcher = new ProxyAgent(config.proxyUrl)
}

/**
 * Fetch remote image and convert to Base64 data URL to satisfy Satori's local-only constraint.
 */
async function toDataUrl(url?: string): Promise<string> {
  if (!url) return ''
  try {
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
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    return `data:${contentType};base64,${base64}`
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
    author: {
      ...tweet.author,
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
      author: {
        ...cloned.quotedTweet.author,
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

  const cardElement = React.createElement(TweetCard, {
    tweet: preparedTweet,
    theme,
  })

  const svg = await satori(cardElement, {
    width: 600,
    fonts: fonts.map(f => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: f.style,
    })),
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
