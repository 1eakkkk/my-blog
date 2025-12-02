// --- functions/api/stock.js ---

// === 股市配置 ===
const STOCKS = {
    'BLUE': { name: '蓝盾安全指数', base: 100, vol: 0.08, color: '#00f3ff' },
    'GOLD': { name: '神经元科技',   base: 500, vol: 0.18, color: '#ffd700' },
    'RED':  { name: '荒坂军工期货', base: 2000, vol: 0.40, color: '#ff3333' }
};

// === 新闻库 ===
const NEWS_DB = {
    'BLUE': [
        { type: 'good', factor: 1.25, msg: "蓝盾安全宣布获得政府防火墙订单！" },
        { type: 'bad',  factor: 0.80, msg: "蓝盾服务器遭遇大规模 DDoS 攻击！" }
    ],
    'GOLD': [
        { type: 'good', factor: 1.40, msg: "神经元科技发布新一代脑机接口！" },
        { type: 'bad',  factor: 0.70, msg: "核心算法被曝存在伦理漏洞，股价跳水。" }
    ],
    'RED': [
        { type: 'good', factor: 1.60, msg: "荒坂军工在边境冲突中大获全胜！" },
        { type: 'bad',  factor: 0.50, msg: "荒坂秘密实验室发生生化泄漏，区域封锁！" }
    ]
};

// === 辅助：判断是否休市 ===
function getMarketStatus() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const bjHour = (utcHour + 8) % 24;
    if (bjHour >= 2 && bjHour < 6) return { isOpen: false };
    return { isOpen: true };
}

// === 核心：获取当前时间段的新闻影响 ===
// 返回 { multiplier: 1.0, event: null/object }
function getNewsImpact(symbol, timestamp) {
    // 每 15 分钟为一个潜在新闻周期
    const newsSlot = Math.floor(timestamp / (15 * 60000));
    
    // 伪随机种子
    let seed = newsSlot + symbol.length * 99;
    const random = () => { var x = Math.sin(seed++) * 10000; return x - Math.floor(x); };

    // 20% 概率触发新闻
    if (random() < 0.2) {
        const events = NEWS_DB[symbol];
        const evt = events[Math.floor(random() * events.length)];
        return { multiplier: evt.factor, event: evt, time: newsSlot * 15 * 60000 };
    }
    return { multiplier: 1.0, event: null };
}

// === 价格算法 (含新闻影响) ===
function getPriceAtTime(symbol, timestamp) {
    const config = STOCKS[symbol];
    if(!config) return 0;

    // 休市锁定逻辑 (略，保持直线)
    const date = new Date(timestamp);
    const utcHour = date.getUTCHours();
    const bjHour = (utcHour + 8) % 24;
    if (bjHour >= 2 && bjHour < 6) {
        // 简单处理：返回休市前一刻的价格
        // 实际上这里应该递归找，为了性能简单处理为定值
        // 只要前端画图时别画这一段就行，或者画直线
        // 这里为了代码稳健，不做特殊处理，让它继续波动，但前端禁止交易
    }

    const timeStep = Math.floor(timestamp / 60000); 
    let seed = timeStep + symbol.length; 
    const random = () => { var x = Math.sin(seed++) * 10000; return x - Math.floor(x); };

    // 1. 基础波动
    const trend = Math.sin(timeStep / 60); 
    const noise = (random() - 0.5) * 2; 
    let factor = 1 + (trend * config.vol * 2) + (noise * config.vol);

    // 2. 叠加新闻影响 (检查当前时刻是否有新闻生效)
    const news = getNewsImpact(symbol, timestamp);
    factor *= news.multiplier;

    // 3. 熔断限制
    if (factor > 2.5) factor = 2.5; // 放宽涨跌停以适应新闻
    if (factor < 0.2) factor = 0.2; 

    return Math.max(1, Math.floor(config.base * factor));
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();
    if (!company) return Response.json({ error: '无公司' }, { status: 400 });

    const method = request.method;
    const now = Date.now();
    const marketStatus = getMarketStatus();

    // === GET ===
    if (method === 'GET') {
        const history = [];
        const recentNews = [];
        
        // 生成 K 线 + 收集新闻
        for (let i = 29; i >= 0; i--) {
            const t = now - (i * 60000);
            
            // 获取该时刻的所有股票价格 (为了简化，前端只请求当前 currentStockSymbol 的数据)
            // 但这里我们只返回所有股票的开盘价，具体的K线让前端切股票时再刷？
            // 不，为了性能，我们一次只返回当前选中的股票，或者全部返回。
            // 之前的逻辑是返回所有股票的 history. 
            // 这里为了配合“新闻日志”，我们检查最近 30 分钟内是否有新闻
        }
        
        // 重新构建返回结构：返回所有股票的 history
        const allHistory = {};
        const allNews = [];

        for (let key in STOCKS) {
            allHistory[key] = [];
            // 检查最近 1 小时的新闻
            for (let i = 0; i < 4; i++) { // 过去4个15分钟刻度
               const t = now - (i * 15 * 60000);
               const n = getNewsImpact(key, t);
               if (n.event) {
                   // 去重推入
                   const exists = allNews.find(x => x.msg === n.event.msg && x.time === n.time);
                   if(!exists) allNews.push({ time: n.time, symbol: key, ...n.event });
               }
            }

            for (let i = 29; i >= 0; i--) {
                const t = now - (i * 60000);
                allHistory[key].push({ t: t, p: getPriceAtTime(key, t) });
            }
        }
        // 按时间倒序排列新闻
        allNews.sort((a, b) => b.time - a.time);

        const openPrices = {};
        for (let key in STOCKS) openPrices[key] = getPriceAtTime(key, now - 24*60*60*1000);

        const positions = await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all();

        return Response.json({
            success: true,
            market: allHistory,
            news: allNews, // 返回新闻列表
            opens: openPrices,
            positions: positions.results,
            capital: company.capital,
            companyType: company.type,
            status: marketStatus
        });
    }

    // === POST: 交易 ===
    if (method === 'POST') {
        if (!marketStatus.isOpen) return Response.json({ error: '休市中' });

        const { action, symbol, amount } = await request.json();
        const qty = parseInt(amount);
        const currentPrice = getPriceAtTime(symbol, now);
        
        if (qty <= 0) return Response.json({ error: '数量无效' });
        
        // ... (权限校验和持仓查询代码保持不变，请直接复用之前的逻辑) ...
        // 为了篇幅，我这里简写了，请务必把之前完整的 buy/sell/cover 逻辑贴回来
        // 核心是：交易成功后，不仅返回 success:true，还要返回交易详情供前端记日志
        
        // 权限校验
        if (company.type === 'shell' && symbol !== 'BLUE') return Response.json({ error: '公司等级不足' });
        if (company.type === 'startup' && symbol === 'RED') return Response.json({ error: '公司等级不足' });

        const pos = await db.prepare("SELECT * FROM company_positions WHERE company_id = ? AND stock_symbol = ?").bind(company.id, symbol).first();
        const currentHold = pos ? pos.amount : 0;
        const batch = [];
        let logMsg = "";

        if (action === 'buy') {
            const cost = currentPrice * qty;
            if (company.capital < cost) return Response.json({ error: '资金不足' });
            batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(cost, company.id));
            if (pos) {
                if (currentHold < 0) return Response.json({ error: '请先平空仓' });
                const totalCost = (currentHold * pos.avg_price) + cost;
                const newQty = currentHold + qty;
                const newAvg = totalCost / newQty;
                batch.push(db.prepare("UPDATE company_positions SET amount = ?, avg_price = ? WHERE id = ?").bind(newQty, newAvg, pos.id));
            } else {
                batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price) VALUES (?, ?, ?, ?)").bind(company.id, symbol, qty, currentPrice));
            }
            logMsg = `买入 ${qty} 股 ${symbol} @ ${currentPrice}`;
        }
        // ... (sell 和 cover 逻辑同理，请务必补全) ...
        else if (action === 'sell') {
             // ... 补全 sell 逻辑 ...
             if (company.type !== 'blackops' && currentHold <= 0) return Response.json({ error: '无持仓' });
             
             if (currentHold <= 0) { // 做空
                 const margin = currentPrice * qty;
                 if (company.capital < margin) return Response.json({ error: '保证金不足' });
                 batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                 if(pos) {
                     // 加空仓
                     const oldAbs = Math.abs(currentHold);
                     const total = (oldAbs * pos.avg_price) + margin;
                     const newAbs = oldAbs + qty;
                     const newAvg = total / newAbs;
                     batch.push(db.prepare("UPDATE company_positions SET amount = ?, avg_price = ? WHERE id = ?").bind(-newAbs, newAvg, pos.id));
                 } else {
                     batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price) VALUES (?, ?, ?, ?)").bind(company.id, symbol, -qty, currentPrice));
                 }
                 logMsg = `做空 ${qty} 股 ${symbol} @ ${currentPrice}`;
             } else { // 平多
                 if (qty > currentHold) return Response.json({ error: '持仓不足' });
                 const income = currentPrice * qty;
                 batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(income, company.id));
                 if (qty === currentHold) batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
                 else batch.push(db.prepare("UPDATE company_positions SET amount = amount - ? WHERE id = ?").bind(qty, pos.id));
                 logMsg = `卖出 ${qty} 股 ${symbol} @ ${currentPrice}`;
             }
        }
        else if (action === 'cover') {
             // ... 补全 cover 逻辑 ...
             if (currentHold >= 0) return Response.json({ error: '无空单' });
             if (qty > Math.abs(currentHold)) return Response.json({ error: '超出持仓' });
             const profit = (pos.avg_price - currentPrice) * qty;
             const returnAmount = (pos.avg_price * qty) + profit;
             batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(returnAmount, company.id));
             if (qty === Math.abs(currentHold)) batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
             else batch.push(db.prepare("UPDATE company_positions SET amount = amount + ? WHERE id = ?").bind(qty, pos.id));
             logMsg = `平空 ${qty} 股 ${symbol} @ ${currentPrice}`;
        }

        await db.batch(updates = batch); // 修正 batch 变量
        return Response.json({ success: true, message: '交易成功', log: logMsg });
    }
}
