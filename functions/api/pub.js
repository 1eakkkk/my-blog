// --- functions/api/pub.js ---

export async function onRequest(context) {
    const { request, env } = context;
    const db = env.DB;

    // 1. 鉴权
    const cookie = request.headers.get('Cookie');
    if (!cookie) return Response.json({ error: 'Auth' }, { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT * FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return Response.json({ error: 'Auth' }, { status: 401 });

    const now = Date.now();

    // === GET: 获取消息流 (修复：关联用户样式) ===
    if (request.method === 'GET') {
        // 更新活跃时间
        context.waitUntil(db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').bind(now, user.id).run());

        // 关联 users 表查询样式信息
        // 注意：这里使用 LEFT JOIN，防止用户被删导致消息消失
        const msgs = await db.prepare(`
            SELECT m.*, 
                   u.equipped_bubble_style, 
                   u.name_color 
            FROM pub_messages m
            LEFT JOIN users u ON m.user_id = u.id
            ORDER BY m.created_at DESC LIMIT 50
        `).all();

        const online = await db.prepare('SELECT COUNT(*) as c FROM users WHERE last_seen > ?').bind(now - 300000).first();

        return Response.json({ 
            success: true, 
            list: msgs.results.reverse(), 
            online: online.c 
        });
    }

    // === POST: 发送消息/指令 ===
    if (request.method === 'POST') {
        const { content, action } = await request.json();
        const username = user.nickname || user.username;

        // 1. 掷骰子 (/roll)
        if (content === '/roll' || action === 'roll') {
            const point = Math.floor(Math.random() * 100) + 1;
            await db.prepare(`INSERT INTO pub_messages (user_id, username, nickname, avatar_url, content, type, meta_data, created_at) VALUES (?, ?, ?, ?, ?, 'roll', ?, ?)`)
                .bind(user.id, user.username, username, user.avatar_url, `掷出了 ${point} 点 (1-100)`, point, now).run();
            return Response.json({ success: true });
        }

        // 2. 全场买单 (Treat)
        if (action === 'treat') {
            const cost = 1000;
            if (user.coins < cost) return Response.json({ error: '余额不足 1000 i币' });

            await db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(cost, user.id).run();

            const luckyUsers = await db.prepare(`SELECT id FROM users WHERE last_seen > ? AND id != ? ORDER BY RANDOM() LIMIT 10`).bind(now - 300000, user.id).all();
            
            let totalGift = 0;
            const batch = [];
            luckyUsers.results.forEach(u => {
                const gift = Math.floor(Math.random() * 51) + 50;
                totalGift += gift;
                batch.push(db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(gift, u.id));
            });

            if (batch.length > 0) await db.batch(batch);

            const msg = `豪掷千金！请 ${luckyUsers.results.length} 位酒客喝了一杯！(共撒币 ${totalGift} i)`;
            await db.prepare(`INSERT INTO pub_messages (user_id, username, nickname, avatar_url, content, type, created_at) VALUES (?, ?, ?, ?, ?, 'treat', ?)`)
                .bind(user.id, user.username, username, user.avatar_url, msg, now).run();

            return Response.json({ success: true });
        }

        // 3. 普通发言 (删除 Music 逻辑)
        if (content) {
            if (content.length > 300) {
                return Response.json({ error: '消息过长 (限300字)' });
            }
            const last = await db.prepare('SELECT created_at FROM pub_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').bind(user.id).first();
            if (last && (now - last.created_at < 1000)) return Response.json({ error: '说话太快了' });

            await db.prepare(`INSERT INTO pub_messages (user_id, username, nickname, avatar_url, content, type, created_at) VALUES (?, ?, ?, ?, ?, 'text', ?)`)
                .bind(user.id, user.username, username, user.avatar_url, content, now).run();
            
            return Response.json({ success: true });
        }
    }

    return Response.json({ error: 'Invalid' });
}
