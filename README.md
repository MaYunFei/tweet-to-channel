# Tweet to Image 📸

> **Convert Twitter / X posts into beautiful high-resolution card images and publish them directly to your Telegram Channel.**  
> Built as an ideal companion for **[BroadcastChannel](https://github.com/MaYunFei/BroadcastChannel)**.

English | [简体中文](./README.zh-cn.md)

---

## 💡 Why Tweet to Image?

When pairing Telegram channels with microblogging engines like **[BroadcastChannel](https://github.com/MaYunFei/BroadcastChannel)**, sharing plain Twitter links often results in poor previews:
1. **Broken previews**: Twitter aggressively restricts scrapers, leaving link previews blank or generic.
2. **CDN / Firewall blocking**: Twitter's image CDN (`pbs.twimg.com`) is unreachable in certain regions (such as Mainland China), causing preview images on your blog to break.
3. **Native Telegram photo benefits**: When posting native images (`sendPhoto`) with captions, `BroadcastChannel` provides built-in responsive galleries, lightbox modals, and serves images smoothly through Telegram CDN.

**The Solution:**
Share any tweet to your private Telegram Bot -> Bot generates a crisp, native-style card PNG in milliseconds -> Posts directly to your channel with the original link in caption -> Instantly synced to your blog!

---

## ✨ Features

- 🚀 **Zero API Keys**: Leverages Twitter's official syndication embed API + FxTwitter fallback. No paid Twitter API subscription or developer account required.
- 🎨 **Fast & Headless (No Browser Needed)**: Powered by Vercel [Satori](https://github.com/vercel/satori) and Rust [Resvg](https://github.com/RazrFalcon/resvg). Eliminates heavy Chromium / Puppeteer overhead; renders in ~30ms using less than 50MB RAM.
- 🎬 **Smart Video Handling**:
  - **Native Video Mode (`VIDEO_MODE=video`, default)**: Downloads the highest-bitrate MP4 and posts it as a native Telegram video. Because **`BroadcastChannel` natively supports Telegram videos**, your blog will render a playable HTML5 `<video>` player!
  - **Card Mode (`VIDEO_MODE=card`)**: Renders a tweet card with the video's high-res poster, a centered Play icon (`▶`), and a duration badge (e.g. `0:17`).
  - **Automatic Fallback**: If the video exceeds Telegram's 50MB bot upload limit or download fails, it gracefully falls back to sending the card image.
- 🀄 **Full CJK & Crisp Color Emoji Support**: Automatically fetches and caches `Noto Sans SC`, and renders all system emojis (emoticons, flags, symbols) using high-resolution Twemoji SVG vector assets with local disk caching.
- 📦 **Native Content Transfer Mode (Detach & De-identify)**:
  - Toggle off card rendering to post tweets as **native Telegram media albums, plain text, or native videos**.
  - Strip source links and author info completely to protect original poster privacy and make posts look like native blog entries on BroadcastChannel.
- ⚙️ **Interactive Telegram Settings Panel**: Use `/settings` to toggle modes, privacy, tags, video handling, and themes with inline keyboard buttons in real time.
- 🛡️ **Whitelist Protection**: Configurable `ADMIN_USER_IDS` to restrict bot usage to you alone.
- 🌐 **Proxy Ready**: Built-in HTTP / SOCKS5 proxy support via `undici` for environments with network restrictions.
- 🛠️ **Built-in CLI**: Quickly test and export tweet images locally via `pnpm convert`.
- 🐳 **Docker Ready**: One-command deployment with Docker Compose.

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/MaYunFei/tweet-to-image.git
cd tweet-to-image
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

# Target Channel ID or username (e.g. @my_channel or -100123456789)
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

## 🐳 Docker Deployment

```bash
cp .env.example .env
# Edit .env with your tokens
docker compose up -d
docker compose logs -f
```

---

## 🤖 Modes & Commands

### 1. Card Mode vs. Transfer Mode

| Tweet Type | Card Mode (Default) | Transfer Mode (Privacy / Native) |
| :--- | :--- | :--- |
| **Text Only** | Renders a high-res Twitter card PNG with author info. Caption includes source URL. | **No card image**. Sends clean text message directly. |
| **Text + 1~4 Photos** | Embeds photos into the card layout. | **No card image**. Downloads original high-res photos and sends as a native Telegram album gallery. |
| **Text + Video** | Posts native MP4, and caption includes `▶️ Video` + original URL + hashtag. | Posts native MP4, caption contains **pure clean text only** (no links, no author, no Twitter branding). |

### 2. Commands & Control

- `/settings`: Opens the interactive settings keyboard in Telegram to toggle features in real time.
- Send any tweet URL: Processed according to current global settings.
- `/anon <url>`: One-shot anonymous transfer (no card, no source link, no hashtag).
- `/raw <url>`: One-shot native transfer (native media, keeps source link).
- `/card <url>`: One-shot card rendering.

---

## 🤖 For AI Coding Agents

See [AGENTS.md](./AGENTS.md) for architecture details, constraints, and development guidelines.

---

## 📄 License

[MIT](./LICENSE)
