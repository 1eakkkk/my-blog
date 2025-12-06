// --- START OF FILE functions/api/forge.js (Debug Version) ---

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

    try {
        // 2. 读取存档 (带容错)
        // 尝试读取 forge_levels 字段
        let userData = null;
        try {
            userData = await db.prepare("SELECT forge_levels FROM users WHERE id = ?").bind(user.id).first();
        } catch(e) {
            // 如果读取报错，说明字段可能不存在
            return Response.json({ error: "DB Error: 无法读取 forge_levels，请确认是否执行了 ALTER TABLE SQL 语句。" });
        }
        
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
            
            // 3. 执行写入 (捕获具体错误)
            try {
                await db.prepare("UPDATE users SET k_coins = k_coins - ?, forge_levels = ? WHERE id = ?")
                    .bind(cost, JSON.stringify(levels), user.id).run();
            } catch (writeErr) {
                return Response.json({ error: "写入失败: " + writeErr.message });
            }

            return Response.json({ success: true, message: '锻造成功', new_level: curLv + 1 });
        }
    } catch (globalErr) {
        return Response.json({ error: "System Error: " + globalErr.message });
    }
}
