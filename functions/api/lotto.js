// --- functions/api/lotto.js ---
export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;
    
    // 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Login' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if(!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const now = Date.now();
    const TICKET_PRICE = 100;
    const BASE_POOL = 10000;
    const DRAW_INTERVAL = 24 * 60 * 60 * 1000; // 24小时

    // === 核心：检查是否需要开奖 (触发式) ===
    // 1. 获取上次开奖时间
    let lastDrawState = await db.prepare("SELECT value FROM system_state WHERE key = 'last_lotto_draw'").first();
    let lastDrawTime = lastDrawState ? parseInt(lastDrawState.value) : 0;

    if (allBets.results.length > 0) {
            // 随机选1个幸运儿
            const winner = allBets.results[Math.floor(Math.random() * allBets.results.length)];
            
            // 构造通知内容
            const notifyMsg = `🎰 [乐透开奖] 玩家 ${winner.username} 独吞了 ${totalPool.toLocaleString()} i币奖池！下一期已开启。`;
            const now = Date.now();

            await db.batch([
                // 1. 发钱给赢家
                db.prepare("UPDATE users SET coins = coins + ? WHERE id = ?").bind(totalPool, winner.user_id),
                
                // 2. 清空奖池
                db.prepare("DELETE FROM lotto_bets"),
                
                // 3. 更新开奖时间
                db.prepare("UPDATE system_state SET value = ? WHERE key = 'last_lotto_draw'").bind(now),
                
                // 4. === 核心修改：给全服所有用户发通知 ===
                // 语法：INSERT INTO ... SELECT id, ... FROM users
                // 这样效率最高，不用循环
                db.prepare(`
                    INSERT INTO notifications (user_id, type, message, link, created_at, is_read)
                    SELECT id, 'system', ?, '#lotto', ?, 0 FROM users
                `).bind(notifyMsg, now)
            ]);
        } else {
            //没人买，只更新时间
            await db.prepare("UPDATE system_state SET value = ? WHERE key = 'last_lotto_draw'").bind(now).run();
        }
        // 更新内存中的时间
        lastDrawTime = now;
    }

    // === GET: 获取状态 ===
    if (request.method === 'GET') {
        const countRes = await db.prepare("SELECT COUNT(*) as c FROM lotto_bets").first();
        const myBet = await db.prepare("SELECT COUNT(*) as c FROM lotto_bets WHERE user_id = ?").bind(user.id).first();
        
        const currentPool = BASE_POOL + (countRes.c * TICKET_PRICE);
        const nextDrawTime = lastDrawTime + DRAW_INTERVAL;
        
        return Response.json({
            success: true,
            pool: currentPool,
            next_draw: nextDrawTime,
            my_tickets: myBet.c,
            ticket_price: TICKET_PRICE
        });
    }

    // === POST: 买票 ===
    if (request.method === 'POST') {
        if (user.coins < TICKET_PRICE) return Response.json({ error: '余额不足' });
        
        await db.batch([
            db.prepare("UPDATE users SET coins = coins - ? WHERE id = ?").bind(TICKET_PRICE, user.id),
            db.prepare("INSERT INTO lotto_bets (user_id, username, created_at) VALUES (?, ?, ?)").bind(user.id, user.username, now)
        ]);
        
        return Response.json({ success: true, message: '购票成功！祝你好运' });
    }
}
