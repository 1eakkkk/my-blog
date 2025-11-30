// --- functions/api/node.js ---

const EVENTS = [
    { type: 'reward_coin', prob: 30, min: 10, max: 100, msg: "发现未加密的数据缓存，提取资金..." },
    { type: 'reward_xp',   prob: 30, min: 50, max: 200, msg: "连接到高速算力节点，思维加速..." },
    { type: 'item',        prob: 5,  items: ['top_card', 'rename_card'], msg: "破解了加密保险箱，获得道具！" },
    { type: 'glitch',      prob: 10, lose_min: 10, lose_max: 50, msg: "⚠️ 警告：遭遇逻辑炸弹！防火墙受损，丢失 i 币..." },
    { type: 'mission',     prob: 10, msg: "截获一条紧急加密指令..." },
    { type: 'empty',       prob: 15, msg: "扫描完成。该区域为空白数据扇区。" }
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

    // 3. 准备基础数据变更（先扣费）
    let currentCoins = user.coins - cost;
    let currentXp = user.xp;
    let updates = []; 

    // 如果有费用，加入扣费队列
    if (cost > 0) {
        updates.push(db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(cost, user.id));
    }

    // 更新日期
    updates.push(db.prepare('UPDATE users SET last_node_explore_date = ? WHERE id = ?').bind(today, user.id));

    // 4. 执行随机事件
    const event = rollEvent();
    let resultMsg = event.msg;
    
    // === 核心修改：在 JS 层面计算最终值，以便返回给前端 ===
    if (event.type === 'reward_coin') {
        const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
        updates.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(amount, user.id));
        resultMsg += ` (+${amount} i币)`;
        currentCoins += amount; // 实时计算
    } 
    else if (event.type === 'reward_xp') {
        const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
        updates.push(db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(amount, user.id));
        resultMsg += ` (XP +${amount})`;
        currentXp += amount; // 实时计算
    }
    else if (event.type === 'glitch') {
        let lose = Math.floor(Math.random() * (event.lose_max - event.lose_min + 1)) + event.lose_min;
        if (lose > currentCoins) lose = currentCoins; 
        if (lose > 0) {
            updates.push(db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(lose, user.id));
            resultMsg += ` (损失 ${lose} i币)`;
            currentCoins -= lose; // 实时计算
        } else {
            resultMsg += " (账户余额为空，侥幸逃脱)";
        }
    }
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
    else if (event.type === 'mission') {
        const tasks = [
            {code: 'node_post_1', desc: '紧急任务：发布 1 条情报 (帖子)', target: 1, xp: 100, coin: 50},
            {code: 'node_like_10', desc: '紧急任务：校准 10 个数据点 (点赞)', target: 10, xp: 80, coin: 40}
        ];
        const t = tasks[Math.floor(Math.random() * tasks.length)];
        const periodKey = `mission_${Date.now()}`;
        updates.push(db.prepare(`
            INSERT INTO user_tasks (user_id, task_code, category, description, target, reward_xp, reward_coins, period_key, status, created_at) 
            VALUES (?, ?, 'node_mission', ?, ?, ?, ?, ?, 0, ?)
        `).bind(user.id, t.code, t.desc, t.target, t.xp, t.coin, periodKey, Date.now()));
        resultMsg += ` [触发任务: ${t.desc}]`;
    }

    // 执行所有数据库操作
    if (updates.length > 0) await db.batch(updates);

    // 5. 返回包含最新 XP 和 Coins 的数据
    return new Response(JSON.stringify({ 
        success: true, 
        message: resultMsg, 
        type: event.type,
        // === 关键：返回给前端最新的值 ===
        new_coins: currentCoins,
        new_xp: currentXp
    }));
}
