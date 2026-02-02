// --- functions/api/node.js ---

// === 1. 稀有度配置 (颜色与动画时间) ===
const RARITY_CONFIG = {
    'white':  { color: '#a0a0a0', spin: 1100, name: '破损' }, // 1.1s
    'green':  { color: '#55ff55', spin: 1100, name: '普通' }, // 1.1s
    'blue':   { color: '#00ccff', spin: 1600, name: '稀有' }, // 1.6s
    'purple': { color: '#d000ff', spin: 2400, name: '史诗' }, // 2.4s
    'gold':   { color: '#ffd700', spin: 3600, name: '传说' }, // 3.6s
    'red':    { color: '#ff3333', spin: 5500, name: '机密' }  // 5.5s
};

// === 2. 场次配置 (决定能抽到哪些稀有度) ===
const TIERS = {
    'basic': { name: '初级场', cost: 10,  pool: ['white', 'green', 'blue'] }, 
    'mid':   { name: '中级场', cost: 50,  pool: ['green', 'blue', 'purple', 'gold'] }, 
    'adv':   { name: '高级场', cost: 150, pool: ['blue', 'purple', 'gold', 'red'] } 
};

// === 3. 物品库 (LOOT TABLE) - 核心修改 ===
// 格式: { name, rarity, w:宽, h:高, weight:权重, val:[min, max] }
// val: 单格价值范围。如果是固定值，写 [13141314, 13141314]
const LOOT_TABLE = [
    // --- 🔴 红色 (机密) ---1-10
    { name: "海洋之泪", rarity: 'red', w: 1, h: 1, weight: 1, val: [26282628, 26282628] },
    { name: "非洲之星", rarity: 'red', w: 1, h: 1, weight: 2, val: [13141314, 13141314] }, // 极低概率，固定天价
    { name: "机密文件", rarity: 'red', w: 2, h: 1, weight: 3, val: [2000000, 3000000] },
    { name: "'理想国'试剂盒", rarity: 'red', w: 2, h: 3, weight: 5, val: [150000, 300000] },

    // --- 🟡 金色 (传说) ---11-66
    { name: "纯金手机", rarity: 'gold', w: 1, h: 1, weight: 36, val: [150, 200] },
    { name: "金手镯", rarity: 'gold', w: 1, h: 1, weight: 35, val: [188, 211] },
    { name: "金魔方", rarity: 'gold', w: 1, h: 1, weight: 38, val: [121, 158] },
    { name: "大疆action4", rarity: 'gold', w: 2, h: 1, weight: 36, val: [80, 160] },
    { name: "卫星电话", rarity: 'gold', w: 1, h: 2, weight: 45, val: [55, 95] },
    { name: "金条", rarity: 'gold', w: 1, h: 2, weight: 55, val: [48, 88] },
    { name: "三角洲特勤箱", rarity: 'gold', w: 3, h: 3, weight: 55, val: [33, 44] }, // 占地大，单格略低，总价高

    // --- 🟣 紫色 (史诗) ---67-120
    { name: "单兵外骨骼", rarity: 'purple', w: 2, h: 4, weight: 76, val: [15, 25] },
    { name: "黑客遗物", rarity: 'purple', w: 2, h: 2, weight: 80, val: [20, 35] },
    { name: "AI 逻辑回路", rarity: 'purple', w: 1, h: 3, weight: 70, val: [25, 45] },
    { name: "固态硬盘", rarity: 'purple', w: 1, h: 1, weight: 79, val: [85, 145] },
    { name: "内存条", rarity: 'purple', w: 3, h: 1, weight: 75, val: [55, 65] },

    // --- 🔵 蓝色 (稀有) ---121-200
    { name: "服务器主板", rarity: 'blue', w: 2, h: 3, weight: 150, val: [10, 20] },
    { name: "高倍镜头", rarity: 'blue', w: 1, h: 2, weight: 180, val: [15, 30] },
    { name: "民用电池", rarity: 'blue', w: 2, h: 2, weight: 200, val: [8, 15] },
    { name: "音频播放器", rarity: 'blue', w: 1, h: 1, weight: 200, val: [25, 55] },

    // --- 🟢 绿色 (普通) ---201-300
    { name: "实用玻璃钢门", rarity: 'green', w: 2, h: 3, weight: 230, val: [3, 12] }, 
    { name: "RX580显卡", rarity: 'green', w: 2, h: 1, weight: 250, val: [10, 12] },
    { name: "机械轴体", rarity: 'green', w: 1, h: 1, weight: 400, val: [10, 20] },
    { name: "圣诞节的苹果", rarity: 'green', w: 1, h: 1, weight: 250, val: [12, 25] },
    { name: "《龙族》全套", rarity: 'green', w: 2, h: 3, weight: 224, val: [4, 14] },

    // --- ⚪ 白色 (垃圾) ---300-500
    { name: "半瓶肥宅水", rarity: 'white', w: 1, h: 2, weight: 410, val: [2, 6] },
    { name: "一个陶瓷碗", rarity: 'white', w: 2, h: 2, weight: 420, val: [3, 5] },
    { name: "一包卫生纸", rarity: 'white', w: 1, h: 1, weight: 430, val: [3, 5] },
    { name: "盒装蜡烛", rarity: 'white', w: 2, h: 2, weight: 460, val: [3, 5] },
    { name: "废纸板", rarity: 'white', w: 2, h: 2, weight: 430, val: [4, 8] },
    { name: "一包火鸡面", rarity: 'white', w: 1, h: 1, weight: 490, val: [2, 20] },
    { name: "一瓶酸奶", rarity: 'white', w: 1, h: 1, weight: 420, val: [5, 12] },
    { name: "损坏的硬盘", rarity: 'white', w: 1, h: 1, weight: 450, val: [5, 7] }
];

// 辅助：获取随机整数
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

    // === 2. 核心算法：基于权重的抽取 ===
    
    // 2.1 筛选：根据场次允许的稀有度，从总表中筛选物品
    const validItems = LOOT_TABLE.filter(item => config.pool.includes(item.rarity));
    
    if (validItems.length === 0) {
        return Response.json({ error: '配置错误：该场次无掉落' });
    }

    // 2.2 计算总权重
    let totalWeight = 0;
    validItems.forEach(item => totalWeight += item.weight);

    // 2.3 随机抽取
    let randomVal = Math.random() * totalWeight;
    let selectedItem = validItems[0];

    for (const item of validItems) {
        randomVal -= item.weight;
        if (randomVal <= 0) {
            selectedItem = item;
            break;
        }
    }

    // === 3. 计算价值与形状 ===
    let width = selectedItem.w;
    let height = selectedItem.h;

    // 50% 概率旋转形状 (如果非正方形)
    if (width !== height && Math.random() < 0.5) {
        [width, height] = [height, width];
    }

    const totalGrids = width * height;
    // 单格价值
    const valPerGrid = getRandomInt(selectedItem.val[0], selectedItem.val[1]);
    // 总价值
    const totalValue = valPerGrid * totalGrids;

    // 净利润 (可能为负)
    const profit = totalValue - config.cost;
    const rConfig = RARITY_CONFIG[selectedItem.rarity];

    // === 4. 数据库写入 ===
    const updates = [];
    updates.push(db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(profit, user.id));

    // 红光全服广播
    if (selectedItem.rarity === 'red') {
        const msg = `🔥 [传说出货] ${user.nickname||user.username} 在【${config.name}】摸出了 <span style="color:#ff3333;font-weight:bold;">[${selectedItem.name}]</span> (价值 ${totalValue.toLocaleString()} i币)!`;
        updates.push(db.prepare("INSERT INTO broadcasts (user_id, nickname, tier, content, style_color, status, start_time, end_time, created_at) VALUES (?, ?, 'high', ?, 'rainbow', 'active', ?, ?, ?)")
            .bind(user.id, 'SYSTEM', msg, Date.now(), Date.now() + 86400000, Date.now()));
    }

    await db.batch(updates);

    return Response.json({
        success: true,
        result: {
            name: selectedItem.name,
            rarity: selectedItem.rarity, // 返回稀有度key ('red', 'green'...)
            color: rConfig.color,        // 返回颜色代码
            width: width,
            height: height,
            total_value: totalValue,
            spin_time: rConfig.spin
        },
        new_balance: user.coins + profit
    });
}
