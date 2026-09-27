import { ProxyAgent } from 'undici'
import { config } from '../config.js'
import { getCachedJson, setCachedJson } from '../cache.js'

let proxyDispatcher: ProxyAgent | undefined
if (config.proxyUrl) {
  proxyDispatcher = new ProxyAgent(config.proxyUrl)
}

function isChinese(lang?: string): boolean {
  if (!lang) return false
  const lower = lang.toLowerCase()
  return lower.startsWith('zh') || lower === 'cmn' || lower === 'yue'
}

/**
 * Free Google Translate API without API Key.
 * Translates foreign text into Simplified Chinese (zh-CN).
 * Returns null if translation is unnecessary (already Chinese) or if request fails.
 */
export async function translateToChinese(text: string, bypassCache = false): Promise<string | null> {
  const clean = text.trim()
  if (!clean) return null

  if (!bypassCache) {
    const cached = getCachedJson<string>(`trans:${clean}`)
    if (cached !== null) {
      return cached
    }
  }

  // Fast check: if text contains only URLs, mentions, or whitespace, skip
  const stripped = clean.replace(/https?:\/\/\S+/g, '').replace(/@\w+/g, '').replace(/#\w+/g, '').trim()
  if (!stripped) return null

  try {
    const endpoint = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t'
    const body = new URLSearchParams({ q: clean })

    const fetchOptions: RequestInit & { dispatcher?: any } = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    }

    if (proxyDispatcher) {
      fetchOptions.dispatcher = proxyDispatcher
    }

    const res = await fetch(endpoint, fetchOptions)
    if (!res.ok) {
      console.warn(`[Translate] Google Translate API returned status ${res.status}`)
      return null
    }

    const data = (await res.json()) as any

    // data[2] contains the detected source language (e.g. 'en', 'ja', 'zh-CN')
    const detectedLang = typeof data[2] === 'string' ? data[2] : ''
    if (isChinese(detectedLang)) {
      return null
    }

    // data[0] contains array of [[translatedSegment, originalSegment, ...], ...]
    if (!Array.isArray(data[0])) {
      return null
    }

    const translated = data[0]
      .map((item: any) => (Array.isArray(item) && typeof item[0] === 'string' ? item[0] : ''))
      .filter(Boolean)
      .join('')
      .trim()

    // If result is empty or identical to original text, no translation needed
    if (!translated || translated === clean) {
      return null
    }

    setCachedJson(`trans:${clean}`, translated)
    return translated
  } catch (err: any) {
    console.warn(`[Translate] Failed to translate tweet:`, err.message)
    return null
  }
}
