import { ProxyAgent } from 'undici'
import { config } from '../config.js'
import { getCachedJson, setCachedJson } from '../cache.js'
import type { TweetData, TweetMedia, TweetAuthor, VideoVariant } from '../types.js'

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
async function fetchFromSyndication(tweetId: string): Promise<{ data: TweetData; isTruncated: boolean } | null> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${tweetId}&token=x`
  const res = await fetch(url, getFetchOptions())

  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error(`Syndication API error: ${res.status} ${res.statusText}`)
  }

  const raw = (await res.json()) as Record<string, any>
  // Twitter returns a TweetTombstone or empty object when a tweet is NSFW / Age-restricted / deleted / withheld
  if (!raw || raw.__typename === 'TweetTombstone' || raw.tombstone || !raw.user || !raw.user.screen_name) {
    return null
  }

  return parseSyndicationTweet(raw, tweetId)
}

function parseSyndicationTweet(raw: Record<string, any>, tweetId: string): { data: TweetData; isTruncated: boolean } {
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

      const videoVariants: VideoVariant[] = []
      if (isVideo && m.video_info) {
        durationMs = m.video_info.duration_millis
        if (Array.isArray(m.video_info.variants)) {
          const mp4s = m.video_info.variants
            .filter((v: any) => v.content_type === 'video/mp4' && v.url)
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
          for (const v of mp4s) {
            videoVariants.push({
              url: v.url,
              bitrate: v.bitrate,
              contentType: v.content_type,
            })
          }
          bestVideoUrl = mp4s[0]?.url
        }
      }

      let width = m.width
      let height = m.height
      if ((!width || !height) && bestVideoUrl) {
        const dimMatch = bestVideoUrl.match(/\/(\d+)x(\d+)\//)
        if (dimMatch) {
          width = parseInt(dimMatch[1], 10)
          height = parseInt(dimMatch[2], 10)
        }
      }

      media.push({
        type: isVideo ? 'video' : 'photo',
        url: m.media_url_https || m.media_url || '',
        videoUrl: bestVideoUrl,
        videoVariants: videoVariants.length > 0 ? videoVariants : undefined,
        durationMs,
        width,
        height,
      })
    }
  }

  // Expand URLs and strip trailing photo/video t.co URLs
  // Prioritize Note Tweet (X Premium / Long-form text) if available
  const noteTweetText =
    raw.note_tweet?.note_tweet_results?.result?.text ||
    raw.note_tweet?.text

  let text = noteTweetText || raw.text || raw.full_text || ''

  const noteUrls = raw.note_tweet?.note_tweet_results?.result?.entity_set?.urls
  const rawUrls = raw.entities?.urls
  const allUrls = [
    ...(Array.isArray(noteUrls) ? noteUrls : []),
    ...(Array.isArray(rawUrls) ? rawUrls : []),
  ]

  if (allUrls.length > 0) {
    for (const u of allUrls) {
      if (u.url && (u.expanded_url || u.display_url)) {
        text = text.replace(u.url, u.expanded_url || u.display_url)
      }
    }
  }
  // Remove trailing t.co link pointing to attached media
  text = text.replace(/https?:\/\/t\.co\/\S+$/g, '').trim()

  // Syndication API omits the text body of note_tweet and only supplies its ID.
  // When raw.note_tweet exists without inline text, or if raw.text ends with ellipsis, the text is truncated.
  const isTruncated = Boolean(
    (raw.note_tweet && !noteTweetText) ||
    raw.article ||
    raw.is_note_tweet ||
    text.endsWith('…')
  )

  let quotedTweet: TweetData | null = null
  if (raw.quoted_tweet) {
    quotedTweet = parseSyndicationTweet(raw.quoted_tweet, raw.quoted_tweet.id_str || '').data
  }

  const hasVideo = media.some(m => m.type === 'video')

  return {
    data: {
      id: raw.id_str || tweetId,
      url: `https://x.com/${author.screenName || 'i'}/status/${tweetId}`,
      text,
      author,
      createdAt: raw.created_at || new Date().toISOString(),
      media,
      quotedTweet,
      hasVideo,
      possiblySensitive: Boolean(raw.possibly_sensitive),
      isNoteTweet: Boolean(raw.note_tweet || raw.is_note_tweet),
      isTruncated,
      metrics: {
        likes: raw.favorite_count ?? raw.likes ?? 0,
        retweets: raw.retweet_count ?? raw.retweets ?? 0,
        replies: raw.reply_count ?? raw.conversation_count ?? 0,
        views: raw.views?.count ? parseInt(raw.views.count, 10) : undefined,
      },
    },
    isTruncated,
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

      const videoVariants: VideoVariant[] = []
      if (isVideo) {
        durationMs = m.duration ? Math.round(m.duration * 1000) : undefined
        const candidateList = Array.isArray(m.variants)
          ? m.variants
          : Array.isArray(m.formats)
            ? m.formats
            : []
        if (candidateList.length > 0) {
          const mp4s = candidateList
            .filter((v: any) => (v.content_type === 'video/mp4' || v.container === 'mp4' || v.url?.includes('.mp4')) && v.url)
            .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
          for (const v of mp4s) {
            videoVariants.push({
              url: v.url,
              bitrate: v.bitrate,
              contentType: v.content_type || 'video/mp4',
            })
          }
          bestVideoUrl = mp4s[0]?.url
        }
        if (!bestVideoUrl && m.url && (m.url.includes('.mp4') || m.format === 'video/mp4')) {
          bestVideoUrl = m.url
          videoVariants.push({ url: m.url })
        }
      }

      let width = m.width
      let height = m.height
      if ((!width || !height) && bestVideoUrl) {
        const dimMatch = bestVideoUrl.match(/\/(\d+)x(\d+)\//)
        if (dimMatch) {
          width = parseInt(dimMatch[1], 10)
          height = parseInt(dimMatch[2], 10)
        }
      }

      media.push({
        type: isVideo ? 'video' : 'photo',
        url: m.thumbnail_url || m.url || '',
        videoUrl: bestVideoUrl,
        videoVariants: videoVariants.length > 0 ? videoVariants : undefined,
        durationMs,
        width,
        height,
      })
    }
  }

  let text = tweet.text || ''
  if (tweet.article) {
    const articleTitle = tweet.article.title || ''
    const articlePreview = tweet.article.preview_text || tweet.article.text || ''
    if (!text || text.match(/^https?:\/\/(?:x\.com|twitter\.com)\/i\/article\/\d+/i) || text === articleTitle) {
      text = [articleTitle, articlePreview].filter(Boolean).join('\n\n')
    }
  }
  text = text.replace(/https?:\/\/t\.co\/\S+$/g, '').trim()

  let quotedTweet: TweetData | null = null
  if (tweet.quote) {
    quotedTweet = {
      id: tweet.quote.id || '',
      url: tweet.quote.url || '',
      text: (tweet.quote.text || '').replace(/https?:\/\/t\.co\/\S+$/g, '').trim(),
      author: {
        name: tweet.quote.author?.name || 'Unknown',
        screenName: tweet.quote.author?.screen_name || '',
        avatarUrl: (tweet.quote.author?.avatar_url || '').replace('_normal.', '_400x400.'),
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
    text,
    author,
    createdAt: tweet.created_at || new Date().toISOString(),
    media,
    quotedTweet,
    hasVideo,
    possiblySensitive: Boolean(tweet.possibly_sensitive),
    isNoteTweet: Boolean(tweet.is_note_tweet || tweet.article),
    isTruncated: false,
    metrics: {
      likes: tweet.likes ?? 0,
      retweets: tweet.retweets ?? 0,
      replies: tweet.replies ?? 0,
      views: tweet.views ?? undefined,
    },
  }
}

/**
 * Fetch tweet from VxTwitter API (Tertiary fallback)
 */
async function fetchFromVxTwitter(tweetId: string): Promise<TweetData | null> {
  const url = `https://api.vxtwitter.com/status/${tweetId}`
  const res = await fetch(url, getFetchOptions())

  if (!res.ok) {
    if (res.status === 404) return null
    throw new Error(`VxTwitter API error: ${res.status} ${res.statusText}`)
  }

  const tweet = (await res.json()) as Record<string, any>
  if (!tweet || !tweet.user_screen_name) return null

  const author: TweetAuthor = {
    name: tweet.user_name || 'Unknown',
    screenName: tweet.user_screen_name || '',
    avatarUrl: (tweet.user_profile_image_url || '').replace('_normal.', '_400x400.'),
  }

  const media: TweetMedia[] = []
  if (Array.isArray(tweet.media_extended)) {
    for (const m of tweet.media_extended) {
      const isVideo = m.type === 'video' || m.type === 'gif'
      media.push({
        type: isVideo ? 'video' : 'photo',
        url: m.thumbnail_url || m.url || '',
        videoUrl: isVideo ? m.url : undefined,
        durationMs: m.duration_millis,
        width: m.size?.width,
        height: m.size?.height,
      })
    }
  } else if (Array.isArray(tweet.mediaURLs)) {
    for (const u of tweet.mediaURLs) {
      media.push({
        type: 'photo',
        url: u,
      })
    }
  }

  let text = (tweet.text || '').replace(/https?:\/\/t\.co\/\S+$/g, '').trim()

  return {
    id: tweet.tweetID || tweetId,
    url: tweet.tweetURL || `https://x.com/${author.screenName || 'i'}/status/${tweetId}`,
    text,
    author,
    createdAt: tweet.date || new Date().toISOString(),
    media,
    hasVideo: media.some(m => m.type === 'video'),
    isNoteTweet: Boolean(tweet.text && tweet.text.length > 280),
    isTruncated: false,
    metrics: {
      likes: tweet.likes ?? 0,
      retweets: tweet.retweets ?? 0,
      replies: tweet.replies ?? 0,
    },
  }
}

/**
 * Unified tweet fetcher with automatic fallback and disk cache
 */
export async function getTweetData(tweetId: string, bypassCache = false): Promise<TweetData> {
  if (!bypassCache) {
    const cached = getCachedJson<TweetData>(`tweet:${tweetId}`)
    // Ignore cache if it was saved with truncated text or an unresolved ellipsis
    const looksTruncated = Boolean(
      cached && (cached.isTruncated || (cached.text && cached.text.endsWith('…')))
    )
    if (cached && !looksTruncated) {
      console.log(`[Cache] HIT tweet metadata: ${tweetId}`)
      return cached
    }
  }

  // 1. Try Syndication API first
  let data: TweetData | null = null
  let isTruncated = false

  try {
    const syndResult = await fetchFromSyndication(tweetId)
    if (syndResult) {
      data = syndResult.data
      isTruncated = syndResult.isTruncated
    }
  } catch (err: any) {
    console.warn(`[Fetcher] Syndication API failed for ${tweetId}: ${err.message}. Retrying with FxTwitter...`)
  }

  // 2. If Syndication failed, or if Syndication returned a truncated Note Tweet / long post:
  // Fetch full text from FxTwitter or VxTwitter
  if (!data || isTruncated) {
    let fallbackData: TweetData | null = null
    try {
      fallbackData = await fetchFromFxTwitter(tweetId)
    } catch (err: any) {
      console.warn(`[Fetcher] FxTwitter API failed for ${tweetId}: ${err.message}. Retrying with VxTwitter...`)
    }

    if (!fallbackData) {
      try {
        fallbackData = await fetchFromVxTwitter(tweetId)
      } catch (err: any) {
        console.warn(`[Fetcher] VxTwitter API failed for ${tweetId}: ${err.message}`)
      }
    }

    if (fallbackData) {
      if (!data) {
        data = fallbackData
        isTruncated = false
      } else {
        // Upgrade text if fallback provides longer / complete text
        if (fallbackData.text && fallbackData.text.length > data.text.length) {
          console.log(
            `[Fetcher] Upgraded tweet text for ${tweetId} from fallback (${data.text.length} -> ${fallbackData.text.length} chars)`
          )
          data.text = fallbackData.text
          isTruncated = false
        }
        // Enrich metrics if missing in Syndication
        if (data.metrics.views === undefined && fallbackData.metrics.views !== undefined) {
          data.metrics.views = fallbackData.metrics.views
        }
        if ((!data.metrics.retweets || data.metrics.retweets === 0) && fallbackData.metrics.retweets) {
          data.metrics.retweets = fallbackData.metrics.retweets
        }
        if (fallbackData.isNoteTweet) {
          data.isNoteTweet = true
        }
      }
    }
  }

  if (data) {
    data.isTruncated = isTruncated
    // Only cache if we are confident the text is complete
    if (!isTruncated) {
      setCachedJson(`tweet:${tweetId}`, data)
    }
    return data
  }

  throw new Error(`Could not fetch tweet with ID: ${tweetId}. It may be private or deleted.`)
}
