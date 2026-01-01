# 🤖 反广告机器人

这是一个用于 Telegram 群组的反广告机器人，旨在检测和处理垃圾广告信息。


## 架构与技术

- Telegram Bot：基于 Telegraf 开发，监听群消息并执行管理操作（删除消息、禁言、踢出等）。
- 内容判定：通过 Cloudflare AI Gateway（Llama-3-8b-instruct）进行消息分析并返回 JSON 判断结果。
- 验证与 Web：使用 Express 提供数学题与可选 CAP 验证页面，验证通过后解除限制。
- 存储：使用内存 Map 存放会话与验证请求（可替换为外部数据库以支持持久化与多实例部署）。

## 工作流程

1. 机器人接收群内文本消息并忽略管理员/机器人/自动转发消息。
2. 将消息与用户基本信息发送到 AI 进行判定，返回 spamChance 与 result 等字段。
3. 若触发阈值且为疑似广告，根据设置执行：数学题验证、永久禁言或禁言并踢出。
4. 数学题验证页面可集成 CAP，用户通过后机器人恢复发送权限。

## 🌟 功能

- 🚀 自动检测新用户的发言，判断是否为垃圾广告。
- 🧩 提供数学题验证以解除用户的禁言。
- ⚙️ 支持管理员设置处理等级和触发阈值。

## ✅ 优点

- **高效性**：快速识别并处理垃圾广告，保持群组环境清洁。
- **灵活性**：管理员可以根据需要调整处理策略。
- **用户友好**：通过数学题验证，确保用户身份的真实性。

## 📚 使用方法

1. 确保已安装 Node.js 和 npm。
2. 克隆此项目并安装依赖：
   ```bash
   git clone https://github.com/Johnsheng1/cf-ai-TGantiAD.git
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

## 🤝 贡献

欢迎提交问题和拉取请求以改进此项目。
