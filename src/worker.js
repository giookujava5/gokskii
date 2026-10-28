// Gokski — Cloudflare Worker
//  • აწვდის აპის ფაილებს (public/)
//  • /api/stt   — ხმა → ტექსტი (გამოთქმის შემოწმება, საუბარი)
//  • /api/tts   — ტექსტი → ბუნებრივი ხმა
//  • /api/chat  — AI საუბრის პარტნიორი
//  • /api/progress, /api/board — პროგრესი, რანკის ცხრილი, შეხსენების პარამეტრები
//  • /api/tg    — Telegram ბოტი (Mr. Ben), webhook
//  • cron       — საღამოს შეხსენებები და კვირის ანგარიში
//
// საიდუმლოები (Cloudflare → gokskii → Settings → Variables and Secrets):
//   TELEGRAM_BOT_TOKEN  — სავალდებულო ბოტისთვის, შეხსენებებისა და რანკის ცხრილისთვის
//   OPENAI_API_KEY      — რეკომენდებული: ზუსტი გამოთქმა, ბუნებრივი ხმა, ჭკვიანი საუბარი
// OpenAI გასაღების გარეშე გამოიყენება Cloudflare Workers AI (უფასო დღიური ლიმიტით).

import { DurableObject } from 'cloudflare:workers';

const TZ_OFFSET_H = 4; // Asia/Tbilisi
const DAILY_AI_LIMIT = 400;
const MAX_AUDIO = 3 * 1024 * 1024;
const TIERS = ['ბრინჯაო', 'ვერცხლი', 'ოქრო', 'პლატინა', 'ალმასი', 'ოსტატი', 'ლეგენდა'];
const DIVS = ['III', 'II', 'I'];
const LEVELS = [[0, 'A1'], [20, 'A2'], [45, 'B1'], [75, 'B2']];
// ენები: ყოველ ენას ცალკე პროგრესი, რანკი და ცხრილი აქვს
const LANGS = {
  en: { name: 'English', ka: 'ინგლისური', kaAdv: 'ინგლისურად', flag: '🇬🇧', teacher: 'Mr. Ben', stt: 'en', tts: 'en' },
  de: { name: 'German', ka: 'გერმანული', kaAdv: 'გერმანულად', flag: '🇩🇪', teacher: 'Herr Ben', stt: 'de', tts: null },
};
const langOf = v => (LANGS[v] ? v : 'en');
const reqLang = request => langOf(request.headers.get('X-Lang') || new URL(request.url).searchParams.get('lang'));
const VOICES = ['alloy', 'nova', 'onyx', 'echo', 'shimmer', 'fable', 'sage', 'coral', 'ash'];

// ====================== STORE (Durable Object, SQLite) ======================
export class GokskiStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY, name TEXT, username TEXT,
      xp INTEGER DEFAULT 0, streak INTEGER DEFAULT 0, last_day TEXT DEFAULT '', unit INTEGER DEFAULT 0,
      tier INTEGER DEFAULT 0, div INTEGER DEFAULT 0, rp INTEGER DEFAULT 0,
      wk TEXT DEFAULT '', wk_xp INTEGER DEFAULT 0, wk_les INTEGER DEFAULT 0, pwk_xp INTEGER DEFAULT 0,
      remind INTEGER DEFAULT 1, remind_hour INTEGER DEFAULT 20,
      reminded TEXT DEFAULT '', reminded2 TEXT DEFAULT '', reported TEXT DEFAULT '',
      chat TEXT DEFAULT '[]', started INTEGER DEFAULT 0, updated INTEGER DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)`);
    // v4: როდის შემოვიდა და ბოლოს როდის გამოჩნდა
    for (const col of ['joined', 'seen']) { try { this.sql.exec(`ALTER TABLE users ADD COLUMN ${col} INTEGER DEFAULT 0`); } catch (e) {} }
    // v5: ენები — users.lang = ბოლოს არჩეული ენა; progress = თითო ენის ცალკე პროგრესი
    try { this.sql.exec(`ALTER TABLE users ADD COLUMN lang TEXT DEFAULT 'en'`); } catch (e) {}
    this.sql.exec(`CREATE TABLE IF NOT EXISTS progress(
      user_id INTEGER, lang TEXT, xp INTEGER DEFAULT 0, streak INTEGER DEFAULT 0, last_day TEXT DEFAULT '', unit INTEGER DEFAULT 0,
      tier INTEGER DEFAULT 0, div INTEGER DEFAULT 0, rp INTEGER DEFAULT 0,
      wk TEXT DEFAULT '', wk_xp INTEGER DEFAULT 0, wk_les INTEGER DEFAULT 0, pwk_xp INTEGER DEFAULT 0, updated INTEGER DEFAULT 0,
      PRIMARY KEY(user_id, lang))`);
    if (this.kvGet('mig_lang') !== '1') {
      // არსებული (ინგლისურის) პროგრესი გადადის ენების ცხრილში, არაფერი იკარგება
      this.sql.exec(`INSERT OR IGNORE INTO progress(user_id, lang, xp, streak, last_day, unit, tier, div, rp, wk, wk_xp, wk_les, pwk_xp, updated)
        SELECT id, 'en', xp, streak, last_day, unit, tier, div, rp, wk, wk_xp, wk_les, pwk_xp, updated FROM users
        WHERE updated > 0 AND (xp > 0 OR tier > 0 OR rp > 0 OR last_day != '')`);
      this.kvSet('mig_lang', '1');
    }
  }
  // აბრუნებს true-ს, თუ მომხმარებელი ახალია
  touch(id, name, username) {
    const now = Date.now();
    const isNew = !this.sql.exec(`SELECT 1 FROM users WHERE id = ?`, id).toArray().length;
    this.sql.exec(`INSERT INTO users(id, name, username, updated, joined, seen) VALUES(?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = CASE WHEN excluded.name != '' THEN excluded.name ELSE users.name END,
        username = CASE WHEN excluded.username != '' THEN excluded.username ELSE users.username END, seen = excluded.seen`, id, name || '', username || '', now, now, now);
    return isNew;
  }
  adminStats(now) {
    const one = q => (this.sql.exec(q[0], ...q.slice(1)).toArray()[0] || {}).n || 0;
    const weekStart = (Number(now.wk) * 864e5) - 4 * 3600e3;
    return {
      total: one([`SELECT COUNT(*) n FROM users`]),
      started: one([`SELECT COUNT(*) n FROM users WHERE started = 1`]),
      today: one([`SELECT COUNT(*) n FROM users WHERE last_day = ?`, now.today]),
      week: one([`SELECT COUNT(*) n FROM users WHERE wk = ? AND wk_xp > 0`, now.wk]),
      fresh: one([`SELECT COUNT(*) n FROM users WHERE joined >= ?`, weekStart]),
      rows: this.sql.exec(`SELECT id, name, username, xp, streak, last_day, unit, tier, div, rp, wk, wk_xp, started, joined, lang,
        MAX(seen, updated) last FROM users ORDER BY last DESC LIMIT 30`).toArray(),
    };
  }
  markStarted(id) { this.sql.exec(`UPDATE users SET started = 1 WHERE id = ?`, id); }
  progress(id, p) {
    this.touch(id, p.name, p.username);
    const lang = langOf(p.lang), now = Date.now();
    const cur = this.sql.exec(`SELECT wk, wk_xp, pwk_xp FROM progress WHERE user_id = ? AND lang = ?`, id, lang).toArray()[0] || {};
    const pwk = cur.wk && cur.wk !== p.wk ? cur.wk_xp : (cur.pwk_xp || 0);
    const vals = [int(p.xp), int(p.streak), String(p.lastDay || ''), int(p.unit), int(p.tier), int(p.div), int(p.rp), String(p.wk || ''), int(p.wkXp), int(p.wkLes), pwk, now];
    this.sql.exec(`INSERT INTO progress(user_id, lang, xp, streak, last_day, unit, tier, div, rp, wk, wk_xp, wk_les, pwk_xp, updated)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, lang) DO UPDATE SET xp = excluded.xp, streak = excluded.streak, last_day = excluded.last_day, unit = excluded.unit,
        tier = excluded.tier, div = excluded.div, rp = excluded.rp, wk = excluded.wk, wk_xp = excluded.wk_xp, wk_les = excluded.wk_les,
        pwk_xp = excluded.pwk_xp, updated = excluded.updated`, id, lang, ...vals);
    // users-ის სტრიქონი = ბოლოს გამოყენებული ენის სარკე (ბოტი, შეხსენება, ადმინი)
    this.sql.exec(`UPDATE users SET xp = ?, streak = ?, last_day = ?, unit = ?, tier = ?, div = ?, rp = ?,
      wk = ?, wk_xp = ?, wk_les = ?, pwk_xp = ?, updated = ?, lang = ? WHERE id = ?`, ...vals, lang, id);
    if (p.remind !== undefined) this.setRemind(id, p.remind ? 1 : 0, p.remindHour);
    return this.user(id);
  }
  setRemind(id, on, hour) {
    const h = Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
    this.sql.exec(`UPDATE users SET remind = ?, remind_hour = COALESCE(?, remind_hour) WHERE id = ?`, on ? 1 : 0, h, id);
    return this.user(id);
  }
  user(id) {
    const r = this.sql.exec(`SELECT id, name, username, xp, streak, last_day, unit, tier, div, rp, wk, wk_xp, wk_les, pwk_xp,
      remind, remind_hour, started, lang FROM users WHERE id = ?`, id).toArray()[0];
    return r || null;
  }
  langs(id) {
    return this.sql.exec(`SELECT lang, xp, streak, last_day, unit, tier, div, rp, wk, wk_xp, wk_les, pwk_xp FROM progress
      WHERE user_id = ? AND (xp > 0 OR tier > 0 OR rp > 0) ORDER BY updated DESC`, id).toArray();
  }
  setLang(id, lang) { this.sql.exec(`UPDATE users SET lang = ? WHERE id = ?`, langOf(lang), id); }
  board(lang) {
    return this.sql.exec(`SELECT u.id id, u.name name, p.xp xp, p.streak streak, p.tier tier, p.div div, p.rp rp, p.wk wk, p.wk_xp wk_xp, p.unit unit
      FROM progress p JOIN users u ON u.id = p.user_id
      WHERE p.lang = ? AND p.updated > 0 AND (p.xp > 0 OR p.tier > 0 OR p.rp > 0) ORDER BY p.tier DESC, p.div DESC, p.rp DESC, p.xp DESC LIMIT 100`, langOf(lang)).toArray();
  }
  getChat(id) {
    const r = this.sql.exec(`SELECT chat FROM users WHERE id = ?`, id).toArray()[0];
    try { return JSON.parse(r && r.chat || '[]'); } catch (e) { return []; }
  }
  setChat(id, msgs) { this.sql.exec(`UPDATE users SET chat = ? WHERE id = ?`, JSON.stringify(msgs.slice(-12)), id); }
  quota(id, dayKey, limit) {
    const k = `q:${id}:${dayKey}`;
    const n = Number((this.sql.exec(`SELECT v FROM kv WHERE k = ?`, k).toArray()[0] || {}).v || 0) + 1;
    this.sql.exec(`INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, String(n));
    return n <= limit;
  }
  kvGet(k) { return (this.sql.exec(`SELECT v FROM kv WHERE k = ?`, k).toArray()[0] || {}).v ?? null; }
  kvSet(k, v) { this.sql.exec(`INSERT INTO kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`, k, String(v)); }
  // აბრუნებს, ვის რა შეტყობინება უნდა გაეგზავნოს ამ საათში, და მონიშნავს გაგზავნილად
  due(now) {
    const out = [];
    const rows = this.sql.exec(`SELECT * FROM users WHERE started = 1`).toArray();
    const all = {};
    for (const r of this.sql.exec(`SELECT * FROM progress`).toArray()) (all[r.user_id] = all[r.user_id] || []).push(r);
    for (const u of rows) {
      const ls = all[u.id] || [];
      const doneToday = u.last_day === now.today || ls.some(r => r.last_day === now.today);
      u.streak = Math.max(u.streak || 0, ...ls.map(r => r.streak || 0));
      if (u.remind && !doneToday && now.hour === u.remind_hour && u.reminded !== now.today) {
        out.push({ kind: 'evening', u });
        this.sql.exec(`UPDATE users SET reminded = ? WHERE id = ?`, now.today, u.id);
      } else if (u.remind && !doneToday && u.streak > 0 && now.hour === Math.min(23, u.remind_hour + 2) && u.reminded2 !== now.today) {
        out.push({ kind: 'late', u });
        this.sql.exec(`UPDATE users SET reminded2 = ? WHERE id = ?`, now.today, u.id);
      }
      const wl = ls.filter(r => r.wk === now.wk && r.wk_xp > 0);
      if (now.dow === 0 && now.hour === 21 && u.reported !== now.wk && (wl.length || (u.wk === now.wk && u.wk_xp > 0))) {
        out.push({ kind: 'weekly', u, ls: wl.length ? wl : [Object.assign({ lang: u.lang || 'en' }, u)] });
        this.sql.exec(`UPDATE users SET reported = ? WHERE id = ?`, now.wk, u.id);
      }
      // ძველი კვოტის ჩანაწერების გასუფთავება
    }
    this.sql.exec(`DELETE FROM kv WHERE k LIKE 'q:%' AND k NOT LIKE ?`, `q:%:${now.today}`);
    return out;
  }
}

// ====================== ROUTER ======================
export default {
  async fetch(request, env, ctx) {
    env = cleanEnv(env);
    const url = new URL(request.url);
    const p = url.pathname;
    if (!p.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (p === '/api/tg') return await telegramWebhook(request, env, ctx);
      if (p === '/api/health') return await apiHealth(env, url.origin);
      if (request.method !== 'POST' && !(p === '/api/tts' && request.method === 'GET')) return json({ error: 'Use POST' }, 405);
      const auth = await authenticate(request, env);
      if (auth instanceof Response) return auth;
      if (p === '/api/stt') return await apiStt(request, env, auth);
      if (p === '/api/tts') return await apiTts(request, env, ctx, auth);
      if (p === '/api/chat') return await apiChat(request, env, auth);
      if (p === '/api/progress') return await apiProgress(request, env, ctx, auth, url.origin);
      if (p === '/api/board') return await apiBoard(request, env, auth);
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: String((e && e.message) || e) }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cron(cleanEnv(env)));
  },
};

const store = env => env.STORE.get(env.STORE.idFromName('main'));

// ====================== AUTH ======================
async function authenticate(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) return { user: null };
  const user = await validInitData(request.headers.get('X-Init-Data') || '', env.TELEGRAM_BOT_TOKEN);
  if (!user) return json({ error: 'Open the app from Telegram' }, 401);
  return { user };
}
function requireUser(auth) {
  return auth.user ? null : json({ error: 'TELEGRAM_BOT_TOKEN is not set' }, 501);
}
async function withinQuota(env, auth) {
  if (!auth.user) return true;
  return store(env).quota(auth.user.id, tbilisi().today, DAILY_AI_LIMIT);
}

async function validInitData(initData, botToken) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac(new TextEncoder().encode('WebAppData'), botToken);
  const sig = hex(await hmac(secret, check));
  const authDate = Number(params.get('auth_date') || 0);
  if (sig !== hash || (authDate && Date.now() / 1000 - authDate > 30 * 24 * 3600)) return null;
  try { return JSON.parse(params.get('user') || 'null'); } catch (e) { return null; }
}
async function hmac(keyBytes, msg) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
}
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function sha(s) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }

// ====================== SPEECH TO TEXT ======================
async function apiStt(request, env, auth) {
  if (!(await withinQuota(env, auth))) return json({ error: 'Daily limit reached' }, 429);
  const type = (request.headers.get('Content-Type') || 'audio/webm').split(';')[0];
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json({ error: 'Empty audio' }, 400);
  if (audio.byteLength > MAX_AUDIO) return json({ error: 'Recording is too long' }, 413);
  return json({ text: await transcribe(env, audio, type, reqLang(request)) });
}
async function transcribe(env, audio, type, lang = 'en') {
  if (env.OPENAI_API_KEY) {
    const ext = type.includes('mp4') || type.includes('m4a') ? 'mp4' : type.includes('ogg') || type.includes('oga') ? 'ogg' : type.includes('wav') ? 'wav' : type.includes('mpeg') ? 'mp3' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([audio], { type }), `speech.${ext}`);
    form.append('model', env.STT_MODEL || 'whisper-1');
    form.append('language', LANGS[langOf(lang)].stt);
    const r = await fetch(`${openaiBase(env)}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: form });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d.error && d.error.message) || `OpenAI ${r.status}`);
    return d.text || '';
  }
  if (env.AI) {
    const res = await env.AI.run('@cf/openai/whisper', { audio: [...new Uint8Array(audio)] });
    return (res && res.text) || '';
  }
  throw new Error('Speech service is not configured');
}

// ====================== TEXT TO SPEECH ======================
async function apiTts(request, env, ctx, auth) {
  const body = request.method === 'GET' ? Object.fromEntries(new URL(request.url).searchParams) : await request.json().catch(() => ({}));
  const text = String(body.text || '').trim().slice(0, 400);
  if (!text) return json({ error: 'Empty text' }, 400);
  const voice = VOICES.includes(body.voice) ? body.voice : 'nova';
  const lang = langOf(body.lang);
  const speed = body.slow === true || body.slow === '1' ? 0.72 : 1;
  const cache = caches.default;
  const key = new Request(`https://tts.gokski.cache/${await sha(`${env.TTS_MODEL || 'tts-1'}|${voice}|${speed}|${text}`)}`);
  const hit = await cache.match(key);
  if (hit) return hit;
  if (!(await withinQuota(env, auth))) return json({ error: 'Daily limit reached' }, 429);

  let audio = null;
  if (env.OPENAI_API_KEY) {
    const r = await fetch(`${openaiBase(env)}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.TTS_MODEL || 'tts-1', voice, input: text, speed, response_format: 'mp3' }),
    });
    if (!r.ok) return json({ error: `OpenAI ${r.status}` }, 502);
    audio = await r.arrayBuffer();
  } else if (env.AI && LANGS[lang].tts) {
    const res = await env.AI.run('@cf/myshell-ai/melotts', { prompt: text, lang: LANGS[lang].tts });
    if (res && res.audio) audio = Uint8Array.from(atob(res.audio), c => c.charCodeAt(0)).buffer;
  }
  if (!audio) return json({ error: 'Voice service is not configured' }, 501);
  const resp = new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000' } });
  ctx.waitUntil(cache.put(key, resp.clone()));
  return resp;
}

// ====================== AI CONVERSATION ======================
async function apiChat(request, env, auth) {
  if (!(await withinQuota(env, auth))) return json({ error: 'Daily limit reached' }, 429);
  const body = await request.json().catch(() => ({}));
  const sc = body.sc || {};
  const msgs = (Array.isArray(body.msgs) ? body.msgs : []).slice(-16)
    .map(m => ({ role: m.r === 'u' ? 'user' : 'assistant', content: String(m.t || '').slice(0, 600) }));
  const level = String(sc.level || 'A1');
  const tasks = (sc.tasks || []).map((t, i) => `${i}. ${t}`).join('\n') || '(none — free conversation)';
  const userTurns = msgs.filter(m => m.role === 'user').length;
  const LG = LANGS[langOf(sc.lang || request.headers.get('X-Lang'))], TL = LG.name;
  const system = `You are role-playing to help a Georgian speaker practise spoken ${TL}.
TARGET LANGUAGE: ${TL}. Always speak ${TL} in "reply" (never switch to another language, even if the learner does).
ROLE: ${String(sc.role || `a friendly ${TL} teacher`).slice(0, 300)}
SCENE: ${String(sc.setting || '').slice(0, 400)}
LEARNER LEVEL: ${level} (CEFR). The learner is a native Georgian speaker who works in IT.
LEARNER TASKS (indexes):
${tasks}

Rules:
- Stay in character. Speak natural ${TL} suited to the level: A1 = very short simple sentences (max 10 words each); A2 = short sentences; B1 = everyday natural ${TL}; B2 = natural, fluent ${TL} with some idioms.${TL === 'German' ? '\n- Use "Sie" in formal roles (shop, hotel, doctor, interview, client) and "du" with friends and colleagues.' : ''}
- Reply with 1-3 sentences and usually end with a question so the learner keeps talking. Never answer for the learner.
- The learner's messages come from speech recognition: ignore punctuation, capital letters and small transcription glitches.
- Look only at the learner's LAST message. If it has a real grammar or word-choice mistake in ${TL} (or the learner used another language), give the corrected ${TL} sentence and a short explanation in Georgian. If it is acceptable, correction must be null. Never correct the very first opening when there is no learner message.
- "done": indexes of tasks the learner has clearly completed in the whole conversation so far.
- "finished": true when all tasks are done, or the learner has spoken ${sc.tasks && sc.tasks.length ? 10 : 8} times (now: ${userTurns}). When finished, say a friendly closing line.
- "hint_ka": one short Georgian tip about what the learner could say next (or "" when finished).
Respond ONLY with JSON: {"reply": string, "reply_ka": string (Georgian translation of reply), "correction": null | {"fixed": string, "why_ka": string}, "done": number[], "finished": boolean, "hint_ka": string}`;
  const convo = msgs.length ? msgs : [{ role: 'user', content: '(Start the conversation now with your opening line.)' }];

  let raw = '';
  if (env.OPENAI_API_KEY) {
    const r = await fetch(`${openaiBase(env)}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.CHAT_MODEL || 'gpt-4o-mini', temperature: 0.7, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, ...convo] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: (d.error && d.error.message) || `OpenAI ${r.status}` }, 502);
    raw = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '';
  } else if (env.AI) {
    const res = await env.AI.run(env.WAI_CHAT_MODEL || '@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'system', content: system }, ...convo], max_tokens: 500 });
    raw = (res && res.response) || '';
  } else {
    return json({ error: 'AI is not configured' }, 501);
  }
  return json(parseChat(raw, sc.tasks ? sc.tasks.length : 0));
}
function parseChat(raw, nTasks) {
  let o = null;
  try { o = JSON.parse(raw); } catch (e) {
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (m) { try { o = JSON.parse(m[0]); } catch (e2) { o = null; } }
  }
  if (!o || typeof o !== 'object') o = { reply: String(raw).trim().slice(0, 500) };
  const c = o.correction && typeof o.correction === 'object' && o.correction.fixed ? { fixed: String(o.correction.fixed), why_ka: String(o.correction.why_ka || '') } : null;
  return {
    reply: String(o.reply || '').trim() || '...',
    reply_ka: String(o.reply_ka || ''),
    correction: c,
    done: (Array.isArray(o.done) ? o.done : []).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n < nTasks),
    finished: !!o.finished,
    hint_ka: String(o.hint_ka || ''),
  };
}

// ====================== PROGRESS + BOARD ======================
async function apiProgress(request, env, ctx, auth, origin) {
  const e = requireUser(auth); if (e) return e;
  const b = await request.json().catch(() => ({}));
  const u = auth.user;
  const st = store(env);
  if (await st.touch(u.id, displayName(u), u.username || '')) ctx.waitUntil(notifyAdmin(env, u.id, u, 'აპი').catch(() => {}));
  const row = await st.progress(u.id, {
    name: displayName(u), username: u.username || '',
    xp: b.xp, streak: b.streak, lastDay: b.lastDay, unit: b.unit, tier: b.tier, div: b.div, rp: b.rp,
    wk: b.wk, wkXp: b.wkXp, wkLes: b.wkLes, lang: langOf(b.lang || request.headers.get('X-Lang')),
    remind: typeof b.remind === 'boolean' ? b.remind : undefined, remindHour: Number.isInteger(b.remindHour) ? b.remindHour : undefined,
  });
  ctx.waitUntil(ensureSetup(env, origin).catch(err => console.error('setup', err)));
  return json({ ok: true, remind: !!row.remind, remindHour: row.remind_hour, started: !!row.started });
}
async function apiBoard(request, env, auth) {
  const e = requireUser(auth); if (e) return e;
  const rows = await store(env).board(reqLang(request));
  return json({ me: auth.user.id, rows: rows.map(r => ({ me: r.id === auth.user.id, name: r.name || 'მოსწავლე', xp: r.xp, streak: r.streak, t: r.tier, d: r.div, rp: r.rp, wk: r.wk, wkXp: r.wk_xp, unit: r.unit })) });
}
function displayName(u) {
  return [u.first_name, u.last_name ? u.last_name[0] + '.' : ''].filter(Boolean).join(' ').slice(0, 40) || u.username || 'მოსწავლე';
}

// ====================== TELEGRAM BOT ======================
const tgBase = env => env.TG_API_BASE || 'https://api.telegram.org';
const openaiBase = env => env.OPENAI_BASE || 'https://api.openai.com/v1';
async function tgCall(env, method, body) {
  const r = await fetch(`${tgBase(env)}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({ ok: false }));
}
async function hookSecret(env) { return (await sha(`gokski|${env.TELEGRAM_BOT_TOKEN}`)).slice(0, 48); }

async function ensureSetup(env, origin) {
  if (!env.TELEGRAM_BOT_TOKEN || !origin) return;
  const st = store(env);
  const want = `${origin}|v4`;
  if ((await st.kvGet('setup')) === want) return;
  const hook = await tgCall(env, 'setWebhook', { url: `${origin}/api/tg`, secret_token: await hookSecret(env), allowed_updates: ['message'] });
  if (!hook.ok) throw new Error('setWebhook failed: ' + JSON.stringify(hook));
  await tgCall(env, 'setMyCommands', { commands: [
    { command: 'start', description: 'Gokski-ს გახსნა' },
    { command: 'stats', description: 'ჩემი პროგრესი და რანკი' },
    { command: 'remind', description: 'შეხსენება: ჩართვა/გამორთვა, მაგ. /remind 21' },
    { command: 'reset', description: 'მასწავლებელთან საუბრის თავიდან დაწყება' },
    { command: 'lang', description: 'ენის შეცვლა ბოტში: /lang en ან /lang de' },
  ] });
  await tgCall(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Gokski', web_app: { url: origin } } });
  await st.kvSet('origin', origin);
  await st.kvSet('setup', want);
}

async function telegramWebhook(request, env, ctx) {
  if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'not configured' }, 501);
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== (await hookSecret(env))) return new Response('forbidden', { status: 403 });
  const update = await request.json().catch(() => ({}));
  ctx.waitUntil(handleUpdate(env, update).catch(err => console.error('bot', err)));
  return new Response('ok');
}

async function handleUpdate(env, update) {
  const m = update.message;
  if (!m || !m.chat || m.chat.type !== 'private' || !m.from) return;
  const st = store(env);
  const id = m.from.id;
  const isNew = await st.touch(id, displayName(m.from), m.from.username || '');
  await st.markStarted(id);
  if (isNew) await notifyAdmin(env, id, m.from, 'ბოტი');
  const origin = (await st.kvGet('origin')) || '';
  const say = (text, extra = {}) => tgCall(env, 'sendMessage', { chat_id: m.chat.id, text, ...extra });
  const openBtn = origin ? { reply_markup: { inline_keyboard: [[{ text: '📚 Gokski-ს გახსნა', web_app: { url: origin } }]] } } : {};
  const text = (m.text || '').trim();

  const me = await st.user(id), LG = LANGS[langOf(me && me.lang)];
  if (text.startsWith('/start')) {
    return say(`👋 გამარჯობა! Gokski-ში შეგიძლია ისწავლო ინგლისური 🇬🇧 და გერმანული 🇩🇪 — თითოეულს ცალკე პროგრესი, რანკი და streak აქვს.\n\n📚 გაკვეთილები, რანკი და AI საუბარი აპშია — ღილაკი ქვემოთაა.\n💬 აქვე შეგიძლია მომწერო ან ხმოვანი გამომიგზავნო ${LG.kaAdv} (${LG.teacher}): გაგისწორებ და აგიხსნი ქართულად. ენის შეცვლა: /lang\n⏰ ყოველ საღამოს შეგახსენებ ვარჯიშს (/remind — გამორთვა ან დროის შეცვლა).`, openBtn);
  }
  if (text.startsWith('/stats')) {
    const ls = await st.langs(id);
    if (!ls.length) return say('ჯერ Gokski-ში ერთი გაკვეთილი გაიარე და აქ შენს პროგრესს ნახავ 🙂', openBtn);
    return say(statsText(me, ls), openBtn);
  }
  if (text.startsWith('/lang')) {
    const arg = (text.split(/\s+/)[1] || '').toLowerCase();
    const l = LANGS[arg] ? arg : (langOf(me && me.lang) === 'en' ? 'de' : 'en');
    await st.setLang(id, l); await st.setChat(id, []);
    return say(`${LANGS[l].flag} ბოტში ახლა ${LANGS[l].kaAdv} ვსაუბრობთ — ${LANGS[l].teacher} გისმენს. (აპში ენა ზედა დროშით იცვლება.)`);
  }
  if (text.startsWith('/remind')) {
    const arg = text.split(/\s+/)[1];
    const u = await st.user(id);
    if (arg && /^\d{1,2}$/.test(arg) && +arg <= 23) {
      await st.setRemind(id, 1, +arg);
      return say(`⏰ შეხსენება ჩართულია, ყოველდღე ${arg}:00-ზე (თბილისის დროით).`);
    }
    const on = !(u && u.remind);
    await st.setRemind(id, on ? 1 : 0, null);
    return say(on ? `⏰ შეხსენება ჩართულია (${(u && u.remind_hour) ?? 20}:00). დროის შესაცვლელად: /remind 21` : '🔕 შეხსენება გამორთულია. ჩასართავად ისევ დაწერე /remind');
  }
  if (text.startsWith('/reset')) { await st.setChat(id, []); return say('🧹 საუბარი თავიდან დავიწყეთ.'); }
  if (text.startsWith('/myid')) return say(`შენი Telegram ID: ${id}`);
  if (text.startsWith('/admin') || text.startsWith('/users')) {
    if (!isAdmin(env, id)) return say('ეს ბრძანება მხოლოდ ბოტის მფლობელისთვისაა.');
    return say(adminText(await st.adminStats(tbilisi()), text.startsWith('/users')));
  }
  if (text.startsWith('/')) return say('ბრძანებები: /start, /stats, /lang, /remind, /reset');

  let input = text, heard = '';
  if (!input && (m.voice || m.audio)) {
    const f = m.voice || m.audio;
    if ((f.file_size || 0) > MAX_AUDIO) return say('ხმოვანი ძალიან გრძელია, სცადე 30 წამამდე.');
    const info = await tgCall(env, 'getFile', { file_id: f.file_id });
    if (!info.ok) return say('ხმოვანი ვერ ჩამოვტვირთე 😕');
    const audio = await (await fetch(`${tgBase(env)}/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`)).arrayBuffer();
    try { heard = await transcribe(env, audio, f.mime_type || 'audio/ogg', langOf(me && me.lang)); } catch (e) { return say('ხმის ამოცნობა ვერ მოხერხდა: ' + e.message); }
    input = heard;
    if (!input.trim()) return say('ვერაფერი გავიგე, სცადე ისევ 🙂');
  }
  if (!input) return;
  if (!(await st.quota(id, tbilisi().today, DAILY_AI_LIMIT))) return say('დღევანდელი ლიმიტი ამოიწურა, ხვალ გავაგრძელოთ 🙂');
  await tgCall(env, 'sendChatAction', { chat_id: m.chat.id, action: 'typing' });
  const reply = await tutorReply(env, st, id, heard ? `(voice message, transcribed — ignore punctuation): ${input}` : input, levelCode(me ? me.unit : 0), langOf(me && me.lang));
  return say((heard ? `🎤 გავიგე: „${heard}"\n\n` : '') + reply);
}

async function tutorReply(env, st, id, input, level, lang = 'en') {
  const history = await st.getChat(id);
  const LG = LANGS[langOf(lang)], TL = LG.name;
  const system = `You are "${LG.teacher}", a kind, patient personal ${TL} teacher for a Georgian-speaking adult at ${level} level who works in IT and AI.
- Explain grammar and meanings in GEORGIAN. Use ${TL} suited to ${level} for practice sentences.
- If the student writes ${TL} with mistakes, first show:
✏️ შენ დაწერე: <their sentence>
✅ სწორია: <corrected sentence>
💡 <one short explanation in Georgian>
Then continue the conversation.
- If the student writes in Georgian (or another language), help them say it in ${TL} and ask them to try it themselves.
- Keep answers short (max ~8 lines), plain text without Markdown. Be encouraging.
- Always end with ONE question in ${TL} to keep the student practising.`;
  const msgs = [...history, { role: 'user', content: input }];
  let answer = '';
  if (env.OPENAI_API_KEY) {
    const r = await fetch(`${openaiBase(env)}/chat/completions`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: env.CHAT_MODEL || 'gpt-4o-mini', temperature: 0.7, messages: [{ role: 'system', content: system }, ...msgs] }),
    });
    const d = await r.json().catch(() => ({}));
    answer = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || (d.error && 'შეცდომა: ' + d.error.message) || '';
  } else if (env.AI) {
    const res = await env.AI.run(env.WAI_CHAT_MODEL || '@cf/meta/llama-3.1-8b-instruct', { messages: [{ role: 'system', content: system }, ...msgs], max_tokens: 500 });
    answer = (res && res.response) || '';
  } else {
    return 'AI მასწავლებლის ჩასართავად Cloudflare-ში დაამატე OPENAI_API_KEY.';
  }
  answer = String(answer).trim() || '🙂';
  await st.setChat(id, [...msgs, { role: 'assistant', content: answer }]);
  return answer;
}

// ====================== ADMIN ======================
// ADMIN_ID — ბოტის მფლობელის Telegram ID (Cloudflare → Variables and Secrets)
const isAdmin = (env, id) => !!env.ADMIN_ID && String(env.ADMIN_ID).trim() === String(id);
async function notifyAdmin(env, id, from, via) {
  if (!env.ADMIN_ID || isAdmin(env, id)) return;
  const who = [displayName(from), from.username ? '@' + from.username : ''].filter(Boolean).join(' ');
  await tgCall(env, 'sendMessage', { chat_id: String(env.ADMIN_ID).trim(), text: `🆕 ახალი მომხმარებელი (${via}): ${who}\nID: ${id}` });
}
function ago(ms) {
  if (!ms) return '—';
  const day = t => Math.floor((t + TZ_OFFSET_H * 3600e3) / 864e5);
  const d = day(Date.now()) - day(ms);
  return d <= 0 ? 'დღეს' : d === 1 ? 'გუშინ' : `${d} დღის წინ`;
}
function adminText(a, full) {
  const head = `📊 Gokski — სტატისტიკა\n👥 სულ მომხმარებელი: ${a.total} (ბოტი დაიწყო: ${a.started})\n🟢 დღეს ივარჯიშა: ${a.today}\n📅 ამ კვირაში აქტიური: ${a.week}\n🆕 ახალი ამ კვირაში: ${a.fresh}`;
  const rows = (full ? a.rows : a.rows.slice(0, 10)).map((u, i) =>
    `${i + 1}. ${u.name || 'უსახელო'}${u.username ? ' @' + u.username : ''}\n   ${(LANGS[u.lang] || LANGS.en).flag} ნაწილი ${(u.unit || 0) + 1} · ${rankName(u)} · ${u.xp} XP · 🔥${u.streak} · ${ago(u.last)}`);
  return `${head}\n\n${full ? 'ბოლოს აქტიურები (30):' : 'ბოლოს აქტიურები (10) — ყველა: /users'}\n${rows.join('\n') || '—'}`.slice(0, 4000);
}

// ====================== CRON ======================
async function cron(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const st = store(env);
  const origin = await st.kvGet('origin');
  if (origin) await ensureSetup(env, origin).catch(e => console.error('setup', e));
  const now = tbilisi();
  const jobs = await st.due(now);
  const btn = origin ? { reply_markup: { inline_keyboard: [[{ text: '📚 Gokski-ს გახსნა', web_app: { url: origin } }]] } } : {};
  for (const job of jobs) {
    const { kind, u } = job;
    const first = (u.name || '').split(' ')[0] || '';
    let text = '';
    if (kind === 'evening') text = u.streak > 0
      ? `🔥 ${first}, დღეს ჯერ არ გივარჯიშია! ${u.streak} დღიანი streak რომ შეინარჩუნო, ერთი 5 წუთიანი გაკვეთილი საკმარისია.`
      : `📚 ${first}, დღეს ჯერ არ გისწავლია. ერთი გაკვეთილი 5 წუთია — დავიწყოთ?`;
    else if (kind === 'late') text = `⏰ ${u.streak} დღიანი streak იწვის! შუაღამემდე ცოტა დრო დაგრჩა.`;
    else if (kind === 'weekly') {
      const parts = job.ls.map(r => {
        const diff = r.pwk_xp ? Math.round((r.wk_xp - r.pwk_xp) / r.pwk_xp * 100) : null;
        const L = LANGS[langOf(r.lang)];
        return `${L.flag} ${L.ka}\n⚡ ${r.wk_xp} XP${diff !== null ? ` (${diff >= 0 ? '+' : ''}${diff}% წინა კვირასთან)` : ''}\n📘 ${r.wk_les} გაკვეთილი\n🏆 ${rankName(r)}\n🔥 streak: ${r.streak}`;
      });
      text = `📊 კვირის შედეგი\n\n${parts.join('\n\n')}\n\nახალი კვირა, ახალი რეკორდი! 💪`;
    }
    if (text) await tgCall(env, 'sendMessage', { chat_id: u.id, text, ...btn });
  }
}

// ====================== HEALTH ======================
// შემოწმების გვერდი: ჩანს, სწორადაა თუ არა გასაღებები ჩასმული (საიდუმლოებს არ აჩვენებს)
async function apiHealth(env, origin) {
  const out = { ok: true, bot_token: 'missing', bot_id: null, bot_username: null, openai_key: env.OPENAI_API_KEY ? 'set' : 'missing', workers_ai: !!env.AI, webhook: null, admin_id: env.ADMIN_ID ? 'set' : 'missing (ბოტში /myid გაჩვენებს შენს ID-ს)' };
  if (env.TELEGRAM_BOT_TOKEN) {
    out.bot_id = env.TELEGRAM_BOT_TOKEN.split(':')[0];
    const me = await tgCall(env, 'getMe', {});
    if (me.ok) { out.bot_token = 'valid'; out.bot_username = '@' + me.result.username; }
    else { out.bot_token = 'INVALID — Telegram-მა ეს ტოკენი არ მიიღო (BotFather-იდან ახალი ჩასვი)'; out.ok = false; }
    if (me.ok) {
      const wh = await tgCall(env, 'getWebhookInfo', {});
      out.webhook = wh.ok ? (wh.result.url || 'ჯერ არ არის — გახსენი აპი ბოტიდან') : null;
    }
  } else out.ok = false;
  if (env.OPENAI_API_KEY) {
    const r = await fetch(`${openaiBase(env)}/models`, { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } }).catch(() => null);
    out.openai_key = r && r.ok ? 'valid' : `INVALID (${r ? r.status : 'network'}) — OpenAI-მ გასაღები არ მიიღო`;
    if (!(r && r.ok)) out.ok = false;
  }
  return json(out);
}

// ====================== HELPERS ======================
// ჩასმისას გაყოლილი ჰარები და ბრჭყალები აშორებს
function cleanEnv(env) {
  const fix = v => (typeof v === 'string' ? v.trim().replace(/^["']|["']$/g, '').trim() : v);
  return new Proxy(env, { get: (t, k) => (k === 'TELEGRAM_BOT_TOKEN' || k === 'OPENAI_API_KEY' ? fix(t[k]) : t[k]) });
}
function tbilisi() {
  const t = new Date(Date.now() + TZ_OFFSET_H * 3600e3);
  const today = `${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()}`;
  const dayNo = Math.floor(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) / 864e5);
  const dow = t.getUTCDay();
  const wk = String(dayNo - ((dow + 6) % 7)); // ორშაბათის დღის ნომერი
  return { today, hour: t.getUTCHours(), dow, wk, dayNo };
}
function rankName(u) { return u.tier >= 6 ? `ლეგენდა · ${u.rp} LP` : `${TIERS[u.tier] || TIERS[0]} ${DIVS[u.div] || 'III'} · ${u.rp} RP`; }
function levelCode(unit) { return LEVELS.filter(l => (unit || 0) >= l[0]).pop()[1]; }
function statsText(u, ls) {
  const wk = tbilisi().wk;
  const parts = ls.map(r => { const L = LANGS[langOf(r.lang)];
    return `${L.flag} ${L.ka}\n🏆 რანკი: ${rankName(r)}\n⚡ XP: ${r.xp} (ამ კვირაში ${r.wk === wk ? r.wk_xp : 0})\n🔥 streak: ${r.streak}\n📍 ნაწილი ${(r.unit || 0) + 1} · ${levelCode(r.unit)}`; });
  return `${parts.join('\n\n')}\n\n⏰ შეხსენება: ${u && u.remind ? `${u.remind_hour}:00` : 'გამორთულია'}`;
}
const int = v => (Number.isFinite(+v) ? Math.round(+v) : 0);
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
