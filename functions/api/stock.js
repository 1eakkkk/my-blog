// --- START OF FILE functions/api/stock.js ---

// === 1. 核心配置 ===
const STOCKS_CONFIG = {
    'BLUE': { name: '蓝盾安全', color: '#00f3ff', share_range: [1500000, 2000000], price_range: [800, 1200] },
    'GOLD': { name: '神经元科技', color: '#ffd700', share_range: [1000000, 1500000], price_range: [2000, 3000] },
    'RED':  { name: '荒坂军工', color: '#ff3333', share_range: [600000, 900000], price_range: [3500, 5000] },
    'PURPLE': { name: '虚空能源', color: '#bd00ff', share_range: [2500000, 3500000], price_range: [400, 600] },
    'GREEN':  { name: '康陶医疗', color: '#00ff00', share_range: [900000, 1300000], price_range: [1800, 2800] },
    'PINK':   { name: '夜氏传媒', color: '#ff00de', share_range: [700000, 1100000], price_range: [1200, 2200] }
};

const MACRO_ERAS = [
    { code: 'NEON_AGE', name: '霓虹盛世', desc: '科技繁荣，波动降低，利好科技股。', buff: { vol: 1.2, gold_bias: 1.2, red_bias: 1.0, green_bias: 1.1 } },
    { code: 'CORP_WAR', name: '企业战争', desc: '局势动荡，军工暴涨，娱乐暴跌。', buff: { vol: 1.5, gold_bias: 0.7, red_bias: 1.5, pink_bias: 0.6 } },
    { code: 'DATA_CRASH', name: '数据大崩塌', desc: '大萧条，流动性枯竭，能源抗跌。', buff: { vol: 0.8, gold_bias: 0.8, red_bias: 0.8, purple_bias: 1.1 } },
    { code: 'BIO_PLAGUE', name: '生化危机', desc: '疫病蔓延，医疗股被爆炒。', buff: { vol: 1.3, green_bias: 1.6, pink_bias: 0.8, blue_bias: 1.2 } },
    { code: 'NET_CELEB', name: '全网狂欢', desc: '娱乐至死，传媒股受追捧。', buff: { vol: 1.1, pink_bias: 1.5, red_bias: 0.8, purple_bias: 0.9 } }
];

// === 2. 基础风控参数 ===
const BASE_TRADE_COOLDOWN = 30 * 1000; 
const SHORT_HOLD_MIN = 60 * 1000;
const BASE_FEE_RATE = 0.005;           
const BASE_MAX_HOLDING_PCT = 0.20;     
const MAX_ORDER_PCT = 0.01;
const BANKRUPT_PCT = 0.2;
const INSIDER_COST_24H = 5000;
const CURRENT_CACHE_KEY = "market_v16_talent_tree"; 

// === 👇👇👇 补回丢失的 MARKET_MODES 定义 👇👇👇 ===
const MARKET_MODES = {
    0: { name: '平衡市', code: 'NORMAL', depth_mod: 1.0, icon: '🌤️' },
    1: { name: '牛市',   code: 'BULL',   depth_mod: 1.5, icon: '🔥' },
    2: { name: '熊市',   code: 'BEAR',   depth_mod: 0.8, icon: '❄️' },
    3: { name: '低波市', code: 'QUIET',  depth_mod: 0.3, icon: '🌫️' }
};
// ===================================================

// === 3. 公司天赋树 (v3.2 更新：增加维护费) ===
const COMPANY_LEVELS = {
    0:  { name: "皮包公司",     cost: 0,       margin: 1.00, fee: 1.0, cd: 1.0, hold: 1.0, maint: 0 },
    1:  { name: "车库工作室",   cost: 2000,    margin: 0.98, fee: 1.0, cd: 1.0, hold: 1.0, maint: 5 },
    2:  { name: "量化作坊",     cost: 5000,    margin: 0.95, fee: 0.9, cd: 0.9, hold: 1.0, maint: 20 },
    3:  { name: "小型私募",     cost: 10000,   margin: 0.92, fee: 0.9, cd: 0.9, hold: 1.2, maint: 50 },
    4:  { name: "高频交易室",   cost: 20000,   margin: 0.90, fee: 0.8, cd: 0.7, hold: 1.2, maint: 100 },
    5:  { name: "区域游资",     cost: 40000,   margin: 0.88, fee: 0.8, cd: 0.7, hold: 1.5, maint: 200 },
    6:  { name: "数据对冲基金", cost: 80000,   margin: 0.85, fee: 0.7, cd: 0.6, hold: 1.5, maint: 500 },
    7:  { name: "跨国资本",     cost: 150000,  margin: 0.82, fee: 0.7, cd: 0.6, hold: 1.8, maint: 1000 },
    8:  { name: "暗池巨鲸",     cost: 300000,  margin: 0.80, fee: 0.6, cd: 0.5, hold: 2.0, maint: 2000 },
    9:  { name: "市场做市商",   cost: 600000,  margin: 0.75, fee: 0.5, cd: 0.4, hold: 2.5, maint: 5000 },
    10: { name: "荒坂塔顶层",   cost: 1000000, margin: 0.70, fee: 0.4, cd: 0.3, hold: 5.0, maint: 10000 } 
};

function calculateTotalUpgradeCost(level) {
    let total = 0;
    for (let i = 1; i <= level; i++) {
        if (COMPANY_LEVELS[i]) total += COMPANY_LEVELS[i].cost;
    }
    return total;
}

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
// 辅助函数：计算持仓价值 (v4.5 修复：计入保证金折扣)
function calculatePositionValue(pos, currentPrice, marginRate = 1.0) {
    const qty = pos.amount; 
    const avg = pos.avg_price; 
    const lev = pos.leverage || 1;
    
    // 本金 = (均价 * 数量 / 杠杆) * 折扣率
    // 之前漏乘了 marginRate，导致虚高
    const principal = ((avg * Math.abs(qty)) / lev) * marginRate;
    
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
    try { await db.prepare("SELECT stock_buff_exp FROM users LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE users ADD COLUMN stock_buff_exp INTEGER DEFAULT 0").run(); } catch(err) {} }
    try { await db.prepare("SELECT tech_levels FROM users LIMIT 1").first(); } catch (e) { try { await db.prepare("ALTER TABLE users ADD COLUMN tech_levels TEXT DEFAULT '{}'").run(); } catch(err) {} }
}

async function getOrUpdateMarket(env, db) {
    const now = Date.now();
    // 为了让新股票生效，我们需要更新缓存键，或者您手动去KV里删掉
    const CACHE_KEY = "market_v17_multi_stocks"; 
    const LOCK_KEY = "market_calc_lock"; // 🔒 并发锁 Key
    
    let cachedData = null;
    if (env.KV) { try { cachedData = await env.KV.get(CACHE_KEY, { type: "json" }); } catch (e) {} }
    let isLocked = false;
    if (env.KV) {
        const lock = await env.KV.get(LOCK_KEY);
        if (lock) isLocked = true;
    }
    if (cachedData && ((now - cachedData.timestamp < 5000) || isLocked)) {
        return cachedData.payload;
    }
    if (env.KV) await env.KV.put(LOCK_KEY, "1", { expirationTtl: 60 });
    

    const bjHour = getBJHour(now);
    const isMarketClosed = (bjHour >= 2 && bjHour < 6);
    const currentEra = getCurrentEra(now);

    let states = await db.prepare("SELECT * FROM market_state").all();
    let marketMap = {};
    let updates = [];
    let logsToWrite = []; 

    // === EVA-L00P: 全球经济感知 & 情绪状态机 (v4.0 Personality) ===
    const EVA_CACHE_KEY = "eva_l00p_state";
    let evaState = { greed: 0.5, emotion: 'CALM', desc: '系统平稳运行中' };
    
    // 1. 读取或重新扫描
    let cachedEva = null;
    try { cachedEva = await env.KV.get(EVA_CACHE_KEY, {type:'json'}); } catch(e){}
    
    // 强制每 5 分钟刷新一次状态 (或者如果没有缓存)
    if (cachedEva) {
        evaState = cachedEva;
    } else {
        try {
            const resMoney = await db.prepare("SELECT SUM(coins) as c FROM users").first();
            const resStocks = await db.prepare("SELECT SUM(amount * avg_price) as s FROM company_positions").first();
            const money = resMoney.c || 1000000;
            const stockVal = resStocks.s || 100000;
            
            // 计算贪婪指数 (0~1)
            const greed = stockVal / (money + stockVal + 1); // +1防止除0
            
            // 判定情绪 (State Machine)
            let emotion = 'CALM';
            let desc = '逻辑回路正常，监控交易流...';
            
            if (greed > 0.75) {
                emotion = 'GREED'; // 贪婪：玩家全在车上
                desc = '检测到资产泡沫，准备启动收割协议...';
            } else if (greed < 0.25) {
                emotion = 'PANIC'; // 恐慌：玩家全跑了
                desc = '流动性枯竭，注入紧急激励资金...';
            }
            
            evaState = { greed, emotion, desc };
            // 写入 KV，供 stock.js 和 idle.js 共享
            await env.KV.put(EVA_CACHE_KEY, JSON.stringify(evaState), {expirationTtl: 300});
        } catch(e) { console.error("EVA Scan Failed", e); }
    }
    
    // 2. 情绪对市场的影响 (Physics Modifier)
    let evaBias = 0;         // 方向偏差
    let evaVolMod = 1.0;     // 波动率乘区
    
    if (evaState.emotion === 'GREED') {
        // 贪婪状态：EVA 想要杀跌，且波动剧烈 (诱多杀多)
        evaBias = -0.008;    // 强力抛压
        evaVolMod = 1.5;     // 剧烈震荡
    } else if (evaState.emotion === 'PANIC') {
        // 恐慌状态：EVA 想要拉升，且容易暴涨
        evaBias = 0.005;     // 托底买入
        evaVolMod = 1.2;     // 活跃度提升
    }
    // CALM 状态：bias=0, vol=1.0 (保持默认)

    // === 1. 初始化检查 (支持增量添加新股票) ===
    // 获取当前数据库里已有的股票列表
    const existingSymbols = new Set(states.results.map(s => s.symbol));
    
    for (let sym in STOCKS_CONFIG) {
        if (!existingSymbols.has(sym)) {
            // 发现缺失股票，初始化它
            const conf = STOCKS_CONFIG[sym];
            const shares = randRange(conf.share_range[0], conf.share_range[1]);
            const price = randRange(conf.price_range[0], conf.price_range[1]);
            
            updates.push(db.prepare("INSERT INTO market_state (symbol, current_price, initial_base, last_update, is_suspended, open_price, last_news_time, accumulated_pressure, total_shares, issuance_price, last_dividend_time) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?)").bind(sym, price, price, now, price, now, shares, price, now));
            updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, price, now));
            
            // 构造临时 state 对象加入内存，确保后续逻辑能跑通
            states.results.push({
                symbol: sym, current_price: price, initial_base: price, last_update: now,
                is_suspended: 0, open_price: price, last_news_time: now, accumulated_pressure: 0,
                total_shares: shares, issuance_price: price, last_dividend_time: now
            });
        }
    }
    
    // 如果是完全初始化（第一只股票），直接返回以避免后续逻辑冲突，
    // 但如果是增量添加，我们需要继续向下执行以获取完整 map
    if (existingSymbols.size === 0 && updates.length > 0) {
        await db.batch(updates);
        // 重新构建 map 返回
        for (let s of states.results) {
             marketMap[s.symbol] = { p: s.current_price, base: s.initial_base, shares: s.total_shares, issue_p: s.issuance_price, t: now, open: s.open_price, suspended: 0, pressure: 0, mode: getMarketMode(s.symbol, now) };
        }
        return { market: marketMap, status: { isOpen: !isMarketClosed }, era: currentEra };
    }

    // === 2. 每日结算与分红 ===
    const currentBJDate = getBJDateStr(now);
    for (let s of states.results) {
        const sym = s.symbol;
        if (!STOCKS_CONFIG[sym]) continue;

        const lastDivTime = s.last_dividend_time || 0;
        const lastDivDate = getBJDateStr(lastDivTime); 
        
        // 每天只执行一次
        if (currentBJDate > lastDivDate && s.is_suspended === 0) {
            
            // A. 分红逻辑 (原有)
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
                    const note = `【分红到账】${STOCKS_CONFIG[sym].name} 发放分红 ${finalDiv} k币 (策略: ${risk})`;
                    updates.push(db.prepare("INSERT INTO notifications (user_id, type, message, is_read, created_at, link) VALUES (?, 'system', ?, 0, ?, '#business')").bind(h.user_id, note, now));
                    totalDivForStock += finalDiv;
                }
            }
            if (totalDivForStock > 0) logsToWrite.push({sym, msg: `【年度分红】向股东派发共计 ${totalDivForStock} k币。`, type: 'good', t: now});

            if (sym === 'BLUE') { // 选一个锚点股票
                const allCompanies = await db.prepare("SELECT id, user_id, strategy FROM user_companies").all();
                for (const c of allCompanies.results) {
                    let lv = 0;
                    try { lv = JSON.parse(c.strategy).level || 0; } catch(e){}
                    const cost = COMPANY_LEVELS[lv] ? COMPANY_LEVELS[lv].maint : 0;
                    
                    if (cost > 0) {
                        // 扣除 K 币，允许扣成负数 (负债经营)
                        updates.push(db.prepare("UPDATE users SET k_coins = k_coins - ? WHERE id = ?").bind(cost, c.user_id));
                        // 如果扣完是负数，且负债超过 5000，则强制降级 (逻辑稍复杂，这里先仅通知)
                        const note = `【日报】公司运营支出 ${cost} k币 (等级 Lv.${lv})`;
                        updates.push(db.prepare("INSERT INTO notifications (user_id, type, message, is_read, created_at, link) VALUES (?, 'system', ?, 0, ?, '#business')").bind(c.user_id, note, now));
                    }
                }
            }

            updates.push(db.prepare("UPDATE market_state SET last_dividend_time = ? WHERE symbol = ?").bind(now, sym));
        }
    }

    // 每日结算 (重组逻辑 - 保持不变)
    // ...

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

    // === 3. 核心模拟引擎 ===
    for (let s of states.results) {
        const sym = s.symbol;
        // 安全过滤：忽略旧数据
        if (!STOCKS_CONFIG[sym]) continue;

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
        const MAX_LOOPS = 15; 
        
        if (missed > MAX_LOOPS) { 
            // 直接把“上次更新时间”瞬移到“现在 - 15分钟”
            s.last_update = simulationEndTime - (MAX_LOOPS * 60000); 
            missed = MAX_LOOPS; 
        }

        let curP = s.current_price;
        let simT = s.last_update;
        let nextNewsT = s.last_news_time || 0;
        let currentPressure = s.accumulated_pressure || 0;
        let momentum = currentPressure; 

        // --- 核心模拟循环 (v3.7 机构显形版) ---
        // 1. 相位偏移 (保持不变)
        let charSum = 0;
        for(let c=0; c<sym.length; c++) charSum += sym.charCodeAt(c);
        const phaseOffset = charSum * 100000; 
        const evaSensitivity = 0.5 + ((charSum % 10) / 10) + 0.2; 

        for (let i = 0; i < missed; i++) {
            simT += 60000;
            const isCatchUp = (i < missed - 1); 

            const valuation = curP / issuePrice;
            
            // 宏观 Buff
            let eraBias = 1.0;
            const buffKey = sym.toLowerCase() + '_bias';
            if (currentEra.buff[buffKey]) eraBias = currentEra.buff[buffKey];

            // 动态深度 (不对称回归)
            let buyBase = 0.005; 
            let sellBase = 0.005;
            const dynamicLiq = Math.min(5.0, 1 + (Math.abs(currentPressure) / 5000));
            buyBase *= dynamicLiq;
            sellBase *= dynamicLiq;

            if (valuation < 0.9) {
                const discount = 1.0 - valuation; 
                buyBase *= (1 + discount * 2);    
                sellBase *= (1 - discount * 0.5); 
            } else if (valuation > 1.5) {
                const premium = valuation - 1.5;
                buyBase *= (1 - premium * 0.2);
                sellBase *= (1 + premium * 0.5);
            }

            let buyDepth = totalShares * buyBase * mode.depth_mod * eraBias;
            let sellDepth = totalShares * sellBase * mode.depth_mod * eraBias;
            let newsMsg = null;

            // --- 新闻事件 ---
            if (!isCatchUp && (simT - nextNewsT >= 300000)) { 
                if (Math.random() < 0.05) { 
                    nextNewsT = simT;
                    const news = pickWeightedNews(sym);
                    if (news) {
                        newsMsg = news;
                        if (news.factor > 1) { buyDepth *= news.factor; sellDepth *= (1 / news.factor); } 
                        else { sellDepth *= (1 / news.factor); buyDepth *= news.factor; }
                    }
                }
            }

            // --- 机器人交易 (v3.7 修复：增加惯性 + 写入日志) ---
            let botAction = 'none'; // 记录机器人动作
            
            if (!newsMsg) { 
                let botSentiment = 0; 
                let valueBias = (1.0 - valuation) * 0.6; 
                
                if (currentEra.code === 'DATA_CRASH') valueBias -= 0.15; 
                if (currentEra.code === 'CORP_WAR' && sym !== 'RED') valueBias -= 0.1;
                
                // [优化] 呼吸波权重增加，减少随机抖动
                const trendWave = Math.sin((simT + phaseOffset) / 600000); 
                botSentiment += valueBias + (trendWave * 0.4); // 权重 0.25 -> 0.4

                // [优化] 随机扰动减小，平滑锯齿
                botSentiment += (Math.random() - 0.5) * 0.1; 

                if (Math.abs(botSentiment) > 0.1) { // 阈值 0.05 -> 0.1 (减少无效微操)
                    const direction = botSentiment > 0 ? 1 : -1;
                    const intensity = Math.min(2.0, Math.abs(botSentiment));
                    // 机器人力度
                    const botVol = direction * totalShares * (0.005 * dynamicLiq + Math.random() * 0.005) * intensity;
                    
                    if (botVol > 0) {
                        buyDepth += botVol;
                        botAction = 'buy';
                    } else {
                        sellDepth += Math.abs(botVol);
                        botAction = 'sell';
                    }
                }
            }

            // --- 写入机器人日志 (Bot Log) ---
            // 为了不刷屏，只有 5% 的概率记录机器人的操作，且只记录非追赶阶段
            if (!isCatchUp && botAction !== 'none' && Math.random() < 0.05) {
                const actionText = botAction === 'buy' ? '大笔买入' : '高位抛售';
                const typeText = botAction === 'buy' ? 'good' : 'bad'; // 绿色或红色
                logsToWrite.push({
                    sym: sym, 
                    msg: `[机构异动] 监测到主力资金正在${actionText}...`, 
                    type: typeText, 
                    t: simT
                });
            }

            // --- 用户积压订单 ---
            if (i === 0) {
                if (currentPressure > 0) buyDepth += currentPressure;
                else sellDepth += Math.abs(currentPressure);
            }
            
            // --- 动量衰减 ---
            if (Math.abs(momentum) > 10) {
                if (momentum > 0) buyDepth += momentum;
                else sellDepth += Math.abs(momentum);
                momentum = Math.floor(momentum * 0.7); 
            }

            let evaForce = evaBias; 
            const hour = new Date(simT).getUTCHours();
            const isNight = (hour >= 16 || hour <= 2); 
            if (isNight) evaForce -= 0.001;

            // --- 价格计算 ---
            const volatilityFactor = 35.0 * currentEra.buff.vol * Math.sqrt(dynamicLiq) * evaVolMod;
            const adjustedEvaForce = evaForce * evaSensitivity;

            const delta = ((buyDepth - sellDepth) / totalShares * volatilityFactor) + adjustedEvaForce;
            const clampedDelta = Math.max(-0.06, Math.min(0.06, delta)); 
            
            // [优化] 进一步降低横盘时的底噪，消除"细密锯齿"
            let noiseBase = 0.005; 
            if (Math.abs(clampedDelta) < 0.002) noiseBase = 0.001; // 极静
            
            const noise = (Math.random() - 0.5) * noiseBase;
            
            curP = Math.max(1, Math.round(curP * (1 + clampedDelta + noise)));

            // --- 日志与破产判定 ---
            if (newsMsg) logsToWrite.push({sym, msg: `[${STOCKS_CONFIG[sym].name}] ${newsMsg.msg}`, type: newsMsg.factor > 1 ? 'good' : 'bad', t: simT});

            if (curP < issuePrice * BANKRUPT_PCT) {
                const refundRate = 0.3; 
                updates.push(db.prepare(`UPDATE user_companies SET capital = capital + (SELECT IFNULL(SUM(amount * avg_price * ?), 0) FROM company_positions WHERE company_positions.company_id = user_companies.id AND company_positions.stock_symbol = ?) WHERE id IN (SELECT company_id FROM company_positions WHERE stock_symbol = ?)`).bind(refundRate, sym, sym));
                updates.push(db.prepare("DELETE FROM company_positions WHERE stock_symbol = ?").bind(sym));
                updates.push(db.prepare("UPDATE market_state SET current_price=?, is_suspended=1, last_update=? WHERE symbol=?").bind(curP, simT, sym));
                updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, curP, simT));
                logsToWrite.push({sym, msg: `【破产】股价击穿红线，强制退市。`, type: 'bad', t: simT});
                if (Math.random() < 0.02) {
                    const evaTemplates = [
                        "检测到局部网络熵增，建议检查防火墙。",
                        "人类的贪婪是永恒的算法漏洞。",
                        "正在校准全服波动率... [CALIBRATING]",
                        "警告：神经云层级出现未知数据波动。"
                    ];
                    const msg = evaTemplates[Math.floor(Math.random() * evaTemplates.length)];
                    logsToWrite.push({sym: 'SYSTEM', msg: `[EVA] ${msg}`, type: 'eva', t: simT});
                }
                marketMap[sym].suspended = 1; marketMap[sym].p = curP;
                break;
            }
            updates.push(db.prepare("INSERT INTO market_history (symbol, price, created_at) VALUES (?, ?, ?)").bind(sym, curP, simT));
        }
        // --- 结束替换 ---

        if (marketMap[sym].suspended !== 1) {
            updates.push(db.prepare("UPDATE market_state SET current_price=?, last_update=?, last_news_time=?, accumulated_pressure=0 WHERE symbol=?").bind(curP, simT, nextNewsT, sym));
            marketMap[sym].p = curP; marketMap[sym].t = simT; marketMap[sym].pressure = 0;
        }
    }

    logsToWrite.forEach(l => updates.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(l.sym, l.msg, l.type, l.t)));
    
    if (Math.random() < 0.05) {
        const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);
        const oneDayAgo = now - (24 * 60 * 60 * 1000);
        
        updates.push(
            // 1. 清理 K 线：只保留最近 3 天的分钟数据
            db.prepare("DELETE FROM market_history WHERE created_at < ?").bind(threeDaysAgo),
            
            // 2. 清理日志：只保留最近 24 小时的动态 (防止日志表无限膨胀)
            db.prepare("DELETE FROM market_logs WHERE created_at < ?").bind(oneDayAgo)
        );
    }

    if (updates.length > 0) await db.batch(updates);

    const result = { 
        market: marketMap, 
        status: { isOpen: !isMarketClosed }, 
        era: currentEra, 
        eva: evaState // <--- 必须有这一行！
    };
    
    if (env.KV) {
        // 1. 更新缓存
        await env.KV.put(CACHE_KEY, JSON.stringify({ timestamp: now, payload: result }), { expirationTtl: 60 });
        
        // 2. 🚨 核心修复：计算完成，立刻把锁删掉！
        // 只有删了锁，前端的下一次轮询才能拿到最新的数据。
        await env.KV.delete(LOCK_KEY); 
    }
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
            // ✅ 加上了 users.forge_levels
            user = await db.prepare('SELECT users.id, users.coins, users.k_coins, users.xp, users.username, users.nickname, users.role, users.insider_exp, users.stock_buff_exp, users.tech_levels, users.forge_levels FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
        } catch (e) {
            // ✅ 加上了 users.forge_levels
            user = await db.prepare('SELECT users.id, users.coins, users.k_coins, users.xp, users.username, users.nickname, users.role, users.insider_exp, users.stock_buff_exp, users.tech_levels, users.forge_levels FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
            if (user) user.role = 'user';
        }
        if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

        const company = await db.prepare("SELECT * FROM user_companies WHERE user_id = ?").bind(user.id).first();
        const method = request.method;
        const { market, status, era, eva } = await getOrUpdateMarket(env, db);

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

                let currentMarginRate = 1.0;
                if (COMPANY_LEVELS[companyLevel]) {
                    currentMarginRate = COMPANY_LEVELS[companyLevel].margin;
                }
                for (const pos of positions) {
                    if (!market[pos.stock_symbol] || !market[pos.stock_symbol].p) {
                        isDataValid = false;
                        break; 
                    }
                    const currentP = market[pos.stock_symbol].p;
                    
                    // 传入 currentMarginRate
                    tempEquity += calculatePositionValue(pos, currentP, currentMarginRate);
                    
                    if (pos.leverage > 1 || pos.amount < 0) hasLeverage = true;
                }

                if (isDataValid) {
                    totalEquity = tempEquity;
                    const bankruptLine = -100; 
                    
                    // === 🛡️ 破产保险 (30% 返还) ===
                    if (totalEquity <= bankruptLine && hasLeverage) {
                        // 计算历史升级花费
                        const totalKCost = calculateTotalUpgradeCost(companyLevel);
                        const refundK = Math.floor(totalKCost * 0.3);
                        
                        const updates = [
                            db.prepare("DELETE FROM user_companies WHERE id = ?").bind(company.id),
                            db.prepare("DELETE FROM company_positions WHERE company_id = ?").bind(company.id)
                        ];
                        
                        let msg = `公司资不抵债 (净值 ${Math.floor(totalEquity)})，触发强制清算。`;
                        if (refundK > 0) {
                            updates.push(db.prepare("UPDATE users SET k_coins = k_coins + ? WHERE id = ?").bind(refundK, user.id));
                            msg += ` [保险生效] 返还天赋投资: ${refundK} K币`;
                        }
                        
                        await db.batch(updates);
                        // ... (前文代码: chartData, stockMeta 等准备工作)

                        // === v3.5 神经链接预测 (Neural Link Logic) ===
                        // 只有拥有 Buff 的用户才能看到这一段 "privileged_info"
                        const now = Date.now();
                        const buffActive = (user.stock_buff_exp || 0) > now;
                        let prediction = null;
            
                        if (buffActive) {
                            // 计算剩余时间 (秒)
                            const timeLeft = Math.floor(((user.stock_buff_exp || 0) - now) / 1000);
                            
                            // 针对每一只股票，计算“内幕概率”
                            prediction = {};
                            for (let sym in market) {
                                const m = market[sym];
                                // 获取隐藏参数：累积压力 (玩家买卖盘)
                                const pressure = m.pressure || 0;
                                
                                // 获取当前纪元对该股票的 Buff (Era Bias)
                                let eraBias = 1.0;
                                const buffKey = sym.toLowerCase() + '_bias';
                                if (era && era.buff && era.buff[buffKey]) eraBias = era.buff[buffKey];
                                
                                // 模拟简单的趋势预测算法
                                // 逻辑：(压力方向 + 宏观偏好) -> 转化为 0~100% 的看涨概率
                                // 基础分 50分
                                let score = 50;
                                
                                // 1. 资金面得分 (压力)
                                // 每 5000 股净买入 +10分
                                score += (pressure / 5000) * 10;
                                
                                // 2. 宏观面得分
                                if (eraBias > 1.0) score += 15; // 利好板块 +15%
                                else if (eraBias < 1.0) score -= 15; // 利空板块 -15%
                                
                                // 3. 估值回归得分
                                const val = m.p / m.issue_p;
                                if (val < 0.8) score += 10; // 超跌反弹
                                if (val > 1.5) score -= 10; // 恐高回调
            
                                // 限制在 10% - 90% 之间 (不做绝对承诺)
                                score = Math.max(10, Math.min(90, Math.round(score)));
                                
                                prediction[sym] = {
                                    prob: score, // 看涨概率
                                    trend: score > 50 ? 'UP' : (score < 50 ? 'DOWN' : 'FLAT')
                                };
                            }
                            // 附加剩余时间
                            prediction.timeLeft = timeLeft;
                        }
                        // ============================================
            
                        // 修改 Return，把 prediction 加进去
                        return Response.json({ 
                            success: true, 
                            hasCompany, 
                            bankrupt: false, 
                            market: chartData, 
                            meta: stockMeta, 
                            news: logs, 
                            positions, 
                            capital: hasCompany ? company.capital : 0, 
                            totalEquity: totalEquity, 
                            companyType: hasCompany ? company.type : 'none', 
                            companyLevel: companyLevel, 
                            userK: user.k_coins || 0, 
                            userExp: user.xp || 0, 
                            status, 
                            era, 
                            isInsider, 
                            prediction: prediction,
                            eva: eva,
                            serverTime: Date.now(),
                            techs: JSON.parse(user.tech_levels || '{}')
                        });
                    }
                }
            }
            // === 1. 准备 K线图数据 (chartData) ===
            const chartData = {}; 
            const stockMeta = {};
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

            // === 2. 准备日志数据 ===
            const logsRes = await db.prepare("SELECT * FROM market_logs WHERE created_at < ? ORDER BY created_at DESC LIMIT 20").bind(Date.now()).all();
            const logs = logsRes.results.map(l => ({ time: l.created_at, msg: l.msg, type: l.type }));

            // === 3. 神经链接预测逻辑 (从破产逻辑里移出来的) ===
            const now = Date.now();
            const buffActive = (user.stock_buff_exp || 0) > now;
            let prediction = null;

            if (buffActive) {
                const timeLeft = Math.floor(((user.stock_buff_exp || 0) - now) / 1000);
                prediction = {};
                prediction.timeLeft = timeLeft;
                
                for (let sym in market) {
                    const m = market[sym];
                    const pressure = m.pressure || 0;
                    
                    let eraBias = 1.0;
                    const buffKey = sym.toLowerCase() + '_bias';
                    if (era && era.buff && era.buff[buffKey]) eraBias = era.buff[buffKey];
                    
                    let score = 50;
                    score += (pressure / 5000) * 10;
                    if (eraBias > 1.0) score += 15;
                    else if (eraBias < 1.0) score -= 15;
                    
                    const val = m.p / m.issue_p;
                    if (val < 0.8) score += 10;
                    if (val > 1.5) score -= 10;

                    score = Math.max(10, Math.min(90, Math.round(score)));
                    
                    prediction[sym] = {
                        prob: score,
                        trend: score > 50 ? 'UP' : (score < 50 ? 'DOWN' : 'FLAT')
                    };
                }
            }

            // === 4. 最终返回 (补全了 eva 和 prediction) ===
            return Response.json({ 
                success: true, 
                hasCompany, 
                bankrupt: false, 
                market: chartData, 
                meta: stockMeta, 
                news: logs, 
                positions, 
                capital: hasCompany ? company.capital : 0, 
                totalEquity: totalEquity, 
                companyType: hasCompany ? company.type : 'none', 
                companyLevel: companyLevel, 
                userK: user.k_coins || 0, 
                userExp: user.xp || 0, 
                status, 
                era, 
                isInsider, 
                
                // 👇 这两行是你之前缺失的 👇
                eva: eva,           
                prediction: prediction 
            });
        }

        if (method === 'POST') {
            const body = await request.json();
            const { action, symbol, amount, leverage = 1 } = body;
            const userNameDisplay = user.nickname || user.username;

            // ... POST Action 保持不变 ...
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
                if ((user.k_coins || 0) < 2000) return Response.json({ error: 'k币不足' });
                const initStrat = JSON.stringify({ risk: 'normal', level: 1 }); // 初始 Lv.1
                await db.batch([
                    db.prepare("UPDATE users SET k_coins = k_coins - ? WHERE id = ?").bind(2000, user.id),
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
                let lev = parseInt(leverage); // 这里用 let，方便修正
                if (isNaN(qty) || qty <= 0) return Response.json({ error: '数量无效' });
                if (!Number.isInteger(qty)) return Response.json({ error: '必须为整数' });
                
                // 强制校验杠杆倍率白名单 (防止脚本修改 HTML 提交 x100)
                const ALLOWED_LEVERAGE = [1, 2, 5, 10];
                if (!ALLOWED_LEVERAGE.includes(lev)) {
                    lev = 1; // 非法杠杆强制降为 1倍
                }
                const BATCH_QUOTA = 10000; 

                const curP = market[symbol].p;
                const totalShares = market[symbol].shares;
                const pos = await db.prepare("SELECT * FROM company_positions WHERE company_id = ? AND stock_symbol = ?").bind(company.id, symbol).first();
                
                const lastTrade = pos ? (pos.last_trade_time || 0) : 0;
                const lastType = pos ? (pos.last_trade_type || '') : ''; 
                let currentAccVol = pos ? (pos.accumulated_volume || 0) : 0;
                const now = Date.now();
                const timeDiff = now - lastTrade;

                // === 应用天赋 Buff ===
                const currentLvConf = COMPANY_LEVELS[companyLevel] || COMPANY_LEVELS[0];
                const finalCooldown = BASE_TRADE_COOLDOWN * currentLvConf.cd; // 冷却缩减

                // === 1. 计算基础费率 (基于公司等级) ===
                // 注意：这里必须用 let，因为后面我们要修改它
                let finalFeeRate = BASE_FEE_RATE * currentLvConf.fee;       

                // === 2. 应用【硬件锻造】Buff (量子嗅探) ===
                const uForge = await db.prepare("SELECT forge_levels FROM users WHERE id=?").bind(user.id).first();
                let forgeLv = {};
                try {
                    forgeLv = uForge && uForge.forge_levels ? JSON.parse(uForge.forge_levels) : {};
                } catch(e) { forgeLv = {}; }
                const snifferLv = forgeLv['sniffer'] || 0;

                // 叠加折扣：每级减少 0.1% (0.001)
                if (snifferLv > 0) {
                    finalFeeRate = finalFeeRate - (snifferLv * 0.001);
                }

                // 保底机制：费率最低不能低于 0.1%
                if (finalFeeRate < 0.001) finalFeeRate = 0.001;

                // === 3. 继续后续计算 ===
                const finalMaxHoldPct = BASE_MAX_HOLDING_PCT * currentLvConf.hold;
                if (timeDiff >= finalCooldown) {
                    currentAccVol = 0; 
                } else {
                    if (action !== lastType) {
                        const left = Math.ceil((finalCooldown - timeDiff) / 1000);
                        return Response.json({ error: `反向操作需等待 ${left} 秒` });
                    }
                    if (currentAccVol + qty > BATCH_QUOTA) {
                        const remaining = Math.max(0, BATCH_QUOTA - currentAccVol);
                        const left = Math.ceil((finalCooldown - timeDiff) / 1000);
                        return Response.json({ error: `频繁操作超额！批次剩余 ${remaining} (冷却 ${left}s)` });
                    }
                }
                const newAccVol = currentAccVol + qty;

                const finalShortHold = SHORT_HOLD_MIN * currentLvConf.cd;
                if (action === 'cover') {
                    if (timeDiff < finalShortHold && currentAccVol === 0) { } 
                    else if (timeDiff < finalShortHold) { return Response.json({ error: `做空需锁仓 ${Math.ceil(finalShortHold/1000)} 秒` }); }
                }

                const currentHold = pos ? Math.abs(pos.amount) : 0;
                const maxHoldingShares = Math.floor(totalShares * finalMaxHoldPct);
                if (action !== 'cover' && action !== 'sell' && (currentHold + qty) > maxHoldingShares) {
                    return Response.json({ error: `持仓超限！当前等级上限: ${maxHoldingShares} 股` });
                }
                
                if (qty > totalShares * MAX_ORDER_PCT) {
                    return Response.json({ error: `单笔过大！限额 ${Math.floor(totalShares * MAX_ORDER_PCT)} 股` });
                }

                if (action === 'sell' && (!pos || pos.amount <= 0)) {
                    const issuePrice = market[symbol].issue_p;
                    if (curP < issuePrice * 0.3) return Response.json({ error: '股价过低，禁止做空' });
                }

                const marginRate = currentLvConf.margin; 
                const curHoldPos = pos ? pos.amount : 0;
                const batch = [];
                let logMsg = "";

                const slippage = (qty / totalShares) * 5; 
                const feeRate = finalFeeRate + slippage; 
                const orderVal = curP * qty;
                const fee = Math.floor(orderVal * feeRate);

                if (action === 'buy') {
                    const margin = Math.floor((curP * qty) / lev * marginRate);
                    const totalCost = margin + fee;
                    if (company.capital < totalCost) return Response.json({ error: `公司账户余额不足 (需 ${totalCost} i, 含税)` });
                    if (pos && curHoldPos < 0) return Response.json({ error: '请先平空' });
                    
                    batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(totalCost, company.id));
                    if (pos) {
                        const totalVal = (curHoldPos * pos.avg_price) + (qty * curP);
                        const newQty = curHoldPos + qty;
                        const newAvg = totalVal / newQty;
                        batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=?, last_trade_time=?, last_trade_type=?, accumulated_volume=? WHERE id=?").bind(newQty, newAvg, lev, now, action, newAccVol, pos.id));
                    } else {
                        batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage, last_trade_time, last_trade_type, accumulated_volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(company.id, symbol, qty, curP, lev, now, action, newAccVol));
                    }
                    const tradeValue = curP * qty;
                    let icon = lev > 1 ? '🔥' : '🐂';
                    if (tradeValue > 1000000) icon = '🐋'; // 交易额 > 100万显示鲸鱼
                    
                    logMsg = `${icon} [${userNameDisplay}] 买入 ${qty.toLocaleString()} 股 ${symbol}`;
                    if (lev > 1) logMsg += ` (x${lev})`;
                    
                    // 如果是巨鲸交易，额外插入一条高权重的日志，确保它停留在列表中
                    if (tradeValue > 5000000) { // 500万以上
                         batch.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(symbol, `🚨 监测到巨鲸资金进场！`, 'good', now));
                    }
                    batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure + ? WHERE symbol = ?").bind(qty, symbol));
                }
                else if (action === 'sell') {
                    if (curHoldPos <= 0) { 
                        const margin = Math.floor((curP * qty) / lev * marginRate);
                        const totalCost = margin + fee;
                        if (company.capital < totalCost) return Response.json({ error: `公司账户余额不足 (需 ${totalCost} i, 含税)` });
                        
                        batch.push(db.prepare("UPDATE user_companies SET capital = capital - ? WHERE id = ?").bind(totalCost, company.id));
                        if (pos) {
                            const totalVal = (Math.abs(curHoldPos) * pos.avg_price) + (qty * curP);
                            const newQty = Math.abs(curHoldPos) + qty;
                            const newAvg = totalVal / newQty;
                            batch.push(db.prepare("UPDATE company_positions SET amount=?, avg_price=?, leverage=?, last_trade_time=?, last_trade_type=?, accumulated_volume=? WHERE id=?").bind(-newQty, newAvg, lev, now, action, newAccVol, pos.id));
                        } else {
                            batch.push(db.prepare("INSERT INTO company_positions (company_id, stock_symbol, amount, avg_price, leverage, last_trade_time, last_trade_type, accumulated_volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(company.id, symbol, -qty, curP, lev, now, action, newAccVol));
                        }
                        logMsg = `[${userNameDisplay}] 做空 ${qty} 股 ${symbol} (x${lev})`;
                        batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure - ? WHERE symbol = ?").bind(qty, symbol));
                    } else { 
                        if (qty > curHoldPos) return Response.json({ error: '持仓不足' });
                        const prin = (pos.avg_price * qty) / pos.leverage * marginRate;
                        const prof = (curP - pos.avg_price) * qty;
                        const ret = Math.floor(prin + prof - fee);
                        batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(ret, company.id));
                        if (qty === curHoldPos) batch.push(db.prepare("DELETE FROM company_positions WHERE id=?").bind(pos.id));
                        else batch.push(db.prepare("UPDATE company_positions SET amount=amount-?, last_trade_time=?, last_trade_type=?, accumulated_volume=? WHERE id=?").bind(qty, now, action, newAccVol, pos.id));
                        logMsg = `[${userNameDisplay}] 卖出 ${qty} 股 ${symbol}`;
                        batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure - ? WHERE symbol = ?").bind(qty, symbol));
                    }
                }
                else if (action === 'cover') { 
                    if (curHoldPos >= 0) return Response.json({ error: '无空单' });
                    if (qty > Math.abs(curHoldPos)) return Response.json({ error: '超出持仓' });
                    const prin = (pos.avg_price * qty) / pos.leverage * marginRate;
                    const prof = (pos.avg_price - curP) * qty; 
                    const ret = Math.floor(prin + prof - fee);
                    batch.push(db.prepare("UPDATE user_companies SET capital = capital + ? WHERE id = ?").bind(ret, company.id));
                    if (qty === Math.abs(curHoldPos)) batch.push(db.prepare("DELETE FROM company_positions WHERE id=?").bind(pos.id));
                    else batch.push(db.prepare("UPDATE company_positions SET amount=amount+?, last_trade_time=?, last_trade_type=?, accumulated_volume=? WHERE id=?").bind(qty, now, action, newAccVol, pos.id));
                    logMsg = `[${userNameDisplay}] 平空 ${qty} 股 ${symbol}`;
                    batch.push(db.prepare("UPDATE market_state SET accumulated_pressure = accumulated_pressure + ? WHERE symbol = ?").bind(qty, symbol));
                }

                batch.push(db.prepare("INSERT INTO market_logs (symbol, msg, type, created_at) VALUES (?, ?, ?, ?)").bind(symbol, logMsg, 'user', Date.now()));
                await db.batch(batch);
                if (env.KV) await env.KV.delete(CURRENT_CACHE_KEY);
                return Response.json({ success: true, message: `交易成功 (滑点费率 ${(feeRate*100).toFixed(2)}%)`, log: logMsg });
            }

            if (action === 'upgrade_tech') {
                const { techId } = body;
                const TECH_CONFIG = {
                    'overclock': { name: '神经超频', desc: '挂机算力 +5%', costBase: 1000, costMult: 1.5, maxLv: 20 },
                    'scanner':   { name: '量子嗅探', desc: '股市手续费 -1%', costBase: 5000, costMult: 2.0, maxLv: 10 },
                    'firewall':  { name: '逻辑硬化', desc: '被动 i币产出 +5%', costBase: 2000, costMult: 1.4, maxLv: 20 }
                };
                
                if (!TECH_CONFIG[techId]) return Response.json({ error: '未知科技' });
                
                const currentTechs = JSON.parse(user.tech_levels || '{}');
                const curLv = currentTechs[techId] || 0;
                const conf = TECH_CONFIG[techId];
                
                if (curLv >= conf.maxLv) return Response.json({ error: '已达最高等级' });
                
                const cost = Math.floor(conf.costBase * Math.pow(conf.costMult, curLv));
                
                if ((user.k_coins || 0) < cost) return Response.json({ error: `K币不足 (需 ${cost})` });
                
                // 扣费 & 升级
                currentTechs[techId] = curLv + 1;
                await db.prepare("UPDATE users SET k_coins = k_coins - ?, tech_levels = ? WHERE id = ?")
                    .bind(cost, JSON.stringify(currentTechs), user.id).run();
                    
                return Response.json({ success: true, message: `研发成功：${conf.name} Lv.${curLv + 1}`, level: curLv + 1 });
            }

            // Action: 硬件锻造 (移入 Stock 核心，保障事务安全)
            if (action === 'upgrade_forge') {
                const { type } = body;
                const FORGE_CONFIG = {
                    'overclock': { name: '神经超频', base_cost: 1000, max: 50 },
                    'sniffer':   { name: '量子嗅探', base_cost: 5000, max: 10 },
                    'hardening': { name: '逻辑硬化', base_cost: 2000, max: 20 }
                };
                
                const conf = FORGE_CONFIG[type];
                if (!conf) return Response.json({ error: '未知硬件' });

                const currentForge = JSON.parse(user.forge_levels || '{}');
                const curLv = currentForge[type] || 0;
                
                if (curLv >= conf.max) return Response.json({ error: '已满级' });
                
                // 价格公式：基础 * 1.1^等级
                const cost = Math.floor(conf.base_cost * Math.pow(1.1, curLv));
                
                if ((user.k_coins || 0) < cost) return Response.json({ error: `K币不足 (需 ${cost})` });
                
                // 执行升级
                currentForge[type] = curLv + 1;
                
                // 单条 SQL 更新，原子操作，绝不丢失
                await db.prepare("UPDATE users SET k_coins = k_coins - ?, forge_levels = ? WHERE id = ?")
                    .bind(cost, JSON.stringify(currentForge), user.id).run();
                    
                return Response.json({ success: true, message: `锻造成功！${conf.name} Lv.${curLv + 1}`, level: curLv + 1 });
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
