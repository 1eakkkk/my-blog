// functions/api/fix_recharge_db.js

export async function onRequest(context) {
    const db = context.env.DB;

    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS recharge_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT,
                amount_str TEXT,
                proof_url TEXT,
                status TEXT DEFAULT 'pending', 
                created_at INTEGER
            )
        `).run();

        return new Response("充值审核系统数据库修复成功！表 recharge_requests 已创建。", { status: 200 });

    } catch (e) {
        return new Response("修复失败: " + e.message, { status: 500 });
    }
}
