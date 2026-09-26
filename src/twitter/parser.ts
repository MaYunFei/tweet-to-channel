const TWEET_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com|vxtwitter\.com|fxtwitter\.com|fixupx\.com)\/[a-zA-Z0-9_]+\/status(?:es)?\/(\d+)/gi

const STATUS_ID_REGEX = /^\d{1,25}$/

export interface ExtractedTweet {
  id: string
  url: string
}

/**
 * Extracts all unique tweet IDs and their normalized URLs from a given text.
 */
export function extractTweetUrls(text: string): ExtractedTweet[] {
  const results: ExtractedTweet[] = []
  const seen = new Set<string>()

  const trimmed = text.trim()
  if (STATUS_ID_REGEX.test(trimmed)) {
    return [{ id: trimmed, url: `https://x.com/i/status/${trimmed}` }]
  }

  let match: RegExpExecArray | null
  while ((match = TWEET_URL_REGEX.exec(text)) !== null) {
    const id = match[1]
    if (!seen.has(id)) {
      seen.add(id)
      results.push({
        id,
        url: `https://x.com/i/status/${id}`,
      })
    }
  }

  return results
}

/**
 * Extracts a single tweet ID from a URL or raw ID.
 */
export function extractTweetId(input: string): string | null {
  const tweets = extractTweetUrls(input)
  return tweets.length > 0 ? tweets[0].id : null
}
