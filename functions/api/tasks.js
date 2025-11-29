// --- functions/api/tasks.js ---

// === 任务配置池 (可以在这里无限扩展任务) ===
const POOL = {
    daily: [
        { code: 'checkin', target: 1, xp: 20, coin: 10, desc: '完成每日签到' },
        { code: 'like_5', target: 5, xp: 30, coin: 15, desc: '点赞 5 个帖子或评论' },
        { code: 'comment_3', target: 3, xp: 40, coin: 20, desc: '发表 3 条友善评论' },
        { code: 'view_rank', target: 1, xp: 10, coin: 5, desc: '查看一次排行榜' },
        { code: 'tip_1', target: 1, xp: 50, coin: 10, desc: '完成 1 次打赏' },
        { code: 'profile_visit', target: 3, xp: 20, coin: 10, desc: '访问 3 位用户的个人主页' }
    ],
    weekly: [
        { code: 'post_3', target: 3, xp: 200, coin: 100, desc: '【周常】发布 3 篇高质量帖子' },
        { code: 'like_30', target: 30, xp: 150, coin: 80, desc: '【周常】累计送出 30 个爱心' },
        { code: 'get_like_10', target: 10, xp: 300, coin: 150, desc: '【周常】收到 10 个点赞' },
        { code: 'comment_20', target: 20, xp: 250, coin: 120, desc: '【周常】累计发表 20 条评论' },
        { code: 'tip_total_50', target: 50, xp: 500, coin: 200, desc: '【周常】累计打赏支出 50 i币' }
    ]
};

// 获取周数标识 (例如 2025-W48)
function getWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1)/7);
    return `${d.getUTCFullYear()}-W${weekNo}`;
}

// 随机抽取任务 (洗牌算法)
function getRandomTasks(pool, count) {
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

export async function onRequestGet(context) {
    const db = context.env.DB;
    const cookie = context.request.headers.get('Cookie');
    if (!cookie) return new Response(JSON.stringify({ error: 'Login' }), { status: 401 });
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ error: 'Invalid' }), { status: 401 });

    const now = new Date();
    // 强制转换为东八区日期字符串 (YYYY-MM-DD)
    const todayKey = new Date(now.getTime() + 8*3600*1000).toISOString().split('T')[0];
    const weekKey = getWeekKey(new Date(now.getTime() + 8*3600*1000));

    // 1. 检查今日任务
    let dailyTasks = await db.prepare('SELECT * FROM user_tasks WHERE user_id = ? AND period_key = ? AND category = "daily"').bind(user.id, todayKey).all();
    
    // 如果今天没任务，生成 3 个
    if (dailyTasks.results.length === 0) {
        const newDailies = getRandomTasks(POOL.daily, 3);
        const stmt = db.prepare('INSERT INTO user_tasks (user_id, task_code, category, description, target, reward_xp, reward_coins, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const batch = newDailies.map(t => stmt.bind(user.id, t.code, 'daily', t.desc, t.target, t.xp, t.coin, todayKey, Date.now()));
        await db.batch(batch);
        dailyTasks = await db.prepare('SELECT * FROM user_tasks WHERE user_id = ? AND period_key = ? AND category = "daily"').bind(user.id, todayKey).all();
    }

    // 2. 检查本周任务
    let weeklyTasks = await db.prepare('SELECT * FROM user_tasks WHERE user_id = ? AND period_key = ? AND category = "weekly"').bind(user.id, weekKey).all();

    // 如果本周没任务，生成 2 个
    if (weeklyTasks.results.length === 0) {
        const newWeeklies = getRandomTasks(POOL.weekly, 2);
        const stmt = db.prepare('INSERT INTO user_tasks (user_id, task_code, category, description, target, reward_xp, reward_coins, period_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        const batch = newWeeklies.map(t => stmt.bind(user.id, t.code, 'weekly', t.desc, t.target, t.xp, t.coin, weekKey, Date.now()));
        await db.batch(batch);
        weeklyTasks = await db.prepare('SELECT * FROM user_tasks WHERE user_id = ? AND period_key = ? AND category = "weekly"').bind(user.id, weekKey).all();
    }

    return new Response(JSON.stringify({
        daily: dailyTasks.results,
        weekly: weeklyTasks.results
    }));
}

export async function onRequestPost(context) {
    const db = context.env.DB;
    const cookie = context.request.headers.get('Cookie');
    const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
    const user = await db.prepare('SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
    if (!user) return new Response(JSON.stringify({ error: 'Invalid' }), { status: 401 });

    const { action, taskId } = await context.request.json();

    if (action === 'claim') {
        // 查任务
        const task = await db.prepare('SELECT * FROM user_tasks WHERE id = ? AND user_id = ?').bind(taskId, user.id).first();
        
        if (!task) return new Response(JSON.stringify({ success: false, error: '任务不存在' }));
        if (task.status === 2) return new Response(JSON.stringify({ success: false, error: '已领取过奖励' }));
        if (task.progress < task.target) return new Response(JSON.stringify({ success: false, error: '任务尚未完成' }));

        // 发奖 & 标记
        await db.batch([
            db.prepare('UPDATE users SET xp = xp + ?, coins = coins + ? WHERE id = ?').bind(task.reward_xp, task.reward_coins, user.id),
            db.prepare('UPDATE user_tasks SET status = 2 WHERE id = ?').bind(taskId)
        ]);

        return new Response(JSON.stringify({ success: true, message: `领取成功！XP+${task.reward_xp} i币+${task.reward_coins}` }));
    }
}
