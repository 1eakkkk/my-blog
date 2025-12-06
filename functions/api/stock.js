// --- START OF FILE functions/api/stock.js ---

// === 1. 核心配置 ===
const STOCKS_CONFIG = {
    'BLUE': { name: '蓝盾安全', color: '#00f3ff', share_range: [1500000, 2000000], price_range: [800, 1200] },
    'GOLD': { name: '神经元科技', color: '#ffd700', share_range: [1000000, 1500000], price_range: [2000, 3000] },
    'RED':  { name: '荒坂军工', color: '#ff3333', share_range: [600000, 900000], price_range: [3500, 5000] },
    'PURPLE': { name: '虚空能源', color: '#bd00ff', share_range: [2500000, 3500000], price_range: [400, 600] }, // 公用事业，盘大价低，适合新手
    'GREEN':  { name: '康陶医疗', color: '#00ff00', share_range: [900000, 1300000], price_range: [1800, 2800] }, // 生物医药，受政策影响大
    'PINK':   { name: '夜氏传媒', color: '#ff00de', share_range: [700000, 1100000], price_range: [1200, 2200] }  // 娱乐传媒，波动极快
};

// === 🤖 机器人假名库 (气氛组) ===
const BOT_NAMES = [
    "Quant_V9", "HighFreq_Bot", "Arasaka_Fund", "Militech_AI", 
    "NetWatch_Node", "Kang_Tao_Capital", "NightCorp_Algo", "Biotechnica_Lab",
    "DeepDive_System", "Ghost_Protocol", "Quant_V1", "Quant_V2", "Quant_V3", "Quant_V4", "Quant_V5",
    "Quant_V6", "Quant_V7", "Quant_V8", "Quant_V14", "Quant_V10", "Quant_V11", "Quant_V12", "Quant_V13", "DeepSeek_System",
    "Open_AI", "Google_AI"
];

// === 2. 宏观与风控 ===
const MACRO_ERAS = [
    { code: 'NEON_AGE', name: '霓虹盛世', desc: '全市场流动性充裕，易暴涨。', buff: { vol: 1.2, gold_bias: 1.2, red_bias: 1.0, green_bias: 1.1 } },
    { code: 'CORP_WAR', name: '企业战争', desc: '局势动荡，军工暴涨，娱乐暴跌。', buff: { vol: 1.5, gold_bias: 0.7, red_bias: 1.5, pink_bias: 0.6 } },
    { code: 'DATA_CRASH', name: '数据大崩塌', desc: '大萧条，阴跌不止，能源抗跌。', buff: { vol: 0.8, gold_bias: 0.8, red_bias: 0.8, purple_bias: 1.1 } },
    { code: 'BIO_PLAGUE', name: '生化危机', desc: '疫病蔓延，医疗股被爆炒。', buff: { vol: 1.3, green_bias: 1.6, pink_bias: 0.8, blue_bias: 1.2 } },
    { code: 'NET_CELEB', name: '全网狂欢', desc: '娱乐至死，传媒股受追捧。', buff: { vol: 1.1, pink_bias: 1.5, red_bias: 0.8, purple_bias: 0.9 } }
];

const TRADE_COOLDOWN = 30 * 1000;
const SHORT_HOLD_MIN = 60 * 1000;
const BASE_FEE_RATE = 0.005;
const MAX_HOLDING_PCT = 0.20; 
const MAX_ORDER_PCT = 0.01;
const BANKRUPT_PCT = 0.2;
const INSIDER_COST_24H = 5000;
const CURRENT_CACHE_KEY = "market_v15_fake_logs"; // 更新缓存键

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

// 新闻库 (扩充版：每只股票 12+ 条事件)
// Factor > 1 为利好(买盘增厚)，Factor < 1 为利空(卖盘增厚)
const NEWS_DB = {
    'BLUE': [ // 蓝盾安全 (网络安全)
        { weight: 20, factor: 1.15, msg: "季度财报显示企业级安全服务收入稳步增长。" },
        { weight: 20, factor: 0.95, msg: "服务器维护成本略高于预期，净利润微跌。" },
        { weight: 15, factor: 1.25, msg: "与夜之城警局(NCPD)续签了年度防火墙维护合同。" },
        { weight: 15, factor: 0.85, msg: "部分民用级防火墙被曝存在后门，引发隐私担忧。" },
        { weight: 10, factor: 1.40, msg: "发布‘神盾-7’主动防御系统，拦截率提升 300%。" },
        { weight: 10, factor: 0.75, msg: "数名高级安全顾问被竞争对手高薪挖角。" },
        { weight: 10, factor: 1.35, msg: "竞争对手的数据中心遭黑客瘫痪，蓝盾订单激增。" },
        { weight: 5, factor: 0.40, msg: "核心数据库遭到‘流窜AI’的 DDoS 攻击，服务间歇性中断！" },
        { weight: 5, factor: 1.80, msg: "成功破解恶名昭彰的勒索病毒，获市政厅表彰。" },
        { weight: 5, factor: 0.50, msg: "被指控协助荒坂集团非法监控市民，股价承压。" },
        { weight: 2, factor: 2.20, msg: "【重磅】收购顶级黑客组织‘网络监察’的分支实验室！" },
        { weight: 1, factor: 3.00, msg: "【史诗】成为全球唯一指定脑机接口安全标准制定者！" },
        { weight: 1, factor: 0.10, msg: "【崩盘】底层加密算法被破解，全球账户面临裸奔风险！" }
    ],
    'GOLD': [ // 神经元科技 (义体/芯片)
        { weight: 20, factor: 1.10, msg: "稀有金属原材料价格下跌，义体生产成本降低。" },
        { weight: 20, factor: 0.90, msg: "由于能源短缺，部分工厂产能利用率下降。" },
        { weight: 15, factor: 1.30, msg: "新款‘赫尔墨斯’加速义体销量打破季度记录。" },
        { weight: 15, factor: 0.80, msg: "数千名用户投诉植入体出现过热排异反应。" },
        { weight: 10, factor: 1.50, msg: "神经链接技术取得突破，延迟降低至 0.1ms。" },
        { weight: 10, factor: 0.70, msg: "医保法案修正案推迟，高端义体报销受阻。" },
        { weight: 10, factor: 1.40, msg: "获得创伤小组(Trauma Team)的独家义体采购大单。" },
        { weight: 5, factor: 0.30, msg: "贫民窟曝出非法‘义体收割’丑闻，公司被指涉嫌其中。" },
        { weight: 5, factor: 1.90, msg: "研发出可自我修复的纳米神经纤维，股价大涨。" },
        { weight: 5, factor: 0.40, msg: "一批军用级义体在运输途中被赛博疯子劫持。" },
        { weight: 2, factor: 2.50, msg: "【突破】‘数字永生’项目初具雏形，富豪争相预定！" },
        { weight: 1, factor: 3.50, msg: "【神迹】宣布实现完美的人脑-云端意识上传！人类进化！" },
        { weight: 1, factor: 0.05, msg: "【灾难】核心 AI 产生自我意识并控制了所有联网义体！" }
    ],
    'RED': [ // 荒坂军工 (武器/安保)
        { weight: 20, factor: 1.15, msg: "边境摩擦升级，常规弹药需求小幅上升。" },
        { weight: 20, factor: 0.90, msg: "和平条约签署的传闻导致军工板块微跌。" },
        { weight: 15, factor: 1.35, msg: "荒坂安保部门成功镇压了一起大规模暴乱。" },
        { weight: 15, factor: 0.75, msg: "一批智能追踪导弹在试射中误击友军，股价受挫。" },
        { weight: 10, factor: 1.60, msg: "发布新型‘半人马’外骨骼机甲，单兵威慑力拉满。" },
        { weight: 10, factor: 0.60, msg: "反战组织在荒坂塔下举行大规模抗议示威。" },
        { weight: 10, factor: 1.45, msg: "获得月球殖民地安保部队的独家防务合同。" },
        { weight: 5, factor: 0.30, msg: "国际法庭宣布冻结荒坂在欧非地区的部分资产。" },
        { weight: 5, factor: 2.00, msg: "秘密研发的轨道动能武器‘雷神’试射成功。" },
        { weight: 5, factor: 0.40, msg: "首席武器设计师携带核心机密叛逃。" },
        { weight: 2, factor: 2.80, msg: "【宣战】第四次企业战争全面爆发！全球军火订单激增！" },
        { weight: 1, factor: 4.00, msg: "【统治】成功部署天基武器网，掌控全球制空权！" },
        { weight: 1, factor: 0.05, msg: "【覆灭】荒坂家族内部爆发夺权内战，集团运作陷入瘫痪！" }
    ],
    'PURPLE': [ // 虚空能源 (电力/能源)
        { weight: 20, factor: 1.10, msg: "核聚变电站运行效率提升 2%，成本降低。" },
        { weight: 20, factor: 0.95, msg: "输电网络老化严重，需投入大额维修资金。" },
        { weight: 15, factor: 1.25, msg: "宣布下调工业用电价格，获得政府巨额补贴。" },
        { weight: 15, factor: 0.80, msg: "贫民窟发生大规模偷电行为，造成巨额亏空。" },
        { weight: 10, factor: 1.40, msg: "在深海发现高纯度氦-3矿脉，能源储备翻倍。" },
        { weight: 10, factor: 0.70, msg: "环保组织抗议废料处理方式，部分电厂暂停运。" },
        { weight: 10, factor: 1.35, msg: "极寒天气席卷夜之城，居民取暖用电量暴增。" },
        { weight: 5, factor: 0.40, msg: "主反应堆冷却系统发生故障，面临停机风险。" },
        { weight: 5, factor: 1.80, msg: "无线电力传输塔试运行成功，覆盖全城。" },
        { weight: 5, factor: 0.50, msg: "竞争对手推出廉价太阳能板，抢占民用市场。" },
        { weight: 2, factor: 2.30, msg: "【突破】可控冷聚变技术商用化成功！能源革命！" },
        { weight: 1, factor: 3.20, msg: "【垄断】收购全城所有小型发电站，在此领域再无对手。" },
        { weight: 1, factor: 0.10, msg: "【事故】核心聚变堆熔毁，半个夜之城陷入永久黑暗！" }
    ],
    'GREEN': [ // 康陶医疗 (生物/制药)
        { weight: 20, factor: 1.15, msg: "季节性流感爆发，疫苗销量稳步增长。" },
        { weight: 20, factor: 0.85, msg: "新药研发周期延长，短期投入成本增加。" },
        { weight: 15, factor: 1.30, msg: "获得创伤小组的急救药物长期采购合同。" },
        { weight: 15, factor: 0.75, msg: "一款畅销止痛药被指有强烈的成瘾副作用。" },
        { weight: 10, factor: 1.50, msg: "纳米修复机器人获得 FDA 紧急使用授权。" },
        { weight: 10, factor: 0.65, msg: "主要原材料产地发生罢工，供应链紧张。" },
        { weight: 10, factor: 1.45, msg: "发布‘青春版’基因修复液，中产阶级疯抢。" },
        { weight: 5, factor: 0.30, msg: "最高等级病毒实验室样本意外泄露！" },
        { weight: 5, factor: 1.90, msg: "攻克了一种致命的神经退行性疾病。" },
        { weight: 5, factor: 0.40, msg: "被曝在廉价合成肉中掺杂不明化学实验物。" },
        { weight: 2, factor: 2.60, msg: "【奇迹】断肢再生技术完美攻克！义体不再是唯一选择。" },
        { weight: 1, factor: 3.50, msg: "【永生】端粒酶逆转技术人体实验成功，寿命延长200%！" },
        { weight: 1, factor: 0.10, msg: "【瘟疫】研发的超级细菌失控变异，全城封锁！" }
    ],
    'PINK': [ // 夜氏传媒 (娱乐/洗脑)
        { weight: 20, factor: 1.20, msg: "旗下虚拟偶像‘莉莉丝’演唱会门票秒空。" },
        { weight: 20, factor: 0.80, msg: "头部主播跳槽竞争对手，流量小幅下滑。" },
        { weight: 15, factor: 1.40, msg: "超梦体验片《赛博朋克2078》首映票房破纪录。" },
        { weight: 15, factor: 0.70, msg: "流媒体服务器因负载过高宕机，用户无法登陆。" },
        { weight: 10, factor: 1.50, msg: "独家转播‘死之舞’地下黑拳赛，收视率爆表。" },
        { weight: 10, factor: 0.60, msg: "涉嫌在儿童节目中植入潜意识广告被调查。" },
        { weight: 10, factor: 1.30, msg: "收购了最大的地下黑客八卦论坛。" },
        { weight: 5, factor: 0.30, msg: "当红明星被曝使用非法违禁义体，人设崩塌。" },
        { weight: 5, factor: 1.80, msg: "推出‘五感同步’超梦设备，重新定义娱乐。" },
        { weight: 5, factor: 0.40, msg: "被指控操控舆论干预市长选举。" },
        { weight: 2, factor: 2.40, msg: "【爆款】全网脑机接口覆盖率突破 95%，流量垄断！" },
        { weight: 1, factor: 3.20, msg: "【洗脑】成功研发群体潜意识修正技术，掌控思想！" },
        { weight: 1, factor: 0.05, msg: "【封杀】因传播高危违禁数据，主营业务被NCPD强制叫停！" }
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
    try { await db.prepare("SELECT accumulated_volume FROM company_positions LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE company_positions ADD COLUMN accumulated_volume INTEGER DEFAULT 0").run(); } catch(err){} }
}

async function getOrUpdateMarket(env, db) {
    const now = Date.now();
    
    let cachedData = null;
    if (env.KV) { try { cachedData = await env.KV.get(CURRENT_CACHE_KEY, { type: "json" }); } catch (e) {} }
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
    if (isNewDay) { /* 重组逻辑 */ }

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
        
        let momentum = currentPressure; 

        for (let i = 0; i < missed; i++) {
            simT += 60000;
            const isCatchUp = (i < missed - 1); 

            let eraBias = 1.0;
            
            // 动态读取 buff 字段 (例如 gold_bias, purple_bias)
            const buffKey = sym.toLowerCase() + '_bias';
            if (currentEra.buff[buffKey]) {
                eraBias = currentEra.buff[buffKey];
            }
            
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

            // 3. 狡猾的做市商 (机器人)
            if (!newsMsg && Math.random() < 0.6) { 
                const valuation = curP / issuePrice;
                let botSentiment = 0; 

                let valueBias = (1.0 - valuation) * 0.8; 
                if (currentEra.code === 'DATA_CRASH') valueBias -= 0.3; 
                if (currentEra.code === 'CORP_WAR' && sym !== 'RED') valueBias -= 0.1;
                if (currentEra.code === 'NEON_AGE' && (sym === 'BLUE' || sym === 'GOLD')) valueBias += 0.2; 

                const trendBlock = Math.floor(simT / 300000); 
                let trendDir = (trendBlock % 2 === 0) ? 1 : -1;
                if (Math.random() < 0.4) botSentiment += trendDir * 0.3;
                else botSentiment += valueBias;

                if (valuation > 0.6 && valuation < 0.9 && Math.random() < 0.3) botSentiment = -0.5; 

                botSentiment += (Math.random() - 0.5) * 0.4;

                if (Math.abs(botSentiment) > 0.1) {
                    const direction = botSentiment > 0 ? 1 : -1;
                    const intensity = Math.min(1.5, Math.abs(botSentiment));
                    const botVol = direction * totalShares * (0.003 + Math.random() * 0.007) * intensity;
                    
                    if (botVol > 0) buyDepth += botVol;
                    else sellDepth += Math.abs(botVol);
                    
                    // === 👇 新增：假机器人日志 (气氛组) 👇 ===
                    // 仅在非追赶模式(实时)且概率5%时记录，防止刷屏
                    if (!isCatchUp && Math.random() < 0.05) {
                        const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
                        const actionStr = botVol > 0 ? "买入" : "卖出"; 
                        const volStr = Math.floor(Math.abs(botVol)).toLocaleString();
                        
                        // 🎲 随机生成一个假杠杆 (1x ~ 20x)，模拟激进的量化基金
                        // 逻辑：机器人通常使用较高杠杆
                        const fakeLev = Math.floor(Math.random() * 10) + 1; // 1x - 10x 随机

                        logsToWrite.push({
                            sym,
                            // 修改点：增加了 ${sym} 显示股票名，增加了 (x${fakeLev}) 显示杠杆
                            msg: `[${botName}] ${actionStr} ${volStr} 股 ${sym} (x${fakeLev})`, 
                            type: 'user', // 保持灰色，像真人一样
                            t: simT
                        });
                    }
                    // === 👆 新增结束 👆 ===
                }
            }

            // 动量衰减
            if (Math.abs(momentum) > 10) {
                if (momentum > 0) buyDepth += momentum;
                else sellDepth += Math.abs(momentum);
                momentum = Math.floor(momentum * 0.6); 
            }

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
                logsToWrite.push({sym, msg: `【破产】股价击穿红线，强制退市。`, type: 'bad', t: simT});
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

    const result = { market: marketMap, status: { isOpen: !isMarketClosed }, era: currentEra };
    if (env.KV) await env.KV.put(CURRENT_CACHE_KEY, JSON.stringify({ timestamp: now, payload: result }), { expirationTtl: 60 });
    return result;
}

// ... onRequest 保持不变 ...
export async function onRequest(context) {
    // ... (与之前代码完全一致，请直接使用之前的 POST 逻辑，注意不要删掉)
    // 为确保完整，这里再次附上 onRequest 的外壳，您可以把之前的逻辑填进去
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

            // ... (请务必复制之前提供的完整 switch case 逻辑，包括 buy, sell, admin_reset 等)
            // 这里是重复的交易逻辑，确保它是最新的 "batch quota" 版本
             if (action === 'set_strategy') {
                if (!company) return Response.json({ error: '无公司' });
                const { strategy } = body;
                if (!['safe', 'normal', 'risky'].includes(strategy)) return Response.json({ error: '无效策略' });
                const newStrat = { ...companyData, risk: strategy };
                await db.prepare("UPDATE user_companies SET strategy = ? WHERE id = ?").bind(JSON.stringify(newStrat), company.id).run();
                return Response.json({ success: true, message: `经营方针已调整为: ${strategy.toUpperCase()}` });
            }

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
                if (env.KV) await env.KV.delete(CURRENT_CACHE_KEY);
                await db.batch(batch);
                return Response.json({ success: true, message: '重组完成' });
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

                // === ⚡ 定义快速交易额度池 (10,000股) ===
                const BATCH_QUOTA = 10000; 

                const curP = market[symbol].p;
                const totalShares = market[symbol].shares;
                const pos = await db.prepare("SELECT * FROM company_positions WHERE company_id = ? AND stock_symbol = ?").bind(company.id, symbol).first();
                
                const lastTrade = pos ? (pos.last_trade_time || 0) : 0;
                const lastType = pos ? (pos.last_trade_type || '') : ''; 
                let currentAccVol = pos ? (pos.accumulated_volume || 0) : 0;
                
                const now = Date.now();
                const timeDiff = now - lastTrade;

                if (timeDiff >= TRADE_COOLDOWN) {
                    currentAccVol = 0; 
                } else {
                    if (action !== lastType) {
                        const left = Math.ceil((TRADE_COOLDOWN - timeDiff) / 1000);
                        return Response.json({ error: `反向操作需等待 ${left} 秒` });
                    }
                    if (currentAccVol + qty > BATCH_QUOTA) {
                        const remaining = Math.max(0, BATCH_QUOTA - currentAccVol);
                        const left = Math.ceil((TRADE_COOLDOWN - timeDiff) / 1000);
                        return Response.json({ error: `频繁操作超额！当前批次剩余额度 ${remaining} 股 (或等待 ${left} 秒重置)` });
                    }
                }
                const newAccVol = currentAccVol + qty;

                if (action === 'cover') {
                    if (timeDiff < SHORT_HOLD_MIN && currentAccVol === 0) { } 
                    else if (timeDiff < SHORT_HOLD_MIN) { return Response.json({ error: '做空需锁仓 1 分钟' }); }
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
                        batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=?, last_trade_time=?, last_trade_type=?, accumulated_volume=? WHERE id=?").bind(newQty, newAvg, lev, now, action, newAccVol, pos.id));
                    } else {
                        batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage, last_trade_time, last_trade_type, accumulated_volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(company.id, symbol, qty, curP, lev, now, action, newAccVol));
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
                            batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=?, last_trade_time=?, last_trade_type=?, accumulated_volume=? WHERE id=?").bind(-newQty, newAvg, lev, now, action, newAccVol, pos.id));
                        } else {
                            batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage, last_trade_time, last_trade_type, accumulated_volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(company.id, symbol, -qty, curP, lev, now, action, newAccVol));
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
                        else batch.push(db.prepare("UPDATE company_positions SET amount=amount-?, last_trade_time=?, last_trade_type=?, accumulated_volume=? WHERE id=?").bind(qty, now, action, newAccVol, pos.id));
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
                    else batch.push(db.prepare("UPDATE company_positions SET amount=amount+?, last_trade_time=?, last_trade_type=?, accumulated_volume=? WHERE id=?").bind(qty, now, action, newAccVol, pos.id));
                    logMsg = `[${userNameDisplay}] 平空 ${qty} 股 ${symbol}`;
                    batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure + ? WHERE symbol = ?").bind(qty, symbol));
                }

                batch.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(symbol, logMsg, 'user', Date.now()));
                await db.batch(batch);
                if (env.KV) await env.KV.delete(CURRENT_CACHE_KEY);
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
