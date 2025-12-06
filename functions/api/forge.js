// --- START OF FILE functions/api/forge.js (Auto-Repair Version) ---

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

    // === 核心修复：数据合并与清洗 ===
    // 1. 读取主表 (users)
    const userData = await db.prepare("SELECT forge_levels FROM users WHERE id = ?").bind(user.id).first();
    let levelsA = {};
    try { levelsA = userData && userData.forge_levels ? JSON.parse(userData.forge_levels) : {}; } catch(e){}

    // 2. 读取旧表 (user_forge) - 以防数据还留在那
    let levelsB = {};
    try {
        const oldData = await db.prepare("SELECT levels FROM user_forge WHERE user_id = ?").bind(user.id).first();
        levelsB = oldData && oldData.levels ? JSON.parse(oldData.levels) : {};
    } catch(e) {}

    // 3. 合并数据 (取最大值)
    let finalLevels = { ...levelsA };
    for (let key in levelsB) {
        if (!finalLevels[key] || levelsB[key] > finalLevels[key]) {
            finalLevels[key] = levelsB[key];
        }
    }

    // === GET: 返回数据前，强制同步一次 ===
    if (request.method === 'GET') {
        // 如果旧表有数据，或者主表数据为空但合并后有值，执行一次同步写入
        if (Object.keys(levelsB).length > 0 || JSON.stringify(finalLevels) !== JSON.stringify(levelsA)) {
             await db.prepare("UPDATE users SET forge_levels = ? WHERE id = ?")
                .bind(JSON.stringify(finalLevels), user.id).run();
        }
        
        return Response.json({ 
            success: true, 
            levels: finalLevels, 
            config: FORGE_CONFIG,
            debug_source: `Merged A:${Object.keys(levelsA).length} B:${Object.keys(levelsB).length}`
        });
    }

    // === POST: 升级 ===
    if (request.method === 'POST') {
        const body = await request.json();
        const type = body.type;
        const conf = FORGE_CONFIG[type];
        
        if (!conf) return Response.json({ error: '未知类型' });

        const curLv = finalLevels[type] || 0;
        if (curLv >= conf.max) return Response.json({ error: '满级' });

        const cost = Math.floor(conf.base_cost * Math.pow(1.1, curLv));
        if (user.k_coins < cost) return Response.json({ error: 'K币不足' });

        // 升级
        finalLevels[type] = curLv + 1;
        
        // 写入主表 (users)
        await db.prepare("UPDATE users SET k_coins = k_coins - ?, forge_levels = ? WHERE id = ?")
            .bind(cost, JSON.stringify(finalLevels), user.id).run();

        // 顺手删掉旧表数据，避免混淆 (可选)
        // await db.prepare("DELETE FROM user_forge WHERE user_id = ?").bind(user.id).run();

        return Response.json({ success: true, message: '锻造成功', new_level: curLv + 1 });
    }
}
