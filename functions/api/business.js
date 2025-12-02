// functions/api/business.js

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ success: false, error: '未登录' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare(`SELECT id, coins, nickname FROM users JOIN sessions ON users.id = sessions.user_id WHERE sessions.session_id = ?`).bind(sessionId).first();
    if (!user) return Response.json({ success: false, error: '会话无效' }, { status: 401 });

    const method = request.method;
    const now = Date.now();
    // 获取今日日期字符串 (YYYY-MM-DD)，用于每日一次结算
    const todayStr = new Date(now + 8 * 3600 * 1000).toISOString().split('T')[0];

    // === 配置：公司类型 ===
    const COMPANY_TYPES = {
        'shell':    { name: '数据作坊', cost: 2500,  base_rate: 0.03, volatility: 0.05, desc: '低风险，稳健收益。' },
        'startup':  { name: '科技独角兽', cost: 6000,  base_rate: 0.06, volatility: 0.15, desc: '中风险，潜力巨大。' },
        'blackops': { name: '黑域工作室', cost: 12000, base_rate: 0.10, volatility: 0.40, desc: '极高风险，可能暴富或破产。' }
    };

    // === 辅助：生成今日全服市场趋势 (根据日期Hash) ===
    // 返回 -0.05 (熊市) 到 +0.05 (牛市) 之间的数值
    function getDailyMarketTrend(dateStr) {
        let hash = 0;
        for (let i = 0; i < dateStr.length; i++) hash = dateStr.charCodeAt(i) + ((hash << 5) - hash);
        const normalized = (Math.sin(hash) + 1) / 2; // 0 ~ 1
        return (normalized * 0.1) - 0.05; // -0.05 ~ +0.05
    }

    // === GET: 获取公司状态 + 触发结算 ===
    if (method === 'GET') {
        let company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();
        
        const marketTrend = getDailyMarketTrend(todayStr);
        const marketName = marketTrend > 0.02 ? '🐂 赛博牛市' : (marketTrend < -0.02 ? '🐻 数据寒冬' : '⚖️ 市场震荡');

        // 如果没有公司，返回空状态
        if (!company) {
            return Response.json({ 
                success: true, 
                hasCompany: false, 
                market: { name: marketName, val: marketTrend } 
            });
        }

        // === 核心：每日结算逻辑 ===
        // 如果上次结算日期不是今天，则进行结算
        let report = null;
        if (company.last_settle_date !== todayStr) {
            const typeConfig = COMPANY_TYPES[company.type];
            
            // 1. 策略修正
            let strategyMult = 1.0;
            let riskMult = 1.0;
            if (company.strategy === 'safe') { strategyMult = 0.5; riskMult = 0.5; }
            if (company.strategy === 'risky') { strategyMult = 1.5; riskMult = 1.5; }

            // 2. 计算波动
            // 随机因子 (-1 ~ 1) * 波动率 * 风险倍率
            const randomFactor = (Math.random() * 2 - 1) * typeConfig.volatility * riskMult;
            
            // 3. 最终涨跌幅 = (基础收益 * 策略) + 市场趋势 + 随机波动
            const rate = (typeConfig.base_rate * strategyMult) + marketTrend + randomFactor;
            
            // 4. 计算盈亏金额
            const profit = Math.floor(company.capital * rate);
            let newCapital = company.capital + profit;

            // 5. 破产判定 (市值低于 100)
            if (newCapital < 100) {
                await db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id).run();
                return Response.json({ 
                    success: true, 
                    hasCompany: false, 
                    bankrupt: true, // 告知前端已破产
                    report: { profit: -company.capital, rate: -100, msg: "资金链断裂，公司宣告破产！" }
                });
            }

            // 6. 更新数据库
            await db.prepare("UPDATE user_companies SET capital = ?, last_settle_date = ? WHERE id = ?")
                .bind(newCapital, todayStr, company.id).run();
            
            // 更新内存对象以便返回
            company.capital = newCapital;
            company.last_settle_date = todayStr;
            
            report = {
                profit: profit,
                rate: (rate * 100).toFixed(2),
                msg: profit >= 0 ? "今日盈利，资产增值" : "今日亏损，市值缩水"
            };
        }

        return Response.json({ 
            success: true, 
            hasCompany: true, 
            company: company,
            market: { name: marketName, val: marketTrend },
            todayReport: report
        });
    }

    // === POST: 创建公司 / 调整策略 / 注资撤资 ===
    if (method === 'POST') {
        const body = await request.json();
        const { action } = body;

        // 1. 创建公司
        if (action === 'create') {
            const { type, name } = body;
            const config = COMPANY_TYPES[type];
            if (!config) return Response.json({ success: false, error: '类型错误' });
            
            // 检查重名 (可选，这里简单起见略过)
            // 检查钱
            if (user.coins < config.cost) return Response.json({ success: false, error: '启动资金不足' });

            const existing = await db.prepare("SELECT id FROM user_companies WHERE user_id = ?").bind(user.id).first();
            if (existing) return Response.json({ success: false, error: '你已经有一家公司了' });

            // 扣钱 + 建公司
            await db.batch([
                db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").bind(config.cost, user.id),
                db.prepare("INSERT INTO user_companies (user_id, name, type, capital, strategy, last_settle_date, created_at) VALUES (?, ?, ?, ?, 'normal', ?, ?)")
                  .bind(user.id, name || `${user.nickname}的产业`, type, config.cost, todayStr, now) 
                  // 注意：创建当天设为已结算(todayStr)，防止刚创建就立刻结算一次
            ]);

            return Response.json({ success: true, message: `[${name}] 注册成功！` });
        }

        // 2. 调整策略
        if (action === 'set_strategy') {
            const { strategy } = body;
            if (!['safe', 'normal', 'risky'].includes(strategy)) return Response.json({ error: '策略无效' });
            
            // 只能修改明天的策略 (如果今天已结算)
            await db.prepare("UPDATE user_companies SET strategy = ? WHERE user_id = ?").bind(strategy, user.id).run();
            return Response.json({ success: true, message: '经营方针已更新，明日生效' });
        }

        // 3. 追加投资 (增资)
        if (action === 'invest') {
            const amount = parseInt(body.amount);
            if (amount < 100) return Response.json({ error: '最少注资 100' });
            if (user.coins < amount) return Response.json({ error: '余额不足' });

            await db.batch([
                db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").bind(amount, user.id),
                db.prepare("UPDATE user_companies SET capital = capital + ? WHERE user_id = ?").bind(amount, user.id)
            ]);
            return Response.json({ success: true, message: `注资成功，市值增加 ${amount}` });
        }

        // 4. 撤资 (提现) - 设有手续费防止频繁进出刷钱
        if (action === 'withdraw') {
            const amount = parseInt(body.amount);
            const company = await db.prepare("SELECT capital FROM user_companies WHERE user_id = ?").bind(user.id).first();
            
            if (!company || company.capital < amount) return Response.json({ error: '公司资金不足' });
            if (company.capital - amount < 100) return Response.json({ error: '必须保留至少 100 储备金，否则请选择破产清算' });

            // 提现手续费 10%
            const fee = Math.floor(amount * 0.1);
            const realGet = amount - fee;

            await db.batch([
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(realGet, user.id),
                db.prepare("UPDATE user_companies SET capital = capital - ? WHERE user_id = ?").bind(amount, user.id)
            ]);
            return Response.json({ success: true, message: `提现成功 (扣税 ${fee})，到账 ${realGet}` });
        }
    }
}
