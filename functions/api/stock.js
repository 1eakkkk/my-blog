// --- START OF FILE functions/api/stock.js ---

// === 配置与常量 ===
const STOCKS_CONFIG = {
    'BLUE': { name: '蓝盾安全', color: '#00f3ff' },
    'GOLD': { name: '神经元科技', color: '#ffd700' },
    'RED':  { name: '荒坂军工', color: '#ff3333' }
};

// 新闻库 (保留原样，随机触发)
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

// 生成随机基价 (100 ~ 2000)
function generateBasePrice() {
    return Math.floor(Math.random() * 1900) + 100;
}

// 获取市场状态 (核心逻辑)
async function getOrUpdateMarket(db) {
    const now = Date.now();
    let states = await db.prepare("SELECT * FROM market_state").all();
    let marketMap = {};
    let logs = [];

    // 1. 初始化 (如果数据库为空)
    if (states.results.length === 0) {
        const batch = [];
        for (let sym in STOCKS_CONFIG) {
            let price = generateBasePrice();
            // 保证基价不一致 (简单处理：微调)
            price += Math.floor(Math.random() * 50); 
            batch.push(db.prepare("INSERT INTO market_state (symbol, current_price, initial_base, last_update) VALUES (?, ?, ?, ?)").bind(sym, price, price, now));
            marketMap[sym] = { p: price, base: price, t: now };
        }
        await db.batch(batch);
        return { market: marketMap, logs: [] };
    }

    // 转为 Map 方便操作
    states.results.forEach(s => marketMap[s.symbol] = { p: s.current_price, base: s.initial_base, t: s.last_update });

    // 2. 检查更新 (每分钟更新一次价格)
    const updates = [];
    
    for (let sym in STOCKS_CONFIG) {
        let st = marketMap[sym];
        
        // 如果距离上次更新超过 60秒
        if (now - st.t >= 60000) {
            // 计算经过了多少分钟 (虽然我们只存最新价，但为了防止长时间没人访问导致价格不动，这里做一次跳跃计算)
            // 为了简化，即使很久没访问，也只算作一次大的波动
            
            // --- 波动算法 ---
            // 基础波动 +/- 5%
            let changePercent = (Math.random() - 0.5) * 0.1; 
            
            // 新闻影响 (20% 概率)
            let newsMsg = null;
            if (Math.random() < 0.2) {
                const newsList = NEWS_DB[sym];
                const news = newsList[Math.floor(Math.random() * newsList.length)];
                changePercent += news.factor; // 叠加新闻涨跌幅
                newsMsg = news;
            }

            let newPrice = st.p * (1 + changePercent);
            newPrice = Math.max(1, Math.floor(newPrice)); // 价格不能低于 1

            // --- 退市检测 (Requirements 4) ---
            // 跌至基价 5% 以下
            if (newPrice < st.base * 0.05) {
                const refundPrice = newPrice; 
                const newBase = generateBasePrice(); // 重生成新股票
                const newStartPrice = newBase;
                
                // 执行退市逻辑：返还所有持仓用户的资金
                // 这需要一个复杂操作，这里简化为：标记退市，下次用户操作时结算
                // 但为了体验，我们在 SQL 里直接结算所有持仓
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

                // 删除持仓
                updates.push(db.prepare("DELETE FROM company_positions WHERE stock_symbol = ?").bind(sym));

                // 重置股票
                updates.push(db.prepare("UPDATE market_state SET current_price = ?, initial_base = ?, last_update = ? WHERE symbol = ?").bind(newStartPrice, newBase, now, sym));
                
                logs.push({ time: now, msg: `【退市公告】${STOCKS_CONFIG[sym].name} 股价崩盘！已强制退市结算 (¥${refundPrice})。新股上市。`, type: 'bad' });
                
                // 更新内存数据以便返回
                marketMap[sym] = { p: newStartPrice, base: newBase, t: now };

            } else {
                // 正常更新
                updates.push(db.prepare("UPDATE market_state SET current_price = ?, last_update = ? WHERE symbol = ?").bind(newPrice, now, sym));
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

// === 主入口 ===
export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    // 尝试获取公司 (可能没有)
    const company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();

    const method = request.method;
    
    // 获取市场状态
    const { market, logs } = await getOrUpdateMarket(db);

    // === GET 请求 ===
    if (method === 'GET') {
        const hasCompany = !!company;
        
        // 破产检测 (Requirements 2)
        let bankrupt = false;
        let report = { msg: '' };
        
        if (hasCompany) {
            // 强制破产 < 100
            if (company.capital < 100) {
                const refund = Math.floor(company.capital * 0.2);
                await db.batch([
                    db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                    db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id),
                    db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(refund, user.id) // 返还个人账户
                ]);
                return Response.json({ 
                    success: true, 
                    bankrupt: true, 
                    report: { msg: `公司资金耗尽 (当前: ${company.capital})。已强制破产清算，返还残值 ${refund} i币。` } 
                });
            }
        }

        // 生成简易K线 (前端只需当前价，为了兼容前端绘图，我们伪造一条直线或简单波动)
        // 由于后端不再存历史K线表，我们前端只画当前点，或者返回一个单点数组
        const chartData = {};
        for (let sym in market) {
            // 为了让前端图表不报错，返回一个长度为1的数组
            chartData[sym] = [{ t: market[sym].t, p: market[sym].p }]; 
        }

        let positions = [];
        if (hasCompany) {
            positions = (await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all()).results;
        }

        return Response.json({
            success: true,
            hasCompany: hasCompany,
            bankrupt: false,
            market: chartData, // 这里的结构适配前端
            rawMarket: market, // 原始数据
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

        // 1. 创建公司 (Requirements 2)
        if (action === 'create') {
            if (company) return Response.json({ error: '已有公司' });
            const cost = 3000; // 固定费用
            if (user.coins < cost) return Response.json({ error: '余额不足' });
            
            await db.batch([
                db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").bind(cost, user.id),
                db.prepare("INSERT INTO user_companies (user_id, name, type, capital, strategy) VALUES (?, ?, ?, ?, ?)").bind(user.id, body.name, body.type, cost, 'normal')
            ]);
            return Response.json({ success: true, message: '公司注册成功' });
        }

        if (!company) return Response.json({ error: '无公司' });

        // 2. 交易 (Requirements 5: 杠杆)
        if (['buy', 'sell', 'cover'].includes(action)) {
            const { symbol, amount, leverage = 1 } = body; // 默认为 1倍
            const qty = parseInt(amount);
            const lev = parseInt(leverage);
            
            if (isNaN(qty) || qty <= 0) return Response.json({ error: '数量无效' });
            if (![1, 2, 5, 10].includes(lev)) return Response.json({ error: '无效杠杆倍率' }); // 限制倍率

            const currentPrice = market[symbol].p;
            const pos = await db.prepare("SELECT * FROM company_positions WHERE company_id = ? AND stock_symbol = ?").bind(company.id, symbol).first();
            const currentHold = pos ? pos.amount : 0;
            const currentLev = pos ? (pos.leverage || 1) : 1;

            const batch = [];
            let logMsg = "";

            // 买入 (做多)
            if (action === 'buy') {
                // 保证金 = (价格 * 数量) / 杠杆
                const marginNeeded = Math.floor((currentPrice * qty) / lev);
                if (company.capital < marginNeeded) return Response.json({ error: '资金(保证金)不足' });

                // 如果已有持仓，检查杠杆是否一致
                if (pos && currentHold !== 0 && currentLev !== lev) {
                    return Response.json({ error: '追加仓位必须使用相同杠杆' });
                }
                
                if (pos && currentHold < 0) return Response.json({ error: '请先平空仓' });

                batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(marginNeeded, company.id));
                
                if (pos) {
                    // 更新均价 (加权平均)
                    // 原总价值: currentHold * avg_price
                    // 新投入价值: qty * currentPrice
                    // 注意：这里均价记录的是名义价值，不是保证金
                    const totalVal = (currentHold * pos.avg_price) + (qty * currentPrice);
                    const newQty = currentHold + qty;
                    const newAvg = totalVal / newQty;
                    batch.push(db.prepare("UPDATE company_positions SET amount = ?, avg_price = ?, leverage = ? WHERE id = ?").bind(newQty, newAvg, lev, pos.id));
                } else {
                    batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage) VALUES (?, ?, ?, ?, ?)").bind(company.id, symbol, qty, currentPrice, lev));
                }
                logMsg = `买入 ${qty} 股 ${symbol} @ ${currentPrice} (x${lev})`;
            }
            // 卖出 (平多 / 做空)
            else if (action === 'sell') {
                // 如果没有持仓，那就是开空单
                if (currentHold <= 0) {
                    // 开空 (Short)
                    const marginNeeded = Math.floor((currentPrice * qty) / lev);
                    if (company.capital < marginNeeded) return Response.json({ error: '保证金不足' });
                    if (pos && currentHold < 0 && currentLev !== lev) return Response.json({ error: '杠杆倍率不一致' });

                    batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(marginNeeded, company.id));
                    
                    if (pos) {
                        const totalVal = (Math.abs(currentHold) * pos.avg_price) + (qty * currentPrice);
                        const newQty = Math.abs(currentHold) + qty;
                        const newAvg = totalVal / newQty;
                        batch.push(db.prepare("UPDATE company_positions SET amount = ?, avg_price = ?, leverage = ? WHERE id = ?").bind(-newQty, newAvg, lev, pos.id));
                    } else {
                        batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage) VALUES (?, ?, ?, ?, ?)").bind(company.id, symbol, -qty, currentPrice, lev));
                    }
                    logMsg = `做空 ${qty} 股 ${symbol} @ ${currentPrice} (x${lev})`;
                } else {
                    // 平多 (Close Long)
                    if (qty > currentHold) return Response.json({ error: '持仓不足' });
                    
                    // 计算盈亏: (当前价 - 均价) * 数量 * 杠杆? 
                    // 不，收益 = (当前价 - 均价) * 数量。
                    // 退回保证金 = (均价 * 数量) / 杠杆。
                    // 实际退回 = 退回保证金 + 盈亏。
                    
                    // 简化逻辑：直接结算差价 + 原始保证金
                    // 原始投入(保证金) = (pos.avg_price * qty) / pos.leverage
                    // 盈亏 = (currentPrice - pos.avg_price) * qty
                    // 返还 = 原始投入 + 盈亏
                    
                    const principle = (pos.avg_price * qty) / pos.leverage;
                    const profit = (currentPrice - pos.avg_price) * qty;
                    const returnAmount = Math.floor(principle + profit);

                    batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(returnAmount, company.id));
                    
                    if (qty === currentHold) batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
                    else batch.push(db.prepare("UPDATE company_positions SET amount = amount - ? WHERE id = ?").bind(qty, pos.id));
                    
                    logMsg = `卖出 ${qty} 股 ${symbol} @ ${currentPrice} (盈亏: ${Math.floor(profit)})`;
                }
            }
            // 平空 (Cover Short)
            else if (action === 'cover') {
                if (currentHold >= 0) return Response.json({ error: '无空单' });
                if (qty > Math.abs(currentHold)) return Response.json({ error: '超出持仓' });
                
                // 空单盈亏 = (卖出均价 - 当前买入价) * 数量
                const principle = (pos.avg_price * qty) / pos.leverage;
                const profit = (pos.avg_price - currentPrice) * qty;
                const returnAmount = Math.floor(principle + profit);

                batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(returnAmount, company.id));
                
                if (qty === Math.abs(currentHold)) batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
                else batch.push(db.prepare("UPDATE company_positions SET amount = amount + ? WHERE id = ?").bind(qty, pos.id));
                
                logMsg = `平空 ${qty} 股 ${symbol} @ ${currentPrice} (盈亏: ${Math.floor(profit)})`;
            }

            await db.batch(batch);
            return Response.json({ success: true, message: '交易执行完毕', log: logMsg });
        }

        // 3. 注资 (Invest)
        if (action === 'invest') {
            const amount = parseInt(body.amount);
            if (user.coins < amount) return Response.json({ error: '余额不足' });
            await db.batch([
                db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").bind(amount, user.id),
                db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(amount, company.id)
            ]);
            return Response.json({ success: true, message: '注资成功' });
        }

        // 4. 提现 (Withdraw)
        if (action === 'withdraw') {
            const amount = parseInt(body.amount);
            if (company.capital < amount) return Response.json({ error: '公司资金不足' });
            const fee = Math.floor(amount * 0.1); // 10% 手续费
            const actual = amount - fee;
            await db.batch([
                db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(amount, company.id),
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(actual, user.id)
            ]);
            return Response.json({ success: true, message: `提现成功 (手续费 ${fee})` });
        }
        
        // 5. 申请破产 (Voluntary Bankruptcy) (Requirements 2)
        if (action === 'bankrupt') {
            if (company.capital >= 500) return Response.json({ error: '资金尚足，禁止破产 (>500)' });
            
            const refund = Math.floor(company.capital * 0.2); // 退还 20%
            await db.batch([
                db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id),
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(refund, user.id)
            ]);
            return Response.json({ success: true, message: `破产清算完毕。返还个人账户 ${refund} i币。` });
        }

        return Response.json({ error: 'Unknown Action' });
    }
}
