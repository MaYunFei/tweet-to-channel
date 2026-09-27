# Tweet to Channel 📢

> **Convert Twitter / X posts into beautiful cards, native videos & photo albums, and auto-publish them to your Telegram Channel.**  
> Built as an ideal companion for **[BroadcastChannel](https://github.com/MaYunFei/BroadcastChannel)**.

English | [简体中文](./README.zh-cn.md)

---

## 💡 Why Tweet to Channel?

When pairing Telegram channels with microblogging engines like **[BroadcastChannel](https://github.com/MaYunFei/BroadcastChannel)**, sharing plain Twitter links often results in poor previews:
1. **Broken previews**: Twitter aggressively restricts scrapers, leaving link previews blank or generic.
2. **CDN / Firewall blocking**: Twitter's image CDN (`pbs.twimg.com`) is unreachable in certain regions (such as Mainland China), causing preview images on your blog to break.
3. **Native Telegram photo benefits**: When posting native images (`sendPhoto`) with captions, `BroadcastChannel` provides built-in responsive galleries, lightbox modals, and serves images smoothly through Telegram CDN.

**The Solution:**
Share any tweet to your private Telegram Bot -> Bot fetches and processes it in milliseconds (crisp card image, native MP4 video, photo album, or privacy-stripped text) -> Automatically publishes directly to your target Telegram Channel(s) -> Instantly synced to your blog!

---

## ✨ Features

- 🚀 **Zero API Keys**: Leverages Twitter's official syndication embed API + FxTwitter fallback. No paid Twitter API subscription or developer account required.
- 🎨 **Fast & Headless (No Browser Needed)**: Powered by Vercel [Satori](https://github.com/vercel/satori) and Rust [Resvg](https://github.com/RazrFalcon/resvg). Eliminates heavy Chromium / Puppeteer overhead; renders in ~30ms using less than 50MB RAM.
- 🎬 **Smart Video Handling**:
  - **Native Video Mode (`VIDEO_MODE=video`, default)**: Downloads the highest-bitrate MP4 and posts it as a native Telegram video. Because **`BroadcastChannel` natively supports Telegram videos**, your blog will render a playable HTML5 `<video>` player!
  - **Card Mode (`VIDEO_MODE=card`)**: Renders a tweet card with the video's high-res poster, a centered Play icon (`▶`), and a duration badge (e.g. `0:17`).
  - **Adaptive 50MB Quality Fallback**: If the original 1080p/4K video exceeds Telegram's 50MB bot upload limit, the service automatically steps down through available variants (720p, 480p) to preserve native video delivery.
  - **Accurate Physical Aspect Ratio**: Inspects MP4 header atoms in milliseconds to determine native width and height, guaranteeing vertical/portrait (9:16) and widescreen (16:9) clips play without stretching or distortion.
- 🀄 **Full CJK & Crisp Color Emoji Support**: Automatically fetches and caches `Noto Sans SC`, and renders all system emojis (emoticons, flags, symbols) using high-resolution Twemoji SVG vector assets with local disk caching.
- 🌐 **Smart Bilingual Translation (Zero API Key)**: Built-in free Google Translate integration. Foreign tweets (English, Japanese, etc.) are automatically translated into Simplified Chinese and displayed alongside the original in both the rendered card image and Telegram caption. Chinese tweets are automatically kept as-is.
- 📖 **Full Long-Tweet Support (Zero Truncation)**:
  - Automatically parses full content from X (Twitter) Note Tweets (X Premium long-form articles), removing the 280-character ceiling.
  - While Telegram media captions are strictly capped at 1024 characters, the bot automatically follows up with a complete bilingual text message (`📖 推文全文与译文`) whenever a tweet or translation exceeds the caption limit, ensuring zero lost paragraphs.
- 🖼️ **High-Res Photo Album Bundling (MediaGroup)**: Automatically bundles the rendered card together with 100% full-resolution original photos into a Telegram album. Full-bleed straight corners eliminate dark corner artifacts.
- 🙈 **Sensitive Media Protection (Telegram Spoiler)**: Automatically flags NSFW / adult media with Telegram's sparkling spoiler blur mask.
- ⚡ **Persistent Disk Caching**: Tweets, translations, and media buffers are persisted under `./data/cache/` for instant re-processing with `/cache` and `/clearcache` tools.
- 📢 **Multi-Channel Broadcasting**: `TARGET_CHANNEL_ID` supports comma-separated channel IDs/usernames for synchronized publishing.
- 📦 **Native Content Transfer Mode (Detach & De-identify)**:
  - Toggle off card rendering to post tweets as **native Telegram media albums, plain text, or native videos**.
  - Strip source links and author info completely to protect original poster privacy and make posts look like native blog entries on BroadcastChannel.
- ⚙️ **Interactive Telegram Settings Panel**: Use `/settings` to toggle modes, privacy, tags, video handling, and themes with inline keyboard buttons in real time.
- 🛡️ **Whitelist Protection**: Configurable `ADMIN_USER_IDS` to restrict bot usage to you alone.
- 🌐 **Proxy Ready**: Built-in HTTP / SOCKS5 proxy support via `undici` for environments with network restrictions.
- 🛠️ **Built-in CLI**: Quickly test card rendering and bilingual translation locally via `pnpm convert`.
- 🐳 **Automated Multi-arch Docker**: Built-in GitHub Actions CI/CD automatically builds and pushes `linux/amd64` and `linux/arm64` images to GitHub Container Registry (GHCR) on every push or release. Deploy without compiling locally!

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/MaYunFei/tweet-to-channel.git
cd tweet-to-channel
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Telegram Bot Token from @BotFather
BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ

# Admin user IDs allowed to interact with the bot (comma-separated)
ADMIN_USER_IDS=123456789

# Target Channel ID or username (e.g. @my_channel or -100123456789, supports comma-separated list)
TARGET_CHANNEL_ID=@my_channel

# Theme: 'dark' | 'dim' | 'light'
THEME=dark

# Optional proxy (e.g. http://127.0.0.1:7890)
PROXY_URL=

# Hashtag appended to Telegram caption
TAG=#Twitter
```

### 3. Test Locally (CLI)

Test image generation for any tweet without starting the bot:

```bash
pnpm convert 20 output.png
pnpm convert https://x.com/elonmusk/status/1234567890 output.png --theme light

# Convert with bilingual translation
pnpm convert 20 output-trans.png --translate
```

### 4. Run the Telegram Bot

```bash
# Development (watch mode)
pnpm run dev

# Production
pnpm run build
pnpm start
```

---

## 🐳 Docker Deployment (Recommended)

Pre-built multi-arch images (`linux/amd64` and `linux/arm64`) are automatically published to GHCR.

### Option A: Docker Compose

```bash
# 1. Download docker-compose.yml and .env.example
curl -O https://raw.githubusercontent.com/MaYunFei/tweet-to-channel/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/MaYunFei/tweet-to-channel/main/.env.example
cp .env.example .env

# 2. Configure .env with your tokens
vim .env

# 3. Pull image and start container
docker compose up -d

# 4. View logs
docker compose logs -f
```

### Option B: Direct `docker run`

```bash
docker run -d \
  --name tweet-to-channel \
  --restart unless-stopped \
  -e BOT_TOKEN="your_bot_token" \
  -e ADMIN_USER_IDS="your_user_id" \
  -e TARGET_CHANNEL_ID="@your_channel" \
  -e THEME="dark" \
  -v $(pwd)/data:/app/data \
  ghcr.io/mayunfei/tweet-to-channel:latest
```

---

## 🤖 Modes & Commands

### 1. Card Mode vs. Transfer Mode

| Tweet Type | Card Mode (Default) | Transfer Mode (Privacy / Native) |
| :--- | :--- | :--- |
| **Text Only** | Renders a high-res Twitter card PNG with author info. Caption includes source URL. | **No card image**. Sends clean text message directly. |
| **Text + 1~4 Photos** | Renders Twitter card layout and automatically bundles full-resolution original photos into a Telegram MediaGroup album (no black corner artifacts, swipe to view original photos). | **No card image**. Downloads original high-res photos and sends as a native Telegram album gallery. |
| **Text + Video** | Posts native MP4, and caption includes `▶️ Video` + original URL + hashtag. | Posts native MP4, caption contains **pure clean text only** (no links, no author, no Twitter branding). |

### 2. Commands & Control

- `/settings`: Opens the interactive settings keyboard in Telegram to toggle features in real time.
- Send any tweet URL: Processed according to current global settings and published to target channel.
- `/pic <url>` or `/img <url>`: **Generate ultra-clear card image (no forwarding to channel)**. Returns both an instant high-res photo preview and a 100% lossless original PNG document. Displays full text for long articles/tweets. Perfect for saving to your photo roll and sharing with others. Supports replying to tweet messages or appending `/pic zh` / `/pic notrans`.
- `/anon <url>`: One-shot anonymous transfer (no card, no source link, no hashtag).
- `/raw <url>`: One-shot native transfer (native media, keeps source link).
- `/card <url>`: One-shot card rendering (with original photos attached).
- `/cardonly <url>`: One-shot card only (card image without attached photos).
- `/spoiler <url>`: One-shot spoiler mode (force enable Telegram spoiler blur).
- `/nospoiler <url>`: One-shot direct mode (force disable spoiler blur).
- `/zh <url>`: One-shot bilingual translation (force enable Chinese translation).
- `/notrans <url>`: One-shot raw text (force disable translation).
- `/cache`: View disk cache statistics (file count and MBs).
- `/clearcache`: Wipe all media and data disk caches.
- `/nocache <url>`: Force bypass local cache and re-download fresh data.

---

## 📱 iOS Shortcuts Integration

Share directly from the official Twitter / X app on iOS / iPadOS to your Telegram channel using the native Share Sheet!

### Key Features
- ⚡ **Asynchronous Instant Response**: The endpoint acknowledges your request within ~50ms so your phone never hangs or times out. Tweet rendering and downloading are executed in an orderly background FIFO queue.
- 🔒 **Token Authentication**: Secured with Bearer Token, custom headers, or query parameters.
- 📦 **Automatic Private Archive & Failure Alerts**: Upon successful publishing, the bot sends an identical copy to your Telegram private chat (`ADMIN_USER_IDS`) as an archive and delivery receipt. If the tweet fails or is deleted, you receive an error notification in DM.
- ⚙️ **Follows Global Settings**: Automatically adopts your current bot settings (translation, card mode, video mode, etc.). Change settings anytime via `/settings` in Telegram.

### 1. Server Configuration (`.env`)

```env
# Enable HTTP API server
ENABLE_API=true

# API listening port (default: 3000)
API_PORT=3000

# Secret token for authentication
API_AUTH_TOKEN=your_super_secret_token_123456
```

### 2. HTTP API Specification

- **Endpoint**: `POST /api/publish`
- **Headers**:
  - `Authorization: Bearer <API_AUTH_TOKEN>`
  - `Content-Type: application/json`
- **Body (JSON)**:
  ```json
  {
    "url": "https://x.com/elonmusk/status/1234567890"
  }
  ```

**cURL Example**:
```bash
curl -X POST http://127.0.0.1:3000/api/publish \
  -H "Authorization: Bearer your_super_secret_token_123456" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://x.com/elonmusk/status/1234567890"}'
```

### 3. iOS Shortcuts Setup (Step-by-Step)

Open the **Shortcuts** app on your iPhone and tap **「+」** to create a new shortcut:

1. **Name the shortcut**: e.g., **`Post Tweet to Channel`**.
2. **Enable Share Sheet**:
   - Tap the **「(i)」** info icon at the bottom;
   - Enable **「Show in Share Sheet」**;
   - In the "Accepts" list, select **Safari web pages**, **URLs**, and **Text**.
3. **Action 1: Extract Tweet URL**:
   - Add action: **「Get URLs from input」**;
   - Set source to: **`[Shortcut Input]`**.
4. **Action 2: Send HTTP Request**:
   - Add action: **「Get Contents of URL」**;
   - Set **URL**: your server endpoint (e.g. `https://api.yourdomain.com/api/publish`);
   - Set **Method**: `POST`;
   - In **Headers**:
     - Key: `Authorization`, Value: `Bearer your_super_secret_token_123456`
     - Key: `Content-Type`, Value: `application/json`
   - In **Request Body**: Choose `JSON`:
     - Add string field `url` with value: `[URLs from input]`.
5. **Action 3: Haptic Feedback & Notification**:
   - Add action: **「Show Notification」** with text `✅ Queued for processing`.
   - *(Optional)* Add action: **「Play Haptics」**.

---

## 🤖 For AI Coding Agents

See [AGENTS.md](./AGENTS.md) for architecture details, constraints, and development guidelines.

---

## 📄 License

[MIT](./LICENSE)
