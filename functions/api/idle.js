// --- START OF FILE functions/api/idle.js (v4.1 FULL) ---

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
    return Math.floor(5 + (layer * 0.5));
}

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    try {
        // 1. 鉴权
        const cookie = request.headers.get('Cookie');
        if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
        const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
        if (!sessionId) return Response.json({ error: 'No Session' }, { status: 401 });
        
        const user = await db.prepare('SELECT id, coins FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
        if (!user) return Response.json({ error: 'Auth Failed' }, { status: 401 });

        // 2. 初始化/读取存档 (使用 idle_saves 表)
        let save = await db.prepare("SELECT * FROM idle_saves WHERE user_id = ?").bind(user.id).first();
        const now = Date.now();
        
        if (!save) {
            // 初始化新存档
            const initLevels = JSON.stringify({ kiddie: 1, leech: 0, ice: 0, ghost: 0 });
            await db.prepare("INSERT INTO idle_saves (user_id, last_claim_time, unit_levels, current_layer, scrap_hardware, data_packets) VALUES (?, ?, ?, 1, 0, 0)")
                .bind(user.id, now, initLevels).run();
            // 重新读取以确保格式正确
            save = { 
                current_layer: 1, 
                scrap_hardware: 0, 
                data_packets: 0, 
                unit_levels: initLevels, 
                last_claim_time: now 
            };
        }

        const levels = JSON.parse(save.unit_levels || '{}');

        // 计算总 DPS
        let totalDPS = 0;
        for (let key in UNITS) {
            if (levels[key]) totalDPS += levels[key] * UNITS[key].base_dps;
        }

        // === GET: 获取状态 ===
        if (request.method === 'GET') {
            const timeDiff = Math.max(0, (now - save.last_claim_time) / 1000);
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

        // === POST: 交互逻辑 ===
        if (request.method === 'POST') {
            const body = await request.json();

            // Action: 领取收益 (v4.2 修复进度回档问题)
            if (body.action === 'claim') {
                const timeDiff = (now - save.last_claim_time) / 1000;
                // 移除 "timeDiff < 5" 的硬性限制，允许频繁查看进度，只要有伤害就行
                if (totalDPS === 0) return Response.json({ error: '暂无算力' });

                let damage = totalDPS * timeDiff;
                let layersCleared = 0;
                let currentL = save.current_layer;
                let totalCoins = 0;
                let totalScrap = 0;
                let totalPackets = 0;

                // 模拟推塔
                while (damage > 0 && layersCleared < 1000) {
                    let hp = getLayerHP(currentL);
                    if (damage >= hp) {
                        damage -= hp; // 扣除致死伤害
                        layersCleared++;
                        currentL++;
                        
                        // 1. i币奖励
                        totalCoins += getLayerCoinReward(currentL);
                        
                        // 2. 硬件掉落
                        let baseScrap = 1; 
                        let leechLv = levels['leech'] || 0;
                        let critRate = 0.30 + (leechLv * 0.05); 
                        if (Math.random() < critRate) baseScrap += Math.floor(1 + (currentL / 20)); 
                        totalScrap += baseScrap;

                        // 3. 违规算法
                        if (Math.random() < 0.10) totalCoins += 50;

                        // 4. 企业数据包
                        let packetRate = 0.02 + Math.floor(currentL / 100) * 0.005;
                        if (Math.random() < packetRate) totalPackets++;

                    } else {
                        // 伤害不足以击杀当前层，跳出
                        break; 
                    }
                }
                
                // === 关键修复：计算新时间戳 ===
                // 我们不能简单设为 now。要把“剩余伤害”换算回“剩余时间”，保留给下一次。
                // 剩余时间 = 剩余伤害 / DPS
                // 新的结算时间 = 当前时间 - 剩余时间
                // 这样，剩下的伤害就被“冻结”在时间里了，不会丢失。
                let remainingTimeSeconds = damage / totalDPS;
                let newClaimTime = now - Math.floor(remainingTimeSeconds * 1000);

                // 保底机制
                if (timeDiff > 3600 && totalScrap === 0) totalScrap = Math.floor(timeDiff / 600);

                // 更新数据库
                await db.batch([
                    db.prepare("UPDATE idle_saves SET current_layer=?, scrap_hardware=scrap_hardware+?, data_packets=data_packets+?, last_claim_time=? WHERE user_id=?")
                      .bind(currentL, totalScrap, totalPackets, newClaimTime, user.id),
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

            // Action: 升级
            if (body.action === 'upgrade') {
                const u = UNITS[body.unit];
                if (!u) return Response.json({ error: '无效单位' });
                
                const curLv = levels[body.unit] || 0;
                // 费用公式
                const cost = Math.floor(u.base_cost * Math.pow(u.cost_inc, curLv));

                // 检查资源
                if (save.scrap_hardware < cost) return Response.json({ error: `废旧硬件不足 (需 ${cost})` });

                levels[body.unit] = curLv + 1;
                
                await db.prepare("UPDATE idle_saves SET scrap_hardware=scrap_hardware-?, unit_levels=? WHERE user_id=?")
                    .bind(cost, JSON.stringify(levels), user.id).run();

                return Response.json({ success: true, message: '升级成功', level: curLv + 1 });
            }

            // Action: 使用数据包
            if (body.action === 'use_packet') {
                if (save.data_packets < 1) return Response.json({ error: '没有数据包' });
                
                const rand = Math.random();
                let effectType = '';
                let message = '';
                
                if (rand < 0.60) {
                    // Buff
                    effectType = 'buff';
                    message = '解析成功：获得短期股市预测算法 (10分钟)';
                    const uData = await db.prepare("SELECT stock_buff_exp FROM users WHERE id=?").bind(user.id).first();
                    let newExp = Math.max(now, uData.stock_buff_exp || 0) + (10 * 60 * 1000);
                    await db.prepare("UPDATE users SET stock_buff_exp=? WHERE id=?").bind(newExp, user.id).run();
                } else if (rand < 0.90) {
                    // Cash
                    effectType = 'cash';
                    const windfall = 2000;
                    message = `漏洞利用成功：窃取了 ${windfall} k币！`;
                    await db.prepare("UPDATE users SET k_coins = k_coins + ? WHERE id=?").bind(windfall, user.id).run();
                } else {
                    // Distortion (副作用)
                    effectType = 'distortion';
                    const scrapGain = 500;
                    const coinCost = 1000;
                    if (user.coins < coinCost) {
                        message = "解密失败：触发追踪程序，紧急断开连接。";
                    } else {
                        message = `数据污染：获得 ${scrapGain} 硬件，支付 ${coinCost} i币清理痕迹。`;
                        await db.batch([
                            db.prepare("UPDATE users SET coins = coins - ? WHERE id=?").bind(coinCost, user.id),
                            db.prepare("UPDATE idle_saves SET scrap_hardware = scrap_hardware + ? WHERE user_id=?").bind(scrapGain, user.id)
                        ]);
                    }
                }

                await db.prepare("UPDATE idle_saves SET data_packets=data_packets-1 WHERE user_id=?").bind(user.id).run();
                return Response.json({ success: true, message: message, effect: effectType });
            }
        }

        return Response.json({ error: 'Invalid Action' });

    } catch (err) {
        // 捕获所有后端错误并返回详情，方便调试
        return Response.json({ 
            success: false, 
            error: "Server Error: " + err.message, 
            stack: err.stack 
        }, { status: 500 });
    }
}
