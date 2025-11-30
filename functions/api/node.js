// --- functions/api/node.js ---

// 事件池配置
const EVENTS = [
    { type: 'reward_coin', prob: 30, min: 10, max: 100, msg: "发现未加密的数据缓存，提取资金..." },
    { type: 'reward_xp',   prob: 30, min: 50, max: 200, msg: "连接到高速算力节点，思维加速..." },
    { type: 'item',        prob: 5,  items: ['top_card', 'rename_card'], msg: "破解了加密保险箱，获得道具！" },
    { type: 'glitch',      prob: 10, lose_min: 10, lose_max: 50, msg: "⚠️ 警告：遭遇逻辑炸弹！防火墙受损，丢失 i 币..." },
    { type: 'mission',     prob: 10, msg: "截获一条紧急加密指令..." }, // 触发限时任务
    { type: 'empty',       prob: 15, msg: "扫描完成。该区域为空白数据扇区。" }
];

// 辅助：加权随机
function rollEvent() {
    let sum = 0;
    EVENTS.forEach(e => sum += e.prob);
    let rand = Math.random() * sum;
    for (let e of EVENTS) {
        if (rand < e.prob) return e;
        rand -= e.prob;
    }
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
    const cost = isFree ? 0 : 50; // 后续探索每次 50 i币

    if (!isFree && user.coins < cost) {
        return new Response(JSON.stringify({ success: false, error: `能量不足，需要 ${cost} i币进行强行扫描` }), { status: 400 });
    }

    // 3. 扣费（如果是付费探索）
    if (cost > 0) {
        await db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(cost, user.id).run();
    }

    // 更新最后探索日期
    await db.prepare('UPDATE users SET last_node_explore_date = ? WHERE id = ?').bind(today, user.id).run();

    // 4. 执行随机事件
    const event = rollEvent();
    let resultMsg = event.msg;
    let finalCoins = user.coins - cost; // 预估剩余（暂不含奖励）
    let updates = []; // 数据库操作队列

    try {
        if (event.type === 'reward_coin') {
            const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
            updates.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(amount, user.id));
            resultMsg += ` (+${amount} i币)`;
            finalCoins += amount;
        } 
        else if (event.type === 'reward_xp') {
            const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
            updates.push(db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').bind(amount, user.id));
            resultMsg += ` (XP +${amount})`;
        }
        else if (event.type === 'glitch') {
            let lose = Math.floor(Math.random() * (event.lose_max - event.lose_min + 1)) + event.lose_min;
            if (lose > finalCoins) lose = finalCoins; // 不会扣成负数
            if (lose > 0) {
                updates.push(db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(lose, user.id));
                resultMsg += ` (损失 ${lose} i币)`;
                finalCoins -= lose;
            } else {
                resultMsg += " (账户余额为空，侥幸逃脱)";
            }
        }
        else if (event.type === 'item') {
            const item = event.items[Math.floor(Math.random() * event.items.length)];
            // 检查是否已有
            const existing = await db.prepare('SELECT id FROM user_items WHERE user_id = ? AND item_id = ?').bind(user.id, item).first();
            if (existing) {
                updates.push(db.prepare('UPDATE user_items SET quantity = quantity + 1 WHERE id = ?').bind(existing.id));
            } else {
                updates.push(db.prepare('INSERT INTO user_items (user_id, item_id, category, quantity, created_at) VALUES (?, ?, ?, 1, ?)').bind(user.id, item, 'consumable', Date.now()));
            }
            // 简单映射一下中文名
            const nameMap = {'rename_card': '改名卡', 'top_card': '置顶卡'};
            resultMsg += ` [获得: ${nameMap[item] || item}]`;
        }
        else if (event.type === 'mission') {
            // 插入一个特殊任务，有效期 2 天
            // 随机选一个任务类型：比如 'post_1' (发一篇帖) 或 'like_10' (点10个赞)
            const tasks = [
                {code: 'node_post_1', desc: '紧急任务：发布 1 条情报 (帖子)', target: 1, xp: 100, coin: 50},
                {code: 'node_like_10', desc: '紧急任务：校准 10 个数据点 (点赞)', target: 10, xp: 80, coin: 40}
            ];
            const t = tasks[Math.floor(Math.random() * tasks.length)];
            const periodKey = `mission_${Date.now()}`; // 唯一标识

            updates.push(db.prepare(`
                INSERT INTO user_tasks (user_id, task_code, category, description, target, reward_xp, reward_coins, period_key, status, created_at) 
                VALUES (?, ?, 'node_mission', ?, ?, ?, ?, ?, 0, ?)
            `).bind(user.id, t.code, t.desc, t.target, t.xp, t.coin, periodKey, Date.now()));
            
            resultMsg += ` [触发任务: ${t.desc}]`;
        }

        // 批量执行
        if (updates.length > 0) await db.batch(updates);

        return new Response(JSON.stringify({ 
            success: true, 
            message: resultMsg, 
            type: event.type,
            remaining_coins: finalCoins
        }));

    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: '连接不稳定: ' + e.message }));
    }
}
