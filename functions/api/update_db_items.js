// functions/api/update_db_items.js
export async function onRequest(context) {
    const db = context.env.DB;
    try {
        // 给 user_items 表增加 4 个字段
        await db.prepare("ALTER TABLE user_items ADD COLUMN val INTEGER DEFAULT 0").run();
        await db.prepare("ALTER TABLE user_items ADD COLUMN rarity TEXT DEFAULT 'common'").run();
        await db.prepare("ALTER TABLE user_items ADD COLUMN width INTEGER DEFAULT 1").run();
        await db.prepare("ALTER TABLE user_items ADD COLUMN height INTEGER DEFAULT 1").run();
        return new Response("数据库升级成功：已添加 val, rarity, width, height 字段");
    } catch (e) {
        return new Response("无需升级或错误: " + e.message);
    }
}
