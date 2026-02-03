// --- functions/api/inventory.js ---
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  
  // 1. 鉴权 (关键修复：必须关联查询 users.* 获取昵称和头像，否则展示功能会崩)
  const cookie = request.headers.get('Cookie');
  const sessionId = cookie?.match(/session_id=([^;]+)/)?.[1];
  if (!sessionId) return new Response(JSON.stringify({error:'Login'}),{status:401});
  
  const user = await db.prepare('SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?').bind(sessionId).first();
  if(!user) return new Response(JSON.stringify({error:'Invalid'}),{status:401});

  // GET: 获取背包
  if (request.method === 'GET') {
      const items = await db.prepare('SELECT * FROM user_items WHERE user_id = ? ORDER BY category, created_at DESC').bind(user.id).all();
      return new Response(JSON.stringify({ success: true, list: items.results }));
  }

  // POST: 操作
  if (request.method === 'POST') {
      const { action, itemId, category } = await request.json();
      
      // === 1. 装备/卸下 (保留原有逻辑) ===
      const columnMap = {
          'background': 'equipped_bg',
          'post_style': 'equipped_post_style',
          'bubble': 'equipped_bubble_style',
          'name_color': 'name_color'
      };
      const dbColumn = columnMap[category];
      
      if (action === 'equip') {
          await db.prepare('UPDATE user_items SET is_equipped = 0 WHERE user_id = ? AND category = ?').bind(user.id, category).run();
          await db.prepare('UPDATE user_items SET is_equipped = 1 WHERE id = ? AND user_id = ?').bind(itemId, user.id).run();
          if (dbColumn) {
              const itemRow = await db.prepare('SELECT item_id FROM user_items WHERE id = ?').bind(itemId).first();
              if (itemRow) await db.prepare(`UPDATE users SET ${dbColumn} = ? WHERE id = ?`).bind(itemRow.item_id, user.id).run();
          }
          return new Response(JSON.stringify({ success: true, message: '装备成功' }));
      }
      
      if (action === 'unequip') {
           await db.prepare('UPDATE user_items SET is_equipped = 0 WHERE id = ? AND user_id = ?').bind(itemId, user.id).run();
           if (dbColumn) await db.prepare(`UPDATE users SET ${dbColumn} = NULL WHERE id = ?`).bind(user.id).run();
           return new Response(JSON.stringify({ success: true, message: '已卸下' }));
      }

      // === 2. 出售物品 (Sell Loot) ===
      if (action === 'sell') {
          const item = await db.prepare('SELECT * FROM user_items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first();
          if (!item) return new Response(JSON.stringify({ error: '物品不存在' }));
          
          // 容错：如果 category 不是 loot 但也有价值，也允许卖（防止死档）
          const value = item.val || 0;
          if (value <= 0) return new Response(JSON.stringify({ error: '该物品没有回收价值' }));

          await db.batch([
              db.prepare('DELETE FROM user_items WHERE id = ?').bind(itemId),
              db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(value, user.id)
          ]);

          return new Response(JSON.stringify({ success: true, message: `出售成功，账户 +${value} i币` }));
      }

      // === 3. 展示物品 (Showcase) ===
      if (action === 'showcase') {
          const item = await db.prepare('SELECT * FROM user_items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first();
          if (!item) return new Response(JSON.stringify({ error: '物品不存在' }));

          const now = Date.now();
          // 构造展示数据 JSON
          const itemData = JSON.stringify({
              name: item.item_id, // 物品名
              val: item.val || 0, // 价值 (防止 null)
              rarity: item.rarity || 'white', // 稀有度 (防止 null)
              w: item.width || 1, // 宽 (防止 null)
              h: item.height || 1 // 高 (防止 null)
          });

          // 插入消息表
          // 注意：这里需要 user.username 等信息，所以最上面的鉴权必须 select * 
          try {
              await db.prepare(`INSERT INTO pub_messages (user_id, username, nickname, avatar_url, content, type, created_at) VALUES (?, ?, ?, ?, ?, 'showcase', ?)`)
                  .bind(user.id, user.username, user.nickname, user.avatar_url, itemData, now).run();
              return new Response(JSON.stringify({ success: true, message: '已展示到赛博酒馆' }));
          } catch(e) {
              return new Response(JSON.stringify({ error: '展示失败: 数据库错误' }));
          }
      }
      // === 4. 批量出售 (Batch Sell) ===
      if (action === 'sell_batch') {
          const { rarities } = await request.json(); // 例如: ['white', 'green']
          
          if (!rarities || rarities.length === 0) {
              return new Response(JSON.stringify({ error: '未选择任何稀有度' }));
          }

          // 安全检查：防止 SQL 注入，构建 (?,?,?) 占位符
          const placeholders = rarities.map(() => '?').join(',');
          
          // 1. 先计算总价值和数量
          // 注意：必须限制 user_id 和 category='loot'
          const stats = await db.prepare(`
              SELECT SUM(val) as total_val, COUNT(*) as total_count 
              FROM user_items 
              WHERE user_id = ? 
                AND category = 'loot' 
                AND rarity IN (${placeholders})
          `).bind(user.id, ...rarities).first();

          const totalVal = stats.total_val || 0;
          const count = stats.total_count || 0;

          if (count === 0) {
              return new Response(JSON.stringify({ error: '没有符合条件的物品' }));
          }

          // 2. 执行删除与加钱
          await db.batch([
              db.prepare(`
                  DELETE FROM user_items 
                  WHERE user_id = ? 
                    AND category = 'loot' 
                    AND rarity IN (${placeholders})
              `).bind(user.id, ...rarities),
              
              db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(totalVal, user.id)
          ]);

          return new Response(JSON.stringify({ 
              success: true, 
              message: `清理完成！共售出 ${count} 件物品，回收 ${totalVal} i币` 
          }));
      }
  }
  
  return new Response(JSON.stringify({ error: 'Method Error' }));
}
