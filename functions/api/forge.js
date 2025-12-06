// --- START OF FILE functions/api/forge.js (Users Table Version) ---

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

    // 2. 读取存档 (直接从 users 表读！)
    // 我们专门查一下这个字段，确保拿到最新值
    const userData = await db.prepare("SELECT forge_levels FROM users WHERE id = ?").bind(user.id).first();
    const levels = userData && userData.forge_levels ? JSON.parse(userData.forge_levels) : {};

    // === GET ===
    if (request.method === 'GET') {
        return Response.json({ success: true, levels, config: FORGE_CONFIG });
    }

    // === POST: 升级 ===
    if (request.method === 'POST') {
        const body = await request.json();
        const type = body.type;
        const conf = FORGE_CONFIG[type];
        
        if (!conf) return Response.json({ error: '未知类型' });

        const curLv = levels[type] || 0;
        if (curLv >= conf.max) return Response.json({ error: '满级' });

        const cost = Math.floor(conf.base_cost * Math.pow(1.1, curLv));
        if (user.k_coins < cost) return Response.json({ error: 'K币不足' });

        // 更新内存对象
        levels[type] = curLv + 1;
        
        // === 🚨 核心修复：直接写入 users 表 ===
        // 同时扣钱 + 更新字段，保证原子性，绝对不丢数据
        await db.prepare("UPDATE users SET k_coins = k_coins - ?, forge_levels = ? WHERE id = ?")
            .bind(cost, JSON.stringify(levels), user.id).run();

        return Response.json({ success: true, message: '锻造成功', new_level: curLv + 1 });
    }
}
