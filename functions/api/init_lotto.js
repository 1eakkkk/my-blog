export async function onRequest(context) {
    const db = context.env.DB;
    // 1. 乐透下注表
    await db.prepare(`CREATE TABLE IF NOT EXISTS lotto_bets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT, created_at INTEGER)`).run();
    // 2. 乐透状态记录 (用于判断是否该开奖了)
    await db.prepare(`CREATE TABLE IF NOT EXISTS system_state (key TEXT PRIMARY KEY, value TEXT)`).run();
    // 初始化上次开奖时间 (如果没有)
    await db.prepare(`INSERT OR IGNORE INTO system_state (key, value) VALUES ('last_lotto_draw', '${Date.now()}')`).run();
    
    return new Response("Lotto DB Init OK");
}
