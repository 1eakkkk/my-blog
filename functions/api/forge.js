// --- START OF FILE functions/api/forge.js (Diagnostic Mode) ---

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
    let save = await db.prepare("SELECT * FROM user_forge WHERE user_id = ?").bind(user.id).first();
    // ⚠️ 诊断点 1：看看数据库里原始数据是啥
    const rawDbData = save ? save.levels : "NULL";
    
    // 解析
    let levels = {};
    try {
        levels = save ? JSON.parse(save.levels || '{}') : {};
    } catch(e) {
        levels = {}; // 解析失败重置为空
    }

    // === GET ===
    if (request.method === 'GET') {
        return Response.json({ success: true, levels, config: FORGE_CONFIG, debug_user_id: user.id });
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

        // === 3. 分步执行 (拆开事务以定位问题) ===
        
        // A. 先扣钱
        await db.prepare("UPDATE users SET k_coins = k_coins - ? WHERE id = ?").bind(cost, user.id).run();

        // B. 再写入 (使用最原始的 DELETE + INSERT，绝对不会错)
        // 先删旧的
        await db.prepare("DELETE FROM user_forge WHERE user_id = ?").bind(user.id).run();
        // 再插新的
        const insertRes = await db.prepare("INSERT INTO user_forge (user_id, levels) VALUES (?, ?)").bind(user.id, levelStr).run();

        // C. 立即回读验证 (这一步是为了证明到底存进去没)
        const verify = await db.prepare("SELECT levels FROM user_forge WHERE user_id = ?").bind(user.id).first();

        return Response.json({ 
            success: true, 
            message: '升级成功', 
            new_level: curLv + 1,
            // 👇 调试信息，会在浏览器控制台看到 👇
            debug: {
                user_id: user.id,
                old_db_data: rawDbData,
                trying_to_save: levelStr,
                verified_saved_data: verify ? verify.levels : "READ_FAILED"
            }
        });
    }
}
