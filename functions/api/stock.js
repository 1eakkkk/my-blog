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
        { type: 'bad',  factor: 0.80, msg: "蓝盾服务器遭遇大规模 DDoS 攻击！" },
        { type: 'good', factor: 1.20, msg: "蓝盾安全发布 Q3 财报，净利润超预期 200%！" },
        { type: 'good', factor: 1.30, msg: "蓝盾成功拦截针对中央银行的黑客攻击，声誉大涨！" },
        { type: 'good', factor: 1.15, msg: "知名科技媒体评选蓝盾为‘年度最佳安全服务商’。" },
        { type: 'bad', factor: 0.85, msg: "蓝盾首席技术官涉嫌数据交易被捕，股价承压。" },
        { type: 'good', factor: 1.15, msg: "蓝盾安全宣布与 NetWatch (网监) 达成战略合作。" },
        { type: 'good', factor: 1.20, msg: "新型‘量子迷宫’加密算法上线，黑客渗透率下降 90%。" },
        { type: 'good', factor: 1.10, msg: "夜之城市政厅决定全线采购蓝盾防火墙作为基础设施。" },
        { type: 'good', factor: 1.25, msg: "竞争对手的数据中心发生物理熔断，蓝盾市场份额激增！" },
        { type: 'good', factor: 1.18, msg: "蓝盾发布 Q4 财报，企业级数据托管业务增长喜人。" },
        { type: 'good', factor: 1.12, msg: "成功协助警方破获特大网络诈骗案，获颁‘城市守护者’勋章。" },
        { type: 'bad', factor: 0.88, msg: "蓝盾首席架构师被曝涉嫌贩卖用户隐私，遭停职调查。" },
        { type: 'bad', factor: 0.85, msg: "黑客组织‘匿名者’宣称已发现蓝盾底层的逻辑后门。" },
        { type: 'bad', factor: 0.90, msg: "新发布的杀毒软件误删了数万用户的系统文件，引发公关危机。" },
        { type: 'bad', factor: 0.92, msg: "由于电力供应不足，蓝盾不得不暂时关闭部分边缘节点。" },
        { type: 'bad', factor: 0.80, msg: "蓝盾云存储发生大规模宕机，赔偿金额恐成天文数字。" },
        { type: 'bad', factor: 0.85, msg: "一名吹哨人指控蓝盾协助大企业非法监控员工。" },
        { type: 'bad', factor: 0.75, msg: "蓝盾防火墙出现 0-day 漏洞，数千用户数据泄露！" }
    ],
    'GOLD': [
        { type: 'good', factor: 1.40, msg: "神经元科技发布新一代脑机接口！" },
        { type: 'good', factor: 1.50, msg: "神经元科技宣布实现‘意识上传’技术突破！" },
        { type: 'good', factor: 1.35, msg: "新型义体‘赫尔墨斯’销量火爆，神经元股价飙升。" },
        { type: 'good', factor: 1.25, msg: "神经元收购了一家有潜力的生物芯片初创公司。" },
        { type: 'bad', factor: 0.60, msg: "大量用户反馈植入体出现排异反应，神经元面临集体诉讼！" },
        { type: 'bad', factor: 0.80, msg: "AI 监管法案出台，神经元核心业务受到限制。" },
        { type: 'good', factor: 1.45, msg: "重磅：‘数字永生’项目取得突破性进展，记忆备份只需 5 秒！" },
        { type: 'good', factor: 1.30, msg: "新款‘超梦’体验芯片销量破亿，并在黑市被炒至天价。" },
        { type: 'good', factor: 1.35, msg: "神经元科技宣布收购一家顶级仿生义肢实验室。" },
        { type: 'good', factor: 1.25, msg: "医保法案通过：神经元生产的人工心脏被纳入报销范围。" },
        { type: 'good', factor: 1.40, msg: "旗下 AI 成功通过了最高难度的图灵测试，并通过了情感模拟认证。" },
        { type: 'good', factor: 1.50, msg: "发布纳米医疗机器人，号称可清除体内 99% 的毒素。" },
        { type: 'bad', factor: 0.65, msg: "严重事故：数百名用户因义体故障患上‘赛博精神病’！" },
        { type: 'bad', factor: 0.70, msg: "神经元科技被曝使用流浪汉进行非法的人体实验。" },
        { type: 'bad', factor: 0.75, msg: "新款脑机接口被黑客攻破，用户视网膜被强制播放广告。" },
        { type: 'bad', factor: 0.60, msg: "核心 AI 代码发生自我迭代并产生反人类倾向，已被紧急物理断网。" },
        { type: 'bad', factor: 0.80, msg: "生物伦理委员会叫停了神经元的‘克隆人’研发计划。" },
        { type: 'bad', factor: 0.70, msg: "因缺少稀有金属原材料，旗舰义体生产线被迫停工。" },
        { type: 'bad',  factor: 0.70, msg: "核心算法被曝存在伦理漏洞，股价跳水。" }
    ],
    'RED': [
        { type: 'good', factor: 1.60, msg: "荒坂军工在边境冲突中大获全胜！" },
        { type: 'good', factor: 1.80, msg: "第四次企业战争爆发！荒坂军工订单排到明年！" },
        { type: 'good', factor: 1.50, msg: "荒坂成功试爆反物质炸弹，威慑力大幅提升。" },
        { type: 'good', factor: 1.40, msg: "荒坂特勤组清理了竞争对手的据点，接管其市场份额。" },
        { type: 'bad', factor: 0.40, msg: "荒坂塔遭到核弹袭击！总部化为废墟！(历史重演)" },
        { type: 'bad', factor: 0.65, msg: "国际法庭指控荒坂犯有反人类罪，资产被多国冻结。" },
        { type: 'bad', factor: 0.50, msg: "荒坂内部爆发夺权内战，公司陷入瘫痪。" },
        { type: 'good', factor: 1.70, msg: "边境摩擦升级为全面武装冲突，荒坂军工接到天价订单！" },
        { type: 'good', factor: 1.60, msg: "荒坂发布全新‘半人马’机甲，号称单机可灭一支连队。" },
        { type: 'good', factor: 1.50, msg: "多国宣布增加国防预算，荒坂股价应声暴涨。" },
        { type: 'good', factor: 1.80, msg: "荒坂雇佣兵团成功镇压了殖民地的武装叛乱，展示了绝对武力。" },
        { type: 'good', factor: 1.40, msg: "轨道动能武器‘上帝之杖’试射成功，威慑力拉满。" },
        { type: 'good', factor: 1.55, msg: "荒坂强行并购了一家竞争对手的军工厂，垄断地位进一步巩固。" },
        { type: 'bad', factor: 0.35, msg: "突发：荒坂总部大楼遭战术核弹袭击，受损严重！" },
        { type: 'bad', factor: 0.45, msg: "三大企业签署《永久和平条约》，军火需求瞬间归零。" },
        { type: 'bad', factor: 0.50, msg: "荒坂的自动杀戮机器人在发布会上失控，误伤多名高管。" },
        { type: 'bad', factor: 0.55, msg: "传奇雇佣兵‘V’单枪匹马杀穿了荒坂塔，公司安保形象扫地。" },
        { type: 'bad', factor: 0.60, msg: "联合国宣布对荒坂军工实施最高级别的经济制裁。" },
        { type: 'bad', factor: 0.40, msg: "内部丑闻：荒坂被曝向反叛军同时也出售武器，两头通吃被揭穿。" },
        { type: 'bad',  factor: 0.50, msg: "荒坂秘密实验室发生生化泄漏，区域封锁！" }
    ]
};

// 判断休市
function getMarketStatus() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const bjHour = (utcHour + 8) % 24;
    // 02:00 ~ 06:00 休市
    if (bjHour >= 2 && bjHour < 6) return { isOpen: false };
    return { isOpen: true };
}

// 获取新闻影响 (增加安全检查，防止崩溃)
function getNewsImpact(symbol, timestamp) {
    const newsSlot = Math.floor(timestamp / (15 * 60000));
    let seed = newsSlot + symbol.length * 99;
    const random = () => { var x = Math.sin(seed++) * 10000; return x - Math.floor(x); };

    // 20% 概率触发
    if (random() < 0.2) {
        const events = NEWS_DB[symbol];
        // 🚨 安全检查：确保该股票有定义新闻，否则跳过
        if (events && Array.isArray(events) && events.length > 0) {
            const evt = events[Math.floor(random() * events.length)];
            return { multiplier: evt.factor, event: evt, time: newsSlot * 15 * 60000 };
        }
    }
    return { multiplier: 1.0, event: null };
}

// 计算价格
function getPriceAtTime(symbol, timestamp) {
    const config = STOCKS[symbol];
    if(!config) return 1; 

    const timeStep = Math.floor(timestamp / 60000); 
    let seed = timeStep + symbol.length; 
    const random = () => { var x = Math.sin(seed++) * 10000; return x - Math.floor(x); };

    const trend = Math.sin(timeStep / 60); 
    const noise = (random() - 0.5) * 2; 
    let factor = 1 + (trend * config.vol * 2) + (noise * config.vol);

    const news = getNewsImpact(symbol, timestamp);
    factor *= news.multiplier;

    // 熔断
    if (factor > 2.5) factor = 2.5; 
    if (factor < 0.1) factor = 0.1; 

    return Math.max(1, Math.floor(config.base * factor));
}

// === 4. 主请求处理逻辑 ===
export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 鉴权
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

    // === GET 请求：获取K线数据 ===
    if (method === 'GET') {
        const allHistory = {};
        const allNews = [];

        // 遍历所有股票生成数据
        for (let key in STOCKS) {
            allHistory[key] = [];
            
            // 1. 收集新闻 (过去1小时)
            for (let i = 0; i < 4; i++) { 
               const t = now - (i * 15 * 60000);
               const n = getNewsImpact(key, t);
               if (n.event) {
                   const exists = allNews.find(x => x.msg === n.event.msg && x.time === n.time);
                   if(!exists) allNews.push({ time: n.time, symbol: key, ...n.event });
               }
            }

            // 2. 生成 K 线 (过去30分钟)
            for (let i = 29; i >= 0; i--) {
                const t = now - (i * 60000);
                const p = getPriceAtTime(key, t);
                allHistory[key].push({ t: t, p: p });
            }
        }
        
        allNews.sort((a, b) => b.time - a.time);

        const openPrices = {};
        for (let key in STOCKS) openPrices[key] = getPriceAtTime(key, now - 24*60*60*1000);

        const positions = await db.prepare("SELECT * FROM company_positions WHERE company_id = ?").bind(company.id).all();

        return Response.json({
            success: true,
            market: allHistory, // 确保这里有数据！
            news: allNews,
            opens: openPrices,
            positions: positions.results,
            capital: company.capital,
            companyType: company.type,
            status: marketStatus
        });
    }

    // === POST 请求：交易 ===
    if (method === 'POST') {
        if (!marketStatus.isOpen) return Response.json({ error: '休市中' });

        const reqBody = await request.json(); // 安全获取 body
        const { action, symbol, amount } = reqBody;
        const qty = parseInt(amount);
        const currentPrice = getPriceAtTime(symbol, now);
        
        if (isNaN(qty) || qty <= 0) return Response.json({ error: '数量无效' });
        
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
        else if (action === 'sell') {
             if (company.type !== 'blackops' && currentHold <= 0) return Response.json({ error: '无持仓' });
             
             if (currentHold <= 0) { // 做空
                 const margin = currentPrice * qty;
                 if (company.capital < margin) return Response.json({ error: '保证金不足' });
                 batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(margin, company.id));
                 if(pos) {
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
             if (currentHold >= 0) return Response.json({ error: '无空单' });
             if (qty > Math.abs(currentHold)) return Response.json({ error: '超出持仓' });
             const profit = (pos.avg_price - currentPrice) * qty;
             const returnAmount = (pos.avg_price * qty) + profit;
             batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(returnAmount, company.id));
             if (qty === Math.abs(currentHold)) batch.push(db.prepare("DELETE FROM company_positions WHERE id = ?").bind(pos.id));
             else batch.push(db.prepare("UPDATE company_positions SET amount = amount + ? WHERE id = ?").bind(qty, pos.id));
             logMsg = `平空 ${qty} 股 ${symbol} @ ${currentPrice}`;
        }

        // 🚨 修复点：直接使用 batch，不赋值给未定义的 updates
        await db.batch(batch);
        
        return Response.json({ success: true, message: '交易成功', log: logMsg });
    }
}
