// --- START OF FILE functions/api/stock.js ---

const STOCKS_CONFIG = {
    'BLUE': { name: '蓝盾安全', color: '#00f3ff' },
    'GOLD': { name: '神经元科技', color: '#ffd700' },
    'RED':  { name: '荒坂军工', color: '#ff3333' }
};

// 市场天气定义
const MARKET_MODES = {
    0: { name: '平衡市', code: 'NORMAL', volatility: 1.0, news_prob_mod: 1.0, pressure_mod: 1.0, icon: '🌤️' },
    1: { name: '牛市',   code: 'BULL',   volatility: 1.5, news_prob_mod: 0.8, pressure_mod: 0.8, icon: '🔥' },
    2: { name: '熊市',   code: 'BEAR',   volatility: 1.2, news_prob_mod: 1.5, pressure_mod: 0.5, icon: '❄️' },
    3: { name: '低波市', code: 'QUIET',  volatility: 0.5, news_prob_mod: 0.5, pressure_mod: 2.5, icon: '🌫️' }
};

// 公司科技树配置
const COMPANY_LEVELS = {
    0: { name: "皮包公司", margin_rate: 1.0, tax_rate: 0.05, cost: 0 },
    1: { name: "量化工作室", margin_rate: 0.95, tax_rate: 0.04, cost: 5000 },
    2: { name: "高频交易中心", margin_rate: 0.90, tax_rate: 0.03, cost: 15000 },
    3: { name: "金融巨鳄", margin_rate: 0.85, tax_rate: 0.02, cost: 50000 }
};

// 新闻库
const NEWS_DB = {
    'BLUE': [
        { weight: 20, factor: 0.05, msg: "季度财报显示现金流小幅回暖。" },
        { weight: 20, factor: -0.05, msg: "服务器维护成本略高于预期。" },
        { weight: 10, factor: 0.12, msg: "蓝盾安全宣布与多家中小企业签订维护合同。" },
        { weight: 10, factor: -0.12, msg: "部分用户投诉防火墙误报率上升。" },
        { weight: 5, factor: 0.18, msg: "获得政府防火墙二期工程大额订单！" },
        { weight: 5, factor: -0.18, msg: "核心数据库遭受 DDoS 攻击，服务短暂中断！" },
        { weight: 1, factor: 0.20, msg: "【重磅】夜之城市政厅宣布蓝盾为唯一指定安全供应商！" },
        { weight: 1, factor: -0.20, msg: "【突发】0-day 漏洞攻破，数亿数据泄露！" }
    ],
    'GOLD': [
        { weight: 20, factor: 0.06, msg: "义体原材料价格小幅下跌。" },
        { weight: 20, factor: -0.06, msg: "医保法案修正案推迟，影响报销。" },
        { weight: 10, factor: 0.13, msg: "新款义体‘赫尔墨斯’销量稳步增长。" },
        { weight: 10, factor: -0.13, msg: "数千名用户因芯片固件故障投诉。" },
        { weight: 5, factor: 0.19, msg: "义体排异反应抑制剂通过临床三期！" },
        { weight: 5, factor: -0.19, msg: "被曝在贫民窟进行非法活体实验。" },
        { weight: 1, factor: 0.20, msg: "【神迹】宣布实现完美意识上传！股价飞升！" },
        { weight: 1, factor: -0.20, msg: "【灾难】核心 AI 产生自我意识，已被物理断网！" }
    ],
    'RED': [
        { weight: 20, factor: 0.05, msg: "边境摩擦带来少量弹药订单。" },
        { weight: 20, factor: -0.05, msg: "一批常规弹药运输延误。" },
        { weight: 10, factor: 0.14, msg: "荒坂安保部门成功镇压了一起局部暴乱。" },
        { weight: 10, factor: -0.14, msg: "反战组织在分部大楼下拉横幅抗议。" },
        { weight: 5, factor: 0.18, msg: "发布新型‘半人马’机甲，单兵威慑力拉满。" },
        { weight: 5, factor: -0.18, msg: "国际法庭宣布冻结荒坂部分海外资产。" },
        { weight: 1, factor: 0.20, msg: "【战争】第四次企业战争爆发！军火订单激增！" },
        { weight: 1, factor: -0.20, msg: "【覆灭】荒坂内部爆发夺权内战，全球业务瘫痪！" }
    ]
};

function generateBasePrice() { return Math.floor(Math.random() * 1900) + 100; }
function getBJTime(ts) { return new Date(ts + (8 * 60 * 60 * 1000)); }
function getBJHour(ts) { return getBJTime(ts).getUTCHours(); }

function pickWeightedNews(symbol, modeCode) {
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

// === 核心修复：自动检查并修补数据库表结构 ===
async function ensureSchema(db) {
    try {
        // 尝试查询新字段，如果不存在会报错
        await db.prepare("SELECT accumulated_pressure FROM market_state LIMIT 1").first();
    } catch (e) {
        // 字段不存在，执行添加列操作
        try {
            await db.batch([
                db.prepare("ALTER TABLE market_state ADD COLUMN accumulated_pressure INTEGER DEFAULT 0"),
                db.prepare("ALTER TABLE market_state ADD COLUMN last_news_time INTEGER DEFAULT 0")
            ]);
        } catch (err) {
            // 忽略重复添加错误
        }
    }
}

async function getOrUpdateMarket(env, db) {
    const now = Date.now();
    const CACHE_KEY = "market_data_v7_balanced"; 
    
    let cachedData = null;
    if (env.KV) {
        try { cachedData = await env.KV.get(CACHE_KEY, { type: "json" }); } catch (e) {}
    }

    if (cachedData && (now - cachedData.timestamp < 5000)) {
        return cachedData.payload;
    }

    const bjHour = getBJHour(now);
    const isMarketClosed = (bjHour >= 2 && bjHour < 6);

    let states = await db.prepare("SELECT * FROM market_state").all();
    let marketMap = {};
    let updates = [];
    let logsToWrite = []; 

    // 初始化
    if (states.results.length === 0) {
        const batch = [];
        for (let sym in STOCKS_CONFIG) {
            let p = generateBasePrice() + 50;
            batch.push(db.prepare("INSERT INTO market_state (symbol, current_price, initial_base, last_update, is_suspended, open_price, last_news_time, accumulated_pressure) VALUES (?, ?, ?, ?, 0, ?, ?, 0)").bind(sym, p, p, now, p, now));
            batch.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, p, now));
            marketMap[sym] = { p: p, base: p, t: now, open: p, suspended: 0, last_news: now, pressure: 0, mode: getMarketMode(sym, now) };
        }
        await db.batch(batch);
        return { market: marketMap, status: { isOpen: !isMarketClosed } };
    }

    // 每日结算
    const isNewDay = !isMarketClosed && states.results.some(s => (now - s.last_update) > 3600 * 4000);
    if (isNewDay) {
        let totalDividends = 0;
        for (let s of states.results) {
            const sym = s.symbol;
            let newBase = s.initial_base;
            let newP = s.current_price;
            let newSusp = s.is_suspended;
            
            if (newSusp === 1) {
                newBase = generateBasePrice();
                newP = newBase;
                newSusp = 0;
                updates.push(db.prepare("DELETE FROM market_history WHERE symbol = ?").bind(sym));
                logsToWrite.push({sym, msg: `【新股上市】${STOCKS_CONFIG[sym].name} 重组挂牌。`, type: 'good', t: now});
            }

            const DIVIDEND_RATE = 0.005; 
            const holders = await db.prepare(`SELECT uc.user_id, cp.amount FROM company_positions cp JOIN user_companies uc ON cp.company_id = uc.id WHERE cp.stock_symbol = ? AND cp.amount > 0`).bind(sym).all();
            for (const h of holders.results) {
                const dividend = Math.floor(h.amount * newP * DIVIDEND_RATE);
                if (dividend > 0) {
                    updates.push(db.prepare("UPDATE users SET k_coins = COALESCE(k_coins, 0) + ? WHERE id = ?").bind(dividend, h.user_id));
                    totalDividends += dividend;
                }
            }

            updates.push(db.prepare("UPDATE market_state SET open_price=?, current_price=?, initial_base=?, is_suspended=?, last_update=?, accumulated_pressure=0 WHERE symbol=?").bind(newP, newP, newBase, newSusp, now, sym));
        }
        if (totalDividends > 0) {
            updates.push(db.prepare("INSERT INTO notifications (user_id, type, message, is_read, created_at, link) VALUES (?, 'system', ?, 0, ?, '#business')").bind(0, `【股市分红】昨日分红已发放 (0.5%)，共计 ${totalDividends} k币。`, now));
        }
    }

    if (isMarketClosed) {
        if (updates.length > 0) await db.batch(updates);
        return { market: {}, status: { isOpen: false } };
    }

    // 模拟循环
    for (let s of states.results) {
        const sym = s.symbol;
        const mode = getMarketMode(sym, now);
        
        marketMap[sym] = { 
            p: s.current_price, base: s.initial_base, t: s.last_update, 
            open: s.open_price, suspended: s.is_suspended, 
            last_news: s.last_news_time || 0, // 防止旧数据 undefined
            pressure: s.accumulated_pressure || 0, // 防止旧数据 undefined
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
            
            let baseChange = 0;
            let newsMsg = null;
            let hasNews = false;

            if (simT - nextNewsT >= 300000) {
                if (Math.random() < (0.15 * mode.news_prob_mod)) {
                    nextNewsT = simT;
                    const news = pickWeightedNews(sym, mode.code);
                    if (news) {
                        baseChange = news.factor;
                        if (mode.code === 'BULL' && baseChange > 0) baseChange *= 1.2;
                        if (mode.code === 'BEAR' && baseChange < 0) baseChange *= 1.2;
                        newsMsg = news;
                        hasNews = true;
                    }
                }
            }

            if (!hasNews) {
                const noise = (Math.random() - 0.5) * 0.06;
                baseChange = noise * mode.volatility;
            }

            let pressureChange = 0;
            if (currentPressure !== 0 && i === 0) {
                const rawImpact = (currentPressure / 1000) * 0.005 * mode.pressure_mod;
                pressureChange = Math.max(-0.08, Math.min(0.08, rawImpact));
            }

            let tempP = curP * (1 + baseChange);
            curP = Math.max(1, Math.round(tempP * (1 + pressureChange)));

            if (newsMsg) {
                logsToWrite.push({sym, msg: `[${STOCKS_CONFIG[sym].name}] ${newsMsg.msg}`, type: newsMsg.factor > 0 ? 'good' : 'bad', t: simT});
            }

            if (curP < s.initial_base * 0.1) {
                const refund = curP;
                updates.push(db.prepare("DELETE FROM company_positions WHERE stock_symbol = ?").bind(sym));
                updates.push(db.prepare("UPDATE market_state SET current_price=?, is_suspended=1, last_update=? WHERE symbol=?").bind(refund, simT, sym));
                updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, refund, simT));
                logsToWrite.push({sym, msg: `【停牌】${STOCKS_CONFIG[sym].name} 触发熔断，等待重组。`, type: 'bad', t: simT});
                marketMap[sym].suspended = 1; 
                marketMap[sym].p = refund;
                break;
            }

            updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, curP, simT));
        }

        if (marketMap[sym].suspended !== 1) {
            updates.push(db.prepare("UPDATE market_state SET current_price=?, last_update=?, last_news_time=?, accumulated_pressure=0 WHERE symbol=?").bind(curP, simT, nextNewsT, sym));
            marketMap[sym].p = curP;
            marketMap[sym].t = simT;
            marketMap[sym].pressure = 0;
        }
    }

    logsToWrite.forEach(l => {
        updates.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(l.sym, l.msg, l.type, l.t));
    });
    if (Math.random() < 0.05) updates.push(db.prepare("DELETE FROM market_logs WHERE created_at < ?").bind(now - 3600000));

    if (updates.length > 0) await db.batch(updates);

    const result = { market: marketMap, status: { isOpen: true } };
    if (env.KV) await env.KV.put(CACHE_KEY, JSON.stringify({ timestamp: now, payload: result }), { expirationTtl: 10 });
    return result;
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;
    
    // === 自动修复数据库表结构 ===
    await ensureSchema(db);
    // ========================

    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    
    const user = await db.prepare('SELECT users.id, users.coins, users.k_coins, users.xp, users.username, users.nickname, users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();
    const method = request.method;
    
    const { market, status } = await getOrUpdateMarket(env, db);

    let companyData = null;
    let companyLevel = 0;
    if (company) {
        try {
            const stratObj = JSON.parse(company.strategy);
            companyData = stratObj;
            companyLevel = stratObj.level || 0;
        } catch(e) {
            companyData = { risk: company.strategy, level: 0 };
        }
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
                await db.batch([
                    db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                    db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id)
                ]);
                return Response.json({ success: true, hasCompany: false, bankrupt: true, report: { msg: `公司净值归零，宣告破产。` } });
            }
        }

        const chartData = {};
        const stockMeta = {};
        
        const historyResults = await db.prepare("SELECT symbol, price as p, created_at as t FROM market_history WHERE created_at > ? ORDER BY created_at ASC").bind(Date.now() - 7200000).all();
        
        for (let sym in STOCKS_CONFIG) {
            chartData[sym] = historyResults.results.filter(r => r.symbol === sym);
            if (chartData[sym].length === 0 && market[sym]) chartData[sym] = [{ t: market[sym].t, p: market[sym].p }];
            
            stockMeta[sym] = { 
                open: market[sym] ? market[sym].open : 0, 
                suspended: market[sym] ? market[sym].suspended : 0,
                mode: market[sym] ? market[sym].mode : MARKET_MODES[0],
                pressure: market[sym] ? market[sym].pressure : 0
            };
        }

        const logsRes = await db.prepare("SELECT * FROM market_logs WHERE created_at < ? ORDER BY created_at DESC LIMIT 20").bind(Date.now()).all();
        const logs = logsRes.results.map(l => ({ time: l.created_at, msg: l.msg, type: l.type }));

        return Response.json({
            success: true, hasCompany, bankrupt: false,
            market: chartData, meta: stockMeta, news: logs, positions,
            capital: hasCompany ? company.capital : 0,
            companyType: hasCompany ? company.type : 'none',
            companyLevel: companyLevel,
            userK: user.k_coins || 0,
            userExp: user.xp || 0,
            status
        });
    }

    if (method === 'POST') {
        const body = await request.json();
        const { action, symbol, amount, leverage = 1 } = body;
        const userNameDisplay = user.nickname || user.username;

        if (action === 'admin_reset') {
            if (user.role !== 'admin') return Response.json({ error: '权限不足' }, { status: 403 });
            const now = Date.now();
            const suspendedStocks = await db.prepare("SELECT * FROM market_state WHERE is_suspended = 1").all();
            if (suspendedStocks.results.length === 0) return Response.json({ success: false, error: '无停牌股票' });
            const batch = [];
            for (const s of suspendedStocks.results) {
                const newBase = Math.floor(Math.random() * 1900) + 100;
                const sym = s.symbol;
                batch.push(db.prepare("UPDATE market_state SET current_price=?, initial_base=?, open_price=?, is_suspended=0, last_update=?, accumulated_pressure=0 WHERE symbol=?").bind(newBase, newBase, newBase, now, sym));
                batch.push(db.prepare("DELETE FROM market_history WHERE symbol = ?").bind(sym));
                batch.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, newBase, now));
                batch.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(sym, `【管理员】${STOCKS_CONFIG[sym].name} 重组上市。`, 'good', now));
            }
            if (env.KV) await env.KV.delete("market_data_v7_balanced");
            await db.batch(batch);
            return Response.json({ success: true, message: '重组完成' });
        }

        if (action === 'upgrade_company') {
            if (!company) return Response.json({ error: '无公司' });
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

        if (['buy', 'sell', 'cover'].includes(action)) {
            if (!status.isOpen) return Response.json({ error: '休市' });
            if (market[symbol].suspended === 1) return Response.json({ error: '停牌' });
            
            const qty = parseInt(amount);
            const lev = parseInt(leverage);
            if (isNaN(qty) || qty <= 0) return Response.json({ error: '数量无效' });

            const currentLvConf = COMPANY_LEVELS[companyLevel] || COMPANY_LEVELS[0];
            const marginRate = currentLvConf.margin_rate; 

            const curP = market[symbol].p;
            const pos = await db.prepare("SELECT * FROM company_positions WHERE company_id = ? AND stock_symbol = ?").bind(company.id, symbol).first();
            const curHold = pos ? pos.amount : 0;
            const curLev = pos ? (pos.leverage || 1) : 1;
            const batch = [];
            let logMsg = "";

            const margin = Math.floor((curP * qty) / lev * marginRate);

            if (action === 'buy') {
                if (company.capital < margin) return Response.json({ error: `资金不足 (需 ${margin} i)` });
                if (pos && curHold < 0) return Response.json({ error: '请先平空' });
                
                batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                if (pos) {
                    const totalVal = (curHold * pos.avg_price) + (qty * curP);
                    const newQty = curHold + qty;
                    const newAvg = totalVal / newQty;
                    batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=? WHERE id=?").bind(newQty, newAvg, lev, pos.id));
                } else {
                    batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage) VALUES (?, ?, ?, ?, ?)").bind(company.id, symbol, qty, curP, lev));
                }
                logMsg = `[${userNameDisplay}] 买入 ${qty} 股 ${symbol}`;
                batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure + ? WHERE symbol = ?").bind(qty, symbol));
            }
            else if (action === 'sell') {
                if (curHold <= 0) { 
                    if (company.capital < margin) return Response.json({ error: `资金不足 (需 ${margin} i)` });
                    
                    batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                    if (pos) {
                        const totalVal = (Math.abs(curHold) * pos.avg_price) + (qty * curP);
                        const newQty = Math.abs(curHold) + qty;
                        const newAvg = totalVal / newQty;
                        batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=? WHERE id=?").bind(-newQty, newAvg, lev, pos.id));
                    } else {
                        batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage) VALUES (?, ?, ?, ?, ?)").bind(company.id, symbol, -qty, curP, lev));
                    }
                    logMsg = `[${userNameDisplay}] 做空 ${qty} 股 ${symbol}`;
                    batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure - ? WHERE symbol = ?").bind(qty, symbol));
                } else { 
                    if (qty > curHold) return Response.json({ error: '持仓不足' });
                    const prin = (pos.avg_price * qty) / pos.leverage * marginRate;
                    const prof = (curP - pos.avg_price) * qty;
                    const ret = Math.floor(prin + prof);
                    batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(ret, company.id));
                    if (qty === curHold) batch.push(db.prepare("DELETE FROM company_positions WHERE id=?").bind(pos.id));
                    else batch.push(db.prepare("UPDATE company_positions SET amount=amount-? WHERE id=?").bind(qty, pos.id));
                    logMsg = `[${userNameDisplay}] 卖出 ${qty} 股 ${symbol}`;
                    batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure - ? WHERE symbol = ?").bind(qty, symbol));
                }
            }
            else if (action === 'cover') {
                if (curHold >= 0) return Response.json({ error: '无空单' });
                if (qty > Math.abs(curHold)) return Response.json({ error: '超出持仓' });
                const prin = (pos.avg_price * qty) / pos.leverage * marginRate;
                const prof = (pos.avg_price - curP) * qty;
                const ret = Math.floor(prin + prof);
                batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(ret, company.id));
                if (qty === Math.abs(curHold)) batch.push(db.prepare("DELETE FROM company_positions WHERE id=?").bind(pos.id));
                else batch.push(db.prepare("UPDATE company_positions SET amount=amount+? WHERE id=?").bind(qty, pos.id));
                logMsg = `[${userNameDisplay}] 平空 ${qty} 股 ${symbol}`;
                batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure + ? WHERE symbol = ?").bind(qty, symbol));
            }

            batch.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(symbol, logMsg, 'user', Date.now()));
            await db.batch(batch);
            
            if (env.KV) await env.KV.delete("market_data_v7_balanced");
            
            return Response.json({ success: true, message: 'OK', log: logMsg });
        }
        
        // 提现逻辑 (补全)
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
}
