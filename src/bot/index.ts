import { Bot, InputFile } from 'grammy'
import { setGlobalDispatcher, ProxyAgent } from 'undici'
import { config } from '../config.js'
import { extractTweetUrls } from '../twitter/parser.js'
import { getTweetData } from '../twitter/fetcher.js'
import { renderTweetToPng } from '../renderer/render.js'
import type { TweetData } from '../types.js'

let proxyDispatcher: ProxyAgent | undefined
if (config.proxyUrl) {
  console.log(`[Proxy] Using proxy: ${config.proxyUrl}`)
  proxyDispatcher = new ProxyAgent(config.proxyUrl)
  setGlobalDispatcher(proxyDispatcher)
}

function buildCaption(tweet: TweetData, tag: string): string {
  let videoNote = ''
  if (tweet.hasVideo) {
    const videoMedia = tweet.media.find(m => m.type === 'video')
    if (videoMedia?.durationMs) {
      const sec = Math.round(videoMedia.durationMs / 1000)
      videoNote = `\n\n▶️ 视频推文 (${sec}秒)`
    } else {
      videoNote = '\n\n▶️ 视频推文'
    }
  }

  const urlLine = `${videoNote}\n🔗 原文：${tweet.url}${tag ? '\n' + tag : ''}`
  const maxTextLen = 1024 - urlLine.length - 10
  let body = tweet.text
  if (body.length > maxTextLen) {
    body = body.slice(0, maxTextLen - 3) + '...'
  }
  return `${body}${urlLine}`
}

/**
 * Download video file to Buffer (safe within Telegram 50MB bot upload limit)
 */
async function downloadVideoBuffer(url: string): Promise<Buffer | null> {
  try {
    const fetchOptions: RequestInit & { dispatcher?: any } = {
      signal: AbortSignal.timeout(45_000),
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
    // 50MB Telegram Bot API limit
    if (contentLength > 50 * 1024 * 1024) {
      console.warn(`[Bot] Video file too large: ${(contentLength / 1024 / 1024).toFixed(1)} MB`)
      return null
    }

    const arrayBuffer = await res.arrayBuffer()
    const buf = Buffer.from(arrayBuffer)
    if (buf.length > 50 * 1024 * 1024) {
      console.warn(`[Bot] Downloaded video exceeds 50MB: ${(buf.length / 1024 / 1024).toFixed(1)} MB`)
      return null
    }
    return buf
  } catch (err: any) {
    console.warn(`[Bot] Could not download video from ${url}:`, err.message)
    return null
  }
}

export function createBot(): Bot {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN is not set in environment or .env file!')
  }

  const bot = new Bot(config.botToken)

  // Welcome / Help command
  bot.command(['start', 'help'], async ctx => {
    const userId = ctx.from?.id
    const isAdmin = !config.adminUserIds.length || (userId && config.adminUserIds.includes(userId))

    const helpText = [
      '👋 <b>欢迎使用推特转图片 / 视频机器人！</b>',
      '',
      '📌 <b>使用方法：</b>',
      '直接私聊发送任意推特/X链接（如 <code>https://x.com/user/status/123456</code>）。',
      '',
      '⚙️ <b>当前特性与设置：</b>',
      `• <b>图文卡片:</b> ${config.theme} 模式渲染，高分辨率思源黑体`,
      `• <b>视频处理:</b> <code>${config.videoMode}</code> 模式 (支持原生 MP4 视频直发或海报卡片)`,
      `• <b>目标频道:</b> ${config.targetChannelId ? `<code>${config.targetChannelId}</code>` : '未配置 (仅私聊回复)'}`,
      `• <b>用户 ID:</b> <code>${userId}</code> (${isAdmin ? '✅ 已授权' : '⛔ 未授权'})`,
    ].join('\n')

    await ctx.reply(helpText, { parse_mode: 'HTML' })
  })

  // Listen for messages containing links
  bot.on('message:text', async ctx => {
    const userId = ctx.from.id

    // Check whitelist
    if (config.adminUserIds.length > 0 && !config.adminUserIds.includes(userId)) {
      console.warn(`[Bot] Unauthorized access attempt from user ID: ${userId}`)
      await ctx.reply(`⛔ 未授权访问。你的 User ID 为: <code>${userId}</code>，请先将其添加到 <code>ADMIN_USER_IDS</code>。`, {
        parse_mode: 'HTML',
      })
      return
    }

    const text = ctx.message.text
    const extracted = extractTweetUrls(text)

    if (extracted.length === 0) {
      await ctx.reply('❓ 未在消息中识别到推特链接。请发送推特链接（例如：https://x.com/user/status/123456）。')
      return
    }

    for (const item of extracted) {
      const statusMsg = await ctx.reply(`⏳ 正在处理推文：${item.id} ...`)

      try {
        // 1. Fetch tweet data
        const tweet = await getTweetData(item.id)
        const caption = buildCaption(tweet, config.tag)

        const videoMedia = tweet.media.find(m => m.type === 'video' && m.videoUrl)
        let videoBuffer: Buffer | null = null

        // If tweet has video and videoMode is 'video' or 'both', attempt video download
        if (videoMedia?.videoUrl && (config.videoMode === 'video' || config.videoMode === 'both')) {
          await bot.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `⏳ 发现推特视频，正在下载高清 MP4 (${item.id})...`
          ).catch(() => {})
          videoBuffer = await downloadVideoBuffer(videoMedia.videoUrl)
        }

        // Render card image (needed if no video, if videoMode is 'card'/'both', or as fallback)
        let pngBuffer: Buffer | null = null
        if (!videoBuffer || config.videoMode === 'card' || config.videoMode === 'both') {
          await bot.api.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            `⏳ 正在渲染推特高清卡片 (${item.id})...`
          ).catch(() => {})
          pngBuffer = await renderTweetToPng(tweet, {
            theme: config.theme,
            scale: 2,
          })
        }

        let channelSent = false

        // 2. Publish to channel
        if (config.targetChannelId) {
          try {
            if (videoBuffer && (config.videoMode === 'video' || config.videoMode === 'both')) {
              // Send native video to channel
              // BroadcastChannel natively recognizes Telegram video posts as HTML5 <video>!
              const videoFile = new InputFile(videoBuffer, `tweet-${item.id}.mp4`)
              await bot.api.sendVideo(config.targetChannelId, videoFile, {
                caption,
                width: videoMedia?.width,
                height: videoMedia?.height,
                duration: videoMedia?.durationMs ? Math.round(videoMedia.durationMs / 1000) : undefined,
              })
              channelSent = true
            }

            if (pngBuffer && (config.videoMode === 'card' || (config.videoMode === 'both') || !videoBuffer)) {
              // Send photo card to channel
              const photoFile = new InputFile(pngBuffer, `tweet-${item.id}.png`)
              await bot.api.sendPhoto(config.targetChannelId, photoFile, {
                caption,
              })
              channelSent = true
            }
          } catch (channelErr: any) {
            console.error('[Bot] Failed to post to target channel:', channelErr)
            await ctx.reply(`⚠️ 发送到频道失败：${channelErr.message}`)
          }
        }

        // 3. Reply to Admin
        if (config.sendToAdmin || !config.targetChannelId) {
          if (videoBuffer && (config.videoMode === 'video' || config.videoMode === 'both')) {
            const userVideo = new InputFile(videoBuffer, `tweet-${item.id}.mp4`)
            await ctx.replyWithVideo(userVideo, {
              caption: channelSent ? `✅ 已作为原生视频发布到频道 ${config.targetChannelId}\n\n${caption}` : caption,
            })
          }
          if (pngBuffer && (config.videoMode === 'card' || config.videoMode === 'both' || !videoBuffer)) {
            const userPhoto = new InputFile(pngBuffer, `tweet-${item.id}.png`)
            await ctx.replyWithPhoto(userPhoto, {
              caption: channelSent ? `✅ 已发布到频道 ${config.targetChannelId}\n\n${caption}` : caption,
            })
          }
        }

        // Delete the processing status message
        await bot.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
      } catch (err: any) {
        console.error(`[Bot] Error processing tweet ${item.id}:`, err)
        await bot.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `❌ 处理推文失败 (${item.id})：\n${err.message || '未知错误'}`
        ).catch(() => {})
      }
    }
  })

  return bot
}
