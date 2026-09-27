# Tweet to Channel 📢

> **将 Twitter / X 推文转换为精美卡片长图、原生高清视频与多图相册，并自动发布到你的 Telegram 频道。**  
> 专为 **[BroadcastChannel](https://github.com/MaYunFei/BroadcastChannel)** 设计，让国内用户无需翻墙也能在博客上直接浏览推文全文、配图与视频。

[English](./README.md) | 简体中文

---

## 💡 为什么需要这个项目？

如果你使用 **[BroadcastChannel](https://github.com/MaYunFei/BroadcastChannel)** 把 Telegram 频道作为微型博客，直接转发推特链接往往会遇到几个痛点：
1. **链接预览不稳定**：Twitter 严格限制爬虫抓取，Telegram 经常无法生成推文预览。
2. **国内图片防盗链 / 无法访问**：即使 Telegram 生成了预览卡片，其图片依然直连推特 CDN，国内访客在博客页面上直接看到图片裂开。
3. **原生图片体验最佳**：如果在频道里发送的是 **Telegram 原生图片（`sendPhoto`）**，`BroadcastChannel` 会自动启用高清灯箱放大、自适应画廊排版，且图片经由 Telegram CDN 转发，国内访客可畅通秒开。

**本项目的解决方案：**
在推特上看到好内容 -> 手机分享发给你的私人 Telegram Bot -> 机器人毫秒级抓取并智能处理（长图卡片/原生高清视频/原图相册/脱敏搬运） -> 自动发布到你的 Telegram 频道 -> 博客实时同步呈现！

---

## ✨ 项目特性

- 🚀 **无需 Twitter API Key**：采用 Twitter 官方公开外嵌 Syndication 接口 + FxTwitter 双引擎降级机制，完全免费、无需申请开发者账号、无月度调用限制。
- 🎨 **极速无头渲染（无浏览器依赖）**：基于 Vercel 的 [Satori](https://github.com/vercel/satori) 与 Rust 的 [Resvg](https://github.com/RazrFalcon/resvg)，告别消耗几百兆内存的 Chromium / Puppeteer，渲染单张图仅需 30~50 毫秒，运行时内存不到 50MB。
- 🎬 **智能视频推文支持（独家优势）**：
  - **原生视频模式（默认推荐 `VIDEO_MODE=video`）**：自动提取推特最高清晰度 MP4 视频并发至频道。因为 **`BroadcastChannel` 博客引擎内置支持 Telegram 视频**，你的博客页面会直接生成可播放的 HTML5 `<video>` 播放器，国内访客在网页上即可直接点播！
  - **静态卡片模式（`VIDEO_MODE=card`）**：自动抓取视频高清封面，并在卡片中央渲染精致的半透明播放按钮（`▶`）与时长角标（如 `0:17`）。
  - **智能 50MB 自适应画质降级**：当推特 1080P/4K 原画视频超出 Telegram 官方 50MB 上传限制时，自动平滑阶梯式回退至 720P/480P 等备选高码率版本，确保视频完整上传绝不丢失。
  - **真实原生比例提取**：在毫秒级自动解析 MP4 物理像素尺寸，完美支持手机竖屏（9:16）与电影宽屏（16:9）自适应流式播放，绝不压缩变形。
- 🀄 **中文字体与多彩 Emoji 完美适配**：自动下载并缓存 `Noto Sans SC`（思源黑体），并通过 Twemoji 矢量引擎自动将所有系统 Emoji（表情、手势、旗帜、组合符号等）渲染为清晰彩色矢量，并在本地进行磁盘极速缓存。
- 🌐 **智能双语翻译（零 API Key）**：内置 Google Translate 免 Key 翻译引擎，外语推文（英文、日文等）自动翻译为简体中文，在长图卡片和 Telegram Caption 中双语对照优雅呈现；中文推文自动跳过不翻译。支持全局一键开关，无需配置任何 API Key 或担心费用。
- 🖼️ **高清原图相册打包（MediaGroup）**：发送推特卡片长图时，自动捆绑推文原始 100% 高清大图组为原生 Telegram 相册。卡片直角排版消除黑边，在 Telegram 中右滑即可查看无损原图细节。
- 🙈 **敏感内容自动遮罩保护（Telegram Spoiler）**：自动识别推特成人/敏感标记（NSFW），为图片与视频一键附带 Telegram 磨砂玻璃打码防剧透，点击即可解开。
- ⚡ **本地磁盘高速持久化缓存**：推文数据、中文字符翻译与几十兆的视频/图片自动持久化写入 `./data/cache/`，重复提交秒级极速响应，支持 `/cache` 与 `/clearcache` 便捷维护。
- 📢 **支持多频道广播**：`TARGET_CHANNEL_ID` 支持配置多个频道（英文逗号隔开），推文一键自动同步发布至多个目标频道。
- 📦 **支持原生搬运模式（去推特化 / 隐私脱敏）**：
  - 支持关闭卡片生成，将推文转为**原生 Telegram 图文相册、纯文字或原生视频**直接搬运到频道。
  - 支持一键抹除推特来源和作者信息，保护发推人隐私，让内容在你的博客上就像原创微动态。
- ⚙️ **Bot 内置交互式设置面板**：私聊发送 `/settings`，直接点击按钮即可即时切换卡片/搬运模式、开启/关闭来源、切换主题和视频处理策略，无需修改配置文件或重启。
- 🛡️ **严格安全鉴权**：支持配置 `ADMIN_USER_IDS` 管理员白名单，防止机器人被他人滥用。
- 🌐 **代理支持**：原生支持 HTTP / SOCKS5 代理，国内服务器也可顺畅连接 Telegram 与 Twitter。
- 🛠️ **自带 CLI 转换工具**：无需启动机器人，一行命令即可在本地快速渲染推文卡片与测试翻译。
- 🐳 **Docker 自动化多架构镜像**：内置 GitHub Actions CI/CD，每次推送到 main 或发 Release 会自动构建并发布 `linux/amd64` 和 `linux/arm64` 镜像到 GitHub Container Registry (GHCR)，服务器无需配置编译环境即可一键拉取运行。

---

## 🚀 快速开始

### 1. 克隆代码与安装依赖

```bash
git clone https://github.com/MaYunFei/tweet-to-channel.git
cd tweet-to-channel
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
# 支持配置多个频道（英文逗号隔开，一键广播发布）：例如 @channel1, -100123456789, @channel2
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

# 转换外语推文并开启双语对照翻译
pnpm convert 20 test-trans.png --translate
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

本项目已配置 GitHub Actions 自动构建多架构 Docker 镜像（支持 AMD64 与 ARM64/甲骨文云），你可以直接拉取预构建镜像，无需在服务器上安装 Node.js 或编译代码。

### 方式 A：Docker Compose 部署（最推荐）

```bash
# 1. 下载 docker-compose.yml 与配置文件模板
curl -O https://raw.githubusercontent.com/MaYunFei/tweet-to-channel/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/MaYunFei/tweet-to-channel/main/.env.example
cp .env.example .env

# 2. 编辑配置填入你的 BOT_TOKEN
vim .env

# 3. 一键拉取镜像并后台运行
docker compose up -d

# 4. 查看运行日志
docker compose logs -f
```

### 方式 B：单命令 `docker run` 直接运行

```bash
docker run -d \
  --name tweet-to-channel \
  --restart unless-stopped \
  -e BOT_TOKEN="你的BotToken" \
  -e ADMIN_USER_IDS="你的TelegramID" \
  -e TARGET_CHANNEL_ID="@你的频道" \
  -e THEME="dark" \
  -v $(pwd)/data:/app/data \
  ghcr.io/mayunfei/tweet-to-channel:latest
```

---

## 🤖 使用方式与模式对比

### 1. 正常卡片模式 vs 搬运模式区别

| 推文类型 | 正常模式（推特卡片/引用） | 搬运模式（原生脱敏/原创化） |
| :--- | :--- | :--- |
| **纯文字推文** | 渲染推特排版高清卡片（带作者头像、昵称、时间戳），Caption 附带推特原文链接。 | **不生成任何卡片**，直接发送纯文本消息。博客上呈现为一条优雅纯文字。 |
| **文字 + 1~4 张图片** | 渲染推特排版长图卡片，并自动附带 100% 高清原图打包为 **Telegram 相册（MediaGroup）** 发送（卡片直角全幅无黑边，右滑即享超清原图）。 | **不生成推特卡片**。直接下载原画质图片，以 Telegram **原生相册画廊**发布，Caption 仅为正文。博客上支持原生多图排版及点击灯箱全屏放大！ |
| **文字 + 视频** | 发布原生 MP4 视频，并在 Caption 中标注 `▶️ 视频推文`、原文链接和 `#Twitter`。 | 发布原生 MP4 视频，Caption **仅保留正文文字**，彻底抹除所有推特链接、作者和标签。博客上呈现为一个纯净的 HTML5 播放器。 |

### 2. 交互控制与快捷指令

- `/settings`：打开设置控制面板，点击按钮实时切换**卡片模式、隐私脱敏、标签、双语翻译、视频处理策略**。
- 直接发送链接：按当前全局设置处理并投递。
- `/anon <链接>`：**快捷匿名搬运**（单次强制脱敏：不生成推特长图、不带来源、不带标签）。
- `/raw <链接>`：**快捷原生搬运**（单次强制原生多媒体搬运，保留来源链接）。
- `/card <链接>`：**快捷卡片模式**（单次强制渲染推特样式长图，含配图时附带高清原画相册）。
- `/cardonly <链接>`：**仅卡片模式**（单次强制仅生成推特长图，不附带原图相册）。
- `/spoiler <链接>`：**快捷敏感遮罩模式**（单次强制开启 Telegram 磨砂打码遮罩）。
- `/nospoiler <链接>`：**快捷无遮罩模式**（单次强制关闭打码，直接全彩展示）。
- `/zh <链接>`：**快捷双语翻译**（单次强制开启中文翻译）。
- `/notrans <链接>`：**快捷纯原文模式**（单次强制关闭翻译）。
- `/cache`：**查看本地缓存状态**（查看已下载媒体占用的磁盘大小与文件数）。
- `/clearcache`：**一键清空本地缓存**（释放磁盘空间）。
- `/nocache <链接>`：**强制跳过缓存**（重新从 Twitter 拉取最新数据并重新下载）。

---

## 📄 开源许可

[MIT License](./LICENSE)
