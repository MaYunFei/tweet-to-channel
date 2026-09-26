import { ProxyAgent } from 'undici'
import { config } from '../config.js'
import type { TweetData, TweetMedia, TweetAuthor } from '../types.js'

let proxyDispatcher: ProxyAgent | undefined
if (config.proxyUrl) {
  proxyDispatcher = new ProxyAgent(config.proxyUrl)
}

function getFetchOptions(): RequestInit & { dispatcher?: any } {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    Accept: '*/*',
  }

  const options: RequestInit & { dispatcher?: any } = {
    headers,
    signal: AbortSignal.timeout(15_000),
  }

  if (proxyDispatcher) {
    options.dispatcher = proxyDispatcher
  }

  return options
}

/**
 * Fetch tweet from Twitter Syndication API (Primary)
 */
async function fetchFromSyndication(tweetId: string): Promise<TweetData | null> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=x`
  const res = await fetch(url, getFetchOptions())

  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error(`Syndication API error: ${res.status} ${res.statusText}`)
  }

  const raw = (await res.json()) as Record<string, any>
  return parseSyndicationTweet(raw, tweetId)
}

function parseSyndicationTweet(raw: Record<string, any>, tweetId: string): TweetData {
  const author: TweetAuthor = {
    name: raw.user?.name || 'Unknown',
    screenName: raw.user?.screen_name || '',
    avatarUrl: (raw.user?.profile_image_url_https || '').replace('_normal.', '_400x400.'),
    verified: Boolean(raw.user?.is_blue_verified || raw.user?.verified),
  }

  const media: TweetMedia[] = []
  if (Array.isArray(raw.mediaDetails)) {
    for (const m of raw.mediaDetails) {
      const isVideo = m.type === 'video' || m.type === 'animated_gif'
      let bestVideoUrl: string | undefined
      let durationMs: number | undefined

      if (isVideo && m.video_info) {
        durationMs = m.video_info.duration_millis
        if (Array.isArray(m.video_info.variants)) {
          const mp4s = m.video_info.variants
            .filter((v: any) => v.content_type === 'video/mp4' && v.url)
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
          bestVideoUrl = mp4s[0]?.url
        }
      }

      media.push({
        type: isVideo ? 'video' : 'photo',
        url: m.media_url_https || m.media_url || '',
        videoUrl: bestVideoUrl,
        durationMs,
        width: m.width,
        height: m.height,
      })
    }
  }

  // Expand URLs and strip trailing photo/video t.co URLs
  let text = raw.text || raw.full_text || ''
  if (raw.entities?.urls && Array.isArray(raw.entities.urls)) {
    for (const u of raw.entities.urls) {
      if (u.url && (u.expanded_url || u.display_url)) {
        text = text.replace(u.url, u.expanded_url || u.display_url)
      }
    }
  }
  // Remove trailing t.co link pointing to attached media
  text = text.replace(/https?:\/\/t\.co\/\S+$/g, '').trim()

  let quotedTweet: TweetData | null = null
  if (raw.quoted_tweet) {
    quotedTweet = parseSyndicationTweet(raw.quoted_tweet, raw.quoted_tweet.id_str || '')
  }

  const hasVideo = media.some(m => m.type === 'video')

  return {
    id: raw.id_str || tweetId,
    url: `https://x.com/${author.screenName || 'i'}/status/${tweetId}`,
    text,
    author,
    createdAt: raw.created_at || new Date().toISOString(),
    media,
    quotedTweet,
    hasVideo,
    metrics: {
      likes: raw.favorite_count ?? raw.likes ?? 0,
      retweets: raw.retweet_count ?? raw.retweets ?? 0,
      replies: raw.reply_count ?? raw.conversation_count ?? 0,
      views: raw.views?.count ? parseInt(raw.views.count, 10) : undefined,
    },
  }
}

/**
 * Fetch tweet from FxTwitter API (Fallback)
 */
async function fetchFromFxTwitter(tweetId: string): Promise<TweetData | null> {
  const url = `https://api.fxtwitter.com/status/${tweetId}`
  const res = await fetch(url, getFetchOptions())

  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error(`FxTwitter API error: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as Record<string, any>
  const tweet = data.tweet
  if (!tweet) return null

  const author: TweetAuthor = {
    name: tweet.author?.name || 'Unknown',
    screenName: tweet.author?.screen_name || '',
    avatarUrl: (tweet.author?.avatar_url || '').replace('_normal.', '_400x400.'),
    verified: Boolean(tweet.author?.is_blue_verified || tweet.author?.is_verified),
  }

  const media: TweetMedia[] = []
  const allMedia = tweet.media?.all || tweet.media?.videos || tweet.media?.photos || []

  if (Array.isArray(allMedia)) {
    for (const m of allMedia) {
      const isVideo = m.type === 'video' || m.type === 'gif'
      let bestVideoUrl: string | undefined
      let durationMs: number | undefined

      if (isVideo) {
        durationMs = m.duration ? Math.round(m.duration * 1000) : undefined
        if (Array.isArray(m.variants)) {
          const mp4s = m.variants
            .filter((v: any) => v.content_type === 'video/mp4' && v.url)
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
          bestVideoUrl = mp4s[0]?.url
        }
        if (!bestVideoUrl && m.url && m.url.endsWith('.mp4')) {
          bestVideoUrl = m.url
        }
      }

      media.push({
        type: isVideo ? 'video' : 'photo',
        url: m.thumbnail_url || m.url || '',
        videoUrl: bestVideoUrl,
        durationMs,
        width: m.width,
        height: m.height,
      })
    }
  }

  let quotedTweet: TweetData | null = null
  if (tweet.quote) {
    quotedTweet = {
      id: tweet.quote.id || '',
      url: tweet.quote.url || '',
      text: tweet.quote.text || '',
      author: {
        name: tweet.quote.author?.name || 'Unknown',
        screenName: tweet.quote.author?.screen_name || '',
        avatarUrl: tweet.quote.author?.avatar_url || '',
      },
      createdAt: tweet.quote.created_at || '',
      media: [],
      metrics: {},
    }
  }

  const hasVideo = media.some(m => m.type === 'video')

  return {
    id: tweet.id || tweetId,
    url: tweet.url || `https://x.com/${author.screenName || 'i'}/status/${tweetId}`,
    text: tweet.text || '',
    author,
    createdAt: tweet.created_at || new Date().toISOString(),
    media,
    quotedTweet,
    hasVideo,
    metrics: {
      likes: tweet.likes ?? 0,
      retweets: tweet.retweets ?? 0,
      replies: tweet.replies ?? 0,
      views: tweet.views ?? undefined,
    },
  }
}

/**
 * Unified tweet fetcher with automatic fallback
 */
export async function getTweetData(tweetId: string): Promise<TweetData> {
  // 1. Try Syndication API first
  try {
    const data = await fetchFromSyndication(tweetId)
    if (data) return data
  } catch (err: any) {
    console.warn(`[Fetcher] Syndication API failed for ${tweetId}: ${err.message}. Retrying with FxTwitter...`)
  }

  // 2. Fallback to FxTwitter
  try {
    const data = await fetchFromFxTwitter(tweetId)
    if (data) return data
  } catch (err: any) {
    console.warn(`[Fetcher] FxTwitter API failed for ${tweetId}: ${err.message}`)
  }

  throw new Error(`Could not fetch tweet with ID: ${tweetId}. It may be private or deleted.`)
}
