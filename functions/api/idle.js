// --- START OF FILE functions/api/idle.js ---

// === 1. 游戏数值配置 (Game Design Config) ===
const DAEMONS = {
    'script_kiddie': { name: '脚本小子', base_cost: 10, base_dps: 1, cost_factor: 1.5 },
    'data_leech':    { name: '数据水蛭', base_cost: 100, base_dps: 8, cost_factor: 1.4 },
    'trojan_horse':  { name: '特洛伊木马', base_cost: 1000, base_dps: 50, cost_factor: 1.3 },
    'logic_bomb':    { name: '逻辑炸弹', base_cost: 8000, base_dps: 250, cost_factor: 1.3 },
    'black_ice':     { name: '黑色障壁', base_cost: 50000, base_dps: 1200, cost_factor: 1.25 }
};

// 每一层的怪物血量增长公式：Base * (1.1 ^ (Layer-1))
function getLayerHP(layer) {
    return Math.floor(100 * Math.pow(1.15, layer - 1));
}

// 每一层的掉落奖励 (数据区块)
function getLayerReward(layer) {
    return Math.floor(5 * Math.pow(1.10, layer - 1));
}

// 计算升级费用
function getUpgradeCost(id, currentLv) {
    const unit = DAEMONS[id];
    return Math.floor(unit.base_cost * Math.pow(unit.cost_factor, currentLv));
}

// 计算总 DPS
function calculateTotalDPS(levels) {
    let dps = 0;
    for (const [id, lv] of Object.entries(levels)) {
        if (DAEMONS[id] && lv > 0) {
            dps += DAEMONS[id].base_dps * lv;
        }
    }
    return dps; // 基础每秒伤害
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权 (复用之前的逻辑)
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id, coins FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    // 2. 获取或初始化挂机存档
    let save = await db.prepare("SELECT * FROM idle_game WHERE user_id = ?").bind(user.id).first();
    if (!save) {
        await db.prepare("INSERT INTO idle_game (user_id, last_claim_time) VALUES (?, ?)").bind(user.id, Date.now()).run();
        save = { current_layer: 1, data_blocks: 0, daemon_levels: '{}', last_claim_time: Date.now() };
    }

    const levels = JSON.parse(save.daemon_levels || '{}');
    let currentBlocks = save.data_blocks;
    let currentLayer = save.current_layer;
    const now = Date.now();

    if (request.method === 'GET') {
        // === 查询状态 & 预估离线收益 ===
        const dps = calculateTotalDPS(levels);
        const timeDiff = (now - save.last_claim_time) / 1000; // 秒
        
        // 简单模拟推图进度
        // 实际上后端不真推，只返回 dps 和 资源，前端模拟动画。
        // 但领奖时需要真算。这里 GET 只返回状态。
        
        return Response.json({
            success: true,
            layer: currentLayer,
            blocks: currentBlocks,
            levels: levels,
            dps: dps,
            config: DAEMONS,
            layer_hp: getLayerHP(currentLayer),
            offline_seconds: timeDiff
        });
    }

    if (request.method === 'POST') {
        const body = await request.json();
        const action = body.action;

        // === 核心逻辑 A: 领取离线收益 (Claim) ===
        if (action === 'claim') {
            const dps = calculateTotalDPS(levels);
            const timeDiff = (now - save.last_claim_time) / 1000;
            
            if (timeDiff < 10) return Response.json({ error: '太频繁了，让子弹飞一会儿' });
            if (dps === 0) {
                // 没兵，只更新时间
                await db.prepare("UPDATE idle_game SET last_claim_time = ? WHERE user_id = ?").bind(now, user.id).run();
                return Response.json({ success: true, message: "暂无算力，无法挂机" });
            }

            // 计算推了多少层
            // 逻辑：总伤害 = DPS * 时间。看能打死多少只怪。
            let damagePool = dps * timeDiff;
            let layersCleared = 0;
            let blocksGained = 0;
            let coinsGained = 0; // i币收益 (少量)

            // 循环扣血模拟 (限制最大循环防止超时，比如最多推1000层)
            let simLayer = currentLayer;
            while (damagePool > 0 && layersCleared < 500) {
                const hp = getLayerHP(simLayer);
                if (damagePool >= hp) {
                    damagePool -= hp;
                    simLayer++;
                    layersCleared++;
                    blocksGained += getLayerReward(simLayer);
                    // 每层给予 1% 层数的 i币 (e.g. 100层给 1 i币)
                    coinsGained += Math.max(0.1, simLayer * 0.05); 
                } else {
                    break; // 打不动了
                }
            }

            const finalCoins = Math.floor(coinsGained);
            
            // 更新数据库
            await db.batch([
                db.prepare("UPDATE idle_game SET current_layer = ?, data_blocks = data_blocks + ?, last_claim_time = ? WHERE user_id = ?")
                  .bind(simLayer, blocksGained, now, user.id),
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(finalCoins, user.id)
            ]);

            return Response.json({ 
                success: true, 
                cleared: layersCleared, 
                blocks: blocksGained, 
                coins: finalCoins,
                new_layer: simLayer 
            });
        }

        // === 核心逻辑 B: 升级单位 (Upgrade) ===
        if (action === 'upgrade') {
            const unitId = body.unitId;
            if (!DAEMONS[unitId]) return Response.json({ error: '无效单位' });

            const currentLv = levels[unitId] || 0;
            const cost = getUpgradeCost(unitId, currentLv);

            // 扣费逻辑：优先扣 Data Blocks，如果是 Lv.0 升 Lv.1 允许扣 iCoins (作为启动资金)
            // 这里为了简化，Lv.0 -> Lv.1 强制扣 iCoins，后续扣 Blocks
            if (currentLv === 0) {
                if (user.coins < cost) return Response.json({ error: `i币不足 (需 ${cost})` });
                levels[unitId] = 1;
                await db.batch([
                    db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").bind(cost, user.id),
                    db.prepare("UPDATE idle_game SET daemon_levels = ? WHERE user_id = ?").bind(JSON.stringify(levels), user.id)
                ]);
            } else {
                if (currentBlocks < cost) return Response.json({ error: `区块不足 (需 ${cost})` });
                levels[unitId] = currentLv + 1;
                await db.batch([
                    db.prepare("UPDATE idle_game SET data_blocks = data_blocks - ?, daemon_levels = ? WHERE user_id = ?")
                      .bind(cost, JSON.stringify(levels), user.id)
                ]);
            }

            return Response.json({ success: true, message: "升级成功", new_level: levels[unitId] });
        }
    }

    return Response.json({ error: 'Invalid' });
}
