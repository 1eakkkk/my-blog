// --- functions/api/admin.js ---
export async function onRequestPost(context) {
  const db = context.env.DB;
  
  // 1. 验证管理员权限
  const cookie = context.request.headers.get('Cookie');
  if (!cookie) return new Response(JSON.stringify({ error: '无权操作' }), { status: 401 });
  const sessionId = cookie.match(/session_id=([^;]+)/)?.[1];
  const admin = await db.prepare(`SELECT users.role FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.session_id = ?`).bind(sessionId).first();
  
  if (!admin || admin.role !== 'admin') {
    return new Response(JSON.stringify({ success: false, error: '权限不足：需要管理员权限' }), { status: 403 });
  }

  const { action, target_user_id, target_username } = await context.request.json();

  // === 功能1: 封禁/解封账号 ===
  if (action === 'ban_user') {
    await db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").bind(target_user_id).run();
    return new Response(JSON.stringify({ success: true, message: '用户已封禁' }));
  }
  
  // === 功能2: 生成/查看旧账号密钥 ===
  if (action === 'gen_key') {
    // 查找目标用户
    const target = await db.prepare("SELECT id, recovery_key FROM users WHERE username = ?").bind(target_username).first();
    if (!target) return new Response(JSON.stringify({ success: false, error: '用户不存在' }));
    
    // 如果已有，直接返回；如果没有，生成新的
    let key = target.recovery_key;
    if (!key) {
        const generateKey = () => Math.random().toString(36).substring(2, 6).toUpperCase();
        key = `KEY-${generateKey()}-${generateKey()}-${generateKey()}`;
        await db.prepare("UPDATE users SET recovery_key = ? WHERE id = ?").bind(key, target.id).run();
    }
    return new Response(JSON.stringify({ success: true, message: '密钥获取成功', key: key }));
  }

  // === 功能3: 发放自定义头衔 ===
  if (action === 'grant_title') {
    const { title, color } = await context.request.json();
    // 验证长度 2-6
    if(title && (title.length < 2 || title.length > 6)) {
        return new Response(JSON.stringify({ success: false, error: '头衔长度限制 2-6 字符' }));
    }
    
    await db.prepare("UPDATE users SET custom_title = ?, custom_title_color = ? WHERE username = ?")
      .bind(title, color, target_username) // title传空字符串代表删除头衔
      .run();
      
    return new Response(JSON.stringify({ success: true, message: '头衔设置成功' }));
  }

  return new Response(JSON.stringify({ success: false, error: '未知指令' }));
}
