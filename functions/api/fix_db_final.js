export async function onRequest(context) {
    const db = context.env.DB;
    try {
        // 补全所有可能缺失的表
        await db.batch([
            db.prepare(`CREATE TABLE IF NOT EXISTS recharge_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, amount_str TEXT, proof_url TEXT, status TEXT DEFAULT 'pending', created_at INTEGER)`),
            db.prepare(`CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, message TEXT, is_read INTEGER DEFAULT 0, created_at INTEGER, link TEXT)`)
        ]);
        return new Response("数据库完整性修复成功");
    } catch (e) {
        return new Response(e.message);
    }
}
