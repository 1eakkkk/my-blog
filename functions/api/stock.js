// --- START OF FILE functions/api/stock.js ---

// === 配置 ===
const STOCKS_CONFIG = {
    'BLUE': { name: '蓝盾安全', color: '#00f3ff' },
    'GOLD': { name: '神经元科技', color: '#ffd700' },
    'RED':  { name: '荒坂军工', color: '#ff3333' }
};

// 新闻库 (保留原样)
const NEWS_DB = {
    'BLUE': [
        { type: 'good', factor: 0.15, msg: "获得政府防火墙大额订单！" },
        { type: 'bad',  factor: -0.15, msg: "服务器遭受大规模 DDoS 攻击！" },
        { type: 'good', factor: 0.10, msg: "发布量子加密算法，黑客渗透率归零。" },
        { type: 'bad', factor: -0.10, msg: "首席架构师涉嫌数据交易被捕。" }
    ],
    'GOLD': [
        { type: 'good', factor: 0.20, msg: "义体排异反应抑制剂研发成功！" },
        { type: 'bad',  factor: -0.20, msg: "数千名用户因芯片故障陷入精神错乱。" },
        { type: 'good', factor: 0.12, msg: "收购顶级仿生义肢实验室。" },
        { type: 'bad', factor: -0.12, msg: "被曝进行非法活体实验。" }
    ],
    'RED': [
        { type: 'good', factor: 0.25, msg: "边境冲突升级，军火订单激增！" },
        { type: 'bad',  factor: -0.25, msg: "总部大楼遭战术核弹袭击！" },
        { type: 'good', factor: 0.15, msg: "发布新型机甲，威慑力拉满。" },
        { type: 'bad', factor: -0.15, msg: "国际法庭冻结其海外资产。" }
    ]
};

function generateBasePrice() {
    return Math.floor(Math.random() * 1900) + 100;
}

// === 核心：获取或更新市场状态 ===
async function getOrUpdateMarket(db) {
    const now = Date.now();
    // 1. 获取当前状态
    let states = await db.prepare("SELECT * FROM market_state").all();
    let marketMap = {};
    let logs = [];
    let updates = [];

    // 2. 初始化 (首次运行)
    if (states.results.length === 0) {
        const batch = [];
        for (let sym in STOCKS_CONFIG) {
            let price = generateBasePrice() + Math.floor(Math.random() * 50);
            // 写入状态
            batch.push(db.prepare("INSERT INTO market_state (symbol, current_price, initial_base, last_update) VALUES (?, ?, ?, ?)").bind(sym, price, price, now));
            // 写入第一条历史记录
            batch.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, price, now));
            
            marketMap[sym] = { p: price, base: price, t: now };
        }
        await db.batch(batch);
        // 初始化时不返回历史，等待下次刷新
        return { market: marketMap, logs: [] };
    }

    // 转为 Map
    states.results.forEach(s => marketMap[s.symbol] = { p: s.current_price, base: s.initial_base, t: s.last_update });

    // 3. 检查更新 (每 60 秒更新一次)
    for (let sym in STOCKS_CONFIG) {
        let st = marketMap[sym];
        
        if (now - st.t >= 60000) {
            // --- 波动算法 ---
            let changePercent = (Math.random() - 0.5) * 0.1; // 基础波动 +/- 5%
            
            let newsMsg = null;
            if (Math.random() < 0.2) {
                const newsList = NEWS_DB[sym];
                const news = newsList[Math.floor(Math.random() * newsList.length)];
                changePercent += news.factor; 
                newsMsg = news;
            }

            let newPrice = Math.max(1, Math.floor(st.p * (1 + changePercent)));

            // --- 退市检测 (< 5% 基价) ---
            if (newPrice < st.base * 0.05) {
                const refundPrice = newPrice; 
                const newBase = generateBasePrice();
                const newStartPrice = newBase;
                
                // 结算所有持仓
                updates.push(db.prepare(`
                    UPDATE user_companies 
                    SET capital = capital + (
                        SELECT IFNULL(SUM(amount * ?), 0) 
                        FROM company_positions 
                        WHERE company_positions.company_id = user_companies.id 
                        AND company_positions.stock_symbol = ?
                    )
                    WHERE id IN (SELECT company_id FROM company_positions WHERE stock_symbol = ?)
                `).bind(refundPrice, sym, sym));

                updates.push(db.prepare("DELETE FROM company_positions WHERE stock_symbol = ?").bind(sym));
                
                // 清空该股票的历史记录 (图表重置)
                updates.push(db.prepare("DELETE FROM market_history WHERE symbol = ?").bind(sym));

                // 重置状态
                updates.push(db.prepare("UPDATE market_state SET current_price = ?, initial_base = ?, last_update = ? WHERE symbol = ?").bind(newStartPrice, newBase, now, sym));
                
                // 写入新的第一条历史
                updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, newStartPrice, now));

                logs.push({ time: now, msg: `【退市公告】${STOCKS_CONFIG[sym].name} 股价崩盘！强制结算(¥${refundPrice})并重组上市。`, type: 'bad' });
                marketMap[sym] = { p: newStartPrice, base: newBase, t: now };

            } else {
                // 正常更新
                updates.push(db.prepare("UPDATE market_state SET current_price = ?, last_update = ? WHERE symbol = ?").bind(newPrice, now, sym));
                
                // 写入历史记录 (K线数据源)
                updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, newPrice, now));
                
                // 清理旧数据 (只保留最近 60 条，约1小时)
                // 这是一个轻量级的清理策略
                updates.push(db.prepare("DELETE FROM market_history WHERE symbol = ? AND id NOT IN (SELECT id FROM market_history WHERE symbol = ? ORDER BY created_at DESC LIMIT 60)").bind(sym, sym));

                marketMap[sym].p = newPrice;
                marketMap[sym].t = now;
                
                if (newsMsg) {
                    logs.push({ time: now, msg: `[${STOCKS_CONFIG[sym].name}] ${newsMsg.msg}`, type: newsMsg.factor > 0 ? 'good' : 'bad' });
                }
            }
        }
    }

    if (updates.length > 0) await db.batch(updates);
    return { market: marketMap, logs: logs };
}

// === API Handler ===
export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id, coins FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();
    const method = request.method;

    // 2. 更新市场
    const { market, logs } = await getOrUpdateMarket(db);

    // === GET 请求 ===
    if (method === 'GET') {
        const hasCompany = !!company;
        
        // 破产判定
        if (hasCompany && company.capital < 100) {
            const refund = Math.floor(company.capital * 0.2);
            await db.batch([
                db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id),
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(refund, user.id)
            ]);
            return Response.json({ success: true, bankrupt: true, report: { msg: `强制破产清算，返还 ${refund} i币。` } });
        }

        // 获取历史 K 线数据 (Chart Data)
        const chartData = {};
        const historyResults = await db.prepare("SELECT symbol, price as p, created_at as t FROM market_history ORDER BY created_at ASC").all();
        
        // 分组数据
        for (let sym in STOCKS_CONFIG) {
            chartData[sym] = historyResults.results.filter(r => r.symbol === sym);
            // 如果某股票没历史(刚初始化)，手动补一个点
            if (chartData[sym].length === 0) {
                chartData[sym] = [{ t: market[sym].t, p: market[sym].p }];
            }
        }

        let positions = [];
        if (hasCompany) {
            positions = (await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all()).results;
        }

        return Response.json({
            success: true,
            hasCompany: hasCompany,
            bankrupt: false,
            market: chartData, // 这里现在是一个数组，前端可以画图了
            news: logs,
            positions: positions,
            capital: hasCompany ? company.capital : 0,
            companyType: hasCompany ? company.type : 'none'
        });
    }

    // === POST 请求 ===
    if (method === 'POST') {
        const body = await request.json();
        const { action } = body;

        // 创建公司
        if (action === 'create') {
            if (company) return Response.json({ error: '已有公司' });
            const cost = 3000;
            if (user.coins < cost) return Response.json({ error: '余额不足' });
            await db.batch([
                db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").bind(cost, user.id),
                db.prepare("INSERT INTO user_companies (user_id, name, type, capital, strategy) VALUES (?, ?, ?, ?, ?)").bind(user.id, body.name, body.type, cost, 'normal')
            ]);
            return Response.json({ success: true, message: '注册成功' });
        }

        if (!company) return Response.json({ error: '无公司' });

        // 申请破产
        if (action === 'bankrupt') {
            if (company.capital >= 500) return Response.json({ error: '资金充足(>500)，禁止破产' });
            const refund = Math.floor(company.capital * 0.2);
            await db.batch([
                db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id),
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(refund, user.id)
            ]);
            return Response.json({ success: true, message: `破产申请通过，返还 ${refund} i币` });
        }

        // 交易 (买/卖/平空)
        if (['buy', 'sell', 'cover'].includes(action)) {
            const { symbol, amount, leverage = 1 } = body;
            const qty = parseInt(amount);
            const lev = parseInt(leverage);
            
            if (isNaN(qty) || qty <= 0) return Response.json({ error: '数量无效' });
            if (![1, 2, 5, 10].includes(lev)) return Response.json({ error: '无效杠杆' });

            const currentPrice = market[symbol].p;
            const pos = await db.prepare("SELECT * FROM company_positions WHERE company_id = ? AND stock_symbol = ?").bind(company.id, symbol).first();
            const currentHold = pos ? pos.amount : 0;
            const currentLev = pos ? (pos.leverage || 1) : 1;

            const batch = [];
            let logMsg = "";

            if (action === 'buy') { // 做多
                const margin = Math.floor((currentPrice * qty) / lev);
                if (company.capital < margin) return Response.json({ error: '保证金不足' });
                if (pos && currentHold < 0) return Response.json({ error: '请先平空仓' });
                if (pos && currentHold > 0 && currentLev !== lev) return Response.json({ error: '杠杆倍率不一致' });

                batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                
                if (pos) {
                    const totalVal = (currentHold * pos.avg_price) + (qty * currentPrice);
                    const newQty = currentHold + qty;
                    const newAvg = totalVal / newQty;
                    batch.push(db.prepare("UPDATE company_positions SET amount = ?, avg_price = ?, leverage = ? WHERE id = ?").bind(newQty, newAvg, lev, pos.id));
                } else {
                    batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage) VALUES (?, ?, ?, ?, ?)").bind(company.id, symbol, qty, currentPrice, lev));
                }
                logMsg = `买入 ${qty} 股 ${symbol} (x${lev})`;
            }
            else if (action === 'sell') { // 卖出 or 开空
                if (currentHold <= 0) { // 开空
                    const margin = Math.floor((currentPrice * qty) / lev);
                    if (company.capital < margin) return Response.json({ error: '保证金不足' });
                    if (pos && currentHold < 0 && currentLev !== lev) return Response.json({ error: '杠杆倍率不一致' });

                    batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                    
                    if (pos) { // 加空仓
                        const totalVal = (Math.abs(currentHold) * pos.avg_price) + (qty * currentPrice);
                        const newQty = Math.abs(currentHold) + qty;
                        const newAvg = totalVal / newQty;
                        batch.push(db.prepare("UPDATE company_positions SET amount = ?, avg_price = ?, leverage = ? WHERE id = ?").bind(-newQty, newAvg, lev, pos.id));
                    } else {
                        batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage) VALUES (?, ?, ?, ?, ?)").bind(company.id, symbol, -qty, currentPrice, lev));
                    }
                    logMsg = `做空 ${qty} 股 ${symbol} (x${lev})`;
                } else { // 平多
                    if (qty > currentHold) return Response.json({ error: '持仓不足' });
                    // 返还本金 + 盈亏
                    // 本金 = (均价 * 数量) / 杠杆
                    // 盈亏 = (现价 - 均价) * 数量
                    const principal = (pos.avg_price * qty) / pos.leverage;
                    const profit = (currentPrice - pos.avg_price) * qty;
                    const returnAmt = Math.floor(principal + profit);

                    batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(returnAmt, company.id));
                    
                    if (qty === currentHold) batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
                    else batch.push(db.prepare("UPDATE company_positions SET amount = amount - ? WHERE id = ?").bind(qty, pos.id));
                    
                    logMsg = `卖出 ${qty} 股 ${symbol} (盈亏: ${Math.floor(profit)})`;
                }
            }
            else if (action === 'cover') { // 平空
                if (currentHold >= 0) return Response.json({ error: '无空单' });
                if (qty > Math.abs(currentHold)) return Response.json({ error: '超出持仓' });
                
                // 空单盈亏 = (均价 - 现价) * 数量
                const principal = (pos.avg_price * qty) / pos.leverage;
                const profit = (pos.avg_price - currentPrice) * qty;
                const returnAmt = Math.floor(principal + profit);

                batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(returnAmt, company.id));
                
                if (qty === Math.abs(currentHold)) batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
                else batch.push(db.prepare("UPDATE company_positions SET amount = amount + ? WHERE id = ?").bind(qty, pos.id));
                
                logMsg = `平空 ${qty} 股 ${symbol} (盈亏: ${Math.floor(profit)})`;
            }

            await db.batch(batch);
            return Response.json({ success: true, message: '交易完成', log: logMsg });
        }

        return Response.json({ error: 'Unknown Action' });
    }
}
