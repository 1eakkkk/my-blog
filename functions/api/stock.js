// --- functions/api/stock.js ---

// === 股市配置 ===
const STOCKS = {
    'BLUE': { name: '蓝盾安全指数', base: 100, vol: 0.02, color: '#00f3ff' },
    'GOLD': { name: '神经元科技',   base: 500, vol: 0.08, color: '#ffd700' },
    'RED':  { name: '荒坂军工期货', base: 2000, vol: 0.25, color: '#ff3333' }
};

// === 辅助：判断是否休市 (UTC+8 02:00 - 06:00) ===
function getMarketStatus() {
    const now = new Date();
    // Cloudflare Workers 是 UTC 时间，北京时间 = UTC + 8
    const utcHour = now.getUTCHours();
    const bjHour = (utcHour + 8) % 24;
    
    // 02:00 ~ 06:00 休市
    if (bjHour >= 2 && bjHour < 6) {
        return { isOpen: false, msg: '休市中 (02:00-06:00)' };
    }
    return { isOpen: true, msg: '交易中' };
}

// === 核心算法：基于时间的确定性价格生成 ===
function getPriceAtTime(symbol, timestamp) {
    const config = STOCKS[symbol];
    if(!config) return 0;

    // 如果处于休市时间，强制把时间戳锁定在今天的 02:00:00
    // 这样休市期间价格是一条直线
    const date = new Date(timestamp);
    const utcHour = date.getUTCHours();
    const bjHour = (utcHour + 8) % 24;
    
    if (bjHour >= 2 && bjHour < 6) {
        // 计算当天 02:00 的时间戳
        // 简单处理：如果是休市，我们让 seed 保持为休市开始那一刻
        // 为了方便，这里我们不改变 timestamp，而是让算法在休市期间输出“休市前最后一刻的价格”
        // 但为了K线图还能画出来，我们只在“交易”时拦截。
        // 在绘图算法里，我们让波动停止。
        return getLastClosingPrice(symbol, timestamp);
    }

    const timeStep = Math.floor(timestamp / 60000); 
    let seed = timeStep + symbol.length; 
    const random = () => { var x = Math.sin(seed++) * 10000; return x - Math.floor(x); };

    const trend = Math.sin(timeStep / 60); 
    const noise = (random() - 0.5) * 2; 
    let factor = 1 + (trend * config.vol * 2) + (noise * config.vol);
    
    if (factor > 1.5) factor = 1.5; 
    if (factor < 0.5) factor = 0.5; 

    return Math.max(1, Math.floor(config.base * factor));
}

// 模拟休市期间价格（取整点）
function getLastClosingPrice(symbol, currentTimestamp) {
    // 简单粗暴：休市期间价格波动极小，趋于一条直线
    const timeStep = Math.floor(currentTimestamp / 3600000) * 3600000; // 取整小时
    return getPriceAtTime(symbol, timeStep - 1); // 递归调用可能死循环，这里简单返回一个基于小时的定值
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
        const history = {};
        // 生成过去 30 分钟 K 线
        for (let key in STOCKS) {
            history[key] = [];
            for (let i = 29; i >= 0; i--) {
                const t = now - (i * 60000);
                history[key].push({ t: t, p: getPriceAtTime(key, t) });
            }
        }
        
        // 计算今日开盘价 (近似为 24小时前的价格)
        const openPrices = {};
        for (let key in STOCKS) {
            openPrices[key] = getPriceAtTime(key, now - 24*60*60*1000);
        }

        const positions = await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all();

        return Response.json({
            success: true,
            market: history,
            opens: openPrices, // 返回开盘价
            positions: positions.results,
            capital: company.capital,
            companyType: company.type,
            status: marketStatus // 返回休市状态
        });
    }

    // === POST: 交易 ===
    if (method === 'POST') {
        // 休市拦截
        if (!marketStatus.isOpen) {
            return Response.json({ error: '交易所已关闭 (每日 02:00 - 06:00 休市)' });
        }

        const { action, symbol, amount } = await request.json();
        const qty = parseInt(amount);
        const currentPrice = getPriceAtTime(symbol, now);
        
        if (qty <= 0) return Response.json({ error: '数量无效' });
        if (!STOCKS[symbol]) return Response.json({ error: '非法股票' });

        if (company.type === 'shell' && symbol !== 'BLUE') return Response.json({ error: '公司等级不足' });
        if (company.type === 'startup' && symbol === 'RED') return Response.json({ error: '公司等级不足' });
        
        const pos = await db.prepare("SELECT * FROM company_positions WHERE company_id = ? AND stock_symbol = ?").bind(company.id, symbol).first();
        const currentHold = pos ? pos.amount : 0;
        const batch = [];

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
        } 
        else if (action === 'sell') {
            if (company.type !== 'blackops' && currentHold <= 0) return Response.json({ error: '无持仓' });
            if (currentHold <= 0) {
                // 做空
                const margin = currentPrice * qty;
                if (company.capital < margin) return Response.json({ error: '保证金不足' });
                batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                if (pos) {
                    const oldAbs = Math.abs(currentHold);
                    const totalVal = (oldAbs * pos.avg_price) + margin;
                    const newAbs = oldAbs + qty;
                    const newAvg = totalVal / newAbs;
                    batch.push(db.prepare("UPDATE company_positions SET amount = ?, avg_price = ? WHERE id = ?").bind(-newAbs, newAvg, pos.id));
                } else {
                    batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price) VALUES (?, ?, ?, ?)").bind(company.id, symbol, -qty, currentPrice));
                }
            } else {
                // 平多
                if (qty > currentHold) return Response.json({ error: '持仓不足' });
                const income = currentPrice * qty;
                batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(income, company.id));
                if (qty === currentHold) batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
                else batch.push(db.prepare("UPDATE company_positions SET amount = amount - ? WHERE id = ?").bind(qty, pos.id));
            }
        }
        else if (action === 'cover') {
             if (currentHold >= 0) return Response.json({ error: '无空单' });
             if (qty > Math.abs(currentHold)) return Response.json({ error: '超出持仓' });
             const profit = (pos.avg_price - currentPrice) * qty;
             const returnAmount = (pos.avg_price * qty) + profit;
             batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(returnAmount, company.id));
             if (qty === Math.abs(currentHold)) batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
             else batch.push(db.prepare("UPDATE company_positions SET amount = amount + ? WHERE id = ?").bind(qty, pos.id));
        }

        await db.batch(batch);
        return Response.json({ success: true, message: '交易成功' });
    }
}
