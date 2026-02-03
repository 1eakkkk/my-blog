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
      // 1. 出售物品 (Sell)
      if (action === 'sell') {
          const item = await db.prepare('SELECT * FROM user_items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first();
          if (!item) return new Response(JSON.stringify({ error: '物品不存在' }));
          if (item.category !== 'loot') return new Response(JSON.stringify({ error: '该物品不可出售' }));

          const value = item.val || 0;
          if (value <= 0) return new Response(JSON.stringify({ error: '物品无价值' }));

          await db.batch([
              db.prepare('DELETE FROM user_items WHERE id = ?').bind(itemId),
              db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(value, user.id)
          ]);

          return new Response(JSON.stringify({ success: true, message: `出售成功，获得 ${value} i币` }));
        }

        // 2. 展示物品 (Showcase) -> 发送到酒馆
        if (action === 'showcase') {
          const item = await db.prepare('SELECT * FROM user_items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first();
          if (!item) return new Response(JSON.stringify({ error: '物品不存在' }));

          const now = Date.now();
            // 构造一个特殊的 JSON 内容存入 meta_data (或者直接存入 content)
            // 为了简单，我们存入 content，前端解析
            // 格式: SHOWCASE::{JSON_DATA}
          const itemData = JSON.stringify({
              name: item.item_id, // 名字存在 item_id 字段里
              val: item.val,
              rarity: item.rarity,
              w: item.width,
              h: item.height
          });

            // 限制展示频率 (10秒一次)
            // ... (省略防刷逻辑) ...

          await db.prepare(`INSERT INTO pub_messages (user_id, username, nickname, avatar_url, content, type, created_at) VALUES (?, ?, ?, ?, ?, 'showcase', ?)`)
              .bind(user.id, user.username, user.nickname, user.avatar_url, itemData, 'showcase', now).run();

          return new Response(JSON.stringify({ success: true, message: '已展示到赛博酒馆' }));
      }
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
