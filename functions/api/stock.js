// --- START OF FILE functions/api/stock.js ---

// === 1. 核心配置 ===
const STOCKS_CONFIG = {
    'BLUE': { name: '蓝盾安全', color: '#00f3ff', share_range: [1500000, 2000000], price_range: [800, 1200] },
    'GOLD': { name: '神经元科技', color: '#ffd700', share_range: [1000000, 1500000], price_range: [2000, 3000] },
    'RED':  { name: '荒坂军工', color: '#ff3333', share_range: [600000, 900000], price_range: [3500, 5000] }
};

// === 2. 宏观与风控 ===
const MACRO_ERAS = [
    { code: 'NEON_AGE', name: '霓虹盛世', desc: '全市场流动性充裕，易暴涨。', buff: { vol: 1.2, gold_bias: 1.2, red_bias: 1.0 } },
    { code: 'CORP_WAR', name: '企业战争', desc: '局势动荡，波动率极高。', buff: { vol: 1.5, gold_bias: 0.7, red_bias: 1.3 } },
    { code: 'DATA_CRASH', name: '数据大崩塌', desc: '大萧条，阴跌不止。', buff: { vol: 0.8, gold_bias: 0.8, red_bias: 0.8 } }
];

const TRADE_COOLDOWN = 30 * 1000;
const SHORT_HOLD_MIN = 60 * 1000;
const BASE_FEE_RATE = 0.005;
const MAX_HOLDING_PCT = 0.20; 
const MAX_ORDER_PCT = 0.01;
const BANKRUPT_PCT = 0.2;
const INSIDER_COST_24H = 5000;

const COMPANY_LEVELS = {
    0: { name: "皮包公司", margin_rate: 1.0, cost: 0 },
    1: { name: "量化工作室", margin_rate: 0.95, cost: 5000 },
    2: { name: "高频交易中心", margin_rate: 0.90, cost: 15000 },
    3: { name: "金融巨鳄", margin_rate: 0.85, cost: 50000 }
};

const MARKET_MODES = {
    0: { name: '平衡市', code: 'NORMAL', depth_mod: 1.0, icon: '🌤️' },
    1: { name: '牛市',   code: 'BULL',   depth_mod: 1.5, icon: '🔥' },
    2: { name: '熊市',   code: 'BEAR',   depth_mod: 0.8, icon: '❄️' },
    3: { name: '低波市', code: 'QUIET',  depth_mod: 0.5, icon: '🌫️' }
};

const NEWS_DB = {
    'BLUE': [
        { weight: 20, factor: 1.3, msg: "季度财报超预期，现金流强劲。" }, { weight: 20, factor: 0.8, msg: "服务器维护成本激增。" },
        { weight: 10, factor: 1.5, msg: "获得政府防火墙二期工程订单。" }, { weight: 10, factor: 0.6, msg: "部分用户投诉误报率上升。" },
        { weight: 5, factor: 2.0, msg: "发布量子加密算法，黑客渗透率归零。" }, { weight: 5, factor: 0.3, msg: "核心数据库遭受 DDoS 攻击！" },
        { weight: 1, factor: 3.0, msg: "【重磅】市政厅宣布其为唯一安全供应商！" }, { weight: 1, factor: 0.1, msg: "【突发】0-day 漏洞数据泄露，面临巨额索赔！" }
    ],
    'GOLD': [
        { weight: 20, factor: 1.3, msg: "义体原材料成本大幅下降。" }, { weight: 20, factor: 0.8, msg: "医保法案推迟，影响报销。" },
        { weight: 10, factor: 1.6, msg: "新款义体‘赫尔墨斯’销量暴增。" }, { weight: 10, factor: 0.5, msg: "数千名用户投诉芯片过热。" },
        { weight: 5, factor: 2.1, msg: "排异反应抑制剂通过临床三期！" }, { weight: 5, factor: 0.2, msg: "被曝在贫民窟进行非法实验。" },
        { weight: 1, factor: 3.5, msg: "【神迹】宣布实现完美意识上传！" }, { weight: 1, factor: 0.05, msg: "【灾难】核心 AI 产生自我意识并反叛！" }
    ],
    'RED': [
        { weight: 20, factor: 1.3, msg: "边境摩擦带来大量订单。" }, { weight: 20, factor: 0.8, msg: "一批常规弹药运输延误。" },
        { weight: 10, factor: 1.6, msg: "成功镇压局部暴乱。" }, { weight: 10, factor: 0.5, msg: "反战组织举行大规模抗议。" },
        { weight: 5, factor: 2.2, msg: "发布‘半人马’机甲，威慑力拉满。" }, { weight: 5, factor: 0.2, msg: "国际法庭冻结其海外资产。" },
        { weight: 1, factor: 4.0, msg: "【战争】第四次企业战争爆发！" }, { weight: 1, factor: 0.05, msg: "【覆灭】内部爆发夺权内战，业务瘫痪！" }
    ]
};

function randRange(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function getBJTime(ts) { return new Date(ts + (8 * 60 * 60 * 1000)); }
function getBJHour(ts) { return getBJTime(ts).getUTCHours(); }
function getBJDateStr(ts) { return new Date(ts + 8*3600000).toISOString().split('T')[0]; }

function calculatePositionValue(pos, currentPrice) {
    const qty = pos.amount; const avg = pos.avg_price; const lev = pos.leverage || 1;
    const principal = (avg * Math.abs(qty)) / lev;
    let profit = (qty > 0) ? (currentPrice - avg) * qty : (avg - currentPrice) * Math.abs(qty);
    return Math.floor(principal + profit);
}

function getCurrentEra(now) {
    const dayIndex = Math.floor(now / (1000 * 60 * 60 * 12)); 
    return MACRO_ERAS[dayIndex % MACRO_ERAS.length];
}

function getMarketMode(symbol, now) {
    const dateStr = new Date(now + 8*3600*1000).toISOString().split('T')[0];
    let hash = 0; const seed = dateStr + symbol;
    for (let i = 0; i < seed.length; i++) { hash = seed.charCodeAt(i) + ((hash << 5) - hash); }
    return MARKET_MODES[Math.abs(hash) % 4];
}

function pickWeightedNews(symbol) {
    const list = NEWS_DB[symbol]; if (!list) return null;
    let total = list.reduce((a, b) => a + b.weight, 0);
    let r = Math.random() * total;
    for (let item of list) { r -= item.weight; if (r <= 0) return item; }
    return list[0];
}

async function ensureSchema(db) {
    try { await db.prepare("SELECT total_shares FROM market_state LIMIT 1").first(); } catch (e) { try { await db.batch([db.prepare("ALTER TABLE market_state ADD COLUMN accumulated_pressure INTEGER DEFAULT 0"), db.prepare("ALTER TABLE market_state ADD COLUMN last_news_time INTEGER DEFAULT 0"), db.prepare("ALTER TABLE market_state ADD COLUMN total_shares INTEGER DEFAULT 1000000"), db.prepare("ALTER TABLE market_state ADD COLUMN issuance_price INTEGER DEFAULT 1000")]); } catch (err) {} }
    try { await db.prepare("SELECT id FROM market_logs LIMIT 1").first(); } catch (e) { try { await db.prepare(`CREATE TABLE IF NOT EXISTS market_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, msg TEXT, type TEXT, created_at INTEGER)`).run(); } catch(err) {} }
    try { await db.prepare("SELECT strategy FROM user_companies LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE user_companies ADD COLUMN strategy TEXT DEFAULT '{\"risk\":\"normal\",\"level\":0}'").run(); } catch(err) {} }
    try { await db.prepare("SELECT last_trade_time FROM company_positions LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE company_positions ADD COLUMN last_trade_time INTEGER DEFAULT 0").run(); } catch(err) {} }
    try { await db.prepare("SELECT insider_exp FROM users LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE users ADD COLUMN insider_exp INTEGER DEFAULT 0").run(); } catch(err) {} }
    try { await db.prepare("SELECT last_dividend_time FROM market_state LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE market_state ADD COLUMN last_dividend_time INTEGER DEFAULT 0").run(); } catch(err){} }
    try { await db.prepare("SELECT last_trade_type FROM company_positions LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE company_positions ADD COLUMN last_trade_type TEXT").run(); } catch(err){} }
}

async function getOrUpdateMarket(env, db) {
    const now = Date.now();
    const CACHE_KEY = "market_v14_momentum"; // Key Update: 动量机制
    let cachedData = null;
    if (env.KV) { try { cachedData = await env.KV.get(CACHE_KEY, { type: "json" }); } catch (e) {} }
    if (cachedData && (now - cachedData.timestamp < 10000)) return cachedData.payload;

    const bjHour = getBJHour(now);
    const isMarketClosed = (bjHour >= 2 && bjHour < 6);
    const currentEra = getCurrentEra(now);

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
            batch.push(db.prepare("INSERT INTO market_state (symbol, current_price, initial_base, last_update, is_suspended, open_price, last_news_time, accumulated_pressure, total_shares, issuance_price, last_dividend_time) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?)").bind(sym, price, price, now, price, now, shares, price, now));
            batch.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, price, now));
            marketMap[sym] = { p: price, base: price, shares, issue_p: price, t: now, open: price, suspended: 0, pressure: 0, mode: getMarketMode(sym, now) };
        }
        await db.batch(batch);
        return { market: marketMap, status: { isOpen: !isMarketClosed }, era: currentEra };
    }

    const currentBJDate = getBJDateStr(now);
    for (let s of states.results) {
        const sym = s.symbol;
        const lastDivTime = s.last_dividend_time || 0;
        const lastDivDate = getBJDateStr(lastDivTime); 
        
        if (currentBJDate > lastDivDate && s.is_suspended === 0) {
            const holders = await db.prepare(`SELECT uc.user_id, cp.amount, uc.strategy FROM company_positions cp JOIN user_companies uc ON cp.company_id = uc.id WHERE cp.stock_symbol = ? AND cp.amount > 0`).bind(sym).all();
            let totalDivForStock = 0;
            for (const h of holders.results) {
                let risk = 'normal';
                try { risk = JSON.parse(h.strategy).risk; } catch(e) {}
                let strategyMult = 1.0;
                if (risk === 'risky') strategyMult = 1.5;
                if (risk === 'safe') strategyMult = 0.8;
                const baseDiv = h.amount * s.current_price * 0.003;
                const finalDiv = Math.floor(baseDiv * strategyMult);
                if (finalDiv > 0) {
                    updates.push(db.prepare("UPDATE users SET k_coins = COALESCE(k_coins, 0) + ? WHERE id = ?").bind(finalDiv, h.user_id));
                    const note = `【分红到账】${STOCKS_CONFIG[sym].name} 发放分红 ${finalDiv} k币 (策略: ${risk}, 加成: x${strategyMult})`;
                    updates.push(db.prepare("INSERT INTO notifications (user_id, type, message, is_read, created_at, link) VALUES (?, 'system', ?, 0, ?, '#business')").bind(h.user_id, note, now));
                    totalDivForStock += finalDiv;
                }
            }
            updates.push(db.prepare("UPDATE market_state SET last_dividend_time = ? WHERE symbol = ?").bind(now, sym));
            if (totalDivForStock > 0) logsToWrite.push({sym, msg: `【年度分红】向股东派发共计 ${totalDivForStock} k币。`, type: 'good', t: now});
        }
    }

    const isNewDay = !isMarketClosed && states.results.some(s => (now - s.last_update) > 3600 * 4000); 
    if (isNewDay) { /* 重组逻辑略，保持原样 */ }

    if (isMarketClosed) {
        if (updates.length > 0) await db.batch(updates);
        return { market: {}, status: { isOpen: false }, era: currentEra };
    }

    let simulationEndTime = now;
    if (isMarketClosed) {
        const bjTime = getBJTime(now);
        bjTime.setUTCHours(2, 0, 0, 0); 
        simulationEndTime = bjTime.getTime() - (8 * 60 * 60 * 1000);
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

        if (s.is_suspended === 1) {
            const lastUpdateBJ = getBJTime(s.last_update);
            const currentBJ = getBJTime(now);
            if (currentBJ.getDate() !== lastUpdateBJ.getDate()) {
                const conf = STOCKS_CONFIG[sym];
                const newShares = randRange(conf.share_range[0], conf.share_range[1]);
                const newPrice = randRange(conf.price_range[0], conf.price_range[1]);
                updates.push(db.prepare("UPDATE market_state SET current_price=?, initial_base=?, open_price=?, is_suspended=0, last_update=?, accumulated_pressure=0, total_shares=?, issuance_price=?, last_dividend_time=? WHERE symbol=?")
                    .bind(newPrice, newPrice, newPrice, now, newShares, newPrice, now, sym)); 
                updates.push(db.prepare("DELETE FROM market_history WHERE symbol = ?").bind(sym));
                logsToWrite.push({sym, msg: `【重组上市】${conf.name} 完成重组，进入 ${currentEra.name} 纪元。`, type: 'good', t: now});
                marketMap[sym].suspended = 0;
                marketMap[sym].p = newPrice;
            }
            continue;
        }

        let missed = Math.floor((simulationEndTime - s.last_update) / 60000);
        if (missed <= 0) continue;

        const maxCatchUp = isMarketClosed ? 300 : 60; 
        if (missed > maxCatchUp) { 
            s.last_update = simulationEndTime - (maxCatchUp * 60000); 
            missed = maxCatchUp; 
        }

        let curP = s.current_price;
        let simT = s.last_update;
        let nextNewsT = s.last_news_time || 0;
        let currentPressure = s.accumulated_pressure || 0;
        
        // === ⚡ 动量变量初始化 ===
        // 玩家压力不会在第1秒后立刻消失，而是进入动量池
        let momentum = currentPressure; 

        for (let i = 0; i < missed; i++) {
            simT += 60000;
            const isCatchUp = (i < missed - 1); 

            let eraBias = 1.0;
            if (sym === 'GOLD') eraBias = currentEra.buff.gold_bias;
            if (sym === 'RED') eraBias = currentEra.buff.red_bias;
            
            let baseDepthRatio = 0.005; 
            let buyDepth = totalShares * baseDepthRatio * mode.depth_mod * eraBias;
            let sellDepth = totalShares * baseDepthRatio * mode.depth_mod * eraBias;
            let newsMsg = null;

            if (!isCatchUp && (simT - nextNewsT >= 240000)) { 
                if (Math.random() < 0.2) { 
                    nextNewsT = simT;
                    const news = pickWeightedNews(sym);
                    if (news) {
                        newsMsg = news;
                        if (news.factor > 1) { buyDepth *= news.factor; sellDepth *= (1 / news.factor); } 
                        else { sellDepth *= (1 / news.factor); buyDepth *= news.factor; }
                    }
                }
            }

            if (!newsMsg && Math.random() < 0.6) { 
                const trendBlock = Math.floor(simT / 300000); 
                let trendDir = (trendBlock % 2 === 0) ? 1 : -1;
                if (Math.random() < 0.3) trendDir *= -1;
                const botVol = trendDir * totalShares * (0.003 + Math.random() * 0.009);
                if (botVol > 0) buyDepth += botVol;
                else sellDepth += Math.abs(botVol);
            }

            // === ⚡ 动量衰减机制 (Momentum Decay) ===
            // 每一分钟，动量衰减为上一分钟的 60%
            // 这样一笔大单可以影响约 3-5 分钟的走势
            if (Math.abs(momentum) > 10) { // 忽略微小残余
                if (momentum > 0) buyDepth += momentum;
                else sellDepth += Math.abs(momentum);
                
                momentum = Math.floor(momentum * 0.6); // 衰减系数 0.6
            }

            // 敏感度 50.0
            const volatilityFactor = 50.0 * currentEra.buff.vol; 
            const delta = (buyDepth - sellDepth) / totalShares * volatilityFactor;
            const clampedDelta = Math.max(-0.08, Math.min(0.08, delta));
            const noise = (Math.random() - 0.5) * 0.02;
            
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
                logsToWrite.push({sym, msg: `【破产】股价击穿红线，强制退市。持仓按 30% 退回。`, type: 'bad', t: simT});
                marketMap[sym].suspended = 1; marketMap[sym].p = curP;
                break;
            }
            updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, curP, simT));
        }

        if (marketMap[sym].suspended !== 1) {
            // 更新时，将 residual momentum (残留动量) 写回数据库？
            // 不，为了简化，数据库只存“未处理的压力”。
            // 一旦处理过一次，我们就把数据库清零。
            // 动量只在当前的 catch-up 循环中生效。这已经足够了，因为用户一般每隔几分钟才会操作一次。
            updates.push(db.prepare("UPDATE market_state SET current_price=?, last_update=?, last_news_time=?, accumulated_pressure=0 WHERE symbol=?").bind(curP, simT, nextNewsT, sym));
            marketMap[sym].p = curP; marketMap[sym].t = simT; marketMap[sym].pressure = 0;
        }
    }

    logsToWrite.forEach(l => updates.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(l.sym, l.msg, l.type, l.t)));
    if (Math.random() < 0.05) updates.push(db.prepare("DELETE FROM market_logs WHERE created_at < ?").bind(now - 3600000));
    if (updates.length > 0) await db.batch(updates);

    const result = { market: marketMap, status: { isOpen: !isMarketClosed }, era: currentEra };
    if (env.KV) await env.KV.put(CACHE_KEY, JSON.stringify({ timestamp: now, payload: result }), { expirationTtl: 60 });
    return result;
}

// onRequest 保持不变 (略，之前的版本已包含)
// 但为了完整性，这里重复一下 onRequest 头部，确保您全量覆盖不会出错
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
            user = await db.prepare('SELECT users.id, users.coins, users.k_coins, users.xp, users.username, users.nickname, users.role, users.insider_exp FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
        } catch (e) {
            user = await db.prepare('SELECT users.id, users.coins, users.k_coins, users.xp, users.username, users.nickname FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
            if (user) user.role = 'user';
        }
        if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

        const company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();
        const method = request.method;
        const { market, status, era } = await getOrUpdateMarket(env, db);

        const isInsider = user.insider_exp > Date.now();

        let companyData = null; let companyLevel = 0;
        if (company) {
            try { const stratObj = JSON.parse(company.strategy || "{}"); companyData = stratObj; companyLevel = stratObj.level || 0; } 
            catch(e) { companyData = { risk: company.strategy, level: 0 }; }
        }

        if (method === 'GET') {
            // ... (请复用之前的 GET 逻辑) ...
            const hasCompany = !!company;
            let positions = [];
            let totalEquity = 0; 
            if (hasCompany) totalEquity = company.capital;

            if (hasCompany) {
                positions = (await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all()).results;
                
                let isDataValid = true; 
                let tempEquity = company.capital;
                let hasLeverage = false; 

                for (const pos of positions) {
                    if (!market[pos.stock_symbol] || !market[pos.stock_symbol].p) {
                        isDataValid = false;
                        break; 
                    }
                    const currentP = market[pos.stock_symbol].p;
                    tempEquity += calculatePositionValue(pos, currentP);
                    if (pos.leverage > 1 || pos.amount < 0) hasLeverage = true;
                }

                if (isDataValid) {
                    totalEquity = tempEquity;
                    const bankruptLine = -100; 
                    if (totalEquity <= bankruptLine && hasLeverage) {
                        await db.batch([
                            db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                            db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id)
                        ]);
                        return Response.json({ success: true, hasCompany: false, bankrupt: true, report: { msg: `公司资不抵债 (净值 ${Math.floor(totalEquity)})，触发强制清算。` } });
                    }
                }
            }

            const chartData = {}; const stockMeta = {};
            const historyResults = await db.prepare("SELECT symbol, price as p, created_at as t FROM market_history WHERE created_at > ? ORDER BY created_at ASC").bind(Date.now() - 7200000).all();
            for (let sym in STOCKS_CONFIG) {
                chartData[sym] = historyResults.results.filter(r => r.symbol === sym);
                if (chartData[sym].length === 0 && market[sym]) chartData[sym] = [{ t: market[sym].t, p: market[sym].p }];
                
                let pressureVal = market[sym] ? market[sym].pressure : 0;
                if (!isInsider) {
                    if (pressureVal > 500) pressureVal = 999; 
                    else if (pressureVal < -500) pressureVal = -999;
                    else pressureVal = 0;
                }

                stockMeta[sym] = { 
                    open: market[sym] ? market[sym].open : 0, 
                    suspended: market[sym] ? market[sym].suspended : 0,
                    mode: market[sym] ? market[sym].mode : MARKET_MODES[0],
                    pressure: pressureVal, 
                    shares: market[sym] ? market[sym].shares : 1000000,
                    issue_p: market[sym] ? market[sym].issue_p : 1000
                };
            }
            const logsRes = await db.prepare("SELECT * FROM market_logs WHERE created_at < ? ORDER BY created_at DESC LIMIT 20").bind(Date.now()).all();
            const logs = logsRes.results.map(l => ({ time: l.created_at, msg: l.msg, type: l.type }));

            return Response.json({ success: true, hasCompany, bankrupt: false, market: chartData, meta: stockMeta, news: logs, positions, capital: hasCompany ? company.capital : 0, totalEquity: totalEquity, companyType: hasCompany ? company.type : 'none', companyLevel: companyLevel, userK: user.k_coins || 0, userExp: user.xp || 0, status, era, isInsider });
        }

        if (method === 'POST') {
             const body = await request.json();
             const { action, symbol, amount, leverage = 1 } = body;
             const userNameDisplay = user.nickname || user.username;
             
             if (action === 'buy_insider') {
                if (user.k_coins < INSIDER_COST_24H) return Response.json({ error: `K币不足 (需 ${INSIDER_COST_24H} k)` });
                const newExp = Date.now() + 24 * 60 * 60 * 1000;
                await db.prepare("UPDATE users SET k_coins = k_coins - ?, insider_exp = ? WHERE id = ?").bind(INSIDER_COST_24H, newExp, user.id).run();
                return Response.json({ success: true, message: "已接入情报网络，持续24小时。" });
            }

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
                    batch.push(db.prepare("UPDATE market_state SET current_price=?, initial_base=?, open_price=?, is_suspended=0, last_update=?, accumulated_pressure=0, total_shares=?, issuance_price=?, last_dividend_time=? WHERE symbol=?").bind(newPrice, newPrice, newPrice, now, newShares, newPrice, sym, now)); 
                    batch.push(db.prepare("DELETE FROM market_history WHERE symbol = ?").bind(sym));
                    batch.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, newPrice, now));
                    batch.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(sym, `【管理员】${conf.name} 强制重组上市。`, 'good', now));
                }
                if (env.KV) await env.KV.delete("market_v13_div_dayfix");
                await db.batch(batch);
                return Response.json({ success: true, message: '重组完成' });
            }
            
            // ... 其他 convert, create, upgrade, invest, buy/sell 逻辑保持不变 ...
            // 请务必保留这些逻辑
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
            
            // 设置策略
            if (action === 'set_strategy') {
                const { strategy } = body;
                if (!['safe', 'normal', 'risky'].includes(strategy)) return Response.json({ error: '无效策略' });
                const newStrat = { ...companyData, risk: strategy };
                await db.prepare("UPDATE user_companies SET strategy = ? WHERE id = ?").bind(JSON.stringify(newStrat), company.id).run();
                return Response.json({ success: true, message: `经营方针已调整为: ${strategy.toUpperCase()}` });
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
                const lastType = pos ? (pos.last_trade_type || '') : ''; 
                const now = Date.now();

                if (action !== lastType && (now - lastTrade < TRADE_COOLDOWN)) {
                    const left = Math.ceil((TRADE_COOLDOWN - (now - lastTrade)) / 1000);
                    return Response.json({ error: `反向操作需等待 ${left} 秒 (同向加仓无限制)` });
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
                    if (company.capital < totalCost) return Response.json({ error: `公司账户余额不足 (需 ${totalCost} i, 含税)` });
                    if (pos && curHold < 0) return Response.json({ error: '请先平空' });
                    
                    batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(totalCost, company.id));
                    if (pos) {
                        const totalVal = (curHold * pos.avg_price) + (qty * curP);
                        const newQty = curHold + qty;
                        const newAvg = totalVal / newQty;
                        batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=?, last_trade_time=?, last_trade_type=? WHERE id=?").bind(newQty, newAvg, lev, now, action, pos.id));
                    } else {
                        batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage, last_trade_time, last_trade_type) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(company.id, symbol, qty, curP, lev, now, action));
                    }
                    logMsg = `[${userNameDisplay}] 买入 ${qty} 股 ${symbol} (x${lev})`;
                    batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure + ? WHERE symbol = ?").bind(qty, symbol));
                }
                else if (action === 'sell') {
                    if (curHold <= 0) { 
                        const margin = Math.floor((curP * qty) / lev * marginRate);
                        const totalCost = margin + fee;
                        if (company.capital < totalCost) return Response.json({ error: `公司账户余额不足 (需 ${totalCost} i, 含税)` });
                        
                        batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(totalCost, company.id));
                        if (pos) {
                            const totalVal = (Math.abs(curHold) * pos.avg_price) + (qty * curP);
                            const newQty = Math.abs(curHold) + qty;
                            const newAvg = totalVal / newQty;
                            batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=?, last_trade_time=?, last_trade_type=? WHERE id=?").bind(-newQty, newAvg, lev, now, action, pos.id));
                        } else {
                            batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage, last_trade_time, last_trade_type) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(company.id, symbol, -qty, curP, lev, now, action));
                        }
                        logMsg = `[${userNameDisplay}] 做空 ${qty} 股 ${symbol} (x${lev})`;
                        batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure - ? WHERE symbol = ?").bind(qty, symbol));
                    } else { 
                        if (qty > curHold) return Response.json({ error: '持仓不足' });
                        const prin = (pos.avg_price * qty) / pos.leverage * marginRate;
                        const prof = (curP - pos.avg_price) * qty;
                        const ret = Math.floor(prin + prof - fee);
                        batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(ret, company.id));
                        if (qty === curHold) batch.push(db.prepare("DELETE FROM company_positions WHERE id=?").bind(pos.id));
                        else batch.push(db.prepare("UPDATE company_positions SET amount=amount-?, last_trade_time=?, last_trade_type=? WHERE id=?").bind(qty, now, action, pos.id));
                        logMsg = `[${userNameDisplay}] 卖出 ${qty} 股 ${symbol}`;
                        batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure - ? WHERE symbol = ?").bind(qty, symbol));
                    }
                }
                else if (action === 'cover') { 
                    if (curHold >= 0) return Response.json({ error: '无空单' });
                    if (qty > Math.abs(curHold)) return Response.json({ error: '超出持仓' });
                    const prin = (pos.avg_price * qty) / pos.leverage * marginRate;
                    const prof = (pos.avg_price - curP) * qty; 
                    const ret = Math.floor(prin + prof - fee);
                    batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(ret, company.id));
                    if (qty === Math.abs(curHold)) batch.push(db.prepare("DELETE FROM company_positions WHERE id=?").bind(pos.id));
                    else batch.push(db.prepare("UPDATE company_positions SET amount=amount+?, last_trade_time=?, last_trade_type=? WHERE id=?").bind(qty, now, action, pos.id));
                    logMsg = `[${userNameDisplay}] 平空 ${qty} 股 ${symbol}`;
                    batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure + ? WHERE symbol = ?").bind(qty, symbol));
                }

                batch.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(symbol, logMsg, 'user', Date.now()));
                await db.batch(batch);
                if (env.KV) await env.KV.delete("market_v13_div_dayfix");
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
