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

        // === 修复 Bug：严格校验打赏金额 ===
        if (isNaN(tipAmount)) {
            return new Response(JSON.stringify({ error: '金额无效' }), { status: 400 });
        }
        // 确保被打赏者至少收到 1 i币
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

        // === 1. 计算发送者经验 (受限) ===
        // VIP 上限 174，普通 120
        const DAILY_XP_LIMIT = user.is_vip ? 174 : 120;
        
        const dailyStats = await db.prepare('SELECT xp_earned FROM user_daily_limits WHERE user_id = ? AND date_key = ?').bind(user.id, today).first();
        const currentDailyXp = dailyStats ? dailyStats.xp_earned : 0;

        let actualSenderXp = 0;
        if (currentDailyXp < DAILY_XP_LIMIT) {
            const remainingSpace = DAILY_XP_LIMIT - currentDailyXp;
            actualSenderXp = Math.min(tipAmount, remainingSpace);
        }

        // === 2. 计算接收者经验 (不受限) ===
        // 5币 = 1经验，向下取整
        const recipientXp = Math.floor(tipAmount / 5);

        try {
            const updates = [];

            // --- A. 发送者操作 ---
            updates.push(
                db.prepare('UPDATE users SET coins = coins - ?, xp = xp + ? WHERE id = ?')
                .bind(tipAmount, actualSenderXp, user.id)
            );
            
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

            // 3. 记录流水
            updates.push(
                db.prepare('INSERT INTO tips (sender_id, receiver_id, post_id, amount, created_at) VALUES (?, ?, ?, ?, ?)')
                .bind(user.id, target_user_id, post_id || null, tipAmount, now)
            );

            // --- B. 接收者操作 ---
            // 接收者获得全额打赏金 (tipAmount >= 1)
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

            await db.batch(updates);

            let successMsg = `打赏成功！消耗 ${tipAmount} i币`;
            if (actualSenderXp > 0) {
                successMsg += `，获得 ${actualSenderXp} 经验`;
                if (currentDailyXp + actualSenderXp >= DAILY_XP_LIMIT) {
                    successMsg += ` (今日经验已达上限)`;
                }
            } else {
                successMsg += ` (今日经验已达上限 +0 XP)`;
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
