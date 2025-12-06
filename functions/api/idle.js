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
                    
                    // 1. 废旧硬件 (Scrap) - 基础掉落 (30% + 水蛭加成)
                    // 以前是 levels['leech']，注意变量名是否一致
                    let leechLv = levels['leech'] || 0; 
                    let scrapRate = 0.30 + (leechLv * 0.05); 
                    if (Math.random() < scrapRate) {
                        totalScrap += Math.floor(1 + (currentL / 50)); // 层数越高给越多
                    }

                    // 2. 违规算法缓存 (Illegal Algo) - 只能卖钱 (10%)
                    if (Math.random() < 0.10) {
                        // 这里的逻辑是直接折算成额外 i币，或者存入新字段
                        // 为了简单，我们先直接折算成大量 i币 (这也是一种“卖出”)
                        totalCoins += 50; 
                    }

                    // 3. 企业数据包 (Data Packet) - 稀有 (1%)
                    // 每 100 层概率提升 0.5%
                    let packetRate = 0.01 + Math.floor(currentL / 100) * 0.005;
                    if (Math.random() < packetRate) {
                        totalPackets++;
                    }

                    // 4. [超稀有] 黑域异常样本 (Blackzone Sample) - 传说 (0.05%)
                    // 这是一个全局 Buff 道具，我们暂时先存到 data_packets 字段里，
                    // 但为了区分，我们可以在前端显示时说 "你获得了一个特殊数据包"
                    // 或者数据库增加一个 'special_items' 字段。
                    // 鉴于目前数据库结构，我们先让它作为 "3个数据包" 的大奖爆出。
                    if (Math.random() < 0.0005) {
                        totalPackets += 3; // 大爆
                    }
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

        // 3. 使用数据包 (Hack: 内幕交易)
        if (body.action === 'use_packet') {
            if (save.data_packets < 1) return Response.json({ error: '没有数据包' });
            
            // === 随机效果判定 (RNG) ===
            const rand = Math.random();
            let effectType = '';
            let message = '';
            
            if (rand < 0.60) {
                // 60% 概率: 普通内幕 (股市预测 Buff)
                effectType = 'buff';
                message = '解析成功：获得短期股市预测算法 (持续10分钟)';
                
                const uData = await db.prepare("SELECT stock_buff_exp FROM users WHERE id=?").bind(user.id).first();
                let newExp = Math.max(now, uData.stock_buff_exp || 0) + (10 * 60 * 1000);
                await db.prepare("UPDATE users SET stock_buff_exp=? WHERE id=?").bind(newExp, user.id).run();
                
            } else if (rand < 0.90) {
                // 30% 概率: 漏洞补丁 (直接修补公司资金/给一笔钱)
                // 模拟“降低创业失败率”比较复杂，不如直接给一笔“风险风投”
                effectType = 'cash';
                const windfall = 2000; // 意外之财
                message = `漏洞利用成功：从企业账户窃取了 ${windfall} k币！`;
                await db.prepare("UPDATE users SET k_coins = k_coins + ? WHERE id=?").bind(windfall, user.id).run();
                
            } else {
                // 10% 概率: 市场污染 (Market Distortion) - 所谓的“副作用”
                // 其实是给玩家一个巨大的临时算力 Buff，还是反向 Buff？
                // 既然是副作用，我们可以扣除一点点当前算力，或者...
                // 按照你的设计，这是一个短期的全局事件。
                // 简化实现：获得大量“废旧硬件”但扣除少量“i币” (痕迹清理费)
                effectType = 'distortion';
                const scrapGain = 500;
                const coinCost = 1000;
                
                if (user.coins < coinCost) {
                    message = "解密失败：触发追踪程序，紧急断开连接。";
                } else {
                    message = `数据污染：获得 ${scrapGain} 硬件，但支付了 ${coinCost} i币用于清理痕迹。`;
                    await db.prepare("UPDATE users SET coins = coins - ? WHERE id=?").bind(coinCost, user.id).run();
                    await db.prepare("UPDATE idle_saves SET scrap_hardware = scrap_hardware + ? WHERE user_id=?").bind(scrapGain, user.id).run();
                }
            }

            // 消耗道具
            await db.prepare("UPDATE idle_saves SET data_packets=data_packets-1 WHERE user_id=?").bind(user.id).run();

            return Response.json({ success: true, message: message, effect: effectType });
        }
    }

    return Response.json({ error: 'Invalid' });
}
