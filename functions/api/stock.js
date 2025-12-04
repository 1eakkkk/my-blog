// --- START OF FILE functions/api/stock.js ---

// === 1. 核心配置 ===
const STOCKS_CONFIG = {
    'BLUE': { 
        name: '蓝盾安全', color: '#00f3ff', 
        share_range: [1500000, 2000000], 
        price_range: [800, 1200] 
    },
    'GOLD': { 
        name: '神经元科技', color: '#ffd700', 
        share_range: [1000000, 1500000], 
        price_range: [2000, 3000] 
    },
    'RED':  { 
        name: '荒坂军工', color: '#ff3333', 
        share_range: [600000, 900000],   
        price_range: [3500, 5000] 
    }
};

// === 2. 风控与交易限制 ===
const TRADE_COOLDOWN = 45 * 1000;     
const SHORT_HOLD_MIN = 60 * 1000;     
const BASE_FEE_RATE = 0.01;           
const MAX_HOLDING_PCT = 0.05;         
const MAX_ORDER_PCT = 0.005;          
const BANKRUPT_PCT = 0.2;             

const MARKET_MODES = {
    0: { name: '平衡市', code: 'NORMAL', depth_mod: 1.0, volatility: 1.0, icon: '🌤️' },
    1: { name: '牛市',   code: 'BULL',   depth_mod: 1.5, volatility: 0.8, icon: '🔥' },
    2: { name: '熊市',   code: 'BEAR',   depth_mod: 0.8, volatility: 1.2, icon: '❄️' },
    3: { name: '低波市', code: 'QUIET',  depth_mod: 0.5, volatility: 0.5, icon: '🌫️' }
};

const COMPANY_LEVELS = {
    0: { name: "皮包公司", margin_rate: 1.0, cost: 0 },
    1: { name: "量化工作室", margin_rate: 0.95, cost: 5000 },
    2: { name: "高频交易中心", margin_rate: 0.90, cost: 15000 },
    3: { name: "金融巨鳄", margin_rate: 0.85, cost: 50000 }
};

const NEWS_DB = {
    'BLUE': [
        { weight: 20, factor: 1.1, msg: "季度财报显示现金流稳健。" },
        { weight: 20, factor: 0.9, msg: "服务器维护成本略高于预期。" },
        { weight: 10, factor: 1.3, msg: "获得政府防火墙二期工程订单。" },
        { weight: 10, factor: 0.7, msg: "部分用户投诉误报率上升。" },
        { weight: 5, factor: 1.6, msg: "发布量子加密算法，黑客渗透率归零。" },
        { weight: 5, factor: 0.4, msg: "核心数据库遭受 DDoS 攻击，服务中断！" },
        { weight: 1, factor: 2.0, msg: "【重磅】市政厅宣布其为唯一安全供应商！" },
        { weight: 1, factor: 0.1, msg: "【突发】0-day 漏洞数据泄露，面临巨额索赔！" }
    ],
    'GOLD': [
        { weight: 20, factor: 1.1, msg: "义体原材料成本下降。" },
        { weight: 20, factor: 0.9, msg: "医保法案推迟，影响报销。" },
        { weight: 10, factor: 1.4, msg: "新款义体‘赫尔墨斯’销量增长。" },
        { weight: 10, factor: 0.6, msg: "数千名用户投诉芯片过热。" },
        { weight: 5, factor: 1.7, msg: "排异反应抑制剂通过临床三期！" },
        { weight: 5, factor: 0.3, msg: "被曝在贫民窟进行非法实验。" },
        { weight: 1, factor: 2.5, msg: "【神迹】宣布实现完美意识上传！" },
        { weight: 1, factor: 0.05, msg: "【灾难】核心 AI 产生自我意识并反叛！" }
    ],
    'RED': [
        { weight: 20, factor: 1.1, msg: "边境摩擦带来少量订单。" },
        { weight: 20, factor: 0.9, msg: "一批常规弹药运输延误。" },
        { weight: 10, factor: 1.4, msg: "成功镇压局部暴乱。" },
        { weight: 10, factor: 0.6, msg: "反战组织举行大规模抗议。" },
        { weight: 5, factor: 1.8, msg: "发布‘半人马’机甲，威慑力拉满。" },
        { weight: 5, factor: 0.2, msg: "国际法庭冻结其海外资产。" },
        { weight: 1, factor: 3.0, msg: "【战争】第四次企业战争爆发！订单激增！" },
        { weight: 1, factor: 0.05, msg: "【覆灭】内部爆发夺权内战，业务瘫痪！" }
    ]
};

function randRange(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function getBJTime(ts) { return new Date(ts + (8 * 60 * 60 * 1000)); }
function getBJHour(ts) { return getBJTime(ts).getUTCHours(); }

function calculatePositionValue(pos, currentPrice) {
    const qty = pos.amount;
    const avg = pos.avg_price;
    const lev = pos.leverage || 1;
    const principal = (avg * Math.abs(qty)) / lev;
    let profit = 0;
    if (qty > 0) profit = (currentPrice - avg) * qty;
    else profit = (avg - currentPrice) * Math.abs(qty);
    return Math.floor(principal + profit);
}

function getMarketMode(symbol, now) {
    const dateStr = new Date(now + 8*3600*1000).toISOString().split('T')[0];
    let hash = 0;
    const seed = dateStr + symbol;
    for (let i = 0; i < seed.length; i++) { hash = seed.charCodeAt(i) + ((hash << 5) - hash); }
    const modeIndex = Math.abs(hash) % 4;
    return MARKET_MODES[modeIndex];
}

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

async function ensureSchema(db) {
    try { await db.prepare("SELECT total_shares FROM market_state LIMIT 1").first(); } 
    catch (e) { 
        try { 
            await db.batch([
                db.prepare("ALTER TABLE market_state ADD COLUMN accumulated_pressure INTEGER DEFAULT 0"),
                db.prepare("ALTER TABLE market_state ADD COLUMN last_news_time INTEGER DEFAULT 0"),
                db.prepare("ALTER TABLE market_state ADD COLUMN total_shares INTEGER DEFAULT 1000000"),
                db.prepare("ALTER TABLE market_state ADD COLUMN issuance_price INTEGER DEFAULT 1000")
            ]); 
        } catch (err) {} 
    }
    try { await db.prepare("SELECT id FROM market_logs LIMIT 1").first(); } 
    catch (e) { try { await db.prepare(`CREATE TABLE IF NOT EXISTS market_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, msg TEXT, type TEXT, created_at INTEGER)`).run(); } catch(err) {} }
    try { await db.prepare("SELECT strategy FROM user_companies LIMIT 1").first(); } 
    catch (e) { try { await db.prepare("ALTER TABLE user_companies ADD COLUMN strategy TEXT DEFAULT '{\"risk\":\"normal\",\"level\":0}'").run(); } catch(err) {} }
    try { await db.prepare("SELECT last_trade_time FROM company_positions LIMIT 1").first(); }
    catch (e) { try { await db.prepare("ALTER TABLE company_positions ADD COLUMN last_trade_time INTEGER DEFAULT 0").run(); } catch(err) {} }
}

async function getOrUpdateMarket(env, db) {
    const now = Date.now();
    const CACHE_KEY = "market_v9_stable"; 
    let cachedData = null;
    if (env.KV) { try { cachedData = await env.KV.get(CACHE_KEY, { type: "json" }); } catch (e) {} }
    if (cachedData && (now - cachedData.timestamp < 10000)) return cachedData.payload;

    const bjHour = getBJHour(now);
    const isMarketClosed = (bjHour >= 2 && bjHour < 6);

    let states = await db.prepare("SELECT * FROM market_state").all();
    let marketMap = {};
    let updates = [];
    let logsToWrite = []; 

    if (states.results.length === 0) {
        const batch = [];
        for (let sym in STOCKS_CONFIG) {
            const conf = STOCKS_CONFIG[sym];
            const shares = randRange(conf.share_range[0], conf.share_range[1]);
            const price = randRange(conf.price_range[0], conf.price_range[1]);
            batch.push(db.prepare("INSERT INTO market_state (symbol, current_price, initial_base, last_update, is_suspended, open_price, last_news_time, accumulated_pressure, total_shares, issuance_price) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?)").bind(sym, price, price, now, price, now, shares, price));
            batch.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, price, now));
            marketMap[sym] = { p: price, base: price, shares, issue_p: price, t: now, open: price, suspended: 0, pressure: 0, mode: getMarketMode(sym, now) };
        }
        await db.batch(batch);
        return { market: marketMap, status: { isOpen: !isMarketClosed } };
    }

    const isNewDay = !isMarketClosed && states.results.some(s => (now - s.last_update) > 3600 * 4000);
    if (isNewDay) {
        let totalDividends = 0;
        for (let s of states.results) {
            const sym = s.symbol;
            if (s.is_suspended === 1) { 
                const conf = STOCKS_CONFIG[sym];
                const newShares = randRange(conf.share_range[0], conf.share_range[1]);
                const newPrice = randRange(conf.price_range[0], conf.price_range[1]);
                updates.push(db.prepare("UPDATE market_state SET current_price=?, initial_base=?, open_price=?, is_suspended=0, last_update=?, accumulated_pressure=0, total_shares=?, issuance_price=? WHERE symbol=?")
                    .bind(newPrice, newPrice, newPrice, now, newShares, newPrice, sym));
                updates.push(db.prepare("DELETE FROM market_history WHERE symbol = ?").bind(sym));
                logsToWrite.push({sym, msg: `【重组上市】${STOCKS_CONFIG[sym].name} 完成资产重组，重新挂牌。`, type: 'good', t: now});
                continue;
            }
            const holders = await db.prepare(`SELECT uc.user_id, cp.amount FROM company_positions cp JOIN user_companies uc ON cp.company_id = uc.id WHERE cp.stock_symbol = ? AND cp.amount > 0`).bind(sym).all();
            for (const h of holders.results) {
                const dividend = Math.floor(h.amount * s.current_price * 0.003);
                if (dividend > 0) {
                    updates.push(db.prepare("UPDATE users SET k_coins = COALESCE(k_coins, 0) + ? WHERE id = ?").bind(dividend, h.user_id));
                    totalDividends += dividend;
                }
            }
            updates.push(db.prepare("UPDATE market_state SET open_price=?, last_update=?, accumulated_pressure=0 WHERE symbol=?").bind(s.current_price, now, sym));
        }
        if (totalDividends > 0) updates.push(db.prepare("INSERT INTO notifications (user_id, type, message, is_read, created_at, link) VALUES (?, 'system', ?, 0, ?, '#business')").bind(0, `【每日分红】市场发放共计 ${totalDividends} k币。`, now));
    }

    if (isMarketClosed) {
        if (updates.length > 0) await db.batch(updates);
        return { market: {}, status: { isOpen: false } };
    }

    for (let s of states.results) {
        const sym = s.symbol;
        const mode = getMarketMode(sym, now);
        const totalShares = s.total_shares || 1000000;
        const issuePrice = s.issuance_price || s.initial_base;
        
        marketMap[sym] = { 
            p: s.current_price, base: s.initial_base, t: s.last_update, 
            open: s.open_price, suspended: s.is_suspended, 
            last_news: s.last_news_time || 0,
            pressure: s.accumulated_pressure || 0,
            shares: totalShares, issue_p: issuePrice,
            mode: mode 
        };

        if (s.is_suspended === 1) continue;

        let missed = Math.floor((now - s.last_update) / 60000);
        if (missed <= 0) continue;
        if (missed > 30) { s.last_update = now - 1800000; missed = 30; }

        let curP = s.current_price;
        let simT = s.last_update;
        let nextNewsT = s.last_news_time || 0;
        let currentPressure = s.accumulated_pressure || 0;

        for (let i = 0; i < missed; i++) {
            simT += 60000;
            const isCatchUp = (i < missed - 1); 

            let buyDepth = totalShares * 0.01 * mode.depth_mod;
            let sellDepth = totalShares * 0.01 * mode.depth_mod;
            let newsMsg = null;

            if (!isCatchUp && (simT - nextNewsT >= 300000)) {
                if (Math.random() < 0.15) { 
                    nextNewsT = simT;
                    const news = pickWeightedNews(sym);
                    if (news) {
                        newsMsg = news;
                        if (news.factor > 1) { 
                            buyDepth *= news.factor; 
                            sellDepth *= (1 / news.factor);
                        } else { 
                            sellDepth *= (1 / news.factor); 
                            buyDepth *= news.factor;
                        }
                    }
                }
            }

            if (i === 0) {
                if (currentPressure > 0) buyDepth += currentPressure;
                else sellDepth += Math.abs(currentPressure);
            }

            const delta = (buyDepth - sellDepth) / totalShares * 2.0; 
            const clampedDelta = Math.max(-0.1, Math.min(0.1, delta));
            const noise = (Math.random() - 0.5) * 0.004;

            curP = Math.max(1, Math.round(curP * (1 + clampedDelta + noise)));

            if (newsMsg) {
                logsToWrite.push({sym, msg: `[${STOCKS_CONFIG[sym].name}] ${newsMsg.msg}`, type: newsMsg.factor > 1 ? 'good' : 'bad', t: simT});
            }

            if (curP < issuePrice * BANKRUPT_PCT) {
                const refundRate = 0.3; 
                updates.push(db.prepare(`UPDATE user_companies SET capital = capital + (SELECT IFNULL(SUM(amount * avg_price * ?), 0) FROM company_positions WHERE company_positions.company_id = user_companies.id AND company_positions.stock_symbol = ?) WHERE id IN (SELECT company_id FROM company_positions WHERE stock_symbol = ?)`).bind(refundRate, sym, sym));
                updates.push(db.prepare("DELETE FROM company_positions WHERE stock_symbol = ?").bind(sym));
                
                updates.push(db.prepare("UPDATE market_state SET current_price=?, is_suspended=1, last_update=? WHERE symbol=?").bind(curP, simT, sym));
                updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, curP, simT));
                
                logsToWrite.push({sym, msg: `【破产清算】股价击穿红线，强制退市。所有持仓按 30% 退回。`, type: 'bad', t: simT});
                
                marketMap[sym].suspended = 1; marketMap[sym].p = curP;
                break;
            }

            updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, curP, simT));
        }

        if (marketMap[sym].suspended !== 1) {
            updates.push(db.prepare("UPDATE market_state SET current_price=?, last_update=?, last_news_time=?, accumulated_pressure=0 WHERE symbol=?").bind(curP, simT, nextNewsT, sym));
            marketMap[sym].p = curP; marketMap[sym].t = simT; marketMap[sym].pressure = 0;
        }
    }

    logsToWrite.forEach(l => updates.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(l.sym, l.msg, l.type, l.t)));
    if (Math.random() < 0.05) updates.push(db.prepare("DELETE FROM market_logs WHERE created_at < ?").bind(now - 3600000));
    if (updates.length > 0) await db.batch(updates);

    const result = { market: marketMap, status: { isOpen: true } };
    if (env.KV) await env.KV.put(CACHE_KEY, JSON.stringify({ timestamp: now, payload: result }), { expirationTtl: 60 });
    return result;
}

export async function onRequest(context) {
    try {
        const { request, env } = context;
        const db = env.DB;
        await ensureSchema(db);

        const cookie = request.headers.get('Cookie');
        if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
        const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
        
        let user = null;
        try {
            user = await db.prepare('SELECT users.id, users.coins, users.k_coins, users.xp, users.username, users.nickname, users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
        } catch (e) {
            user = await db.prepare('SELECT users.id, users.coins, users.k_coins, users.xp, users.username, users.nickname FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
            if (user) user.role = 'user';
        }
        if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

        const company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();
        const method = request.method;
        const { market, status } = await getOrUpdateMarket(env, db);

        let companyData = null;
        let companyLevel = 0;
        if (company) {
            try {
                const stratObj = JSON.parse(company.strategy || "{}");
                companyData = stratObj;
                companyLevel = stratObj.level || 0;
            } catch(e) { companyData = { risk: company.strategy, level: 0 }; }
        }

        if (method === 'GET') {
            const hasCompany = !!company;
            let positions = [];
            if (hasCompany) {
                positions = (await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all()).results;
                let totalEquity = company.capital; 
                positions.forEach(pos => {
                    const currentP = market[pos.stock_symbol] ? market[pos.stock_symbol].p : 0;
                    totalEquity += calculatePositionValue(pos, currentP);
                });
                const bankruptLine = 0;
                if (totalEquity <= bankruptLine) {
                    await db.batch([db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id), db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id)]);
                    return Response.json({ success: true, hasCompany: false, bankrupt: true, report: { msg: `公司净值归零，宣告破产。` } });
                }
            }

            const chartData = {}; const stockMeta = {};
            const historyResults = await db.prepare("SELECT symbol, price as p, created_at as t FROM market_history WHERE created_at > ? ORDER BY created_at ASC").bind(Date.now() - 7200000).all();
            for (let sym in STOCKS_CONFIG) {
                chartData[sym] = historyResults.results.filter(r => r.symbol === sym);
                if (chartData[sym].length === 0 && market[sym]) chartData[sym] = [{ t: market[sym].t, p: market[sym].p }];
                stockMeta[sym] = { 
                    open: market[sym] ? market[sym].open : 0, 
                    suspended: market[sym] ? market[sym].suspended : 0,
                    mode: market[sym] ? market[sym].mode : MARKET_MODES[0],
                    pressure: market[sym] ? market[sym].pressure : 0,
                    shares: market[sym] ? market[sym].shares : 1000000,
                    issue_p: market[sym] ? market[sym].issue_p : 1000
                };
            }
            const logsRes = await db.prepare("SELECT * FROM market_logs WHERE created_at < ? ORDER BY created_at DESC LIMIT 20").bind(Date.now()).all();
            const logs = logsRes.results.map(l => ({ time: l.created_at, msg: l.msg, type: l.type }));

            return Response.json({ success: true, hasCompany, bankrupt: false, market: chartData, meta: stockMeta, news: logs, positions, capital: hasCompany ? company.capital : 0, companyType: hasCompany ? company.type : 'none', companyLevel: companyLevel, userK: user.k_coins || 0, userExp: user.xp || 0, status });
        }

        if (method === 'POST') {
            const body = await request.json();
            const { action, symbol, amount, leverage = 1 } = body;
            const userNameDisplay = user.nickname || user.username;

            // === 1. 优先处理不需要公司存在的操作 ===
            
            // 管理员重置
            if (action === 'admin_reset') {
                if (user.role !== 'admin') return Response.json({ error: '权限不足' }, { status: 403 });
                const now = Date.now();
                const suspendedStocks = await db.prepare("SELECT * FROM market_state WHERE is_suspended = 1").all();
                if (suspendedStocks.results.length === 0) return Response.json({ success: false, error: '无停牌股票' });
                const batch = [];
                for (const s of suspendedStocks.results) {
                    const sym = s.symbol;
                    const conf = STOCKS_CONFIG[sym];
                    const newShares = randRange(conf.share_range[0], conf.share_range[1]);
                    const newPrice = randRange(conf.price_range[0], conf.price_range[1]);
                    
                    batch.push(db.prepare("UPDATE market_state SET current_price=?, initial_base=?, open_price=?, is_suspended=0, last_update=?, accumulated_pressure=0, total_shares=?, issuance_price=? WHERE symbol=?")
                        .bind(newPrice, newPrice, newPrice, now, newShares, newPrice, sym));
                    batch.push(db.prepare("DELETE FROM market_history WHERE symbol = ?").bind(sym));
                    batch.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, newPrice, now));
                    batch.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(sym, `【管理员】${conf.name} 强制重组上市。`, 'good', now));
                }
                if (env.KV) await env.KV.delete("market_v9_stable");
                await db.batch(batch);
                return Response.json({ success: true, message: '重组完成' });
            }

            // 货币兑换 (i -> k, exp -> k)
            if (action === 'convert') {
                 const { type, val } = body; const num = parseInt(val);
                 if (type === 'i_to_k') {
                     if (user.coins < num) return Response.json({ error: '余额不足' });
                     await db.batch([db.prepare("UPDATE users SET coins = coins - ?, k_coins = k_coins + ? WHERE id = ?").bind(num, num, user.id)]);
                 } else {
                     if (user.xp < num * 4) return Response.json({ error: '经验不足' });
                     await db.batch([db.prepare("UPDATE users SET xp = xp - ?, k_coins = k_coins + ? WHERE id = ?").bind(num * 4, num, user.id)]);
                 }
                 return Response.json({ success: true, message: '兑换成功' });
            }

            // 创建公司
            if (action === 'create') {
                if (company) return Response.json({ error: '已有公司' });
                if ((user.k_coins || 0) < 3000) return Response.json({ error: 'k币不足' });
                const initStrat = JSON.stringify({ risk: 'normal', level: 0 });
                await db.batch([
                    db.prepare("UPDATE users SET k_coins = k_coins - ? WHERE id = ?").bind(3000, user.id),
                    db.prepare("INSERT INTO user_companies (user_id, name, type, capital, strategy) VALUES (?, ?, ?, ?, ?)").bind(user.id, body.name, body.type, 3000, initStrat)
                ]);
                return Response.json({ success: true, message: '注册成功' });
            }

            // === 2. 之后的操作必须有公司 ===
            if (!company) return Response.json({ error: '无公司' });

            if (action === 'upgrade_company') {
                const nextLv = companyLevel + 1;
                const conf = COMPANY_LEVELS[nextLv];
                if (!conf) return Response.json({ error: '已达到最高等级' });
                if ((user.k_coins || 0) < conf.cost) return Response.json({ error: `K币不足 (需 ${conf.cost} k)` });
                const newStrat = { ...companyData, level: nextLv };
                await db.batch([
                    db.prepare("UPDATE users SET k_coins = k_coins - ? WHERE id = ?").bind(conf.cost, user.id),
                    db.prepare("UPDATE user_companies SET strategy = ? WHERE id = ?").bind(JSON.stringify(newStrat), company.id)
                ]);
                return Response.json({ success: true, message: `公司升级成功！当前等级: ${conf.name}` });
            }

            if (action === 'invest') {
                const num = parseInt(amount);
                if (num < 100) return Response.json({ error: '最少100' });
                const kBal = user.k_coins || 0;
                const iBal = user.coins || 0;
                let dK = kBal >= num ? num : kBal;
                let dI = num - dK;
                if (iBal < dI) return Response.json({ error: '资金不足' });
                await db.batch([
                    db.prepare("UPDATE users SET k_coins = k_coins - ? WHERE id=?").bind(dK, user.id),
                    db.prepare("UPDATE users SET coins = coins - ? WHERE id=?").bind(dI, user.id),
                    db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id=?").bind(num, company.id)
                ]);
                return Response.json({ success: true, message: '注资成功' });
            }

            if (['buy', 'sell', 'cover'].includes(action)) {
                if (!status.isOpen) return Response.json({ error: '休市' });
                if (market[symbol].suspended === 1) return Response.json({ error: '停牌' });
                
                const qty = parseInt(amount);
                const lev = parseInt(leverage);
                if (isNaN(qty) || qty <= 0) return Response.json({ error: '数量无效' });

                const curP = market[symbol].p;
                const totalShares = market[symbol].shares;
                const pos = await db.prepare("SELECT * FROM company_positions WHERE company_id = ? AND stock_symbol = ?").bind(company.id, symbol).first();
                
                const lastTrade = pos ? (pos.last_trade_time || 0) : 0;
                const now = Date.now();
                if (now - lastTrade < TRADE_COOLDOWN) {
                    const left = Math.ceil((TRADE_COOLDOWN - (now - lastTrade)) / 1000);
                    return Response.json({ error: `操作频繁，请等待 ${left} 秒` });
                }

                if (action === 'cover') {
                    if (now - lastTrade < SHORT_HOLD_MIN) return Response.json({ error: '做空需锁仓 1 分钟' });
                }

                const currentHold = pos ? Math.abs(pos.amount) : 0;
                if (action !== 'cover' && action !== 'sell' && (currentHold + qty) > (totalShares * MAX_HOLDING_PCT)) {
                    return Response.json({ error: `持仓超限！最多持有 ${Math.floor(totalShares * MAX_HOLDING_PCT)} 股` });
                }

                if (qty > totalShares * MAX_ORDER_PCT) {
                    return Response.json({ error: `单笔过大！限额 ${Math.floor(totalShares * MAX_ORDER_PCT)} 股` });
                }

                if (action === 'sell' && (!pos || pos.amount <= 0)) {
                    const issuePrice = market[symbol].issue_p;
                    if (curP < issuePrice * 0.3) return Response.json({ error: '股价过低，禁止做空' });
                }

                const currentLvConf = COMPANY_LEVELS[companyLevel] || COMPANY_LEVELS[0];
                const marginRate = currentLvConf.margin_rate; 
                const curHold = pos ? pos.amount : 0;
                const batch = [];
                let logMsg = "";

                const slippage = (qty / totalShares) * 5; 
                const feeRate = BASE_FEE_RATE + slippage;
                const orderVal = curP * qty;
                const fee = Math.floor(orderVal * feeRate);

                if (action === 'buy') {
                    const margin = Math.floor((curP * qty) / lev * marginRate);
                    const totalCost = margin + fee;
                    if (company.capital < totalCost) return Response.json({ error: `资金不足 (需 ${totalCost} i)` });
                    if (pos && curHold < 0) return Response.json({ error: '请先平空' });
                    
                    batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(totalCost, company.id));
                    if (pos) {
                        const totalVal = (curHold * pos.avg_price) + (qty * curP);
                        const newQty = curHold + qty;
                        const newAvg = totalVal / newQty;
                        batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=?, last_trade_time=? WHERE id=?").bind(newQty, newAvg, lev, now, pos.id));
                    } else {
                        batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage, last_trade_time) VALUES (?, ?, ?, ?, ?, ?)").bind(company.id, symbol, qty, curP, lev, now));
                    }
                    logMsg = `[${userNameDisplay}] 买入 ${qty} 股 ${symbol}`;
                    batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure + ? WHERE symbol = ?").bind(qty, symbol));
                }
                else if (action === 'sell') {
                    if (curHold <= 0) { // 开空
                        const margin = Math.floor((curP * qty) / lev * marginRate);
                        const totalCost = margin + fee;
                        if (company.capital < totalCost) return Response.json({ error: `资金不足 (需 ${totalCost} i)` });
                        
                        batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(totalCost, company.id));
                        if (pos) {
                            const totalVal = (Math.abs(curHold) * pos.avg_price) + (qty * curP);
                            const newQty = Math.abs(curHold) + qty;
                            const newAvg = totalVal / newQty;
                            batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=?, last_trade_time=? WHERE id=?").bind(-newQty, newAvg, lev, now, pos.id));
                        } else {
                            batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage, last_trade_time) VALUES (?, ?, ?, ?, ?, ?)").bind(company.id, symbol, -qty, curP, lev, now));
                        }
                        logMsg = `[${userNameDisplay}] 做空 ${qty} 股 ${symbol}`;
                        batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure - ? WHERE symbol = ?").bind(qty, symbol));
                    } else { // 平多
                        if (qty > curHold) return Response.json({ error: '持仓不足' });
                        const prin = (pos.avg_price * qty) / pos.leverage * marginRate;
                        const prof = (curP - pos.avg_price) * qty;
                        const ret = Math.floor(prin + prof - fee);
                        batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(ret, company.id));
                        if (qty === curHold) batch.push(db.prepare("DELETE FROM company_positions WHERE id=?").bind(pos.id));
                        else batch.push(db.prepare("UPDATE company_positions SET amount=amount-?, last_trade_time=? WHERE id=?").bind(qty, now, pos.id));
                        logMsg = `[${userNameDisplay}] 卖出 ${qty} 股 ${symbol}`;
                        batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure - ? WHERE symbol = ?").bind(qty, symbol));
                    }
                }
                else if (action === 'cover') { // 平空
                    if (curHold >= 0) return Response.json({ error: '无空单' });
                    if (qty > Math.abs(curHold)) return Response.json({ error: '超出持仓' });
                    const prin = (pos.avg_price * qty) / pos.leverage * marginRate;
                    const prof = (pos.avg_price - curP) * qty; 
                    const ret = Math.floor(prin + prof - fee);
                    batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(ret, company.id));
                    if (qty === Math.abs(curHold)) batch.push(db.prepare("DELETE FROM company_positions WHERE id=?").bind(pos.id));
                    else batch.push(db.prepare("UPDATE company_positions SET amount=amount+?, last_trade_time=? WHERE id=?").bind(qty, now, pos.id));
                    logMsg = `[${userNameDisplay}] 平空 ${qty} 股 ${symbol}`;
                    batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure + ? WHERE symbol = ?").bind(qty, symbol));
                }

                batch.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(symbol, logMsg, 'user', Date.now()));
                await db.batch(batch);
                if (env.KV) await env.KV.delete("market_v9_stable");
                return Response.json({ success: true, message: `交易成功 (滑点费率 ${(feeRate*100).toFixed(2)}%)`, log: logMsg });
            }
            
            if (action === 'withdraw') {
                const num = parseInt(amount);
                if (company.capital < num) return Response.json({ error: '公司资金不足' });
                const tax = Math.floor(num * 0.05); 
                const actual = num - tax;
                await db.batch([
                    db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(num, company.id),
                    db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(actual, user.id)
                ]);
                return Response.json({ success: true, message: `提现成功 (税 ${tax} i, 实得 ${actual} i)` });
            }

            return Response.json({ error: 'Invalid' });
        }
    } catch (err) {
        return Response.json({ success: false, error: "SYSTEM ERROR: " + err.message, stack: err.stack }, { status: 200 }); 
    }
}
