// --- functions/api/inventory.js ---
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  
  // 鉴权 (省略重复代码，请自行补全 cookie 校验)
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({error:'Login'}),{status:401});
  const user = await db.prepare('SELECT id FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if(!user) return new Response(JSON.stringify({error:'Invalid'}),{status:401});

  // GET: 获取背包
  if (request.method === 'GET') {
      // 查所有道具，并按分类排序
      const items = await db.prepare('SELECT * FROM user_items WHERE user_id = ? ORDER BY category, created_at DESC').bind(user.id).all();
      return new Response(JSON.stringify({ success: true, list: items.results }));
  }

  // POST: 装备/卸下道具
  if (request.method === 'POST') {
      const { action, itemId, category } = await request.json();
      const columnMap = {
          'background': 'equipped_bg',
          'post_style': 'equipped_post_style',
          'bubble': 'equipped_bubble_style',
          'name_color': 'name_color' // ✅ 关键：必须加上这个映射
      };
      const dbColumn = columnMap[category];
      
      if (action === 'equip') {
          // 1. 先卸下同类别的其他道具
          await db.prepare('UPDATE user_items SET is_equipped = 0 WHERE user_id = ? AND category = ?').bind(user.id, category).run();
          
          // 2. 装备新道具 (标记 user_items)
          await db.prepare('UPDATE user_items SET is_equipped = 1 WHERE id = ? AND user_id = ?').bind(itemId, user.id).run();
          
          // 3. 同步到 users 表 (真正生效的一步)
          if (dbColumn) {
              // 注意：这里我们直接用前端传来的 itemId (对应 CATALOG 里的 id，如 'color_fire')
              // 也就是 user_items 表里的 item_id 字段
              const itemRow = await db.prepare('SELECT item_id FROM user_items WHERE id = ?').bind(itemId).first();
              if (itemRow) {
                  await db.prepare(`UPDATE users SET ${dbColumn} = ? WHERE id = ?`).bind(itemRow.item_id, user.id).run();
              }
          }
          
          return new Response(JSON.stringify({ success: true, message: '装备成功' }));
      }
      
      if (action === 'unequip') {
           await db.prepare('UPDATE user_items SET is_equipped = 0 WHERE id = ? AND user_id = ?').bind(itemId, user.id).run();
           
           // 清空 users 表对应字段
           if (dbColumn) {
               await db.prepare(`UPDATE users SET ${dbColumn} = NULL WHERE id = ?`).bind(user.id).run();
           }
           return new Response(JSON.stringify({ success: true, message: '已卸下' }));
      }
  }
}
