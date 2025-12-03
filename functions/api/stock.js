// --- START OF FILE functions/api/stock.js ---

const STOCKS_CONFIG = {
    'BLUE': { name: '蓝盾安全', color: '#00f3ff' },
    'GOLD': { name: '神经元科技', color: '#ffd700' },
    'RED':  { name: '荒坂军工', color: '#ff3333' }
};

const NEWS_DB = {
    'BLUE': [
        { weight: 10, factor: 0.05, msg: "分析师上调蓝盾安全评级，称其现金流健康。" },
        { weight: 10, factor: 0.08, msg: "蓝盾安全宣布与多家中小企业签订维护合同。" },
        { weight: 10, factor: 0.05, msg: "蓝盾安全开宣传发布会，宣传他们的最新防护系统。" },
        { weight: 10, factor: -0.05, msg: "有媒体秘密报道称其现金流不是很健康。" },
        { weight: 10, factor: -0.05, msg: "蓝盾安全被曝出存在欺压员工行为。" },
        { weight: 10, factor: -0.05, msg: "传闻蓝盾高层正在抛售股票，引发市场微小恐慌。" },
        { weight: 10, factor: -0.08, msg: "部分用户投诉蓝盾防火墙误报率上升。" },
        { weight: 5, factor: 0.15, msg: "获得政府防火墙二期工程大额订单！" },
        { weight: 5, factor: 0.12, msg: "发布‘量子迷宫’加密算法，黑客渗透率归零。" },
        { weight: 5, factor: -0.15, msg: "服务器遭受大规模 DDoS 攻击，服务短暂中断！" },
        { weight: 5, factor: -0.12, msg: "首席架构师涉嫌私下交易用户数据被捕。" },
        { weight: 5, factor: 0.18, msg: "竞争对手的数据中心发生物理熔断，蓝盾市场份额激增。" },
        { weight: 1, factor: 0.30, msg: "【重磅】夜之城市政厅宣布蓝盾为唯一指定安全供应商！" },
        { weight: 1, factor: -0.30, msg: "【突发】蓝盾核心数据库遭 0-day 漏洞攻破，数亿数据泄露！" },
        { weight: 1, factor: -0.25, msg: "【丑闻】蓝盾被曝协助大企业非法监控员工脑机接口。" }
    ],
    'GOLD': [
        { weight: 10, factor: 0.06, msg: "新款义体‘赫尔墨斯’销量稳步增长。" },
        { weight: 10, factor: 0.05, msg: "神经元科技赞助了本届赛博格格斗大赛。" },
        { weight: 10, factor: -0.05, msg: "神经元科技被曝出非法集资。" },
        { weight: 10, factor: 0.06, msg: "原材料价格下跌，义体生产成本略微减少。" },
        { weight: 10, factor: -0.06, msg: "原材料价格上涨，义体生产成本略微增加。" },
        { weight: 10, factor: -0.05, msg: "医保法案修正案推迟，影响部分义体报销。" },
        { weight: 5, factor: 0.20, msg: "义体排异反应抑制剂研发成功，通过临床三期！" },
        { weight: 5, factor: 0.15, msg: "收购顶级仿生义肢实验室，技术壁垒加深。" },
        { weight: 5, factor: -0.20, msg: "数千名用户因芯片固件故障陷入精神错乱。" },
        { weight: 5, factor: -0.15, msg: "被曝在贫民窟进行非法活体实验。" },
        { weight: 5, factor: 0.18, msg: "‘数字永生’项目取得突破，记忆备份仅需5秒。" },
        { weight: 1, factor: 0.35, msg: "【跨时代】神经元科技宣布实现完美意识上传！股价飞升！" },
        { weight: 1, factor: -0.35, msg: "【灾难】核心 AI 产生自我意识并试图控制人类，已被物理断网！" },
        { weight: 1, factor: -0.28, msg: "【制裁】生物伦理委员会叫停其克隆人计划，罚款百亿。" }
    ],
    'RED': [
        { weight: 10, factor: 0.08, msg: "荒坂安保部门成功镇压了一起局部暴乱。" },
        { weight: 10, factor: 0.08, msg: "荒坂安保部门宣布与蓝盾安全达成协议，合作共赢。" },
        { weight: 10, factor: 0.08, msg: "荒坂安保部门被曝出内部人员关系混乱。" },
        { weight: 10, factor: 0.05, msg: "荒坂军工发布新一季度的雇佣兵招募计划。" },
        { weight: 10, factor: -0.07, msg: "反战组织在荒坂分部大楼下拉横幅抗议。" },
        { weight: 10, factor: -0.05, msg: "一批常规弹药在运输途中被流浪者劫持。" },
        { weight: 5, factor: 0.25, msg: "边境冲突升级，各国军火订单激增！" },
        { weight: 5, factor: 0.18, msg: "发布新型‘半人马’机甲，单兵威慑力拉满。" },
        { weight: 5, factor: -0.20, msg: "国际法庭宣布冻结荒坂在欧非的海外资产。" },
        { weight: 5, factor: -0.25, msg: "荒坂总部大楼遭战术核弹袭击！大楼主体受损！" },
        { weight: 5, factor: 0.22, msg: "成功试爆微型反物质炸弹，技术遥遥领先。" },
        { weight: 1, factor: 0.40, msg: "【战争】第四次企业战争全面爆发！荒坂股价火箭式暴涨！" },
        { weight: 1, factor: -0.40, msg: "【覆灭】荒坂内部爆发夺权内战，全球业务陷入瘫痪！" },
        { weight: 1, factor: -0.30, msg: "【泄密】荒坂被曝双面军火交易，同时资助反叛军。" }
    ]
};

function generateBasePrice() { return Math.floor(Math.random() * 1900) + 100; }
function getBJHour(ts) { return (new Date(ts).getUTCHours() + 8) % 24; }

function pickWeightedNews(symbol) {
    const list = NEWS_DB[symbol];
    if (!list) return null;
    let total = list.reduce((a, b) => a + b.weight, 0);
    let r = Math.random() * total;
    for (let item of list) {
        r -= item.weight;
        if (r <= 0) return item;
    }
    return list[0];
}

// === 计算持仓的当前清算价值 (用于判断是否破产) ===
function calculatePositionValue(pos, currentPrice) {
    const qty = pos.amount;
    const avg = pos.avg_price;
    const lev = pos.leverage || 1;
    
    // 1. 计算原始保证金 (Principal)
    // 注意：qty 可能是负数(空单)，计算保证金要用绝对值
    const principal = (avg * Math.abs(qty)) / lev;
    
    // 2. 计算盈亏 (Profit)
    let profit = 0;
    if (qty > 0) {
        // 多单盈亏: (现价 - 均价) * 数量
        profit = (currentPrice - avg) * qty;
    } else {
        // 空单盈亏: (均价 - 现价) * 绝对数量
        profit = (avg - currentPrice) * Math.abs(qty);
    }
    
    // 3. 净值 = 本金 + 盈亏
    // 如果亏损超过本金，这就变成负数了（穿仓）
    return Math.floor(principal + profit);
}

async function getOrUpdateMarket(db) {
    const now = Date.now();
    const bjHour = getBJHour(now);
    const isMarketClosed = (bjHour >= 2 && bjHour < 6);

    let states = await db.prepare("SELECT * FROM market_state").all();
    let marketMap = {};
    let updates = [];

    // 初始化
    if (states.results.length === 0) {
        const batch = [];
        for (let sym in STOCKS_CONFIG) {
            let p = generateBasePrice() + 50;
            batch.push(db.prepare("INSERT INTO market_state (symbol, current_price, initial_base, last_update, is_suspended, open_price, last_news_time) VALUES (?, ?, ?, ?, 0, ?, ?)").bind(sym, p, p, now, p, now));
            batch.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, p, now));
            marketMap[sym] = { p: p, base: p, t: now, open: p, suspended: 0, last_news: now };
        }
        await db.batch(batch);
        return { market: marketMap, status: { isOpen: !isMarketClosed } };
    }

    states.results.forEach(s => {
        marketMap[s.symbol] = { 
            p: s.current_price, base: s.initial_base, t: s.last_update, 
            open: s.open_price || s.current_price, suspended: s.is_suspended, 
            last_news: s.last_news_time || 0 
        };
    });

    // 每日重置
    const isNewDay = !isMarketClosed && states.results.some(s => (now - s.last_update) > 3600 * 4000);
    if (isNewDay) {
        for (let sym in STOCKS_CONFIG) {
            let st = marketMap[sym];
            let newP = st.p;
            let newBase = st.base;
            let newSusp = st.suspended;
            
            if (st.suspended === 1) {
                newBase = generateBasePrice(); newP = newBase; newSusp = 0;
                updates.push(db.prepare("DELETE FROM market_history WHERE symbol = ?").bind(sym));
                updates.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(sym, `【新股上市】${STOCKS_CONFIG[sym].name} 重组挂牌。`, 'good', now));
            }
            updates.push(db.prepare("UPDATE market_state SET open_price=?, current_price=?, initial_base=?, is_suspended=?, last_update=? WHERE symbol=?").bind(newP, newP, newBase, newSusp, now, sym));
            st.p = newP; st.base = newBase; st.open = newP; st.suspended = newSusp; st.t = now;
        }
    }

    if (isMarketClosed) {
        if (updates.length > 0) await db.batch(updates);
        return { market: marketMap, status: { isOpen: false } };
    }

    // 追赶逻辑
    for (let sym in STOCKS_CONFIG) {
        let st = marketMap[sym];
        if (st.suspended === 1) continue;

        let missed = Math.floor((now - st.t) / 60000);
        if (missed <= 0) continue;
        if (missed > 60) { st.t = now - 3600000; missed = 60; }

        let curP = st.p;
        let simT = st.t;
        let nextNewsT = st.last_news;

        for (let i = 0; i < missed; i++) {
            simT += 60000;
            let change = (Math.random() - 0.5) * 0.2; // +/- 10%
            
            if (simT - nextNewsT >= 300000) {
                nextNewsT = simT;
                if (Math.random() < 0.4) {
                    const news = pickWeightedNews(sym);
                    if (news) {
                        change += news.factor;
                        updates.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(sym, `[${STOCKS_CONFIG[sym].name}] ${news.msg}`, news.factor > 0 ? 'good' : 'bad', simT));
                    }
                }
            }

            curP = Math.max(1, Math.floor(curP * (1 + change)));

            if (curP < st.base * 0.05) {
                const refund = curP;
                // 退市逻辑：清理持仓并返还
                updates.push(db.prepare(`UPDATE user_companies SET capital = capital + (SELECT IFNULL(SUM(amount * ?), 0) FROM company_positions WHERE company_positions.company_id = user_companies.id AND company_positions.stock_symbol = ?) WHERE id IN (SELECT company_id FROM company_positions WHERE stock_symbol = ?)`).bind(refund, sym, sym));
                updates.push(db.prepare("DELETE FROM company_positions WHERE stock_symbol = ?").bind(sym));
                
                updates.push(db.prepare("UPDATE market_state SET current_price=?, is_suspended=1, last_update=? WHERE symbol=?").bind(refund, simT, sym));
                updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, refund, simT));
                updates.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(sym, `【停牌】${STOCKS_CONFIG[sym].name} 触及红线，强制清算。`, 'bad', simT));
                st.suspended = 1; st.p = refund;
                break;
            }

            updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, curP, simT));
        }

        if (st.suspended !== 1) {
            updates.push(db.prepare("UPDATE market_state SET current_price=?, last_update=?, last_news_time=? WHERE symbol=?").bind(curP, simT, nextNewsT, sym));
            st.p = curP; st.t = simT; st.last_news = nextNewsT;
        }
        
        updates.push(db.prepare("DELETE FROM market_history WHERE symbol=? AND id NOT IN (SELECT id FROM market_history WHERE symbol=? ORDER BY created_at DESC LIMIT 120)").bind(sym, sym));
    }
    
    const expireTime = now - (15 * 60 * 1000);
    updates.push(db.prepare("DELETE FROM market_logs WHERE created_at < ?").bind(expireTime));

    if (updates.length > 0) await db.batch(updates);
    return { market: marketMap, status: { isOpen: true } };
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id, coins FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();
    const method = request.method;
    const { market, status } = await getOrUpdateMarket(db);

    if (method === 'GET') {
        const hasCompany = !!company;
        let positions = [];
        
        // === 破产检测逻辑升级 (核心修复) ===
        if (hasCompany) {
            positions = (await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all()).results;
            
            // 1. 计算总净值 (Total Equity) = 现金 + 所有持仓的当前价值
            let totalEquity = company.capital; 
            
            positions.forEach(pos => {
                const currentP = market[pos.stock_symbol].p;
                // 如果股票停牌，按当前价(退市价)结算
                // 调用上面的辅助函数计算价值
                const val = calculatePositionValue(pos, currentP);
                totalEquity += val;
            });

            // 2. 只有当 总净值 < 100 时，才强制破产
            // 注意：如果 totalEquity < 0 (穿仓)，也算破产
            if (totalEquity < 100) {
                const refund = Math.max(0, Math.floor(totalEquity * 0.2)); // 残值返还，如果是负资产则返还0
                
                await db.batch([
                    db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                    db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id),
                    db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(refund, user.id)
                ]);
                return Response.json({ success: true, bankrupt: true, report: { msg: `公司资不抵债 (净值: ${totalEquity})，强制破产清算。` } });
            }
        }

        const chartData = {};
        const stockMeta = {};
        const historyResults = await db.prepare("SELECT symbol, price as p, created_at as t FROM market_history ORDER BY created_at ASC").all();
        
        for (let sym in STOCKS_CONFIG) {
            chartData[sym] = historyResults.results.filter(r => r.symbol === sym);
            if (chartData[sym].length === 0) chartData[sym] = [{ t: market[sym].t, p: market[sym].p }];
            stockMeta[sym] = { open: market[sym].open, suspended: market[sym].suspended };
        }

        const logsRes = await db.prepare("SELECT * FROM market_logs ORDER BY created_at DESC LIMIT 50").all();
        const logs = logsRes.results.map(l => ({ time: l.created_at, msg: l.msg, type: l.type }));

        return Response.json({
            success: true, hasCompany, bankrupt: false,
            market: chartData, meta: stockMeta, news: logs, positions,
            capital: hasCompany ? company.capital : 0,
            companyType: hasCompany ? company.type : 'none',
            status
        });
    }

    if (method === 'POST') {
        const body = await request.json();
        const { action, symbol, amount, leverage = 1 } = body;

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
        
        // 手动破产逻辑也需要更新：检查净值是否大于 500
        if (action === 'bankrupt') {
            // 获取最新持仓计算净值
            const allPos = (await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all()).results;
            let totalEquity = company.capital;
            allPos.forEach(p => {
                totalEquity += calculatePositionValue(p, market[p.stock_symbol].p);
            });

            if (totalEquity >= 500) return Response.json({ error: `净值尚足 (${totalEquity} > 500)，禁止恶意破产` });
            
            const refund = Math.max(0, Math.floor(totalEquity * 0.2));
            await db.batch([
                db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id),
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(refund, user.id)
            ]);
            return Response.json({ success: true, message: `已破产，返还 ${refund}` });
        }

        if (['buy', 'sell', 'cover'].includes(action)) {
            if (!status.isOpen) return Response.json({ error: '休市' });
            if (market[symbol].suspended === 1) return Response.json({ error: '停牌' });
            
            const qty = parseInt(amount);
            const lev = parseInt(leverage);
            if (isNaN(qty) || qty <= 0) return Response.json({ error: '数量无效' });

            const curP = market[symbol].p;
            const pos = await db.prepare("SELECT * FROM company_positions WHERE company_id = ? AND stock_symbol = ?").bind(company.id, symbol).first();
            const curHold = pos ? pos.amount : 0;
            const curLev = pos ? (pos.leverage || 1) : 1;
            const batch = [];
            let logMsg = "";

            if (action === 'buy') {
                const margin = Math.floor((curP * qty) / lev);
                if (company.capital < margin) return Response.json({ error: '资金(保证金)不足' });
                if (pos && curHold < 0) return Response.json({ error: '检测到空单，请先平空' });
                if (pos && curHold > 0 && curLev !== lev) return Response.json({ error: '杠杆倍率不一致' });

                batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                if (pos) {
                    const totalVal = (curHold * pos.avg_price) + (qty * curP);
                    const newQty = curHold + qty;
                    const newAvg = totalVal / newQty;
                    batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=? WHERE id=?").bind(newQty, newAvg, lev, pos.id));
                } else {
                    batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage) VALUES (?, ?, ?, ?, ?)").bind(company.id, symbol, qty, curP, lev));
                }
                logMsg = `买入 ${qty} 股 ${symbol} (x${lev})`;
            }
            else if (action === 'sell') {
                if (curHold <= 0) { 
                    const margin = Math.floor((curP * qty) / lev);
                    if (company.capital < margin) return Response.json({ error: '资金(保证金)不足' });
                    if (pos && curHold < 0 && curLev !== lev) return Response.json({ error: '杠杆倍率不一致' });

                    batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                    if (pos) {
                        const totalVal = (Math.abs(curHold) * pos.avg_price) + (qty * curP);
                        const newQty = Math.abs(curHold) + qty;
                        const newAvg = totalVal / newQty;
                        batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=? WHERE id=?").bind(-newQty, newAvg, lev, pos.id));
                    } else {
                        batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage) VALUES (?, ?, ?, ?, ?)").bind(company.id, symbol, -qty, curP, lev));
                    }
                    logMsg = `做空 ${qty} 股 ${symbol} (x${lev})`;
                } else { 
                    if (qty > curHold) return Response.json({ error: '持仓不足' });
                    const prin = (pos.avg_price * qty) / pos.leverage;
                    const prof = (curP - pos.avg_price) * qty;
                    const ret = Math.floor(prin + prof);
                    batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(ret, company.id));
                    if (qty === curHold) batch.push(db.prepare("DELETE FROM company_positions WHERE id=?").bind(pos.id));
                    else batch.push(db.prepare("UPDATE company_positions SET amount=amount-? WHERE id=?").bind(qty, pos.id));
                    logMsg = `卖出 ${qty} 股 ${symbol}`;
                }
            }
            else if (action === 'cover') {
                if (curHold >= 0) return Response.json({ error: '无空单' });
                if (qty > Math.abs(curHold)) return Response.json({ error: '超出持仓' });
                const prin = (pos.avg_price * qty) / pos.leverage;
                const prof = (pos.avg_price - curP) * qty;
                const ret = Math.floor(prin + prof);
                batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(ret, company.id));
                if (qty === Math.abs(curHold)) batch.push(db.prepare("DELETE FROM company_positions WHERE id=?").bind(pos.id));
                else batch.push(db.prepare("UPDATE company_positions SET amount=amount+? WHERE id=?").bind(qty, pos.id));
                logMsg = `平空 ${qty} 股 ${symbol}`;
            }

            batch.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(symbol, logMsg, 'user', Date.now()));

            await db.batch(batch);
            return Response.json({ success: true, message: 'OK', log: logMsg });
        }
        return Response.json({ error: 'Action error' });
    }
}
