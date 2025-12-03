// --- START OF FILE functions/api/stock.js ---

// === 1. 配置 ===
const STOCKS_CONFIG = {
    'BLUE': { name: '蓝盾安全', color: '#00f3ff' },
    'GOLD': { name: '神经元科技', color: '#ffd700' },
    'RED':  { name: '荒坂军工', color: '#ff3333' }
};

// === 2. 加权新闻库 ===
// weight: 权重 (1-Rare, 5-Uncommon, 10-Common)
// factor: 影响幅度 (正数为涨，负数为跌)
const NEWS_DB = {
    'BLUE': [
        // --- 常见 (Weight 10) ---
        { weight: 10, factor: 0.05, msg: "分析师上调蓝盾安全评级，称其现金流健康。" },
        { weight: 10, factor: 0.08, msg: "蓝盾安全宣布与多家中小企业签订维护合同。" },
        { weight: 10, factor: -0.05, msg: "传闻蓝盾高层正在抛售股票，引发市场微小恐慌。" },
        { weight: 10, factor: -0.08, msg: "部分用户投诉蓝盾防火墙误报率上升。" },
        // --- 普通 (Weight 5) ---
        { weight: 5, factor: 0.15, msg: "获得政府防火墙二期工程大额订单！" },
        { weight: 5, factor: 0.12, msg: "发布‘量子迷宫’加密算法，黑客渗透率归零。" },
        { weight: 5, factor: -0.15, msg: "服务器遭受大规模 DDoS 攻击，服务短暂中断！" },
        { weight: 5, factor: -0.12, msg: "首席架构师涉嫌私下交易用户数据被捕。" },
        { weight: 5, factor: 0.18, msg: "竞争对手的数据中心发生物理熔断，蓝盾市场份额激增。" },
        // --- 稀有/大事件 (Weight 1) ---
        { weight: 1, factor: 0.30, msg: "【重磅】夜之城市政厅宣布蓝盾为唯一指定安全供应商！" },
        { weight: 1, factor: -0.30, msg: "【突发】蓝盾核心数据库遭 0-day 漏洞攻破，数亿数据泄露！" },
        { weight: 1, factor: -0.25, msg: "【丑闻】蓝盾被曝协助大企业非法监控员工脑机接口。" }
    ],
    'GOLD': [
        // --- 常见 ---
        { weight: 10, factor: 0.06, msg: "新款义体‘赫尔墨斯’销量稳步增长。" },
        { weight: 10, factor: 0.05, msg: "神经元科技赞助了本届赛博格格斗大赛。" },
        { weight: 10, factor: -0.06, msg: "原材料价格上涨，义体生产成本略微增加。" },
        { weight: 10, factor: -0.05, msg: "医保法案修正案推迟，影响部分义体报销。" },
        // --- 普通 ---
        { weight: 5, factor: 0.20, msg: "义体排异反应抑制剂研发成功，通过临床三期！" },
        { weight: 5, factor: 0.15, msg: "收购顶级仿生义肢实验室，技术壁垒加深。" },
        { weight: 5, factor: -0.20, msg: "数千名用户因芯片固件故障陷入精神错乱。" },
        { weight: 5, factor: -0.15, msg: "被曝在贫民窟进行非法活体实验。" },
        { weight: 5, factor: 0.18, msg: "‘数字永生’项目取得突破，记忆备份仅需5秒。" },
        // --- 稀有 ---
        { weight: 1, factor: 0.35, msg: "【跨时代】神经元科技宣布实现完美意识上传！股价飞升！" },
        { weight: 1, factor: -0.35, msg: "【灾难】核心 AI 产生自我意识并试图控制人类，已被物理断网！" },
        { weight: 1, factor: -0.28, msg: "【制裁】生物伦理委员会叫停其克隆人计划，罚款百亿。" }
    ],
    'RED': [
        // --- 常见 ---
        { weight: 10, factor: 0.08, msg: "荒坂安保部门成功镇压了一起局部暴乱。" },
        { weight: 10, factor: 0.05, msg: "荒坂军工发布新一季度的雇佣兵招募计划。" },
        { weight: 10, factor: -0.07, msg: "反战组织在荒坂分部大楼下拉横幅抗议。" },
        { weight: 10, factor: -0.05, msg: "一批常规弹药在运输途中被流浪者劫持。" },
        // --- 普通 ---
        { weight: 5, factor: 0.25, msg: "边境冲突升级，各国军火订单激增！" },
        { weight: 5, factor: 0.18, msg: "发布新型‘半人马’机甲，单兵威慑力拉满。" },
        { weight: 5, factor: -0.20, msg: "国际法庭宣布冻结荒坂在欧非的海外资产。" },
        { weight: 5, factor: -0.25, msg: "荒坂总部大楼遭战术核弹袭击！大楼主体受损！" },
        { weight: 5, factor: 0.22, msg: "成功试爆微型反物质炸弹，技术遥遥领先。" },
        // --- 稀有 ---
        { weight: 1, factor: 0.40, msg: "【战争】第四次企业战争全面爆发！荒坂股价火箭式暴涨！" },
        { weight: 1, factor: -0.40, msg: "【覆灭】荒坂内部爆发夺权内战，全球业务陷入瘫痪！" },
        { weight: 1, factor: -0.30, msg: "【泄密】荒坂被曝双面军火交易，同时资助反叛军。" }
    ]
};

// 生成随机基价
function generateBasePrice() {
    return Math.floor(Math.random() * 1900) + 100;
}

// 获取当前北京时间的小时数
function getBJHour(timestamp) {
    return (new Date(timestamp).getUTCHours() + 8) % 24;
}

// 抽取加权新闻
function pickWeightedNews(symbol) {
    const list = NEWS_DB[symbol];
    if (!list || list.length === 0) return null;

    // 1. 计算总权重
    let totalWeight = 0;
    list.forEach(n => totalWeight += n.weight);

    // 2. 随机抽取
    let random = Math.random() * totalWeight;
    
    // 3. 遍历寻找
    for (let i = 0; i < list.length; i++) {
        random -= list[i].weight;
        if (random <= 0) {
            return list[i];
        }
    }
    return list[0]; // 兜底
}

// === 核心：市场状态机 ===
async function getOrUpdateMarket(db) {
    const now = Date.now();
    const bjHour = getBJHour(now);
    
    // 休市时间 (02:00 - 06:00)
    const isMarketClosed = (bjHour >= 2 && bjHour < 6);

    let states = await db.prepare("SELECT * FROM market_state").all();
    let marketMap = {};
    let logs = [];
    let updates = [];

    // --- 初始化 ---
    if (states.results.length === 0) {
        const batch = [];
        for (let sym in STOCKS_CONFIG) {
            let price = generateBasePrice() + Math.floor(Math.random() * 50);
            // 增加 last_news_time 初始值
            batch.push(db.prepare("INSERT INTO market_state (symbol, current_price, initial_base, last_update, is_suspended, open_price, last_news_time) VALUES (?, ?, ?, ?, 0, ?, ?)").bind(sym, price, price, now, price, now));
            batch.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, price, now));
            marketMap[sym] = { p: price, base: price, t: now, open: price, suspended: 0, last_news: now };
        }
        await db.batch(batch);
        return { market: marketMap, logs: [], status: { isOpen: !isMarketClosed } };
    }

    states.results.forEach(s => {
        marketMap[s.symbol] = { 
            p: s.current_price, 
            base: s.initial_base, 
            t: s.last_update, 
            open: s.open_price || s.current_price, 
            suspended: s.is_suspended,
            last_news: s.last_news_time || 0 // 获取上次新闻时间
        };
    });

    // --- 每日开盘重置 ---
    const isNewTradingSession = !isMarketClosed && states.results.some(s => (now - s.last_update) > 3600 * 4);

    if (isNewTradingSession) {
        for (let sym in STOCKS_CONFIG) {
            let st = marketMap[sym];
            let newPrice = st.p;
            let newBase = st.base;
            let newSuspended = st.suspended;

            if (st.suspended === 1) {
                newBase = generateBasePrice();
                newPrice = newBase;
                newSuspended = 0;
                updates.push(db.prepare("DELETE FROM market_history WHERE symbol = ?").bind(sym));
                logs.push({ time: now, msg: `【新股上市】${STOCKS_CONFIG[sym].name} 完成重组，今日重新挂牌交易。`, type: 'good' });
            }

            updates.push(db.prepare("UPDATE market_state SET open_price = ?, current_price = ?, initial_base = ?, is_suspended = ?, last_update = ? WHERE symbol = ?").bind(newPrice, newPrice, newBase, newSuspended, now, sym));
            
            st.p = newPrice;
            st.base = newBase;
            st.open = newPrice;
            st.suspended = newSuspended;
            st.t = now;
        }
    }

    if (isMarketClosed) {
        if (updates.length > 0) await db.batch(updates);
        return { market: marketMap, logs: logs, status: { isOpen: false } };
    }

    // --- 正常波动 ---
    for (let sym in STOCKS_CONFIG) {
        let st = marketMap[sym];
        if (st.suspended === 1) continue;

        // 每 60 秒更新一次价格
        if (now - st.t >= 60000) {
            
            // 1. 自然波动：扩大到 ±10% (0.2 width)
            let changePercent = (Math.random() - 0.5) * 0.2; 
            
            // 2. 新闻触发逻辑：每 5 分钟 (300000ms) 判定一次
            let newsMsg = null;
            let newNewsTime = st.last_news;

            // 如果距离上次新闻判定超过 5分钟
            if (now - st.last_news >= 300000) {
                // 更新判定时间 (无论是否触发新闻，都刷新时间，确保是 interval 效果)
                newNewsTime = now;

                // 40% 概率触发新闻
                if (Math.random() < 0.4) {
                    const picked = pickWeightedNews(sym);
                    if (picked) {
                        changePercent += picked.factor; // 叠加新闻影响
                        newsMsg = picked;
                    }
                }
            }

            let newPrice = Math.max(1, Math.floor(st.p * (1 + changePercent)));

            // --- 退市检测 ---
            if (newPrice < st.base * 0.05) {
                const refundPrice = newPrice;
                updates.push(db.prepare(`UPDATE user_companies SET capital = capital + (SELECT IFNULL(SUM(amount * ?), 0) FROM company_positions WHERE company_positions.company_id = user_companies.id AND company_positions.stock_symbol = ?) WHERE id IN (SELECT company_id FROM company_positions WHERE stock_symbol = ?)`).bind(refundPrice, sym, sym));
                updates.push(db.prepare("DELETE FROM company_positions WHERE stock_symbol = ?").bind(sym));
                updates.push(db.prepare("UPDATE market_state SET current_price = ?, is_suspended = 1, last_update = ? WHERE symbol = ?").bind(refundPrice, now, sym));
                updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, refundPrice, now));
                logs.push({ time: now, msg: `【停牌公告】${STOCKS_CONFIG[sym].name} 触及退市红线！强制清算并停牌。`, type: 'bad' });
                st.p = refundPrice;
                st.suspended = 1;
            } else {
                // --- 正常更新 ---
                // 更新价格、时间 和 新闻判定时间
                updates.push(db.prepare("UPDATE market_state SET current_price = ?, last_update = ?, last_news_time = ? WHERE symbol = ?").bind(newPrice, now, newNewsTime, sym));
                updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, newPrice, now));
                updates.push(db.prepare("DELETE FROM market_history WHERE symbol = ? AND id NOT IN (SELECT id FROM market_history WHERE symbol = ? ORDER BY created_at DESC LIMIT 120)").bind(sym, sym));

                st.p = newPrice;
                st.t = now;
                st.last_news = newNewsTime;
                
                if (newsMsg) {
                    const newsType = newsMsg.factor > 0 ? 'good' : 'bad';
                    logs.push({ time: now, msg: `[${STOCKS_CONFIG[sym].name}] ${newsMsg.msg}`, type: newsType });
                }
            }
        }
    }

    if (updates.length > 0) await db.batch(updates);
    
    return { market: marketMap, logs: logs, status: { isOpen: true } };
}

// === API Handler ===
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

    const { market, logs, status } = await getOrUpdateMarket(db);

    if (method === 'GET') {
        const hasCompany = !!company;
        if (hasCompany && company.capital < 100) {
            const refund = Math.floor(company.capital * 0.2);
            await db.batch([
                db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id),
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(refund, user.id)
            ]);
            return Response.json({ success: true, bankrupt: true, report: { msg: `公司已强制破产，返还 ${refund} i币。` } });
        }

        const chartData = {};
        const stockMeta = {}; 
        const historyResults = await db.prepare("SELECT symbol, price as p, created_at as t FROM market_history ORDER BY created_at ASC").all();
        
        for (let sym in STOCKS_CONFIG) {
            chartData[sym] = historyResults.results.filter(r => r.symbol === sym);
            if (chartData[sym].length === 0) chartData[sym] = [{ t: market[sym].t, p: market[sym].p }];
            stockMeta[sym] = { open: market[sym].open, suspended: market[sym].suspended };
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
            meta: stockMeta,
            news: logs,
            positions: positions,
            capital: hasCompany ? company.capital : 0,
            companyType: hasCompany ? company.type : 'none',
            status: status
        });
    }

    if (method === 'POST') {
        const body = await request.json();
        const { action } = body;

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

        if (['buy', 'sell', 'cover'].includes(action)) {
            if (!status.isOpen) return Response.json({ error: '市场休市中' });
            const { symbol } = body;
            if (market[symbol].suspended === 1) return Response.json({ error: '停牌中' });
            
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
            else if (action === 'sell') {
                if (currentHold <= 0) { 
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
                } else { 
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
