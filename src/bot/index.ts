import { Bot, InputFile, InlineKeyboard } from 'grammy'
import { setGlobalDispatcher, ProxyAgent } from 'undici'
import { config } from '../config.js'
import { getSettings, updateSettings } from '../settings.js'
import { extractTweetUrls, toOriginalTwitterImageUrl } from '../twitter/parser.js'
import { getTweetData } from '../twitter/fetcher.js'
import { translateToChinese } from '../translate/google.js'
import { renderTweetToPng } from '../renderer/render.js'
import { getCachedBuffer, setCachedBuffer, getCacheStats, clearCache } from '../cache.js'
import type { TweetData, BotSettings, TweetMedia } from '../types.js'

let proxyDispatcher: ProxyAgent | undefined
if (config.proxyUrl) {
  console.log(`[Proxy] Using proxy: ${config.proxyUrl}`)
  proxyDispatcher = new ProxyAgent(config.proxyUrl)
  setGlobalDispatcher(proxyDispatcher)
}

function buildCaption(tweet: TweetData, settings: BotSettings): string {
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

  let body = tweet.text
  if (settings.enableTranslation && tweet.translation) {
    body = `${tweet.text}\n\n🌐 译文：\n${tweet.translation}`
  }

  if (body.length > maxBodyLen) {
    body = body.slice(0, maxBodyLen - 3) + '...'
  }

  return `${body}${suffix}`.trim()
}

/**
 * Universal media downloader with disk cache
 */
async function downloadBuffer(
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
function getMp4Dimensions(buffer: Buffer): { width: number; height: number } | null {
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

function parseDimensionsFromUrl(url: string): { width: number; height: number } | null {
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
async function downloadBestVideo(
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

function buildSettingsPanel(settings: BotSettings) {
  const cardText = settings.renderCard ? '🎴 卡片渲染：开启 (推特长图)' : '📦 卡片渲染：关闭 (原生搬运)'
  const sourceText = settings.includeSource ? '🔗 来源链接：保留 (带原推地址)' : '🙈 来源链接：抹除 (彻底脱敏)'
  const tagText = settings.includeTag ? '🏷️ 话题标签：开启 (#Twitter)' : '🚫 话题标签：关闭 (无标签)'
  const transText = settings.enableTranslation ? '🌐 双语翻译：开启 (中英对照)' : '🌐 双语翻译：关闭 (仅原文)'
  const photosText = settings.attachPhotos ? '🖼️ 附带原图：开启 (卡片+原画相册)' : '🖼️ 附带原图：关闭 (仅推特长图)'
  const spoilerText = settings.enableSpoiler ? '🙈 敏感遮挡：开启 (成人/敏感自动打码)' : '🙈 敏感遮挡：关闭 (直接展示无打码)'

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
    .text(transText, 'toggle:trans').row()
    .text(photosText, 'toggle:photos').row()
    .text(spoilerText, 'toggle:spoiler').row()
    .text(videoLabels[settings.videoMode], 'toggle:video').row()
    .text(themeLabels[settings.theme], 'toggle:theme').row()

  const text = [
    '⚙️ <b>推特转发机器人设置控制台</b>',
    '',
    `• <b>运行模式:</b> ${settings.renderCard ? '<b>推特卡片模式</b> (带排版/头像/认证/转赞数)' : '<b>原生内容搬运模式</b> (脱离推特，纯文字/原画相册/原生视频)'}`,
    `• <b>隐私脱敏:</b> ${settings.includeSource ? '公开来源 (附带原文链接)' : '<b>彻底抹除</b> (无来源、无作者，保护隐私)'}`,
    `• <b>分类标签:</b> ${settings.includeTag ? `附带标签 (<code>${config.tag}</code>)` : '无标签'}`,
    `• <b>双语翻译:</b> ${settings.enableTranslation ? '开启 (非中文推文自动附带中文译文)' : '关闭 (仅显示原文)'}`,
    `• <b>附带原图:</b> ${settings.attachPhotos ? '开启 (推文含配图时，自动与卡片打包为高清原画相册)' : '关闭 (仅发送推特长图卡片)'}`,
    `• <b>敏感遮罩:</b> ${settings.enableSpoiler ? '开启 (检测到推特成人/敏感标记时，自动为图片和视频启用 Telegram 遮罩打码)' : '关闭 (直接展示无遮挡)'}`,
    `• <b>视频处理:</b> ${settings.videoMode === 'video' ? '提取原生高清 MP4 (智能自适应)' : settings.videoMode === 'card' ? '生成带播放按钮卡片' : '同时发送'}`,
    `• <b>当前目标频道:</b> ${config.targetChannelIds.length > 0 ? config.targetChannelIds.map(c => `<code>${c}</code>`).join(', ') : '未设置 (仅私聊回复)'}`,
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
      '• <b>/cardonly &lt;链接&gt;:</b> 仅卡片模式（仅渲染推特长图，不附带原图相册）。',
      '• <b>/zh &lt;链接&gt;:</b> 快捷双语翻译模式（单次强制开启中文翻译）。',
      '• <b>/notrans &lt;链接&gt;:</b> 快捷纯原文模式（单次强制关闭翻译）。',
      '• <b>/spoiler &lt;链接&gt;:</b> 快捷敏感遮罩模式（单次强制开启防剧透打码）。',
      '• <b>/nospoiler &lt;链接&gt;:</b> 快捷无遮罩模式（单次强制关闭打码，直接展示）。',
      '• <b>/cache:</b> 查看当前本地媒体与数据缓存占用情况。',
      '• <b>/clearcache:</b> 立即清空所有本地推特媒体与数据缓存。',
      '• <b>/nocache &lt;链接&gt;:</b> 单次强制绕过本地缓存，重新从推特下载。',
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

  // Cache stats command
  bot.command('cache', async ctx => {
    const stats = getCacheStats()
    const mb = (stats.totalSizeBytes / 1024 / 1024).toFixed(2)
    await ctx.reply(
      `📦 <b>本地媒体与数据缓存状态</b>\n\n` +
      `• <b>缓存文件数:</b> <code>${stats.fileCount}</code> 个\n` +
      `• <b>占用磁盘空间:</b> <code>${mb} MB</code>\n` +
      `• <b>缓存有效期:</b> <code>${config.cacheTtlHours} 小时</code>\n\n` +
      `<i>💡 提示：同一推文在有效期内重复发送时，将 100% 毫秒级复用已下载的原图与视频，方便测试不同的样式参数！\n` +
      `发送 /clearcache 可立即清空全部缓存。</i>`,
      { parse_mode: 'HTML' }
    )
  })

  // Clear cache command
  bot.command('clearcache', async ctx => {
    const userId = ctx.from?.id
    if (config.adminUserIds.length > 0 && (!userId || !config.adminUserIds.includes(userId))) {
      await ctx.reply('⛔ 您没有清理缓存的权限。')
      return
    }

    const stats = clearCache()
    const mb = (stats.totalSizeBytes / 1024 / 1024).toFixed(2)
    await ctx.reply(`🧹 <b>缓存已清空！</b>\n\n共移除了 <code>${stats.fileCount}</code> 个文件，释放了 <code>${mb} MB</code> 磁盘空间。`, {
      parse_mode: 'HTML',
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
    } else if (data === 'toggle:trans') {
      updateSettings({ enableTranslation: !current.enableTranslation })
    } else if (data === 'toggle:photos') {
      updateSettings({ attachPhotos: !current.attachPhotos })
    } else if (data === 'toggle:spoiler') {
      updateSettings({ enableSpoiler: !current.enableSpoiler })
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
    let forceSpoiler: boolean | undefined
    let bypassCache = false

    if (text.startsWith('/anon')) {
      effectiveSettings = { ...effectiveSettings, renderCard: false, includeSource: false, includeTag: false }
    } else if (text.startsWith('/raw')) {
      effectiveSettings = { ...effectiveSettings, renderCard: false }
    } else if (text.startsWith('/cardonly')) {
      effectiveSettings = { ...effectiveSettings, renderCard: true, attachPhotos: false }
    } else if (text.startsWith('/card')) {
      effectiveSettings = { ...effectiveSettings, renderCard: true }
    } else if (text.startsWith('/zh') || text.startsWith('/trans')) {
      effectiveSettings = { ...effectiveSettings, enableTranslation: true }
    } else if (text.startsWith('/notrans')) {
      effectiveSettings = { ...effectiveSettings, enableTranslation: false }
    } else if (text.startsWith('/spoiler')) {
      forceSpoiler = true
    } else if (text.startsWith('/nospoiler')) {
      forceSpoiler = false
    } else if (text.startsWith('/nocache') || text.startsWith('/refresh')) {
      bypassCache = true
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
        const tweet = await getTweetData(item.id, bypassCache)

        // 2. Translate if enabled
        if (effectiveSettings.enableTranslation) {
          await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, `⏳ 正在翻译推文 (${item.id})...`).catch(() => {})
          tweet.translation = await translateToChinese(tweet.text, bypassCache)
          if (tweet.quotedTweet) {
            tweet.quotedTweet.translation = await translateToChinese(tweet.quotedTweet.text, bypassCache)
          }
        }

        const caption = buildCaption(tweet, effectiveSettings)
        const shouldSpoiler = forceSpoiler !== undefined
          ? forceSpoiler
          : (effectiveSettings.enableSpoiler && Boolean(tweet.possiblySensitive))

        // -------------------------------------------------------------
        // BRANCH A: 原生搬运模式 (renderCard === false)
        // 完全脱离推特，纯文字 / 原图相册 / 原生视频
        // -------------------------------------------------------------
        if (!effectiveSettings.renderCard) {
          const videoMedia = tweet.media.find(m => m.type === 'video' && (m.videoUrl || m.videoVariants?.length))

          // 1. Tweet has video
          if (videoMedia) {
            await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, `⏳ 正在下载原生高清视频 (${item.id})...`).catch(() => {})
            const downloadRes = await downloadBestVideo(
              videoMedia,
              maxVideoBytes,
              (msg) => bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, msg),
              bypassCache
            )
            if (downloadRes) {
              for (const chId of config.targetChannelIds) {
                try {
                  await bot.api.sendVideo(chId, new InputFile(downloadRes.buffer, `video-${item.id}.mp4`), {
                    caption,
                    width: downloadRes.width,
                    height: downloadRes.height,
                    duration: videoMedia.durationMs ? Math.round(videoMedia.durationMs / 1000) : undefined,
                    has_spoiler: shouldSpoiler,
                    supports_streaming: true,
                  })
                } catch (err: any) {
                  console.error(`[Bot] Failed to send video to ${chId}:`, err.message)
                  await ctx.reply(`⚠️ 发送视频到频道 ${chId} 失败：${err.message}`)
                }
              }

              if (config.sendToAdmin || config.targetChannelIds.length === 0) {
                await ctx.replyWithVideo(new InputFile(downloadRes.buffer, `video-${item.id}.mp4`), {
                  caption: config.targetChannelIds.length > 0 ? `✅ 已作为原生视频发布到频道\n\n${caption}` : caption,
                  width: downloadRes.width,
                  height: downloadRes.height,
                  duration: videoMedia.durationMs ? Math.round(videoMedia.durationMs / 1000) : undefined,
                  has_spoiler: shouldSpoiler,
                  supports_streaming: true,
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
            const photoBuffers = (await Promise.all(photos.map(p => downloadBuffer(toOriginalTwitterImageUrl(p.url), 15_000, 20 * 1024 * 1024, bypassCache)))).filter((b): b is Buffer => Boolean(b))

            if (photoBuffers.length === 1) {
              for (const chId of config.targetChannelIds) {
                try {
                  await bot.api.sendPhoto(chId, new InputFile(photoBuffers[0], `photo-${item.id}.jpg`), {
                    caption,
                    has_spoiler: shouldSpoiler,
                  })
                } catch (err: any) {
                  console.error(`[Bot] Failed to send photo to ${chId}:`, err.message)
                  await ctx.reply(`⚠️ 发送图片到频道 ${chId} 失败：${err.message}`)
                }
              }

              if (config.sendToAdmin || config.targetChannelIds.length === 0) {
                await ctx.replyWithPhoto(new InputFile(photoBuffers[0], `photo-${item.id}.jpg`), {
                  caption: config.targetChannelIds.length > 0 ? `✅ 已作为原图发布到频道\n\n${caption}` : caption,
                  has_spoiler: shouldSpoiler,
                })
              }
              await bot.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
              continue
            } else if (photoBuffers.length > 1) {
              for (const chId of config.targetChannelIds) {
                try {
                  const mediaGroup = photoBuffers.map((buf, idx) => ({
                    type: 'photo' as const,
                    media: new InputFile(buf, `photo-${idx}.jpg`),
                    has_spoiler: shouldSpoiler,
                    ...(idx === 0 ? { caption } : {}),
                  }))
                  await bot.api.sendMediaGroup(chId, mediaGroup)
                } catch (err: any) {
                  console.error(`[Bot] Failed to send media group to ${chId}:`, err.message)
                  await ctx.reply(`⚠️ 发送相册到频道 ${chId} 失败：${err.message}`)
                }
              }

              if (config.sendToAdmin || config.targetChannelIds.length === 0) {
                const adminGroup = photoBuffers.map((buf, idx) => ({
                  type: 'photo' as const,
                  media: new InputFile(buf, `photo-${idx}.jpg`),
                  has_spoiler: shouldSpoiler,
                  ...(idx === 0 ? { caption: config.targetChannelIds.length > 0 ? `✅ 已作为原生相册发布到频道\n\n${caption}` : caption } : {}),
                }))
                await ctx.replyWithMediaGroup(adminGroup)
              }
              await bot.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
              continue
            }
          }

          // 3. Pure text tweet
          for (const chId of config.targetChannelIds) {
            try {
              await bot.api.sendMessage(chId, caption)
            } catch (err: any) {
              console.error(`[Bot] Failed to send message to ${chId}:`, err.message)
              await ctx.reply(`⚠️ 发送消息到频道 ${chId} 失败：${err.message}`)
            }
          }
          if (config.sendToAdmin || config.targetChannelIds.length === 0) {
            await ctx.reply(config.targetChannelIds.length > 0 ? `✅ 已作为纯文字发布到频道：\n\n${caption}` : caption)
          }
          await bot.api.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {})
          continue
        }

        // -------------------------------------------------------------
        // BRANCH B: 推特卡片渲染模式 (renderCard === true)
        // -------------------------------------------------------------
        const videoMedia = tweet.media.find(m => m.type === 'video' && (m.videoUrl || m.videoVariants?.length))
        let downloadedVideo: { buffer: Buffer; url: string; width?: number; height?: number } | null = null

        if (videoMedia && (effectiveSettings.videoMode === 'video' || effectiveSettings.videoMode === 'both')) {
          await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, `⏳ 发现推特视频，正在下载高清 MP4 (${item.id})...`).catch(() => {})
          downloadedVideo = await downloadBestVideo(
            videoMedia,
            maxVideoBytes,
            (msg) => bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, msg),
            bypassCache
          )
        }

        let pngBuffer: Buffer | null = null
        if (!downloadedVideo || effectiveSettings.videoMode === 'card' || effectiveSettings.videoMode === 'both') {
          await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, `⏳ 正在渲染推特卡片 (${item.id})...`).catch(() => {})
          pngBuffer = await renderTweetToPng(tweet, {
            theme: effectiveSettings.theme,
            scale: 2,
          })
        }

        // Fetch high-res original photos if tweet contains photos and attachPhotos is enabled
        const photos = tweet.media.filter(m => m.type === 'photo')
        let photoBuffers: Buffer[] = []
        if (photos.length > 0 && effectiveSettings.attachPhotos) {
          await bot.api.editMessageText(ctx.chat.id, statusMsg.message_id, `⏳ 正在下载 ${photos.length} 张高清原图 (${item.id})...`).catch(() => {})
          photoBuffers = (await Promise.all(
            photos.map(p => downloadBuffer(toOriginalTwitterImageUrl(p.url), 20_000, 20 * 1024 * 1024, bypassCache))
          )).filter((b): b is Buffer => Boolean(b))
        }

        let channelSent = false
        const channelsStr = config.targetChannelIds.join(', ')

        if (config.targetChannelIds.length > 0) {
          for (const chId of config.targetChannelIds) {
            try {
              if (downloadedVideo && (effectiveSettings.videoMode === 'video' || effectiveSettings.videoMode === 'both')) {
                await bot.api.sendVideo(chId, new InputFile(downloadedVideo.buffer, `tweet-${item.id}.mp4`), {
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
                      media: new InputFile(pngBuffer, `tweet-${item.id}-card.png`),
                      caption,
                      has_spoiler: shouldSpoiler,
                    },
                    ...photoBuffers.map((buf, idx) => ({
                      type: 'photo' as const,
                      media: new InputFile(buf, `photo-${item.id}-${idx + 1}.jpg`),
                      has_spoiler: shouldSpoiler,
                    })),
                  ]
                  await bot.api.sendMediaGroup(chId, channelGroup)
                } else {
                  await bot.api.sendPhoto(chId, new InputFile(pngBuffer, `tweet-${item.id}.png`), {
                    caption,
                    has_spoiler: shouldSpoiler,
                  })
                }
                channelSent = true
              }
            } catch (channelErr: any) {
              console.error(`[Bot] Failed to post to target channel (${chId}):`, channelErr)
              await ctx.reply(`⚠️ 发送到频道 ${chId} 失败：${channelErr.message}`)
            }
          }
        }

        if (config.sendToAdmin || config.targetChannelIds.length === 0) {
          if (downloadedVideo && (effectiveSettings.videoMode === 'video' || effectiveSettings.videoMode === 'both')) {
            await ctx.replyWithVideo(new InputFile(downloadedVideo.buffer, `tweet-${item.id}.mp4`), {
              caption: channelSent ? `✅ 已作为原生视频发布到频道 ${channelsStr}\n\n${caption}` : caption,
              width: downloadedVideo.width,
              height: downloadedVideo.height,
              duration: videoMedia?.durationMs ? Math.round(videoMedia.durationMs / 1000) : undefined,
              has_spoiler: shouldSpoiler,
              supports_streaming: true,
            })
          }
          if (pngBuffer && (effectiveSettings.videoMode === 'card' || effectiveSettings.videoMode === 'both' || !downloadedVideo)) {
            const adminCaption = channelSent ? `✅ 已发布到频道 ${channelsStr}\n\n${caption}` : caption
            if (photoBuffers.length > 0) {
              const adminGroup = [
                {
                  type: 'photo' as const,
                  media: new InputFile(pngBuffer, `tweet-${item.id}-card.png`),
                  caption: adminCaption,
                  has_spoiler: shouldSpoiler,
                },
                ...photoBuffers.map((buf, idx) => ({
                  type: 'photo' as const,
                  media: new InputFile(buf, `photo-${item.id}-${idx + 1}.jpg`),
                  has_spoiler: shouldSpoiler,
                })),
              ]
              await ctx.replyWithMediaGroup(adminGroup)
            } else {
              await ctx.replyWithPhoto(new InputFile(pngBuffer, `tweet-${item.id}.png`), {
                caption: adminCaption,
                has_spoiler: shouldSpoiler,
              })
            }
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
