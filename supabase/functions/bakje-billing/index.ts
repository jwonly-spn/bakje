// 추억앨범·먼치킨 계좌이체 이용권 — Supabase Edge Function "bakje-billing" (verify_jwt false, 2026-11-05)
// 흐름: 로그인한 회원이 이용권 신청(먼치킨 / 추억앨범 / 먼치킨+추억앨범 × 1·3·6·12개월) → 운영자 계좌·금액·입금자명을 보고 이체
//  추가(add-album·add-munchkin): 가진 이용권 끝나는 날까지, 더하는 것의 한 달 값(1년치로 샀으면 1년 값÷12) × 남은 날÷30
//  → "입금했어요"(운영자 앱 푸시 bj_push_subs + 디스코드 웹후크 BILLING_WEBHOOK 이 있으면 그것도)
//  → 운영자(bj_members.is_admin)가 운영자 앱(사이트 /ops/ 를 아이폰 홈 화면에 추가)에서 확인 → 이용 기간 30일 단위로 연장(bj_entitlements, 추억앨범은 bj_albums.paid_until 도)
// 회원 세션은 bakje 와 같은 x-bj-session(bj_sessions sha256). 표: supabase/schema.sql "bakje_billing".
// 주의: MCP 로 올릴 때 백슬래시-u 글자 표기가 풀려 버리므로 이 파일에는 그런 표기를 쓰지 않는다.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const BROKEN = '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-bj-session',
  'Access-Control-Max-Age': '86400'
};
const PLANS: Record<string, { name: string; products: string[] }> = {
  munchkin: { name: '먼치킨', products: ['munchkin'] },
  album: { name: '추억앨범', products: ['album'] },
  bundle: { name: '먼치킨 + 추억앨범', products: ['munchkin', 'album'] },
  // 남은 기간에 맞춰 추가(먼치킨을 쓰다가 추억앨범을 더하기 등): 가진 이용권이 끝나는 날까지, 남은 날만큼 낸다(addonQuote)
  'add-album': { name: '추억앨범 추가', products: ['album'] },
  'add-munchkin': { name: '먼치킨 추가', products: ['munchkin'] }
};
const ADDON: Record<string, { have: string; add: string }> = { 'add-album': { have: 'munchkin', add: 'album' }, 'add-munchkin': { have: 'album', add: 'munchkin' } };
const MONTHS = [1, 3, 6, 12];
const DAY = 86400000, MONTH_MS = 30 * DAY;
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
const enc = new TextEncoder();

class Fail extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string) => new Fail(status, message);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
async function q<T = any>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) { console.error(error); throw fail(503, BROKEN); }
  return data;
}
const env = (k: string) => (Deno.env.get(k) || '').trim();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const rid = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => ALPHA[x & 31]).join('');
const digits4 = () => String(1000 + (crypto.getRandomValues(new Uint16Array(1))[0] % 9000));
const hit = async (key: string, seconds: number, max: number) => Boolean(await q(db.rpc('fp_hit', { p_key: key, p_seconds: seconds, p_max: max })));
const line = (v: unknown, max: number) => typeof v === 'string' ? [...v.replace(/[\r\n\t]+/g, ' ')].filter((ch) => ch.charCodeAt(0) >= 32).join('').trim().slice(0, max) : '';

// 로그인한 회원(bakje 와 같은 세션 표)
async function needMember(req: Request, now: number) {
  const token = req.headers.get('x-bj-session') || '';
  if (!/^[-_A-Za-z0-9]{43}$/.test(token)) throw fail(401, '다시 로그인해 주세요.');
  const s: any = await q(db.from('bj_sessions').select('member,expires').eq('token', await sha256hex(token)).maybeSingle());
  if (!s || s.expires < now) throw fail(401, '다시 로그인해 주세요.');
  const m: any = await q(db.from('bj_members').select('id,nickname,verified,state,is_admin').eq('id', s.member).maybeSingle());
  if (!m) throw fail(401, '다시 로그인해 주세요.');
  if (m.state === 'banned') throw fail(403, '이용이 막힌 계정이에요.');
  return m;
}
async function cfg() {
  const r: any = await q(db.from('bj_settings').select('value').eq('key', 'billing').maybeSingle());
  const v = isObj(r?.value) ? r.value : {};
  const p = isObj(v.prices) ? v.prices : {};
  const y = isObj(v.year) ? v.year : {};
  const price = (o: any, k: string) => (Number.isSafeInteger(o[k]) && o[k] > 0 ? o[k] : 0);
  return {
    bank: line(v.bank, 30), number: line(v.number, 40), holder: line(v.holder, 30),
    prices: { munchkin: price(p, 'munchkin'), album: price(p, 'album'), bundle: price(p, 'bundle') } as Record<string, number>,
    // 1년치 한 번에(12개월) 할인 값 — 없으면 월 값 × 12
    year: { munchkin: price(y, 'munchkin'), album: price(y, 'album'), bundle: price(y, 'bundle') } as Record<string, number>
  };
}
const yearOf = (c: any, k: string) => c.year[k] || c.prices[k] * 12;
const priceOf = (c: any, plan: string, months: number) => (months === 12 ? yearOf(c, plan) : c.prices[plan] * months);
// 추가 값: 더하는 것의 한 달 값 × 남은 날 ÷ 30, 100원 단위 올림. 끝나는 날은 가진 이용권과 같게.
//  한 달 값 = 가진 이용권을 1년치로 샀으면 더하는 것 1년 값 ÷ 12(예: 30,000 ÷ 12 = 2,500), 달마다 샀으면 더하는 것 월 값.
function addonQuote(c: any, plan: string, ents: Record<string, number>, now: number, yearly: boolean) {
  const a = ADDON[plan];
  const end = ents[a.have] || 0;
  if (end <= now + DAY) return null;                       // 가진 이용권이 없거나 하루도 안 남음
  if ((ents[a.add] || 0) >= end) return null;              // 이미 그날까지 있음
  const from = Math.max(now, ents[a.add] || 0);
  const days = Math.ceil((end - from) / DAY);
  const perMonth = yearly ? yearOf(c, a.add) / 12 : c.prices[a.add];
  if (!(perMonth > 0)) return null;
  const amount = Math.ceil((perMonth * days / 30) / 100) * 100;
  return { amount, until: end, days, perMonth: Math.round(perMonth), yearly };
}
// 가진 이용권을 마지막으로 1년치로 샀는지(마지막 확인된 일반 신청 기준)
async function boughtYearly(member: string, product: string) {
  const plans = Object.keys(PLANS).filter((k) => !ADDON[k] && PLANS[k].products.includes(product));
  const r: any = await q(db.from('bj_orders').select('months').eq('member', member).eq('state', 'paid').in('plan', plans).order('done', { ascending: false }).limit(1));
  return r?.[0]?.months === 12;
}
async function addonsOf(c: any, member: string, ents: Record<string, number>, now: number) {
  const out: Record<string, any> = {};
  for (const k of Object.keys(ADDON)) {
    if ((ents[ADDON[k].have] || 0) <= now + DAY) continue;
    const quote = addonQuote(c, k, ents, now, await boughtYearly(member, ADDON[k].have));
    if (quote) out[k] = quote;
  }
  return out;
}
const open = (c: any) => Boolean(c.bank && c.number && c.holder);
const ownsOf = async (member: string) => ((await q(db.from('bj_album_owners').select('album').eq('member', member))) as any[]).map((r) => r.album);
const entsOf = async (member: string) => Object.fromEntries(((await q(db.from('bj_entitlements').select('product,until').eq('member', member))) as any[]).map((e) => [e.product, Number(e.until)]));
const orderOut = (o: any) => ({ id: o.id, plan: o.plan, months: o.months, amount: o.amount, payer: o.payer, album: o.album, state: o.state, created: o.created, sent: o.sent ?? null, done: o.done ?? null, nick: o.nick, until_to: o.until_to ?? null });
const periodText = (o: any) => (o.months ? `${o.months === 12 ? '1년' : o.months + '개월'}` : `${new Date(Number(o.until_to) + 9 * 3600000).toISOString().slice(0, 10)}까지`);
const won = (n: number) => n.toLocaleString('ko-KR') + '원';
async function notifyOps(text: string, title: string, body: string) {
  await pushTo(null, { title, body, url: '/ops/', badge: await waitingCount() });
  const url = env('BILLING_WEBHOOK');
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) return;
  try { await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(8000) }); }
  catch { /* 알림이 안 가도 운영자 화면에 남아 있다 */ }
}
const waitingCount = async () => ((await q(db.from('bj_orders').select('id').eq('state', 'pending').not('sent', 'is', null))) as any[]).length;

// ── 운영자 앱 푸시(Web Push · VAPID · aes128gcm) ──
// 아이폰은 홈 화면에 추가한 웹 앱만 푸시를 받는다(iOS 16.4+). VAPID 열쇠는 처음 쓸 때 여기서 만들어 bj_settings "vapid" 에 둔다(밖으로 안 나감).
const Z = String.fromCharCode(0);
const PUSH_HOST = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of parts) { out.set(x, i); i += x.length; } return out; };
let vapidCache: { key: CryptoKey; pub: string } | null = null;
async function vapid() {
  if (vapidCache) return vapidCache;
  let r: any = await q(db.from('bj_settings').select('value').eq('key', 'vapid').maybeSingle());
  if (!r?.value?.jwk) {
    const kp: any = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const value = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    await q(db.from('bj_settings').upsert({ key: 'vapid', value, updated: Date.now() }, { onConflict: 'key', ignoreDuplicates: true }));
    r = await q(db.from('bj_settings').select('value').eq('key', 'vapid').maybeSingle());
  }
  const key = await crypto.subtle.importKey('jwk', r.value.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return (vapidCache = { key, pub: r.value.pub });
}
async function vapidAuth(endpoint: string) {
  const v = await vapid();
  const part = (o: unknown) => b64u(enc.encode(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:likegorogoro@naver.com' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${v.pub}`;
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
async function seal(sub: any, text: string) {
  const ua = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  const mine: any = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const minePub = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, mine.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info' + Z), ua, minePub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm' + Z), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce' + Z), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65;
  return cat(head, minePub, body);
}
// member 가 있으면 그 사람 기기만, 없으면 모든 운영자 기기. 받은 기기 수를 돌려준다.
async function pushTo(member: string | null, msg: Record<string, unknown>) {
  let ids: string[] = member ? [member] : ((await q(db.from('bj_members').select('id').eq('is_admin', true))) as any[]).map((r) => r.id);
  if (!ids.length) return 0;
  const subs: any[] = await q(db.from('bj_push_subs').select('*').in('member', ids));
  const text = JSON.stringify(msg);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await fetch(s.endpoint, { method: 'POST', body: await seal(s, text), signal: AbortSignal.timeout(8000),
        headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: await vapidAuth(s.endpoint) } });
      if (r.status === 404 || r.status === 410) await q(db.from('bj_push_subs').delete().eq('id', s.id));   // 앱을 지웠거나 폰을 바꿈
      else if (r.ok) { sent++; await q(db.from('bj_push_subs').update({ ok: Date.now() }).eq('id', s.id)); }
      else console.error('push', r.status, (await r.text().catch(() => '')).slice(0, 200));
    } catch (e) { console.error('push', String(e)); }
  }));
  return sent;
}

async function handle(req: Request, now: number) {
  const raw = await req.text();
  if (raw.length > 4096) throw fail(413, '보낸 내용이 너무 커요.');
  let b: any; try { b = JSON.parse(raw); } catch { throw fail(400, '요청 모양이 올바르지 않아요.'); }
  if (!isObj(b) || typeof b.action !== 'string') throw fail(400, '요청 모양이 올바르지 않아요.');
  const me = await needMember(req, now);
  switch (b.action) {
    // 내 이용권 화면: 계좌·가격·지금 이용 기간·내 신청
    case 'info': {
      const [c, ents, owns, orders]: any = await Promise.all([cfg(), entsOf(me.id), ownsOf(me.id),
        q(db.from('bj_orders').select('*').eq('member', me.id).order('created', { ascending: false }).limit(20))]);
      const addons = await addonsOf(c, me.id, ents, now);
      return { ok: true, open: open(c), bank: open(c) ? { bank: c.bank, number: c.number, holder: c.holder } : null, prices: c.prices, year: { munchkin: yearOf(c, 'munchkin'), album: yearOf(c, 'album'), bundle: yearOf(c, 'bundle') }, months: MONTHS, addons, ents, owns, orders: orders.map(orderOut), admin: me.is_admin === true };
    }
    case 'order': {
      const c = await cfg();
      if (!open(c)) throw fail(503, '이용권 신청을 준비하고 있어요. 조금 뒤에 다시 해 주세요.');
      const plan = typeof b.plan === 'string' && PLANS[b.plan] ? b.plan : '';
      if (!plan) throw fail(400, '이용권을 골라 주세요.');
      const add = ADDON[plan];
      if (!c.prices[add ? add.add : plan]) throw fail(400, '이 이용권은 아직 준비 중이에요.');
      const months = add ? 0 : Number(b.months);
      if (!add && !MONTHS.includes(months)) throw fail(400, '기간을 골라 주세요.');
      if (!me.verified) throw fail(403, '본인인증을 먼저 해 주세요.');
      let amount = add ? 0 : priceOf(c, plan, months), untilTo: number | null = null;
      if (add) {
        const quote = (await addonsOf(c, me.id, await entsOf(me.id), now))[plan];
        if (!quote) throw fail(400, `지금은 ${PLANS[plan].name}를 할 수 없어요. 일반 이용권으로 신청해 주세요.`);
        amount = quote.amount; untilTo = quote.until;
      }
      let album: string | null = null;
      if (PLANS[plan].products.includes('album')) {
        const owns = await ownsOf(me.id);
        album = typeof b.album === 'string' && owns.includes(b.album) ? b.album : owns.length === 1 ? owns[0] : null;
        if (!album) throw fail(400, '추억앨범 이용권은 앨범을 연결한 DJ 계정만 신청할 수 있어요. 내 정보 › "DJ 계정으로 이 앨범 관리하기"를 먼저 해 주세요.');
      }
      if (!await hit('bjod:' + me.id, 3600, 10)) throw fail(429, '신청을 너무 자주 했어요. 조금 뒤에 다시 해 주세요.');
      const waiting: any = await q(db.from('bj_orders').select('id').eq('member', me.id).eq('state', 'pending'));
      if (waiting.length >= 3) throw fail(409, '확인을 기다리는 신청이 있어요. 그 신청을 마치거나 취소한 뒤 다시 해 주세요.');
      const payer = ((me.nickname || 'DJ').replace(/\s+/g, '').slice(0, 6)) + digits4();
      const row = { id: 'o' + rid(11), member: me.id, nick: me.nickname || '', plan, months, amount, payer, album, created: now, until_to: untilTo };
      await q(db.from('bj_orders').insert(row));
      return { ok: true, order: orderOut({ ...row, state: 'pending' }), bank: { bank: c.bank, number: c.number, holder: c.holder } };
    }
    // "입금했어요" — 운영자에게 알림
    case 'sent': {
      const r: any = await q(db.from('bj_orders').update({ sent: now }).eq('id', String(b.id || '')).eq('member', me.id).eq('state', 'pending').select('*'));
      const o = r?.[0];
      if (!o) throw fail(404, '신청을 찾을 수 없어요.');
      await notifyOps(`💸 입금했어요\n${o.nick || '(닉네임 없음)'} · ${PLANS[o.plan].name} ${periodText(o)}\n금액 ${won(o.amount)} · 입금자명 ${o.payer}\n운영자 앱에서 확인해 주세요.`,
        `💸 ${won(o.amount)} 입금했어요`, `${o.payer} · ${PLANS[o.plan].name} ${periodText(o)}\n토스뱅크에서 들어왔는지 보고 확인해 주세요.`);
      return { ok: true, order: orderOut(o) };
    }
    case 'cancel': {
      const r: any = await q(db.from('bj_orders').update({ state: 'canceled', done: now }).eq('id', String(b.id || '')).eq('member', me.id).eq('state', 'pending').select('*'));
      if (!r?.[0]) throw fail(404, '취소할 신청을 찾을 수 없어요.');
      return { ok: true, order: orderOut(r[0]) };
    }
  }
  // ── 운영자 ──
  if (me.is_admin !== true) throw fail(403, '운영자만 할 수 있어요.');
  switch (b.action) {
    case 'ops-orders': {
      const [waiting, recent, c]: any = await Promise.all([
        q(db.from('bj_orders').select('*').eq('state', 'pending').order('created', { ascending: true }).limit(200)),
        q(db.from('bj_orders').select('*').neq('state', 'pending').order('done', { ascending: false }).limit(30)),
        cfg()]);
      return { ok: true, waiting: waiting.map(orderOut), recent: recent.map(orderOut), billing: c };
    }
    // 운영자 앱 알림 받는 기기
    case 'push-key': return { ok: true, key: (await vapid()).pub };
    case 'push-add': {
      const s = isObj(b.sub) ? b.sub : {}, k = isObj(s.keys) ? s.keys : {};
      const endpoint = typeof s.endpoint === 'string' && s.endpoint.length < 1000 && PUSH_HOST.test(s.endpoint) ? s.endpoint : '';
      const ok64 = (v: unknown, lo: number, hi: number) => typeof v === 'string' && /^[-_A-Za-z0-9]+$/.test(v) && v.length >= lo && v.length <= hi;
      if (!endpoint || !ok64(k.p256dh, 80, 100) || !ok64(k.auth, 16, 30)) throw fail(400, '알림 정보가 올바르지 않아요.');
      const old: any = await q(db.from('bj_push_subs').select('id').eq('endpoint', endpoint).maybeSingle());
      const row = { id: old?.id || 'p' + rid(11), member: me.id, endpoint, p256dh: k.p256dh, auth: k.auth, label: line(b.label, 40) || '내 폰', created: now };
      await q(db.from('bj_push_subs').upsert(row, { onConflict: 'endpoint' }));
      return { ok: true, id: row.id };
    }
    case 'push-list': {
      const r: any = await q(db.from('bj_push_subs').select('id,label,created,ok').eq('member', me.id).order('created', { ascending: false }));
      return { ok: true, devices: r };
    }
    case 'push-del': {
      await q(db.from('bj_push_subs').delete().eq('id', String(b.id || '')).eq('member', me.id));
      return { ok: true };
    }
    case 'push-test': {
      const n = await pushTo(me.id, { title: '🔔 시험 알림', body: '이 알림이 보이면 입금 알림도 이 폰으로 와요.', url: '/ops/', badge: await waitingCount() });
      return { ok: true, sent: n };
    }
    case 'ops-confirm': {
      const r: any = await q(db.from('bj_orders').update({ state: 'paid', done: now }).eq('id', String(b.id || '')).eq('state', 'pending').select('*'));
      const o = r?.[0];
      if (!o) throw fail(404, '확인할 신청을 찾을 수 없어요(이미 처리했을 수 있어요).');
      // 일반: 지금(또는 남은 끝)부터 개월 수 × 30일 더함 · 추가(months 0): 맞춘 끝나는 날(until_to)까지
      const add = o.months * MONTH_MS, out: Record<string, number> = {};
      const next = (cur: number) => (o.months ? Math.max(now, cur) + add : Math.max(cur, Number(o.until_to) || now));
      if (o.member) {
        const ents = await entsOf(o.member);
        for (const p of PLANS[o.plan].products) {
          const until = next(ents[p] || 0);
          await q(db.from('bj_entitlements').upsert({ member: o.member, product: p, until }));
          out[p] = until;
        }
      }
      if (o.album && PLANS[o.plan].products.includes('album')) {
        const a: any = await q(db.from('bj_albums').select('paid_until').eq('id', o.album).maybeSingle());
        if (a) {
          const until = next(Number(a.paid_until || 0));
          await q(db.from('bj_albums').update({ paid_until: until }).eq('id', o.album));
          out.albumPaid = until;
        }
      }
      return { ok: true, order: orderOut(o), until: out };
    }
    case 'ops-reject': {
      const r: any = await q(db.from('bj_orders').update({ state: 'rejected', done: now, note: line(b.note, 200) }).eq('id', String(b.id || '')).eq('state', 'pending').select('*'));
      if (!r?.[0]) throw fail(404, '신청을 찾을 수 없어요.');
      return { ok: true, order: orderOut(r[0]) };
    }
    // 계좌·가격 정하기(가격 0 = 그 이용권은 "준비 중")
    case 'ops-billing': {
      const p = isObj(b.prices) ? b.prices : {};
      const y = isObj(b.year) ? b.year : {};
      const price = (o: any, k: string) => { const n = Number(o[k]); return Number.isSafeInteger(n) && n >= 0 && n <= 1000000 ? n : 0; };
      const value = { bank: line(b.bank, 30), number: line(b.number, 40), holder: line(b.holder, 30),
        prices: { munchkin: price(p, 'munchkin'), album: price(p, 'album'), bundle: price(p, 'bundle') },
        year: { munchkin: price(y, 'munchkin'), album: price(y, 'album'), bundle: price(y, 'bundle') } };
      await q(db.from('bj_settings').upsert({ key: 'billing', value, updated: now }));
      return { ok: true, billing: value };
    }
  }
  throw fail(400, '모르는 요청이에요.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const route = new URL(req.url).pathname.replace(/^.*?\/bakje-billing\/?/, '').replace(/\/+$/, '');
  try {
    if (req.method === 'GET' && route === 'health') return json(200, { ok: true, v: 3, year: true, addon: true, push: true });
    if (req.method === 'POST' && (route === '' || route === 'api')) return json(200, await handle(req, Date.now()));
    return json(404, { ok: false, error: '찾을 수 없어요.' });
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { ok: false, error: e.message });
    console.error(e);
    return json(500, { ok: false, error: BROKEN });
  }
});
