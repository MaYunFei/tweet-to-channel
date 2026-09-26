export interface TweetAuthor {
  name: string
  screenName: string
  avatarUrl: string
  verified?: boolean
}

export interface TweetMedia {
  type: 'photo' | 'video' | 'gif'
  url: string // Image URL or Video Poster/Thumbnail URL
  videoUrl?: string // Direct MP4 URL if type === 'video'
  durationMs?: number
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
  hasVideo?: boolean
}

export type ThemeMode = 'light' | 'dark' | 'dim'
export type VideoMode = 'video' | 'card' | 'both'

export interface BotSettings {
  renderCard: boolean // true: 生成推特长图卡片, false: 原生图文/视频搬运模式
  includeSource: boolean // true: 包含推特原文链接, false: 彻底脱敏抹除来源
  includeTag: boolean // true: 附带 #Twitter 标签, false: 不带标签
  videoMode: VideoMode // 'video' | 'card' | 'both'
  theme: ThemeMode // 'dark' | 'dim' | 'light'
}

export interface RenderOptions {
  theme?: ThemeMode
  scale?: number
}
