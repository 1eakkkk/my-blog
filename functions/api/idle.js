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
        let evaEmotion = 'CALM';
        try {
            const evaData = await env.KV.get("eva_l00p_state", {type:'json'});
            if (evaData) evaEmotion = evaData.emotion;
        } catch(e) {}
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

            // Action: 领取收益 (v4.3 性能优化版)
            if (body.action === 'claim') {
                const timeDiff = Math.max(0, (now - save.last_claim_time) / 1000);
                if (totalDPS === 0) return Response.json({ error: '暂无算力' });

                // 限制最大计算时长，防止 Cloudflare Worker 超时 (Error 1101)
                // 300 层是一个比较安全的计算量
                const MAX_LAYERS_PER_SYNC = 300; 

                let damage = totalDPS * timeDiff;
                let layersCleared = 0;
                let currentL = save.current_layer;
                let totalCoins = 0;
                let totalScrap = 0;
                let totalPackets = 0;

                // 模拟推塔
                while (damage > 0 && layersCleared < MAX_LAYERS_PER_SYNC) {
                    let hp = getLayerHP(currentL);
                    if (damage >= hp) {
                        damage -= hp; 
                        layersCleared++;
                        currentL++;
                        
                        // 1. i币
                        totalCoins += getLayerCoinReward(currentL);
                        
                        // 2. 硬件 (保底 + 暴击)
                        let baseScrap = 1; 
                        let leechLv = levels['leech'] || 0;
                        let critRate = 0.30 + (leechLv * 0.05); 
                        if (Math.random() < critRate) baseScrap += Math.floor(1 + (currentL / 20)); 
                        totalScrap += baseScrap;

                        // 3. 违规算法
                        if (Math.random() < 0.10) totalCoins += 50;

                        // 4. 数据包
                        let packetRate = 0.02 + Math.floor(currentL / 100) * 0.005;
                        if (Math.random() < packetRate) totalPackets++;

                    } else {
                        break; // 伤害耗尽，卡在当前层
                    }
                }
                
                // === 时间结算逻辑优化 ===
                let newClaimTime = now;
                
                // 情况 A: 到达了 300 层上限，还有剩余伤害
                // 这种情况下，为了防止计算超时和无限刷层，直接丢弃剩余伤害，重置时间为 Now
                if (layersCleared >= MAX_LAYERS_PER_SYNC) {
                    newClaimTime = now;
                } 
                // 情况 B: 没打死怪 (卡关)，或者没到上限
                // 这种情况下，保留进度 (Time Debt)，让玩家下次接着打
                else {
                    let remainingTimeSeconds = damage / totalDPS;
                    // 保护：保留时间不能超过 24小时 (防止溢出 Bug)
                    remainingTimeSeconds = Math.min(remainingTimeSeconds, 86400);
                    newClaimTime = now - Math.floor(remainingTimeSeconds * 1000);
                }

                // 低保
                if (timeDiff > 3600 && totalScrap === 0) totalScrap = Math.floor(timeDiff / 600);

                // 数据库写入
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
            // Action: 升级 (v4.3 混合供能版)
            if (body.action === 'upgrade') {
                const u = UNITS[body.unit];
                if (!u) return Response.json({ error: '无效单位' });
                
                const curLv = levels[body.unit] || 0;
                
                // === 混合消耗逻辑 ===
                let costType = 'scrap'; // 默认消耗硬件
                let costAmount = 0;
                const coinExchangeRate = 50; // 1 硬件价值约等于 50 i币 (设定汇率)

                if (body.unit === 'kiddie') {
                    // T1 脚本小子：永远消耗 i币 (让新手快速起步)
                    costType = 'coins';
                    // 基础花费 10 * 50 = 500 i币起步
                    costAmount = Math.floor(u.base_cost * coinExchangeRate * Math.pow(u.cost_inc, curLv));
                } else {
                    // T2-T4 高级单位：交替升级
                    // 偶数等级(0, 2, 4...) -> 升下一级消耗 i币 (购买设备)
                    // 奇数等级(1, 3, 5...) -> 升下一级消耗 硬件 (改装优化)
                    if (curLv % 2 === 0) {
                        costType = 'coins';
                        costAmount = Math.floor(u.base_cost * coinExchangeRate * Math.pow(u.cost_inc, curLv));
                    } else {
                        costType = 'scrap';
                        costAmount = Math.floor(u.base_cost * Math.pow(u.cost_inc, curLv));
                    }
                }

                // 检查资源
                if (costType === 'coins') {
                    if (user.coins < costAmount) return Response.json({ error: `i币不足 (需 ${costAmount.toLocaleString()})` });
                    // 扣 i币
                    await db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").bind(costAmount, user.id).run();
                } else {
                    if (save.scrap_hardware < costAmount) return Response.json({ error: `硬件不足 (需 ${costAmount})` });
                    // 扣 硬件
                    await db.prepare("UPDATE idle_saves SET scrap_hardware = scrap_hardware - ? WHERE user_id = ?").bind(costAmount, user.id).run();
                }

                // 执行升级
                levels[body.unit] = curLv + 1;
                await db.prepare("UPDATE idle_saves SET unit_levels=? WHERE user_id=?")
                    .bind(JSON.stringify(levels), user.id).run();

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
