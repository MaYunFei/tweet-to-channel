import { Bot, InlineKeyboard } from 'grammy'
import { config } from '../config.js'
import { getSettings, updateSettings } from '../settings.js'
import { extractTweetUrls } from '../twitter/parser.js'
import { getCacheStats, clearCache } from '../cache.js'
import { taskQueue } from '../queue.js'
import { processTweetJob } from '../processor.js'
import type { BotSettings } from '../types.js'

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

    for (const item of extracted) {
      const statusMsg = await ctx.reply(`⏳ 正在获取推文：${item.id} ...`)
      await taskQueue.push(() =>
        processTweetJob(bot, {
          tweetId: item.id,
          source: 'telegram',
          telegramContext: {
            chatId: ctx.chat.id,
            statusMessageId: statusMsg.message_id,
          },
          settings: effectiveSettings,
          forceSpoiler,
          bypassCache,
        })
      )
    }
  })

  return bot
}
