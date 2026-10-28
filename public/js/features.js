// Gokski — დამატებითი ფუნქციები: რანკი, სიტყვების გამეორება, AI საუბარი, მოსმენა,
// დონის ტესტი, მიღწევები, კვირის ანგარიში, streak-ის გაყინვა, ბუნებრივი ხმა.
// ეს ფაილი მთავარ სკრიპტამდე იტვირთება; ფუნქციები მთავარი სკრიპტის ცვლადებს მხოლოდ გაშვებისას იყენებს.

const IN_TG = !!(window.Telegram && Telegram.WebApp && Telegram.WebApp.initData);
const BOT_USER = 'gokskibot';

// ====================== დღეები და კვირები ======================
function dayNo(d = new Date()) { return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); }
function dayNoOf(s) { if (!s) return 0; const [y, m, dd] = String(s).split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, dd) / 864e5); }
function weekId(n = dayNo()) { const dow = new Date(n * 864e5).getUTCDay(); return String(n - ((dow + 6) % 7)); }
const WD = ['კვ', 'ორ', 'სა', 'ოთ', 'ხუ', 'პა', 'შა'];

// ====================== მდგომარეობა ======================
function freshWeek() { return { id: weekId(), xp: 0, les: 0, ok: 0, all: 0, spk: 0, talk: 0 }; }
function normState(s) {
  s.srs = s.srs || {}; s.ach = s.ach || {}; s.hist = s.hist || {}; s.talks = s.talks || {}; s.listens = s.listens || {};
  s.st = Object.assign({ lessons: 0, perfect: 0, speakOk: 0, talks: 0, reviewed: 0, listens: 0, frozen: 0 }, s.st || {});
  s.rank = Object.assign({ t: 0, d: 0, rp: 0, promo: null, sh: 0, ts: 0, dc: 0, bt: 0, bd: 0 }, s.rank || {});
  s.freeze = s.freeze || 0;
  const w = weekId();
  if (!s.wk || s.wk.id !== w) {
    if (s.wk && +s.wk.id < +w) s.lwk = (+s.wk.id === +w - 7) ? s.wk : null;
    s.wk = freshWeek();
  }
  const keys = Object.keys(s.hist).map(Number).sort((a, b) => b - a);
  keys.slice(35).forEach(k => delete s.hist[k]);
  return s;
}
function mergeExtra(o, a0, b0) {
  const a = normState(JSON.parse(JSON.stringify(a0))), b = normState(JSON.parse(JSON.stringify(b0)));
  o.srs = Object.assign({}, a.srs);
  for (const [k, e] of Object.entries(b.srs)) { const x = o.srs[k]; if (!x || e[2] > x[2] || (e[2] === x[2] && e[0] > x[0])) o.srs[k] = e; }
  o.ach = Object.assign({}, b.ach, a.ach);
  o.hist = Object.assign({}, a.hist); for (const [k, v] of Object.entries(b.hist)) o.hist[k] = Math.max(o.hist[k] || 0, v);
  o.st = {}; for (const k of new Set([...Object.keys(a.st), ...Object.keys(b.st)])) o.st[k] = Math.max(a.st[k] || 0, b.st[k] || 0);
  const maxMap = (x, y) => { const r = Object.assign({}, x); for (const [k, v] of Object.entries(y)) r[k] = Math.max(r[k] || 0, v); return r; };
  o.talks = maxMap(a.talks, b.talks); o.listens = maxMap(a.listens, b.listens);
  o.rank = (b.rank.ts || 0) > (a.rank.ts || 0) ? b.rank : a.rank;
  if (a.wk.id === b.wk.id) { o.wk = {}; for (const k of Object.keys(a.wk)) o.wk[k] = k === 'id' ? a.wk.id : Math.max(a.wk[k] || 0, b.wk[k] || 0); }
  else o.wk = +a.wk.id > +b.wk.id ? a.wk : b.wk;
  o.lwk = a.lwk || b.lwk || null;
  const la = dnum(a.lastDay), lb = dnum(b.lastDay);
  o.freeze = lb > la ? b.freeze : lb === la ? Math.min(a.freeze || 0, b.freeze || 0) : a.freeze;
  o.placed = !!(a.placed || b.placed);
  return normState(o);
}

// ====================== XP, streak და გაყინვა ======================
function credit(gain) {
  const t = day(); let freezeEarned = false;
  if (S.lastDay !== t) {
    S.streak = S.lastDay === yesterday() ? S.streak + 1 : 1; S.lastDay = t;
    if (S.streak % 7 === 0 && (S.freeze || 0) < 2) { S.freeze = (S.freeze || 0) + 1; freezeEarned = true; }
  }
  S.xp += gain; S.todayXp += gain;
  const n = dayNo(); S.hist[n] = (S.hist[n] || 0) + gain;
  normState(S); S.wk.xp += gain;
  return { freezeEarned };
}
// დღის ცვლილება: გამოტოვებული დღეები → გაყინვა ან streak-ის განულება და რანკის კლება
function dayRoll() {
  if (!S.lastDay) return;
  const t = day(); if (S.lastDay === t || S.lastDay === yesterday()) return;
  const missed = dayNo() - dayNoOf(S.lastDay) - 1;
  if (missed > 0 && S.streak > 0 && (S.freeze || 0) >= missed) {
    S.freeze -= missed; S.st.frozen = (S.st.frozen || 0) + 1; S.lastDay = yesterday(); S.frozeNote = missed; return;
  }
  S.streak = 0;
  const from = Math.max(dayNoOf(S.lastDay), S.rank.dc || 0), days = (dayNo() - 1) - from;
  if (days > 0) rankDecay(days);
  S.rank.dc = dayNo() - 1;
}

// ====================== რანკი ======================
const RANK_T = [
  { ka: 'ბრინჯაო', c: '#A86A35', c2: '#E3AE7A' }, { ka: 'ვერცხლი', c: '#6B7A90', c2: '#CBD5E1' },
  { ka: 'ოქრო', c: '#C98F00', c2: '#FFD43B' }, { ka: 'პლატინა', c: '#0E8F86', c2: '#5EEAD4' },
  { ka: 'ალმასი', c: '#2563EB', c2: '#93C5FD' }, { ka: 'ოსტატი', c: '#7E3AD1', c2: '#D8B4FE' },
  { ka: 'ლეგენდა', c: '#D3123F', c2: '#FDA4AF' }];
const RANK_D = ['III', 'II', 'I'], LEGEND = 6;
const rankLabel = (r = S.rank) => r.t >= LEGEND ? 'ლეგენდა' : `${RANK_T[r.t].ka} ${RANK_D[r.d]}`;
const rankPts = (r = S.rank) => r.t >= LEGEND ? `${r.rp} LP` : `${Math.min(r.rp, 100)} / 100 RP`;
const rankScore = r => r.t * 3 + r.d;
function trackBest() { const R = S.rank; if (rankScore(R) > rankScore({ t: R.bt, d: R.bd })) { R.bt = R.t; R.bd = R.d; } }
function rpBase(kind, acc) {
  if (kind === 'lesson') return acc >= 100 ? 25 : acc >= 90 ? 20 : acc >= 75 ? 12 : acc >= 60 ? 5 : -10;
  if (kind === 'retry' || kind === 'practice') { const b = rpBase('lesson', acc); return b > 0 ? Math.ceil(b / 2) : -5; }
  if (kind === 'review') return acc >= 80 ? 8 : acc >= 60 ? 3 : -5;
  if (kind === 'listen') return acc >= 100 ? 10 : acc >= 67 ? 5 : -3;
  return 0;
}
function rankActivity(kind, acc, extra = {}) {
  const R = S.rank, res = { delta: 0, ev: null };
  if (R.promo) { res.ev = 'promoPending'; return res; }
  const base = kind === 'talk' ? (extra.base || 0) : rpBase(kind, acc);
  const gainM = [1, .9, .8, .7, .6, .5, .4][R.t], lossM = 1 + .1 * R.t;
  let delta = base >= 0 ? Math.round(base * gainM) : Math.round(base * lossM);
  if (base > 0) { if (S.streak >= 7) delta += 2; delta += Math.min(4, extra.speakOk || 0); }
  if (delta < 0 && R.sh > 0) { R.sh--; res.ev = 'shield'; delta = 0; }
  else if (R.sh > 0 && base !== 0) R.sh--;
  res.delta = delta;
  if (delta) { R.rp += delta; const ev = rankSettle(); if (ev) res.ev = ev; }
  R.ts = Date.now(); trackBest();
  return res;
}
function rankSettle() {
  const R = S.rank;
  if (R.t >= LEGEND) { if (R.rp < 0) { R.t = LEGEND - 1; R.d = 2; R.rp = 70; R.sh = 0; return 'tierDown'; } return null; }
  if (R.rp >= 100) {
    if (R.d < 2) { R.d++; R.rp = Math.min(R.rp - 100, 99); return 'up'; }
    R.rp = 100; R.promo = { w: 0, l: 0 }; return 'promoStart';
  }
  if (R.rp < 0) {
    if (R.d > 0) { R.d--; R.rp = 70; return 'down'; }
    if (R.t > 0) { R.t--; R.d = 2; R.rp = 70; return 'tierDown'; }
    R.rp = 0;
  }
  return null;
}
function promoOutcome(win) {
  const R = S.rank, res = { delta: 0, ev: null, promo: true, win };
  if (!R.promo) return res;
  R.promo[win ? 'w' : 'l']++;
  if (R.promo.w >= 2) { R.t = Math.min(R.t + 1, LEGEND); R.d = 0; R.rp = 0; R.promo = null; R.sh = 3; res.ev = 'tierUp'; }
  else if (R.promo.l >= 2) { R.promo = null; R.rp = 75; res.ev = 'promoFail'; }
  else res.ev = win ? 'promoWin' : 'promoLose';
  R.ts = Date.now(); trackBest();
  return res;
}
function rankDecay(days) {
  const R = S.rank; if (R.t < 2 || days <= 0) return;
  if (R.promo) { R.promo = null; R.rp = 100; }
  const loss = 15 * days; R.rp -= loss; rankSettle(); R.ts = Date.now(); S.decayNote = loss;
}

// რანკის ემბლემა (SVG)
let emN = 0;
function emblem(t, d, size = 64) {
  const T = RANK_T[Math.min(t, LEGEND)], id = 'eg' + (emN++);
  const pips = t >= LEGEND ? '' : Array.from({ length: d + 1 }, (_, i) => `<circle cx="${50 + (i - d / 2) * 12}" cy="80" r="4.2" fill="#fff"/>`).join('');
  const inner = t >= 5
    ? '<path d="M30 58 34 36l9 9 7-14 7 14 9-9 4 22z" fill="#fff"/><rect x="30" y="61" width="40" height="6" rx="2" fill="#fff"/>'
    : '<path d="m50 28 6.2 12.6 13.9 2-10 9.8 2.4 13.8L50 59.7 37.5 66.2l2.4-13.8-10-9.8 13.9-2z" fill="#fff"/>';
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.c2}"/><stop offset="1" stop-color="${T.c}"/></linearGradient></defs>
    <path d="M50 5 89 22v34c0 21-17 34-39 40C28 90 11 77 11 56V22z" fill="url(#${id})" stroke="${T.c}" stroke-width="3"/>
    <path d="M50 13 81 27v28c0 16-13 27-31 32-18-5-31-16-31-32V27z" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="2"/>${inner}${pips}</svg>`;
}

// ====================== სიტყვების გამეორება (SRS) ======================
const SRS_INT = [1, 2, 4, 7, 15, 30, 60];
let srsDirty = true;
const srsKey = it => `${it.u}.${it.i}`;
function srsTouch(item, ok, review) {
  if (!item || item.kind !== 'w') return;
  const k = srsKey(item), n = dayNo(), e = S.srs[k];
  if (!e) { S.srs[k] = [0, n + 1, n]; srsDirty = true; return; }
  if (review) { if (ok) { e[0] = Math.min(e[0] + 1, SRS_INT.length - 1); e[1] = n + SRS_INT[e[0]]; } else { e[0] = 0; e[1] = n + 1; } e[2] = n; }
  else if (!ok) { e[0] = 0; e[1] = n + 1; e[2] = n; }
  else return;
  srsDirty = true;
}
function srsDue() {
  const n = dayNo();
  return Object.entries(S.srs).filter(([k, e]) => e[1] <= n && UNITS[+k.split('.')[0]])
    .sort((a, b) => a[1][1] - b[1][1] || a[1][0] - b[1][0]).map(([k]) => k);
}
function buildReview() {
  return srsDue().slice(0, 15).map(k => {
    const [u, i] = k.split('.').map(Number), e = S.srs[k], it = W(u, i);
    const t = e[0] >= 3 ? pick(['type', 'pick_en', 'type']) : e[0] >= 1 ? pick(canSpeak ? ['pick_en', 'listen', 'type'] : ['pick_en', 'type']) : pick(canSpeak ? ['pick_ka', 'listen'] : ['pick_ka', 'pick_en']);
    return makeEx(t, it);
  });
}
function srsChunks() {
  const parts = Object.entries(S.srs).map(([k, [b, d, t]]) => `${k}.${b}.${d.toString(36)}.${t.toString(36)}`);
  const out = []; let cur = '';
  for (const p of parts) { if (cur.length + p.length + 1 > 3900) { out.push(cur); cur = ''; } cur += (cur ? ',' : '') + p; }
  if (cur) out.push(cur);
  return out;
}
function srsDecode(strs) {
  const o = {};
  for (const s of strs) if (s) s.split(',').forEach(p => { const [u, i, b, d, t] = p.split('.'); if (t !== undefined) o[`${u}.${i}`] = [+b, parseInt(d, 36), parseInt(t, 36)]; });
  return o;
}

// ====================== Telegram-ის საცავი ======================
const SRS_KEYS = Array.from({ length: 12 }, (_, i) => 'gsrs' + i);
const cloudSrsCache = [];
function cloudPut() {
  const cs = window.Telegram && Telegram.WebApp && Telegram.WebApp.CloudStorage;
  if (!IN_TG || !cs) return;
  const main = Object.assign({}, S); delete main.srs; delete main.frozeNote; delete main.decayNote;
  let js = JSON.stringify(main);
  if (js.length > 4000) { main.mistakes = (main.mistakes || []).slice(-15); const h = {}; Object.keys(main.hist).sort((a, b) => b - a).slice(0, 10).forEach(k => h[k] = main.hist[k]); main.hist = h; js = JSON.stringify(main); }
  try { cs.setItem('gokski', js, cloudCb); } catch (e) { markPending(); }
  if (srsDirty) {
    srsDirty = false;
    const ch = srsChunks();
    SRS_KEYS.forEach((k, i) => { const v = ch[i] || ''; if (v !== cloudSrsCache[i]) { cloudSrsCache[i] = v; try { cs.setItem(k, v, (err) => { if (err) { cloudSrsCache[i] = null; srsDirty = true; markPending(); } }); } catch (e) { markPending(); } } });
  }
}
function cloudLoad(cb) {
  const cs = Telegram.WebApp.CloudStorage;
  const done = (vals, err) => {
    if (err) return cb(null, err);
    let main = null;
    try { main = vals.gokski ? JSON.parse(vals.gokski) : null; } catch (e) {}
    SRS_KEYS.forEach((k, i) => cloudSrsCache[i] = vals[k] || '');
    const srs = srsDecode(SRS_KEYS.map(k => vals[k] || ''));
    if (main) main.srs = srs; else if (Object.keys(srs).length) main = { srs };
    cb(main, null);
  };
  if (typeof cs.getItems === 'function') cs.getItems(['gokski', ...SRS_KEYS], (err, vals) => done(vals || {}, err));
  else cs.getItem('gokski', (err, v) => done({ gokski: v }, err));
}

// ====================== სერვერი ======================
const SV = { remind: null, remindHour: 20, started: false, board: null, boardErr: '', seg: 'rank' };
async function api(path, body, opts = {}) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': opts.type || 'application/json', 'X-Init-Data': IN_TG ? Telegram.WebApp.initData : '' }, body: opts.raw ? body : JSON.stringify(body || {}) });
  if (opts.bin) { if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status }); return r.arrayBuffer(); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || ('HTTP ' + r.status)), { status: r.status });
  return j;
}
let syncT = null;
function progressBody(extra) {
  const R = S.rank;
  return Object.assign({ xp: S.xp, streak: S.streak, lastDay: S.lastDay, unit: curUnit(), tier: R.t, div: R.d, rp: R.rp, wk: S.wk.id, wkXp: S.wk.xp, wkLes: S.wk.les }, extra || {});
}
function syncServer(extra) {
  if (!IN_TG) return;
  clearTimeout(syncT);
  syncT = setTimeout(() => api('/api/progress', progressBody(extra)).then(r => {
    SV.remind = r.remind; SV.remindHour = r.remindHour; SV.started = r.started;
    if (view === 'rank') renderRank();
  }).catch(() => {}), extra ? 0 : 700);
}

// ====================== ბუნებრივი ხმა (TTS) ======================
let ttsOff = false, ttsSrc = null, ttsGen = 0;
const ttsCache = new Map();
function audioCtx() { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); return actx; }
document.addEventListener('pointerdown', () => { try { const c = audioCtx(); if (c.state === 'suspended') c.resume(); } catch (e) {} }, true);
function stopSpeech() { ttsGen++; try { if (ttsSrc) ttsSrc.stop(); } catch (e) {} ttsSrc = null; try { speechSynthesis.cancel(); } catch (e) {} }
function say(text, slow) { speakP(text, { slow }); }
function speakP(text, o = {}) {
  stopSpeech(); const gen = ttsGen;
  if (IN_TG && !ttsOff) return cloudTTS(text, o, gen).catch(e => { if (e && [401, 404, 501].includes(e.status)) ttsOff = true; if (gen === ttsGen) return localTTS(text, o, gen); });
  return localTTS(text, o, gen);
}
async function ttsBuffer(text, o) {
  const key = `${o.voice || 'nova'}|${o.slow ? 1 : 0}|${text}`;
  if (!ttsCache.has(key)) {
    const p = ttsFetch(text, o).then(buf => audioCtx().decodeAudioData(buf));
    ttsCache.set(key, p); p.catch(() => ttsCache.delete(key));
  }
  return ttsCache.get(key);
}
async function cloudTTS(text, o, gen) {
  const buf = await ttsBuffer(text, o);
  if (gen !== ttsGen) return;
  const c = audioCtx(); if (c.state === 'suspended') { try { await c.resume(); } catch (e) {} }
  const src = c.createBufferSource(); src.buffer = buf; src.connect(c.destination); ttsSrc = src;
  return new Promise(res => { src.onended = res; src.start(); });
}
function prefetchTTS(list) { if (IN_TG && !ttsOff) list.forEach(([t, o]) => ttsBuffer(t, o || {}).catch(() => {})); }
function localTTS(text, o, gen) {
  return new Promise(res => {
    if (!('speechSynthesis' in window)) return res();
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; if (voice) u.voice = voice;
      u.rate = o.slow ? .6 : .92; u.pitch = o.voice === 'onyx' || o.voice === 'echo' ? .8 : 1.05;
      const to = setTimeout(res, 2500 + text.length * 110);
      u.onend = u.onerror = () => { clearTimeout(to); res(); };
      speechSynthesis.speak(u);
    } catch (e) { res(); }
  });
}

// ====================== ჩამწერი (საუბრისთვის) ======================
const REC = { r: null, timer: null };
async function recStart(onBlob, onErr, maxMs = 20000) {
  stopSpeech();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { return onErr('mic'); }
  const mt = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } });
  const chunks = [];
  try { REC.r = mt ? new MediaRecorder(stream, { mimeType: mt }) : new MediaRecorder(stream); } catch (e) { stream.getTracks().forEach(t => t.stop()); return onErr('mic'); }
  REC.r.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  REC.r.onstop = () => {
    stream.getTracks().forEach(t => t.stop()); clearTimeout(REC.timer);
    const type = ((REC.r && REC.r.mimeType) || mt || 'audio/webm').split(';')[0]; REC.r = null;
    onBlob(new Blob(chunks, { type }));
  };
  REC.r.start(); haptic('select');
  REC.timer = setTimeout(recStop, maxMs);
}
function recStop() { if (REC.r && REC.r.state === 'recording') REC.r.stop(); }
const recOn = () => !!(REC.r && REC.r.state === 'recording');


// ====================== ოფლაინ რეჟიმი ======================
// აპი ქეშდება Service Worker-ით, ხმა წინასწარ იტვირთება, პროგრესი ინახება მოწყობილობაზე
// და კავშირის დაბრუნებისას Telegram-თან და სერვერთან სინქრონიზდება.
const PENDING_KEY = 'gokski-pending', AUDIO_KEY = 'gokski-audio-units';
const online = () => navigator.onLine !== false;
function markPending() { try { localStorage.setItem(PENDING_KEY, '1'); } catch (e) {} }
function clearPending() { try { localStorage.removeItem(PENDING_KEY); } catch (e) {} }
const isPending = () => { try { return localStorage.getItem(PENDING_KEY) === '1'; } catch (e) { return false; } };
function cloudCb(err) { if (err) markPending(); }

function ttsUrl(text, o) { return `/api/tts?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(o.voice || 'nova')}${o.slow ? '&slow=1' : ''}`; }
async function ttsFetch(text, o) {
  const r = await fetch(ttsUrl(text, o), { headers: { 'X-Init-Data': IN_TG ? Telegram.WebApp.initData : '' } });
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
  return r.arrayBuffer();
}

// Telegram-ის საცავთან დაკავშირება: ჩამოტვირთვა → გაერთიანება → ატვირთვა.
// თუ ჩამოტვირთვა ვერ მოხერხდა (კავშირი არ არის), ღრუბელს არ ვეხებით და მერე ვცდით ისევ.
let cloudBooting = false, cloudFirst = true;
function cloudBoot(after) {
  if (!IN_TG || cloudBooting) return;
  cloudBooting = true;
  let finished = false;
  const fail = () => { if (finished) return; finished = true; cloudBooting = false; markPending(); if (!booted) { booted = true; if (!FULLSCREEN.includes(view)) render(); } };
  const to = setTimeout(fail, 7000);
  try {
    cloudLoad((remote, err) => {
      if (finished) return;
      clearTimeout(to);
      if (err) return fail();
      finished = true; cloudBooting = false;
      if (remote) { try { S = mergeState(S, remote); } catch (e) { console.error(e); } }
      cloudReady = true; srsDirty = true; SRS_KEYS.forEach((_, i) => { if (cloudSrsCache[i] === undefined) cloudSrsCache[i] = ''; });
      refreshDay(); clearPending();
      if (!FULLSCREEN.includes(view)) render();
      booted = true; syncServer();
      if (cloudFirst) { cloudFirst = false; bootNotes(); }
      if (after) after();
    });
  } catch (e) { fail(); }
}
function netChip() { return online() ? '' : '<span class="chip off" title="ინტერნეტი არ არის — პროგრესი ინახება მოწყობილობაზე">📴</span>'; }
window.addEventListener('offline', () => {
  toast('📴 ინტერნეტი არ არის. გაკვეთილები მუშაობს — პროგრესი ინახება და კავშირის დაბრუნებისას სინქრონიზდება.', 4500);
  if (!FULLSCREEN.includes(view)) render();
});
window.addEventListener('online', () => {
  if (!FULLSCREEN.includes(view)) render();
  if (!IN_TG) return;
  const had = isPending() || !cloudReady;
  cloudBoot(() => { if (had) toast('✅ ინტერნეტი დაბრუნდა — პროგრესი სინქრონიზებულია', 2600); prefetchAhead(); });
});
setInterval(() => { if (IN_TG && online() && (isPending() || !cloudReady) && !cloudBooting) cloudBoot(); }, 45000);

// ხმის წინასწარი ჩამოტვირთვა: მიმდინარე და შემდეგი ნაწილი, ფონზე
function audioUnits() { try { return JSON.parse(localStorage.getItem(AUDIO_KEY) || '[]'); } catch (e) { return []; } }
function setAudioUnits(a) { try { localStorage.setItem(AUDIO_KEY, JSON.stringify(a.slice(-60))); } catch (e) {} }
let prefetching = false;
async function prefetchUnits(units, onStep) {
  if (!IN_TG || ttsOff || !online() || prefetching || !('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return false;
  prefetching = true;
  const have = audioUnits();
  try {
    for (const u of units) {
      if (!UNITS[u] || have.includes(u)) continue;
      const items = [...UNITS[u].w.map(x => x[0]), ...UNITS[u].s.map(x => x[0])];
      let all = true;
      for (let i = 0; i < items.length; i += 3) {
        if (!online() || ttsOff) return false;
        await Promise.all(items.slice(i, i + 3).map(t => ttsFetch(t, {}).catch(e => { all = false; if (e && [401, 404, 501].includes(e.status)) ttsOff = true; })));
      }
      if (!all) return false;
      have.push(u); setAudioUnits(have); if (onStep) onStep(u);
    }
    return true;
  } finally { prefetching = false; }
}
async function prefetchDialogs(onStep) {
  if (!IN_TG || ttsOff || !online()) return;
  for (const d of LISTENS) {
    const lines = d.l.map(([w, en]) => [en, { voice: LS_VOICES[w] }]);
    for (let i = 0; i < lines.length; i += 3) await Promise.all(lines.slice(i, i + 3).map(([t, o]) => ttsFetch(t, o).catch(() => {})));
    if (onStep) onStep(d);
  }
}
function prefetchAhead() {
  const c = navigator.connection;
  if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
  const cu = curUnit();
  setTimeout(() => prefetchUnits([cu, cu + 1]), 4000);
}
async function downloadOffline(btn) {
  if (!online()) { toast('ჩამოსატვირთად ინტერნეტი გჭირდება.'); return; }
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) { toast('ამ მოწყობილობაზე ოფლაინ შენახვა ვერ ხერხდება.'); return; }
  const cu = curUnit(), list = [cu, cu + 1, cu + 2, cu + 3, cu + 4].filter(u => UNITS[u]);
  btn.disabled = true; let n = 0;
  const step = () => { n++; btn.textContent = `იტვირთება… ${n} / ${list.length + 1}`; };
  btn.textContent = 'იტვირთება…';
  while (prefetching) await new Promise(r => setTimeout(r, 300));
  const ok = await prefetchUnits(list, step);
  if (ok !== false) { await prefetchDialogs(); step(); }
  btn.disabled = false;
  btn.textContent = ok === false ? 'სცადე ისევ' : 'ჩამოტვირთულია ✓';
  if (ok !== false) toast('📥 შემდეგი 5 ნაწილის და დიალოგების ხმა ჩამოტვირთულია');
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then(() => prefetchAhead()).catch(() => {}));
}

// ====================== შეტყობინებები ======================
function toast(html, ms = 3600) {
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = html; document.body.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms); setTimeout(() => t.remove(), ms + 400);
}
function bootNotes() {
  if (S.frozeNote) { toast(`❄️ streak-ის გაყინვამ გადაგარჩინა! ${S.frozeNote} დღე გამოტოვე, streak შენახულია.`); delete S.frozeNote; save(); }
  if (S.decayNote) { setTimeout(() => toast(`📉 გამოტოვებული დღეების გამო −${S.decayNote} RP. დღეს ივარჯიშე და დაიბრუნე!`), S.frozeNote ? 3800 : 0); delete S.decayNote; save(); }
}

// ====================== მიღწევები ======================
const unitsDone = () => UNITS.filter((_, u) => prog(u) >= LESSONS).length;
const ACH = [
  ['first', '👣', 'პირველი ნაბიჯი', 'პირველი გაკვეთილი', s => s.st.lessons >= 1],
  ['streak3', '🔥', '3 დღე ზედიზედ', 'streak: 3', s => s.streak >= 3],
  ['streak7', '🔥', 'კვირა ზედიზედ', 'streak: 7', s => s.streak >= 7],
  ['streak30', '🌋', 'თვე ზედიზედ', 'streak: 30', s => s.streak >= 30],
  ['streak100', '☄️', '100 დღე', 'streak: 100', s => s.streak >= 100],
  ['xp100', '⚡', '100 XP', 'სულ 100 XP', s => s.xp >= 100],
  ['xp1000', '⚡', '1000 XP', 'სულ 1000 XP', s => s.xp >= 1000],
  ['xp5000', '🌩️', '5000 XP', 'სულ 5000 XP', s => s.xp >= 5000],
  ['perfect5', '🎯', 'სნაიპერი', '5 უშეცდომო გაკვეთილი', s => s.st.perfect >= 5],
  ['unit10', '📘', '10 ნაწილი', '10 ნაწილი დასრულდა', () => unitsDone() >= 10],
  ['unit50', '📚', '50 ნაწილი', 'კურსის ნახევარი', () => unitsDone() >= 50],
  ['unit100', '🎓', 'კურსდამთავრებული', 'ყველა 100 ნაწილი', () => unitsDone() >= 100],
  ['a2', '🔷', 'A2 დონე', 'A2-ზე გადახვედი', () => curUnit() >= 20 || allDone()],
  ['b1', '🔶', 'B1 დონე', 'B1-ზე გადახვედი', () => curUnit() >= 45 || allDone()],
  ['b2', '💠', 'B2 დონე', 'B2-ზე გადახვედი', () => curUnit() >= 75 || allDone()],
  ['speak10', '🎤', 'მოლაპარაკე', '10 სწორად თქმული წინადადება', s => s.st.speakOk >= 10],
  ['speak100', '🎙️', 'ორატორი', '100 სწორად თქმული წინადადება', s => s.st.speakOk >= 100],
  ['talk1', '💬', 'პირველი საუბარი', 'AI-სთან საუბარი', s => s.st.talks >= 1],
  ['talk10', '🗣️', 'მოსაუბრე', '10 საუბარი', s => s.st.talks >= 10],
  ['words100', '🧠', '100 სიტყვა', '100 სიტყვა მეხსიერებაში', s => Object.keys(s.srs).length >= 100],
  ['review100', '🔁', 'გამმეორებელი', '100 გამეორებული სიტყვა', s => s.st.reviewed >= 100],
  ['listen5', '🎧', 'ყურადღებიანი', '5 დიალოგი', s => s.st.listens >= 5],
  ['gold', '🥇', 'ოქროს რანკი', 'მიაღწიე ოქროს', s => s.rank.bt >= 2],
  ['diamond', '💎', 'ალმასის რანკი', 'მიაღწიე ალმასს', s => s.rank.bt >= 4],
  ['legend', '👑', 'ლეგენდა', 'მიაღწიე ლეგენდას', s => s.rank.bt >= 6],
  ['freeze', '❄️', 'გადარჩენილი', 'გაყინვამ streak გადაარჩინა', s => s.st.frozen >= 1],
];
function checkAch() { const fresh = []; for (const [id, , , , f] of ACH) if (!S.ach[id] && f(S)) { S.ach[id] = dayNo(); fresh.push(id); } return fresh; }
const achById = id => ACH.find(a => a[0] === id);

// ====================== შედეგის ბლოკები ======================
function rankBlock(rk) {
  if (!rk) return '';
  const R = S.rank, T = RANK_T[Math.min(R.t, LEGEND)];
  const msg = {
    up: `⬆️ დაწინაურდი: <b>${rankLabel()}</b>!`, down: `⬇️ ჩამოხვედი: <b>${rankLabel()}</b>`,
    tierUp: `🎉 ახალი რანკი: <b>${rankLabel()}</b>! 3 აქტივობა დაცვა გაქვს 🛡️`, tierDown: `⬇️ რანკი დაიწია: <b>${rankLabel()}</b>`,
    promoStart: '🔥 დაწინაურების მატჩი გაიხსნა! მოიგე 3-დან 2.', promoPending: '🏆 დაწინაურების მატჩი გელოდება — RP გაყინულია.',
    promoWin: '✅ მატჩი მოიგე! კიდევ ერთი და ახალ რანკზე ხარ.', promoLose: '❌ მატჩი წააგე. კიდევ გაქვს შანსი.',
    promoFail: '😓 დაწინაურება ვერ მოხერხდა. RP: 75 — სცადე ისევ!', shield: '🛡️ დაცვამ გიშველა — RP არ დაკლებია.',
  }[rk.ev] || '';
  const d = rk.delta ? `<span class="rkd ${rk.delta > 0 ? 'p' : 'n'}">${rk.delta > 0 ? '+' : ''}${rk.delta} ${R.t >= LEGEND ? 'LP' : 'RP'}</span>` : '';
  const pct = R.t >= LEGEND ? 100 : Math.min(100, R.rp);
  return `<div class="rkres" style="--tc:${T.c};--tc2:${T.c2}">${emblem(R.t, R.d, 46)}<div><b>${rankLabel()}</b> ${d}<div class="rkbar"><span style="width:${pct}%"></span></div>${msg ? `<p>${msg}</p>` : ''}</div></div>`;
}
function achBlock(ids) {
  if (!ids || !ids.length) return '';
  return `<div class="achnew">${ids.map(id => { const a = achById(id); return `<span>${a[1]} ${a[2]}</span>`; }).join('')}</div>`;
}

// ====================== მთავარი ეკრანის ზოლი ======================
function homeStrip() {
  const due = srsDue().length, R = S.rank;
  const promo = R.promo ? `<button class="mini promo" data-promo>🏆 <span><b>დაწინაურების მატჩი</b><small>მოგებული ${R.promo.w} · წაგებული ${R.promo.l} — მოიგე 3-დან 2</small></span></button>` : '';
  return `<div class="strip">
    <button class="mini" ${due ? 'data-review' : 'data-go="practice"'}><span class="mi">🧠</span><span><b>${due ? due + ' სიტყვა' : 'გამეორება'}</b><small>${due ? 'დღეს გასამეორებელი' : 'ყველაფერი გამეორებულია'}</small></span></button>
    <button class="mini" data-go="rank">${emblem(R.t, R.d, 34)}<span><b>${rankLabel()}</b><small>${rankPts()}</small></span></button>
    ${promo}</div>`;
}

// ====================== დონის ტესტი და დაწინაურების მატჩი ======================
const BANDS = [[0, 20], [20, 45], [45, 75], [75, 100]];
function buildTest() {
  const out = [];
  BANDS.forEach(([a, b], band) => {
    const us = shuffle(Array.from({ length: b - a }, (_, i) => a + i));
    const ex = [
      makeEx('pick_en', W(us[0], Math.random() * UNITS[us[0]].w.length | 0)),
      makeEx('pick_ka', W(us[1], Math.random() * UNITS[us[1]].w.length | 0)),
      makeEx('pick_sent', SEN(us[2], Math.random() * UNITS[us[2]].s.length | 0)),
      makeEx('build', SEN(us[3], Math.random() * UNITS[us[3]].s.length | 0)),
      makeEx('build', SEN(us[4], Math.random() * UNITS[us[4]].s.length | 0)),
    ];
    ex.forEach(e => { e.band = band; out.push(e); });
  });
  return out;
}
function testStop() {
  const cur = L.q[L.pos], nx = L.q[L.pos + 1];
  return cur && cur.band !== undefined && (!nx || nx.band !== cur.band) && L.bandOk[cur.band] < 3;
}
function buildPromo() {
  const learned = []; for (let u = 0; u < UNITS.length; u++) if (prog(u) > 0) learned.push(u);
  if (!learned.length) learned.push(0);
  const rw = () => { const u = pick(learned); return W(u, Math.random() * UNITS[u].w.length | 0); };
  const rs = () => { const u = pick(learned); return SEN(u, Math.random() * UNITS[u].s.length | 0); };
  const list = [makeEx('type', rw()), makeEx('type', rw()), makeEx('type', rw()), makeEx('pick_en', rw()), makeEx(canSpeak ? 'listen' : 'pick_ka', rw()),
    makeEx('build', rs()), makeEx('build', rs()), makeEx(canSpeak ? 'build_listen' : 'build', rs()), makeEx('pick_sent', rs()), makeEx('pick_sent', rs())];
  if (speakOn()) { list.push(makeEx('speak', rs()), makeEx('speak', rs())); } else list.push(makeEx('build', rs()), makeEx('type', rw()));
  return shuffle(list);
}
function afterAnswer(ex, ok) {
  normState(S); S.wk.all++; if (ok) S.wk.ok++;
  if (L.mode === 'test') { L.bandAll[ex.band]++; if (ok) L.bandOk[ex.band]++; return; }
  if (ex.item && ex.item.kind === 'w') { srsTouch(ex.item, ok, L.mode === 'review'); if (L.mode === 'review') S.st.reviewed++; }
}
function afterSpeak() { L.speakOk = (L.speakOk || 0) + 1; S.st.speakOk++; normState(S); S.wk.spk++; }
// გაკვეთილში ნანახი სიტყვები ემატება გამეორების სიას
function rememberLessonWords(q) { prefetchAhead(); q.forEach(e => { if (e.item && e.item.kind === 'w' && !S.srs[srsKey(e.item)]) srsTouch(e.item, true, false); if (e.type === 'match') e.items.forEach(it => { if (!S.srs[srsKey(it)]) srsTouch(it, true, false); }); }); }
function testResult() {
  let passed = 0; while (passed < 4 && L.bandOk[passed] >= 4) passed++;
  const start = [0, 20, 45, 75, 75][passed], code = ['A1', 'A2', 'B1', 'B2', 'B2+'][passed];
  S.placed = true; credit(5); checkAch(); save(); syncServer(); sfx.done(); haptic('success');
  const canJump = start > curUnit();
  const rows = BANDS.map((_, b) => L.bandAll[b] ? `<div class="kpi" style="--kc:${L.bandOk[b] >= 4 ? 'var(--ok)' : 'var(--muted)'}"><small>${['A1', 'A2', 'B1', 'B2'][b]}</small><b>${L.bandOk[b]}/${L.bandAll[b]}</b></div>` : '').join('');
  $('#app').innerHTML = `<div class="player"><main class="wrap result">${goki(passed ? 'wow' : 'happy')}
    <h2>შენი დონე: ${code}</h2>
    <p>${passed === 0 ? 'დაიწყე პირველი ნაწილიდან — საფუძველი ყველაზე მნიშვნელოვანია.' : passed >= 4 ? 'შესანიშნავია! B2 მასალაც კარგად იცი.' : `${['A1', 'A2', 'B1'][passed - 1]} დონე კარგად იცი. შეგიძლია ${code}-დან დაიწყო.`}</p>
    <div class="kpis" style="grid-template-columns:repeat(${Math.max(1, L.bandAll.filter(Boolean).length)},1fr)">${rows}</div></main>
    <div class="sheet"><div class="wrap">${canJump ? `<button class="cta" data-place="${start}">დაიწყე ნაწილი ${start + 1}-დან</button><button class="cta ghost" id="home">დარჩი სადაც ხარ</button>` : '<button class="cta" id="home">გაგრძელება</button>'}</div></div></div>`;
  L = null;
}

// ====================== AI საუბარი ======================
let T = null;
const TALK_VOICES = ['nova', 'onyx', 'shimmer', 'echo'];
function renderTalkList() {
  const my = levelOf(curUnit())[1];
  const card = t => `<button class="tcard" data-talk="${t.id}"><span class="ti">${t.icon}</span><b>${t.title}</b><small>${t.en}</small>${S.talks[t.id] ? `<span class="tdone">✓ ${S.talks[t.id]}</span>` : ''}</button>`;
  let h = topBar() + `<main class="wrap home"><h1 class="ptitle">საუბარი</h1>
    <div class="card feature">${goki('wave')}<div><h3>ილაპარაკე ინგლისურად</h3><p>აირჩიე სიტუაცია და ესაუბრე AI-ს ხმით ან ტექსტით. შეცდომებს ქართულად გაგისწორებს.</p></div></div>
    ${online() ? '' : '<div class="card offnote">📴 AI საუბარს ინტერნეტი სჭირდება. ამასობაში გაიარე გაკვეთილები ან გამეორება — ისინი ოფლაინაც მუშაობს.</div>'}
    <div class="tgrid one">${card(TALKS[0])}</div>`;
  for (const lv of ['A1', 'A2', 'B1', 'B2']) {
    h += `<div class="lvl"><span class="lvl-code">${lv}</span><span>${LEVELS.find(l => l[1] === lv)[2]}</span>${lv === my ? '<em class="you">შენი დონე</em>' : ''}<i></i></div>
      <div class="tgrid">${TALKS.filter(t => t.lvl === lv).map(card).join('')}</div>`;
  }
  h += `<p class="endnote">ყოველი დასრულებული საუბარი: +15 XP და RP.</p></main>` + navBar();
  $('#app').innerHTML = h;
}
function openTalk(id) {
  const i = TALKS.findIndex(t => t.id === id); if (i < 0) return;
  if (!online()) { toast('📴 AI საუბარს ინტერნეტი სჭირდება.'); return; }
  const sc = TALKS[i], my = levelOf(curUnit())[1];
  T = { sc, msgs: [], done: new Set(), turns: 0, corrections: 0, finished: false, busy: false, err: '', hint: '', showHint: false, showGoal: true, rec: false, stt: false, voice: id === 'free' ? 'onyx' : TALK_VOICES[i % 4],
    api: { role: sc.role, setting: sc.setting, level: sc.lvl || my, tasks: sc.tasks.map(t => t[1]) } };
  view = 'chat'; syncBack();
  $('#app').innerHTML = `<div class="player chat"><div class="wrap p-top"><button class="x" data-back aria-label="გასვლა">${ICON.x}</button>
      <div class="ct-title"><b>${sc.icon} ${sc.title}</b><small>${sc.en}${sc.lvl ? ' · ' + sc.lvl : ''}</small></div>
      <button class="ct-goal" data-goal id="goalBtn"></button></div>
    <div class="wrap ct-goalbox" id="goalBox"></div>
    <main class="wrap ct-log" id="log"></main>
    <div class="ct-bar"><div class="wrap" id="bar"></div></div></div>`;
  renderTalkLog();
  talkSend(null);
}
function renderTalkLog() {
  if (!T || view !== 'chat' || !$('#log')) return;
  const sc = T.sc, nT = sc.tasks.length;
  $('#goalBtn').textContent = nT ? `🎯 ${T.done.size}/${nT}` : `💬 ${T.turns}/8`;
  $('#goalBox').hidden = !T.showGoal;
  $('#goalBox').innerHTML = `<p>${esc(sc.goal)}</p>${nT ? `<ul>${sc.tasks.map((t, i) => `<li class="${T.done.has(i) ? 'ok' : ''}">${T.done.has(i) ? '✅' : '⬜'} ${esc(t[0])}</li>`).join('')}</ul>` : ''}`;
  let h = '';
  T.msgs.forEach((m, i) => {
    if (m.r === 'a') h += `<div class="msg ai"><div class="bub"><p>${esc(m.t)}</p><div class="tools"><button data-saymsg="${i}" aria-label="მოუსმინე">${ICON.spk}</button>${m.ka ? `<button data-tr="${i}">${m.showKa ? 'დამალე' : 'თარგმანი'}</button>` : ''}</div>${m.showKa && m.ka ? `<p class="ka">${esc(m.ka)}</p>` : ''}</div></div>`;
    else h += `<div class="msg me"><div class="bub">${esc(m.t)}</div>${m.corr ? `<div class="corr"><b>✏️ სწორად:</b> ${esc(m.corr.fixed)}${m.corr.why_ka ? `<span>${esc(m.corr.why_ka)}</span>` : ''}</div>` : ''}</div>`;
  });
  if (T.busy) h += `<div class="msg ai"><div class="bub typing"><i></i><i></i><i></i></div></div>`;
  if (T.err) h += `<div class="ct-err">${esc(T.err)}<button data-tretry>სცადე ისევ</button></div>`;
  $('#log').innerHTML = h;
  const canEnd = T.finished || T.turns >= 3;
  $('#bar').innerHTML = T.finished
    ? `<button class="cta" data-tfinish>საუბრის დასრულება 🎉</button>`
    : `${T.hint ? `<button class="ct-hint" data-hint>${T.showHint ? '💡 ' + esc(T.hint) : '💡 მინიშნება'}</button>` : ''}
      <div class="ct-row"><input id="tin" class="typein" autocomplete="off" autocapitalize="sentences" placeholder="დაწერე ინგლისურად…" ${T.busy || T.stt ? 'disabled' : ''}>
      <button class="ct-send" data-tsend aria-label="გაგზავნა" ${T.busy ? 'disabled' : ''}>➤</button>
      <button class="ct-mic ${T.rec ? 'rec' : ''}" data-tmic aria-label="ჩაწერა" ${T.busy || T.stt ? 'disabled' : ''}>${ICON.mic}</button></div>
      <p class="ct-state">${T.rec ? 'გისმენ… როცა დაამთავრებ, ისევ დააჭირე' : T.stt ? 'ვამუშავებ ხმას…' : canEnd ? '<button class="linkbtn" data-tfinish>საუბრის დასრულება</button>' : 'დააჭირე მიკროფონს და ილაპარაკე'}</p>`;
  const log = $('#log'); log.scrollTop = log.scrollHeight;
  window.scrollTo(0, document.body.scrollHeight);
}
function talkErr(e) {
  const s = e && e.status;
  return s === 501 ? 'AI-ს ჩასართავად Cloudflare-ში დაამატე OPENAI_API_KEY.' : s === 401 ? 'საუბარი მუშაობს მხოლოდ მაშინ, როცა Gokski-ს Telegram-იდან ხსნი.' : s === 429 ? 'დღევანდელი ლიმიტი ამოიწურა, ხვალ გავაგრძელოთ.' : 'კავშირი ვერ შედგა. სცადე ისევ.';
}
async function talkSend(text) {
  if (!T || T.busy) return;
  const me = T;
  if (text) { me.msgs.push({ r: 'u', t: text }); me.turns++; me.showGoal = false; }
  me.busy = true; me.err = ''; me.showHint = false; renderTalkLog();
  try {
    const res = await api('/api/chat', { sc: me.api, msgs: me.msgs.map(m => ({ r: m.r, t: m.t })) });
    if (T !== me) return;
    const last = me.msgs[me.msgs.length - 1];
    if (last && last.r === 'u' && res.correction) { last.corr = res.correction; me.corrections++; }
    (res.done || []).forEach(i => me.done.add(i));
    me.msgs.push({ r: 'a', t: res.reply, ka: res.reply_ka });
    me.hint = res.hint_ka || '';
    if (res.finished || me.turns >= 12 || (me.sc.tasks.length && me.done.size === me.sc.tasks.length)) me.finished = true;
    if (!me.sc.tasks.length && me.turns >= 8) me.finished = true;
    me.busy = false; renderTalkLog();
    speakP(res.reply, { voice: me.voice });
  } catch (e) { if (T !== me) return; me.busy = false; me.err = talkErr(e); renderTalkLog(); }
}
function talkMic() {
  if (!T) return;
  if (recOn()) { recStop(); return; }
  if (!(navigator.mediaDevices && window.MediaRecorder)) { T.err = 'ამ მოწყობილობაზე ჩაწერა ვერ ხერხდება — დაწერე ტექსტით.'; renderTalkLog(); return; }
  const me = T;
  recStart(async blob => {
    if (T !== me) return;
    me.rec = false; me.stt = true; renderTalkLog();
    try {
      if (blob.size < 1200) throw new Error('short');
      const r = await api('/api/stt', blob, { raw: true, type: blob.type });
      if (T !== me) return;
      me.stt = false;
      const t = String(r.text || '').trim();
      if (!t) { me.err = 'ვერაფერი გავიგე. სცადე ისევ, ცოტა ხმამაღლა.'; renderTalkLog(); return; }
      talkSend(t);
    } catch (e) { if (T !== me) return; me.stt = false; me.err = e.message === 'short' ? 'ჩანაწერი ძალიან მოკლეა. დააჭირე, ილაპარაკე და ისევ დააჭირე.' : talkErr(e); renderTalkLog(); }
  }, () => { me.rec = false; me.err = 'მიკროფონზე წვდომა ვერ მივიღე. დაწერე ტექსტით ან ნება დართე მიკროფონს.'; renderTalkLog(); });
  T.rec = true; renderTalkLog();
}
function talkFinish() {
  if (!T) return;
  const sc = T.sc, nT = sc.tasks.length, d = T.done.size, full = T.finished || (nT && d === nT);
  const base = full ? 12 : 6, gain = full ? 15 : 8;
  stopSpeech(); recStop();
  const cr = credit(gain); S.st.talks++; S.wk.talk++; S.talks[sc.id] = (S.talks[sc.id] || 0) + 1;
  const rk = rankActivity('talk', 0, { base });
  const fresh = checkAch(); save(); syncServer(); sfx.done(); confetti(); haptic('success');
  const corr = T.msgs.filter(m => m.corr);
  $('#app').innerHTML = `<div class="player"><main class="wrap result">${goki(full ? 'wow' : 'wave')}
    <h2>${full ? 'შესანიშნავი საუბარი!' : 'კარგი საუბარი!'}</h2>
    <p>${nT ? `შესრულებული ამოცანები: ${d} / ${nT}` : `რეპლიკები: ${T.turns}`}</p>
    <div class="kpis"><div class="kpi" style="--kc:var(--sun-d)"><small>XP</small><b>+${gain}</b></div>
      <div class="kpi" style="--kc:var(--teal)"><small>რეპლიკა</small><b>${T.turns}</b></div>
      <div class="kpi" style="--kc:${T.corrections ? '#E8711A' : 'var(--ok)'}"><small>შესწორება</small><b>${T.corrections}</b></div></div>
    ${rankBlock(rk)}${achBlock(fresh)}${cr.freezeEarned ? '<p class="frz">❄️ streak-ის გაყინვა მოიპოვე!</p>' : ''}
    ${corr.length ? `<div class="recap"><h3>გაიმეორე შესწორებები</h3>${corr.map(m => `<div class="rc"><s>${esc(m.t)}</s><b>${esc(m.corr.fixed)}</b>${m.corr.why_ka ? `<span>${esc(m.corr.why_ka)}</span>` : ''}<button class="spk" data-say="${esc(m.corr.fixed)}" aria-label="მოუსმინე">${ICON.spk}</button></div>`).join('')}</div>` : ''}
    </main><div class="sheet"><div class="wrap"><button class="cta" data-back>გაგრძელება</button></div></div></div>`;
  T = null;
}

// ====================== მოსმენა ======================
let LS = null;
const LS_VOICES = ['nova', 'onyx'];
function openListen(id) {
  const d = LISTENS.find(x => x.id === id); if (!d) return;
  LS = { d, cur: -1, playing: false, slow: false, showText: false, ans: {}, checked: false, gen: 0, heard: false };
  view = 'listen'; syncBack();
  prefetchTTS(d.l.map(([w, en]) => [en, { voice: LS_VOICES[w] }]));
  renderListen();
}
function renderListen() {
  if (!LS) return;
  const d = LS.d, allAns = d.q.every((_, i) => LS.ans[i] !== undefined);
  const right = d.q.filter((q, i) => LS.ans[i] === q.a).length;
  $('#app').innerHTML = `<div class="player"><div class="wrap p-top"><button class="x" data-back aria-label="გასვლა">${ICON.x}</button>
      <div class="ct-title"><b>🎧 ${esc(d.title)}</b><small>${d.lvl} · მოსმენა</small></div></div>
    <main class="wrap p-body ls">
      <div class="cast">${d.who.map((w, i) => `<div class="pp ${LS.playing && d.l[LS.cur] && d.l[LS.cur][0] === i ? 'talking' : ''}"><span style="background:${i ? '#0E8F86' : '#7E3AD1'}">${esc(w[0])}</span><b>${esc(w)}</b></div>`).join('')}</div>
      <div class="lines ${LS.showText ? '' : 'hide'}">${d.l.map(([w, en, ka], i) => `<p class="${i === LS.cur ? 'cur' : ''}"><b>${esc(d.who[w])}:</b> ${esc(en)}${LS.showText ? `<span>${esc(ka)}</span>` : ''}</p>`).join('')}</div>
      <div class="lsctl"><button class="cta" data-lsplay>${LS.playing ? '⏸ შეჩერება' : LS.heard ? '▶ თავიდან მოსმენა' : '▶ მოსმენა'}</button>
        <button class="chipbtn ${LS.slow ? 'on' : ''}" data-lsslow>🐢 ნელა</button><button class="chipbtn ${LS.showText ? 'on' : ''}" data-lstext>📄 ტექსტი</button></div>
      ${LS.heard || LS.showText ? `<div class="qs">${d.q.map((q, i) => `<div class="q"><h4>${i + 1}. ${esc(q.q)}</h4><div class="opts">${q.o.map((o, k) => {
        const cls = LS.checked ? (k === q.a ? 'good' : LS.ans[i] === k ? 'flash' : '') : '';
        return `<button class="opt ${cls}" data-lsopt="${i}:${k}" aria-pressed="${!LS.checked && LS.ans[i] === k}" ${LS.checked ? 'disabled' : ''}>${esc(o)}</button>`; }).join('')}</div></div>`).join('')}</div>` : '<p class="hint" style="margin:0">ჯერ მოუსმინე დიალოგს — მერე კითხვები გამოჩნდება.</p>'}
    </main>
    <div class="sheet ${LS.checked ? (right === d.q.length ? 'ok' : 'bad') : ''}"><div class="wrap">${LS.checked
      ? `<div class="fb">${goki(right === d.q.length ? 'wow' : 'happy')}<div><h4>${right} / ${d.q.length} სწორია</h4><p class="sub">${right === d.q.length ? 'ყველაფერი გაიგე!' : 'ჩართე ტექსტი და ნახე, სად შეგეშალა.'}</p></div></div><button class="cta" data-lsdone>დასრულება</button>`
      : `<button class="cta" data-lscheck ${allAns ? '' : 'disabled'}>შემოწმება</button>`}</div></div></div>`;
}
async function listenPlay() {
  if (!LS) return;
  if (LS.playing) { LS.playing = false; LS.gen++; stopSpeech(); LS.cur = -1; renderListen(); return; }
  const me = LS, gen = ++LS.gen; me.playing = true;
  for (let i = 0; i < me.d.l.length; i++) {
    if (LS !== me || me.gen !== gen) return;
    me.cur = i; renderListen();
    const [w, en] = me.d.l[i];
    await speakP(en, { voice: LS_VOICES[w], slow: me.slow });
    await new Promise(r => setTimeout(r, 350));
  }
  if (LS !== me || me.gen !== gen) return;
  me.playing = false; me.cur = -1; me.heard = true; renderListen();
}
function listenDone() {
  const d = LS.d, right = d.q.filter((q, i) => LS.ans[i] === q.a).length, acc = Math.round(right / d.q.length * 100);
  stopSpeech();
  const cr = credit(8); S.st.listens++; S.listens[d.id] = Math.max(S.listens[d.id] || 0, right);
  const rk = rankActivity('listen', acc); const fresh = checkAch(); save(); syncServer(); sfx.done(); if (acc === 100) confetti(); haptic('success');
  $('#app').innerHTML = `<div class="player"><main class="wrap result">${goki(acc === 100 ? 'wow' : 'wave')}<h2>დიალოგი გავლილია!</h2><p>${right} / ${d.q.length} სწორი პასუხი</p>
    <div class="kpis"><div class="kpi" style="--kc:var(--sun-d)"><small>XP</small><b>+8</b></div><div class="kpi" style="--kc:var(--ok)"><small>სიზუსტე</small><b>${acc}%</b></div><div class="kpi" style="--kc:#E8711A"><small>STREAK</small><b>${S.streak}</b></div></div>
    ${rankBlock(rk)}${achBlock(fresh)}${cr.freezeEarned ? '<p class="frz">❄️ streak-ის გაყინვა მოიპოვე!</p>' : ''}</main>
    <div class="sheet"><div class="wrap"><button class="cta" data-back>გაგრძელება</button></div></div></div>`;
  LS = null;
}

// ====================== ვარჯიშის ჩანართი ======================
function renderPracticeTab() {
  const n = S.mistakes.length, any = Object.values(S.prog).some(v => v > 0), due = srsDue().length, total = Object.keys(S.srs).length;
  let h = topBar() + `<main class="wrap home"><h1 class="ptitle">ვარჯიში</h1>
    <div class="card feature">${goki(due ? 'wow' : 'happy')}<div><div class="big-n">${due}</div><h3>სიტყვა გასამეორებელია</h3>
      <p>${total ? `მეხსიერებაში გაქვს ${total} სიტყვა. აპი თითოეულს მაშინ გაგიმეორებს, როცა დავიწყებას იწყებ.` : 'გაიარე გაკვეთილი და ნასწავლი სიტყვები აქ გამოჩნდება.'}</p></div></div>
    <button class="cta" data-review ${due ? '' : 'disabled'}>${due ? `გამეორება (${Math.min(due, 15)} სიტყვა)` : 'დღეს ყველაფერი გამეორებულია ✓'}</button>
    <div class="card row2"><div><h3>შეცდომები: ${n}</h3><p>${n ? 'გაიმეორე და აღარ შეგეშლება. +1 სიცოცხლე.' : any ? 'შეცდომები არ გაქვს — შემთხვევითი გამეორება.' : 'ჯერ გაიარე პირველი გაკვეთილი.'}</p></div>
      <button class="cta sm" data-practice ${any ? '' : 'disabled'}>დაწყება</button></div>
    <div class="lvl"><span class="lvl-code">🎧</span><span>მოსმენა</span><i></i></div>
    <div class="tgrid">${LISTENS.map(d => `<button class="tcard" data-listen="${d.id}"><span class="lvb">${d.lvl}</span><b>${esc(d.title)}</b><small>${d.who.join(' · ')}</small>${S.listens[d.id] !== undefined ? `<span class="tdone">${S.listens[d.id]}/${d.q.length}</span>` : ''}</button>`).join('')}</div>
    <div class="card row2"><div><h3>დონის ტესტი</h3><p>${S.placed ? 'ტესტი უკვე გაიარე — შეგიძლია ხელახლა შეამოწმო დონე.' : 'იცი ინგლისური? 5 წუთში გაიგე დონე და გამოტოვე ნაცნობი ნაწილები.'}</p></div>
      <button class="cta sm ghost" data-test>ტესტი</button></div>
  </main>` + navBar();
  $('#app').innerHTML = h;
}

// ====================== რანკის/პროფილის ჩანართი ======================
function renderRank() {
  const R = S.rank, Tt = RANK_T[Math.min(R.t, LEGEND)], pct = R.t >= LEGEND ? 100 : Math.min(100, R.rp);
  const next = R.t >= LEGEND ? 'უმაღლესი რანკი' : R.promo ? 'დაწინაურების მატჩი' : R.d < 2 ? `შემდეგი: ${RANK_T[R.t].ka} ${RANK_D[R.d + 1]}` : `შემდეგი: მატჩი ${RANK_T[R.t + 1].ka}-ზე`;
  const got = ACH.filter(a => S.ach[a[0]]).length;
  let h = topBar() + `<main class="wrap home"><h1 class="ptitle">რანკი</h1>
    <section class="rkcard" style="--tc:${Tt.c};--tc2:${Tt.c2}">
      <div class="rkem">${emblem(R.t, R.d, 112)}</div>
      <h2>${rankLabel()}</h2><p class="rkpts">${rankPts()}</p>
      <div class="rkbar big"><span style="width:${pct}%"></span></div><p class="rknext">${next}</p>
      ${R.promo ? `<div class="series">${[0, 1, 2].map(i => `<i class="${i < R.promo.w ? 'w' : i < R.promo.w + R.promo.l ? 'l' : ''}"></i>`).join('')}</div><button class="cta gold" data-promo>მატჩის დაწყება</button>` : ''}
      ${R.sh ? `<p class="rksh">🛡️ დაცვა: კიდევ ${R.sh} აქტივობა</p>` : ''}
      ${R.bt > R.t || (R.bt === R.t && R.bd > R.d) ? `<p class="rksh">საუკეთესო: ${rankLabel({ t: R.bt, d: R.bd })}</p>` : ''}
    </section>
    <details class="card rules"><summary>როგორ მუშაობს რანკი?</summary>
      <div class="tiers">${RANK_T.map((t, i) => `<span title="${t.ka}">${emblem(i, i >= LEGEND ? 0 : 2, 34)}<small>${t.ka}</small></span>`).join('')}</div>
      <ul>
        <li><b>7 რანკი</b>, თითოეულში 3 დივიზიონი: III → II → I. ლეგენდაზე RP-ის ნაცვლად ულიმიტო LP გროვდება.</li>
        <li><b>RP გაკვეთილით:</b> 100% → +25, 90%+ → +20, 75%+ → +12, 60%+ → +5. 60%-ზე ნაკლები → −10.</li>
        <li><b>სხვა აქტივობები:</b> საუბარი +12, მოსმენა +10, გამეორება +8, ვარჯიში და გამეორებული გაკვეთილი — ნახევარი.</li>
        <li><b>ბონუსები:</b> streak 7+ დღე → +2, ყოველი სწორად თქმული წინადადება → +1.</li>
        <li><b>რაც მაღლა ხარ, მით რთულია:</b> მაღალ რანკზე ნაკლებ RP-ს იღებ და ცუდ შედეგზე მეტს კარგავ.</li>
        <li><b>100 RP</b> → შემდეგი დივიზიონი. <b>I დივიზიონში</b> 100 RP → დაწინაურების მატჩი: 12 რთული დავალება, მოიგე 3-დან 2 (80%+).</li>
        <li><b>ახალ რანკზე</b> 3 აქტივობა დაცვა 🛡️ გაქვს — RP არ დაგაკლდება.</li>
        <li><b>RP 0-ზე ქვემოთ</b> → ქვედა დივიზიონში ჩამოდიხარ 70 RP-ით.</li>
        <li><b>ოქროდან ზემოთ</b> ყოველი გამოტოვებული დღე −15 RP. streak-ის გაყინვა ამისგანაც გიცავს.</li>
      </ul></details>
    <div class="card"><div class="cardh"><h3>ცხრილი</h3><div class="seg"><button data-seg="rank" aria-pressed="${SV.seg === 'rank'}">რანკი</button><button data-seg="week" aria-pressed="${SV.seg === 'week'}">კვირის XP</button></div></div>
      <div id="board">${boardHTML()}</div>
      ${IN_TG ? '<button class="cta ghost" data-share>მოიწვიე მეგობარი</button>' : ''}</div>
    ${weekHTML()}
    <div class="card"><div class="cardh"><h3>მიღწევები</h3><b class="cnt">${got} / ${ACH.length}</b></div>
      <div class="achs">${ACH.map(([id, ic, t, d]) => `<div class="ach ${S.ach[id] ? 'on' : ''}" title="${esc(d)}"><span>${ic}</span><b>${esc(t)}</b><small>${esc(d)}</small></div>`).join('')}</div></div>
    <div class="card"><h3>პარამეტრები</h3>
      <div class="setrow"><span>❄️ streak-ის გაყინვა</span><b>${S.freeze} / 2</b></div>
      <p class="setnote">ყოველ 7 დღიან streak-ზე 1 გაყინვას იღებ. თუ დღეს გამოტოვებ, გაყინვა streak-ს და RP-ს გადაარჩენს.</p>
      ${IN_TG ? `<div class="setrow"><span>📥 ოფლაინ ხმა</span><button class="cta sm ghost" data-offdl>ჩამოტვირთვა</button></div>
      <p class="setnote">გაკვეთილები ინტერნეტის გარეშეც მუშაობს. აქ შემდეგი 5 ნაწილის და დიალოგების ხმას ჩამოტვირთავ. ${isPending() ? '⏳ ზოგი პროგრესი ჯერ არ არის სინქრონიზებული — ინტერნეტის დაბრუნებისას აიტვირთება.' : '✓ პროგრესი სინქრონიზებულია.'}</p>` : ''}
      ${IN_TG ? `<div class="setrow"><span>⏰ საღამოს შეხსენება</span><label class="sw"><input type="checkbox" id="remOn" ${SV.remind !== false ? 'checked' : ''}><i></i></label></div>
      <div class="setrow"><span>შეხსენების დრო</span><select id="remHour">${Array.from({ length: 16 }, (_, i) => i + 8).map(x => `<option value="${x}" ${x === SV.remindHour ? 'selected' : ''}>${x}:00</option>`).join('')}</select></div>
      <p class="setnote">შეხსენებას და კვირის ანგარიშს @${BOT_USER} გამოგიგზავნის.</p>` : '<p class="setnote">შეხსენებები და ცხრილი მუშაობს, როცა Gokski-ს Telegram-იდან ხსნი.</p>'}
    </div>
  </main>` + navBar();
  $('#app').innerHTML = h;
  if (IN_TG && !SV.board && !SV.loading && online()) loadBoard();
}
function loadBoard() {
  SV.loading = true;
  api('/api/board', {}).then(r => { SV.board = r.rows; SV.boardErr = ''; }).catch(e => { SV.boardErr = e.status === 501 ? 'ცხრილისთვის Cloudflare-ში დაამატე TELEGRAM_BOT_TOKEN.' : 'ცხრილი ვერ ჩაიტვირთა.'; })
    .finally(() => { SV.loading = false; if (view === 'rank' && $('#board')) $('#board').innerHTML = boardHTML(); });
}
function boardHTML() {
  if (!IN_TG) return '<p class="setnote">ცხრილი Telegram-შია ხელმისაწვდომი.</p>';
  if (!SV.board && !online()) return '<p class="setnote">📴 ცხრილი ინტერნეტის დაბრუნებისას გამოჩნდება.</p>';
  if (SV.boardErr) return `<p class="setnote">${SV.boardErr}</p>`;
  if (!SV.board) return '<p class="setnote">იტვირთება…</p>';
  let rows = SV.board.slice();
  const wk = weekId();
  if (SV.seg === 'week') rows = rows.filter(r => r.wk === wk && r.wkXp > 0).sort((a, b) => b.wkXp - a.wkXp);
  const meRow = rows.find(r => r.me);
  if (meRow) { meRow.t = S.rank.t; meRow.d = S.rank.d; meRow.rp = S.rank.rp; meRow.wkXp = S.wk.xp; }
  if (!rows.length) return '<p class="setnote">ჯერ ცარიელია. გაიარე გაკვეთილი და პირველი იქნები!</p>';
  const list = rows.slice(0, 50).map((r, i) => `<div class="brow ${r.me ? 'me' : ''}"><span class="pos">${i + 1}</span>${emblem(r.t, r.d, 30)}<span class="nm">${esc(r.name)}${r.me ? ' (შენ)' : ''}</span><span class="vl">${SV.seg === 'week' ? `${r.wkXp} XP` : r.t >= LEGEND ? `${r.rp} LP` : `${RANK_T[r.t].ka} ${RANK_D[r.d]} · ${r.rp}`}</span></div>`).join('');
  return list + (rows.length < 2 ? '<p class="setnote">მოიწვიე მეგობრები და ერთად შეეჯიბრეთ 💪</p>' : '');
}
function weekHTML() {
  const n = dayNo(), days = Array.from({ length: 7 }, (_, i) => n - 6 + i), vals = days.map(d => S.hist[d] || 0);
  const max = Math.max(GOAL, ...vals), W = 280, H = 120, bw = 26, gap = (W - bw * 7) / 6;
  const bars = days.map((d, i) => {
    const v = vals[i], h = Math.round((v / max) * 80), x = Math.round(i * (bw + gap)), y = 96 - h;
    return `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h, 3)}" rx="6" fill="${d === n ? 'var(--teal)' : v >= GOAL ? 'var(--sun)' : 'var(--line)'}"/>${v ? `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="bv">${v}</text>` : ''}<text x="${x + bw / 2}" y="114" text-anchor="middle" class="bl">${WD[new Date(d * 864e5).getUTCDay()]}</text>`;
  }).join('');
  const w = S.wk, lw = S.lwk, acc = w.all ? Math.round(w.ok / w.all * 100) : 0;
  const diff = lw && lw.xp ? Math.round((w.xp - lw.xp) / lw.xp * 100) : null;
  return `<div class="card"><div class="cardh"><h3>ეს კვირა</h3>${diff !== null ? `<b class="cnt ${diff >= 0 ? 'up' : 'dn'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff)}%</b>` : ''}</div>
    <svg class="wchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="ბოლო 7 დღის XP">${bars}</svg>
    <div class="wstats"><div><b>${w.xp}</b><small>XP</small></div><div><b>${w.les}</b><small>გაკვეთილი</small></div><div><b>${acc}%</b><small>სიზუსტე</small></div><div><b>${w.spk}</b><small>თქმული</small></div><div><b>${w.talk}</b><small>საუბარი</small></div></div>
    ${lw ? `<p class="setnote">წინა კვირა: ${lw.xp} XP, ${lw.les} გაკვეთილი.</p>` : ''}</div>`;
}

// ====================== ნავიგაცია და ღილაკები ======================
const ICON2 = {
  chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 3h10v2h4v3a5 5 0 0 1-5 5h-.3A5 5 0 0 1 13 15.9V19h4v2H7v-2h4v-3.1A5 5 0 0 1 8.3 13H8a5 5 0 0 1-5-5V5h4zm10 4v4a3 3 0 0 0 2-3V7zM5 7v1a3 3 0 0 0 2 3V7z"/></svg>',
};
const FULLSCREEN = ['lesson', 'chat', 'listen'];
function goBack() {
  const from = view;
  stopSpeech(); recStop();
  if (LS) LS.gen++;
  L = null; T = null; LS = null;
  view = from === 'chat' ? 'talk' : from === 'listen' ? 'practice' : 'path';
  refreshDay(); render(); window.scrollTo(0, 0);
}
function featureClick(t) {
  const ds = t.dataset;
  if (ds.review !== undefined) { startLesson(0, 0, 'review'); return true; }
  if (ds.test !== undefined) { startLesson(0, 0, 'test'); return true; }
  if (ds.promo !== undefined) { if (S.rank.promo) startLesson(0, 0, 'promo'); return true; }
  if (ds.place !== undefined) { const n = +ds.place; for (let u = 0; u < n; u++) S.prog[u] = LESSONS; save(); syncServer(); view = 'path'; render(); window.scrollTo(0, 0); return true; }
  if (ds.talk) { openTalk(ds.talk); return true; }
  if (ds.listen) { openListen(ds.listen); return true; }
  if (ds.back !== undefined) { goBack(); return true; }
  if (ds.seg) { SV.seg = ds.seg; document.querySelectorAll('[data-seg]').forEach(b => b.setAttribute('aria-pressed', b === t)); $('#board').innerHTML = boardHTML(); return true; }
  if (ds.offdl !== undefined) { downloadOffline(t); return true; }
  if (ds.share !== undefined) {
    const url = `https://t.me/share/url?url=${encodeURIComponent('https://t.me/' + BOT_USER)}&text=${encodeURIComponent('ინგლისურს ვსწავლობ Gokski-ში 🇬🇧 შემომიერთდი და შევეჯიბროთ!')}`;
    try { Telegram.WebApp.openTelegramLink(url); } catch (e) {}
    return true;
  }
  // საუბარი
  if (T) {
    if (ds.goal !== undefined) { T.showGoal = !T.showGoal; renderTalkLog(); return true; }
    if (ds.tsend !== undefined) { const v = ($('#tin').value || '').trim(); if (v) talkSend(v); return true; }
    if (ds.tmic !== undefined) { talkMic(); return true; }
    if (ds.tfinish !== undefined) { talkFinish(); return true; }
    if (ds.tretry !== undefined) { T.err = ''; talkSend(null); return true; }
    if (ds.hint !== undefined) { T.showHint = !T.showHint; renderTalkLog(); return true; }
    if (ds.tr !== undefined) { const m = T.msgs[+ds.tr]; m.showKa = !m.showKa; renderTalkLog(); return true; }
    if (ds.saymsg !== undefined) { speakP(T.msgs[+ds.saymsg].t, { voice: T.voice }); return true; }
  }
  // მოსმენა
  if (LS) {
    if (ds.lsplay !== undefined) { listenPlay(); return true; }
    if (ds.lsslow !== undefined) { LS.slow = !LS.slow; renderListen(); return true; }
    if (ds.lstext !== undefined) { LS.showText = !LS.showText; renderListen(); return true; }
    if (ds.lsopt) { const [q, o] = ds.lsopt.split(':').map(Number); LS.ans[q] = o; sfx.pop(); haptic('select'); renderListen(); return true; }
    if (ds.lscheck !== undefined) { LS.checked = true; const d = LS.d, ok = d.q.every((q, i) => LS.ans[i] === q.a); ok ? sfx.ok() : sfx.bad(); haptic(ok ? 'success' : 'error'); renderListen(); return true; }
    if (ds.lsdone !== undefined) { listenDone(); return true; }
  }
  return false;
}
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target && e.target.id === 'tin' && T) { e.preventDefault(); const v = e.target.value.trim(); if (v) talkSend(v); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'remOn' || e.target.id === 'remHour') {
    const on = $('#remOn').checked, hr = +$('#remHour').value;
    SV.remind = on; SV.remindHour = hr; syncServer({ remind: on, remindHour: hr });
    toast(on ? `⏰ შეხსენება: ყოველდღე ${hr}:00` : '🔕 შეხსენება გამორთულია', 2200);
  }
});
