// Gokski — Cloudflare Worker
// აწვდის აპის ფაილებს (public/) და /api/stt მისამართზე გამოთქმას ტექსტად აქცევს.
//
// საიდუმლოები (Cloudflare → Worker → Settings → Variables and Secrets):
//   OPENAI_API_KEY      — თუ არის, გამოიყენება OpenAI Whisper (ყველაზე ზუსტი)
//   TELEGRAM_BOT_TOKEN  — თუ არის, მოთხოვნა მიიღება მხოლოდ შენი Telegram აპიდან
// OpenAI გასაღების გარეშე გამოიყენება Cloudflare Workers AI (უფასო ლიმიტით).

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB ≈ 10 წამიანი ჩანაწერის მარაგით

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/stt') {
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
      try {
        return await speechToText(request, env);
      } catch (e) {
        return json({ error: String(e && e.message || e) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function speechToText(request, env) {
  if (env.TELEGRAM_BOT_TOKEN) {
    const ok = await validInitData(request.headers.get('X-Init-Data') || '', env.TELEGRAM_BOT_TOKEN);
    if (!ok) return json({ error: 'Open the app from Telegram' }, 401);
  }
  const type = (request.headers.get('Content-Type') || 'audio/webm').split(';')[0];
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json({ error: 'Empty audio' }, 400);
  if (audio.byteLength > MAX_BYTES) return json({ error: 'Recording is too long' }, 413);

  if (env.OPENAI_API_KEY) {
    const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([audio], { type }), `speech.${ext}`);
    form.append('model', env.STT_MODEL || 'whisper-1');
    form.append('language', 'en');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: (data.error && data.error.message) || `OpenAI ${r.status}` }, 502);
    return json({ text: data.text || '' });
  }

  if (env.AI) {
    const res = await env.AI.run('@cf/openai/whisper', { audio: [...new Uint8Array(audio)] });
    return json({ text: (res && res.text) || '' });
  }

  return json({ error: 'Speech service is not configured' }, 501);
}

// Telegram Mini App-ის initData-ს ხელმოწერის შემოწმება
async function validInitData(initData, botToken) {
  if (!initData) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return false;
  params.delete('hash');
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const enc = new TextEncoder();
  const k1 = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', k1, enc.encode(botToken));
  const k2 = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k2, enc.encode(checkString));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  const authDate = Number(params.get('auth_date') || 0);
  const fresh = !authDate || Date.now() / 1000 - authDate < 7 * 24 * 3600;
  return hex === hash && fresh;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
