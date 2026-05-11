export async function onRequest(context) {
  const db = context.env.DB;
  const setting = await db.prepare("SELECT value FROM system_settings WHERE key = 'turnstile_enabled'").first();
  const isEnabled = setting ? setting.value === 'true' : true;
  return new Response(JSON.stringify({ turnstileEnabled: isEnabled }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
