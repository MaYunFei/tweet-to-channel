import fs from 'node:fs'
import path from 'node:path'
import { extractTweetId } from './twitter/parser.js'
import { getTweetData } from './twitter/fetcher.js'
import { renderTweetToPng } from './renderer/render.js'
import { translateToChinese } from './translate/google.js'
import type { ThemeMode } from './types.js'

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.log('Usage: pnpm convert <tweet_url_or_id> [output.png] [--theme dark|light|dim] [--translate|--no-translate]')
    process.exit(1)
  }

  const inputUrl = args[0]
  const tweetId = extractTweetId(inputUrl)
  if (!tweetId) {
    console.error(`Error: Could not extract Tweet ID from: ${inputUrl}`)
    process.exit(1)
  }

  let theme: ThemeMode = 'dark'
  let outputPath = 'output.png'
  let shouldTranslate = false

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--theme' && args[i + 1]) {
      theme = args[i + 1] as ThemeMode
      i++
    } else if (args[i] === '--translate') {
      shouldTranslate = true
    } else if (args[i] === '--no-translate') {
      shouldTranslate = false
    } else if (!args[i].startsWith('--')) {
      outputPath = args[i]
    }
  }

  console.log(`[CLI] Fetching Tweet ${tweetId}...`)
  const tweet = await getTweetData(tweetId)
  console.log(`[CLI] Tweet by @${tweet.author.screenName}: "${tweet.text.slice(0, 50)}..."`)

  if (shouldTranslate) {
    console.log(`[CLI] Translating tweet text...`)
    tweet.translation = await translateToChinese(tweet.text)
    if (tweet.quotedTweet) {
      tweet.quotedTweet.translation = await translateToChinese(tweet.quotedTweet.text)
    }
    if (tweet.translation) {
      console.log(`[CLI] 🌐 Translation: "${tweet.translation.slice(0, 50)}..."`)
    } else {
      console.log(`[CLI] 🌐 No translation needed (already Chinese or empty).`)
    }
  }

  console.log(`[CLI] Rendering to image (${theme} mode)...`)
  const pngBuffer = await renderTweetToPng(tweet, { theme, scale: 2, fullText: true })

  const resolvedPath = path.resolve(process.cwd(), outputPath)
  fs.writeFileSync(resolvedPath, pngBuffer)
  console.log(`[CLI] ✅ Saved image to ${resolvedPath} (${(pngBuffer.length / 1024).toFixed(1)} KB)`)
}

main().catch(err => {
  console.error('[CLI] Error:', err)
  process.exit(1)
})
