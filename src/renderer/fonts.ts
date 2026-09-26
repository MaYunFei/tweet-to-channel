import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config.js'

interface LoadedFont {
  name: string
  data: Buffer
  weight: 400 | 700
  style: 'normal'
}

let cachedFonts: LoadedFont[] | null = null

const FONT_SOURCES = [
  {
    name: 'Noto Sans SC',
    weight: 400 as const,
    filename: 'NotoSansSC-Regular.woff',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@latest/chinese-simplified-400-normal.woff',
  },
  {
    name: 'Noto Sans SC',
    weight: 700 as const,
    filename: 'NotoSansSC-Bold.woff',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@latest/chinese-simplified-700-normal.woff',
  },
]

export async function loadFonts(): Promise<LoadedFont[]> {
  if (cachedFonts) return cachedFonts

  const fontDir = path.resolve(process.cwd(), config.fontDir)
  if (!fs.existsSync(fontDir)) {
    fs.mkdirSync(fontDir, { recursive: true })
  }

  const loaded: LoadedFont[] = []

  for (const src of FONT_SOURCES) {
    const localPath = path.join(fontDir, src.filename)
    let buffer: Buffer

    if (fs.existsSync(localPath)) {
      buffer = fs.readFileSync(localPath)
    } else {
      console.log(`[Fonts] Downloading ${src.name} (${src.weight}) to ${localPath}...`)
      const res = await fetch(src.url, { signal: AbortSignal.timeout(30_000) })
      if (!res.ok) {
        throw new Error(`Failed to download font ${src.url}: ${res.statusText}`)
      }
      const arrayBuffer = await res.arrayBuffer()
      buffer = Buffer.from(arrayBuffer)
      fs.writeFileSync(localPath, buffer)
      console.log(`[Fonts] Downloaded ${src.filename} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`)
    }

    loaded.push({
      name: src.name,
      data: buffer,
      weight: src.weight,
      style: 'normal',
    })
  }

  cachedFonts = loaded
  return loaded
}
