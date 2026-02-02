// --- functions/api/node.js ---

// === 摸金配置 ===
const TIERS = {
    'basic': { name: '初级场', cost: 10,  win_rate: 0.9,  pool: ['white', 'green'] }, // 几乎稳赚，换时间
    'mid':   { name: '中级场', cost: 50,  win_rate: 0.75, pool: ['green', 'blue', 'purple'] }, // 75% 赚钱
    'adv':   { name: '高级场', cost: 150, win_rate: 0.25, pool: ['blue', 'purple', 'gold', 'red'] } // 75% 赔本
};

// 稀有度与每格价值 (min, max, color, spinTime)
const RARITY = {
    'white':  { min: 1,   max: 5,   color: '#aaa',    spin: 1100, name: '破损' }, // 1.1s
    'green':  { min: 5,   max: 15,  color: '#0f0',    spin: 1100, name: '普通' }, // 1.1s
    'blue':   { min: 15,  max: 30,  color: '#00f3ff', spin: 1600, name: '稀有' }, // 1.6s
    'purple': { min: 30,  max: 50,  color: '#bd00ff', spin: 2400, name: '史诗' }, // 2.4s
    'gold':   { min: 50,  max: 100, color: '#ffd700', spin: 3600, name: '传说' }, // 3.6s
    'red':    { min: 100, max: 500, color: '#ff3333', spin: 5500, name: '机密' }  // 5.5s
};

const ITEMS = [
    { name: "生锈的显卡", shape: [2, 1] }, // 2格
    { name: "损坏的机械硬盘", shape: [1, 1] }, // 1格
    { name: "半瓶肥宅水", shape: [1, 2] }, // 2格
    { name: "机械轴体", shape: [1, 1] }, // 1格
    { name: "加密狗 U盘", shape: [1, 1] }, // 1格
    { name: "军用电池组", shape: [2, 2] }, // 4格
    { name: "高倍光学镜头", shape: [1, 2] }, // 2格
    { name: "服务器主板", shape: [2, 3] }, // 6格
    { name: "量子纠缠核心", shape: [1, 1] }, // 1格 (极小但极贵)
    { name: "机密情报箱", shape: [2, 3] }, // 6格
    { name: "单兵外骨骼", shape: [2, 4] }, // 8格
    { name: "AI 逻辑回路", shape: [1, 3] }, // 3格
    { name: "黑客的遗物", shape: [2, 2] }, // 4格
    { name: "核聚变燃料棒", shape: [1, 3] }, // 3格
    { name: "金条 (虚拟)", shape: [1, 2] }, // 2格
    { name: "以太坊私钥", shape: [1, 1] }, // 1格
    { name: "三角洲特种装备", shape: [3, 3] }, // 9格
    { name: "暗区机密文件", shape: [2, 3] } // 6格
];

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权 (保持不变)
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
    const isWin = Math.random() < config.win_rate;
    let rarityKey = 'white';

    if (tierKey === 'basic') {
        rarityKey = Math.random() < 0.8 ? 'white' : 'green';
    } else if (tierKey === 'mid') {
        if (isWin) rarityKey = Math.random() < 0.7 ? 'blue' : 'purple';
        else rarityKey = Math.random() < 0.5 ? 'white' : 'green';
    } else if (tierKey === 'adv') {
        if (isWin) rarityKey = Math.random() < 0.7 ? 'gold' : 'red';
        else rarityKey = Math.random() < 0.6 ? 'green' : 'blue';
    }

    // 抽取物品
    const itemTemplate = ITEMS[Math.floor(Math.random() * ITEMS.length)];
    
    // === 形状处理逻辑 ===
    let width = itemTemplate.shape[0];
    let height = itemTemplate.shape[1];

    // 50% 概率旋转物品 (如果不是正方形)
    if (width !== height && Math.random() < 0.5) {
        [width, height] = [height, width]; // 交换宽高
    }

    const grids = width * height; // 总格数
    
    // 计算价值
    const rConfig = RARITY[rarityKey];
    const valPerGrid = getRandomInt(rConfig.min, rConfig.max);
    const totalValue = valPerGrid * grids;

    // 利润计算
    const profit = totalValue - config.cost;
    
    // 3. 数据库事务
    const updates = [];
    updates.push(db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(profit, user.id));
    
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
            width: width,   // 返回宽
            height: height, // 返回高
            total_value: totalValue,
            spin_time: rConfig.spin
        },
        new_balance: user.coins + profit
    });
}
