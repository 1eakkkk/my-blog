// --- functions/api/home.js (最终修复版) ---

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    try {
        // 1. 鉴权
        const cookie = request.headers.get('Cookie');
        if (!cookie) return Response.json({ success: false, error: '未登录' }, { status: 401 });
        const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
        const user = await db.prepare(`SELECT id, coins, xp FROM users JOIN sessions ON users.id = sessions.user_id WHERE sessions.session_id = ?`).bind(sessionId).first();
        if (!user) return Response.json({ success: false, error: '会话无效' }, { status: 401 });

        const method = request.method;

        // 配置常量 (Seeds & Works)
        const SEEDS = {
            'seed_moss': { name: '低频缓存苔藓', duration: 4 * 60 * 60 * 1000, reward_coins: 50, reward_xp: 20 },
            'seed_quantum': { name: '量子枝条', duration: 12 * 60 * 60 * 1000, reward_coins: 180, reward_xp: 80 },
            'seed_vine': { name: '修复算法藤', duration: 24 * 60 * 60 * 1000, reward_coins: 400, reward_xp: 200 }
        };
        const WORKS = {
            'cleaning': { name: '数据清理', duration: 10 * 60 * 1000, reward: 20 },
            'sorting':  { name: '缓存整理', duration: 30 * 60 * 1000, reward: 60 },
            'debug':    { name: '黑盒调试', duration: 60 * 60 * 1000, reward: 120 },
            'deepcleaning': { name: '深度清理', duration: 3 * 60 * 60 * 1000, reward: 360 },
            'fixbug':    { name: '修复漏洞', duration: 6 * 60 * 60 * 1000, reward: 720 },
            'sleeptest': { name: '睡眠测试', duration: 10 * 60 * 60 * 1000, reward: 1200 }
        };

        // === GET: 获取状态 ===
        if (method === 'GET') {
            const homeItems = await db.prepare("SELECT * FROM home_items WHERE user_id = ?").bind(user.id).all();
            const workStatus = await db.prepare("SELECT * FROM user_works WHERE user_id = ?").bind(user.id).first();
            return Response.json({ success: true, home: homeItems.results, work: workStatus });
        }

        // === POST: 执行操作 ===
        if (method === 'POST') {
            let body = {};
            try { body = await request.json(); } catch(e) {}
            const { action } = body;
            const now = Date.now();

            // --- 1. 种植 (Plant) ---
            if (action === 'plant') {
                const { slotIndex, seedId } = body;
                const seedConfig = SEEDS[seedId];
                if (!seedConfig) return Response.json({ success: false, error: '无效种子' });

                // 检查背包
                const hasSeed = await db.prepare("SELECT id, quantity FROM user_items WHERE user_id = ? AND item_id = ? AND quantity > 0").bind(user.id, seedId).first();
                if (!hasSeed) return Response.json({ success: false, error: '背包内无此种子' });

                // 检查槽位
                const occupied = await db.prepare("SELECT id FROM home_items WHERE user_id = ? AND slot_index = ?").bind(user.id, slotIndex).first();
                if (occupied) return Response.json({ success: false, error: '该槽位已有植物' });

                try {
                    await db.batch([
                        db.prepare("UPDATE user_items SET quantity = quantity - 1 WHERE id = ?").bind(hasSeed.id),
                        db.prepare("DELETE FROM user_items WHERE id = ? AND quantity <= 0").bind(hasSeed.id),
                        // 核心修复点：显式写入 type='plant'
                        db.prepare("INSERT INTO home_items (user_id, slot_index, item_id, type, created_at, harvest_at) VALUES (?, ?, ?, 'plant', ?, ?)")
                          .bind(user.id, slotIndex, seedId, now, now + seedConfig.duration)
                    ]);
                    return Response.json({ success: true, message: `正在编译: ${seedConfig.name}` });
                } catch (dbErr) {
                    return Response.json({ success: false, error: '数据库错误: ' + dbErr.message });
                }
            }

            // --- 2. 收获 (Harvest) ---
            if (action === 'harvest') {
                const { slotIndex } = body;
                const item = await db.prepare("SELECT * FROM home_items WHERE user_id = ? AND slot_index = ?").bind(user.id, slotIndex).first();
                
                if (!item) return Response.json({ success: false, error: '槽位为空' });
                if (now < item.harvest_at) return Response.json({ success: false, error: '未成熟' });

                const config = SEEDS[item.item_id];
                if (!config) { // 异常数据清理
                    await db.prepare("DELETE FROM home_items WHERE id = ?").bind(item.id).run();
                    return Response.json({ success: false, error: '种子数据异常，已重置' });
                }

                // 掉落逻辑
                const DROP_RATE = 0.15;
                let dropMsg = "";
                const updates = [
                    db.prepare("UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id = ?").bind(config.reward_coins, config.reward_xp, user.id),
                    db.prepare("DELETE FROM home_items WHERE id = ?").bind(item.id)
                ];

                if (Math.random() < DROP_RATE) {
                    const existing = await db.prepare("SELECT id FROM user_items WHERE user_id = ? AND item_id = 'item_algo_frag'").bind(user.id).first();
                    if (existing) updates.push(db.prepare("UPDATE user_items SET quantity = quantity + 1 WHERE id = ?").bind(existing.id));
                    else updates.push(db.prepare("INSERT INTO user_items (user_id, item_id, category, quantity, created_at) VALUES (?, ?, 'consumable', 1, ?)").bind(user.id, 'item_algo_frag', now));
                    dropMsg = " 🎁 获得: 加速算法碎片!";
                }

                await db.batch(updates);
                return Response.json({ success: true, message: `收获成功! (+${config.reward_coins}i, +${config.reward_xp}XP)${dropMsg}` });
            }

            // --- 3. 打工逻辑 (Start Work) ---
            if (action === 'start_work') {
                const { workType } = body;
                const config = WORKS[workType];
                const current = await db.prepare("SELECT * FROM user_works WHERE user_id = ?").bind(user.id).first();
                if (current) return Response.json({ success: false, error: '已有任务进行中' });
                
                await db.prepare("INSERT INTO user_works (user_id, work_type, start_time, end_time) VALUES (?, ?, ?, ?)").bind(user.id, workType, now, now + config.duration).run();
                return Response.json({ success: true, message: '任务开始' });
            }

            // --- 4. 结算打工 (Claim Work) ---
            if (action === 'claim_work') {
                const current = await db.prepare("SELECT * FROM user_works WHERE user_id = ?").bind(user.id).first();
                if (!current || now < current.end_time) return Response.json({ success: false, error: '任务未完成' });
                
                const config = WORKS[current.work_type];
                await db.batch([
                    db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(config.reward, user.id),
                    db.prepare("DELETE FROM user_works WHERE user_id = ?").bind(user.id)
                ]);
                return Response.json({ success: true, message: `结算完成: +${config.reward} i币` });
            }

            // --- 5. 取消任务 ---
            if (action === 'cancel_work') {
                await db.prepare("DELETE FROM user_works WHERE user_id = ?").bind(user.id).run();
                return Response.json({ success: true, message: '任务已取消' });
            }
        }

        return Response.json({ success: false, error: 'Method Error' });

    } catch (globalErr) {
        return Response.json({ success: false, error: 'Server Error: ' + globalErr.message }, { status: 200 }); 
    }
}
