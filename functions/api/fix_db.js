// --- functions/api/fix_db.js ---
export async function onRequest(context) {
  const db = context.env.DB;
  try {
    // 尝试添加 name_color 字段，如果已存在会报错，忽略即可
    await db.prepare('ALTER TABLE users ADD COLUMN name_color TEXT').run();
    return new Response("字段 name_color 添加成功");
  } catch (e) {
    return new Response("字段可能已存在或出错: " + e.message);
  }
}
