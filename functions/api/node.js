// --- functions/api/node.js ---

// === 摸金配置 ===
const TIERS = {
    'basic': { name: '初级场', cost: 10,  win_rate: 0.9,  pool: ['white', 'green'] }, // 几乎稳赚，换时间
    'mid':   { name: '中级场', cost: 50,  win_rate: 0.75, pool: ['green', 'blue', 'purple'] }, // 75% 赚钱
    'adv':   { name: '高级场', cost: 150, win_rate: 0.25, pool: ['blue', 'purple', 'gold', 'red'] } // 75% 赔本
};

// 稀有度与每格价值 (min, max, color, spinTime)
const RARITY = {
    'white':  { min: 1,   max: 5,   color: '#aaa',    spin: 1000, name: '破损' },
    'green':  { min: 5,   max: 15,  color: '#0f0',    spin: 2000, name: '普通' },
    'blue':   { min: 15,  max: 30,  color: '#00f3ff', spin: 3500, name: '稀有' },
    'purple': { min: 30,  max: 50,  color: '#bd00ff', spin: 5000, name: '史诗' },
    'gold':   { min: 50,  max: 100, color: '#ffd700', spin: 7000, name: '传说' },
    'red':    { min: 100, max: 500, color: '#ff3333', spin: 10000, name: '机密' }
};

// 物品库 (Flavor Text)
const ITEMS = [
    { name: "生锈的显卡", grids: 2 }, { name: "甚至不能开机的硬盘", grids: 1 }, { name: "半瓶肥宅水", grids: 1 },
    { name: "机械键盘轴体", grids: 1 }, { name: "加密狗", grids: 1 }, { name: "军用电池", grids: 2 },
    { name: "光学镜头", grids: 2 }, { name: "服务器主板", grids: 4 }, { name: "量子纠缠核心", grids: 1 },
    { name: "机密情报箱", grids: 6 }, { name: "单兵外骨骼", grids: 8 }, { name: "AI 逻辑回路", grids: 3 },
    { name: "黑客的遗物", grids: 4 }, { name: "核聚变燃料棒", grids: 2 }, { name: "金条 (虚拟)", grids: 2 },
    { name: "以太坊私钥", grids: 1 }, { name: "三角洲特种装备", grids: 9 }, { name: "暗区机密文件", grids: 6 }
];

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const body = await request.json();
    const tierKey = body.tier || 'basic';
    const config = TIERS[tierKey];

    if (!config) return Response.json({ error: '无效场次' });
    if (user.coins < config.cost) return Response.json({ error: `i币不足 (需 ${config.cost})` });

    // === 2. 核心算法 ===
    const isWin = Math.random() < config.win_rate; // 判定是赚还是赔
    let rarityKey = 'white';

    if (tierKey === 'basic') {
        rarityKey = Math.random() < 0.8 ? 'white' : 'green';
    } else if (tierKey === 'mid') {
        if (isWin) rarityKey = Math.random() < 0.7 ? 'blue' : 'purple';
        else rarityKey = Math.random() < 0.5 ? 'white' : 'green'; // 赔本出垃圾
    } else if (tierKey === 'adv') {
        if (isWin) rarityKey = Math.random() < 0.7 ? 'gold' : 'red'; // 大赚
        else rarityKey = Math.random() < 0.6 ? 'green' : 'blue'; // 赔本出一般的
    }

    // 抽取物品
    const itemTemplate = ITEMS[Math.floor(Math.random() * ITEMS.length)];
    // 强制修正格数 (为了配合设定: 价值高的一般体积大，或者极小极贵)
    // 这里随机化格数，增加变数
    const gridOptions = [1, 2, 3, 4, 6, 8, 9];
    const grids = gridOptions[Math.floor(Math.random() * gridOptions.length)];
    
    // 计算价值
    const rConfig = RARITY[rarityKey];
    const valPerGrid = getRandomInt(rConfig.min, rConfig.max);
    const totalValue = valPerGrid * grids;

    // 利润计算
    const profit = totalValue - config.cost;
    
    // 3. 数据库事务
    const updates = [];
    // 扣费 + 发钱 (合并操作)
    updates.push(db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(profit, user.id)); // 直接加净利润
    
    // 记录日志 (仅大奖)
    if (rarityKey === 'red') {
        const msg = `🔥 [传说出货] ${user.nickname||user.username} 在【${config.name}】摸出了 <span style="color:#ff3333">[${itemTemplate.name}]</span> (价值 ${totalValue} i币)!`;
        updates.push(db.prepare("INSERT INTO broadcasts (user_id, nickname, tier, content, style_color, status, start_time, end_time, created_at) VALUES (?, ?, 'high', ?, 'rainbow', 'active', ?, ?, ?)")
            .bind(user.id, 'SYSTEM', msg, Date.now(), Date.now() + 86400000, Date.now()));
    }

    await db.batch(updates);

    return Response.json({
        success: true,
        tier: tierKey,
        cost: config.cost,
        result: {
            name: itemTemplate.name,
            rarity: rarityKey,
            color: rConfig.color,
            grids: grids,
            total_value: totalValue,
            spin_time: rConfig.spin // 前端转圈时长
        },
        new_balance: user.coins + profit
    });
}
