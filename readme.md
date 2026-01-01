# 反广告机器人

这是一个用于 Telegram 群组的反广告机器人，旨在检测和处理垃圾广告信息。

## 功能

- 自动检测新用户的发言，判断是否为垃圾广告。
- 提供数学题验证以解除用户的禁言。
- 支持管理员设置处理等级和触发阈值。

## 使用方法

1. 确保已安装 Node.js 和 npm。
2. 克隆此项目并安装依赖：
   ```bash
   git clone <repository-url>
   cd cf-ai-TGantiAD
   npm install
   ```
3. 创建一个 `.env` 文件，设置以下环境变量：
   ```
   BOT_TOKEN=<你的Telegram机器人Token>
   CLOUDFLARE_API_TOKEN=<你的Cloudflare API Token>
   CLOUDFLARE_ACCOUNT_ID=<你的Cloudflare账户ID>
   CLOUDFLARE_GATEWAY_NAME=<你的Cloudflare网关名称>
   WEB_SERVER_PORT=<Web服务器端口>
   WEBSITE_DOMAIN=<你的网站域名>
   ```
4. 启动机器人：
   ```bash
   node amtispambot.js
   ```

## 贡献

欢迎提交问题和拉取请求以改进此项目。
