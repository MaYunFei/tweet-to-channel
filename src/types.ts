export interface TweetAuthor {
  name: string
  screenName: string
  avatarUrl: string
  verified?: boolean
}

export interface TweetMedia {
  type: 'photo' | 'video' | 'gif'
  url: string
  width?: number
  height?: number
}

export interface TweetMetrics {
  likes?: number
  retweets?: number
  replies?: number
  views?: number
}

export interface TweetData {
  id: string
  url: string
  text: string
  author: TweetAuthor
  createdAt: string
  media: TweetMedia[]
  quotedTweet?: TweetData | null
  metrics: TweetMetrics
}

export type ThemeMode = 'light' | 'dark' | 'dim'

export interface RenderOptions {
  theme?: ThemeMode
  scale?: number
}
