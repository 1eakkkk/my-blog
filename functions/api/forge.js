// --- START OF FILE functions/api/forge.js (v4.5 REPLACE INTO) ---

const FORGE_CONFIG = {
    'overclock': { name: '神经超频', base_cost: 1000, desc: '挂机算力(DPS) +5%', max: 50 },
    'sniffer':   { name: '量子嗅探', base_cost: 5000, desc: '股市手续费 -1%', max: 10 },
    'hardening': { name: '逻辑硬化', base_cost: 2000, desc: '打工收益 +5%', max: 20 }
};

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    try {
        // 1. 鉴权
        const cookie = request.headers.get('Cookie');
        if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
        const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
        const user = await db.prepare('SELECT id, k_coins FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
        if (!user) return Response.json({ error: 'Auth Failed' }, { status: 401 });

        // 2. 读取存档 (只用于计算等级，不用于判断是否存在)
        let save = await db.prepare("SELECT * FROM user_forge WHERE user_id = ?").bind(user.id).first();
        const levels = save ? JSON.parse(save.levels || '{}') : {};

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

            // 计算新等级
            levels[type] = curLv + 1;
            const levelStr = JSON.stringify(levels);

            // === 🚨 霸道写入 (REPLACE INTO) ===
            // 只要 user_id 是主键，这句 SQL 会自动处理“插入”或“更新”
            // 它是原子操作，极快，不容易锁死
            await db.batch([
                // 1. 扣钱
                db.prepare("UPDATE users SET k_coins = k_coins - ? WHERE id = ?").bind(cost, user.id),
                // 2. 强制覆盖写入
                db.prepare("REPLACE INTO user_forge (user_id, levels) VALUES (?, ?)").bind(user.id, levelStr)
            ]);

            return Response.json({ success: true, message: '锻造成功', new_level: curLv + 1 });
        }
        
        return Response.json({ error: 'Invalid' });

    } catch (err) {
        // 把错误吐出来，让我们看到到底发生了什么
        return Response.json({ success: false, error: "DB Error: " + err.message }, { status: 500 });
    }
}
