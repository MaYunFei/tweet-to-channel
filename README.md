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
- 🀄 **Full CJK & Emoji Support**: Automatically fetches and caches `Noto Sans SC` for crisp rendering of Chinese, Japanese, English, and symbols.
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

## 🤖 Usage

1. Add your Bot as an **Administrator** in your target channel (with "Post Messages" permission).
2. Open a direct message with your Bot on Telegram and send `/start`.
3. Send any tweet link:
   ```text
   https://x.com/user/status/1234567890
   ```
4. The bot will render the tweet card and automatically forward it to your channel!

---

## 🤖 For AI Coding Agents

See [AGENTS.md](./AGENTS.md) for architecture details, constraints, and development guidelines.

---

## 📄 License

[MIT](./LICENSE)
