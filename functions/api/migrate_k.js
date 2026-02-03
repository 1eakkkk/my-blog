// --- functions/api/migrate_k.js ---
export async function onRequest(context) {
    const db = context.env.DB;
    
    try {
        // 1. 将 K币 1:1 转移到 i币
        // 使用 COALESCE 防止 null 值报错
        const res = await db.prepare(`
            UPDATE users 
            SET coins = coins + COALESCE(k_coins, 0), 
                k_coins = 0 
            WHERE k_coins > 0
        `).run();

        return new Response(JSON.stringify({
            success: true,
            message: `迁移完成。${res.meta.changes} 位用户的 K币已合并入 i币账户。`
        }));
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }));
    }
}
