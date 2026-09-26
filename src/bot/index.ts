import { Bot, InputFile, InlineKeyboard } from 'grammy'
import { setGlobalDispatcher, ProxyAgent } from 'undici'
import { config } from '../config.js'
import { getSettings, updateSettings } from '../settings.js'
import { extractTweetUrls } from '../twitter/parser.js'
import { getTweetData } from '../twitter/fetcher.js'
import { renderTweetToPng } from '../renderer/render.js'
import type { TweetData, BotSettings } from '../types.js'

let proxyDispatcher: ProxyAgent | undefined
if (config.proxyUrl) {
  console.log(`[Proxy] Using proxy: ${config.proxyUrl}`)
  proxyDispatcher = new ProxyAgent(config.proxyUrl)
  setGlobalDispatcher(proxyDispatcher)
}

function buildCaption(tweet: TweetData, settings: BotSettings): string {
  let body = tweet.text
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

  if (body.length > maxBodyLen) {
    body = body.slice(0, maxBodyLen - 3) + '...'
  }

  return `${body}${suffix}`.trim()
}

/**
 * Universal media downloader
 */
async function downloadBuffer(
  url: string,
  timeoutMs = 45_000,
  maxBytes = 50 * 1024 * 1024
): Promise<Buffer | null> {
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
    return buf
  } catch (err: any) {
    console.warn(`[Download] Failed from ${url}:`, err.message)
    return null
  }
}

function buildSettingsPanel(settings: BotSettings) {
  const cardText = settings.renderCard ? '🎴 卡片渲染：开启 (推特长图)' : '📦 卡片渲染：关闭 (原生搬运)'
  const sourceText = settings.includeSource ? '🔗 来源链接：保留 (带原推地址)' : '🙈 来源链接：抹除 (彻底脱敏)'
  const tagText = settings.includeTag ? '🏷️ 话题标签：开启 (#Twitter)' : '🚫 话题标签：关闭 (无标签)'

  const videoLabels = {
    video: '🎬 视频模式：原生视频 (MP4)',
    card: '🎬 视频模式：静态海报卡片',
    both: '🎬 视频模式：两者都发',
  }

  const themeLabels = {
    dark: '🎨 卡片主题：纯黑 (Dark)',
    dim: '🎨 卡片主题：深蓝 (Dim)',
    light: '🎨 卡片主题：浅色 (Light)',
  }

  const keyboard = new InlineKeyboard()
    .text(cardText, 'toggle:card').row()
    .text(sourceText, 'toggle:source').row()
    .text(tagText, 'toggle:tag').row()
    .text(videoLabels[settings.videoMode], 'toggle:video').row()
    .text(themeLabels[settings.theme], 'toggle:theme').row()

  const text = [
    '⚙️ <b>推特转发机器人设置控制台</b>',
    '',
    `• <b>运行模式:</b> ${settings.renderCard ? '<b>推特卡片模式</b> (带排版/头像/认证/转赞数)' : '<b>原生内容搬运模式</b> (脱离推特，纯文字/原画相册/原生视频)'}`,
    `• <b>隐私脱敏:</b> ${settings.includeSource ? '公开来源 (附带原文链接)' : '<b>彻底抹除</b> (无来源、无作者，保护隐私)'}`,
    `• <b>分类标签:</b> ${settings.includeTag ? `附带标签 (<code>${config.tag}</code>)` : '无标签'}`,
    `• <b>视频处理:</b> ${settings.videoMode === 'video' ? '提取原生高清 MP4' : settings.videoMode === 'card' ? '生成带播放按钮卡片' : '同时发送'}`,
    `• <b>当前目标频道:</b> ${config.targetChannelId ? `<code>${config.targetChannelId}</code>` : '未设置 (仅私聊回复)'}`,
    '',
    '<i>👇 点击下方按钮可即时切换状态（设置自动保活保存）：</i>',
  ].join('\n')

  return { text, keyboard }
}

export function createBot(): Bot {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN is not set in environment or .env file!')
  }

  const bot = new Bot(config.botToken, {
    client: {
      ...(config.telegramApiRoot ? { apiRoot: config.telegramApiRoot } : {}),
    },
  })

  // Start / Help command
  bot.command(['start', 'help'], async ctx => {
    const userId = ctx.from?.id
    const isAdmin = !config.adminUserIds.length || (userId && config.adminUserIds.includes(userId))

    const helpText = [
      '👋 <b>欢迎使用推特转图片 / 视频 / 内容搬运机器人！</b>',
      '',
      '📌 <b>使用方法：</b>',
      '• <b>日常模式:</b> 直接私聊发送推特链接（按当前全局设置处理）。',
      '• <b>/anon &lt;链接&gt;:</b> 快捷匿名搬运（强制不生成推特卡片、不带来源、不带标签，彻底脱敏）。',
      '• <b>/raw &lt;链接&gt;:</b> 快捷原生搬运（以原生图文/相册/视频发布，保留原文链接）。',
      '• <b>/card &lt;链接&gt;:</b> 快捷卡片模式（强制渲染推特样式长图）。',
      '• <b>/settings:</b> 打开交互式设置面板，一键切换全局模式与开关。',
      '',
      `🔑 <b>用户 ID:</b> <code>${userId}</code> (${isAdmin ? '✅ 已授权' : '⛔ 未授权'})`,
    ].join('\n')

    await ctx.reply(helpText, { parse_mode: 'HTML' })
  })

  // Settings command
  bot.command('settings', async ctx => {
    const userId = ctx.from?.id
    if (config.adminUserIds.length > 0 && (!userId || !config.adminUserIds.includes(userId))) {
      await ctx.reply('⛔ 您没有修改设置的权限。')
      return
    }

    const panel = buildSettingsPanel(getSettings())
    await ctx.reply(panel.text, {
      parse_mode: 'HTML',
      reply_markup: panel.keyboard,
    })
  })

  // Handle inline keyboard settings clicks
  bot.on('callback_query:data', async ctx => {
    const userId = ctx.from.id
    if (config.adminUserIds.length > 0 && !config.adminUserIds.includes(userId)) {
      await ctx.answerCallbackQuery({ text: '⛔ 无操作权限', show_alert: true })
      return
    }

    const data = ctx.callbackQuery.data
    const current = getSettings()

    if (data === 'toggle:card') {
      updateSettings({ renderCard: !current.renderCard })
    } else if (data === 'toggle:source') {
      updateSettings({ includeSource: !current.includeSource })
    } else if (data === 'toggle:tag') {
      updateSettings({ includeTag: !current.includeTag })
    } else if (data === 'toggle:video') {
      const nextMode = current.videoMode === 'video' ? 'card' : current.videoMode === 'card' ? 'both' : 'video'
      updateSettings({ videoMode: nextMode })
    } else if (data === 'toggle:theme') {
      const nextTheme = current.theme === 'dark' ? 'dim' : current.theme === 'dim' ? 'light' : 'dark'
      updateSettings({ theme: nextTheme })
    }

    const panel = buildSettingsPanel(getSettings())
    await ctx.editMessageText(panel.text, {
      parse_mode: 'HTML',
      reply_markup: panel.keyboard,
    }).catch(() => {})

    await ctx.answerCallbackQuery({ text: '✅ 设置已更新！' })
  })

  // Message handler
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

    const text = ctx.message.text.trim()

    // Determine settings for this execution (support per-message override prefixes)
    let effectiveSettings = getSettings()
    if (text.startsWith('/anon')) {
      effectiveSettings = { ...effectiveSettings, renderCard: false, includeSource: false, includeTag: false }
    } else if (text.startsWith('/raw')) {
      effectiveSettings = { ...effectiveSettings, renderCard: false }
    } else if (text.startsWith('/card')) {
      effectiveSettings = { ...effectiveSettings, renderCard: true }
    }

    const extracted = extractTweetUrls(text)
    if (extracted.length === 0) {
      if (!text.startsWith('/')) {
        await ctx.reply('❓ 未在消息中识别到推特链接。直接发送推特链接或使用 /help 查看帮助。')
      }
      return
    }

    const maxVideoBytes = config.telegramApiRoot ? 2000 * 1024 * 1024 : 50 * 1024 * 1024

    for (const item of extracted) {
      const statusMsg = await ctx.reply(`⏳ 正在获取推文：${item.id} ...`)

      try {
        // 1. Fetch tweet metadata
        const tweet = await getTweetData(item.id)
        const caption = buildCaption(tweet, effectiveSettings)

        // -------------------------------------------------------------
        // BRANCH A: 原生搬运模式 (renderCard === false)
        // 完全脱离推特，纯文字 / 原图相册 / 原生视频
        // -------------------------------------------------------------
        if (!effectiveSettings.renderCard) {
          const videoMedia = tweet.media.find(m => m.type === 'video' && m.videoUrl)

          // 1. Tweet has video
          if (videoMedia?.videoUrl) {
            await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, `⏳ 正在下载原生高清视频 (${item.id})...`).catch(() => {})
            const videoBuf = await downloadBuffer(videoMedia.videoUrl, 60_000, maxVideoBytes)
            if (videoBuf) {
              const videoFile = new InputFile(videoBuf, `video-${item.id}.mp4`)
              if (config.targetChannelId) {
                await bot.api.sendVideo(config.targetChannelId, videoFile, {
                  caption,
                  width: videoMedia.width,
                  height: videoMedia.height,
                  duration: videoMedia.durationMs ? Math.round(videoMedia.durationMs / 1000) : undefined,
                })
              }
              if (config.sendToAdmin || !config.targetChannelId) {
                await ctx.replyWithVideo(new InputFile(videoBuf, `video-${item.id}.mp4`), {
                  caption: config.targetChannelId ? `✅ 已作为原生视频发布到频道\n\n${caption}` : caption,
                })
              }
              await bot.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
              continue
            }
          }

          // 2. Tweet has photo(s)
          const photos = tweet.media.filter(m => m.type === 'photo')
          if (photos.length > 0) {
            await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, `⏳ 正在下载 ${photos.length} 张高清原图 (${item.id})...`).catch(() => {})
            const photoBuffers = (await Promise.all(photos.map(p => downloadBuffer(p.url, 15_000, 20 * 1024 * 1024)))).filter((b): b is Buffer => Boolean(b))

            if (photoBuffers.length === 1) {
              const photoFile = new InputFile(photoBuffers[0], `photo-${item.id}.jpg`)
              if (config.targetChannelId) {
                await bot.api.sendPhoto(config.targetChannelId, photoFile, { caption })
              }
              if (config.sendToAdmin || !config.targetChannelId) {
                await ctx.replyWithPhoto(new InputFile(photoBuffers[0], `photo-${item.id}.jpg`), {
                  caption: config.targetChannelId ? `✅ 已作为原图发布到频道\n\n${caption}` : caption,
                })
              }
              await bot.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
              continue
            } else if (photoBuffers.length > 1) {
              const mediaGroup = photoBuffers.map((buf, idx) => ({
                type: 'photo' as const,
                media: new InputFile(buf, `photo-${idx}.jpg`),
                ...(idx === 0 ? { caption } : {}),
              }))
              if (config.targetChannelId) {
                await bot.api.sendMediaGroup(config.targetChannelId, mediaGroup)
              }
              if (config.sendToAdmin || !config.targetChannelId) {
                const adminGroup = photoBuffers.map((buf, idx) => ({
                  type: 'photo' as const,
                  media: new InputFile(buf, `photo-${idx}.jpg`),
                  ...(idx === 0 ? { caption: config.targetChannelId ? `✅ 已作为原生相册发布到频道\n\n${caption}` : caption } : {}),
                }))
                await ctx.replyWithMediaGroup(adminGroup)
              }
              await bot.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
              continue
            }
          }

          // 3. Pure text tweet
          if (config.targetChannelId) {
            await bot.api.sendMessage(config.targetChannelId, caption)
          }
          if (config.sendToAdmin || !config.targetChannelId) {
            await ctx.reply(config.targetChannelId ? `✅ 已作为纯文字发布到频道：\n\n${caption}` : caption)
          }
          await bot.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
          continue
        }

        // -------------------------------------------------------------
        // BRANCH B: 推特卡片渲染模式 (renderCard === true)
        // -------------------------------------------------------------
        const videoMedia = tweet.media.find(m => m.type === 'video' && m.videoUrl)
        let videoBuffer: Buffer | null = null

        if (videoMedia?.videoUrl && (effectiveSettings.videoMode === 'video' || effectiveSettings.videoMode === 'both')) {
          await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, `⏳ 发现推特视频，正在下载高清 MP4 (${item.id})...`).catch(() => {})
          videoBuffer = await downloadBuffer(videoMedia.videoUrl, 60_000, maxVideoBytes)
        }

        let pngBuffer: Buffer | null = null
        if (!videoBuffer || effectiveSettings.videoMode === 'card' || effectiveSettings.videoMode === 'both') {
          await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, `⏳ 正在渲染推特卡片 (${item.id})...`).catch(() => {})
          pngBuffer = await renderTweetToPng(tweet, {
            theme: effectiveSettings.theme,
            scale: 2,
          })
        }

        let channelSent = false
        if (config.targetChannelId) {
          try {
            if (videoBuffer && (effectiveSettings.videoMode === 'video' || effectiveSettings.videoMode === 'both')) {
              await bot.api.sendVideo(config.targetChannelId, new InputFile(videoBuffer, `tweet-${item.id}.mp4`), {
                caption,
                width: videoMedia?.width,
                height: videoMedia?.height,
                duration: videoMedia?.durationMs ? Math.round(videoMedia.durationMs / 1000) : undefined,
              })
              channelSent = true
            }

            if (pngBuffer && (effectiveSettings.videoMode === 'card' || effectiveSettings.videoMode === 'both' || !videoBuffer)) {
              await bot.api.sendPhoto(config.targetChannelId, new InputFile(pngBuffer, `tweet-${item.id}.png`), {
                caption,
              })
              channelSent = true
            }
          } catch (channelErr: any) {
            console.error('[Bot] Failed to post to target channel:', channelErr)
            await ctx.reply(`⚠️ 发送到频道失败：${channelErr.message}`)
          }
        }

        if (config.sendToAdmin || !config.targetChannelId) {
          if (videoBuffer && (effectiveSettings.videoMode === 'video' || effectiveSettings.videoMode === 'both')) {
            await ctx.replyWithVideo(new InputFile(videoBuffer, `tweet-${item.id}.mp4`), {
              caption: channelSent ? `✅ 已作为原生视频发布到频道 ${config.targetChannelId}\n\n${caption}` : caption,
            })
          }
          if (pngBuffer && (effectiveSettings.videoMode === 'card' || effectiveSettings.videoMode === 'both' || !videoBuffer)) {
            await ctx.replyWithPhoto(new InputFile(pngBuffer, `tweet-${item.id}.png`), {
              caption: channelSent ? `✅ 已发布到频道 ${config.targetChannelId}\n\n${caption}` : caption,
            })
          }
        }

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
