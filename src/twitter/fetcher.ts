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
      media.push({
        type: m.type === 'photo' ? 'photo' : 'video',
        url: m.media_url_https || m.media_url || '',
        width: m.width,
        height: m.height,
      })
    }
  }

  // Expand URLs and strip trailing photo t.co URLs
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

  return {
    id: raw.id_str || tweetId,
    url: `https://x.com/${author.screenName || 'i'}/status/${tweetId}`,
    text,
    author,
    createdAt: raw.created_at || new Date().toISOString(),
    media,
    quotedTweet,
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
  if (Array.isArray(tweet.media?.all)) {
    for (const m of tweet.media.all) {
      media.push({
        type: m.type === 'photo' ? 'photo' : 'video',
        url: m.url || m.thumbnail_url || '',
        width: m.width,
        height: m.height,
      })
    }
  } else if (Array.isArray(tweet.media?.photos)) {
    for (const p of tweet.media.photos) {
      media.push({
        type: 'photo',
        url: p.url,
        width: p.width,
        height: p.height,
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

  return {
    id: tweet.id || tweetId,
    url: tweet.url || `https://x.com/${author.screenName || 'i'}/status/${tweetId}`,
    text: tweet.text || '',
    author,
    createdAt: tweet.created_at || new Date().toISOString(),
    media,
    quotedTweet,
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
