// functions/api/home.js

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ success: false, error: '未登录' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare(`SELECT id FROM users JOIN sessions ON users.id = sessions.user_id WHERE sessions.session_id = ?`).bind(sessionId).first();
    if (!user) return Response.json({ success: false, error: '会话无效' }, { status: 401 });

    const method = request.method;

    // === 配置常量 ===
    const SEEDS = {
        'seed_moss': { name: '低频缓存苔藓', duration: 4 * 60 * 60 * 1000, reward_coins: 50, reward_xp: 20 },
        'seed_quantum': { name: '量子枝条', duration: 12 * 60 * 60 * 1000, reward_coins: 180, reward_xp: 80 },
        'seed_vine': { name: '修复算法藤', duration: 24 * 60 * 60 * 1000, reward_coins: 400, reward_xp: 200 }
    };
    
    const WORKS = {
        'cleaning': { name: '数据清理', duration: 2 * 60 * 1000, reward: 15 },
        'sorting':  { name: '缓存整理', duration: 10 * 60 * 1000, reward: 80 },
        'debug':    { name: '黑盒调试', duration: 60 * 60 * 1000, reward: 500 }
    };

    // === GET: 获取家园和打工状态 ===
    if (method === 'GET') {
        const homeItems = await db.prepare("SELECT * FROM home_items WHERE user_id = ?").bind(user.id).all();
        const workStatus = await db.prepare("SELECT * FROM user_works WHERE user_id = ?").bind(user.id).first();
        
        return Response.json({ 
            success: true, 
            home: homeItems.results, 
            work: workStatus 
        });
    }

    // === POST: 操作 ===
    if (method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch(e) {}
        const { action } = body;
        const now = Date.now();

        // --- 1. 种植 (Plant) ---
        if (action === 'plant') {
            const { slotIndex, seedId } = body;
            const seedConfig = SEEDS[seedId];
            if (!seedConfig) return Response.json({ success: false, error: '无效的种子类型' });

            // 检查背包
            const hasSeed = await db.prepare("SELECT id, quantity FROM user_items WHERE user_id = ? AND item_id = ? AND quantity > 0").bind(user.id, seedId).first();
            if (!hasSeed) return Response.json({ success: false, error: '背包内缺少该种子' });

            // 检查槽位
            const occupied = await db.prepare("SELECT id FROM home_items WHERE user_id = ? AND slot_index = ?").bind(user.id, slotIndex).first();
            if (occupied) return Response.json({ success: false, error: '该槽位已有植物' });

            // 事务：扣除种子 -> 种植
            const batch = [
                db.prepare("UPDATE user_items SET quantity = quantity - 1 WHERE id = ?").bind(hasSeed.id),
                db.prepare("DELETE FROM user_items WHERE id = ? AND quantity <= 0").bind(hasSeed.id),
                db.prepare("INSERT INTO home_items (user_id, slot_index, item_id, created_at, harvest_at) VALUES (?, ?, ?, ?, ?)")
                  .bind(user.id, slotIndex, seedId, now, now + seedConfig.duration)
            ];
            await db.batch(batch);

            return Response.json({ success: true, message: `正在编译: ${seedConfig.name}` });
        }

        // --- 2. 收获 (Harvest) - 含掉落逻辑 ---
        if (action === 'harvest') {
            const { slotIndex } = body;
            const item = await db.prepare("SELECT * FROM home_items WHERE user_id = ? AND slot_index = ?").bind(user.id, slotIndex).first();
            
            if (!item) return Response.json({ success: false, error: '槽位为空' });
            if (now < item.harvest_at) return Response.json({ success: false, error: '算法尚未运行完毕' });

            const config = SEEDS[item.item_id];
            if (!config) {
                await db.prepare("DELETE FROM home_items WHERE id = ?").bind(item.id).run();
                return Response.json({ success: false, error: '数据异常，已重置槽位' });
            }

            // === 掉落概率计算 ===
            const DROP_RATE = 0.15; // 15% 概率
            const dropRandom = Math.random();
            let dropMessage = "";
            
            // 初始化 batch (这是唯一一次定义 batch)
            const batch = [
                db.prepare("UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id = ?").bind(config.reward_coins, config.reward_xp, user.id),
                db.prepare("DELETE FROM home_items WHERE id = ?").bind(item.id)
            ];

            // 如果触发掉落
            if (dropRandom < DROP_RATE) {
                const existingItem = await db.prepare("SELECT id FROM user_items WHERE user_id = ? AND item_id = 'item_algo_frag'").bind(user.id).first();
                
                if (existingItem) {
                    batch.push(db.prepare("UPDATE user_items SET quantity = quantity + 1 WHERE id = ?").bind(existingItem.id));
                } else {
                    batch.push(db.prepare("INSERT INTO user_items (user_id, item_id, quantity, type, category, created_at) VALUES (?, 'item_algo_frag', 1, 'consumable', 'consumable', ?)")
                        .bind(user.id, now));
                }
                dropMessage = " 🎁 获得: 加速算法碎片!";
            }

            await db.batch(batch);
            return Response.json({ success: true, message: `收获成功: +${config.reward_coins} i币, +${config.reward_xp} XP${dropMessage}` });
        }

        // --- 3. 开始打工 (Start Work) ---
        if (action === 'start_work') {
            const { workType } = body;
            const config = WORKS[workType];
            if (!config) return Response.json({ success: false, error: '未知任务' });

            const current = await db.prepare("SELECT * FROM user_works WHERE user_id = ?").bind(user.id).first();
            if (current) return Response.json({ success: false, error: '已有任务正在进行中' });

            await db.prepare("INSERT INTO user_works (user_id, work_type, start_time, end_time) VALUES (?, ?, ?, ?)")
                .bind(user.id, workType, now, now + config.duration).run();

            return Response.json({ success: true, message: '任务挂载成功' });
        }

        // --- 4. 结算打工 (Claim Work) ---
        if (action === 'claim_work') {
            const current = await db.prepare("SELECT * FROM user_works WHERE user_id = ?").bind(user.id).first();
            if (!current) return Response.json({ success: false, error: '当前无任务' });

            if (now < current.end_time) {
                const left = Math.ceil((current.end_time - now) / 1000);
                return Response.json({ success: false, error: `任务运行中，剩余 ${left} 秒` });
            }

            const config = WORKS[current.work_type];
            
            // 这里定义的是一个新的 batch 变量，因为在不同的 if 块中，所以是合法的
            const batch = [
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(config.reward, user.id),
                db.prepare("DELETE FROM user_works WHERE user_id = ?").bind(user.id)
            ];
            await db.batch(batch);

            return Response.json({ success: true, message: `任务结算完毕: +${config.reward} i币` });
        }
        
        // --- 5. 放弃任务 ---
        if (action === 'cancel_work') {
            await db.prepare("DELETE FROM user_works WHERE user_id = ?").bind(user.id).run();
            return Response.json({ success: true, message: '任务已终止 (无收益)' });
        }
    }

    return Response.json({ success: false, error: 'Method Error' });
}
