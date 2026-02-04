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

        // 2. Emoji 老虎机 (/slots)
        if (content === '/slots' || action === 'slots') {
            const cost = 20;
            if (user.coins < cost) return Response.json({ error: '余额不足 20 i' });

            await db.prepare('UPDATE users SET coins = coins - ? WHERE id = ?').bind(cost, user.id).run();

            // 奖池符号
            const icons = ['🍒', '🍋', '🍇', '💎', '7️⃣'];
            // 随机生成三个
            const r1 = icons[Math.floor(Math.random() * icons.length)];
            const r2 = icons[Math.floor(Math.random() * icons.length)];
            const r3 = icons[Math.floor(Math.random() * icons.length)];
            
            const resultStr = `[ ${r1} | ${r2} | ${r3} ]`;
            let win = 0;
            let msg = "";

            // 判定逻辑
            if (r1 === r2 && r2 === r3) {
                // 3个全同
                if (r1 === '7️⃣') win = 1000; // 777 大奖
                else if (r1 === '💎') win = 500; // 钻石奖
                else win = 200; // 水果奖
                msg = `${resultStr} 🎰 JACKPOT! 赢得 ${win} i币!`;
            } else if (r1 === r2 || r2 === r3 || r1 === r3) {
                // 2个相同 (小奖)
                win = 30;
                msg = `${resultStr} 小赚一笔! 赢得 ${win} i币`;
            } else {
                msg = `${resultStr} 谢谢惠顾`;
            }

            if (win > 0) {
                await db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(win, user.id).run();
            }

            // 插入消息 (类型设为 slots，前端可以用特殊样式)
            await db.prepare(`INSERT INTO pub_messages (user_id, username, nickname, avatar_url, content, type, created_at) VALUES (?, ?, ?, ?, ?, 'roll', ?)`)
                .bind(user.id, user.username, username, user.avatar_url, msg, now).run();

            return Response.json({ success: true });
        }

        // 3. 赛博左轮 (/bang)
        if (content === '/bang' || action === 'bang') {
            // 规则：1/6 概率中弹(扣500)，5/6 概率幸存(得10)
            const bullet = Math.floor(Math.random() * 6);
            let msg = "";
            
            if (bullet === 0) {
                // 中弹
                const fine = 500;
                // 扣钱，如果不够扣到0
                await db.prepare('UPDATE users SET coins = MAX(0, coins - ?) WHERE id = ?').bind(fine, user.id).run();
                msg = `💥 砰！(中弹倒地，支付 ${fine} i币 医疗费)`;
            } else {
                // 幸存
                const reward = 10;
                await db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(reward, user.id).run();
                msg = `🔫 咔嚓... (空枪幸存，获得 ${reward} i币 压惊费)`;
            }

            await db.prepare(`INSERT INTO pub_messages (user_id, username, nickname, avatar_url, content, type, created_at) VALUES (?, ?, ?, ?, ?, 'roll', ?)`)
                .bind(user.id, user.username, username, user.avatar_url, msg, now).run();

            return Response.json({ success: true });
        }

        // 4. 全场买单 (Treat)
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

        // 5. 普通发言 (删除 Music 逻辑)
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
