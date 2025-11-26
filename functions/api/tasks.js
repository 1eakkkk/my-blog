// --- functions/api/tasks.js ---
export async function onRequestGet(context) {
    const db = context.env.DB;
    const cookie = context.request.headers.get('Cookie');
    if (!cookie) return new Response(JSON.stringify({ error: 'Login' }), { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT users.id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ error: 'Invalid' }), { status: 401 });

    // UTC+8
    const now = new Date();
    const utc8 = new Date(now.getTime() + (8 * 60 * 60 * 1000));
    const today = utc8.toISOString().split('T')[0];

    // 查询当前任务
    let task = await db.prepare('SELECT * FROM daily_tasks WHERE user_id = ?').bind(user.id).first();

    // 如果不存在，或日期不是今天，生成新任务
    if (!task || task.last_update_date !== today) {
        const types = [
            { type: 'checkin', target: 1, xp: 20, coin: 5, desc: '完成一次每日签到' },
            { type: 'post', target: 1, xp: 30, coin: 10, desc: '发布一篇新文章' },
            { type: 'comment', target: 3, xp: 40, coin: 15, desc: '发表 3 条评论' }
        ];
        const t = types[Math.floor(Math.random() * types.length)];
        
        if (!task) {
            await db.prepare('INSERT INTO daily_tasks (user_id, task_type, target, reward_xp, reward_coins, last_update_date) VALUES (?, ?, ?, ?, ?, ?)')
                .bind(user.id, t.type, t.target, t.xp, t.coin, today).run();
        } else {
            await db.prepare('UPDATE daily_tasks SET task_type = ?, progress = 0, target = ?, reward_xp = ?, reward_coins = ?, is_claimed = 0, last_update_date = ?, reroll_count = 0 WHERE user_id = ?')
                .bind(t.type, t.target, t.xp, t.coin, today, user.id).run();
        }
        // 重新查一次
        task = await db.prepare('SELECT * FROM daily_tasks WHERE user_id = ?').bind(user.id).first();
    }

    return new Response(JSON.stringify(task));
}

export async function onRequestPost(context) {
    const db = context.env.DB;
    const cookie = context.request.headers.get('Cookie');
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT users.id, users.coins FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ error: 'Invalid' }), { status: 401 });

    const { action } = await context.request.json();
    const today = new Date(new Date().getTime() + 8*3600*1000).toISOString().split('T')[0];

    if (action === 'reroll') {
        const task = await db.prepare('SELECT * FROM daily_tasks WHERE user_id = ?').bind(user.id).first();
        if (task.reroll_count >= 1) return new Response(JSON.stringify({ success: false, error: '今日刷新机会已用完' }));
        if (user.coins < 10) return new Response(JSON.stringify({ success: false, error: '余额不足10 i币' }));

        const types = [
            { type: 'checkin', target: 1, xp: 20, coin: 5 },
            { type: 'post', target: 1, xp: 30, coin: 10 },
            { type: 'comment', target: 3, xp: 40, coin: 15 }
        ];
        const t = types[Math.floor(Math.random() * types.length)];

        await db.batch([
            db.prepare('UPDATE users SET coins = coins - 10 WHERE id = ?').bind(user.id),
            db.prepare('UPDATE daily_tasks SET task_type = ?, progress = 0, target = ?, reward_xp = ?, reward_coins = ?, is_claimed = 0, reroll_count = 1 WHERE user_id = ?')
              .bind(t.type, t.target, t.xp, t.coin, user.id)
        ]);
        return new Response(JSON.stringify({ success: true, message: '刷新成功' }));
    }

    if (action === 'claim') {
        const task = await db.prepare('SELECT * FROM daily_tasks WHERE user_id = ?').bind(user.id).first();
        if (task.is_claimed) return new Response(JSON.stringify({ success: false, error: '已领取' }));
        if (task.progress < task.target) return new Response(JSON.stringify({ success: false, error: '任务未完成' }));

        await db.batch([
            db.prepare('UPDATE users SET xp = xp + ?, coins = coins + ? WHERE id = ?').bind(task.reward_xp, task.reward_coins, user.id),
            db.prepare('UPDATE daily_tasks SET is_claimed = 1 WHERE user_id = ?').bind(user.id)
        ]);
        return new Response(JSON.stringify({ success: true, message: `领取成功！XP+${task.reward_xp} i币+${task.reward_coins}` }));
    }
}
