export async function onRequest(context) {
    const db = context.env.DB;
    try {
        await db.prepare(`
            CREATE TABLE IF NOT EXISTS recharge_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                value INTEGER NOT NULL,
                status TEXT DEFAULT 'unused',
                used_by INTEGER,
                used_at INTEGER,
                created_at INTEGER
            )
        `).run();
        
        // 生成两个测试卡密 (方便你测试)
        // 650币 (0.1元档) 和 4300币 (0.6元档)
        await db.batch([
            db.prepare("INSERT OR IGNORE INTO recharge_codes (code, value, created_at) VALUES ('TEST-650', 650, ?)").bind(Date.now()),
            db.prepare("INSERT OR IGNORE INTO recharge_codes (code, value, created_at) VALUES ('TEST-4300', 4300, ?)").bind(Date.now())
        ]);

        return new Response("充值码表创建成功！已生成测试卡密: TEST-650, TEST-4300");
    } catch (e) {
        return new Response(e.message);
    }
}
