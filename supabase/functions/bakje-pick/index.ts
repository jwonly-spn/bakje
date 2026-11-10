// 추억앨범 실시간 뽑기판 — Supabase Edge Function "bakje-pick" (verify_jwt false, 2026-11-10)
// 먼치킨(봇 프로그램)의 뽑기판이 판이 바뀔 때마다(시작·칸 열림·끝·지움 — 봇이 1.5초 모아서) 보낸다.
// 큰 함수 bakje 를 다시 올리지 않으려고 따로 뗐다(bakje-social 처럼). bakje 는 그대로.
//  POST (몸 = 기기 서명 요청 {action:'pick-live', payload, publicKey, timestamp, nonce, signature})
//   서명 머리말 JUN-LIVE-BAKJE/1 — bakje 의 POST bot 과 같은 확인을 그대로 옮겼다:
//   먼치킨 승인 기기 키(junlive_devices approved) + 추억앨범 봇 목록(bj_bots)에 있는 기기 → 그 앨범 · 한 번 쓴 서명은 다시 못 쓴다(junlive_access_nonces 'bj:').
//   기기마다 1분 40번(fp_hit 'bjpk:'). 판의 비밀 자리(layout)는 받지도 쓰지도 않는다 — 열린 칸 결과만.
//   → 공개 버킷 bakje 의 snap/<앨범>/pick.json 을 새로 쓴다(서버가 updatedAt 을 넣는다, cacheControl 2초). state 'off' 면 그 파일을 지운다.
//   보기만 앨범(readonly·결제 끝남)에는 실시간 판을 두지 않는다(있던 파일도 지우고 403).
//  GET health → {ok, v:1}
// 사이트(docs/app.js)는 pick.json 을 받아 프로필 아래·탭 위에 "지금 뽑기판" 카드를 그린다(LIVE 3초마다, 끝난 판·없을 때 1분마다).
// 표·한도는 bakje 와 같은 것(fp_hit·junlive_access_nonces·junlive_devices·bj_bots·bj_albums) — 새 표 없음.
// 시험: tests/bakje-pick.test.mjs 가 아래 "시험이 따로 읽는 곳"만 잘라 가짜 DB 로 돌린다(그 사이에는 Deno·바깥 모듈을 쓰지 않는다).
// 주의: MCP 로 올릴 때 백슬래시-u 글자 표기가 풀려 버리므로 이 파일에는 그런 표기를 쓰지 않는다.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ==== 시험이 따로 읽는 곳 시작 ====
const VERSION = 1, BUCKET = 'bakje', BOT_PREFIX = 'JUN-LIVE-BAKJE/1', ACTION = 'pick-live';
const ALBUM_RE = /^[a-z][a-z0-9-]{1,30}$/, NONCE = /^[-_A-Za-z0-9]{32}$/;
const BOARD_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;   // 봇의 판 번호(모양은 봇이 정한다 — 주소에 쓰지 않으니 넉넉히)
const STATES = new Set(['live', 'done', 'off']);
const MIN_CELLS = 9, MAX_CELLS = 100, MAX_PRIZES = 30;
const RATE_PER_MIN = 40, MAX_BODY = 32768;
const BROKEN = '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.';
const READONLY = '이 앨범은 지금 보기만 할 수 있어요. 운영자에게 문의해 주세요.';
const enc = new TextEncoder();
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
  'Access-Control-Max-Age': '86400'
};
class Fail extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const fail = (status: number, message: string) => new Fail(status, message);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256hex = async (s: string | Uint8Array) => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s));
const decode64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const isInt = (v: unknown, lo: number, hi: number): v is number => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= hi;

// 글: 제어 문자는 빼고, 한 줄로(줄바꿈은 빈칸), 앞뒤 빈칸 뺌 — 글자 수는 보이는 글자(코드 포인트)로 센다
function line(v: unknown, max: number, what: string) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw fail(400, what + ' 모양이 올바르지 않아요.');
  const s = [...v.replace(/\r\n?|\n/g, ' ')].filter((ch) => { const c = ch.charCodeAt(0); return c >= 32 && c !== 127; }).join('').trim();
  if ([...s].length > max) throw fail(400, `${what}은(는) ${max}자까지 쓸 수 있어요.`);
  return s;
}
function need(v: unknown, max: number, what: string) {
  const s = line(v, max, what);
  if (!s) throw fail(400, `${what}이(가) 비어 있어요.`);
  return s;
}
function timeOf(v: unknown, what: string) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 8.64e15) throw fail(400, `${what} 모양이 올바르지 않아요.`);
  return Math.round(v);
}

// 봇이 보낸 판(약속 문서 2절 모양) → 사이트가 읽는 모양. 모르는 칸(비밀 자리 layout 등)은 버린다.
//  {v:1, id, title(1~20), cells(9~100), blank(1~8), state:'live'|'done'|'off', startedAt, endedAt|null,
//   prizes:[{name(1~20), count(1~), left(0~count)}] (30개까지, count 합 ≤ cells),
//   opened:[{n(1~cells, 겹침 없음), prize(1~20 | null = 꽝), name?(40자)}] (cells 개까지)}
function checkPick(p: unknown) {
  if (!isObj(p) || p.v !== 1) throw fail(400, '뽑기판 모양이 올바르지 않아요. 먼치킨을 업데이트해 주세요.');
  if (typeof p.state !== 'string' || !STATES.has(p.state)) throw fail(400, '뽑기판 상태가 올바르지 않아요.');
  if (p.id !== undefined && p.id !== null && (typeof p.id !== 'string' || !BOARD_ID.test(p.id))) throw fail(400, '뽑기판 번호가 올바르지 않아요.');
  if (p.state === 'off') return { state: 'off' as const };
  if (typeof p.id !== 'string') throw fail(400, '뽑기판 번호가 올바르지 않아요.');
  const title = need(p.title, 20, '판 이름');
  if (!isInt(p.cells, MIN_CELLS, MAX_CELLS)) throw fail(400, `칸 수는 ${MIN_CELLS}칸부터 ${MAX_CELLS}칸까지예요.`);
  const cells = p.cells;
  const blank = need(p.blank, 8, '꽝 글자');
  const startedAt = timeOf(p.startedAt, '시작 시각'), endedAt = timeOf(p.endedAt, '끝난 시각');
  if (!Array.isArray(p.prizes) || p.prizes.length > MAX_PRIZES) throw fail(400, `상품은 ${MAX_PRIZES}개까지예요.`);
  let total = 0;
  const prizes = p.prizes.map((x: unknown) => {
    if (!isObj(x)) throw fail(400, '상품 모양이 올바르지 않아요.');
    const name = need(x.name, 20, '상품 이름');
    if (!isInt(x.count, 1, MAX_CELLS)) throw fail(400, '상품 칸 수가 올바르지 않아요.');
    if (!isInt(x.left, 0, x.count)) throw fail(400, '남은 상품 수가 올바르지 않아요.');
    total += x.count;
    return { name, count: x.count, left: x.left };
  });
  if (total > cells) throw fail(400, '상품 칸 수를 모두 더하면 판의 칸 수보다 많아요.');
  if (!Array.isArray(p.opened) || p.opened.length > cells) throw fail(400, '열린 칸 목록이 올바르지 않아요.');
  const seen = new Set<number>();
  const opened = p.opened.map((x: unknown) => {
    if (!isObj(x) || !isInt(x.n, 1, cells)) throw fail(400, '열린 칸 번호가 올바르지 않아요.');
    if (seen.has(x.n)) throw fail(400, '같은 칸이 두 번 열렸어요.');
    seen.add(x.n);
    const prize = line(x.prize, 20, '열린 칸 상품') || null;   // null·빈 글자 = 꽝
    const name = line(x.name, 40, '연 사람 닉네임');
    return { n: x.n, prize, ...(name ? { name } : {}) };
  });
  return { v: 1, id: p.id, title, cells, blank, state: p.state as 'live' | 'done', startedAt, endedAt, prizes, opened };
}

// 서명 확인(bakje 의 verify 와 같은 모양 — 머리말·action 만 이 함수 것). 맞으면 기기 번호(공개 키 sha256 hex)
async function verifySigned(b: unknown) {
  if (!isObj(b) || b.action !== ACTION || !Number.isSafeInteger(b.timestamp)
    || typeof b.nonce !== 'string' || !NONCE.test(b.nonce) || typeof b.publicKey !== 'string' || !/^[-_A-Za-z0-9]{122}$/.test(b.publicKey)
    || typeof b.signature !== 'string' || !/^[-_A-Za-z0-9]{86}$/.test(b.signature)) return null;
  const msg = `${BOT_PREFIX}\n${b.action}\n${b.timestamp}\n${b.nonce}\n${b.publicKey}\n${await sha256hex(JSON.stringify(b.payload ?? null))}`;
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('spki', decode64url(b.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode64url(b.signature), enc.encode(msg));
  } catch { /* 이상한 키 */ }
  return ok ? await sha256hex(decode64url(b.publicKey)) : '';
}

// db = supabase-js 손님(service_role) — 시험은 같은 모양의 가짜를 넣는다
function makeHandler(db: any, clock: () => number = Date.now) {
  async function q<T = any>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
    const { data, error } = await p;
    if (error) { console.error(error); throw fail(503, BROKEN); }
    return data;
  }
  const hit = async (key: string, seconds: number, max: number) => Boolean(await q(db.rpc('fp_hit', { p_key: key, p_seconds: seconds, p_max: max })));
  const storage = () => db.storage.from(BUCKET);
  const albumCache = new Map<string, { at: number; row: any }>();
  async function albumRow(id: string, now: number) {
    const c = albumCache.get(id);
    if (c && now - c.at < 60000) return c.row;
    const row: any = await q(db.from('bj_albums').select('id,name,state,paid_until').eq('id', id).maybeSingle());
    if (row) albumCache.set(id, { at: now, row });
    return row;
  }
  const writable = (a: any) => a.state === 'active' && !(a.paid_until && Number(a.paid_until) < clock());
  async function readJson(req: Request) {
    const len = Number(req.headers.get('content-length') || 0);
    if (len > MAX_BODY) throw fail(413, '보낸 내용이 너무 커요.');
    const raw = await req.text();
    if (raw.length > MAX_BODY) throw fail(413, '보낸 내용이 너무 커요.');
    try { return JSON.parse(raw); } catch { throw fail(400, '요청 모양이 올바르지 않아요.'); }
  }
  async function verify(b: any, now: number) {
    if (!isObj(b) || b.action !== ACTION) throw fail(400, '모르는 요청이에요.');
    if (!Number.isSafeInteger(b.timestamp) || Math.abs(now - b.timestamp) > 10 * 60000) throw fail(400, '요청이 만료되었거나 올바르지 않아요. 기기 시간을 확인해 주세요.');
    const id = await verifySigned(b);
    if (id === null) throw fail(400, '요청이 만료되었거나 올바르지 않아요. 기기 시간을 확인해 주세요.');
    if (!id) throw fail(403, '기기 확인에 실패했어요.');
    const { error } = await db.from('junlive_access_nonces').insert({ id: 'bj:' + b.nonce, expires: now + 20 * 60000 });
    if (error) {
      if (error.code === '23505') throw fail(409, '같은 요청이 두 번 왔어요. 다시 해 주세요.');
      console.error(error); throw fail(503, BROKEN);
    }
    return id;
  }
  async function removePick(path: string) {
    const { error } = await storage().remove([path]);
    if (error) { console.error('pick remove', error.message); throw fail(503, BROKEN); }
  }
  async function pickLive(req: Request, now: number) {
    const body = await readJson(req);
    const id = await verify(body, now);
    const [dev, allow]: any = await Promise.all([
      q(db.from('junlive_devices').select('state').eq('id', id).maybeSingle()),
      q(db.from('bj_bots').select('id,album').eq('id', id).maybeSingle())
    ]);
    if (dev?.state !== 'approved' || !allow) throw fail(403, '추억앨범에 올릴 수 있는 먼치킨이 아니에요.');
    if (!await hit('bjpk:' + id, 60, RATE_PER_MIN)) throw fail(429, '너무 자주 보냈어요. 조금 뒤에 다시 보내요.');
    const pick = checkPick(body.payload);
    const A = allow.album;
    if (typeof A !== 'string' || !ALBUM_RE.test(A)) { console.error('pick album', A); throw fail(503, BROKEN); }
    const path = `snap/${A}/pick.json`;
    if (pick.state === 'off') { await removePick(path); return { ok: true }; }
    const album = await albumRow(A, now);
    if (!album) throw fail(403, '추억앨범에 올릴 수 있는 먼치킨이 아니에요.');
    if (!writable(album)) { await removePick(path); throw fail(403, READONLY); }
    const blob = new Blob([JSON.stringify({ ...pick, updatedAt: now })], { type: 'application/json' });
    const { error } = await storage().upload(path, blob, { upsert: true, contentType: 'application/json', cacheControl: '2' });
    if (error) { console.error('pick upload', error.message); throw fail(503, BROKEN); }
    return { ok: true };
  }
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const route = new URL(req.url).pathname.replace(/^.*?\/bakje-pick\/?/, '').replace(/\/+$/, '');
    try {
      if (req.method === 'GET' && (route === 'health' || route === '')) return json(200, { ok: true, v: VERSION, pick: true });
      if (req.method === 'POST' && (route === '' || route === ACTION)) return json(200, await pickLive(req, clock()));
      return json(404, { ok: false, error: '찾을 수 없어요.' });
    } catch (e) {
      if (e instanceof Fail) return json(e.status, { ok: false, error: e.message });
      console.error(e);
      return json(500, { ok: false, error: BROKEN });
    }
  };
}
// ==== 시험이 따로 읽는 곳 끝 ====

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
Deno.serve(makeHandler(db));
