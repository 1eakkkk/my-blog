// --- functions/api/node.js ---

// === 20种随机事件库 ===
// prob 是相对权重，数值越大越容易抽中
const EVENTS = [
    // --- 💰 金币收益类 (Coin Rewards) ---
    { type: 'reward_coin', prob: 150, min: 5,  max: 15,  msg: "收集到零散的数据碎片，兑换了少量 i 币。" },
    { type: 'reward_coin', prob: 120, min: 20, max: 40,  msg: "破解了一个被遗弃的支付终端。" },
    { type: 'reward_coin', prob: 80,  min: 50, max: 80,  msg: "拦截到一笔企业间的加密转账！" },
    { type: 'reward_coin', prob: 40,  min: 100, max: 150, msg: "发现走私者的私密金库！大丰收！" },
    { type: 'reward_coin', prob: 5,   min: 500, max: 1000, msg: "【传说】挖到了旧时代的比特币遗迹硬盘！！一夜暴富！" }, // 大奖

    // --- 🧠 经验收益类 (XP Rewards) ---
    { type: 'reward_xp',   prob: 150, min: 10, max: 30,  msg: "阅读了一段技术文档，略有所得。" },
    { type: 'reward_xp',   prob: 100, min: 40, max: 80,  msg: "连接到高速算力节点，思维极速运转。" },
    { type: 'reward_xp',   prob: 60,  min: 100, max: 150, msg: "下载了大师级的黑客神经记忆包。" },
    { type: 'reward_xp',   prob: 10,  min: 300, max: 500, msg: "【顿悟】意识短暂接入了矩阵核心，获得了海量知识！" }, // 大奖

    // --- 📦 道具掉落类 (Item Drops) ---
    // 改名卡比较普通
    { type: 'item',        prob: 20,  items: ['rename_card'], msg: "在废墟中捡到一张未使用的【改名卡】。" },
    // 置顶卡比较稀有
    { type: 'item',        prob: 10,  items: ['top_card'],    msg: "破解了广告牌系统，获得一张【置顶卡】！" },
    // 幸运双倍 (虽然还是道具逻辑，但给个好听的文案)
    { type: 'item',        prob: 5,   items: ['top_card', 'rename_card'], msg: "破解了加密保险箱，获得稀有道具！" },

    // --- ⚠️ 故障/扣费类 (Glitches - Risk) ---
    { type: 'glitch',      prob: 80,  lose_min: 5,  lose_max: 20,  msg: "⚠️ 遭遇防火墙反击！丢失了少量数据 (i 币)。" },
    { type: 'glitch',      prob: 40,  lose_min: 30, lose_max: 60,  msg: "⚠️ 踩中逻辑地雷！钱包受到中度损伤。" },
    { type: 'glitch',      prob: 10,  lose_min: 100, lose_max: 200, msg: "⚠️⚠️ 严重警报！遭遇网警追踪，为了销毁痕迹烧毁了大量资金！" },

    // --- 📜 任务触发类 (Missions) ---
    { type: 'mission',     prob: 30,  msg: "接收到一条加密的求救信号..." },
    { type: 'mission',     prob: 20,  msg: "系统派发了一项紧急赏金任务！" },

    // --- ☁️ 空白/氛围类 (Empty) ---
    { type: 'empty',       prob: 100, msg: "扫描完成。该扇区空无一物。" },
    { type: 'empty',       prob: 80,  msg: "信号受到强烈干扰，无法解析数据。" },
    { type: 'empty',       prob: 60,  msg: "404 DATA NOT FOUND." },
    { type: 'empty',       prob: 40,  msg: "只发现了一些毫无价值的日志文件。" }
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

    // 3. 准备基础数据变更（先扣费）
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
    
    // === 逻辑处理分支 ===
    if (event.type === 'reward_coin') {
        const amount = Math.floor(Math.random() * (event.max - event.min + 1)) + event.min;
        updates.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(amount, user.id));
        resultMsg += ` (+${amount} i币)`;
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

    // 5. 返回
    return new Response(JSON.stringify({ 
        success: true, 
        message: resultMsg, 
        type: event.type,
        new_coins: currentCoins,
        new_xp: currentXp
    }));
}
