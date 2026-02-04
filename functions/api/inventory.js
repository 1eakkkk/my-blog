// --- functions/api/inventory.js ---
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  
  // 1. 鉴权
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
      // 注意：这里需要 try-catch 解析 JSON，因为有些请求可能没有 body (虽然逻辑上都有)
      let body;
      try {
          body = await request.json();
      } catch (e) {
          return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
      }

      const { action, itemId, category, rarities } = body;
      
      // === 1. 装备/卸下 (修复版：增加过期校验) ===
      const columnMap = {
          'background': 'equipped_bg',
          'post_style': 'equipped_post_style',
          'bubble': 'equipped_bubble_style',
          'name_color': 'name_color'
      };
      const dbColumn = columnMap[category];
      
      if (action === 'equip') {
          // 1. 先查询物品详情 (检查是否过期)
          const item = await db.prepare('SELECT * FROM user_items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first();
          
          if (!item) return new Response(JSON.stringify({ error: '物品不存在' }));
          
          // 2. 过期检查
          if (item.expires_at && item.expires_at > 0 && item.expires_at < Date.now()) {
              // 如果已过期，自动标记为未装备，并返回错误
              await db.prepare('UPDATE user_items SET is_equipped = 0 WHERE id = ?').bind(itemId).run();
              // 如果正好是当前装备的，清除 users 表状态
              if (dbColumn) {
                  // 只有当 users 表里的特效正是这个物品时才清除 (防止误删新买的同类物品)
                  await db.prepare(`UPDATE users SET ${dbColumn} = NULL WHERE id = ? AND ${dbColumn} = ?`).bind(user.id, item.item_id).run();
              }
              return new Response(JSON.stringify({ success: false, error: '该物品已过期，无法装备' }), { status: 400 });
          }

          // 3. 正常装备流程
          // 先卸下同类别的其他道具
          await db.prepare('UPDATE user_items SET is_equipped = 0 WHERE user_id = ? AND category = ?').bind(user.id, category).run();
          // 装备当前道具
          await db.prepare('UPDATE user_items SET is_equipped = 1 WHERE id = ?').bind(itemId).run();
          
          // 同步到 users 表
          if (dbColumn) {
              await db.prepare(`UPDATE users SET ${dbColumn} = ? WHERE id = ?`).bind(item.item_id, user.id).run();
          }
          
          return new Response(JSON.stringify({ success: true, message: '装备成功' }));
      }
      
      if (action === 'unequip') {
           await db.prepare('UPDATE user_items SET is_equipped = 0 WHERE id = ? AND user_id = ?').bind(itemId, user.id).run();
           if (dbColumn) await db.prepare(`UPDATE users SET ${dbColumn} = NULL WHERE id = ?`).bind(user.id).run();
           return new Response(JSON.stringify({ success: true, message: '已卸下' }));
      }

      // === 2. 出售单个物品 (Sell Loot) ===
      if (action === 'sell') {
          const item = await db.prepare('SELECT * FROM user_items WHERE id = ? AND user_id = ?').bind(itemId, user.id).first();
          if (!item) return new Response(JSON.stringify({ error: '物品不存在' }));
          
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
          const itemData = JSON.stringify({
              name: item.item_id,
              val: item.val || 0,
              rarity: item.rarity || 'white',
              w: item.width || 1,
              h: item.height || 1
          });

          try {
              await db.prepare(`INSERT INTO pub_messages (user_id, username, nickname, avatar_url, content, type, created_at) VALUES (?, ?, ?, ?, ?, 'showcase', ?)`)
                  .bind(user.id, user.username, user.nickname, user.avatar_url, itemData, now).run();
              return new Response(JSON.stringify({ success: true, message: '已展示到赛博酒馆' }));
          } catch(e) {
              return new Response(JSON.stringify({ error: '展示失败: 数据库错误' }));
          }
      }

      // === 4. 批量出售 (Batch Sell) - 修复版 ===
      if (action === 'sell_batch') {
          try {
              // 1. 严格校验
              if (!rarities || !Array.isArray(rarities) || rarities.length === 0) {
                  return new Response(JSON.stringify({ error: '未选择任何稀有度' }), { status: 400 });
              }

              // 2. 构造安全的 SQL 占位符
              const placeholders = rarities.map(() => '?').join(',');
              
              // 3. 统计价值
              const querySql = `
                  SELECT SUM(val) as total_val, COUNT(*) as total_count 
                  FROM user_items 
                  WHERE user_id = ? 
                    AND category = 'loot' 
                    AND rarity IN (${placeholders})
              `;
              
              const queryParams = [user.id, ...rarities];
              const stats = await db.prepare(querySql).bind(...queryParams).first();

              const totalVal = (stats && stats.total_val) ? stats.total_val : 0;
              const count = (stats && stats.total_count) ? stats.total_count : 0;

              if (count === 0) {
                  return new Response(JSON.stringify({ success: false, error: '背包中没有符合条件的物品' }));
              }

              // 4. 执行删除与加钱
              const deleteSql = `
                  DELETE FROM user_items 
                  WHERE user_id = ? 
                    AND category = 'loot' 
                    AND rarity IN (${placeholders})
              `;

              await db.batch([
                  db.prepare(deleteSql).bind(...queryParams),
                  db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').bind(totalVal, user.id)
              ]);

              return new Response(JSON.stringify({ 
                  success: true, 
                  message: `成功清理 ${count} 件物品，回收资金 +${totalVal.toLocaleString()} i币` 
              }));

          } catch (err) {
              return new Response(JSON.stringify({ 
                  success: false, 
                  error: "系统错误: " + err.message 
              }), { status: 200 });
          }
      }
  }
  
  return new Response(JSON.stringify({ error: 'Method Error' }));
}
