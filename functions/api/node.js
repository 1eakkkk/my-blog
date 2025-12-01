// --- functions/api/node.js ---

// ==========================================
// 🌌 N.O.D.E 数字宇宙 - 完整事件库 (60+ Events)
// ==========================================
// rarity 对应前端特效:
// 'common' (灰/绿) | 'rare' (蓝光) | 'epic' (紫光+全服广播) 
// 'legendary' (金光+震屏+全服广播) | 'glitch' (红光故障)
// ==========================================

const EVENTS = [
    // ----------------------------------------------------------------
    // ⚪ [Tier 1] 氛围组与垃圾数据 (Empty/Flavor)
    // ----------------------------------------------------------------
    { rarity: 'common', prob: 50, type: 'empty', msg: "扫描完成。这是一片废弃的数据荒原，只有风声。" },
    { rarity: 'common', prob: 50, type: 'empty', msg: "连接超时... 目标节点拒绝了握手请求 (403 Forbidden)。" },
    { rarity: 'common', prob: 50, type: 'empty', msg: "你发现了一个加密文件夹，破解后发现是 20TB 的猫咪视频。" },
    { rarity: 'common', prob: 50, type: 'empty', msg: "接收到一段二进制乱码：'01001000 01001001'。" },
    { rarity: 'common', prob: 50, type: 'empty', msg: "遭遇数据迷雾，扫描仪读数归零。" },
    { rarity: 'common', prob: 50, type: 'empty', msg: "你看到了前人留下的涂鸦：'Kilroy was here'。" },
    { rarity: 'common', prob: 40, type: 'empty', msg: "系统提示：当前扇区已被 Arasaka 企业封锁，请立即离开。" },
    { rarity: 'common', prob: 40, type: 'empty', msg: "你在数据流中看到了一只折纸独角兽。(Blade Runner)" },
    { rarity: 'common', prob: 30, type: 'empty', msg: "屏幕上闪过一行字：'Wake up, Samurai.' (Cyberpunk 2077)" },
    { rarity: 'common', prob: 30, type: 'empty', msg: "这里有一块墓碑，上面刻着：'RIP Internet Explorer'。" },
    { rarity: 'common', prob: 30, type: 'empty', msg: "你听到了微弱的歌声：'Daisy, Daisy...' (2001 太空漫游)" },
    { rarity: 'common', prob: 30, type: 'empty', msg: "扫描到一个古老的网页，上面写着 '404 Not Found'。" },
    { rarity: 'common', prob: 30, type: 'empty', msg: "你的 AI 助手表示它需要休眠一会，拒绝了工作。" },
    { rarity: 'common', prob: 30, type: 'empty', msg: "这一块区域的数据被物理删除了，只剩下虚无。" },
    { rarity: 'common', prob: 30, type: 'empty', msg: "你感觉到有人在注视着你... 可能是网警。" },
    { rarity: 'common', prob: 40, type: 'empty', msg: "你路过一个静止的数据湖，湖面上映出了你的头像…但眨的不是你的眼。" },
    { rarity: 'common', prob: 30, type: 'empty', msg: "一个穿连帽衫的影子路过你身边，小声说：'别回头。'" },
    { rarity: 'common', prob: 35, type: 'empty', msg: "你收到一条来自未来的消息：'别再点了，会上瘾。'" },
    { rarity: 'common', prob: 50, type: 'empty', msg: "这片节点散发着旧时代论坛的味道，甚至还能闻到表情包的尘味。" },
    { rarity: 'common', prob: 20, type: 'empty', msg: "你遇到一只穿外套的白色小猫，它问你有没有见过‘摩尔定律’。" },
    { rarity: 'common', prob: 30, type: 'empty', msg: "你联系了量子客服，但客服处于既在线又不在线状态，没人回应。" },
    { rarity: 'common', prob: 30, type: 'empty', msg: "谭天一突然开麦唱歌，你大受震撼，但没有收益。" },

    // ----------------------------------------------------------------
    // 🟢 [Tier 2] 日常收益 (Small Rewards)
    // ----------------------------------------------------------------
    { rarity: 'common', prob: 90, type: 'reward_coin', min: 10, max: 50, msg: "捡到了几个丢失的数据比特，换了点零钱。" },
    { rarity: 'common', prob: 90, type: 'reward_coin', min: 25, max: 35, msg: "回收了过期的缓存文件，获得少量 i 币。" },
    { rarity: 'common', prob: 90, type: 'reward_coin', min: 18, max: 42, msg: "帮路过的 AI 指了路，它给了你一点小费。" },
    { rarity: 'common', prob: 70,  type: 'reward_coin', min: 35, max: 58, msg: "在一个旧服务器里刮出了几枚硬币。" },
    { rarity: 'common', prob: 40, type: 'reward_coin', min: 1, max: 2, msg: "你试图忽悠一位赛博大爷升级系统，结果被他反向教育。大爷塞了你一两枚硬币让你走。" },
    { rarity: 'common', prob: 40, type: 'reward_coin', min: 15, max: 45, msg: "你路过一家黑客酒吧，随手写了段酷炫代码，顾客们给了你小费。" },
    { rarity: 'common', prob: 45, type: 'reward_coin', min: 50, max: 100, msg: "节点 AI 今天心情好，它发了你一点零花钱。" },
    
    { rarity: 'common', prob: 100, type: 'reward_xp', min: 20, max: 40, msg: "阅读了一份旧报纸的电子版，了解了些许历史。" },
    { rarity: 'common', prob: 100, type: 'reward_xp', min: 15, max: 55, msg: "观察了一次数据流的潮汐，若有所思。" },
    { rarity: 'common', prob: 100, type: 'reward_xp', min: 25, max: 50, msg: "练习了一次基础代码输入，熟练度提升。" },
    { rarity: 'common', prob: 80,  type: 'reward_xp', min: 60, max: 90, msg: "你的神经植入体完成了一次固件更新。" },
    { rarity: 'common', prob: 75, type: 'reward_xp', min: 10, max: 30, msg: "屏幕突然跳出‘你妈喊你回家吃饭’，你一愣，结果莫名其妙顿悟了点什么。" },
    { rarity: 'common', prob: 80, type: 'reward_xp', min: 20, max: 40, msg: "虚空里传来一句：'兄弟，你账号危险了。' 你被吓得精神力提升了一点。" },
    { rarity: 'common', prob: 50, type: 'reward_xp', min: 15, max: 50, msg: "互联网考古队邀请你一起挖掘 2008 年的网页，你学到了很多古老知识。" },
    { rarity: 'common', prob: 35, type: 'reward_xp', min: 20, max: 40, msg: "系统强制更新，你被迫读了十分钟的更新日志，知识略有增加。" },
    { rarity: 'common', prob: 50, type: 'reward_xp', min: 30, max: 60, msg: "你从回收站里翻出一个 2018 年的梗，比如：鸡你太美，虽然过气但知识就是知识。" },
    

    // ----------------------------------------------------------------
    // 🔵 [Tier 3] 稀有收益 (Rare Rewards)
    // ----------------------------------------------------------------
    { rarity: 'rare', prob: 50, type: 'reward_coin', min: 40, max: 150, msg: "破解了一个被遗忘的加密钱包！" },
    { rarity: 'rare', prob: 50, type: 'reward_coin', min: 65, max: 113, msg: "帮助一个流浪 AI 修复了逻辑漏洞，支付报酬。" },
    { rarity: 'rare', prob: 50, type: 'reward_coin', min: 70, max: 90, msg: "黑入了一台自动贩卖机，成功退款。" },
    { rarity: 'rare', prob: 40, type: 'reward_coin', min: 70, max: 110, msg: "参与了一次分布式算力挖矿，收益到账。" },
    { rarity: 'rare', prob: 15, type: 'reward_coin', min: 1, max: 1, msg: "收到一条转账备注：'多喝热水'。虽然只有 1 i币，但很暖心。" },
    { rarity: 'rare', prob: 45, type: 'reward_coin', min: 100, max: 180, msg: "你回收了一段被删掉的广告预算，得到了一笔可疑的资金。" },
    { rarity: 'rare', prob: 35, type: 'reward_coin', min: 77, max: 177, msg: "你找到了一个被反复复制的 bug，对它征税收了点钱。" },
    { rarity: 'rare', prob: 8, type: 'reward_coin', min: 314, max: 314, msg: "你在深处扫描到了神秘常数 π，它回赠你 314 i币。" },
    { rarity: 'rare', prob: 40, type: 'reward_coin', min: 80, max: 120, msg: "你遇到一个自称来自未来的你。他往你手里塞了点钱，然后跑了。" },
    { rarity: 'rare', prob: 20, type: 'reward_coin', min: 130, max: 180, msg: "诈骗犯给你打电话，你成功反骗了他，对方气得给你打钱。" },
    { rarity: 'rare', prob: 11, type: 'reward_coin', min: 333, max: 666, msg: "一个量子 bug 自行修复后，顺便给你掉了点钱。" },
    
    { rarity: 'rare', prob: 30, type: 'reward_xp', min: 200, max: 260, msg: "你临时接入了一间地下聊天室，偷听别人吵架，经验莫名增加。" },
    { rarity: 'rare', prob: 30, type: 'reward_xp', min: 150, max: 200, msg: "下载了一份《中级骇客指南》，思维升级。" },
    { rarity: 'rare', prob: 25, type: 'reward_xp', min: 180, max: 220, msg: "接入到了军用级训练模拟器，反应速度提升。" },
    { rarity: 'rare', prob: 40, type: 'reward_xp', min: 100, max: 150, msg: "通过了图灵测试，你甚至开始怀疑自己是不是人类。" },
    { rarity: 'rare', prob: 35, type: 'reward_xp', min: 120, max: 180, msg: "你发现了一个未被记录的后门接口。" },
    { rarity: 'rare', prob: 18, type: 'reward_xp', min: 120, max: 220, msg: "你尝试向服务器发送 'sudo give me money'，它居然赏你一点经验。" },
    { rarity: 'rare', prob: 15, type: 'reward_xp', min: 80, max: 120, msg: "你在墙缝里发现别人掉落的一张便条：‘快来社区签到！’" },
    { rarity: 'rare', prob: 25, type: 'reward_xp', min: 120, max: 200, msg: "你意外点击了一份哲学病毒，它不断问你：'什么是自我？' 你获得顿悟。" },
    { rarity: 'rare', prob: 20, type: 'reward_xp', min: 160, max: 220, msg: "你进入一个 10 年没人说话的聊天室，结果听到了自己的回声，精神力提升。" },

    // ----------------------------------------------------------------
    // 🟣 [Tier 4] 史诗奇遇 (Epic - 全服广播) 
    // ----------------------------------------------------------------
    { rarity: 'epic', prob: 20, type: 'reward_coin', min: 350, max: 650, msg: "🎉 意外截获了巨型企业的避税资金流！大丰收！" },
    { rarity: 'epic', prob: 15, type: 'reward_coin', min: 555, max: 888, msg: "💎 发现了一个未标记的黑市数据节点！" },
    
    { rarity: 'epic', prob: 20, type: 'reward_xp', min: 380, max: 720, msg: "🧠 与赛博空间的“幽灵”进行了一次深度对话。" },
    { rarity: 'epic', prob: 15, type: 'reward_xp', min: 666, max: 888, msg: "⚡ 你的意识短暂飞升，看见了代码的本质。" },
    { rarity: 'epic', prob: 8, type: 'reward_xp', min: 404, max: 606, msg: "你追逐一个404的影子，它转身给你讲了一课存在主义。" },

    // 史诗道具
    { rarity: 'epic', prob: 15, type: 'item', items: ['rename_card'], msg: "在数据废墟深处，翻到一张未刮开的【改名卡】。" },
    { rarity: 'epic', prob: 10, type: 'item', items: ['rename_card'], msg: "你抓住了一只跑错目录的小程序，它吓得把改名卡交给你。" },
    { rarity: 'epic', prob: 10, type: 'item', items: ['top_card'],    msg: "黑进了广告系统后台，获取管理员权限【置顶卡】！" },
    { rarity: 'epic', prob: 5,  type: 'item', items: ['top_card', 'rename_card'], msg: "破解了走私船的货柜，双重道具惊喜！" },
    { rarity: 'epic', prob: 15, type: 'item', items: ['broadcast_low'],    msg: "不小心爬到管理员的床上，恳求管理员给了一张基础信标卡！" },
    { rarity: 'epic', prob: 15, type: 'item_vip',    days: 7, msg: "六百六十六！你捡到了管理员不要的【VIP 7天体验卡】！" },

    // ----------------------------------------------------------------
    // 🟡 [Tier 5] 传说大奖 (Legendary - 全服广播) 
    // ----------------------------------------------------------------
    { rarity: 'legendary', prob: 5, type: 'reward_coin', min: 888, max: 1000, msg: "🏆 [JACKPOT] 破解了中本聪的私钥碎片！！！财富自由不是梦！" },
    { rarity: 'legendary', prob: 3, type: 'reward_coin', min: 1017, max: 1128, msg: "管理员周炜杰心情好，发钱了！" },
    { rarity: 'legendary', prob: 5, type: 'reward_coin', min: 666, max: 999, msg: "谭天一炉石上传说了，让我发马内！" },
    { rarity: 'legendary', prob: 5, type: 'reward_xp',   min: 800, max: 1000, msg: "🏆 [JACKPOT] 你的意识上传到了云端核心，成为了半神！" },
    { rarity: 'legendary', prob: 3, type: 'reward_xp',   min: 1201, max: 1230, msg: "纪念今天是2025年12月的第一天~" },
    { rarity: 'legendary', prob: 3, type: 'item_vip',    days: 14, msg: "🌟🌟🌟 [传说] 欧皇附体！你捡到了管理员遗失的【VIP 14天体验卡】！" },
    { rarity: 'legendary', prob: 1, type: 'item_vip',    days: 30, msg: "🌟🌟🌟🌟🌟🌟 [传说] 锦鲤降临！！！你捡到了六百一十五光年之外的【VIP 30天体验卡】！" },
    { rarity: 'legendary', prob: 3, type: 'item', items: ['broadcast_high'],    msg: "[金色传说]你的运气绝无仅有，你在YY-B-0615找到了一张骇客宣言卡！" },

    // ----------------------------------------------------------------
    // 🔴 [Tier 6] 赛博陷阱 (Glitch/Risk)
    // ----------------------------------------------------------------
    { rarity: 'glitch', prob: 40, type: 'glitch', lose_min: 10, lose_max: 30, msg: "⚠️ 遭遇脚本小子攻击，损失了少量维护费。" },
    { rarity: 'glitch', prob: 20, type: 'glitch', lose_min: 30, lose_max: 80, msg: "周炜杰又去零食店采购了，花费颇多。" },
    { rarity: 'glitch', prob: 30, type: 'glitch', lose_min: 30, lose_max: 30, msg: "周文君不小心登录了曾诗杰的王牌竞速账号，给曾诗杰把珍宝自选抽了，被补偿月卡一张。" },
    { rarity: 'glitch', prob: 30, type: 'glitch', lose_min: 30, lose_max: 60, msg: "⚠️ 防火墙过热！必须购买冷却液，资金扣除。" },
    { rarity: 'glitch', prob: 20, type: 'glitch', lose_min: 50, lose_max: 100, msg: "⚠️⚠️ 误入蜜罐陷阱！被强制征收了'过路费'。" },
    { rarity: 'glitch', prob: 5, type: 'glitch', lose_min: 100, lose_max: 200, msg: "🚨🚨 严重警报！遭遇 NetWatch 追踪，为了销毁痕迹，你烧毁了大量资金！" },
    { rarity: 'glitch', prob: 5,  type: 'glitch', lose_min: 1, lose_max: 1, msg: "你点了一份赛博披萨，结果配送员是个病毒。虽然只扣了 1 i币，但很丢人。" },
    { rarity: 'glitch', prob: 5,  type: 'glitch', lose_min: 10, lose_max: 20, msg: "不小心下载了 50G 的流氓软件，花费 i 币清理磁盘。" },
    { rarity: 'glitch', prob: 20, type: 'glitch', lose_min: 30, lose_max: 60, msg: "你误点了暗网弹窗广告，清理痕迹花掉了一些i币。" },
    { rarity: 'glitch', prob: 10, type: 'glitch', lose_min: 80, lose_max: 140, msg: "你的缓存突然被自动加密，解密工具收费，钱包遭殃。" },
    { rarity: 'glitch', prob: 5, type: 'glitch', lose_min: 2, lose_max: 12, msg: "你被一个 AI 要求做 5 秒人机验证，它收你人工操作服务费。" },
    { rarity: 'glitch', prob: 15, type: 'glitch', lose_min: 20, lose_max: 60, msg: "你被“正版软件受害者联盟”拦下，他们检查了你的许可证，收走了些‘保护费’。" },
    { rarity: 'glitch', prob: 8, type: 'glitch', lose_min: 30, lose_max: 90, msg: "调试面板突然弹出并疯狂报错：'变量 undefined'。你为了关掉它，付出了惨痛代价。" },
    { rarity: 'glitch', prob: 10, type: 'glitch', lose_min: 50, lose_max: 120, msg: "你看到未来自己删库跑路的录像，吓得你赶紧买保险，花了不少钱。" },
    { rarity: 'glitch', prob: 25, type: 'glitch', lose_min: 5, lose_max: 30, msg: "你吃了个过期的数据包，结果拉肚子，花钱买药。" },
    { rarity: 'glitch', prob: 10, type: 'glitch', lose_min: 20, lose_max: 100, msg: "你刚打开一个知识库，结果又弹出一个付费墙，你嘲讽地笑了笑，然后付了钱。" },


    // ----------------------------------------------------------------
    // 📜 [Tier 7] 任务触发 (Mission) 
    // ----------------------------------------------------------------
    { rarity: 'rare', prob: 20, type: 'mission', msg: "收到加密频道的求救信号：'这里太冷清了，谁来说句话？'" },
    { rarity: 'rare', prob: 15, type: 'mission', msg: "系统检测到你的存在感过低，建议立即执行交互协议。" },
    { rarity: 'rare', prob: 10, type: 'mission', msg: "赏金猎人公会发布了新的悬赏令！" }
];

// === 核心逻辑代码 ===

function rollEvent() {
    let sum = 0; EVENTS.forEach(e => sum += e.prob);
    let rand = Math.random() * sum;
    for (let e of EVENTS) { if (rand < e.prob) return e; rand -= e.prob; }
    return EVENTS[EVENTS.length - 1];
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ error: '无效会话' }), { status: 401 });

    // === 获取全服日志 (用于跑马灯) ===
    const reqBody = await request.json().catch(()=>({}));
    if (reqBody.action === 'get_logs') {
        // 只查最近的 5 条史诗/传说记录
        const logs = await db.prepare('SELECT * FROM node_public_logs ORDER BY created_at DESC LIMIT 5').all();
        return new Response(JSON.stringify({ success: true, logs: logs.results }));
    }

    // 2. 检查冷却与费用 (探索逻辑)
    const now = Date.now();
    const utc8 = new Date(now + (8 * 60 * 60 * 1000));
    const today = utc8.toISOString().split('T')[0];
    const isFree = (user.last_node_explore_date !== today);
    const cost = isFree ? 0 : 50;

    if (!isFree && user.coins < cost) {
        return new Response(JSON.stringify({ success: false, error: `能量不足，需要 ${cost} i币` }), { status: 400 });
    }

    // 3. 准备基础数据变更（先扣费）
    let currentCoins = user.coins - cost;
    let currentXp = user.xp;
    let updates = []; 

    if (cost > 0) {
        updates.push(db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(cost, user.id));
    }
    // 更新最后探索时间
    updates.push(db.prepare('UPDATE users SET last_node_explore_date = ? WHERE id = ?').bind(today, user.id));

    // 4. 执行随机事件
    const event = rollEvent();
    let resultMsg = event.msg;
    
    // === 详细逻辑处理分支 ===
    
    // 💰 金币奖励
    if (event.type === 'reward_coin') {
        const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
        updates.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(amount, user.id));
        
        // 动态替换文案中的数字，如果文案里没写具体数字，就追加在后面
        if (!resultMsg.includes(amount)) resultMsg += ` (+${amount} i币)`;
        currentCoins += amount; 
    } 
    // 🧠 经验奖励
    else if (event.type === 'reward_xp') {
        const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
        updates.push(db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(amount, user.id));
        
        if (!resultMsg.includes(amount)) resultMsg += ` (XP +${amount})`;
        currentXp += amount; 
    }
    // ⚠️ 故障/扣费
    else if (event.type === 'glitch') {
        let lose = Math.floor(Math.random() * (event.lose_max - event.lose_min + 1)) + event.lose_min;
        // 保护机制：不会扣成负数
        if (lose > currentCoins) lose = currentCoins; 
        
        if (lose > 0) {
            updates.push(db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(lose, user.id));
            resultMsg += ` (损失 ${lose} i币)`;
            currentCoins -= lose; 
        } else {
            resultMsg += " (钱包已空，侥幸逃脱)";
        }
    }
    // 📦 道具掉落
    else if (event.type === 'item') {
        const item = event.items[Math.floor(Math.random() * event.items.length)];
        const existing = await db.prepare('SELECT id FROM user_items WHERE user_id = ? AND item_id = ?').bind(user.id, item).first();
        if (existing) {
            updates.push(db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE id = ?').bind(existing.id));
        } else {
            updates.push(db.prepare('INSERT INTO user_items (user_id, item_id, category, quantity, created_at) VALUES (?, ?, ?, 1, ?)').bind(user.id, item, 'consumable', now));
        }
        // 简单的中文映射
        const nameMap = {'rename_card': '改名卡', 'top_card': '置顶卡'};
        resultMsg += ` [获得: ${nameMap[item] || item}]`;
    }
    // 👑 特殊：VIP 掉落
    else if (event.type === 'item_vip') {
        let newExpire = now;
        if (user.vip_expires_at > newExpire) newExpire = user.vip_expires_at + (event.days * 86400 * 1000);
        else newExpire = newExpire + (event.days * 86400 * 1000);
        
        updates.push(db.prepare('UPDATE users SET is_vip = 1, vip_expires_at = ? WHERE id = ?').bind(newExpire, user.id));
        resultMsg += ` (VIP时长 +${event.days}天)`;
    }
    // 📜 任务触发
    else if (event.type === 'mission') {
        const tasks = [
            {code: 'node_post_1', desc: '紧急任务：发布 1 条情报 (帖子)', target: 1, xp: 100, coin: 50},
            {code: 'node_like_10', desc: '紧急任务：校准 10 个数据点 (点赞)', target: 10, xp: 80, coin: 40},
            {code: 'node_comment_5', desc: '紧急任务：建立 5 次神经连接 (评论)', target: 5, xp: 120, coin: 60}
        ];
        const t = tasks[Math.floor(Math.random() * tasks.length)];
        const periodKey = `mission_${Date.now()}`; // 唯一ID
        
        updates.push(db.prepare(`
            INSERT INTO user_tasks (user_id, task_code, category, description, target, reward_xp, reward_coins, period_key, status, created_at) 
            VALUES (?, ?, 'node_mission', ?, ?, ?, ?, ?, 0, ?)
        `).bind(user.id, t.code, t.desc, t.target, t.xp, t.coin, periodKey, Date.now()));
        
        resultMsg += ` [已接受任务]`;
    }

    // === 5. 全服广播逻辑 ===
    // 如果是 Epic 或 Legendary 事件，记录到公共日志表
    if (event.rarity === 'epic' || event.rarity === 'legendary') {
        const logMsg = `${resultMsg}`; // 简化消息，前端会拼用户名
        updates.push(db.prepare('INSERT INTO node_public_logs (username, event_type, message, created_at) VALUES (?, ?, ?, ?)').bind(user.nickname||user.username, event.rarity, logMsg, now));
    }

    // 6. 执行所有数据库操作
    if (updates.length > 0) await db.batch(updates);

    // 7. 返回结果给前端
    return new Response(JSON.stringify({ 
        success: true, 
        message: resultMsg, 
        rarity: event.rarity, // 前端根据这个显示颜色特效
        type: event.type,
        new_coins: currentCoins,
        new_xp: currentXp
    }));
}
