export async function onRequest(context) {
  return new Response(JSON.stringify({
    turnstileEnabled: true
  }), { headers: { 'Content-Type': 'application/json' } });
}
