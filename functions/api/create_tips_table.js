// functions/api/create_tips_table.js

export async function onRequest(context) {
    const db = context.env.DB;

    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS tips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER NOT NULL,
                receiver_id INTEGER NOT NULL,
                post_id INTEGER,
                amount INTEGER NOT NULL,
                created_at INTEGER
            )
        `).run();

        // 顺便加上 user_daily_limits 表（如果还没有的话）
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS user_daily_limits (
                user_id INTEGER,
                date_key TEXT,
                duel_count INTEGER DEFAULT 0,
                xp_earned INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, date_key)
            )
        `).run();

        // 顺便检查 user_daily_limits 是否有 xp_earned 列
        try {
            await db.prepare('ALTER TABLE user_daily_limits ADD COLUMN xp_earned INTEGER DEFAULT 0').run();
        } catch (e) {
            // 列已存在，忽略
        }

        return new Response("数据库修复成功！表 tips 和 user_daily_limits 已就绪。", { status: 200 });

    } catch (e) {
        return new Response("建表失败: " + e.message, { status: 500 });
    }
}
