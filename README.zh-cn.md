# Tweet to Image 📸

> **将 Twitter / X 推文转换为精美高清卡片图片，并自动发布到你的 Telegram 频道。**  
> 专为 **[BroadcastChannel](https://github.com/MaYunFei/BroadcastChannel)** 设计，让国内用户无需翻墙也能在博客上直接浏览推文全文与配图。

[English](./README.md) | 简体中文

---

## 💡 为什么需要这个项目？

如果你使用 **[BroadcastChannel](https://github.com/MaYunFei/BroadcastChannel)** 把 Telegram 频道作为微型博客，直接转发推特链接往往会遇到几个痛点：
1. **链接预览不稳定**：Twitter 严格限制爬虫抓取，Telegram 经常无法生成推文预览。
2. **国内图片防盗链 / 无法访问**：即使 Telegram 生成了预览卡片，其图片依然直连推特 CDN，国内访客在博客页面上直接看到图片裂开。
3. **原生图片体验最佳**：如果在频道里发送的是 **Telegram 原生图片（`sendPhoto`）**，`BroadcastChannel` 会自动启用高清灯箱放大、自适应画廊排版，且图片经由 Telegram CDN 转发，国内访客可畅通秒开。

**本项目的解决方案：**
在推特上看到好内容 -> 手机分享发给你的私人 Telegram Bot -> 机器人毫秒级抓取并渲染出精美推文长图 -> 自动以图片 + 原文链接发布到你的频道 -> 博客实时同步呈现！

---

## ✨ 项目特性

- 🚀 **无需 Twitter API Key**：采用 Twitter 官方公开外嵌 Syndication 接口 + FxTwitter 双引擎降级机制，完全免费、无需申请开发者账号、无月度调用限制。
- 🎨 **极速无头渲染（无浏览器依赖）**：基于 Vercel 的 [Satori](https://github.com/vercel/satori) 与 Rust 的 [Resvg](https://github.com/RazrFalcon/resvg)，告别消耗几百兆内存的 Chromium / Puppeteer，渲染单张图仅需 30~50 毫秒，运行时内存不到 50MB。
- 🀄 **中文字体与 Emoji 完美适配**：自动下载并缓存 `Noto Sans SC`（思源黑体），无论是中文、英文、表情符号还是引用推文都能高质量渲染。
- 🛡️ **严格安全鉴权**：支持配置 `ADMIN_USER_IDS` 管理员白名单，防止机器人被他人滥用。
- 🌐 **代理支持**：原生支持 HTTP / SOCKS5 代理，国内服务器也可顺畅连接 Telegram 与 Twitter。
- 🛠️ **自带 CLI 转换工具**：无需启动机器人，一行命令即可把推文转为图片。
- 🐳 **Docker 一键部署**：提供精简 Docker 镜像与 Compose 配置，随时自建。

---

## 🚀 快速开始

### 1. 克隆代码与安装依赖

```bash
git clone https://github.com/MaYunFei/tweet-to-image.git
cd tweet-to-image
pnpm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 从 @BotFather 获取的 Telegram 机器人 Token（必填）
BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ

# 允许使用机器人的 Telegram 用户 ID（多个用逗号隔开）
# 如果不知道自己的 ID，启动后私聊 Bot 发送 /start 即可看到
ADMIN_USER_IDS=123456789

# 要发布的公开/私有频道 ID 或用户名（例如 @my_channel 或 -100123456789）
TARGET_CHANNEL_ID=@my_channel

# 主题：dark（纯黑）| dim（深蓝）| light（浅色）
THEME=dark

# 可选网络代理（如 http://127.0.0.1:7890）
PROXY_URL=

# 自动追加在 Caption 末尾的标签（BroadcastChannel 会自动识别为分类标签）
TAG=#Twitter
```

### 3. 本地命令行测试（无需启动 Bot）

你可以随时用内置 CLI 测试推文生成效果：

```bash
# 生成并保存为 test.png
pnpm convert 20 test.png

# 转换指定推文链接，并选用浅色模式
pnpm convert https://x.com/elonmusk/status/1234567890 output.png --theme light
```

### 4. 启动 Telegram 机器人

```bash
# 开发模式（热重载）
pnpm run dev

# 生产模式
pnpm run build
pnpm start
```

---

## 🐳 Docker 部署（推荐）

在你的 VPS 服务器上，一键启动容器保活运行：

```bash
# 1. 准备好 .env 文件
cp .env.example .env
vim .env

# 2. 启动服务
docker compose up -d

# 3. 查看运行日志
docker compose logs -f
```

---

## 🤖 使用方式

1. 打开 Telegram，将你的 Bot 添加为目标频道的**管理员**（赋予发帖权限）。
2. 在 Telegram 中找到你的 Bot，点击 `/start`。
3. 把任意 Twitter / X 链接直接发给机器人：
   ```text
   https://x.com/username/status/18942384728912384
   ```
4. 机器人会自动处理、出图，并发送给你的频道！

---

## 📄 开源许可

[MIT License](./LICENSE)
