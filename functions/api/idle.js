// --- START OF FILE functions/api/idle.js ---

// === 1. 游戏数值配置 ===
const UNITS = {
    'kiddie': { name: '脚本小子', base_dps: 2,   base_cost: 10,  cost_inc: 1.5, desc: '基础算力单位' },
    'leech':  { name: '数据水蛭', base_dps: 10,  base_cost: 100, cost_inc: 1.6, desc: '增加硬件掉落率' },
    'ice':    { name: '攻性防壁', base_dps: 50,  base_cost: 500, cost_inc: 1.7, desc: '稳定推进核心' },
    'ghost':  { name: '幽灵 AI',  base_dps: 300, base_cost: 2000,cost_inc: 1.8, desc: '极高攻坚能力' }
};

// 层数血量公式：100 * (1.1 ^ (Layer-1))
function getLayerHP(layer) {
    return Math.floor(100 * Math.pow(1.10, layer - 1));
}

// 基础 i币 奖励公式
function getLayerCoinReward(layer) {
    // 每一层给 5 ~ 10 i币 (随层数微涨)
    return Math.floor(5 + (layer * 0.5));
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id, coins FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    // 初始化存档
    let save = await db.prepare("SELECT * FROM idle_saves WHERE user_id = ?").bind(user.id).first();
    const now = Date.now();
    if (!save) {
        await db.prepare("INSERT INTO idle_saves (user_id, last_claim_time, unit_levels) VALUES (?, ?, ?)")
            .bind(user.id, now, JSON.stringify({ kiddie: 1, leech: 0, ice: 0, ghost: 0 })).run();
        save = { current_layer: 1, scrap_hardware: 0, data_packets: 0, unit_levels: '{"kiddie":1}', last_claim_time: now };
    }

    const levels = JSON.parse(save.unit_levels || '{}');

    // 计算总 DPS
    let totalDPS = 0;
    for (let key in UNITS) {
        if (levels[key]) totalDPS += levels[key] * UNITS[key].base_dps;
    }

    // === GET: 获取状态 & 预览收益 ===
    if (request.method === 'GET') {
        const timeDiff = (now - save.last_claim_time) / 1000; // 秒
        return Response.json({
            success: true,
            layer: save.current_layer,
            scrap: save.scrap_hardware,
            packets: save.data_packets,
            levels: levels,
            dps: totalDPS,
            config: UNITS,
            hp: getLayerHP(save.current_layer),
            offline_sec: timeDiff
        });
    }

    // === POST: 操作 ===
    if (request.method === 'POST') {
        const body = await request.json();

        // 1. 领取收益 (Claim)
        if (body.action === 'claim') {
            const timeDiff = (now - save.last_claim_time) / 1000;
            if (timeDiff < 5) return Response.json({ error: '冷却中' });
            if (totalDPS === 0) return Response.json({ error: '无算力' });

            let damage = totalDPS * timeDiff;
            let layersCleared = 0;
            let currentL = save.current_layer;
            let totalCoins = 0;
            let totalScrap = 0;
            let totalPackets = 0;

            // 模拟推层 (上限 1000 层防止超时)
            while (damage > 0 && layersCleared < 1000) {
                let hp = getLayerHP(currentL);
                if (damage >= hp) {
                    damage -= hp;
                    layersCleared++;
                    currentL++;
                    
                    // 计算掉落
                    totalCoins += getLayerCoinReward(currentL);
                    
                    // 硬件掉落：基础 10% + 水蛭加成 (每级 +2%)
                    let scrapRate = 0.10 + ((levels['leech'] || 0) * 0.02);
                    if (Math.random() < scrapRate) totalScrap++;

                    // 数据包掉落：基础 0.5% (极稀有)
                    if (Math.random() < 0.005) totalPackets++;
                } else {
                    break; 
                }
            }

            // 至少每小时保底给点硬件，防止非洲人卡关
            if (timeDiff > 3600 && totalScrap === 0) totalScrap = Math.floor(timeDiff / 3600);

            // 更新数据库
            await db.batch([
                db.prepare("UPDATE idle_saves SET current_layer=?, scrap_hardware=scrap_hardware+?, data_packets=data_packets+?, last_claim_time=? WHERE user_id=?")
                  .bind(currentL, totalScrap, totalPackets, now, user.id),
                db.prepare("UPDATE users SET coins=coins+? WHERE id=?").bind(totalCoins, user.id)
            ]);

            return Response.json({ 
                success: true, 
                cleared: layersCleared, 
                coins: totalCoins, 
                scrap: totalScrap, 
                packets: totalPackets,
                new_layer: currentL 
            });
        }

        // 2. 升级单位 (Upgrade) - 消耗硬件(Scrap)
        if (body.action === 'upgrade') {
            const u = UNITS[body.unit];
            if (!u) return Response.json({ error: '无效单位' });
            
            const curLv = levels[body.unit] || 0;
            // 费用公式
            const cost = Math.floor(u.base_cost * Math.pow(u.cost_inc, curLv));

            // 检查资源 (硬件)
            if (save.scrap_hardware < cost) return Response.json({ error: `硬件不足 (需 ${cost})` });

            levels[body.unit] = curLv + 1;
            
            await db.prepare("UPDATE idle_saves SET scrap_hardware=scrap_hardware-?, unit_levels=? WHERE user_id=?")
                .bind(cost, JSON.stringify(levels), user.id).run();

            return Response.json({ success: true, message: '升级成功', level: curLv + 1 });
        }

        // 3. 使用数据包 (Use Packet) - 股市 Buff
        if (body.action === 'use_packet') {
            if (save.data_packets < 1) return Response.json({ error: '没有数据包' });
            
            // 增加 10 分钟 Buff 时间
            // 如果当前已有 Buff，则延长；否则从现在开始
            // 需要先查一下当前 user.stock_buff_exp (这里为了省一次查询，直接用 update 逻辑处理)
            
            // 获取当前 Buff 状态
            const uData = await db.prepare("SELECT stock_buff_exp FROM users WHERE id=?").bind(user.id).first();
            let newExp = Math.max(now, uData.stock_buff_exp || 0) + (10 * 60 * 1000);

            await db.batch([
                db.prepare("UPDATE idle_saves SET data_packets=data_packets-1 WHERE user_id=?").bind(user.id),
                db.prepare("UPDATE users SET stock_buff_exp=? WHERE id=?").bind(newExp, user.id)
            ]);

            return Response.json({ success: true, message: '股市预测算法已优化 (持续10分钟)' });
        }
    }

    return Response.json({ error: 'Invalid' });
}
