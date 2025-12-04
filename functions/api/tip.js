// --- START OF FILE functions/api/tip.js ---

// --- functions/api/tip.js ---

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

        // === 基础校验 ===
        if (isNaN(tipAmount)) {
            return new Response(JSON.stringify({ error: '金额无效' }), { status: 400 });
        }
        if (tipAmount < 1) {
             return new Response(JSON.stringify({ error: '最低打赏金额为 1 i币' }), { status: 400 });
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
        const today = new Date(now + 8 * 3600 * 1000).toISOString().split('T')[0];

        // === 1. 计算【发送者】经验 (每日受限) ===
        const SENDER_XP_LIMIT = user.is_vip ? 174 : 120;
        const senderDailyStats = await db.prepare('SELECT xp_earned FROM user_daily_limits WHERE user_id = ? AND date_key = ?').bind(user.id, today).first();
        const senderCurrentDailyXp = senderDailyStats ? senderDailyStats.xp_earned : 0;

        let actualSenderXp = 0;
        if (senderCurrentDailyXp < SENDER_XP_LIMIT) {
            const remainingSpace = SENDER_XP_LIMIT - senderCurrentDailyXp;
            actualSenderXp = Math.min(tipAmount, remainingSpace); // 假设1币=1经验成本
        }

        // === 2. 计算【接收者】经验 (每日受限 - 修复Bug) ===
        // 规则：5币 = 1经验，但也受每日上限限制
        const RECIPIENT_XP_LIMIT = targetUser.is_vip ? 174 : 120;
        const recipientDailyStats = await db.prepare('SELECT xp_earned FROM user_daily_limits WHERE user_id = ? AND date_key = ?').bind(target_user_id, today).first();
        const recipientCurrentDailyXp = recipientDailyStats ? recipientDailyStats.xp_earned : 0;

        const rawRecipientXp = Math.floor(tipAmount / 5);
        let actualRecipientXp = 0;

        if (recipientCurrentDailyXp < RECIPIENT_XP_LIMIT) {
            const remainingSpace = RECIPIENT_XP_LIMIT - recipientCurrentDailyXp;
            actualRecipientXp = Math.min(rawRecipientXp, remainingSpace);
        }

        try {
            const updates = [];

            // --- A. 发送者操作 ---
            updates.push(
                db.prepare('UPDATE users SET coins = coins - ?, xp = xp + ?, tips_sent = tips_sent + ? WHERE id = ?')
                .bind(tipAmount, actualSenderXp, tipAmount, user.id)
            );
            
            // 发送者每日限额记录
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

            // 记录流水
            updates.push(
                db.prepare('INSERT INTO tips (sender_id, receiver_id, post_id, amount, created_at) VALUES (?, ?, ?, ?, ?)')
                .bind(user.id, target_user_id, post_id || null, tipAmount, now)
            );

            // --- B. 接收者操作 ---
            updates.push(
                db.prepare('UPDATE users SET coins = coins + ?, xp = xp + ?, tips_received = tips_received + ? WHERE id = ?')
                .bind(tipAmount, actualRecipientXp, tipAmount, target_user_id)
            );

            // 接收者每日限额记录 (新增)
            if (actualRecipientXp > 0) {
                updates.push(
                    db.prepare(`
                        INSERT INTO user_daily_limits (user_id, date_key, xp_earned) 
                        VALUES (?, ?, ?) 
                        ON CONFLICT(user_id, date_key) 
                        DO UPDATE SET xp_earned = xp_earned + ?
                    `).bind(target_user_id, today, actualRecipientXp, actualRecipientXp)
                );
            }

            // --- C. 帖子统计操作 ---
            if (post_id) {
                updates.push(
                    db.prepare('UPDATE posts SET total_coins = total_coins + ? WHERE id = ?')
                    .bind(tipAmount, post_id)
                );
            }

            // 发送通知
            const senderName = user.nickname || user.username;
            const notifyMsg = `收到来自 ${senderName} 的打赏: ${tipAmount} i币` + (actualRecipientXp > 0 ? ` (+${actualRecipientXp} XP)` : "");
            updates.push(
                db.prepare("INSERT INTO notifications (user_id, type, message, created_at, is_read) VALUES (?, 'tip', ?, ?, 0)")
                .bind(target_user_id, notifyMsg, now)
            );

            // 执行事务
            await db.batch(updates);

            let successMsg = `打赏成功！消耗 ${tipAmount} i币`;
            if (actualSenderXp > 0) {
                successMsg += `，获得 ${actualSenderXp} 经验`;
            } else {
                successMsg += ` (今日经验已达上限)`;
            }

            return new Response(JSON.stringify({ 
                success: true, 
                message: successMsg,
                xp_gained: actualSenderXp
            }));

        } catch (e) {
            return new Response(JSON.stringify({ error: '数据库错误: ' + e.message }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
}
