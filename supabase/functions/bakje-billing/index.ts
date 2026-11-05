// 추억앨범·먼치킨 계좌이체 이용권 — Supabase Edge Function "bakje-billing" (verify_jwt false, 2026-11-05)
// 흐름: 로그인한 회원이 이용권 신청(먼치킨 / 추억앨범 / 먼치킨+추억앨범 × 1·3·6·12개월) → 운영자 계좌·금액·입금자명을 보고 이체
//  추가(add-album·add-munchkin): 가진 이용권 끝나는 날까지, 더하는 것의 한 달 값(1년치로 샀으면 1년 값÷12) × 남은 날÷30
//  → "입금했어요"(운영자 앱 푸시 bj_push_subs + 디스코드 웹후크 BILLING_WEBHOOK 이 있으면 그것도)
//  → 운영자(bj_members.is_admin)가 운영자 앱(사이트 /ops/ 를 아이폰 홈 화면에 추가)에서 확인 → 이용 기간 30일 단위로 연장(bj_entitlements, 추억앨범은 bj_albums.paid_until 도)
// 회원 세션은 bakje 와 같은 x-bj-session(bj_sessions sha256). 표: supabase/schema.sql "bakje_billing".
// v4(2026-11-05 밤, 먼치킨 계정): 앨범이 없는 DJ 도 먼치킨.com/album 에서 추억앨범을 신청한다 — 주소 이름(<이름>.먼치킨.com)·앨범 이름을 함께 적고(order newAlbum),
//  운영자가 입금을 확인하면(ops-confirm) 앨범·주소(bj_hosts + 저장소 h/<주소>.json)가 저절로 생기고 신청한 계정이 바로 주인(bj_album_owners)이 된다.
//  그 계정에 이어진 먼치킨(bj_member_devices, 봇 프로그램)이 있으면 최초 박제판 저절로 올리기도 잇는다(bj_bots). info 에 가진 앨범 목록(albums), album-name(주소 이름 확인).
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

// ── 새 추억앨범 주소 이름(<이름>.먼치킨.com) ──
// 한글·영어 소문자·숫자 1~15자, - 는 가운데에만. 주소는 퓨니코드 소문자(new URL 이 바꿔 준다).
const LABEL_RE = /^[가-힣a-z0-9](?:[가-힣a-z0-9-]{0,13}[가-힣a-z0-9])?$/;
const LABEL_RESERVED = new Set(['www', 'test', 'ops', 'api', 'admin', 'mail', 'help', 'app', 'dev', 'staging', 'album', '먼치킨', '운영자', '관리자', '추억앨범', '키우기', '공식', '스푼', 'spoon']);
const ALBUM_SUFFIX = '.xn--s22bu18a0ub.com';   // .먼치킨.com
const HOST_TAKEN_OPS = '주소가 이미 쓰이고 있어요 — 거절하고 다른 주소로 다시 신청하게 해 주세요';
function labelOf(v: unknown) {
  const label = typeof v === 'string' ? v.normalize('NFC').trim().toLowerCase() : '';
  if (!label) return { label, host: '', reason: '주소 이름을 적어 주세요.' };
  if (!LABEL_RE.test(label)) return { label, host: '', reason: '주소 이름은 한글·영어 소문자·숫자로 1~15자예요. - 는 가운데에만 쓸 수 있어요.' };
  if (LABEL_RESERVED.has(label)) return { label, host: '', reason: '쓸 수 없는 주소 이름이에요. 다른 이름을 골라 주세요.' };
  // xn-- 로 시작하는 이름은 한글 주소를 바꾼 글자(퓨니코드)라 그대로 받지 않는다(다른 한글 이름과 같은 주소가 된다)
  if (label.startsWith('xn--')) return { label, host: '', reason: '이 이름으로는 주소를 만들 수 없어요. 다른 이름을 골라 주세요.' };
  let host = '';
  try { host = new URL('https://' + label + '.먼치킨.com').hostname.toLowerCase(); } catch { /* 아래 */ }
  if (!/^[a-z0-9.-]{3,253}$/.test(host) || !host.endsWith(ALBUM_SUFFIX) || host.slice(0, -ALBUM_SUFFIX.length).includes('.')) return { label, host: '', reason: '이 이름으로는 주소를 만들 수 없어요. 다른 이름을 골라 주세요.' };
  return { label, host, reason: '' };
}
// 주소가 쓰이고 있으면 그 까닭(빈 글 = 쓸 수 있음): 이미 있는 앨범 주소 · 다른 회원이 신청해 확인을 기다리는 주소
async function hostTaken(host: string, member: string) {
  if (await q(db.from('bj_hosts').select('host').eq('host', host).maybeSingle())) return '이미 쓰이고 있는 주소예요. 다른 이름을 골라 주세요.';
  const w: any = await q(db.from('bj_orders').select('member').eq('want_host', host).eq('state', 'pending').neq('member', member).limit(1));
  if (w.length) return '다른 분이 먼저 신청한 주소예요. 다른 이름을 골라 주세요.';
  return '';
}
// 새 추억앨범 신청 값(order newAlbum {label, name}) — album-name 과 같은 검사 + 앨범 이름은 한 줄 2~40자(비우면 '<닉네임> 추억앨범')
async function newAlbumOf(v: unknown, me: any) {
  if (!isObj(v)) throw fail(400, '새 추억앨범의 주소 이름을 정해 주세요.');
  const n = labelOf(v.label);
  if (n.reason) throw fail(400, n.reason);
  const taken = await hostTaken(n.host, me.id);
  if (taken) throw fail(409, taken);
  const name = line(v.name, 200) || `${me.nickname || 'DJ'} 추억앨범`;
  if ([...name].length < 2 || [...name].length > 40) throw fail(400, '앨범 이름은 2~40자로 정해 주세요.');
  // 새 앨범 신청은 한 번에 하나만(입금 확인 때 앨범이 둘 생기지 않게)
  const mine: any = await q(db.from('bj_orders').select('id').eq('member', me.id).eq('state', 'pending').not('want_host', 'is', null).limit(1));
  if (mine.length) throw fail(409, '확인을 기다리는 추억앨범 신청이 있어요. 그 신청을 마치거나 취소한 뒤 다시 해 주세요.');
  return { host: n.host, label: n.label, name };
}
// 대표 주소: www 아닌 것 먼저, 그다음 먼저 넣은 것(bakje album-info 와 같게)
const mainHost = (hosts: any[]) => [...hosts].sort((a, b) => Number(a.host.startsWith('www.')) - Number(b.host.startsWith('www.')) || (a.created || 0) - (b.created || 0))[0]?.host || '';
// 가진 앨범: [{id, name, host(퓨니코드), site, paidUntil, state}]
async function albumsOf(ids: string[]) {
  if (!ids.length) return [];
  const [rows, hosts]: any = await Promise.all([
    q(db.from('bj_albums').select('id,name,state,paid_until').in('id', ids)),
    q(db.from('bj_hosts').select('host,album,created').in('album', ids))]);
  return ids.map((id) => rows.find((r: any) => r.id === id)).filter(Boolean).map((a: any) => {
    const host = mainHost(hosts.filter((h: any) => h.album === a.id));
    return { id: a.id, name: a.name || '', host, site: host ? `https://${host}/` : '', paidUntil: a.paid_until ? Number(a.paid_until) : null, state: a.state };
  });
}

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
// 이용 기간 + 가진 앨범: 추억앨범 기간은 bj_entitlements 와 가진 앨범의 결제 끝나는 날(paid_until) 중 늦은 쪽(운영자가 앨범에 바로 넣은 기간도 보이게)
async function entsFull(member: string) {
  const [ents, albums]: any = await Promise.all([entsOf(member), ownsOf(member).then(albumsOf)]);
  for (const a of albums) if (a.paidUntil && a.paidUntil > (ents.album || 0)) ents.album = a.paidUntil;
  return { ents, albums };
}
// newAlbum: 새 추억앨범 신청이면 {label(주소 이름), name(앨범 이름), host(퓨니코드)} — 확인되면 album 에 새 앨범 번호가 들어간다
const orderOut = (o: any) => ({ id: o.id, plan: o.plan, months: o.months, amount: o.amount, payer: o.payer, album: o.album, state: o.state, created: o.created, sent: o.sent ?? null, done: o.done ?? null, nick: o.nick, until_to: o.until_to ?? null,
  newAlbum: o.want_host ? { label: o.want_label || '', name: o.want_name || '', host: o.want_host } : null });
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

// ── 새 추억앨범 만들기(운영자가 입금을 확인할 때) ──
// 앨범(bj_albums) → 주소(bj_hosts) → 사이트가 읽는 주소 파일(저장소 h/<주소>.json — bakje writeHost 와 같은 모양) → 주인(신청한 계정, bj_album_owners)
//  → 그 계정을 DJ 로 → 신청에 새 앨범 번호 → 그 계정의 먼치킨(봇 프로그램 중 사용 승인된 가장 최근 기기)을 최초 박제판 저절로 올리기에 잇는다(bj_bots).
// 중간에 실패하면 만든 것을 지운다(앨범을 지우면 주소·주인·봇 줄은 함께 지워진다).
async function makeAlbum(o: any, now: number) {
  if (!o.member) throw fail(409, '신청한 회원이 탈퇴했어요. 이 신청은 거절해 주세요.');
  const host = String(o.want_host || '');
  if (await q(db.from('bj_hosts').select('host').eq('host', host).maybeSingle())) throw fail(409, HOST_TAKEN_OPS);
  const name = line(o.want_name, 40) || '추억앨범';
  let id = '';
  for (let i = 0; i < 5 && !id; i++) {
    const cand = 'a' + rid(9);   // ALBUM_RE ^[a-z][a-z0-9-]{1,30}$ 에 맞는 번호
    const { error } = await db.from('bj_albums').insert({ id: cand, name, note: '먼치킨.com 신청 ' + o.id, created: now });
    if (!error) id = cand;
    else if (error.code !== '23505') { console.error(error); throw fail(503, BROKEN); }
  }
  if (!id) throw fail(503, BROKEN);
  let wrote = false;
  try {
    const h = await db.from('bj_hosts').insert({ host, album: id, created: now });
    if (h.error) { if (h.error.code === '23505') throw fail(409, HOST_TAKEN_OPS); console.error(h.error); throw fail(503, BROKEN); }
    const up = await db.storage.from('bakje').upload(`h/${host}.json`, new Blob([JSON.stringify({ album: id, name })], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '60' });
    if (up.error) { console.error('host', up.error.message); throw fail(503, BROKEN); }
    wrote = true;
    await q(db.from('bj_album_owners').upsert({ album: id, member: o.member, created: now }));
    await q(db.from('bj_members').update({ role: 'dj' }).eq('id', o.member));
    await q(db.from('bj_orders').update({ album: id }).eq('id', o.id));
    const devs: any[] = await q(db.from('bj_member_devices').select('device,seen').eq('member', o.member).eq('program', 'bot').order('seen', { ascending: false }).limit(20));
    if (devs.length) {
      const ok: any[] = await q(db.from('junlive_devices').select('id,nickname,tag').in('id', devs.map((d) => d.device)).eq('state', 'approved'));
      const pick = devs.map((d) => ok.find((x) => x.id === d.device)).find(Boolean);
      if (pick) await q(db.from('bj_bots').upsert({ id: pick.id, album: id, label: [pick.nickname, pick.tag && '@' + pick.tag].filter(Boolean).join(' ').slice(0, 40), created: now }));
    }
    return id;
  } catch (e) {
    try {
      if (wrote) { const rm = await db.storage.from('bakje').remove([`h/${host}.json`]); if (rm.error) console.error('주소 파일 지우기', rm.error.message); }
      const del = await db.from('bj_albums').delete().eq('id', id);
      if (del.error) console.error('앨범 지우기', del.error);
    } catch (x) { console.error(x); }
    throw e;
  }
}

async function handle(req: Request, now: number) {
  const raw = await req.text();
  if (raw.length > 4096) throw fail(413, '보낸 내용이 너무 커요.');
  let b: any; try { b = JSON.parse(raw); } catch { throw fail(400, '요청 모양이 올바르지 않아요.'); }
  if (!isObj(b) || typeof b.action !== 'string') throw fail(400, '요청 모양이 올바르지 않아요.');
  const me = await needMember(req, now);
  switch (b.action) {
    // 내 이용권 화면: 계좌·가격·지금 이용 기간·내 신청 · 가진 앨범(albums, v4)
    case 'info': {
      const [c, full, orders]: any = await Promise.all([cfg(), entsFull(me.id),
        q(db.from('bj_orders').select('*').eq('member', me.id).order('created', { ascending: false }).limit(20))]);
      const { ents, albums } = full, owns = albums.map((a: any) => a.id);
      const addons = await addonsOf(c, me.id, ents, now);
      return { ok: true, open: open(c), bank: open(c) ? { bank: c.bank, number: c.number, holder: c.holder } : null, prices: c.prices, year: { munchkin: yearOf(c, 'munchkin'), album: yearOf(c, 'album'), bundle: yearOf(c, 'bundle') }, months: MONTHS, addons, ents, owns, albums, orders: orders.map(orderOut), admin: me.is_admin === true };
    }
    // 새 추억앨범 주소 이름 확인(쓰는 대로 바로) → {label, host, free, reason?}
    case 'album-name': {
      if (!await hit('bjan:' + me.id, 3600, 300)) throw fail(429, '너무 자주 확인했어요. 조금 뒤에 다시 해 주세요.');
      const n = labelOf(b.label);
      if (n.reason) return { ok: true, label: n.label, host: n.host, free: false, reason: n.reason };
      const taken = await hostTaken(n.host, me.id);
      return { ok: true, label: n.label, host: n.host, free: !taken, ...(taken ? { reason: taken } : {}) };
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
        const quote = (await addonsOf(c, me.id, (await entsFull(me.id)).ents, now))[plan];
        if (!quote) throw fail(400, `지금은 ${PLANS[plan].name}를 할 수 없어요. 일반 이용권으로 신청해 주세요.`);
        amount = quote.amount; untilTo = quote.until;
      }
      let album: string | null = null, want: { host: string; label: string; name: string } | null = null;
      if (PLANS[plan].products.includes('album')) {
        const owns = await ownsOf(me.id);
        if (!owns.length) want = await newAlbumOf(b.newAlbum, me);   // 앨범이 아직 없는 DJ — 새 추억앨범 신청(v4)
        else {
          album = typeof b.album === 'string' && owns.includes(b.album) ? b.album : owns.length === 1 ? owns[0] : null;
          if (!album) throw fail(400, '연장할 추억앨범을 골라 주세요.');
        }
      }
      if (!await hit('bjod:' + me.id, 3600, 10)) throw fail(429, '신청을 너무 자주 했어요. 조금 뒤에 다시 해 주세요.');
      const waiting: any = await q(db.from('bj_orders').select('id').eq('member', me.id).eq('state', 'pending'));
      if (waiting.length >= 3) throw fail(409, '확인을 기다리는 신청이 있어요. 그 신청을 마치거나 취소한 뒤 다시 해 주세요.');
      const payer = ((me.nickname || 'DJ').replace(/\s+/g, '').slice(0, 6)) + digits4();
      const row = { id: 'o' + rid(11), member: me.id, nick: me.nickname || '', plan, months, amount, payer, album, created: now, until_to: untilTo,
        want_host: want?.host ?? null, want_label: want?.label ?? null, want_name: want?.name ?? null };
      await q(db.from('bj_orders').insert(row));
      return { ok: true, order: orderOut({ ...row, state: 'pending' }), bank: { bank: c.bank, number: c.number, holder: c.holder } };
    }
    // "입금했어요" — 운영자에게 알림
    case 'sent': {
      const r: any = await q(db.from('bj_orders').update({ sent: now }).eq('id', String(b.id || '')).eq('member', me.id).eq('state', 'pending').select('*'));
      const o = r?.[0];
      if (!o) throw fail(404, '신청을 찾을 수 없어요.');
      const fresh = o.want_host ? `\n📚 새 추억앨범 · ${o.want_label}.먼치킨.com` : '';
      await notifyOps(`💸 입금했어요\n${o.nick || '(닉네임 없음)'} · ${PLANS[o.plan].name} ${periodText(o)}${fresh}\n금액 ${won(o.amount)} · 입금자명 ${o.payer}\n운영자 앱에서 확인해 주세요.`,
        `💸 ${won(o.amount)} 입금했어요`, `${o.payer} · ${PLANS[o.plan].name} ${periodText(o)}${fresh}\n토스뱅크에서 들어왔는지 보고 확인해 주세요.`);
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
      // 새 추억앨범 신청: 상태를 먼저 paid 로 바꿔 두 번 확인을 막은 뒤 앨범을 만든다 — 만들다 실패하면 다시 기다림으로 되돌린다
      if (o.want_host && !o.album) {
        try { o.album = await makeAlbum(o, now); }
        catch (e) {
          const { error } = await db.from('bj_orders').update({ state: 'pending', done: null }).eq('id', o.id).eq('state', 'paid');
          if (error) console.error('되돌리기', error);
          throw e;
        }
      }
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
    if (req.method === 'GET' && route === 'health') return json(200, { ok: true, v: 4, year: true, addon: true, push: true, newAlbum: true });
    if (req.method === 'POST' && (route === '' || route === 'api')) return json(200, await handle(req, Date.now()));
    return json(404, { ok: false, error: '찾을 수 없어요.' });
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { ok: false, error: e.message });
    console.error(e);
    return json(500, { ok: false, error: BROKEN });
  }
});
