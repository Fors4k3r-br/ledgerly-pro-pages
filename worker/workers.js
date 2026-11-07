// Cloudflare Worker: troca e renova tokens do Google para o Ledgerly Pro.
// Variáveis: GOOGLE_CLIENT_ID (texto), GOOGLE_CLIENT_SECRET (SEGREDO), REDIRECT_URI = postmessage (texto)
const ALLOWED_ORIGIN = 'https://fors4k3r-br.github.io';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS')
      return new Response(null, { status: origin === ALLOWED_ORIGIN ? 204 : 403, headers: cors });
    if (origin !== ALLOWED_ORIGIN) return json({ error: 'forbidden_origin' }, 403);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
    const { action, code, refresh_token } = body;

    let params;
    if (action === 'exchange_code' && typeof code === 'string') {
      params = { code, redirect_uri: env.REDIRECT_URI, grant_type: 'authorization_code' };
    } else if (action === 'refresh_token' && typeof refresh_token === 'string') {
      params = { refresh_token, grant_type: 'refresh_token' };
    } else {
      return json({ error: 'invalid_request' }, 400);
    }

    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET }),
    });
    const data = await r.json().catch(() => ({ error: 'bad_upstream_response' }));
    return json(data, r.status);
  },
};
