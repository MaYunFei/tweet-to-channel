import { Bot, InputFile } from 'grammy'
import { setGlobalDispatcher, ProxyAgent } from 'undici'
import { config } from '../config.js'
import { extractTweetUrls } from '../twitter/parser.js'
import { getTweetData } from '../twitter/fetcher.js'
import { renderTweetToPng } from '../renderer/render.js'
import type { TweetData } from '../types.js'

// Setup global proxy dispatcher if configured
if (config.proxyUrl) {
  console.log(`[Proxy] Using proxy: ${config.proxyUrl}`)
  setGlobalDispatcher(new ProxyAgent(config.proxyUrl))
}

function buildCaption(tweet: TweetData, tag: string): string {
  const urlLine = `\n\n🔗 原文：${tweet.url}${tag ? '\n' + tag : ''}`
  const maxTextLen = 1024 - urlLine.length - 10
  let body = tweet.text
  if (body.length > maxTextLen) {
    body = body.slice(0, maxTextLen - 3) + '...'
  }
  return `${body}${urlLine}`
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
      '👋 <b>欢迎使用推特转图片机器人！</b>',
      '',
      '📌 <b>使用方法：</b>',
      '直接私聊发送任意推特/X链接（如 <code>https://x.com/user/status/123456</code>）。',
      '机器人会自动抓取内容，渲染高清卡片图片并发布到设定的频道。',
      '',
      `🔑 <b>当前用户 ID:</b> <code>${userId}</code>`,
      isAdmin ? '✅ 您拥有操作权限。' : '⛔ 您当前未在管理员白名单中。',
      config.targetChannelId ? `📢 <b>目标频道:</b> <code>${config.targetChannelId}</code>` : 'ℹ️ 未配置目标频道，图片将直接回复到私聊。',
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

        // 2. Render to PNG
        const pngBuffer = await renderTweetToPng(tweet, {
          theme: config.theme,
          scale: 2,
        })

        const caption = buildCaption(tweet, config.tag)
        const photoFile = new InputFile(pngBuffer, `tweet-${item.id}.png`)

        // 3. Send to target channel (if configured)
        let channelSent = false
        if (config.targetChannelId) {
          try {
            await bot.api.sendPhoto(config.targetChannelId, photoFile, {
              caption,
            })
            channelSent = true
          } catch (channelErr: any) {
            console.error('[Bot] Failed to post to target channel:', channelErr)
            await ctx.reply(`⚠️ 发送到频道失败：${channelErr.message}`)
          }
        }

        // 4. Send to admin (if requested or if no channel set)
        if (config.sendToAdmin || !config.targetChannelId) {
          const userPhoto = new InputFile(pngBuffer, `tweet-${item.id}.png`)
          await ctx.replyWithPhoto(userPhoto, {
            caption: channelSent
              ? `✅ 已发布到频道 ${config.targetChannelId}\n\n${caption}`
              : caption,
          })
        }

        // Delete or update the status message
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
