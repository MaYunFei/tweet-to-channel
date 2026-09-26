# AGENTS.md

Instructions and context for AI coding agents working on **tweet-to-channel**.

---

## Project Overview

`tweet-to-channel` is a lightweight, zero-API-key service and Telegram Bot that converts Twitter/X posts into high-resolution rendered card images (PNG), native videos, and albums, and publishes them directly to a Telegram Channel with formatted captions.

It is specifically designed to complement **[BroadcastChannel](https://github.com/MaYunFei/BroadcastChannel)** (turning a Telegram Channel into a static/SSR microblog), ensuring Chinese visitors without VPN access can clearly view tweets and media natively on the web.

---

## Tech Stack & Architecture

- **Runtime**: Node.js (v20+ / v22+ / v24+) with `pnpm`.
- **Language**: TypeScript (ES2022, `NodeNext` modules).
- **Telegram Bot Framework**: `grammY` (modern, lightweight, type-safe).
- **Tweet Data Fetcher**: Dual-source without API keys:
  - Primary: Twitter Official Syndication API (`https://cdn.syndication.twimg.com/tweet-result?id=...&token=x`).
  - Secondary fallback: FxTwitter API (`https://api.fxtwitter.com/status/...`).
- **Image Rendering**:
  - `satori` (Vercel's JSX/HTML to SVG engine).
  - `@resvg/resvg-js` (Rust-based high performance SVG to PNG rasterizer).
  - No Chromium / Puppeteer dependency (runs on ~50MB RAM).
- **Fonts**:
  - `Noto Sans SC` (Simplified Chinese + English + Symbols) automatically cached in `./data/fonts/`.
- **Global Proxy**:
  - Handled via `undici.setGlobalDispatcher(new ProxyAgent(PROXY_URL))`. When `PROXY_URL` is set, all HTTP/HTTPS requests (bot polling, tweet fetching, font download, media prefetching) are routed automatically.

- **Video Handling (`VIDEO_MODE`)**:
  - `video` (default): Downloads the highest-bitrate MP4 and uploads it using Telegram's `sendVideo`.
  - `card`: Renders a static card image with the video poster, centered Play icon (`▶`), and duration badge.
  - `both`: Posts both the card image and the native MP4.
  - Fallback: If video exceeds 50MB (Telegram Bot API limit) or download fails, automatically falls back to rendering the card image.

---

## Directory Structure

```text
tweet-to-channel/
├── .github/
│   └── workflows/
│       └── docker.yml         # GitHub Actions multi-arch Docker CI/CD
├── AGENTS.md                  # This file (Agent guide)
├── README.md                  # Human-facing documentation (English)
├── README.zh-cn.md            # Human-facing documentation (Chinese)
├── package.json               # Dependencies & scripts
├── pnpm-workspace.yaml        # pnpm v11+ configuration (allowBuilds)
├── tsconfig.json              # TypeScript configuration
├── Dockerfile                 # Container image definition
├── docker-compose.yml         # Container deployment configuration
├── .env.example               # Template for environment variables
├── src/
│   ├── config.ts              # Loads & validates environment variables
│   ├── settings.ts            # Dynamic settings manager (persists to data/settings.json)
│   ├── types.ts               # Shared TypeScript interfaces (TweetData, BotSettings, etc.)
│   ├── index.ts               # Main application entry point (starts bot)
│   ├── cli.ts                 # CLI converter utility (pnpm convert)
│   ├── twitter/
│   │   ├── parser.ts          # URL / ID extraction and normalization
│   │   └── fetcher.ts         # Syndication + FxTwitter dual fetcher
│   ├── renderer/
│   │   ├── fonts.ts           # Noto Sans SC auto-download and disk cache
│   │   ├── emoji.ts           # Twemoji codepoint parser + disk cache
│   │   ├── card.tsx           # React JSX tweet card template (Satori-compatible)
│   │   └── render.ts          # Image prefetcher + Satori + Resvg pipeline
│   └── bot/
│       └── index.ts           # grammY bot logic, whitelist check, channel sender
└── data/                      # Persistent storage (fonts, emojis, settings.json)
```

---

## Essential Commands

### Installation & Builds

- Install dependencies:
  ```bash
  pnpm install
  ```
- Type check & build:
  ```bash
  pnpm run build
  ```

### Development & Testing

- Run the Telegram bot in watch mode:
  ```bash
  pnpm run dev
  ```
- Test render a tweet locally to PNG without starting the bot:
  ```bash
  # Convert tweet to output.png (supports tweet URL or tweet ID)
  pnpm convert 20 test.png
  pnpm convert https://x.com/elonmusk/status/1234567890 test.png --theme light
  ```
- Start production bot:
  ```bash
  pnpm start
  ```

---

## Key Development Conventions & Gotchas

1. **Satori CSS Constraints**:
   - Satori uses a custom Yoga-based Flexbox layout engine.
   - **Never use CSS Grid or `float`**. Every container with multiple children must explicitly declare `display: 'flex'`.
   - `flexDirection` defaults to `row` in Satori; explicitly set `flexDirection: 'column'` when stacking elements vertically.
   - `width` and `height` properties on `<img>` elements must be **numbers** (e.g. `width={50}`), not strings (not `width="50"`).

2. **Image Prefetching (SSRF Guard in Satori)**:
   - Satori blocks external remote image URLs in `<img>` tags by default for SSRF security.
   - All external image URLs (avatars, tweet media, quoted avatars) **must be pre-fetched into Base64 Data URLs** (`data:image/png;base64,...`) before passing them to `<TweetCard />`.
   - See `prepareTweetImages()` in `src/renderer/render.ts`.

3. **Telegram Photo Caption Limits**:
   - Telegram has a hard limit of **1024 characters** for photo captions.
   - When building the caption, truncate `tweet.text` to reserve room for the original link and `#Twitter` hashtag.

4. **Security & Whitelist**:
   - The bot is designed for personal self-hosting.
   - Always verify `ADMIN_USER_IDS` in `src/bot/index.ts`. If populated, non-whitelisted Telegram users must be blocked from triggering rendering.

5. **Package Management**:
   - Uses `pnpm v11+`. Any native build requirements (like `esbuild` or `@resvg/resvg-js`) are declared in `pnpm-workspace.yaml` under `allowBuilds`.
