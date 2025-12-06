// --- START OF FILE functions/api/forge.js (Final Stable) ---

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

    // 2. 读取存档
    // 这一步非常关键：我们要看看数据库里到底有没有这一行
    let save = await db.prepare("SELECT * FROM user_forge WHERE user_id = ?").bind(user.id).first();
    
    // 如果没读到，我们在内存里造一个空的，但这不代表数据库里有
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

        // 更新内存里的等级
        levels[type] = curLv + 1;
        const levelStr = JSON.stringify(levels);

        // === 3. 稳健保存逻辑 (Fool-proof Save) ===
        // 先扣钱
        const batch = [
            db.prepare("UPDATE users SET k_coins = k_coins - ? WHERE id = ?").bind(cost, user.id)
        ];

        // 再保存等级
        if (save) {
            // 情况A: 数据库里有记录 -> 执行 UPDATE
            batch.push(
                db.prepare("UPDATE user_forge SET levels = ? WHERE user_id = ?").bind(levelStr, user.id)
            );
        } else {
            // 情况B: 数据库里没记录 -> 执行 INSERT
            batch.push(
                db.prepare("INSERT INTO user_forge (user_id, levels) VALUES (?, ?)").bind(user.id, levelStr)
            );
        }

        await db.batch(batch);

        return Response.json({ success: true, message: '升级成功', new_level: curLv + 1 });
    }
}
