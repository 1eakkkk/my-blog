// --- START OF FILE functions/api/forge.js (v4.4 Fix) ---

const FORGE_CONFIG = {
    'overclock': { name: '神经超频', base_cost: 1000, desc: '挂机算力(DPS) +5%', max: 50 },
    'sniffer':   { name: '量子嗅探', base_cost: 5000, desc: '股市手续费 -1%', max: 10 },
    'hardening': { name: '逻辑硬化', base_cost: 2000, desc: '打工收益 +5%', max: 20 }
};

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id, k_coins FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth Failed' }, { status: 401 });

    // 2. 读取锻造存档 (增加容错)
    let save = await db.prepare("SELECT * FROM user_forge WHERE user_id = ?").bind(user.id).first();
    
    // 如果没有存档，默认为空对象
    const levels = save ? JSON.parse(save.levels || '{}') : {};

    // === GET: 获取列表 ===
    if (request.method === 'GET') {
        return Response.json({
            success: true,
            levels: levels,
            config: FORGE_CONFIG
        });
    }

    // === POST: 升级 ===
    if (request.method === 'POST') {
        const body = await request.json();
        const type = body.type;
        
        const conf = FORGE_CONFIG[type];
        if (!conf) return Response.json({ error: '未知硬件类型' });

        const curLv = levels[type] || 0;
        if (curLv >= conf.max) return Response.json({ error: '已升至满级' });

        // 价格公式：基础价 * 1.1^等级
        const cost = Math.floor(conf.base_cost * Math.pow(1.1, curLv));

        if (user.k_coins < cost) return Response.json({ error: `K币不足 (需 ${cost.toLocaleString()})` });

        // 计算新等级
        levels[type] = curLv + 1;
        const newLevelsStr = JSON.stringify(levels);

        // === 🚨 核心修复：使用 Upsert (插入或更新) ===
        // 这样即使数据库里之前没有你的记录，也会自动创建，不会导致"扣了钱没升级"
        await db.batch([
            // 1. 扣钱
            db.prepare("UPDATE users SET k_coins = k_coins - ? WHERE id = ?").bind(cost, user.id),
            
            // 2. 强制保存 (如果冲突则更新)
            db.prepare(`
                INSERT INTO user_forge (user_id, levels) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET levels = excluded.levels
            `).bind(user.id, newLevelsStr)
        ]);

        return Response.json({ success: true, message: '锻造成功', new_level: curLv + 1 });
    }
}
