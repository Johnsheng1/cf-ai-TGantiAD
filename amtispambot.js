// bot.js

// =================================================================
// ===================== 导入与配置 ==========================
// =================================================================
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const express = require('express');
const crypto = require('crypto');

// 加载所有 .env 变量
const { 
    BOT_TOKEN, 
    CLOUDFLARE_API_TOKEN, 
    CLOUDFLARE_ACCOUNT_ID, 
    CLOUDFLARE_GATEWAY_NAME,
    WEB_SERVER_PORT,
    WEBSITE_DOMAIN,
} = process.env;


const SPAM_CHECK_PROMPT = `
你是一个专用于 Telegram 群组的垃圾广告检测引擎。你的任务是分析用户发言，并以 JSON 格式返回分析结果。

# 核心判断逻辑:
1.  **对于新入群的用户 (加入时间不到1天，发言次数少于3次)**：需要非常严格地审查。如果他们的发言简短、包含网址链接、使用区块链或金融相关的关键词，或者用户名有明显的广告特征，都应被高度怀疑为广告。
2.  **对于群内已有用户 (加入时间超过1天，发言次数超过3次)**：可以适当放宽标准。但如果他们的发言内容与群组主题无关，且有明显的推广意图，或者他们的用户名中也包含明显的垃圾广告特征，也应当提高判定为垃圾广告的概率。
3.  **需要排除的情况**：正常的用户讨论，即使提到了“金融”、“赌博”等关键词，如果没有推广意图，则不是广告。使用谐音、错别字、同音字等变体来规避关键词检测是典型的广告行为。如果聊天内容中没有明显的广告特征，我们应强制认定其发言不是垃圾广告，以免错误封禁。如果当一个消息中**仅含有"白嫖"两字**，则判断这条消息不是垃圾广告。如果当一个消息中**仅含有"广告测试"四字**，则判断这条消息是垃圾广告。

# 用户信息:
{userInfoPrompt}

# 待分析的发言内容:
双引号内的内容是一条来自 Telegram 群组的用户发言: "{question}"

# 你的任务:
请根据以上所有信息，判断这条发言是否是垃圾广告或推广信息？请仅返回一个严格的 JSON 对象，不要包含任何其他说明或文字。

# JSON 输出格式:
{
  "result": <0或1，1表示是广告，0表示不是>,
  "spamChance": <一个0-100的数字，表示是垃圾广告的概率>,
  "spamReason": "<判断是否为垃圾广告的简短原因，如果不是广告则留空>",
  "mockText": "<如果识别为垃圾广告，请进行反馈性的评论。但请注意，在评论中避免使用任何可能暴露用户身份的信息，包括但不限于用户名称、@符号，也不要保留广告所推广的信息。另外，记得提醒其他人不要轻易相信此类信息。评论限制在50字以内，可以包含表情符号>"
}
`;
let SPAM_CHANCE_THRESHOLD = 75;
let ACTION_LEVEL = 1; // 默认使用等级1（数学题验证）

// --- 配置验证 ---
if (!BOT_TOKEN || !CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_GATEWAY_NAME || !WEB_SERVER_PORT || !WEBSITE_DOMAIN) {
    console.error("错误：请确保 .env 文件中已设置所有必需的变量。");
    process.exit(1);
}

// =================================================================
// ===================== 机器人初始化 ========================
// =================================================================
const bot = new Telegraf(BOT_TOKEN);
const userStats = new Map();
const verificationRequests = new Map();

// =================================================================
// ===================== 辅助函数 ==============================
// =================================================================
const gatewayBaseUrl = `https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_GATEWAY_NAME}`;

function extractJSON(text) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]);
    } catch (e) {
        console.error("JSON 解析失败:", e);
        return null;
    }
}

function getTimeDiff(date) {
    const diff = new Date() - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    if (days > 0) return `${days}天${hours}小时`;
    return `${hours}小时`;
}

const isSenderAdmin = async (ctx) => {
    if (ctx.message.sender_chat && ctx.message.sender_chat.id === ctx.chat.id) return true;
    const member = await ctx.getChatMember(ctx.from.id);
    return ['creator', 'administrator'].includes(member.status);
};

// --- 新增 CAP 配置（可通过 .env 控制） ---
const ENABLE_CAP = process.env.ENABLE_CAP_VERIFICATION ? process.env.ENABLE_CAP_VERIFICATION === 'true' : true;
const CAP_DIFFICULTY = parseInt(process.env.CAP_DIFFICULTY || '3', 10); // 旧字段仍保留，兼容性用
const CAP_API_ENDPOINT = process.env.CAP_API_ENDPOINT || 'https://captcha.api.968111.xyz/api/';

// =================================================================
// ===================== 机器人命令 =======================
// =================================================================
bot.start((ctx) => ctx.reply('你好！反广告机器人已启动。请确保我是本群的管理员并拥有“删除消息”和“封禁用户”的权限。'));

bot.command('help', async (ctx) => {
    if (ctx.chat.type === 'private' || await isSenderAdmin(ctx)) {
        const helpMessage = `
⚙️ <b>反广告机器人管理员帮助</b> ⚙️

<b>当前设置:</b>
• <b>处理等级:</b> ${ACTION_LEVEL}
• <b>触发阈值:</b> ${SPAM_CHANCE_THRESHOLD}%

<b>机器人特性:</b>
• 管理员、匿名管理员、其他机器人和联动频道消息将被<b>自动忽略</b>。
• 嫌疑用户将根据处理等级进行验证或封禁。
• 报告将在<b>5分钟后</b>自动删除。

<b>可用命令 (仅管理员):</b>
/setaction <code>[等级]</code> - 设置检测到广告后的处理方式。
  • <code>1</code>: 删除消息 + <b>数学题人机验证</b>。
  • <code>2</code>: 删除消息 + <b>永久禁言</b> (无验证)。
  • <code>3</code>: 删除消息 + <b>永久禁言并踢出</b> (无验证)。

/setthreshold <code>[0-100]</code> - 设置触发操作的广告可能性阈值。
  • <b>示例:</b> <code>/setthreshold 80</code>

/help - 显示此帮助信息。
        `;
        ctx.replyWithHTML(helpMessage);
    }
});

bot.command('setaction', async (ctx) => {
    if (ctx.chat.type === 'private' || !await isSenderAdmin(ctx)) return;
    const level = parseInt(ctx.message.text.split(' ')[1]);
    if (!level || ![1, 2, 3].includes(level)) {
        ctx.reply("❌ 无效的等级。请输入 1, 2, 或 3。");
        return;
    }
    ACTION_LEVEL = level;
    ctx.reply(`✅ 处理等级已设置为: ${level}`);
});

bot.command('setthreshold', async (ctx) => {
    if (ctx.chat.type === 'private' || !await isSenderAdmin(ctx)) return;
    const threshold = parseInt(ctx.message.text.split(' ')[1]);
    if (isNaN(threshold) || threshold < 0 || threshold > 100) {
        ctx.reply("❌ 无效的阈值。请输入一个 0 到 100 之间的数字。");
        return;
    }
    SPAM_CHANCE_THRESHOLD = threshold;
    ctx.reply(`✅ 触发阈值已设置为: ${threshold}%`);
});

// =================================================================
// ===================== Web服务器设置 ==========================
// =================================================================
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 提供数学题验证页面
app.get('/verify/:token', (req, res) => {
    const { token } = req.params;
    const requestData = verificationRequests.get(token);

    if (!requestData) {
        return res.status(404).send('<h1>验证链接无效或已过期</h1>');
    }

    const { num1, num2, operation, capEnabled } = requestData;
    const operatorSymbol = operation === 'add' ? '+' : '×';
    const question = `${num1} ${operatorSymbol} ${num2} = ?`;

    res.send(`
        <!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>人机验证</title>
        <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background-color:#f0f2f5;flex-direction:column}.container{background:white;padding:40px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center}h1{margin-bottom:20px;font-size:2em;}form{display:flex;flex-direction:column;align-items:center;}input{margin:15px 0;padding:10px;font-size:1.5em;width:100px;text-align:center;}button{padding:10px 20px;font-size:1em;cursor:pointer;}#message{margin-top:20px;font-weight:bold}</style></head><body><div class="container">
            <h1>请选择验证方式</h1>
            <div id="math-section">
                <h2>数学题验证（需先完成 CAP）</h2>
                <h3>${question}</h3>
                <form id="verify-form">
                    <input type="number" id="answer" name="answer" required autofocus disabled>
                    <button type="submit" id="submit-btn" disabled>提交答案</button>
                </form>
            </div>
            ${ENABLE_CAP && capEnabled ? `<hr style="width:100%;margin:20px 0"><div id="cap-section"><h2>CAP 人机验证</h2><cap-widget id="cap" data-cap-api-endpoint="${CAP_API_ENDPOINT}"></cap-widget><p id="cap-status">请先完成 CAP 验证以启用答案输入。</p></div><script src="https://cdn.jsdelivr.net/npm/@cap.js/widget@0.1.25"></script>` : `<p>CAP 验证已被禁用；直接提交数学题即可。</p>`}
            <p id="message"></p>
        </div>
            <script>
                // 仅当启用 CAP 时，监听 cap-widget 的 solve 事件
                ${ENABLE_CAP && true ? `
                (function() {
                    let capToken = null;
                    const statusEl = document.getElementById('cap-status');
                    const answerInput = document.getElementById('answer');
                    const submitBtn = document.getElementById('submit-btn');

                    const capEl = document.getElementById('cap');
                    if (capEl) {
                        capEl.addEventListener('solve', function(e) {
                            capToken = e.detail && e.detail.token;
                            if (capToken) {
                                statusEl.textContent = '✅ CAP 验证成功，您现在可以提交数学题答案。';
                                statusEl.style.color = 'green';
                                answerInput.removeAttribute('disabled');
                                submitBtn.removeAttribute('disabled');
                            }
                        });
                        capEl.addEventListener('expired', function() {
                            capToken = null;
                            statusEl.textContent = 'CAP 已过期，请重新验证';
                            statusEl.style.color = 'red';
                            answerInput.setAttribute('disabled', 'true');
                            submitBtn.setAttribute('disabled', 'true');
                        });
                    }

                    document.getElementById('verify-form').addEventListener('submit', function(event) {
                        event.preventDefault();
                        if (!capToken) {
                            document.getElementById('message').textContent = '请先完成 CAP 验证';
                            return;
                        }
                        const answer = document.getElementById('answer').value;
                        const messageEl = document.getElementById('message');
                        messageEl.textContent = '提交中...';
                        
                        fetch(window.location.pathname, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ answer: answer, capToken: capToken })
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.success) {
                                messageEl.textContent = '✅ 验证成功！您现在可以返回群组正常发言了。';
                                messageEl.style.color = 'green';
                                document.getElementById('verify-form').remove();
                            } else {
                                messageEl.textContent = '❌ ' + (data.message || '验证失败，请重试。');
                                messageEl.style.color = 'red';
                            }
                        });
                    });
                })();
                ` : `
                // 当 CAP 禁用时保留旧的提交逻辑（仅提交数学题）
                document.getElementById('verify-form').addEventListener('submit', function(event) {
                    event.preventDefault();
                    const answer = document.getElementById('answer').value;
                    const messageEl = document.getElementById('message');
                    messageEl.textContent = '验证中...';
                    
                    fetch(window.location.pathname, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ answer: answer })
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            messageEl.textContent = '✅ 验证成功！您现在可以返回群组正常发言了。';
                            messageEl.style.color = 'green';
                            document.getElementById('verify-form').remove();
                        } else {
                            messageEl.textContent = '❌ ' + (data.message || '答案错误，请重试。');
                            messageEl.style.color = 'red';
                        }
                    });
                });
                `}
            </script>
        </body></html>
    `);
});

// ===== 新增：处理验证提交请求 =====
app.post('/verify/:token', async (req, res) => {
    const { token: verificationToken } = req.params;
    const { answer: userAnswer, capToken } = req.body;
    const requestData = verificationRequests.get(verificationToken);

    if (!requestData) {
        return res.status(400).json({ success: false, message: '验证请求无效或已过期' });
    }

    // 如果启用了 CAP，则必须先验证 capToken
    if (ENABLE_CAP && requestData.capEnabled) {
        if (!capToken) return res.status(400).json({ success: false, message: '请先完成 CAP 验证' });
        const capResult = await verifyCapToken(capToken);
        if (!capResult.ok) {
            // 记录详细错误以便排查
            console.error(`CAP 验证失败 (token=${capToken}):`, capResult.message);
            return res.status(400).json({ success: false, message: `CAP 验证失败: ${capResult.message}` });
        }
    }

    const parsedAnswer = parseInt(userAnswer, 10);
    if (isNaN(parsedAnswer)) {
        return res.status(400).json({ success: false, message: '答案格式无效' });
    }

    if (parsedAnswer === requestData.answer) {
        const { chatId, userId, username } = requestData;
        try {
            await bot.telegram.restrictChatMember(chatId, userId, { 
                permissions: { 
                    can_send_messages: true, 
                    can_send_media_messages: true, 
                    can_send_polls: true, 
                    can_send_other_messages: true, 
                    can_add_web_page_previews: true, 
                    can_invite_users: true 
                } 
            });
            console.log(`用户 ${username} (ID: ${userId}) 在群组 ${chatId} 中已成功通过验证并被解除限制。`);
            verificationRequests.delete(verificationToken);
            return res.json({ success: true });
        } catch (e) {
            console.error("解除用户限制时失败:", e);
            return res.status(500).json({ success: false, message: '解除限制时发生内部错误' });
        }
    } else {
        return res.status(400).json({ success: false, message: '答案错误，请仔细检查后重试' });
    }
});

// ===== 替换为：更准确并优先使用 /validate 的 CAP Token 校验函数 =====
async function verifyCapToken(token) {
	try {
		if (!token) return { ok: false, message: '无 CAP token' };
		const base = CAP_API_ENDPOINT.replace(/\/$/, '');

		// 优先按照官方示例尝试 /validate（会成为 .../api/validate 当 base 已包含 /api）
		const preferredPaths = ['/validate', '/api/validate'];
		const otherPaths = ['/verify', '/redeem', '/solutions/verify', '/solutions/redeem', '/solution/verify', '/solution/redeem', '/token/verify', '/api/verify', '/'];
		const paths = [...preferredPaths, ...otherPaths];

		// 主要 payload：符合示例的结构（含 keepToken）
		const payloads = [
			{ token, keepToken: false },
			{ captchaToken: token, keepToken: false },
			{ solution: token, keepToken: false },
			{ capToken: token, keepToken: false },
			{ cap_token: token, keepToken: false },
			{ token },
			{ solution: token },
			{ capToken: token }
		];

		let lastError = null;
		for (const path of paths) {
			const url = base + path;
			// 先尝试 POST 各种 payload
			for (const payload of payloads) {
				try {
					const resp = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 });
					const data = resp.data;
					if (data && (data.success === true || data.valid === true || data.ok === true)) return { ok: true };
					// 有些实现返回 { success: 1 } 或其它 truthy 值
					if (data && Object.values(data).some(v => v === true || v === 1 || v === 'ok')) return { ok: true };
				} catch (e) {
					lastError = e;
					if (e.response && e.response.status === 404) continue; // 路径不存在，换下一个
					continue; // 其他错误继续尝试下一个 payload/path
				}
			}
			// 再尝试 GET ?token=...
			try {
				const resp = await axios.get(url, { params: { token }, timeout: 5000 });
				const data = resp.data;
				if (data && (data.success === true || data.valid === true || data.ok === true)) return { ok: true };
				if (data && Object.values(data).some(v => v === true || v === 1 || v === 'ok')) return { ok: true };
			} catch (e) {
				lastError = e;
				continue;
			}
		}
		console.error("CAP 验证错误:", lastError && (lastError.response ? lastError.response.data : lastError.message));
		return { ok: false, message: lastError && (lastError.response ? JSON.stringify(lastError.response.data) : lastError.message) || '未知错误' };
	} catch (e) {
		console.error("verifyCapToken 内部错误:", e);
		return { ok: false, message: e.message || '内部错误' };
	}
}

// ===== 新增：检查是否为垃圾广告的函数 =====
async function checkSpam(ctx) {
    const user = ctx.from;
    const stats = userStats.get(ctx.chat.id)?.get(user.id) || { joinTime: new Date(), count: 1 };
    const userInfoPrompt = `- 该用户的名称为 "${user.first_name}${user.last_name ? ' ' + user.last_name : ''}"\n- 这是该用户在本群的第 ${stats.count} 次发言\n- 该用户于约 ${getTimeDiff(stats.joinTime)} 前加入群组`;
    const finalPrompt = SPAM_CHECK_PROMPT.replace('{userInfoPrompt}', userInfoPrompt).replace('{question}', ctx.message.text || '');

    try {
        const response = await axios.post(
            `${gatewayBaseUrl}/workers-ai/@cf/meta/llama-3-8b-instruct`,
            { "messages": [{ "role": "user", "content": finalPrompt }] },
            { headers: { 'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        // 兼容不同返回结构，优先解析 response.data.result.response
        const raw = response?.data?.result?.response || response?.data?.response || '';
        return extractJSON(raw);
    } catch (error) {
        console.error("调用 AI Gateway 时出错:", error.response ? error.response.data : error.message);
        return null;
    }
}

// ===== 修改创建验证请求处：不再存 capChallenge/capDifficulty，改为 capEnabled 标志 =====
bot.on('text', async (ctx) => {
    if (ctx.chat.type === 'private' || ctx.message.is_automatic_forward || ctx.from.is_bot || await isSenderAdmin(ctx)) return;
    
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;

    if (!userStats.has(chatId)) userStats.set(chatId, new Map());
    const chatUserStats = userStats.get(chatId);
    if (!chatUserStats.has(userId)) {
        chatUserStats.set(userId, { joinTime: new Date(), count: 1 });
    } else {
        chatUserStats.get(userId).count++;
    }
    
    const analysisResult = await checkSpam(ctx);
    if (!analysisResult) return;

    if (analysisResult.result === 1 && analysisResult.spamChance >= SPAM_CHANCE_THRESHOLD) {
        const username = ctx.from.first_name;
        try {
            await ctx.deleteMessage(ctx.message.message_id);

            if (ACTION_LEVEL === 1) { // 禁言并提供数学题验证
                const num1 = Math.floor(Math.random() * 10);
                const num2 = Math.floor(Math.random() * 10);
                const operation = Math.random() < 0.5 ? 'add' : 'multiply';
                const answer = operation === 'add' ? num1 + num2 : num1 * num2;
                
                await ctx.restrictChatMember(userId, { permissions: { can_send_messages: false } });

                const verificationToken = crypto.randomBytes(20).toString('hex');
                verificationRequests.set(verificationToken, { chatId, userId, username, num1, num2, operation, answer, capEnabled: ENABLE_CAP });
                const verificationUrl = `${WEBSITE_DOMAIN}/verify/${verificationToken}`;
                const verificationButton = Markup.inlineKeyboard([Markup.button.url('➡️ 点击此处进行人机验证 ⬅️', verificationUrl)]);
                
                const userMention = `<a href="tg://user?id=${userId}">${username}</a>`;
                const reportMessage = `🚨 <b>系统警告</b> 🚨\n用户 ${userMention} 的发言 (可疑度: ${analysisResult.spamChance}%) 被判定为潜在广告。\n\n<b>为防止误判，该用户已被临时禁言。</b>\n请在下方按钮处完成数学题验证以解除限制。`;
                const sentReport = await ctx.replyWithHTML(reportMessage, verificationButton);
                setTimeout(() => { ctx.telegram.deleteMessage(chatId, sentReport.message_id).catch(() => {}); }, 300 * 1000);
            
            } else { // 永久禁言或踢出
                await ctx.banChatMember(userId);
                const actionText = ACTION_LEVEL === 2 ? "永久禁言" : "永久禁言并踢出";
                const reportMessage = `🚨 <b>广告已被处理</b> 🚨\n用户 ${username} (可疑度: ${analysisResult.spamChance}%) 已被<b>${actionText}</b>。`;
                const sentReport = await ctx.replyWithHTML(reportMessage);
                setTimeout(() => { ctx.telegram.deleteMessage(chatId, sentReport.message_id).catch(() => {}); }, 300 * 1000);
            }
        } catch (err) {
            console.error("执行操作时失败:", err.message);
        }
    }
});

// =================================================================
// ===================== 启动所有服务 ==========================
// =================================================================
app.listen(WEB_SERVER_PORT, () => { console.log(`Web服务器已在端口 ${WEB_SERVER_PORT} 上启动，用于数学题验证。`); });

bot.launch().then(() => { console.log(`终极反广告机器人已成功启动！`); });

process.once('SIGINT', () => { bot.stop('SIGINT'); process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); process.exit(0); });