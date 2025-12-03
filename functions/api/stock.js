// --- START OF FILE functions/api/stock.js ---

// === 1. 配置 ===
const STOCKS_CONFIG = {
    'BLUE': { name: '蓝盾安全', color: '#00f3ff' },
    'GOLD': { name: '神经元科技', color: '#ffd700' },
    'RED':  { name: '荒坂军工', color: '#ff3333' }
};

// 新闻库
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

// 生成随机基价
function generateBasePrice() {
    return Math.floor(Math.random() * 1900) + 100;
}

// 获取当前北京时间的小时数 (UTC+8)
function getBJHour(timestamp) {
    return (new Date(timestamp).getUTCHours() + 8) % 24;
}

// === 核心：市场状态机 ===
async function getOrUpdateMarket(db) {
    const now = Date.now();
    const bjHour = getBJHour(now);
    
    // 1. 判断休市时间 (02:00 - 06:00)
    // 注意：如果是 02:00:01，就是休市。直到 05:59:59。
    const isMarketClosed = (bjHour >= 2 && bjHour < 6);

    let states = await db.prepare("SELECT * FROM market_state").all();
    let marketMap = {};
    let logs = [];
    let updates = [];

    // --- 初始化 (首次运行) ---
    if (states.results.length === 0) {
        const batch = [];
        for (let sym in STOCKS_CONFIG) {
            let price = generateBasePrice() + Math.floor(Math.random() * 50);
            batch.push(db.prepare("INSERT INTO market_state (symbol, current_price, initial_base, last_update, is_suspended, open_price) VALUES (?, ?, ?, ?, 0, ?)").bind(sym, price, price, now, price));
            batch.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, price, now));
            marketMap[sym] = { p: price, base: price, t: now, open: price, suspended: 0 };
        }
        await db.batch(batch);
        return { market: marketMap, logs: [], status: { isOpen: !isMarketClosed } };
    }

    // 转为 Map
    states.results.forEach(s => {
        marketMap[s.symbol] = { 
            p: s.current_price, 
            base: s.initial_base, 
            t: s.last_update, 
            open: s.open_price || s.current_price, // 兜底
            suspended: s.is_suspended 
        };
    });

    // --- 每日开盘重置逻辑 ---
    // 判断依据：如果上次更新时间在今天 06:00 之前，而现在已经是 06:00 之后，说明跨越了开盘线
    // 简单处理：我们比较上次更新的“日期”或者简单判断时间差。
    // 为了稳健，我们定义：如果 (Last Update Hour < 6) AND (Current Hour >= 6)，且是在同一天（或跨天），触发重置
    // 或者更简单的：如果在休市期间或之前更新过，且现在开盘了，检查是否需要重置
    
    // 我们采用“每日首次访问触发”机制：
    // 计算今天 06:00 的时间戳
    const today = new Date(now);
    // 设置为 UTC+8 的 06:00 (需要小心处理时区，这里简化处理，假设服务器时间相对稳定)
    // 更可靠的方法：判断 last_update 是否是“昨天”交易日的
    
    // 这里使用一个简化策略：如果 marketMap 中任意一个的 last_update 距离现在超过 4小时(休市时长)，且现在是开盘时间，则视为新的一天开始，重置 suspended
    // 但这样不严谨。
    
    // 严谨策略：
    // 我们检查是否需要 "Daily Reset"。条件：现在是开盘时间，且 (当前时间 - 上次更新时间) 跨越了 06:00 这个点。
    // 但为了不让代码过于复杂，我们利用 `is_suspended` 的特性。
    // 如果现在是开盘时间 (>=6 或 <2)，且发现有股票是 suspended 状态，且其 last_update 是 4小时前（说明是昨天退市的），则重组。
    
    const isNewTradingSession = !isMarketClosed && states.results.some(s => (now - s.last_update) > 3600 * 4);

    if (isNewTradingSession) {
        // 新的一天/新的交易时段开始：
        // 1. 重组所有 suspended 的股票
        // 2. 更新所有股票的 open_price 为当前价格
        for (let sym in STOCKS_CONFIG) {
            let st = marketMap[sym];
            let newPrice = st.p;
            let newBase = st.base;
            let newSuspended = st.suspended;

            // 如果是退市股，重组上市
            if (st.suspended === 1) {
                newBase = generateBasePrice();
                newPrice = newBase; // 新股按基价发行
                newSuspended = 0;   // 解除停牌
                
                // 清空旧历史，让图表重新开始
                updates.push(db.prepare("DELETE FROM market_history WHERE symbol = ?").bind(sym));
                logs.push({ time: now, msg: `【新股上市】${STOCKS_CONFIG[sym].name} 完成重组，今日重新挂牌交易。`, type: 'good' });
            }

            // 更新 Open Price (今日开盘价)
            updates.push(db.prepare("UPDATE market_state SET open_price = ?, current_price = ?, initial_base = ?, is_suspended = ?, last_update = ? WHERE symbol = ?").bind(newPrice, newPrice, newBase, newSuspended, now, sym));
            
            // 更新内存
            st.p = newPrice;
            st.base = newBase;
            st.open = newPrice;
            st.suspended = newSuspended;
            st.t = now;
        }
    }

    // --- 休市中：直接返回，不更新价格 ---
    if (isMarketClosed) {
        // 如果有 updates (可能是上面触发了重置)，执行之
        if (updates.length > 0) await db.batch(updates);
        return { market: marketMap, logs: logs, status: { isOpen: false } };
    }

    // --- 开盘中：正常波动 ---
    for (let sym in STOCKS_CONFIG) {
        let st = marketMap[sym];
        
        // 如果已经退市，且还没到次日重置，跳过计算（保持停牌状态）
        if (st.suspended === 1) continue;

        // 每 60 秒更新一次
        if (now - st.t >= 60000) {
            // 波动算法
            let changePercent = (Math.random() - 0.5) * 0.1; // ±5%
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
                
                // 1. 强制结算所有用户持仓
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

                // 2. 删除持仓记录
                updates.push(db.prepare("DELETE FROM company_positions WHERE stock_symbol = ?").bind(sym));
                
                // 3. 标记为停牌 (suspended = 1)，不要立即重置价格，保持在低位直到次日
                updates.push(db.prepare("UPDATE market_state SET current_price = ?, is_suspended = 1, last_update = ? WHERE symbol = ?").bind(refundPrice, now, sym));
                
                // 4. 写入一条历史记录(归零/低位)
                updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, refundPrice, now));

                logs.push({ time: now, msg: `【停牌公告】${STOCKS_CONFIG[sym].name} 触及退市红线！强制清算并停牌至明日开盘。`, type: 'bad' });
                
                st.p = refundPrice;
                st.suspended = 1; // 内存标记，防止同一次循环重复处理

            } else {
                // --- 正常更新 ---
                updates.push(db.prepare("UPDATE market_state SET current_price = ?, last_update = ? WHERE symbol = ?").bind(newPrice, now, sym));
                
                // 写入历史
                updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, newPrice, now));
                
                // 清理旧历史 (保留最近 120 条，即 2小时，保证前端K线足够长)
                updates.push(db.prepare("DELETE FROM market_history WHERE symbol = ? AND id NOT IN (SELECT id FROM market_history WHERE symbol = ? ORDER BY created_at DESC LIMIT 120)").bind(sym, sym));

                st.p = newPrice;
                st.t = now;
                
                if (newsMsg) {
                    logs.push({ time: now, msg: `[${STOCKS_CONFIG[sym].name}] ${newsMsg.msg}`, type: newsMsg.factor > 0 ? 'good' : 'bad' });
                }
            }
        }
    }

    if (updates.length > 0) await db.batch(updates);
    
    return { market: marketMap, logs: logs, status: { isOpen: true } };
}

// === 主 Handler ===
export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id, coins FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();
    const method = request.method;

    // 更新市场 (获取最新数据)
    const { market, logs, status } = await getOrUpdateMarket(db);

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
            return Response.json({ success: true, bankrupt: true, report: { msg: `公司已强制破产，返还 ${refund} i币。` } });
        }

        // 构造返回给前端的数据
        const chartData = {};
        // 注意：这里我们还需要把 suspended 状态传给前端
        const stockMeta = {}; 

        const historyResults = await db.prepare("SELECT symbol, price as p, created_at as t FROM market_history ORDER BY created_at ASC").all();
        
        for (let sym in STOCKS_CONFIG) {
            // K线数据
            chartData[sym] = historyResults.results.filter(r => r.symbol === sym);
            if (chartData[sym].length === 0) {
                chartData[sym] = [{ t: market[sym].t, p: market[sym].p }];
            }
            // 元数据 (开盘价、停牌状态)
            stockMeta[sym] = {
                open: market[sym].open, // 这是数据库里存的今日开盘价
                suspended: market[sym].suspended
            };
        }

        let positions = [];
        if (hasCompany) {
            positions = (await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all()).results;
        }

        return Response.json({
            success: true,
            hasCompany: hasCompany,
            bankrupt: false,
            market: chartData, 
            meta: stockMeta, // 新增：包含 open_price 和 suspended
            news: logs,
            positions: positions,
            capital: hasCompany ? company.capital : 0,
            companyType: hasCompany ? company.type : 'none',
            status: status
        });
    }

    // === POST 请求 ===
    if (method === 'POST') {
        const body = await request.json();
        const { action } = body;

        // 创建公司
        if (action === 'create') {
            if (company) return Response.json({ error: '已有公司' });
            if (user.coins < 3000) return Response.json({ error: '余额不足' });
            await db.batch([
                db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").bind(3000, user.id),
                db.prepare("INSERT INTO user_companies (user_id, name, type, capital, strategy) VALUES (?, ?, ?, ?, ?)").bind(user.id, body.name, body.type, 3000, 'normal')
            ]);
            return Response.json({ success: true, message: '注册成功' });
        }

        if (!company) return Response.json({ error: '无公司' });

        // 交易校验：休市或个股停牌
        if (['buy', 'sell', 'cover'].includes(action)) {
            if (!status.isOpen) return Response.json({ error: '市场休市中 (02:00-06:00)' });
            
            const { symbol } = body;
            if (market[symbol].suspended === 1) return Response.json({ error: '该股票已退市停牌，无法交易' });
            
            // ... 交易逻辑 ...
            const { amount, leverage = 1 } = body;
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

            // 买入
            if (action === 'buy') {
                const margin = Math.floor((currentPrice * qty) / lev);
                if (company.capital < margin) return Response.json({ error: '保证金不足' });
                if (pos && currentHold < 0) return Response.json({ error: '请先平空仓' });
                if (pos && currentHold > 0 && currentLev !== lev) return Response.json({ error: '杠杆必须一致' });

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
            // 卖出/做空
            else if (action === 'sell') {
                if (currentHold <= 0) { // 做空
                    const margin = Math.floor((currentPrice * qty) / lev);
                    if (company.capital < margin) return Response.json({ error: '保证金不足' });
                    if (pos && currentHold < 0 && currentLev !== lev) return Response.json({ error: '杠杆必须一致' });

                    batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                    if (pos) {
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
                    const principal = (pos.avg_price * qty) / pos.leverage;
                    const profit = (currentPrice - pos.avg_price) * qty;
                    const returnAmt = Math.floor(principal + profit);
                    batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(returnAmt, company.id));
                    if (qty === currentHold) batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
                    else batch.push(db.prepare("UPDATE company_positions SET amount = amount - ? WHERE id = ?").bind(qty, pos.id));
                    logMsg = `卖出 ${qty} 股 ${symbol} (盈亏: ${Math.floor(profit)})`;
                }
            } 
            // 平空
            else if (action === 'cover') {
                if (currentHold >= 0) return Response.json({ error: '无空单' });
                if (qty > Math.abs(currentHold)) return Response.json({ error: '超出持仓' });
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
        
        // 手动破产
        if (action === 'bankrupt') {
            if (company.capital >= 500) return Response.json({ error: '资金充足' });
            const refund = Math.floor(company.capital * 0.2);
            await db.batch([
                db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id),
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(refund, user.id)
            ]);
            return Response.json({ success: true, message: `已破产，返还 ${refund} i币` });
        }

        return Response.json({ error: 'Unknown Action' });
    }
}
