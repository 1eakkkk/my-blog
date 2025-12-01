// functions/api/tip.js

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie || !cookie.includes('session_id')) {
        return new Response(JSON.stringify({ error: 'Login required' }), { status: 401 });
    }
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    
    if (!user) return new Response(JSON.stringify({ error: 'Invalid session' }), { status: 401 });

    if (request.method === 'POST') {
        let body;
        try {
            body = await request.json();
        } catch (e) {
            return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
        }

        const { target_user_id, amount, post_id } = body;
        const tipAmount = parseInt(amount);

        // 基础校验
        if (isNaN(tipAmount) || tipAmount <= 0) {
            return new Response(JSON.stringify({ error: '无效的金额' }), { status: 400 });
        }
        // 防止负数或极小值攻击
        if (tipAmount < 1) {
             return new Response(JSON.stringify({ error: '最小打赏 1 i币' }), { status: 400 });
        }
        if (user.coins < tipAmount) {
            return new Response(JSON.stringify({ error: '余额不足' }), { status: 400 });
        }
        if (user.id == target_user_id) {
            return new Response(JSON.stringify({ error: '不能给自己打赏' }), { status: 400 });
        }

        // 获取接收者信息
        const targetUser = await db.prepare('SELECT * FROM users WHERE id = ?').bind(target_user_id).first();
        if (!targetUser) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });
        }

        const now = Date.now();
        // 计算 UTC+8 的日期字符串 (YYYY-MM-DD)
        const today = new Date(now + 8 * 3600 * 1000).toISOString().split('T')[0];

        // === 核心逻辑 1: 计算发送者经验 (受限) ===
        // VIP 上限 174 (120 * 1.45)，普通用户 120
        const DAILY_XP_LIMIT = user.is_vip ? 174 : 120;
        
        // 查询今日已获得经验
        const dailyStats = await db.prepare('SELECT xp_earned FROM user_daily_limits WHERE user_id = ? AND date_key = ?').bind(user.id, today).first();
        const currentDailyXp = dailyStats ? dailyStats.xp_earned : 0;

        // 计算本次实际可获得的经验 (1币 = 1经验)
        let actualSenderXp = 0;
        let isLimitReached = false;

        if (currentDailyXp < DAILY_XP_LIMIT) {
            const remainingSpace = DAILY_XP_LIMIT - currentDailyXp;
            actualSenderXp = Math.min(tipAmount, remainingSpace);
        } else {
            isLimitReached = true;
        }

        // === 核心逻辑 2: 计算接收者经验 (不受限) ===
        // 5币 = 1经验，向下取整，不计入每日上限
        const recipientXp = Math.floor(tipAmount / 5);

        try {
            const updates = [];

            // --- A. 发送者操作 (Sender) ---
            // 1. 扣钱，加经验 (如果有的话)
            updates.push(
                db.prepare('UPDATE users SET coins = coins - ?, xp = xp + ? WHERE id = ?')
                .bind(tipAmount, actualSenderXp, user.id)
            );
            
            // 2. 更新每日经验限制表 (只记录发送者的经验，因为这部分受限)
            // 如果 actualSenderXp > 0，则更新；如果是 0，虽然不加经验，但也不用更新 limit 表
            if (actualSenderXp > 0) {
                updates.push(
                    db.prepare(`
                        INSERT INTO user_daily_limits (user_id, date_key, xp_earned) 
                        VALUES (?, ?, ?) 
                        ON CONFLICT(user_id, date_key) 
                        DO UPDATE SET xp_earned = xp_earned + ?
                    `).bind(user.id, today, actualSenderXp, actualSenderXp)
                );
            }

            // 3. 记录交易流水
            updates.push(
                db.prepare('INSERT INTO tips (sender_id, receiver_id, post_id, amount, created_at) VALUES (?, ?, ?, ?, ?)')
                .bind(user.id, target_user_id, post_id || null, tipAmount, now)
            );

            // --- B. 接收者操作 (Recipient) ---
            // 1. 加钱，加经验 (注意：接收者的经验不更新 user_daily_limits)
            updates.push(
                db.prepare('UPDATE users SET coins = coins + ?, xp = xp + ? WHERE id = ?')
                .bind(tipAmount, recipientXp, target_user_id)
            );

            // 2. 发送通知
            const senderName = user.nickname || user.username;
            const notifyMsg = `收到来自 ${senderName} 的打赏: ${tipAmount} i币` + (recipientXp > 0 ? ` (+${recipientXp} XP)` : "");
            updates.push(
                db.prepare("INSERT INTO notifications (user_id, type, message, created_at, is_read) VALUES (?, 'tip', ?, ?, 0)")
                .bind(target_user_id, notifyMsg, now)
            );

            // 执行所有数据库操作
            await db.batch(updates);

            // === 构造返回给前端的消息 ===
            let successMsg = `打赏成功！消耗 ${tipAmount} i币`;
            
            if (actualSenderXp > 0) {
                successMsg += `，获得 ${actualSenderXp} 经验`;
                // 如果这次打赏刚好达到或超过上限，且原本还没满，提示一下
                if (currentDailyXp + actualSenderXp >= DAILY_XP_LIMIT) {
                    successMsg += ` (今日经验已达上限)`;
                }
            } else {
                // 如果一开始就满了，必须提示
                successMsg += ` (今日经验已达上限 +0 XP)`;
            }

            return new Response(JSON.stringify({ 
                success: true, 
                message: successMsg,
                xp_gained: actualSenderXp, // 前端可以用这个来决定是否播放加经验动画
                coins_spent: tipAmount
            }));

        } catch (e) {
            return new Response(JSON.stringify({ error: '数据库交易失败: ' + e.message }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
