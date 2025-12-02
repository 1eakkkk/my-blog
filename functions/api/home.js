// functions/api/home.js
export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权 (复用你现有的逻辑)
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ success: false, error: '未登录' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare(`SELECT id, coins, xp FROM users JOIN sessions ON users.id = sessions.user_id WHERE sessions.session_id = ?`).bind(sessionId).first();
    if (!user) return Response.json({ success: false, error: '未登录' }, { status: 401 });

    const url = new URL(request.url);
    const method = request.method;

    // === GET: 获取家园数据 ===
    if (method === 'GET') {
        const targetUsername = url.searchParams.get('u');
        let targetId = user.id;
        let isMe = true;

        if (targetUsername) {
            const target = await db.prepare("SELECT id FROM users WHERE username = ?").bind(targetUsername).first();
            if (!target) return Response.json({ success: false, error: '用户不存在' });
            targetId = target.id;
            isMe = (targetId === user.id);
        }

        const items = await db.prepare("SELECT * FROM home_items WHERE user_id = ?").bind(targetId).all();
        return Response.json({ success: true, items: items.results, isMe });
    }

    // === POST: 种植、收获、互动 ===
    if (method === 'POST') {
        const body = await request.json();
        const { action } = body;
        const now = Date.now();

        // 1. 种植 (运行算法)
        if (action === 'plant') {
            const { slotIndex, seedId } = body;
            // 定义种子数据 (建议后续移入数据库或 Config，这里硬编码示例)
            // 你可以根据需要修改数值
            const SEEDS = {
                'seed_moss': { name: '低频缓存苔藓', time: 4 * 3600 * 1000 },  // 4小时
                'seed_quantum': { name: '量子枝条', time: 12 * 3600 * 1000 },   // 12小时
                'seed_vine': { name: '修复算法藤', time: 24 * 3600 * 1000 }     // 24小时
            };
            const seed = SEEDS[seedId];
            if (!seed) return Response.json({ success: false, error: '无效的种子' });

            // 检查背包是否有种子 (需要关联 inventory 表，这里假设你已经做好了背包检查逻辑)
            // 简单实现：检查并消耗
            const invItem = await db.prepare("SELECT * FROM user_items WHERE user_id = ? AND item_id = ? AND quantity > 0").bind(user.id, seedId).first();
            if (!invItem) return Response.json({ success: false, error: '缺少种子' });

            // 检查槽位是否为空
            const existing = await db.prepare("SELECT * FROM home_items WHERE user_id = ? AND slot_index = ?").bind(user.id, slotIndex).first();
            if (existing) return Response.json({ success: false, error: '槽位已被占用' });

            // 执行事务：扣种子 + 种植
            await db.batch([
                db.prepare("UPDATE user_items SET quantity = quantity - 1 WHERE id = ?").bind(invItem.id),
                db.prepare("DELETE FROM user_items WHERE id = ? AND quantity <= 0").bind(invItem.id), // 如果用完则删除
                db.prepare("INSERT INTO home_items (user_id, slot_index, item_id, type, status, created_at, harvest_at) VALUES (?, ?, ?, 'plant', 'growing', ?, ?)")
                  .bind(user.id, slotIndex, seedId, now, now + seed.time)
            ]);

            return Response.json({ success: true, message: `正在编译: ${seed.name}` });
        }

        // 2. 收获 (解密数据)
        if (action === 'harvest') {
            const { slotIndex } = body;
            const item = await db.prepare("SELECT * FROM home_items WHERE user_id = ? AND slot_index = ?").bind(user.id, slotIndex).first();
            
            if (!item || item.type !== 'plant') return Response.json({ success: false, error: '无效的操作' });
            if (now < item.harvest_at) return Response.json({ success: false, error: '算法尚未运行完成' });

            // 定义收益 (建议与种子定义放在一起)
            let coins = 0; let xp = 0;
            if (item.item_id === 'seed_moss') { coins = 50; xp = 20; }
            else if (item.item_id === 'seed_quantum') { coins = 180; xp = 80; }
            else if (item.item_id === 'seed_vine') { coins = 400; xp = 200; }

            // 事务：加钱 + 加经验 + 清除植物
            await db.batch([
                db.prepare("UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id = ?").bind(coins, xp, user.id),
                db.prepare("DELETE FROM home_items WHERE id = ?").bind(item.id)
            ]);

            return Response.json({ success: true, message: `解密完成: 获得 ${coins} i币, ${xp} XP` });
        }

        // 3. 铲除 (强制终止)
        if (action === 'remove') {
            const { slotIndex } = body;
            await db.prepare("DELETE FROM home_items WHERE user_id = ? AND slot_index = ?").bind(user.id, slotIndex).run();
            return Response.json({ success: true, message: '已格式化该存储块' });
        }
        
        // 4. 串门 (Hack/Visit) - 简化版：仅点赞加经验
        if (action === 'visit_reward') {
             // 防止刷经验：需要一张记录表 visit_logs (visitor_id, target_id, date)，这里暂略，建议加上
             // 简单给个提示
             return Response.json({ success: true, message: '已访问节点，连接稳定' });
        }
    }

    return Response.json({ success: false, error: 'Method not allowed' });
}
