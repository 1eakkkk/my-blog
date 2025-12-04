// --- START OF FILE functions/api/home.js ---

const SEEDS = {
    'seed_moss': { name: '低频缓存苔藓', duration: 4 * 60 * 60 * 1000, reward_coins: 120, reward_xp: 300 },
    'seed_quantum': { name: '量子枝条', duration: 12 * 60 * 60 * 1000, reward_coins: 280, reward_xp: 500 },
    'seed_vine': { name: '修复算法藤', duration: 24 * 60 * 60 * 1000, reward_coins: 600, reward_xp: 800 }
};
const WORKS = {
    'cleaning': { name: '数据清理', duration: 10 * 60 * 1000, reward: 20 },
    'sorting':  { name: '缓存整理', duration: 30 * 60 * 1000, reward: 60 },
    'debug':    { name: '黑盒调试', duration: 60 * 60 * 1000, reward: 120 },
    'deepcleaning': { name: '深度清理', duration: 3 * 60 * 60 * 1000, reward: 360 },
    'fixbug':    { name: '修复漏洞', duration: 6 * 60 * 60 * 1000, reward: 720 },
    'sleeptest': { name: '睡眠测试', duration: 10 * 60 * 60 * 1000, reward: 1200 }
};

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const method = request.method;

    // === GET: 获取家园状态 ===
    if (method === 'GET') {
        const homeItems = await db.prepare("SELECT * FROM home_items WHERE user_id = ?").bind(user.id).all();
        const work = await db.prepare("SELECT * FROM user_works WHERE user_id = ? AND status = 1").bind(user.id).first();
        return Response.json({ 
            success: true, 
            home: homeItems.results, 
            work: work,
            serverTime: Date.now() 
        });
    }

    // === POST: 操作 ===
    if (method === 'POST') {
        const body = await request.json();
        const { action } = body;
        const now = Date.now();

        // 1. 单个种植
        if (action === 'plant') {
            const { slotIndex, seedId } = body;
            const seedConfig = SEEDS[seedId];
            if (!seedConfig) return Response.json({ error: '无效种子' });
            
            // 检查槽位
            const exists = await db.prepare("SELECT id FROM home_items WHERE user_id=? AND slot_index=?").bind(user.id, slotIndex).first();
            if (exists) return Response.json({ error: '该地块已有植物' });

            // 检查背包
            const item = await db.prepare("SELECT quantity FROM user_items WHERE user_id=? AND item_id=?").bind(user.id, seedId).first();
            if (!item || item.quantity < 1) return Response.json({ error: '种子不足' });

            // 种植事务
            const harvestTime = now + seedConfig.time;
            await db.batch([
                db.prepare("UPDATE user_items SET quantity = quantity - 1 WHERE user_id=? AND item_id=?").bind(user.id, seedId),
                db.prepare("DELETE FROM user_items WHERE user_id=? AND item_id=? AND quantity <= 0").bind(user.id, seedId),
                db.prepare("INSERT INTO home_items (user_id, slot_index, item_id, type, created_at, harvest_at) VALUES (?, ?, ?, 'plant', ?, ?)").bind(user.id, slotIndex, seedId, now, harvestTime)
            ]);
            return Response.json({ success: true, message: '种植成功' });
        }

        // 2. 一键种植 (Plant All)
        if (action === 'plant_all') {
            const { seedId } = body;
            const seedConfig = SEEDS[seedId];
            if (!seedConfig) return Response.json({ error: '无效种子' });

            // 获取背包种子数量
            const invItem = await db.prepare("SELECT quantity FROM user_items WHERE user_id=? AND item_id=?").bind(user.id, seedId).first();
            if (!invItem || invItem.quantity < 1) return Response.json({ error: '种子不足' });
            let seedCount = invItem.quantity;

            // 获取当前已占用的槽位
            const occupied = await db.prepare("SELECT slot_index FROM home_items WHERE user_id=?").bind(user.id).all();
            const occupiedSlots = occupied.results.map(r => r.slot_index);

            // 计算可用空位 (0-8)
            const emptySlots = [];
            for (let i = 0; i < 9; i++) {
                if (!occupiedSlots.includes(i)) emptySlots.push(i);
            }

            if (emptySlots.length === 0) return Response.json({ error: '没有空闲地块' });

            // 实际可种植数量 = min(拥有种子, 空位数)
            const plantCount = Math.min(seedCount, emptySlots.length);
            const batch = [];
            const harvestTime = now + seedConfig.time;

            // 扣除种子
            batch.push(db.prepare("UPDATE user_items SET quantity = quantity - ? WHERE user_id=? AND item_id=?").bind(plantCount, user.id, seedId));
            batch.push(db.prepare("DELETE FROM user_items WHERE user_id=? AND item_id=? AND quantity <= 0").bind(user.id, seedId));

            // 批量插入
            for (let i = 0; i < plantCount; i++) {
                batch.push(db.prepare("INSERT INTO home_items (user_id, slot_index, item_id, type, created_at, harvest_at) VALUES (?, ?, ?, 'plant', ?, ?)").bind(user.id, emptySlots[i], seedId, now, harvestTime));
            }

            await db.batch(batch);
            return Response.json({ success: true, message: `成功种植 ${plantCount} 棵 ${seedConfig.name}` });
        }

        // 3. 单个收获
        if (action === 'harvest') {
            const { slotIndex } = body;
            const item = await db.prepare("SELECT * FROM home_items WHERE user_id=? AND slot_index=?").bind(user.id, slotIndex).first();
            if (!item) return Response.json({ error: '地块为空' });
            if (now < item.harvest_at) return Response.json({ error: '尚未成熟' });

            const conf = SEEDS[item.item_id];
            const reward = Math.floor(Math.random() * (conf.reward_max - conf.reward_min + 1)) + conf.reward_min;
            
            // 稀有掉落：加速碎片 (15%概率)
            let dropMsg = '';
            const updates = [
                db.prepare("DELETE FROM home_items WHERE id=?").bind(item.id),
                db.prepare("UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id=?").bind(reward, conf.xp, user.id)
            ];

            if (Math.random() < 0.15) {
                // 检查背包是否有碎片，有则加数量，无则插入
                // 这里简化处理：直接尝试 Update，若无影响则 Insert (或者使用 UPSERT 语法如果 D1 支持)
                // 为兼容性，先查后写
                const hasFrag = await db.prepare("SELECT id FROM user_items WHERE user_id=? AND item_id='item_algo_frag'").bind(user.id).first();
                if (hasFrag) {
                    updates.push(db.prepare("UPDATE user_items SET quantity = quantity + 1 WHERE id=?").bind(hasFrag.id));
                } else {
                    updates.push(db.prepare("INSERT INTO user_items (user_id, item_id, quantity, category) VALUES (?, 'item_algo_frag', 1, 'material')").bind(user.id));
                }
                dropMsg = ' 获得: [加速算法碎片]!';
            }

            await db.batch(updates);
            return Response.json({ success: true, message: `收获成功: +${reward}i, +${conf.xp}XP${dropMsg}` });
        }

        // 4. 一键收获 (Harvest All)
        if (action === 'harvest_all') {
            // 查找所有成熟作物
            const readyItems = await db.prepare("SELECT * FROM home_items WHERE user_id=? AND harvest_at <= ?").bind(user.id, now).all();
            
            if (readyItems.results.length === 0) return Response.json({ error: '没有可收获的作物' });

            let totalCoins = 0;
            let totalXp = 0;
            let totalFrags = 0;
            const idsToDelete = [];

            for (const item of readyItems.results) {
                const conf = SEEDS[item.item_id];
                if (conf) {
                    totalCoins += Math.floor(Math.random() * (conf.reward_max - conf.reward_min + 1)) + conf.reward_min;
                    totalXp += conf.xp;
                    if (Math.random() < 0.15) totalFrags++;
                }
                idsToDelete.push(item.id);
            }

            const updates = [];
            // 批量删除
            // D1 不支持 DELETE WHERE id IN (...) 数组传参的直接语法，需要拼 SQL 或循环
            // 为简单，我们循环生成 delete 语句放入 batch (D1 batch 上限很高，几十个没问题)
            idsToDelete.forEach(id => {
                updates.push(db.prepare("DELETE FROM home_items WHERE id=?").bind(id));
            });

            // 发放奖励
            updates.push(db.prepare("UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id=?").bind(totalCoins, totalXp, user.id));

            // 发放碎片
            if (totalFrags > 0) {
                const hasFrag = await db.prepare("SELECT id FROM user_items WHERE user_id=? AND item_id='item_algo_frag'").bind(user.id).first();
                if (hasFrag) {
                    updates.push(db.prepare("UPDATE user_items SET quantity = quantity + ? WHERE id=?").bind(totalFrags, hasFrag.id));
                } else {
                    updates.push(db.prepare("INSERT INTO user_items (user_id, item_id, quantity, category) VALUES (?, 'item_algo_frag', ?, 'material')").bind(user.id, totalFrags));
                }
            }

            await db.batch(updates);
            
            let msg = `一键收获: +${totalCoins}i, +${totalXp}XP`;
            if (totalFrags > 0) msg += `, 碎片 x${totalFrags}`;
            return Response.json({ success: true, message: msg });
        }

        // 5. 打工逻辑 (保持不变)
        if (action === 'start_work') {
            const { workType } = body;
            const conf = WORKS[workType];
            if (!conf) return Response.json({ error: '未知任务' });
            
            const existing = await db.prepare("SELECT id FROM user_works WHERE user_id=? AND status=1").bind(user.id).first();
            if (existing) return Response.json({ error: '已有进行中的任务' });

            const endTime = now + conf.time;
            await db.prepare("INSERT INTO user_works (user_id, work_type, start_time, end_time, status) VALUES (?, ?, ?, ?, 1)").bind(user.id, workType, now, endTime).run();
            return Response.json({ success: true, message: '任务挂载成功' });
        }

        if (action === 'claim_work') {
            const work = await db.prepare("SELECT * FROM user_works WHERE user_id=? AND status=1").bind(user.id).first();
            if (!work) return Response.json({ error: '无进行中任务' });
            if (now < work.end_time) return Response.json({ error: '任务未完成' });

            const conf = WORKS[work.work_type];
            await db.batch([
                db.prepare("DELETE FROM user_works WHERE id=?").bind(work.id),
                db.prepare("UPDATE users SET coins = coins + ? WHERE id=?").bind(conf.reward, user.id)
            ]);
            return Response.json({ success: true, message: `结算完成: +${conf.reward} i币` });
        }

        if (action === 'cancel_work') {
            await db.prepare("DELETE FROM user_works WHERE user_id=? AND status=1").bind(user.id).run();
            return Response.json({ success: true, message: '任务已终止' });
        }

        return Response.json({ error: 'Invalid Action' });
    }
}
