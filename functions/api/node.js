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
    // ⚪ [Tier 1] 氛围组与垃圾数据 (Empty/Flavor) - 概率权重: 40-80
    // ----------------------------------------------------------------
    { rarity: 'common', prob: 80, type: 'empty', msg: "扫描完成。这是一片废弃的数据荒原，只有风声。" },
    { rarity: 'common', prob: 70, type: 'empty', msg: "连接超时... 目标节点拒绝了握手请求 (403 Forbidden)。" },
    { rarity: 'common', prob: 60, type: 'empty', msg: "你发现了一个加密文件夹，破解后发现是 20TB 的猫咪视频。" },
    { rarity: 'common', prob: 60, type: 'empty', msg: "接收到一段二进制乱码：'01001000 01001001'。" },
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

    // ----------------------------------------------------------------
    // 🟢 [Tier 2] 日常收益 (Small Rewards) - 概率权重: 80-120
    // ----------------------------------------------------------------
    { rarity: 'common', prob: 120, type: 'reward_coin', min: 1, max: 5, msg: "捡到了几个丢失的数据比特，换了点零钱。" },
    { rarity: 'common', prob: 100, type: 'reward_coin', min: 5, max: 15, msg: "回收了过期的缓存文件，获得少量 i 币。" },
    { rarity: 'common', prob: 100, type: 'reward_coin', min: 10, max: 20, msg: "帮路过的 AI 指了路，它给了你一点小费。" },
    { rarity: 'common', prob: 80,  type: 'reward_coin', min: 15, max: 25, msg: "在一个旧服务器里刮出了几枚硬币。" },
    
    { rarity: 'common', prob: 120, type: 'reward_xp', min: 5, max: 15, msg: "阅读了一份旧报纸的电子版，了解了些许历史。" },
    { rarity: 'common', prob: 100, type: 'reward_xp', min: 15, max: 25, msg: "观察了一次数据流的潮汐，若有所思。" },
    { rarity: 'common', prob: 100, type: 'reward_xp', min: 20, max: 30, msg: "练习了一次基础代码输入，熟练度提升。" },
    { rarity: 'common', prob: 80,  type: 'reward_xp', min: 30, max: 40, msg: "你的神经植入体完成了一次固件更新。" },

    // ----------------------------------------------------------------
    // 🔵 [Tier 3] 稀有收益 (Rare Rewards) - 概率权重: 40-60
    // ----------------------------------------------------------------
    { rarity: 'rare', prob: 60, type: 'reward_coin', min: 30, max: 60, msg: "破解了一个被遗忘的加密钱包！" },
    { rarity: 'rare', prob: 50, type: 'reward_coin', min: 40, max: 70, msg: "帮助一个流浪 AI 修复了逻辑漏洞，支付报酬。" },
    { rarity: 'rare', prob: 50, type: 'reward_coin', min: 50, max: 80, msg: "黑入了一台自动贩卖机，成功退款。" },
    { rarity: 'rare', prob: 40, type: 'reward_coin', min: 60, max: 90, msg: "参与了一次分布式算力挖矿，收益到账。" },
    { rarity: 'rare', prob: 10, type: 'reward_coin', min: 1, max: 1, msg: "收到一条转账备注：'多喝热水'。虽然只有 1 i币，但很暖心。" },

    { rarity: 'rare', prob: 60, type: 'reward_xp', min: 50, max: 100, msg: "下载了一份《中级骇客指南》，思维升级。" },
    { rarity: 'rare', prob: 50, type: 'reward_xp', min: 80, max: 120, msg: "接入到了军用级训练模拟器，反应速度提升。" },
    { rarity: 'rare', prob: 40, type: 'reward_xp', min: 100, max: 150, msg: "通过了图灵测试，你甚至开始怀疑自己是不是人类。" },
    { rarity: 'rare', prob: 30, type: 'reward_xp', min: 120, max: 180, msg: "你发现了一个未被记录的后门接口。" },

    // ----------------------------------------------------------------
    // 🟣 [Tier 4] 史诗奇遇 (Epic - 全服广播) - 概率权重: 10-20
    // ----------------------------------------------------------------
    { rarity: 'epic', prob: 20, type: 'reward_coin', min: 150, max: 250, msg: "🎉 意外截获了巨型企业的避税资金流！大丰收！" },
    { rarity: 'epic', prob: 15, type: 'reward_coin', min: 200, max: 300, msg: "💎 发现了一个未标记的黑市数据节点！" },
    
    { rarity: 'epic', prob: 20, type: 'reward_xp', min: 200, max: 300, msg: "🧠 与赛博空间的“幽灵”进行了一次深度对话。" },
    { rarity: 'epic', prob: 15, type: 'reward_xp', min: 300, max: 400, msg: "⚡ 你的意识短暂飞升，看见了代码的本质。" },

    // 史诗道具
    { rarity: 'epic', prob: 15, type: 'item', items: ['rename_card'], msg: "在数据废墟深处，翻到一张未刮开的【改名卡】。" },
    { rarity: 'epic', prob: 10, type: 'item', items: ['top_card'],    msg: "黑进了广告系统后台，获取管理员权限【置顶卡】！" },
    { rarity: 'epic', prob: 5,  type: 'item', items: ['top_card', 'rename_card'], msg: "破解了走私船的货柜，双重道具惊喜！" },

    // ----------------------------------------------------------------
    // 🟡 [Tier 5] 传说大奖 (Legendary - 全服广播) - 概率权重: 2-5
    // ----------------------------------------------------------------
    { rarity: 'legendary', prob: 5, type: 'reward_coin', min: 888, max: 1000, msg: "🏆 [JACKPOT] 破解了中本聪的私钥碎片！！！财富自由不是梦！" },
    { rarity: 'legendary', prob: 5, type: 'reward_xp',   min: 800, max: 1000, msg: "🏆 [JACKPOT] 你的意识上传到了云端核心，成为了半神！" },
    { rarity: 'legendary', prob: 3, type: 'item_vip',    days: 7, msg: "🌟🌟🌟 [传说] 欧皇附体！你捡到了管理员遗失的【VIP 7天体验卡】！" },

    // ----------------------------------------------------------------
    // 🔴 [Tier 6] 赛博陷阱 (Glitch/Risk) - 概率权重: 5-40
    // ----------------------------------------------------------------
    { rarity: 'glitch', prob: 40, type: 'glitch', lose_min: 10, lose_max: 30, msg: "⚠️ 遭遇脚本小子攻击，损失了少量维护费。" },
    { rarity: 'glitch', prob: 30, type: 'glitch', lose_min: 30, lose_max: 60, msg: "⚠️ 防火墙过热！必须购买冷却液，资金扣除。" },
    { rarity: 'glitch', prob: 20, type: 'glitch', lose_min: 50, lose_max: 100, msg: "⚠️⚠️ 误入蜜罐陷阱！被强制征收了'过路费'。" },
    { rarity: 'glitch', prob: 10, type: 'glitch', lose_min: 100, lose_max: 200, msg: "🚨🚨 严重警报！遭遇 NetWatch 追踪，为了销毁痕迹，你烧毁了大量资金！" },
    { rarity: 'glitch', prob: 5,  type: 'glitch', lose_min: 1, lose_max: 1, msg: "你点了一份赛博披萨，结果配送员是个病毒。虽然只扣了 1 i币，但很丢人。" },
    { rarity: 'glitch', prob: 5,  type: 'glitch', lose_min: 10, lose_max: 20, msg: "不小心下载了 50G 的流氓软件，花费 i 币清理磁盘。" },

    // ----------------------------------------------------------------
    // 📜 [Tier 7] 任务触发 (Mission) - 概率权重: 10-20
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
