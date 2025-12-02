// functions/api/fix_xp.js

export async function onRequest(context) {
    const db = context.env.DB;

    try {
        // 1. 尝试创建表 (如果不存在)
        // 包含 user_id, date_key, duel_count(格斗次数), xp_earned(今日获得经验)
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS user_daily_limits (
                user_id INTEGER,
                date_key TEXT,
                duel_count INTEGER DEFAULT 0,
                xp_earned INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, date_key)
            )
        `).run();

        // 2. 尝试添加 xp_earned 列 (为了防止表已存在但没字段的情况)
        // 如果列已存在，这一步会报错，所以用 try-catch 包裹忽略错误
        try {
            await db.prepare('ALTER TABLE user_daily_limits ADD COLUMN xp_earned INTEGER DEFAULT 0').run();
            console.log("Column xp_earned added.");
        } catch (e) {
            console.log("Column likely exists or table just created:", e.message);
        }

        return new Response("数据库修复成功！表 user_daily_limits 已更新。", { status: 200 });

    } catch (e) {
        return new Response("修复失败: " + e.message, { status: 500 });
    }
}
