// functions/api/init_recharge_sys.js
export async function onRequest(context) {
    const db = context.env.DB;
    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS recharge_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                username TEXT,
                amount_str TEXT, -- 档位描述，如 "0.1元"
                proof_url TEXT,  -- 截图的 R2 地址
                status TEXT DEFAULT 'pending', -- pending, approved, rejected
                created_at INTEGER
            )
        `).run();
        return new Response("充值申请系统数据库初始化完成！");
    } catch (e) {
        return new Response(e.message);
    }
}
