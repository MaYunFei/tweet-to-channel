export interface TweetAuthor {
  name: string
  screenName: string
  avatarUrl: string
  verified?: boolean
}

export interface VideoVariant {
  url: string
  bitrate?: number
  contentType?: string
}

export interface TweetMedia {
  type: 'photo' | 'video' | 'gif'
  url: string // Image URL or Video Poster/Thumbnail URL
  videoUrl?: string // Direct MP4 URL if type === 'video'
  videoVariants?: VideoVariant[] // Candidate MP4 video variants sorted by bitrate descending
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
  translation?: string | null
  author: TweetAuthor
  createdAt: string
  media: TweetMedia[]
  quotedTweet?: TweetData | null
  metrics: TweetMetrics
  hasVideo?: boolean
  possiblySensitive?: boolean
  isTruncated?: boolean
  isNoteTweet?: boolean
}

export type ThemeMode = 'light' | 'dark' | 'dim'
export type VideoMode = 'video' | 'card' | 'both'

export interface BotSettings {
  renderCard: boolean // true: 生成推特长图卡片, false: 原生图文/视频搬运模式
  includeSource: boolean // true: 包含推特原文链接, false: 彻底脱敏抹除来源
  includeTag: boolean // true: 附带 #Twitter 标签, false: 不带标签
  enableTranslation: boolean // true: 开启双语翻译, false: 关闭双语翻译
  enableSpoiler: boolean // true: 遇到敏感/成人内容时为图片和视频启用 Telegram 磨砂遮罩 (has_spoiler), false: 不遮挡
  videoMode: VideoMode // 'video' | 'card' | 'both'
  attachPhotos: boolean // true: 卡片模式下附带高清原图相册, false: 仅发卡片
  theme: ThemeMode // 'dark' | 'dim' | 'light'
}

export interface RenderOptions {
  theme?: ThemeMode
  scale?: number
  showTranslation?: boolean
  fullText?: boolean
}
