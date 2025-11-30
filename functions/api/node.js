// --- functions/api/node.js ---

// === 升级版事件库 (带 Rarity) ===
// rarity: 'common'(灰/绿), 'rare'(蓝), 'epic'(紫), 'legendary'(金/彩), 'glitch'(红)
const EVENTS = [
    // --- 🟢 Common (日常) ---
    { rarity: 'common', prob: 80, type: 'empty', msg: "扫描完成。是一片数据荒原。" },
    { rarity: 'common', prob: 100, type: 'reward_coin', min: 5, max: 15, msg: "收集到零散数据，兑换少量 i 币。" },
    { rarity: 'common', prob: 100, type: 'reward_xp', min: 10, max: 20, msg: "阅读了一份旧日志，获得少许经验。" },

    // --- 🔵 Rare (稀有 - 蓝色) ---
    { rarity: 'rare', prob: 60, type: 'reward_coin', min: 30, max: 60, msg: "破解了被遗忘的支付终端！" },
    { rarity: 'rare', prob: 60, type: 'reward_xp', min: 50, max: 100, msg: "连接到高速算力节点，思维加速。" },
    { rarity: 'rare', prob: 20, type: 'item', items: ['rename_card'], msg: "发现一张未使用的【改名卡】。" },

    // --- 🟣 Epic (史诗 - 紫色 - 全服广播) ---
    { rarity: 'epic', prob: 15, type: 'reward_coin', min: 150, max: 250, msg: "🎉 截获了企业的避税资金流！大丰收！" },
    { rarity: 'epic', prob: 15, type: 'reward_xp', min: 200, max: 300, msg: "🧠 与赛博幽灵进行了深度链接，智慧飞升。" },
    { rarity: 'epic', prob: 10, type: 'item', items: ['top_card'], msg: "破解广告后台，获得【置顶卡】！" },

    // --- 🟡 Legendary (传说 - 金色 - 全服广播) ---
    { rarity: 'legendary', prob: 5, type: 'reward_coin', min: 888, max: 1000, msg: "🏆 [JACKPOT] 挖到了比特币遗迹硬盘！一夜暴富！" },
    { rarity: 'legendary', prob: 5, type: 'reward_xp', min: 800, max: 1000, msg: "🏆 [JACKPOT] 意识上传至云端核心，成为半神！" },
    { rarity: 'legendary', prob: 2, type: 'item_vip', days: 7, msg: "🌟🌟🌟 [传说] 捡到了管理员遗失的【VIP 7天体验卡】！" },

    // --- 🔴 Glitch (故障 - 红色) ---
    { rarity: 'glitch', prob: 30, type: 'glitch', lose_min: 20, lose_max: 50, msg: "⚠️ 防火墙反击！钱包受损。" },
    { rarity: 'glitch', prob: 5, type: 'glitch', lose_min: 100, lose_max: 200, msg: "🚨🚨 严重警报！遭遇网警追踪，大量资金被销毁！" }
];

function rollEvent() {
    let sum = 0; EVENTS.forEach(e => sum += e.prob);
    let rand = Math.random() * sum;
    for (let e of EVENTS) { if (rand < e.prob) return e; rand -= e.prob; }
    return EVENTS[EVENTS.length - 1];
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.DB;

    // 鉴权...
    const cookie = request.headers.get('Cookie');
    if (!cookie || !cookie.includes('session_id')) return new Response(JSON.stringify({ error: '请先登录' }), { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ error: '无效会话' }), { status: 401 });

    // === 新增：如果是 action='get_logs'，则返回最新的全服广播 ===
    const reqBody = await request.json().catch(()=>({}));
    if (reqBody.action === 'get_logs') {
        const logs = await db.prepare('SELECT * FROM node_public_logs ORDER BY created_at DESC LIMIT 5').all();
        return new Response(JSON.stringify({ success: true, logs: logs.results }));
    }

    // --- 下面是探索逻辑 ---
    
    // 检查冷却与费用
    const now = Date.now();
    const utc8 = new Date(now + (8 * 60 * 60 * 1000));
    const today = utc8.toISOString().split('T')[0];
    const isFree = (user.last_node_explore_date !== today);
    const cost = isFree ? 0 : 50;

    if (!isFree && user.coins < cost) {
        return new Response(JSON.stringify({ success: false, error: `能量不足，需要 ${cost} i币` }), { status: 400 });
    }

    // 准备基础数据变更
    let currentCoins = user.coins - cost;
    let currentXp = user.xp;
    let updates = []; 

    if (cost > 0) updates.push(db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(cost, user.id));
    updates.push(db.prepare('UPDATE users SET last_node_explore_date = ? WHERE id = ?').bind(today, user.id));

    // 执行随机事件
    const event = rollEvent();
    let resultMsg = event.msg;
    
    // 逻辑处理分支
    if (event.type === 'reward_coin') {
        const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
        updates.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(amount, user.id));
        resultMsg = resultMsg.replace("少量", amount).replace("大丰收", `+${amount}`); // 简单替换文案
        if (!resultMsg.includes(amount)) resultMsg += ` (+${amount} i币)`;
        currentCoins += amount; 
    } 
    else if (event.type === 'reward_xp') {
        const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
        updates.push(db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(amount, user.id));
        resultMsg += ` (XP +${amount})`;
        currentXp += amount; 
    }
    else if (event.type === 'glitch') {
        let lose = Math.floor(Math.random() * (event.lose_max - event.lose_min + 1)) + event.lose_min;
        if (lose > currentCoins) lose = currentCoins; 
        if (lose > 0) {
            updates.push(db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(lose, user.id));
            resultMsg += ` (损失 ${lose} i币)`;
            currentCoins -= lose; 
        }
    }
    else if (event.type === 'item') {
        const item = event.items[Math.floor(Math.random() * event.items.length)];
        const existing = await db.prepare('SELECT id FROM user_items WHERE user_id = ? AND item_id = ?').bind(user.id, item).first();
        if (existing) updates.push(db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE id = ?').bind(existing.id));
        else updates.push(db.prepare('INSERT INTO user_items (user_id, item_id, category, quantity, created_at) VALUES (?, ?, ?, 1, ?)').bind(user.id, item, 'consumable', now));
    }
    else if (event.type === 'item_vip') {
        let newExpire = now;
        if (user.vip_expires_at > newExpire) newExpire = user.vip_expires_at + (event.days * 86400 * 1000);
        else newExpire = newExpire + (event.days * 86400 * 1000);
        updates.push(db.prepare('UPDATE users SET is_vip = 1, vip_expires_at = ? WHERE id = ?').bind(newExpire, user.id));
    }

    // === 核心升级：全服广播逻辑 ===
    if (event.rarity === 'epic' || event.rarity === 'legendary') {
        const logMsg = `用户 [${user.nickname||user.username}] 触发事件：${resultMsg}`;
        updates.push(db.prepare('INSERT INTO node_public_logs (username, event_type, message, created_at) VALUES (?, ?, ?, ?)').bind(user.nickname||user.username, event.rarity, resultMsg, now));
    }

    if (updates.length > 0) await db.batch(updates);

    return new Response(JSON.stringify({ 
        success: true, 
        message: resultMsg, 
        rarity: event.rarity, // 返回稀有度给前端做特效
        new_coins: currentCoins,
        new_xp: currentXp
    }));
}
