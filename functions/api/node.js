// --- functions/api/node.js ---

// === 🌌 数字宇宙事件库 (The Digital Universe) ===
// prob: 权重 (越高越容易中)
// type: 结算类型
const EVENTS = [
    // ----------------------------------------------------------------
    // 🟢 [Tier 1] 数据垃圾与日常 (高频，低收益/无收益)
    // ----------------------------------------------------------------
    { type: 'empty',       prob: 80, msg: "扫描完成。这是一片废弃的数据荒原，只有风声。" },
    { type: 'empty',       prob: 70, msg: "连接超时... 目标节点拒绝了握手请求。" },
    { type: 'empty',       prob: 60, msg: "你发现了一个加密文件夹，这只是个 20TB 的猫咪视频缓存。" },
    { type: 'empty',       prob: 60, msg: "接收到一段乱码：'01001000 01001001'，似乎是某种古老的问候。" },
    { type: 'empty',       prob: 50, msg: "遭遇数据迷雾，扫描仪读数归零。" },
    { type: 'empty',       prob: 50, msg: "你看到了其他骇客留下的涂鸦：'Kilroy was here'。" },
    { type: 'empty',       prob: 40, msg: "系统提示：当前扇区已被企业封锁，请立即离开。" },
    { type: 'reward_coin', prob: 100, min: 1, max: 5, msg: "捡到了几个丢失的数据比特，换了点零钱。" },
    { type: 'reward_coin', prob: 100, min: 5, max: 10, msg: "回收了过期的缓存文件，获得少量 i 币。" },
    { type: 'reward_xp',   prob: 100, min: 5, max: 15, msg: "阅读了一份旧报纸的电子版，了解了些许历史。" },
    { type: 'reward_xp',   prob: 100, min: 10, max: 20, msg: "观察了一次数据流的潮汐，若有所思。" },

    // ----------------------------------------------------------------
    // 🔵 [Tier 2] 常规收益 (中频，不错的奖励)
    // ----------------------------------------------------------------
    { type: 'reward_coin', prob: 60, min: 30, max: 60, msg: "破解了一个被遗忘的加密钱包！" },
    { type: 'reward_coin', prob: 50, min: 40, max: 70, msg: "帮助一个流浪 AI 修复了逻辑漏洞，它支付了报酬。" },
    { type: 'reward_coin', prob: 50, min: 50, max: 80, msg: "黑入了一台自动贩卖机，退款成功。" },
    { type: 'reward_coin', prob: 40, min: 60, max: 90, msg: "参与了一次分布式算力挖矿，收益到账。" },
    { type: 'reward_xp',   prob: 60, min: 50, max: 100, msg: "下载了一份《中级骇客指南》，思维升级。" },
    { type: 'reward_xp',   prob: 50, min: 80, max: 120, msg: "接入到了军用级训练模拟器，反应速度提升。" },
    { type: 'reward_xp',   prob: 40, min: 100, max: 150, msg: "通过了图灵测试，你甚至开始怀疑自己是不是人类。" },

    // ----------------------------------------------------------------
    // 🟣 [Tier 3] 稀有奇遇 (低频，高奖励/特殊剧情)
    // ----------------------------------------------------------------
    { type: 'reward_coin', prob: 20, min: 150, max: 250, msg: "🎉 意外截获了巨型企业的避税资金流！大丰收！" },
    { type: 'reward_coin', prob: 15, min: 200, max: 300, msg: "💎 发现了一个未标记的黑市数据节点！" },
    { type: 'reward_xp',   prob: 20, min: 200, max: 300, msg: "🧠 与赛博空间的“幽灵”进行了一次深度对话。" },
    { type: 'reward_xp',   prob: 15, min: 300, max: 400, msg: "⚡ 你的意识短暂飞升，看见了代码的本质。" },
    { type: 'reward_coin', prob: 10, min: 1, max: 1, msg: "收到一条转账备注：'多喝热水'。虽然只有 1 i币，但很暖心。" }, // 恶搞

    // ----------------------------------------------------------------
    // 🎁 [Tier 4] 道具与装备 (让人上瘾的核心)
    // ----------------------------------------------------------------
    { type: 'item', prob: 15, items: ['rename_card'], msg: "在垃圾堆里翻到一张未刮开的【改名卡】。" },
    { type: 'item', prob: 10, items: ['top_card'],    msg: "黑进了广告系统后台，获取管理员权限【置顶卡】！" },
    { type: 'item', prob: 5,  items: ['top_card', 'rename_card'], msg: "破解了走私船的货柜，双重惊喜！" },
    
    // 🔥🔥 传说级掉落：直接送 VIP 🔥🔥
    { type: 'item_vip', prob: 2, days: 7, msg: "🌟🌟🌟 [传说] 你捡到了管理员遗失的【VIP 7天体验卡】！！欧皇附体！" },

    // ----------------------------------------------------------------
    // ⚠️ [Tier 5] 赛博陷阱 (风险与惩罚)
    // ----------------------------------------------------------------
    { type: 'glitch', prob: 40, lose_min: 10, lose_max: 30, msg: "⚠️ 遭遇脚本小子攻击，损失了少量维护费。" },
    { type: 'glitch', prob: 30, lose_min: 30, lose_max: 60, msg: "⚠️ 防火墙过热！必须购买冷却液，资金扣除。" },
    { type: 'glitch', prob: 20, lose_min: 50, lose_max: 100, msg: "⚠️⚠️ 误入蜜罐陷阱！被强制征收了'过路费'。" },
    { type: 'glitch', prob: 10, lose_min: 100, lose_max: 200, msg: "🚨🚨 严重警报！遭遇 NetWatch 追踪，为了销毁痕迹，你烧毁了大量资金！" },
    { type: 'glitch', prob: 5,  lose_min: 1, lose_max: 1, msg: "你点了一份赛博披萨，结果配送员是个病毒。虽然只扣了 1 i币，但很丢人。" },

    // ----------------------------------------------------------------
    // 📜 [Tier 6] 剧情任务 (引导用户去社区互动)
    // ----------------------------------------------------------------
    { type: 'mission', prob: 15, msg: "收到加密频道的求救信号：'这里太冷清了，谁来说句话？'" },
    { type: 'mission', prob: 15, msg: "系统检测到你的存在感过低，建议立即执行交互协议。" },
    { type: 'mission', prob: 10, msg: "赏金猎人公会发布了新的悬赏令！" },

    // ----------------------------------------------------------------
    // 🌌 [Tier 7] 彩蛋与致敬 (Flavor Text Only - 归类为 Empty 但有意思)
    // ----------------------------------------------------------------
    { type: 'empty', prob: 10, msg: "你看到一只白兔在代码中一闪而过... 追上去吗？(Matrix)" },
    { type: 'empty', prob: 10, msg: "你发现了一只折纸独角兽。(Blade Runner)" },
    { type: 'empty', prob: 10, msg: "屏幕上闪过一行字：'Wake up, Samurai.' (Cyberpunk 2077)" },
    { type: 'empty', prob: 10, msg: "系统显示：'42'。这似乎是宇宙的终极答案。(银河系漫游指南)" },
    { type: 'empty', prob: 10, msg: "你听到了微弱的歌声：'Daisy, Daisy...' (2001 太空漫游)" },
    { type: 'empty', prob: 10, msg: "这里有一块墓碑，上面刻着：'RIP Internet Explorer'。" },
    
    // ----------------------------------------------------------------
    // 👑 [Tier 8] 究极奖池 (Jackpot - 极低概率)
    // ----------------------------------------------------------------
    { type: 'reward_coin', prob: 2, min: 888, max: 1000, msg: "🏆 [JACKPOT] 破解了中本聪的私钥碎片！！！财富自由不是梦！" },
    { type: 'reward_xp',   prob: 2, min: 888, max: 1000, msg: "🏆 [JACKPOT] 你的意识上传到了云端，成为了半神！(海量 XP)" }
];

// 加权随机算法
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

    // 2. 检查冷却与费用
    const now = new Date();
    const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const today = utc8.toISOString().split('T')[0];
    const isFree = (user.last_node_explore_date !== today);
    const cost = isFree ? 0 : 50;

    if (!isFree && user.coins < cost) {
        return new Response(JSON.stringify({ success: false, error: `能量不足，需要 ${cost} i币` }), { status: 400 });
    }

    // 3. 准备基础数据变更
    let currentCoins = user.coins - cost;
    let currentXp = user.xp;
    let updates = []; 

    if (cost > 0) {
        updates.push(db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(cost, user.id));
    }
    updates.push(db.prepare('UPDATE users SET last_node_explore_date = ? WHERE id = ?').bind(today, user.id));

    // 4. 执行随机事件
    const event = rollEvent();
    let resultMsg = event.msg;
    
    // === 逻辑分支 ===
    
    // 金币奖励
    if (event.type === 'reward_coin') {
        const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
        updates.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(amount, user.id));
        resultMsg += ` (+${amount} i币)`;
        currentCoins += amount; 
    } 
    // 经验奖励
    else if (event.type === 'reward_xp') {
        const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
        updates.push(db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(amount, user.id));
        resultMsg += ` (XP +${amount})`;
        currentXp += amount; 
    }
    // 故障/扣费
    else if (event.type === 'glitch') {
        let lose = Math.floor(Math.random() * (event.lose_max - event.lose_min + 1)) + event.lose_min;
        if (lose > currentCoins) lose = currentCoins; 
        if (lose > 0) {
            updates.push(db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(lose, user.id));
            resultMsg += ` (损失 ${lose} i币)`;
            currentCoins -= lose; 
        } else {
            resultMsg += " (钱包已空，侥幸逃脱)";
        }
    }
    // 道具掉落
    else if (event.type === 'item') {
        const item = event.items[Math.floor(Math.random() * event.items.length)];
        const existing = await db.prepare('SELECT id FROM user_items WHERE user_id = ? AND item_id = ?').bind(user.id, item).first();
        if (existing) {
            updates.push(db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE id = ?').bind(existing.id));
        } else {
            updates.push(db.prepare('INSERT INTO user_items (user_id, item_id, category, quantity, created_at) VALUES (?, ?, ?, 1, ?)').bind(user.id, item, 'consumable', Date.now()));
        }
        const nameMap = {'rename_card': '改名卡', 'top_card': '置顶卡'};
        resultMsg += ` [获得: ${nameMap[item] || item}]`;
    }
    // 🎁 特殊：VIP 掉落
    else if (event.type === 'item_vip') {
        // 直接修改 users 表
        let newExpire = Date.now();
        if (user.vip_expires_at > newExpire) newExpire = user.vip_expires_at + (event.days * 86400 * 1000);
        else newExpire = newExpire + (event.days * 86400 * 1000);
        
        updates.push(db.prepare('UPDATE users SET is_vip = 1, vip_expires_at = ? WHERE id = ?').bind(newExpire, user.id));
    }
    // 任务触发
    else if (event.type === 'mission') {
        // 随机发一个任务
        const tasks = [
            {code: 'node_post_1', desc: '紧急任务：发布 1 条情报 (帖子)', target: 1, xp: 100, coin: 50},
            {code: 'node_like_10', desc: '紧急任务：校准 10 个数据点 (点赞)', target: 10, xp: 80, coin: 40},
            {code: 'node_comment_5', desc: '紧急任务：建立 5 次神经连接 (评论)', target: 5, xp: 120, coin: 60}
        ];
        const t = tasks[Math.floor(Math.random() * tasks.length)];
        const periodKey = `mission_${Date.now()}`;
        
        updates.push(db.prepare(`
            INSERT INTO user_tasks (user_id, task_code, category, description, target, reward_xp, reward_coins, period_key, status, created_at) 
            VALUES (?, ?, 'node_mission', ?, ?, ?, ?, ?, 0, ?)
        `).bind(user.id, t.code, t.desc, t.target, t.xp, t.coin, periodKey, Date.now()));
        
        resultMsg += ` [触发任务]`;
    }

    // 执行所有数据库操作
    if (updates.length > 0) await db.batch(updates);

    // 5. 返回数据
    return new Response(JSON.stringify({ 
        success: true, 
        message: resultMsg, 
        type: event.type,
        new_coins: currentCoins,
        new_xp: currentXp
    }));
}
