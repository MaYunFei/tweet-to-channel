import http from 'node:http'
import { URL } from 'node:url'
import type { Bot } from 'grammy'
import { config } from './config.js'
import { taskQueue } from './queue.js'
import { processTweetJob } from './processor.js'
import { extractTweetUrls } from './twitter/parser.js'
import { getSettings } from './settings.js'
import type { BotSettings } from './types.js'

function setCorsHeaders(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-token')
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any) {
  setCorsHeaders(res)
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data, null, 2))
}

function extractToken(req: http.IncomingMessage, url: URL): string | null {
  const authHeader = req.headers['authorization']
  if (authHeader) {
    const parts = authHeader.split(' ')
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      return parts[1].trim()
    }
    return authHeader.trim()
  }

  const customHeader = req.headers['x-api-token']
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim()
  }

  const queryToken = url.searchParams.get('token')
  if (queryToken && queryToken.trim()) {
    return queryToken.trim()
  }

  return null
}

async function readBody(req: http.IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
      if (body.length > maxBytes) {
        reject(new Error('Request body too large'))
      }
    })
    req.on('end', () => resolve(body.trim()))
    req.on('error', err => reject(err))
  })
}

export function createApiServer(bot: Bot): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        setCorsHeaders(res)
        res.writeHead(204)
        res.end()
        return
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/'

      // Health check endpoint
      if (pathname === '/' || pathname === '/api/health') {
        sendJson(res, 200, {
          status: 'ok',
          service: 'tweet-to-channel',
          queueSize: taskQueue.size,
        })
        return
      }

      // Publish endpoint
      if (pathname === '/api/publish') {
        // 1. Authentication check
        if (!config.apiAuthToken) {
          sendJson(res, 401, {
            success: false,
            error: 'Server misconfiguration: API_AUTH_TOKEN is not configured in .env',
          })
          return
        }

        const clientToken = extractToken(req, parsedUrl)
        if (!clientToken || clientToken !== config.apiAuthToken) {
          sendJson(res, 401, {
            success: false,
            error: 'Unauthorized: Invalid or missing token',
          })
          return
        }

        // 2. Extract payload
        let rawBody = ''
        if (req.method === 'POST') {
          rawBody = await readBody(req)
        }

        let inputContent = ''
        let customSettings: BotSettings | undefined

        if (rawBody) {
          try {
            const parsedJson = JSON.parse(rawBody)
            if (typeof parsedJson === 'object' && parsedJson !== null) {
              if (Array.isArray(parsedJson.urls)) {
                inputContent = parsedJson.urls.join('\n')
              } else if (typeof parsedJson.url === 'string') {
                inputContent = parsedJson.url
              } else if (typeof parsedJson.text === 'string') {
                inputContent = parsedJson.text
              } else if (typeof parsedJson.content === 'string') {
                inputContent = parsedJson.content
              }

              // Optional settings overrides
              const current = getSettings()
              customSettings = {
                ...current,
                ...(typeof parsedJson.renderCard === 'boolean' ? { renderCard: parsedJson.renderCard } : {}),
                ...(typeof parsedJson.enableTranslation === 'boolean' ? { enableTranslation: parsedJson.enableTranslation } : {}),
                ...(typeof parsedJson.attachPhotos === 'boolean' ? { attachPhotos: parsedJson.attachPhotos } : {}),
                ...(typeof parsedJson.enableSpoiler === 'boolean' ? { enableSpoiler: parsedJson.enableSpoiler } : {}),
                ...(typeof parsedJson.includeSource === 'boolean' ? { includeSource: parsedJson.includeSource } : {}),
                ...(typeof parsedJson.includeTag === 'boolean' ? { includeTag: parsedJson.includeTag } : {}),
                ...(parsedJson.videoMode ? { videoMode: parsedJson.videoMode } : {}),
                ...(parsedJson.theme ? { theme: parsedJson.theme } : {}),
              }
            }
          } catch {
            // Not JSON, treat as raw plain text
            inputContent = rawBody
          }
        }

        if (!inputContent) {
          inputContent = parsedUrl.searchParams.get('url') || parsedUrl.searchParams.get('text') || ''
        }

        const extracted = extractTweetUrls(inputContent)
        if (extracted.length === 0) {
          sendJson(res, 400, {
            success: false,
            error: 'No valid Twitter/X tweet URL or ID found in request',
          })
          return
        }

        // 3. Enqueue jobs into FIFO task queue
        for (const item of extracted) {
          taskQueue.push(() =>
            processTweetJob(bot, {
              tweetId: item.id,
              source: 'api',
              settings: customSettings,
            })
          )
        }

        // 4. Return instant acknowledgment
        sendJson(res, 200, {
          success: true,
          queued: true,
          count: extracted.length,
          ids: extracted.map(i => i.id),
          queueSize: taskQueue.size,
          message: '推文已成功加入后台处理队列',
        })
        return
      }

      sendJson(res, 404, {
        success: false,
        error: `Endpoint not found: ${pathname}`,
      })
    } catch (err: any) {
      console.error('[API Server] Request error:', err)
      sendJson(res, 500, {
        success: false,
        error: err.message || 'Internal server error',
      })
    }
  })

  return server
}
