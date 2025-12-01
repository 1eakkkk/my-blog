// --- functions/api/config.js ---
export async function onRequest(context) {
    const db = context.env.DB;
    // 获取公开配置
    const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
    // 默认为 true (开启)
    const isEnabled = setting ? setting.value === 'true' : true;
    
    return new Response(JSON.stringify({ 
        turnstileEnabled: isEnabled 
    }), { headers: { 'Content-Type': 'application/json' } });
}
