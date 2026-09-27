import { Bot, InputFile } from 'grammy'
import { setGlobalDispatcher, ProxyAgent } from 'undici'
import { config } from './config.js'
import { getSettings } from './settings.js'
import { toOriginalTwitterImageUrl } from './twitter/parser.js'
import { getTweetData } from './twitter/fetcher.js'
import { translateToChinese } from './translate/google.js'
import { renderTweetToPng } from './renderer/render.js'
import { getCachedBuffer, setCachedBuffer } from './cache.js'
import type { TweetData, BotSettings, TweetMedia } from './types.js'

export let proxyDispatcher: ProxyAgent | undefined
if (config.proxyUrl) {
  proxyDispatcher = new ProxyAgent(config.proxyUrl)
  setGlobalDispatcher(proxyDispatcher)
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export interface CaptionResult {
  caption: string
  isTruncated: boolean
}

export function buildCaption(tweet: TweetData, settings: BotSettings): CaptionResult {
  const parts: string[] = []

  if (settings.includeSource) {
    let videoNote = ''
    if (tweet.hasVideo) {
      const v = tweet.media.find(m => m.type === 'video')
      const sec = v?.durationMs ? `${Math.round(v.durationMs / 1000)}秒` : ''
      videoNote = `▶️ 视频推文${sec ? ` (${sec})` : ''}\n`
    }
    parts.push(`${videoNote}🔗 原文：${tweet.url}`)
  }

  if (settings.includeTag && config.tag) {
    parts.push(config.tag)
  }

  const suffix = parts.length > 0 ? `\n\n${parts.join('\n')}` : ''
  const maxBodyLen = 1024 - suffix.length - 5

  let fullBody = tweet.text
  if (settings.enableTranslation && tweet.translation) {
    fullBody = `${tweet.text}\n\n🌐 译文：\n${tweet.translation}`
  }

  const isTruncated = fullBody.length > maxBodyLen
  let body = fullBody
  if (isTruncated) {
    body = fullBody.slice(0, maxBodyLen - 3) + '...'
  }

  return {
    caption: `${body}${suffix}`.trim(),
    isTruncated,
  }
}

export function buildFullTextMessage(tweet: TweetData, settings: BotSettings): string {
  const parts: string[] = []

  if (settings.enableTranslation && tweet.translation) {
    parts.push(
      `📖 <b>推文全文与译文</b>：\n\n${escapeHtml(tweet.text)}\n\n🌐 <b>中文译文：</b>\n${escapeHtml(tweet.translation)}`
    )
  } else {
    parts.push(`📖 <b>推文全文</b>：\n\n${escapeHtml(tweet.text)}`)
  }

  const footers: string[] = []
  if (settings.includeSource) {
    footers.push(`🔗 原文：${tweet.url}`)
  }
  if (settings.includeTag && config.tag) {
    footers.push(config.tag)
  }
  if (footers.length > 0) {
    parts.push(footers.join('\n'))
  }

  return parts.join('\n\n')
}

export async function sendLongMessage(
  bot: Bot,
  chatId: string | number,
  htmlText: string
): Promise<void> {
  const MAX_CHUNK = 4000
  if (htmlText.length <= MAX_CHUNK) {
    await bot.api.sendMessage(chatId, htmlText, { parse_mode: 'HTML' })
    return
  }

  let remaining = htmlText
  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK) {
      await bot.api.sendMessage(chatId, remaining, { parse_mode: 'HTML' })
      break
    }
    let splitIdx = remaining.lastIndexOf('\n', MAX_CHUNK)
    if (splitIdx === -1 || splitIdx < 1000) {
      splitIdx = MAX_CHUNK
    }
    const chunk = remaining.slice(0, splitIdx).trim()
    remaining = remaining.slice(splitIdx).trim()
    if (chunk) {
      await bot.api.sendMessage(chatId, chunk, { parse_mode: 'HTML' })
    }
  }
}

async function sendFollowUpFullTextIfNeeded(
  bot: Bot,
  tweet: TweetData,
  settings: BotSettings,
  isTruncated: boolean,
  channelIds: string[],
  adminIds: number[]
): Promise<void> {
  if (!isTruncated) return

  const fullTextMsg = buildFullTextMessage(tweet, settings)

  for (const chId of channelIds) {
    try {
      await sendLongMessage(bot, chId, fullTextMsg)
    } catch (err: any) {
      console.error(`[Processor] Failed to send full text to channel ${chId}:`, err.message)
    }
  }

  for (const adminId of adminIds) {
    try {
      await sendLongMessage(bot, adminId, fullTextMsg)
    } catch (err: any) {
      console.warn(`[Processor] Failed to send full text to admin ${adminId}:`, err.message)
    }
  }
}

/**
 * Universal media downloader with disk cache
 */
export async function downloadBuffer(
  url: string,
  timeoutMs = 45_000,
  maxBytes = 50 * 1024 * 1024,
  bypassCache = false
): Promise<Buffer | null> {
  if (!bypassCache) {
    const cached = getCachedBuffer(url)
    if (cached) {
      if (maxBytes && cached.length > maxBytes) {
        console.warn(`[Download] Cached file exceeds limit: ${(cached.length / 1024 / 1024).toFixed(1)} MB`)
        return null
      }
      return cached
    }
  }

  try {
    const fetchOptions: RequestInit & { dispatcher?: any } = {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
    }
    if (proxyDispatcher) {
      fetchOptions.dispatcher = proxyDispatcher
    }

    const res = await fetch(url, fetchOptions)
    if (!res.ok) return null

    const contentLength = Number(res.headers.get('content-length') || 0)
    if (contentLength > maxBytes) {
      console.warn(`[Download] File too large: ${(contentLength / 1024 / 1024).toFixed(1)} MB`)
      return null
    }

    const arrayBuffer = await res.arrayBuffer()
    const buf = Buffer.from(arrayBuffer)
    if (buf.length > maxBytes) {
      console.warn(`[Download] Buffer exceeds limit: ${(buf.length / 1024 / 1024).toFixed(1)} MB`)
      return null
    }
    setCachedBuffer(url, buf)
    return buf
  } catch (err: any) {
    console.warn(`[Download] Failed from ${url}:`, err.message)
    return null
  }
}

/**
 * Inspects MP4 header box (tkhd) to extract actual video track width and height
 */
export function getMp4Dimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    let offset = 0
    while (offset < buffer.length - 8) {
      const size = buffer.readUInt32BE(offset)
      const type = buffer.toString('ascii', offset + 4, offset + 8)
      if (type === 'moov' || type === 'trak' || type === 'mdia') {
        offset += 8
        continue
      }
      if (type === 'tkhd') {
        const version = buffer.readUInt8(offset + 8)
        const widthOffset = version === 0 ? offset + 84 : offset + 96
        if (widthOffset + 8 <= buffer.length) {
          const width = buffer.readUInt32BE(widthOffset) >> 16
          const height = buffer.readUInt32BE(widthOffset + 4) >> 16
          if (width > 0 && height > 0) {
            return { width, height }
          }
        }
      }
      if (size <= 0) break
      offset += size
    }
  } catch {}
  return null
}

export function parseDimensionsFromUrl(url: string): { width: number; height: number } | null {
  const match = url.match(/\/(\d+)x(\d+)\//)
  if (match) {
    return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) }
  }
  return null
}

/**
 * Downloads the best matching video variant that fits under maxBytes (e.g. 50MB limit)
 * and accurately determines the actual video width and height.
 */
export async function downloadBestVideo(
  videoMedia: TweetMedia,
  maxBytes: number,
  onStatusUpdate?: (text: string) => Promise<any>,
  bypassCache = false
): Promise<{ buffer: Buffer; url: string; width?: number; height?: number } | null> {
  const candidateUrls: string[] = []
  if (videoMedia.videoVariants && videoMedia.videoVariants.length > 0) {
    for (const v of videoMedia.videoVariants) {
      if (v.url && !candidateUrls.includes(v.url)) {
        candidateUrls.push(v.url)
      }
    }
  }
  if (videoMedia.videoUrl && !candidateUrls.includes(videoMedia.videoUrl)) {
    candidateUrls.unshift(videoMedia.videoUrl)
  }

  for (let i = 0; i < candidateUrls.length; i++) {
    const url = candidateUrls[i]
    if (i > 0 && onStatusUpdate) {
      await onStatusUpdate(`⏳ 原画质超过限制 (${(maxBytes / 1024 / 1024).toFixed(0)}MB)，正在自适应切换备选画质 (${i + 1}/${candidateUrls.length})...`).catch(() => {})
    }
    const buf = await downloadBuffer(url, 60_000, maxBytes, bypassCache)
    if (buf) {
      const dimensions = getMp4Dimensions(buf) || parseDimensionsFromUrl(url)
      const width = dimensions?.width || videoMedia.width
      const height = dimensions?.height || videoMedia.height
      return { buffer: buf, url, width, height }
    }
  }
  return null
}

export interface TweetJob {
  tweetId: string
  source: 'telegram' | 'api'
  telegramContext?: {
    chatId: number
    statusMessageId?: number
  }
  settings?: BotSettings
  forceSpoiler?: boolean
  bypassCache?: boolean
}

/**
 * Process a single tweet task: fetch, translate, render/download, and publish.
 */
export async function processTweetJob(bot: Bot, job: TweetJob): Promise<void> {
  const effectiveSettings = job.settings || getSettings()
  const maxVideoBytes = config.telegramApiRoot ? 2000 * 1024 * 1024 : 50 * 1024 * 1024
  const channelsStr = config.targetChannelIds.join(', ')

  const updateStatus = async (text: string) => {
    if (job.source === 'telegram' && job.telegramContext?.statusMessageId) {
      await bot.api.editMessageText(job.telegramContext.chatId, job.telegramContext.statusMessageId, text).catch(() => {})
    } else {
      console.log(`[Processor] [${job.tweetId}] ${text}`)
    }
  }

  const notifyError = async (message: string) => {
    if (job.source === 'telegram' && job.telegramContext?.statusMessageId) {
      await bot.api.editMessageText(
        job.telegramContext.chatId,
        job.telegramContext.statusMessageId,
        `❌ 处理推文失败 (${job.tweetId})：\n${message}`
      ).catch(() => {})
    } else if (job.source === 'api') {
      console.error(`[Processor] Task error for tweet ${job.tweetId}:`, message)
      if (config.adminUserIds.length > 0) {
        for (const adminId of config.adminUserIds) {
          try {
            await bot.api.sendMessage(
              adminId,
              `❌ <b>[快捷指令] 推文处理失败</b>\n\n• 推文 ID: <code>${job.tweetId}</code>\n• 原因: ${message}`,
              { parse_mode: 'HTML' }
            )
          } catch (e: any) {
            console.warn(`[Processor] Failed to notify admin ${adminId}:`, e.message)
          }
        }
      }
    }
  }

  try {
    // 1. Fetch tweet metadata
    await updateStatus(`⏳ 正在获取推文：${job.tweetId} ...`)
    const tweet = await getTweetData(job.tweetId, job.bypassCache)

    // 2. Translate if enabled
    if (effectiveSettings.enableTranslation) {
      await updateStatus(`⏳ 正在翻译推文 (${job.tweetId})...`)
      tweet.translation = await translateToChinese(tweet.text, job.bypassCache)
      if (tweet.quotedTweet) {
        tweet.quotedTweet.translation = await translateToChinese(tweet.quotedTweet.text, job.bypassCache)
      }
    }

    const { caption, isTruncated } = buildCaption(tweet, effectiveSettings)
    const shouldSpoiler = job.forceSpoiler !== undefined
      ? job.forceSpoiler
      : (effectiveSettings.enableSpoiler && Boolean(tweet.possiblySensitive))

    // Determine admin targets
    const shouldSendToAdmin = config.sendToAdmin || config.targetChannelIds.length === 0
    let adminChatIds: number[] = []
    if (shouldSendToAdmin) {
      if (job.source === 'telegram' && job.telegramContext) {
        adminChatIds = [job.telegramContext.chatId]
      } else if (job.source === 'api') {
        adminChatIds = config.adminUserIds
      }
    }

    // Helper for admin caption prefix
    const getAdminCaption = (isChannelSent: boolean) => {
      if (job.source === 'api') {
        return isChannelSent
          ? `✅ [快捷指令] 已发布到频道 ${channelsStr}\n\n${caption}`
          : `✅ [快捷指令] 已处理推文\n\n${caption}`
      }
      return isChannelSent
        ? `✅ 已发布到频道 ${channelsStr}\n\n${caption}`
        : caption
    }

    // =========================================================================
    // BRANCH A: 原生搬运模式 (renderCard === false)
    // =========================================================================
    if (!effectiveSettings.renderCard) {
      const videoMedia = tweet.media.find(m => m.type === 'video' && (m.videoUrl || m.videoVariants?.length))

      // 1. Tweet has video
      if (videoMedia) {
        await updateStatus(`⏳ 正在下载原生高清视频 (${job.tweetId})...`)
        const downloadRes = await downloadBestVideo(
          videoMedia,
          maxVideoBytes,
          (msg) => updateStatus(msg),
          job.bypassCache
        )

        if (downloadRes) {
          let channelSent = false
          for (const chId of config.targetChannelIds) {
            try {
              await bot.api.sendVideo(chId, new InputFile(downloadRes.buffer, `video-${job.tweetId}.mp4`), {
                caption,
                width: downloadRes.width,
                height: downloadRes.height,
                duration: videoMedia.durationMs ? Math.round(videoMedia.durationMs / 1000) : undefined,
                has_spoiler: shouldSpoiler,
                supports_streaming: true,
              })
              channelSent = true
            } catch (err: any) {
              console.error(`[Processor] Failed to send video to ${chId}:`, err.message)
              if (job.source === 'telegram' && job.telegramContext) {
                await bot.api.sendMessage(job.telegramContext.chatId, `⚠️ 发送视频到频道 ${chId} 失败：${err.message}`).catch(() => {})
              }
            }
          }

          if (adminChatIds.length > 0) {
            const adminCaption = getAdminCaption(channelSent)
            for (const adminId of adminChatIds) {
              try {
                await bot.api.sendVideo(adminId, new InputFile(downloadRes.buffer, `video-${job.tweetId}.mp4`), {
                  caption: adminCaption,
                  width: downloadRes.width,
                  height: downloadRes.height,
                  duration: videoMedia.durationMs ? Math.round(videoMedia.durationMs / 1000) : undefined,
                  has_spoiler: shouldSpoiler,
                  supports_streaming: true,
                })
              } catch (e: any) {
                console.warn(`[Processor] Failed to send video archive to admin ${adminId}:`, e.message)
              }
            }
          }

          // Follow up with complete text message if truncated
          await sendFollowUpFullTextIfNeeded(bot, tweet, effectiveSettings, isTruncated, config.targetChannelIds, adminChatIds)

          if (job.source === 'telegram' && job.telegramContext?.statusMessageId) {
            await bot.api.deleteMessage(job.telegramContext.chatId, job.telegramContext.statusMessageId).catch(() => {})
          }
          return
        }
      }

      // 2. Tweet has photo(s)
      const photos = tweet.media.filter(m => m.type === 'photo')
      if (photos.length > 0) {
        await updateStatus(`⏳ 正在下载 ${photos.length} 张高清原图 (${job.tweetId})...`)
        const photoBuffers = (await Promise.all(
          photos.map(p => downloadBuffer(toOriginalTwitterImageUrl(p.url), 15_000, 20 * 1024 * 1024, job.bypassCache))
        )).filter((b): b is Buffer => Boolean(b))

        if (photoBuffers.length === 1) {
          let channelSent = false
          for (const chId of config.targetChannelIds) {
            try {
              await bot.api.sendPhoto(chId, new InputFile(photoBuffers[0], `photo-${job.tweetId}.jpg`), {
                caption,
                has_spoiler: shouldSpoiler,
              })
              channelSent = true
            } catch (err: any) {
              console.error(`[Processor] Failed to send photo to ${chId}:`, err.message)
              if (job.source === 'telegram' && job.telegramContext) {
                await bot.api.sendMessage(job.telegramContext.chatId, `⚠️ 发送图片到频道 ${chId} 失败：${err.message}`).catch(() => {})
              }
            }
          }

          if (adminChatIds.length > 0) {
            const adminCaption = getAdminCaption(channelSent)
            for (const adminId of adminChatIds) {
              try {
                await bot.api.sendPhoto(adminId, new InputFile(photoBuffers[0], `photo-${job.tweetId}.jpg`), {
                  caption: adminCaption,
                  has_spoiler: shouldSpoiler,
                })
              } catch (e: any) {
                console.warn(`[Processor] Failed to send photo archive to admin ${adminId}:`, e.message)
              }
            }
          }

          // Follow up with complete text message if truncated
          await sendFollowUpFullTextIfNeeded(bot, tweet, effectiveSettings, isTruncated, config.targetChannelIds, adminChatIds)

          if (job.source === 'telegram' && job.telegramContext?.statusMessageId) {
            await bot.api.deleteMessage(job.telegramContext.chatId, job.telegramContext.statusMessageId).catch(() => {})
          }
          return
        } else if (photoBuffers.length > 1) {
          let channelSent = false
          for (const chId of config.targetChannelIds) {
            try {
              const mediaGroup = photoBuffers.map((buf, idx) => ({
                type: 'photo' as const,
                media: new InputFile(buf, `photo-${idx}.jpg`),
                has_spoiler: shouldSpoiler,
                ...(idx === 0 ? { caption } : {}),
              }))
              await bot.api.sendMediaGroup(chId, mediaGroup)
              channelSent = true
            } catch (err: any) {
              console.error(`[Processor] Failed to send media group to ${chId}:`, err.message)
              if (job.source === 'telegram' && job.telegramContext) {
                await bot.api.sendMessage(job.telegramContext.chatId, `⚠️ 发送相册到频道 ${chId} 失败：${err.message}`).catch(() => {})
              }
            }
          }

          if (adminChatIds.length > 0) {
            const adminCaption = getAdminCaption(channelSent)
            for (const adminId of adminChatIds) {
              try {
                const adminGroup = photoBuffers.map((buf, idx) => ({
                  type: 'photo' as const,
                  media: new InputFile(buf, `photo-${idx}.jpg`),
                  has_spoiler: shouldSpoiler,
                  ...(idx === 0 ? { caption: adminCaption } : {}),
                }))
                await bot.api.sendMediaGroup(adminId, adminGroup)
              } catch (e: any) {
                console.warn(`[Processor] Failed to send album archive to admin ${adminId}:`, e.message)
              }
            }
          }

          // Follow up with complete text message if truncated
          await sendFollowUpFullTextIfNeeded(bot, tweet, effectiveSettings, isTruncated, config.targetChannelIds, adminChatIds)

          if (job.source === 'telegram' && job.telegramContext?.statusMessageId) {
            await bot.api.deleteMessage(job.telegramContext.chatId, job.telegramContext.statusMessageId).catch(() => {})
          }
          return
        }
      }

      // 3. Pure text tweet (send full content directly without truncation)
      let channelSent = false
      const fullTextMsg = buildFullTextMessage(tweet, effectiveSettings)

      for (const chId of config.targetChannelIds) {
        try {
          await sendLongMessage(bot, chId, fullTextMsg)
          channelSent = true
        } catch (err: any) {
          console.error(`[Processor] Failed to send message to ${chId}:`, err.message)
          if (job.source === 'telegram' && job.telegramContext) {
            await bot.api.sendMessage(job.telegramContext.chatId, `⚠️ 发送消息到频道 ${chId} 失败：${err.message}`).catch(() => {})
          }
        }
      }

      if (adminChatIds.length > 0) {
        const adminPrefix = job.source === 'api'
          ? (channelSent ? `✅ [快捷指令] 已发布到频道 ${channelsStr}\n\n` : `✅ [快捷指令] 已处理推文\n\n`)
          : (channelSent ? `✅ 已发布到频道 ${channelsStr}\n\n` : '')

        for (const adminId of adminChatIds) {
          try {
            await sendLongMessage(bot, adminId, adminPrefix ? `${adminPrefix}${fullTextMsg}` : fullTextMsg)
          } catch (e: any) {
            console.warn(`[Processor] Failed to send text archive to admin ${adminId}:`, e.message)
          }
        }
      }

      if (job.source === 'telegram' && job.telegramContext?.statusMessageId) {
        await bot.api.deleteMessage(job.telegramContext.chatId, job.telegramContext.statusMessageId).catch(() => {})
      }
      return
    }

    // =========================================================================
    // BRANCH B: 推特卡片渲染模式 (renderCard === true)
    // =========================================================================
    const videoMedia = tweet.media.find(m => m.type === 'video' && (m.videoUrl || m.videoVariants?.length))
    let downloadedVideo: { buffer: Buffer; url: string; width?: number; height?: number } | null = null

    if (videoMedia && (effectiveSettings.videoMode === 'video' || effectiveSettings.videoMode === 'both')) {
      await updateStatus(`⏳ 发现推特视频，正在下载高清 MP4 (${job.tweetId})...`)
      downloadedVideo = await downloadBestVideo(
        videoMedia,
        maxVideoBytes,
        (msg) => updateStatus(msg),
        job.bypassCache
      )
    }

    let pngBuffer: Buffer | null = null
    if (!downloadedVideo || effectiveSettings.videoMode === 'card' || effectiveSettings.videoMode === 'both') {
      await updateStatus(`⏳ 正在渲染推特卡片 (${job.tweetId})...`)
      pngBuffer = await renderTweetToPng(tweet, {
        theme: effectiveSettings.theme,
        scale: 2,
      })
    }

    // Fetch high-res original photos if tweet contains photos and attachPhotos is enabled
    const photos = tweet.media.filter(m => m.type === 'photo')
    let photoBuffers: Buffer[] = []
    if (photos.length > 0 && effectiveSettings.attachPhotos) {
      await updateStatus(`⏳ 正在下载 ${photos.length} 张高清原图 (${job.tweetId})...`)
      photoBuffers = (await Promise.all(
        photos.map(p => downloadBuffer(toOriginalTwitterImageUrl(p.url), 20_000, 20 * 1024 * 1024, job.bypassCache))
      )).filter((b): b is Buffer => Boolean(b))
    }

    let channelSent = false

    if (config.targetChannelIds.length > 0) {
      for (const chId of config.targetChannelIds) {
        try {
          if (downloadedVideo && (effectiveSettings.videoMode === 'video' || effectiveSettings.videoMode === 'both')) {
            await bot.api.sendVideo(chId, new InputFile(downloadedVideo.buffer, `tweet-${job.tweetId}.mp4`), {
              caption,
              width: downloadedVideo.width,
              height: downloadedVideo.height,
              duration: videoMedia?.durationMs ? Math.round(videoMedia.durationMs / 1000) : undefined,
              has_spoiler: shouldSpoiler,
              supports_streaming: true,
            })
            channelSent = true
          }

          if (pngBuffer && (effectiveSettings.videoMode === 'card' || effectiveSettings.videoMode === 'both' || !downloadedVideo)) {
            if (photoBuffers.length > 0) {
              const channelGroup = [
                {
                  type: 'photo' as const,
                  media: new InputFile(pngBuffer, `tweet-${job.tweetId}-card.png`),
                  caption,
                  has_spoiler: shouldSpoiler,
                },
                ...photoBuffers.map((buf, idx) => ({
                  type: 'photo' as const,
                  media: new InputFile(buf, `photo-${job.tweetId}-${idx + 1}.jpg`),
                  has_spoiler: shouldSpoiler,
                })),
              ]
              await bot.api.sendMediaGroup(chId, channelGroup)
            } else {
              await bot.api.sendPhoto(chId, new InputFile(pngBuffer, `tweet-${job.tweetId}.png`), {
                caption,
                has_spoiler: shouldSpoiler,
              })
            }
            channelSent = true
          }
        } catch (channelErr: any) {
          console.error(`[Processor] Failed to post to target channel (${chId}):`, channelErr)
          if (job.source === 'telegram' && job.telegramContext) {
            await bot.api.sendMessage(job.telegramContext.chatId, `⚠️ 发送到频道 ${chId} 失败：${channelErr.message}`).catch(() => {})
          }
        }
      }
    }

    if (adminChatIds.length > 0) {
      const adminCaption = getAdminCaption(channelSent)

      for (const adminId of adminChatIds) {
        try {
          if (downloadedVideo && (effectiveSettings.videoMode === 'video' || effectiveSettings.videoMode === 'both')) {
            await bot.api.sendVideo(adminId, new InputFile(downloadedVideo.buffer, `tweet-${job.tweetId}.mp4`), {
              caption: adminCaption,
              width: downloadedVideo.width,
              height: downloadedVideo.height,
              duration: videoMedia?.durationMs ? Math.round(videoMedia.durationMs / 1000) : undefined,
              has_spoiler: shouldSpoiler,
              supports_streaming: true,
            })
          }
          if (pngBuffer && (effectiveSettings.videoMode === 'card' || effectiveSettings.videoMode === 'both' || !downloadedVideo)) {
            if (photoBuffers.length > 0) {
              const adminGroup = [
                {
                  type: 'photo' as const,
                  media: new InputFile(pngBuffer, `tweet-${job.tweetId}-card.png`),
                  caption: adminCaption,
                  has_spoiler: shouldSpoiler,
                },
                ...photoBuffers.map((buf, idx) => ({
                  type: 'photo' as const,
                  media: new InputFile(buf, `photo-${job.tweetId}-${idx + 1}.jpg`),
                  has_spoiler: shouldSpoiler,
                })),
              ]
              await bot.api.sendMediaGroup(adminId, adminGroup)
            } else {
              await bot.api.sendPhoto(adminId, new InputFile(pngBuffer, `tweet-${job.tweetId}.png`), {
                caption: adminCaption,
                has_spoiler: shouldSpoiler,
              })
            }
          }
        } catch (adminErr: any) {
          console.warn(`[Processor] Failed to send archive to admin ${adminId}:`, adminErr.message)
        }
      }
    }

    // Follow up with complete text message if truncated
    await sendFollowUpFullTextIfNeeded(bot, tweet, effectiveSettings, isTruncated, config.targetChannelIds, adminChatIds)

    if (job.source === 'telegram' && job.telegramContext?.statusMessageId) {
      await bot.api.deleteMessage(job.telegramContext.chatId, job.telegramContext.statusMessageId).catch(() => {})
    }
  } catch (err: any) {
    await notifyError(err.message || '未知错误')
  }
}
