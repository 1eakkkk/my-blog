// functions/api/update_db_gua.js
export async function onRequest(context) {
    const db = context.env.DB;
    try {
        // 添加 daily_hexagram_code 字段
        await db.prepare("ALTER TABLE users ADD COLUMN daily_hexagram_code TEXT").run();
        return new Response("数据库升级成功：已添加卦象存储字段");
    } catch (e) {
        return new Response("无需升级或错误: " + e.message);
    }
}
