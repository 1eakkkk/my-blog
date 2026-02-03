// functions/api/fix_loot_items.js
export async function onRequest(context) {
    const db = context.env.DB;
    try {
        // 给所有 category='loot' 但 val 为空的物品，赋予默认值
        // 默认值：价值10，形状1x1，稀有度白色
        const res = await db.prepare(`
            UPDATE user_items 
            SET val = 10, width = 1, height = 1, rarity = 'white'
            WHERE category = 'loot' AND (val IS NULL OR val = 0)
        `).run();
        
        return new Response(`修复完成：更新了 ${res.meta.changes} 个旧物品数据。`);
    } catch (e) {
        return new Response("无需修复或出错: " + e.message);
    }
}
