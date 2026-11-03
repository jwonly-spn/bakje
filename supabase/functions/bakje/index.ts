// 박제관 — Supabase Edge Function "bakje" (verify_jwt false).
// 보는 사람은 로그인하지 않는다(목록은 공개 버킷의 snap/feed.json, 하트만 이 함수로).
// 글쓰기는 "주인 기기"만: 브라우저가 만든 P-256 열쇠로 서명(BAKJE/1). 처음 등록은 등록 코드로.
// 표·버킷: supabase/schema.sql (bj_devices·bj_posts·bj_hearts·bj_meta, 버킷 bakje).
// 최초 박제판(2026-11-03): 글 종류 first(1:1). 먼치킨 봇(개인용)의 최초 박제판이 저절로 올라온다 — POST bot, 머리말 JUN-LIVE-BAKJE/1,
//  서명 열쇠 = 먼치킨의 승인 기기 키(junlive_devices approved) + 추억앨범 봇 목록(bj_bots)에 있는 기기만. 판마다 글 하나(src), 이름이 더 채워지면 사진만 바꾼다.
//  주인이 그 글을 지우면 bj_bot_gone 에 남겨 다시 만들지 않는다(봇이 again:true 로 부를 때만 다시).
// 후원자 닉네임·스푼 테마(2026-11-03, v3): 글마다 donor·theme 한 줄씩(주인이 적음) — donor 는 사진 왼쪽 위와 글 칸, theme 은 글 칸에 보인다.
// 종료 날짜(v4): 최초 박제판마다 ends(YYYY-MM-DD) — 사이트가 오늘과 견줘 "D-5"·"오늘 종료"·"종료됨"을 보여 준다.
//  먼치킨이 올린 판은 봇의 최초 박제판 화면에서 정한다(board-save·board-meta), 손으로 올린 최초 박제판은 사이트 글쓰기에서.
// 앨범 여러 개(v5, 2026-11-04): DJ마다 따로 떨어진 앨범(bj_albums). 사이트는 주소(호스트)로 앨범을 고른다 — 공개 버킷 h/<호스트>.json(없으면 GET host 가 만든다).
//  목록은 snap/<앨범>/feed.json(한이준 앨범은 예전 snap/feed.json 도 함께 — 예전 판 사이트용). 모든 앨범을 모아 보는 곳은 없다.
//  주인 기기·등록 코드·프로필·방문자 수·먼치킨 봇(bj_bots.album)은 앨범마다. readonly 앨범은 보기만(글쓰기·봇 올리기 막힘).
//  운영자(POST admin, 머리말 x-junlive-admin = 사용 승인 관리자 키)가 앨범을 만들고 주소·등록 코드·봇 기기를 정한다.
//  예전 판 사이트·봇(앨범을 안 보냄)은 한이준 앨범(LEGACY)으로 본다.
// 회원·본인인증·댓글(v7, 2026-11-04): 한 계정을 모든 앨범에서. 로그인 = 아이디·비밀번호 또는 카카오(GET kakao-start → kakao → #bjlogin=<표>).
//  본인인증은 가입 때 한 번(포트원 V2 · 다날) — 같은 사람 값(DI)의 소금 해시만 남기고 이름·전화번호·생년월일은 버린다(만 14세 이상인지만 본다).
//  댓글은 본인인증 + 닉네임 있는 회원만. 앨범 주인은 지우기·차단·댓글 받기 끄기, 운영자는 쫓아내기(그 사람은 새 계정도 인증이 안 된다).
//  회원 세션은 머리말 x-bj-session(원문은 저장하지 않고 sha256 만). 서버 비밀 값: KAKAO_REST_KEY·KAKAO_CLIENT_SECRET·PORTONE_API_SECRET·PORTONE_STORE_ID·PORTONE_CHANNEL_KEY.
// 주의: MCP 로 올릴 때 백슬래시-u 글자 표기가 풀려 버리므로 이 파일에는 그런 표기를 쓰지 않는다.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const VERSION = 7, BUCKET = 'bakje', PREFIX = 'BAKJE/1', BOT_PREFIX = 'JUN-LIVE-BAKJE/1';
const LEGACY = 'hanijun', ALBUM_RE = /^[a-z][a-z0-9-]{1,30}$/, HOST_RE = /^[a-z0-9.-]{3,253}$/;
const READONLY = '이 앨범은 지금 보기만 할 수 있어요. 운영자에게 문의해 주세요.';
const KINDS = ['board', 'first', 'letter'];
const BOT_ACTIONS = new Set(['board-begin', 'board-save', 'board-meta', 'album-info']);
const BOARD_REF = /^[a-z0-9][a-z0-9-]{0,47}$/; // 먼치킨 판 번호(+ "-g<몇 번째 글>")
const BROKEN = '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.';
const MAX_PHOTOS = 10, MAX_DEVICES = 10;
const PAPERS = ['cream', 'rose', 'sky', 'lilac', 'mint'];
const ACTIONS = new Set(['register', 'me', 'devices', 'revoke', 'newcode', 'upload', 'post', 'edit', 'pin', 'delete', 'profile',
  'comment-delete', 'member-block', 'member-unblock', 'blocks', 'comments-set', 'reports']);
const ID = /^[a-z2-9]{10}$/, NONCE = /^[-_A-Za-z0-9]{32}$/;
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32글자
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 I·L·O·0·1 뺌
const KST = 9 * 3600000;
const enc = new TextEncoder();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-junlive-admin, x-bj-session',
  'Access-Control-Max-Age': '86400'
};
class Fail extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string) => new Fail(status, message);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

async function q<T = any>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) { console.error(error); throw fail(503, BROKEN); }
  return data;
}

// ---- 작은 도구 ----
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256hex = async (s: string | Uint8Array) => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s));
const decode64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rid = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => ALPHA[x & 31]).join('');
function newCode() {
  let out = '';
  while (out.length < 8) for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < 248 && out.length < 8) out += CODE_ALPHA[b % 31];
  return out;
}
const normCode = (v: unknown) => typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
// 글: 줄바꿈은 남기고 그 밖의 제어 문자는 뺀다
function text(v: unknown, max: number, what: string) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw fail(400, what + ' 모양이 올바르지 않아요.');
  const s = [...v.replace(/\r\n?/g, '\n')].filter((ch) => { const c = ch.charCodeAt(0); return c === 10 || (c >= 32 && c !== 127); }).join('').trim();
  if ([...s].length > max) throw fail(400, `${what}은(는) ${max}자까지 쓸 수 있어요.`);
  return s;
}
// 후원자 닉네임·스푼 테마 이름: 한 줄, 40자까지(줄바꿈은 빈칸으로)
const lineOf = (v: unknown, what: string) => text(v, 40, what).replace(/\s*\n\s*/g, ' ');
const kstDay = (t: number) => new Date(t + KST).toISOString().slice(0, 10);
function atOf(day: unknown, now: number, keep?: number) {
  if (day === undefined || day === null || day === '') return keep ?? now;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw fail(400, '날짜 모양이 올바르지 않아요.');
  if (keep !== undefined && kstDay(keep) === day) return keep;      // 날짜를 그대로 두면 시각도 그대로
  if (day === kstDay(now)) return now;
  const t = Date.parse(`${day}T12:00:00+09:00`);
  if (!Number.isFinite(t) || t < Date.parse('2015-01-01T00:00:00+09:00') || t > now + 86400000) throw fail(400, '날짜를 다시 골라 주세요.');
  return t;
}
// 종료 날짜(최초 박제판 — 그 시즌 스푼이 끝나는 날, 한국 날짜 YYYY-MM-DD). 비우면 ''. 최초 박제판이 아니면 늘 ''.
function endsOf(v: unknown, kind: string) {
  if (kind !== 'first' || v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(`${v}T00:00:00+09:00`))) throw fail(400, '종료 날짜 모양이 올바르지 않아요.');
  if (v < '2015-01-01' || v > '2100-12-31') throw fail(400, '종료 날짜를 다시 골라 주세요.');
  return v;
}

let saltPromise: Promise<string> | null = null;
const salt = () => (saltPromise ||= q(db.from('junlive_secrets').select('value').eq('key', 'ip_salt').maybeSingle())
  .then((r: any) => { if (!r?.value) throw fail(503, BROKEN); return r.value as string; })
  .catch((e) => { saltPromise = null; throw e; }));
const ipOf = (req: Request) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
const ipHash = async (req: Request) => (await sha256hex((await salt()) + ':ip:' + ipOf(req))).slice(0, 32);
const hit = async (key: string, seconds: number, max: number) => Boolean(await q(db.rpc('fp_hit', { p_key: key, p_seconds: seconds, p_max: max })));
const getMeta = async (album: string, key: string) => ((await q(db.from('bj_meta').select('value').eq('album', album).eq('key', key).maybeSingle())) as any)?.value ?? null;
const setMeta = (album: string, key: string, value: unknown) => q(db.from('bj_meta').upsert({ album, key, value }, { onConflict: 'album,key' }));

// ---- 앨범 ----
const albumCache = new Map<string, { at: number; row: any }>();
async function albumRow(id: unknown, now: number, fresh = false) {
  if (typeof id !== 'string' || !ALBUM_RE.test(id)) throw fail(400, '앨범이 올바르지 않아요.');
  const c = albumCache.get(id);
  if (!fresh && c && now - c.at < 60000) return c.row;
  const row: any = await q(db.from('bj_albums').select('id,name,state').eq('id', id).maybeSingle());
  if (!row) throw fail(404, '없는 앨범이에요.');
  albumCache.set(id, { at: now, row });
  return row;
}
const writable = (a: any) => { if (a.state !== 'active') throw fail(403, READONLY); };
// 주소: 한글 주소도 퓨니코드 소문자로(new URL 이 바꿔 준다)
function hostOf(v: unknown) {
  if (typeof v !== 'string' || !v.trim() || v.length > 253) throw fail(400, '주소가 올바르지 않아요.');
  let host = '';
  try { host = new URL('https://' + v.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '')).hostname.toLowerCase(); } catch { /* 아래 */ }
  if (!HOST_RE.test(host) || !host.includes('.')) throw fail(400, '주소가 올바르지 않아요.');
  return host;
}
// 사이트가 읽는 주소 → 앨범 파일(h/<주소>.json)
async function writeHost(host: string, album: any) {
  const { error } = await storage().upload(`h/${host}.json`, new Blob([JSON.stringify({ album: album.id, name: album.name || '' })], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '60' });
  if (error) console.error('host', error.message);
}

async function readJson(req: Request, max: number) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max) throw fail(413, '보낸 내용이 너무 커요.');
  const raw = await req.text();
  if (raw.length > max) throw fail(413, '보낸 내용이 너무 커요.');
  try { return JSON.parse(raw); } catch { throw fail(400, '요청 모양이 올바르지 않아요.'); }
}

// ---- 서명 ----
// 주인 기기(브라우저, BAKJE/1) · 먼치킨 봇(JUN-LIVE-BAKJE/1 — 먼치킨 승인 기기 키). 머리말이 달라 서로의 서명을 쓸 수 없다.
async function verify(b: unknown, now: number, prefix = PREFIX, actions = ACTIONS) {
  if (!isObj(b) || typeof b.action !== 'string' || !actions.has(b.action) || !Number.isSafeInteger(b.timestamp) || Math.abs(now - b.timestamp) > 10 * 60000
    || typeof b.nonce !== 'string' || !NONCE.test(b.nonce) || typeof b.publicKey !== 'string' || !/^[-_A-Za-z0-9]{122}$/.test(b.publicKey)
    || typeof b.signature !== 'string' || !/^[-_A-Za-z0-9]{86}$/.test(b.signature)) throw fail(400, '요청이 만료되었거나 올바르지 않아요. 기기 시간을 확인해 주세요.');
  const msg = `${prefix}\n${b.action}\n${b.timestamp}\n${b.nonce}\n${b.publicKey}\n${await sha256hex(JSON.stringify(b.payload ?? null))}`;
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('spki', decode64url(b.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode64url(b.signature), enc.encode(msg));
  } catch { /* 이상한 키 */ }
  if (!ok) throw fail(403, '기기 확인에 실패했어요.');
  const { error } = await db.from('junlive_access_nonces').insert({ id: 'bj:' + b.nonce, expires: now + 20 * 60000 });
  if (error) {
    if (error.code === '23505') throw fail(409, '같은 요청이 두 번 왔어요. 다시 해 주세요.');
    console.error(error); throw fail(503, BROKEN);
  }
  return await sha256hex(decode64url(b.publicKey));
}

// ---- 저장소 ----
const storage = () => db.storage.from(BUCKET);
async function listFolder(folder: string) {
  const { data, error } = await storage().list(folder, { limit: 1000 });
  if (error) { console.error(error); throw fail(503, BROKEN); }
  return new Set((data || []).filter((f: any) => f.id).map((f: any) => `${folder}/${f.name}`));
}
async function removeFiles(paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await storage().remove(paths.slice(i, i + 100));
    if (error) console.error('remove', error.message);
  }
}
async function signedUpload(path: string) {
  const { data, error } = await storage().createSignedUploadUrl(path);
  if (error || !data?.token) { console.error(error); throw fail(503, BROKEN); }
  return { path, token: data.token };
}

// ---- 미리 만든 목록(snap/feed.json) ----
const profileOut = (p: any) => ({ name: p?.name || '', bio: p?.bio || '', link: p?.link || '', avatar: p?.avatar || '' });
async function buildSnap(album: string, now: number) {
  const [posts, profile, a, cmts] = await Promise.all([
    q(db.from('bj_posts').select('id,kind,caption,letter,photos,at,pinned,hearts,extra,donor,theme,ends').eq('album', album).order('pinned', { ascending: false }).order('at', { ascending: false }).order('created', { ascending: false }).limit(3000)),
    getMeta(album, 'profile'),
    albumRow(album, now, true),
    q(db.from('bj_comments').select('post').eq('album', album).eq('state', 'visible').limit(50000))
  ]);
  // 글마다 댓글 수(cc — 있을 때만)
  const cc = new Map<string, number>();
  for (const c of cmts as any[]) cc.set(c.post, (cc.get(c.post) || 0) + 1);
  // extra: 먼치킨이 올린 최초 박제판의 판 이름·채운 칸 수({title, filled, total, bot}) — 그 밖의 글은 빼서 작게
  // donor·theme·ends: 주인이 적은 후원자 닉네임·스푼 테마 이름·종료 날짜 — 없으면 뺀다
  const out = (posts as any[]).map(({ extra, donor, theme, ends, ...p }) => ({
    ...p, ...(donor ? { donor } : {}), ...(theme ? { theme } : {}), ...(ends ? { ends } : {}), ...(cc.get(p.id) ? { cc: cc.get(p.id) } : {}),
    ...(isObj(extra) ? { extra: { title: extra.title || '', filled: extra.filled || 0, total: extra.total || 0, bot: extra.bot === true } } : {})
  }));
  const snap = { v: VERSION, snapAt: now, album: { id: album, name: a.name || '', state: a.state }, profile: profileOut(profile), posts: out };
  const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
  for (const path of [`snap/${album}/feed.json`, ...(album === LEGACY ? ['snap/feed.json'] : [])]) {
    const { error } = await storage().upload(path, blob, { upsert: true, contentType: 'application/json', cacheControl: '10' });
    if (error) console.error('snap', path, error.message);
  }
  lastSnap.set(album, now);
  return snap;
}
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const lastSnap = new Map<string, number>(), snapLater = new Map<string, Promise<unknown>>(), snapAgain = new Set<string>();
// 하트가 몰려도 앨범마다 3초에 한 번만 다시 쓴다. 쓰는 중에 또 바뀌면 끝난 뒤 한 번 더(예전엔 건너뛰어 댓글 수가 남았다)
function scheduleSnap(album: string) {
  if (snapLater.has(album)) { snapAgain.add(album); return; }
  const wait = Math.max(0, (lastSnap.get(album) || 0) + 3000 - Date.now());
  const p = new Promise((r) => setTimeout(r, wait)).then(() => buildSnap(album, Date.now())).catch((e) => console.error(e))
    .finally(() => { snapLater.delete(album); if (snapAgain.delete(album)) scheduleSnap(album); });
  snapLater.set(album, p);
  try { EdgeRuntime?.waitUntil(p); } catch { /* local */ }
}

// ---- 글 모양 확인 ----
function photosOf(list: unknown, post: string, exists: Set<string>) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > MAX_PHOTOS) throw fail(400, `사진은 ${MAX_PHOTOS}장까지 올릴 수 있어요.`);
  const re = new RegExp(`^p/${post}/[a-z2-9]{8}\\.jpg$`);
  const seen = new Set<string>();
  return list.map((p) => {
    if (!isObj(p) || typeof p.f !== 'string' || !re.test(p.f) || seen.has(p.f)) throw fail(400, '사진 정보가 올바르지 않아요.');
    seen.add(p.f);
    const t = p.f.replace(/\.jpg$/, '-t.jpg');
    const w = Number(p.w), h = Number(p.h);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 10000 || h > 10000) throw fail(400, '사진 크기 정보가 올바르지 않아요.');
    if (!exists.has(p.f) || !exists.has(t)) throw fail(400, '사진이 아직 다 올라가지 않았어요. 다시 해 주세요.');
    return { f: p.f, t, w, h };
  });
}
function letterOf(v: unknown) {
  if (!isObj(v)) return null;
  const out = { to: text(v.to, 40, '받는 사람'), text: text(v.text, 5000, '편지'), from: text(v.from, 40, '보낸 사람'), paper: PAPERS.includes(v.paper) ? v.paper : 'cream' };
  return out.to || out.text || out.from ? out : null;
}
function checkPost(kind: unknown, photos: any[], letter: any) {
  if (typeof kind !== 'string' || !KINDS.includes(kind)) throw fail(400, '글 종류를 골라 주세요.');
  if (kind !== 'letter' && !photos.length) throw fail(400, '박제판 사진을 한 장 이상 골라 주세요.');
  if (kind === 'letter' && !photos.length && !letter?.text) throw fail(400, '편지 내용을 쓰거나 사진을 골라 주세요.');
}

// ---- 주인 요청 ----
async function owner(req: Request, now: number) {
  const body = await readJson(req, 65536);
  const id = await verify(body, now);
  const p = isObj(body.payload) ? body.payload : {};
  const dev: any = await q(db.from('bj_devices').select('id,state,label,created,seen,album').eq('id', id).maybeSingle());
  // 사이트가 보낸 앨범(예전 판은 안 보냄 → 한이준 앨범). 다른 앨범의 주인 기기는 이 앨범에선 주인이 아니다.
  const asked = p.album === undefined ? LEGACY : p.album;

  if (body.action === 'me') {
    const mine = dev && dev.album === asked;
    return { ok: true, state: mine ? dev.state : 'none', label: mine ? dev.label : '' };
  }
  if (body.action === 'register') {
    const album = await albumRow(asked, now);
    if (dev?.state === 'approved') {
      if (dev.album !== album.id) throw fail(409, '이 기기는 다른 앨범의 주인 기기예요.');
      return { ok: true, state: 'approved' };
    }
    const ip = await ipHash(req);
    if (!await hit('bjc:' + ip, 3600, 10)) throw fail(429, '여러 번 틀렸어요. 1시간 뒤에 다시 해 주세요.');
    const code = normCode(p.code);
    if (code.length !== 8) throw fail(400, '등록 코드 8자리를 넣어 주세요.');
    const c = await getMeta(album.id, 'owner_code');
    if (!c || c.expires < now || c.uses >= c.max || c.hash !== await sha256hex('bj-code:' + code)) throw fail(403, '등록 코드가 맞지 않거나 시간이 지났어요.');
    const used: any = await q(db.from('bj_meta').update({ value: { ...c, uses: c.uses + 1 } }).eq('album', album.id).eq('key', 'owner_code').eq('value->>uses', String(c.uses)).select('key'));
    if (!used?.length) throw fail(409, '잠깐 겹쳤어요. 다시 해 주세요.');
    const count: any = await q(db.from('bj_devices').select('id').eq('album', album.id).eq('state', 'approved'));
    if (count.length >= MAX_DEVICES) throw fail(400, `주인 기기는 ${MAX_DEVICES}개까지예요. 안 쓰는 기기를 먼저 막아 주세요.`);
    await q(db.from('bj_devices').upsert({ id, public_key: body.publicKey, label: text(p.label, 40, '기기 이름') || '내 기기', state: 'approved', created: dev?.created ?? now, seen: now, album: album.id }));
    return { ok: true, state: 'approved' };
  }
  if (!dev || dev.state !== 'approved' || dev.album !== asked) throw fail(403, '주인 기기로 등록되지 않았어요.');
  const A: string = dev.album;
  const album = await albumRow(A, now);
  if (!await hit('bjo:' + id, 60, 120)) throw fail(429, '너무 빨라요. 잠깐 뒤에 다시 해 주세요.');
  if (now - Number(dev.seen || 0) > 60000) await q(db.from('bj_devices').update({ seen: now }).eq('id', id));

  switch (body.action) {
    case 'devices': {
      const rows: any = await q(db.from('bj_devices').select('id,label,state,created,seen').eq('album', A).order('created', { ascending: true }));
      return { ok: true, me: id, devices: rows };
    }
    case 'revoke': {
      if (typeof p.id !== 'string' || !/^[0-9a-f]{64}$/.test(p.id)) throw fail(400, '기기를 다시 골라 주세요.');
      await q(db.from('bj_devices').update({ state: 'revoked' }).eq('id', p.id).eq('album', A));
      return { ok: true };
    }
    case 'newcode': {
      writable(album);
      const code = newCode();
      const value = { hash: await sha256hex('bj-code:' + code), expires: now + 30 * 60000, uses: 0, max: 1, at: now };
      await setMeta(A, 'owner_code', value);
      return { ok: true, code: code.slice(0, 4) + '-' + code.slice(4), expires: value.expires };
    }
    case 'upload': {
      writable(album);
      if (!await hit('bju:' + id, 3600, 300)) throw fail(429, '한 시간에 올릴 수 있는 사진을 넘었어요. 조금 뒤에 다시 해 주세요.');
      if (p.avatar === true) return { ok: true, files: [{ full: await signedUpload(`a/${A}/${rid(12)}.jpg`) }] };
      const count = Number(p.count);
      if (!Number.isInteger(count) || count < 1 || count > MAX_PHOTOS) throw fail(400, `사진은 한 번에 ${MAX_PHOTOS}장까지예요.`);
      let post = p.post;
      if (post !== undefined) {
        if (typeof post !== 'string' || !ID.test(post) || !await q(db.from('bj_posts').select('id').eq('id', post).eq('album', A).maybeSingle())) throw fail(404, '글을 찾을 수 없어요.');
      } else post = rid(10);
      const files = [];
      for (let i = 0; i < count; i++) {
        const base = `p/${post}/${rid(8)}`;
        files.push({ full: await signedUpload(base + '.jpg'), thumb: await signedUpload(base + '-t.jpg') });
      }
      return { ok: true, post, files };
    }
    case 'post': {
      writable(album);
      if (typeof p.id !== 'string' || !ID.test(p.id)) throw fail(400, '글 번호가 올바르지 않아요.');
      if (await q(db.from('bj_posts').select('id').eq('id', p.id).maybeSingle())) throw fail(409, '이미 올린 글이에요.');
      const photos = photosOf(p.photos, p.id, Array.isArray(p.photos) && p.photos.length ? await listFolder('p/' + p.id) : new Set());
      const letter = p.kind === 'letter' ? letterOf(p.letter) : null;
      checkPost(p.kind, photos, letter);
      await q(db.from('bj_posts').insert({ id: p.id, album: A, kind: p.kind, caption: text(p.caption, 2200, '글'), donor: lineOf(p.donor, '후원자 닉네임'), theme: lineOf(p.theme, '스푼 테마'), ends: endsOf(p.ends, p.kind), letter, photos, at: atOf(p.day, now), created: now, updated: now, pinned: p.pinned === true }));
      return { ok: true, id: p.id, snap: await buildSnap(A, now) };
    }
    case 'edit': {
      writable(album);
      if (typeof p.id !== 'string' || !ID.test(p.id)) throw fail(400, '글 번호가 올바르지 않아요.');
      const old: any = await q(db.from('bj_posts').select('id,photos,at').eq('id', p.id).eq('album', A).maybeSingle());
      if (!old) throw fail(404, '글을 찾을 수 없어요.');
      const exists = await listFolder('p/' + p.id);
      const photos = photosOf(p.photos, p.id, exists);
      const letter = p.kind === 'letter' ? letterOf(p.letter) : null;
      checkPost(p.kind, photos, letter);
      await q(db.from('bj_posts').update({ kind: p.kind, caption: text(p.caption, 2200, '글'), donor: lineOf(p.donor, '후원자 닉네임'), theme: lineOf(p.theme, '스푼 테마'), ends: endsOf(p.ends, p.kind), letter, photos, at: atOf(p.day, now, Number(old.at)), updated: now, pinned: p.pinned === true }).eq('id', p.id).eq('album', A));
      // 빠진 사진과, 올렸다가 쓰지 않은 사진을 지운다
      const keep = new Set(photos.flatMap((x) => [x.f, x.t]));
      await removeFiles([...exists].filter((x) => !keep.has(x)));
      return { ok: true, id: p.id, snap: await buildSnap(A, now) };
    }
    case 'pin': {
      writable(album);
      if (typeof p.id !== 'string' || !ID.test(p.id)) throw fail(400, '글 번호가 올바르지 않아요.');
      await q(db.from('bj_posts').update({ pinned: p.pinned === true, updated: now }).eq('id', p.id).eq('album', A));
      return { ok: true, snap: await buildSnap(A, now) };
    }
    case 'delete': {
      writable(album);
      if (typeof p.id !== 'string' || !ID.test(p.id)) throw fail(400, '글 번호가 올바르지 않아요.');
      // 먼치킨이 올린 최초 박제판이면 지운 것을 남겨 둔다(다음에 이름이 더 채워져도 다시 만들지 않게)
      const old: any = await q(db.from('bj_posts').select('src').eq('id', p.id).eq('album', A).maybeSingle());
      if (!old) throw fail(404, '글을 찾을 수 없어요.');
      if (old.src) await q(db.from('bj_bot_gone').upsert({ src: old.src, at: now }));
      await q(db.from('bj_posts').delete().eq('id', p.id).eq('album', A));
      await removeFiles([...await listFolder('p/' + p.id)]);
      return { ok: true, snap: await buildSnap(A, now) };
    }
    case 'profile': {
      writable(album);
      const old = (await getMeta(A, 'profile')) || {};
      let link = text(p.link, 300, '링크');
      if (link && !/^https:\/\/[^\s]+$/i.test(link)) throw fail(400, '링크는 https:// 로 시작해야 해요.');
      let avatar = old.avatar || '';
      if (p.avatar !== undefined && p.avatar !== avatar) {
        if (p.avatar === '' || p.avatar === null) avatar = '';
        else if (typeof p.avatar === 'string' && new RegExp(`^a/${A}/[a-z2-9]{12}\\.jpg$`).test(p.avatar)) {
          if (!(await listFolder('a/' + A)).has(p.avatar)) throw fail(400, '프로필 사진이 아직 올라가지 않았어요. 다시 해 주세요.');
          avatar = p.avatar;
        } else throw fail(400, '프로필 사진 정보가 올바르지 않아요.');
      }
      await setMeta(A, 'profile', { name: text(p.name, 30, '이름'), bio: text(p.bio, 300, '소개'), link, avatar, updated: now });
      if (old.avatar && old.avatar !== avatar) await removeFiles([old.avatar]);
      return { ok: true, snap: await buildSnap(A, now) };
    }
    // ── 댓글 관리(앨범 주인) — 보기만 하는 앨범에서도 지우기·차단은 된다 ──
    case 'comment-delete': {
      if (typeof p.id !== 'string' || !CID.test(p.id)) throw fail(400, '댓글을 다시 골라 주세요.');
      const r: any = await q(db.from('bj_comments').update({ state: 'deleted', text: '', deleted_by: 'owner' }).eq('id', p.id).eq('album', A).eq('state', 'visible').select('id'));
      if (!r?.length) throw fail(404, '댓글을 찾을 수 없어요.');
      scheduleSnap(A);
      return { ok: true };
    }
    case 'member-block': case 'member-unblock': {
      if (typeof p.member !== 'string' || !MID.test(p.member)) throw fail(400, '회원을 다시 골라 주세요.');
      if (body.action === 'member-unblock') { await q(db.from('bj_album_blocks').delete().eq('album', A).eq('member', p.member)); return { ok: true }; }
      if (!await q(db.from('bj_members').select('id').eq('id', p.member).maybeSingle())) throw fail(404, '회원을 찾을 수 없어요.');
      await q(db.from('bj_album_blocks').upsert({ album: A, member: p.member, at: now }));
      return { ok: true };
    }
    case 'blocks': {
      const rows: any = await q(db.from('bj_album_blocks').select('member,at,bj_members(nickname)').eq('album', A).order('at', { ascending: false }).limit(500));
      return { ok: true, blocks: rows.map((r: any) => ({ member: r.member, nick: r.bj_members?.nickname || '(닉네임 없음)', at: r.at })) };
    }
    case 'comments-set': {
      const on = p.on === true;
      await setMeta(A, 'comments', { off: !on, at: now });
      return { ok: true, on };
    }
    case 'reports': {
      const rows: any = await q(db.from('bj_reports').select('comment,at,bj_comments!inner(album,post,text,state,member,created,bj_members!bj_comments_member_fkey(nickname))').eq('bj_comments.album', A).eq('bj_comments.state', 'visible').order('at', { ascending: false }).limit(1000));
      const by = new Map<string, any>();
      for (const r of rows) {
        const c = r.bj_comments, had = by.get(r.comment);
        if (had) { had.count++; continue; }
        by.set(r.comment, { comment: r.comment, post: c.post, member: c.member, nick: c.bj_members?.nickname || '', text: c.text, at: r.at, count: 1 });
      }
      return { ok: true, reports: [...by.values()] };
    }
  }
  throw fail(400, '모르는 요청이에요.');
}

// ---- 먼치킨 봇(최초 박제판 저절로 올리기) ----
// board-begin {board, hash, again} → 지운 글이면 {gone:true}, 아니면 그 판의 글 번호와 그림 두 장(큰·작은)의 올리기 주소
// board-save {board, post, f, w, h, title, filled, total, hash, ends?} → 처음이면 새 글(최초 박제판, 오늘 날짜), 있으면 사진만 바꾼다(글·날짜·고정은 주인이 고친 그대로)
//  ends(종료 날짜)는 봇이 보낼 때만(0.19.14~) 고친다 — 봇이 정하는 값
// board-meta {board, title, ends} → 그림은 그대로, 판 이름(extra.title)·종료 날짜만. 글이 없으면 {missing:true}
// album-info {} (v6, 2026-11-04 — DJ 마다 앨범 시범) → 이 기기에 이어진 앨범 {album, name, state, site} · 없으면 {none:true}(오류 아님).
//  봇은 이 답으로 화면에 앨범 칸을 보일지 정한다 — 운영자가 이어 주지 않은 먼치킨에는 아무것도 보이지 않는다.
async function bot(req: Request, now: number) {
  const body = await readJson(req, 16384);
  const id = await verify(body, now, BOT_PREFIX, BOT_ACTIONS);
  const [dev, allow]: any = await Promise.all([
    q(db.from('junlive_devices').select('state').eq('id', id).maybeSingle()),
    q(db.from('bj_bots').select('id,album').eq('id', id).maybeSingle())
  ]);
  if (body.action === 'album-info') {
    if (!await hit('bjbi:' + id, 3600, 30)) throw fail(429, '너무 자주 물었어요. 조금 뒤에 다시 물어요.');
    if (dev?.state !== 'approved' || !allow) return { ok: true, none: true };
    const album = await albumRow(allow.album, now).catch(() => null);
    if (!album) return { ok: true, none: true };
    const hosts: any = await q(db.from('bj_hosts').select('host,created').eq('album', album.id));
    const host = [...hosts].sort((a: any, b: any) => Number(a.host.startsWith('www.')) - Number(b.host.startsWith('www.')) || (a.created || 0) - (b.created || 0))[0]?.host || '';
    return { ok: true, album: album.id, name: album.name || '', state: album.state, site: host ? `https://${host}/` : '' };
  }
  if (dev?.state !== 'approved' || !allow) throw fail(403, '추억앨범에 올릴 수 있는 먼치킨이 아니에요.');
  const A: string = allow.album;
  writable(await albumRow(A, now));
  if (!await hit('bjb:' + id, 3600, 240)) throw fail(429, '한 시간에 올릴 수 있는 만큼 넘었어요. 조금 뒤에 다시 올려요.');
  const p = isObj(body.payload) ? body.payload : {};
  if (typeof p.board !== 'string' || !BOARD_REF.test(p.board)) throw fail(400, '박제판 번호가 올바르지 않아요.');
  const src = `fb:${id.slice(0, 16)}:${p.board}`;
  if (p.again === true) await q(db.from('bj_bot_gone').delete().eq('src', src));
  const [gone, post]: any = await Promise.all([
    q(db.from('bj_bot_gone').select('src').eq('src', src).maybeSingle()),
    q(db.from('bj_posts').select('id,photos,extra').eq('src', src).eq('album', A).maybeSingle())
  ]);
  if (gone) return { ok: true, gone: true, album: A };
  if (body.action === 'board-meta') {
    if (!post) return { ok: true, missing: true, album: A };
    const ends = endsOf(p.ends, 'first'), title = text(p.title, 20, '판 이름');
    await q(db.from('bj_posts').update({ extra: { ...(isObj(post.extra) ? post.extra : {}), title }, ends, updated: now }).eq('id', post.id));
    await buildSnap(A, now);
    return { ok: true, post: post.id, album: A };
  }
  if (body.action === 'board-begin') {
    const postId = post?.id || rid(10), base = `p/${postId}/${rid(8)}`;
    return { ok: true, post: postId, album: A, full: await signedUpload(base + '.jpg'), thumb: await signedUpload(base + '-t.jpg') };
  }
  // board-save
  if (typeof p.post !== 'string' || !ID.test(p.post) || (post && post.id !== p.post)) throw fail(409, '박제판 글이 바뀌었어요. 다시 올려요.');
  if (!post && await q(db.from('bj_posts').select('id').eq('id', p.post).maybeSingle())) throw fail(409, '글 번호가 겹쳤어요. 다시 올려요.');
  const exists = await listFolder('p/' + p.post);
  const photos = photosOf([{ f: p.f, w: p.w, h: p.h }], p.post, exists);
  const total = Number(p.total), filled = Number(p.filled);
  if (!Number.isInteger(total) || total < 1 || total > 80 || !Number.isInteger(filled) || filled < 0 || filled > total) throw fail(400, '칸 수가 올바르지 않아요.');
  const title = text(p.title, 20, '판 이름');
  const extra = { title, filled, total, bot: true, hash: typeof p.hash === 'string' && /^[0-9a-f]{64}$/.test(p.hash) ? p.hash : '' };
  const ends = p.ends === undefined ? undefined : endsOf(p.ends, 'first');
  if (post) await q(db.from('bj_posts').update({ photos, extra, ...(ends === undefined ? {} : { ends }), updated: now }).eq('id', p.post));
  else await q(db.from('bj_posts').insert({ id: p.post, album: A, kind: 'first', caption: title ? `🏆 ${title} 최초 박제판` : '🏆 최초 박제판', letter: null, photos, at: now, created: now, updated: now, pinned: false, hearts: 0, src, extra, ends: ends || '' }));
  // 이번 그림 두 장만 남기고 지난 그림·올렸다가 쓰지 않은 그림을 지운다
  const keep = new Set(photos.flatMap((x) => [x.f, x.t]));
  await removeFiles([...exists].filter((x) => !keep.has(x)));
  await buildSnap(A, now);
  return { ok: true, post: p.post, created: !post, album: A };
}

// ---- 회원(아이디·비밀번호 · 카카오 · 본인인증) ----
const MID = /^m[a-z2-9]{11}$/, CID = /^c[a-z2-9]{11}$/, LOGIN_RE = /^[a-z0-9_]{4,20}$/, VID = /^bjv-[a-z2-9]{20}$/;
const PW_ITER = 120000, SESSION_MS = 60 * 86400000, MIN_AGE = 14;
const NICK_RE = /^[가-힣A-Za-z0-9_](?:[가-힣A-Za-z0-9_ ]{0,10}[가-힣A-Za-z0-9_])?$/;
const NICK_RESERVED = ['운영자', '관리자', '먼치킨', '추억앨범', '스푼', 'admin', 'spoon'];
const env = (k: string) => (Deno.env.get(k) || '').trim();
const FN_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '') + '/functions/v1/bakje/';
const b64u = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const newToken = () => b64u(crypto.getRandomValues(new Uint8Array(32)));
const salted = async (kind: string, v: string, n: number) => (await sha256hex((await salt()) + ':' + kind + ':' + v)).slice(0, n);
async function pwHash(pw: string, s = crypto.getRandomValues(new Uint8Array(16)), iter = PW_ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: s, iterations: iter }, key, 256));
  return `pbkdf2$${iter}$${b64u(s)}$${b64u(bits)}`;
}
async function pwCheck(pw: string, stored: string | null) {
  const m = /^pbkdf2\$(\d+)\$([-_A-Za-z0-9]+)\$([-_A-Za-z0-9]+)$/.exec(stored || '');
  if (!m) { await pwHash(pw); return false; }                       // 시간을 비슷하게
  const again = await pwHash(pw, decode64url(m[2]), Number(m[1]));
  let diff = again.length === stored!.length ? 0 : 1;
  for (let i = 0; i < again.length; i++) diff |= again.charCodeAt(i) ^ (stored!.charCodeAt(i) || 0);
  return diff === 0;
}
function pwOf(v: unknown) {
  if (typeof v !== 'string' || [...v].length < 8 || [...v].length > 64) throw fail(400, '비밀번호는 8~64자로 정해 주세요.');
  return v;
}
const memberOut = (m: any) => ({ id: m.id, nickname: m.nickname || '', verified: Boolean(m.verified), loginId: m.login_id || null, kakao: Boolean(m.kakao) });
const MEMBER_COLS = 'id,login_id,pw,kakao,nickname,person,verified,state,created,seen';
async function newSession(memberId: string, now: number) {
  const token = newToken();
  await q(db.from('bj_sessions').insert({ token: await sha256hex(token), member: memberId, created: now, seen: now, expires: now + SESSION_MS }));
  return token;
}
// 세션 → 회원(없거나 끝났으면 null). 쫓겨난 회원도 돌려준다(화면이 이유를 보이게) — 쓰기는 각 동작이 막는다
async function sessionMember(req: Request, now: number) {
  const token = req.headers.get('x-bj-session') || '';
  if (!/^[-_A-Za-z0-9]{43}$/.test(token)) return null;
  const hash = await sha256hex(token);
  const s: any = await q(db.from('bj_sessions').select('member,expires,seen').eq('token', hash).maybeSingle());
  if (!s || s.expires < now) { if (s) await q(db.from('bj_sessions').delete().eq('token', hash)); return null; }
  const m: any = await q(db.from('bj_members').select(MEMBER_COLS).eq('id', s.member).maybeSingle());
  if (!m) return null;
  if (now - s.seen > 3600000) {
    await q(db.from('bj_sessions').update({ seen: now, expires: now + SESSION_MS }).eq('token', hash));
    await q(db.from('bj_members').update({ seen: now }).eq('id', m.id));
  }
  return { ...m, token: hash };
}
async function needMember(req: Request, now: number) {
  const m = await sessionMember(req, now);
  if (!m) throw fail(401, '다시 로그인해 주세요.');
  if (m.state === 'banned') throw fail(403, '이용이 막힌 계정이에요.');
  return m;
}
async function createMember(now: number, fields: Record<string, unknown>) {
  for (let i = 0; i < 3; i++) {
    const id = 'm' + rid(11);
    const { error } = await db.from('bj_members').insert({ id, ...fields, created: now, seen: now });
    if (!error) return (await q(db.from('bj_members').select(MEMBER_COLS).eq('id', id).maybeSingle())) as any;
    if (error.code === '23505') {
      const why = `${error.message || ''} ${error.details || ''}`;
      if (why.includes('login_id')) throw fail(409, '이미 쓰는 아이디예요.');
      if (why.includes('kakao')) throw fail(409, '잠깐 겹쳤어요. 다시 해 주세요.');
      continue;                                                     // 회원 번호가 겹침 — 새 번호로
    }
    console.error(error); throw fail(503, BROKEN);
  }
  throw fail(503, BROKEN);
}
const maskId = (s: string) => s.length <= 2 ? s[0] + '*' : s.slice(0, 2) + '*'.repeat(Math.min(6, s.length - 2));

// 포트원 V2 본인인증 결과(서버에서 직접 묻는다 — 화면이 보낸 결과는 믿지 않는다)
const verifyReady = () => Boolean(env('PORTONE_API_SECRET') && env('PORTONE_STORE_ID') && env('PORTONE_CHANNEL_KEY'));
async function portoneResult(id: string) {
  if (!verifyReady()) throw fail(503, '본인인증 준비 중이에요. 조금 뒤에 다시 해 주세요.');
  let res: Response;
  try { res = await fetch('https://api.portone.io/identity-verifications/' + encodeURIComponent(id), { headers: { Authorization: 'PortOne ' + env('PORTONE_API_SECRET') }, signal: AbortSignal.timeout(15000) }); }
  catch { throw fail(503, '본인인증 결과를 받지 못했어요. 다시 해 주세요.'); }
  const j: any = await res.json().catch(() => null);
  const v = j?.identityVerification ?? j;
  if (!res.ok || !v) { console.error('portone', res.status, j?.type || ''); throw fail(res.status === 404 ? 400 : 503, res.status === 404 ? '본인인증을 마치지 않았어요. 다시 해 주세요.' : '본인인증 결과를 받지 못했어요. 다시 해 주세요.'); }
  if (v.storeId && v.storeId !== env('PORTONE_STORE_ID')) throw fail(400, '본인인증 정보가 맞지 않아요.');
  if (v.status !== 'VERIFIED') throw fail(400, '본인인증을 마치지 않았어요. 다시 해 주세요.');
  const c = v.verifiedCustomer || {};
  if (typeof c.di !== 'string' || c.di.length < 10) throw fail(503, '본인인증 결과를 받지 못했어요. 운영자에게 알려 주세요.');
  // 만 나이(한국 날짜): 생년월일은 여기서만 보고 저장하지 않는다
  const birth = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(c.birthDate || ''));
  if (!birth) throw fail(503, '본인인증 결과를 받지 못했어요. 운영자에게 알려 주세요.');
  const today = kstDay(Date.now());
  let age = Number(today.slice(0, 4)) - Number(birth[1]);
  if (today.slice(5) < `${birth[2]}-${birth[3]}`) age--;
  if (age < MIN_AGE) throw fail(403, '만 14세 이상만 가입할 수 있어요.');
  return { person: await salted('person', c.di, 48) };
}
async function verifyRow(id: unknown, purpose: string, member: string | null) {
  if (typeof id !== 'string' || !VID.test(id)) throw fail(400, '본인인증 번호가 올바르지 않아요.');
  const row: any = await q(db.from('bj_verifications').select('id,purpose,member,done').eq('id', id).maybeSingle());
  if (!row || row.purpose !== purpose || (member && row.member !== member)) throw fail(404, '본인인증을 처음부터 다시 해 주세요.');
  if (row.done) throw fail(409, '이미 끝난 본인인증이에요. 처음부터 다시 해 주세요.');
  return row;
}

async function member(req: Request, now: number) {
  const b = await readJson(req, 4096);
  if (!isObj(b) || typeof b.action !== 'string') throw fail(400, '요청 모양이 올바르지 않아요.');
  const ip = () => ipHash(req);
  switch (b.action) {
    case 'signup': {
      if (!await hit('bjsu:' + await ip(), 3600, 10)) throw fail(429, '가입을 너무 많이 했어요. 한 시간 뒤에 다시 해 주세요.');
      if (b.agree !== true) throw fail(400, '이용약관과 개인정보 수집·이용에 동의해 주세요.');
      const loginId = typeof b.loginId === 'string' ? b.loginId.trim().toLowerCase() : '';
      if (!LOGIN_RE.test(loginId)) throw fail(400, '아이디는 영어 소문자·숫자·_ 로 4~20자예요.');
      const pw = await pwHash(pwOf(b.password));
      if (await q(db.from('bj_members').select('id').eq('login_id', loginId).maybeSingle())) throw fail(409, '이미 쓰는 아이디예요.');
      const m = await createMember(now, { login_id: loginId, pw });
      return { ok: true, session: await newSession(m.id, now), member: memberOut(m) };
    }
    case 'login': {
      const loginId = typeof b.loginId === 'string' ? b.loginId.trim().toLowerCase() : '';
      if (!await hit('bjli:' + await ip(), 3600, 30) || !await hit('bjlu:' + loginId, 3600, 10)) throw fail(429, '로그인을 너무 많이 시도했어요. 한 시간 뒤에 다시 해 주세요.');
      const m: any = LOGIN_RE.test(loginId) ? await q(db.from('bj_members').select(MEMBER_COLS).eq('login_id', loginId).maybeSingle()) : null;
      if (!await pwCheck(typeof b.password === 'string' ? b.password : '', m?.pw ?? null) || !m) throw fail(401, '아이디나 비밀번호가 맞지 않아요.');
      if (m.state === 'banned') throw fail(403, '이용이 막힌 계정이에요.');
      return { ok: true, session: await newSession(m.id, now), member: memberOut(m) };
    }
    case 'ticket': {
      if (typeof b.ticket !== 'string' || !/^[-_A-Za-z0-9]{43}$/.test(b.ticket)) throw fail(400, '로그인을 처음부터 다시 해 주세요.');
      const hash = await sha256hex(b.ticket);
      const t: any = await q(db.from('bj_tickets').delete().eq('token', hash).eq('kind', 'login').select('member,host,expires'));
      const row = t?.[0];
      if (!row || row.expires < now) throw fail(401, '로그인 시간이 지났어요. 다시 해 주세요.');
      let origin = ''; try { origin = new URL(req.headers.get('origin') || '').host; } catch { /* 없음 */ }
      if (origin && origin !== row.host) throw fail(403, '로그인을 처음부터 다시 해 주세요.');
      const m: any = await q(db.from('bj_members').select(MEMBER_COLS).eq('id', row.member).maybeSingle());
      if (!m) throw fail(401, '로그인을 처음부터 다시 해 주세요.');
      if (m.state === 'banned') throw fail(403, '이용이 막힌 계정이에요.');
      return { ok: true, session: await newSession(m.id, now), member: memberOut(m) };
    }
    case 'find-start': {
      if (!await hit('bjfs:' + await ip(), 3600, 10)) throw fail(429, '너무 자주 했어요. 한 시간 뒤에 다시 해 주세요.');
      if (!verifyReady()) throw fail(503, '본인인증 준비 중이에요. 조금 뒤에 다시 해 주세요.');
      const id = 'bjv-' + rid(20);
      await q(db.from('bj_verifications').insert({ id, purpose: 'find', member: null, created: now }));
      return { ok: true, id };
    }
    case 'find-done': {
      const row = await verifyRow(b.id, 'find', null);
      const { person } = await portoneResult(row.id);
      await q(db.from('bj_verifications').update({ done: now }).eq('id', row.id));
      const m: any = await q(db.from('bj_members').select(MEMBER_COLS).eq('person', person).maybeSingle());
      if (!m) throw fail(404, '이 본인인증으로 가입한 계정이 없어요.');
      if (m.state === 'banned') throw fail(403, '이용이 막힌 계정이에요.');
      let reset: string | null = null;
      if (m.login_id) {
        reset = newToken();
        await q(db.from('bj_tickets').insert({ token: await sha256hex(reset), kind: 'reset', member: m.id, expires: now + 10 * 60000 }));
      }
      return { ok: true, account: { loginId: m.login_id || null, kakao: Boolean(m.kakao) }, reset };
    }
    case 'reset': {
      if (typeof b.reset !== 'string' || !/^[-_A-Za-z0-9]{43}$/.test(b.reset)) throw fail(400, '처음부터 다시 해 주세요.');
      const pw = await pwHash(pwOf(b.password));
      const t: any = await q(db.from('bj_tickets').delete().eq('token', await sha256hex(b.reset)).eq('kind', 'reset').select('member,expires'));
      const row = t?.[0];
      if (!row || row.expires < now) throw fail(401, '시간이 지났어요. 처음부터 다시 해 주세요.');
      await q(db.from('bj_members').update({ pw }).eq('id', row.member).not('login_id', 'is', null));
      await q(db.from('bj_sessions').delete().eq('member', row.member));
      const m: any = await q(db.from('bj_members').select(MEMBER_COLS).eq('id', row.member).maybeSingle());
      return { ok: true, session: await newSession(m.id, now), member: memberOut(m) };
    }
  }
  // 아래는 로그인한 회원만
  const me = await sessionMember(req, now);
  if (!me) throw fail(401, '다시 로그인해 주세요.');
  if (b.action === 'me') return { ok: true, member: memberOut(me), banned: me.state === 'banned' };
  if (b.action === 'logout') { await q(db.from('bj_sessions').delete().eq('token', me.token)); return { ok: true }; }
  if (me.state === 'banned') throw fail(403, '이용이 막힌 계정이에요.');
  switch (b.action) {
    case 'nickname': {
      if (!await hit('bjnk:' + me.id, 3600, 20)) throw fail(429, '닉네임을 너무 자주 바꿨어요. 조금 뒤에 다시 해 주세요.');
      const nick = typeof b.nickname === 'string' ? b.nickname.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
      if ([...nick].length < 2 || [...nick].length > 12 || !NICK_RE.test(nick)) throw fail(400, '닉네임은 한글·영문·숫자·_ 로 2~12자예요.');
      const flat = nick.replace(/\s/g, '').toLowerCase();
      if (NICK_RESERVED.some((w) => flat.includes(w))) throw fail(400, '쓸 수 없는 닉네임이에요.');
      const { error } = await db.from('bj_members').update({ nickname: nick }).eq('id', me.id);
      if (error) { if (error.code === '23505') throw fail(409, '이미 쓰는 닉네임이에요.'); console.error(error); throw fail(503, BROKEN); }
      return { ok: true, member: memberOut({ ...me, nickname: nick }) };
    }
    case 'password': {
      if (!me.login_id) throw fail(400, '카카오로 가입한 계정은 비밀번호가 없어요.');
      if (!await hit('bjpw:' + me.id, 3600, 10)) throw fail(429, '너무 자주 했어요. 한 시간 뒤에 다시 해 주세요.');
      if (!await pwCheck(typeof b.old === 'string' ? b.old : '', me.pw)) throw fail(401, '지금 비밀번호가 맞지 않아요.');
      await q(db.from('bj_members').update({ pw: await pwHash(pwOf(b.password)) }).eq('id', me.id));
      await q(db.from('bj_sessions').delete().eq('member', me.id).neq('token', me.token));
      return { ok: true };
    }
    case 'withdraw': {
      if (me.login_id && !await pwCheck(typeof b.password === 'string' ? b.password : '', me.pw)) throw fail(401, '비밀번호가 맞지 않아요.');
      const albums: any = await q(db.from('bj_comments').select('album').eq('member', me.id).eq('state', 'visible'));
      await q(db.from('bj_members').delete().eq('id', me.id));
      for (const a of new Set(albums.map((x: any) => x.album))) scheduleSnap(a as string);
      return { ok: true };
    }
    case 'verify-start': {
      if (me.verified) throw fail(409, '이미 본인인증했어요.');
      if (!verifyReady()) throw fail(503, '본인인증 준비 중이에요. 조금 뒤에 다시 해 주세요.');
      if (!await hit('bjvs:' + me.id, 3600, 10)) throw fail(429, '본인인증을 너무 자주 했어요. 한 시간 뒤에 다시 해 주세요.');
      const id = 'bjv-' + rid(20);
      await q(db.from('bj_verifications').insert({ id, purpose: 'join', member: me.id, created: now }));
      return { ok: true, id };
    }
    case 'verify-done': {
      if (me.verified) return { ok: true, member: memberOut(me) };
      const row = await verifyRow(b.id, 'join', me.id);
      const { person } = await portoneResult(row.id);
      await q(db.from('bj_verifications').update({ done: now }).eq('id', row.id));
      if (await q(db.from('bj_banned_people').select('person').eq('person', person).maybeSingle())) throw fail(403, '이용이 막힌 분이라 가입할 수 없어요.');
      const other: any = await q(db.from('bj_members').select('id,login_id,kakao').eq('person', person).maybeSingle());
      const taken = (o: any) => ({ ok: false, error: '이미 본인인증한 계정이 있어요. 그 계정으로 로그인해 주세요.', hint: { loginId: o?.login_id ? maskId(o.login_id) : null, kakao: Boolean(o?.kakao) } });
      if (other && other.id !== me.id) return json409(taken(other));
      const { error } = await db.from('bj_members').update({ person, verified: now }).eq('id', me.id);
      if (error) {
        if (error.code === '23505') return json409(taken(await q(db.from('bj_members').select('login_id,kakao').eq('person', person).maybeSingle())));
        console.error(error); throw fail(503, BROKEN);
      }
      return { ok: true, member: memberOut({ ...me, verified: now }) };
    }
  }
  throw fail(400, '모르는 요청이에요.');
}
// 409 + 알려 줄 것(hint)을 함께 — Fail 은 글만 실으니 따로
class Json409 { constructor(public body: unknown) {} }
const json409 = (body: unknown) => { throw new Json409(body); };

// ---- 카카오 로그인 ----
// GET kakao-start?h=<사이트 호스트>&r=<돌아갈 경로> → 카카오 → GET kakao → 사이트 #bjlogin=<표>(2분·한 번)
const kakaoReady = () => Boolean(env('KAKAO_REST_KEY'));
const DEV_HOST = /^(localhost|127\.0\.0\.1)(:\d{2,5})?$/;
async function siteOf(h: unknown) {
  if (typeof h !== 'string' || h.length > 260) return null;
  const host = h.trim().toLowerCase();
  if (DEV_HOST.test(host)) return { host, origin: 'http://' + host };
  let bare = host;
  try { bare = new URL('https://' + host).hostname; } catch { return null; }
  if (bare !== host || !HOST_RE.test(host)) return null;
  if (!await q(db.from('bj_hosts').select('host').eq('host', host).maybeSingle())) return null;
  return { host, origin: 'https://' + host };
}
const pathOf = (r: unknown) => typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') && r.length <= 300 && !/[\s\\]/.test(r) ? r.replace(/#.*$/, '') : '/';
const redirect = (to: string) => new Response(null, { status: 302, headers: { ...CORS, Location: to, 'Cache-Control': 'no-store' } });
const htmlPage = (msg: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>추억앨범</title><p style="font:16px/1.6 sans-serif;padding:24px">${msg}</p>`, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
async function kakaoStart(req: Request, now: number) {
  const u = new URL(req.url), site = await siteOf(u.searchParams.get('h'));
  if (!site) return htmlPage('추억앨범 주소가 올바르지 않아요. 앨범 화면에서 다시 해 주세요.');
  const back = site.origin + pathOf(u.searchParams.get('r'));
  if (!kakaoReady()) return redirect(back + '#bjlogin-error=setup');
  if (!await hit('bjks:' + await ipHash(req), 600, 30)) return redirect(back + '#bjlogin-error=fail');
  await q(db.from('bj_oauth_states').delete().lt('expires', now));
  const state = newToken();
  await q(db.from('bj_oauth_states').insert({ state: await sha256hex(state), host: site.host, path: pathOf(u.searchParams.get('r')), expires: now + 10 * 60000 }));
  const k = new URL('https://kauth.kakao.com/oauth/authorize');
  k.searchParams.set('response_type', 'code'); k.searchParams.set('client_id', env('KAKAO_REST_KEY'));
  k.searchParams.set('redirect_uri', FN_URL + 'kakao'); k.searchParams.set('state', state);
  return redirect(k.toString());
}
async function kakaoBack(req: Request, now: number) {
  const u = new URL(req.url), state = u.searchParams.get('state') || '';
  if (!/^[-_A-Za-z0-9]{43}$/.test(state)) return htmlPage('로그인을 처음부터 다시 해 주세요.');
  const rows: any = await q(db.from('bj_oauth_states').delete().eq('state', await sha256hex(state)).select('host,path,expires'));
  const st = rows?.[0];
  if (!st || st.expires < now) return htmlPage('로그인 시간이 지났어요. 앨범 화면에서 다시 해 주세요.');
  const origin = (DEV_HOST.test(st.host) ? 'http://' : 'https://') + st.host, back = origin + st.path;
  if (u.searchParams.get('error') || !u.searchParams.get('code')) return redirect(back + '#bjlogin-error=cancel');
  try {
    const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: env('KAKAO_REST_KEY'), redirect_uri: FN_URL + 'kakao', code: u.searchParams.get('code')! });
    if (env('KAKAO_CLIENT_SECRET')) form.set('client_secret', env('KAKAO_CLIENT_SECRET'));
    const tr = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: form, signal: AbortSignal.timeout(15000) });
    const tj: any = await tr.json().catch(() => null);
    if (!tr.ok || typeof tj?.access_token !== 'string') { console.error('kakao token', tr.status, tj?.error_code || tj?.error || ''); return redirect(back + '#bjlogin-error=fail'); }
    const ur = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: 'Bearer ' + tj.access_token }, signal: AbortSignal.timeout(15000) });
    const uj: any = await ur.json().catch(() => null);
    if (!ur.ok || !uj?.id) { console.error('kakao me', ur.status); return redirect(back + '#bjlogin-error=fail'); }
    const kakao = await salted('kakao', String(uj.id), 40);
    let m: any = await q(db.from('bj_members').select(MEMBER_COLS).eq('kakao', kakao).maybeSingle());
    if (!m) m = await createMember(now, { kakao });
    if (m.state === 'banned') return redirect(back + '#bjlogin-error=banned');
    const ticket = newToken();
    await q(db.from('bj_tickets').insert({ token: await sha256hex(ticket), kind: 'login', member: m.id, host: st.host, expires: now + 2 * 60000 }));
    await q(db.from('bj_tickets').delete().lt('expires', now));
    return redirect(back + '#bjlogin=' + ticket);
  } catch (e) { console.error(e); return redirect(back + '#bjlogin-error=fail'); }
}

// ---- 댓글 ----
async function commentsOff(album: any) { return album.state !== 'active' || (await getMeta(album.id, 'comments'))?.off === true; }
// 쓸 수 있나: login·banned·verify·nickname·blocked·off
async function canWrite(me: any, album: any) {
  if (await commentsOff(album)) return 'off';
  if (!me) return 'login';
  if (me.state === 'banned') return 'banned';
  if (!me.verified) return 'verify';
  if (!me.nickname) return 'nickname';
  if (await q(db.from('bj_album_blocks').select('member').eq('album', album.id).eq('member', me.id).maybeSingle())) return 'blocked';
  return null;
}
async function postIn(album: string, post: unknown) {
  if (typeof post !== 'string' || !ID.test(post) || !await q(db.from('bj_posts').select('id').eq('id', post).eq('album', album).maybeSingle())) throw fail(404, '글을 찾을 수 없어요.');
  return post;
}
async function commentsList(req: Request, now: number) {
  if (!await hit('bjcl:' + await ipHash(req), 60, 60)) throw fail(429, '너무 자주 불러왔어요. 잠깐 뒤에 다시 해 주세요.');
  const u = new URL(req.url), album = await albumRow(u.searchParams.get('album') || LEGACY, now);
  const post = await postIn(album.id, u.searchParams.get('post'));
  const [me, rows]: any = await Promise.all([
    sessionMember(req, now),
    q(db.from('bj_comments').select('id,member,text,created,bj_members!bj_comments_member_fkey(nickname)').eq('post', post).eq('state', 'visible').order('created', { ascending: true }).limit(300))
  ]);
  const why = await canWrite(me, album);
  return {
    ok: true, off: why === 'off',
    comments: rows.map((c: any) => ({ id: c.id, m: c.member, nick: c.bj_members?.nickname || '(알 수 없음)', text: c.text, at: c.created, mine: Boolean(me && me.id === c.member) })),
    me: { can: why === null, why }
  };
}
async function comment(req: Request, now: number) {
  const b = await readJson(req, 8192);
  if (!isObj(b) || typeof b.action !== 'string') throw fail(400, '요청 모양이 올바르지 않아요.');
  const me = await needMember(req, now);
  switch (b.action) {
    case 'add': {
      const album = await albumRow(b.album === undefined ? LEGACY : b.album, now);
      const post = await postIn(album.id, b.post);
      const why = await canWrite(me, album);
      if (why) throw fail(403, ({ off: '댓글을 받지 않는 앨범이에요.', verify: '본인인증을 하면 댓글을 달 수 있어요.', nickname: '닉네임을 정하면 댓글을 달 수 있어요.', blocked: '이 앨범에서는 댓글을 달 수 없어요.', banned: '이용이 막힌 계정이에요.' } as Record<string, string>)[why] || '댓글을 달 수 없어요.');
      const raw = text(b.text, 300, '댓글');
      const body = raw.split('\n').reduce((acc: string[], line) => { if (acc.length < 5) acc.push(line); else acc[4] += ' ' + line; return acc; }, []).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!body) throw fail(400, '댓글을 써 주세요.');
      if (!await hit('bjcm:' + me.id, 10, 1)) throw fail(429, '10초 뒤에 다시 달아 주세요.');
      if (!await hit('bjch:' + me.id, 3600, 30)) throw fail(429, '한 시간에 달 수 있는 댓글을 넘었어요. 조금 뒤에 다시 달아 주세요.');
      const id = 'c' + rid(11);
      await q(db.from('bj_comments').insert({ id, album: album.id, post, member: me.id, text: body, created: now }));
      scheduleSnap(album.id);
      return { ok: true, comment: { id, m: me.id, nick: me.nickname, text: body, at: now, mine: true } };
    }
    case 'delete': {
      if (typeof b.id !== 'string' || !CID.test(b.id)) throw fail(400, '댓글을 다시 골라 주세요.');
      const r: any = await q(db.from('bj_comments').update({ state: 'deleted', text: '', deleted_by: 'self' }).eq('id', b.id).eq('member', me.id).eq('state', 'visible').select('album'));
      if (!r?.length) throw fail(404, '댓글을 찾을 수 없어요.');
      scheduleSnap(r[0].album);
      return { ok: true };
    }
    case 'report': {
      if (typeof b.id !== 'string' || !CID.test(b.id)) throw fail(400, '댓글을 다시 골라 주세요.');
      if (!me.verified) throw fail(403, '본인인증을 하면 신고할 수 있어요.');
      if (!await hit('bjrp:' + me.id, 3600, 30)) throw fail(429, '신고를 너무 많이 했어요. 조금 뒤에 다시 해 주세요.');
      const c: any = await q(db.from('bj_comments').select('id,member').eq('id', b.id).eq('state', 'visible').maybeSingle());
      if (!c) throw fail(404, '댓글을 찾을 수 없어요.');
      if (c.member === me.id) throw fail(400, '내 댓글은 신고할 수 없어요.');
      await q(db.from('bj_reports').upsert({ comment: c.id, reporter: me.id, reason: text(b.reason, 100, '신고 이유'), at: now }, { onConflict: 'comment,reporter', ignoreDuplicates: true }));
      return { ok: true };
    }
  }
  throw fail(400, '모르는 요청이에요.');
}

// ---- 하트(누구나) ----
async function heart(req: Request, now: number) {
  const b = await readJson(req, 2048);
  if (!isObj(b) || typeof b.post !== 'string' || !ID.test(b.post) || typeof b.vid !== 'string' || !NONCE.test(b.vid) || typeof b.on !== 'boolean') throw fail(400, '요청 모양이 올바르지 않아요.');
  const s = await salt();
  if (b.on) {
    const ip = await ipHash(req);
    if (!await hit('bjh:' + ip, 86400, 500) || !await hit(`bjhp:${ip}:${b.post}`, 86400, 5)) return { ok: true, on: true, limited: true };
  }
  const voter = (await sha256hex(s + ':voter:' + b.vid)).slice(0, 40);
  const r: any = await q(db.rpc('bj_heart', { p_post: b.post, p_voter: voter, p_on: b.on, p_now: now }));
  if (!r?.ok) throw fail(404, '글을 찾을 수 없어요.');
  if (r.changed && typeof r.album === 'string') scheduleSnap(r.album);
  return { ok: true, on: b.on, hearts: r.hearts };
}

// ---- 방문자 수(누구나) ----
// visit {album, vid, peek} → {today, total}. 같은 브라우저(vid)는 앨범마다 하루(한국 날짜)에 한 번만 센다. peek:true(주인 기기)는 세지 않고 수만 준다.
async function visit(req: Request, now: number) {
  const b = await readJson(req, 1024);
  if (!isObj(b) || typeof b.vid !== 'string' || !NONCE.test(b.vid)) throw fail(400, '요청 모양이 올바르지 않아요.');
  const album = await albumRow(b.album === undefined ? LEGACY : b.album, now);
  const s = await salt();
  const count = b.peek !== true && await hit('bjv:' + await ipHash(req), 86400, 30);
  // 한이준 앨범은 예전과 같은 열쇠(오늘 이미 센 사람을 다시 세지 않게)
  const voter = (await sha256hex(s + ':visit:' + (album.id === LEGACY ? '' : album.id + ':') + b.vid)).slice(0, 40);
  const r: any = await q(db.rpc('bj_visit', { p_album: album.id, p_day: kstDay(now), p_voter: voter, p_count: count }));
  return { ok: true, today: Number(r?.today) || 0, total: Number(r?.total) || 0 };
}

// ---- 주소 → 앨범(누구나) ----
// GET host?h=<주소> → {album, name}. 사이트가 h/<주소>.json 을 못 찾았을 때 부른다(찾으면 그 파일을 만들어 다음부터는 파일로).
async function hostLookup(req: Request, now: number) {
  if (!await hit('bjhost:' + await ipHash(req), 60, 30)) throw fail(429, '너무 자주 불러왔어요. 잠깐 뒤에 다시 해 주세요.');
  const host = hostOf(new URL(req.url).searchParams.get('h'));
  const row: any = await q(db.from('bj_hosts').select('album').eq('host', host).maybeSingle());
  if (!row) throw fail(404, '없는 앨범이에요.');
  const album = await albumRow(row.album, now);
  await writeHost(host, album);
  return { ok: true, album: album.id, name: album.name || '' };
}

// ---- 운영자(앨범 만들기·주소·등록 코드·봇 기기) ----
// 머리말 x-junlive-admin = 사용 승인 관리자 키(서버엔 해시만 — junlive_admin_token_hash).
async function requireAdmin(req: Request) {
  const given = req.headers.get('x-junlive-admin') || '';
  const stored = await q(db.rpc('junlive_admin_token_hash', {}));
  const actual = given.length >= 32 ? await sha256hex(given) : '';
  let diff = actual.length === 64 && typeof stored === 'string' && stored.length === 64 ? 0 : 1;
  for (let i = 0; i < 64; i++) diff |= (actual.charCodeAt(i) || 0) ^ (typeof stored === 'string' ? stored.charCodeAt(i) || 0 : 0);
  if (diff !== 0) throw fail(403, '관리자 키가 맞지 않아요.');
}
async function admin(req: Request, now: number) {
  await requireAdmin(req);
  const b = await readJson(req, 8192);
  if (!isObj(b) || typeof b.action !== 'string') throw fail(400, '요청 모양이 올바르지 않아요.');
  const name = (v: unknown) => text(v, 40, '앨범 이름').replace(/\s*\n\s*/g, ' ');
  switch (b.action) {
    case 'list': {
      const [albums, hosts, devices, posts, bots]: any = await Promise.all([
        q(db.from('bj_albums').select('id,name,state,note,created').order('created', { ascending: true })),
        q(db.from('bj_hosts').select('host,album')),
        q(db.from('bj_devices').select('album,state')),
        q(db.from('bj_posts').select('album')),
        q(db.from('bj_bots').select('id,album,label'))
      ]);
      return {
        ok: true, albums: albums.map((a: any) => ({
          ...a,
          hosts: hosts.filter((h: any) => h.album === a.id).map((h: any) => h.host),
          owners: devices.filter((d: any) => d.album === a.id && d.state === 'approved').length,
          posts: posts.filter((x: any) => x.album === a.id).length,
          bots: bots.filter((x: any) => x.album === a.id).map((x: any) => ({ id: x.id.slice(0, 16), label: x.label }))
        }))
      };
    }
    case 'create': {
      if (typeof b.id !== 'string' || !ALBUM_RE.test(b.id)) throw fail(400, '앨범 번호는 영어 소문자로 시작하고 영어 소문자·숫자·- 로 2~31자예요.');
      if (await q(db.from('bj_albums').select('id').eq('id', b.id).maybeSingle())) throw fail(409, '이미 있는 앨범 번호예요.');
      const hosts = (Array.isArray(b.hosts) ? b.hosts : []).map(hostOf);
      for (const h of hosts) if (await q(db.from('bj_hosts').select('host').eq('host', h).maybeSingle())) throw fail(409, `이미 쓰는 주소예요: ${h}`);
      await q(db.from('bj_albums').insert({ id: b.id, name: name(b.name), note: text(b.note, 200, '메모'), created: now }));
      const album = await albumRow(b.id, now, true);
      for (const h of hosts) { await q(db.from('bj_hosts').insert({ host: h, album: album.id, created: now })); await writeHost(h, album); }
      await buildSnap(album.id, now);
      return { ok: true, album: { ...album, hosts } };
    }
    case 'set': {
      const album = await albumRow(b.id, now, true);
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch.name = name(b.name);
      if (b.note !== undefined) patch.note = text(b.note, 200, '메모');
      if (b.state !== undefined) { if (!['active', 'readonly'].includes(b.state)) throw fail(400, '상태가 올바르지 않아요.'); patch.state = b.state; }
      await q(db.from('bj_albums').update(patch).eq('id', album.id));
      const fresh = await albumRow(album.id, now, true);
      const hosts: any = await q(db.from('bj_hosts').select('host').eq('album', album.id));
      for (const h of hosts) await writeHost(h.host, fresh);
      await buildSnap(album.id, now);
      return { ok: true, album: fresh };
    }
    case 'host': {
      const album = await albumRow(b.id, now, true), h = hostOf(b.host);
      const had: any = await q(db.from('bj_hosts').select('album').eq('host', h).maybeSingle());
      if (had && had.album !== album.id) throw fail(409, `이미 다른 앨범이 쓰는 주소예요: ${h}`);
      if (!had) await q(db.from('bj_hosts').insert({ host: h, album: album.id, created: now }));
      await writeHost(h, album);
      return { ok: true, host: h };
    }
    case 'unhost': {
      const h = hostOf(b.host);
      await q(db.from('bj_hosts').delete().eq('host', h));
      await removeFiles([`h/${h}.json`]);
      return { ok: true, host: h };
    }
    case 'code': {
      // 주인 기기 등록 코드(DJ 에게 전한다). 처음 값: 7일 · 기기 2대(사용자에게 처음 줄 때와 같게)
      const album = await albumRow(b.id, now, true);
      const days = b.days === undefined ? 7 : Number(b.days), uses = b.uses === undefined ? 2 : Number(b.uses);
      if (!Number.isInteger(days) || days < 1 || days > 30 || !Number.isInteger(uses) || uses < 1 || uses > MAX_DEVICES) throw fail(400, '기간·기기 수가 올바르지 않아요.');
      const code = newCode();
      const value = { hash: await sha256hex('bj-code:' + code), expires: now + days * 86400000, uses: 0, max: uses, at: now };
      await setMeta(album.id, 'owner_code', value);
      return { ok: true, code: code.slice(0, 4) + '-' + code.slice(4), expires: value.expires, uses };
    }
    case 'bot': {
      // 그 DJ 의 먼치킨(승인 기기)을 이 앨범에 잇는다 — 최초 박제판이 저절로 올라온다. device = 기기 번호(앞 16자 이상)
      const album = await albumRow(b.id, now, true);
      if (typeof b.device !== 'string' || !/^[0-9a-f]{16,64}$/.test(b.device)) throw fail(400, '기기 번호가 올바르지 않아요.');
      const rows: any = await q(db.from('junlive_devices').select('id,nickname,tag').like('id', b.device + '%').eq('state', 'approved').limit(2));
      if (rows.length !== 1) throw fail(404, rows.length ? '기기 번호를 더 길게 넣어 주세요.' : '승인된 먼치킨 기기를 찾지 못했어요.');
      const d = rows[0];
      await q(db.from('bj_bots').upsert({ id: d.id, album: album.id, label: text(b.label, 40, '이름') || [d.nickname, d.tag && '@' + d.tag].filter(Boolean).join(' '), created: now }));
      return { ok: true, device: d.id.slice(0, 16) };
    }
    case 'unbot': {
      if (typeof b.device !== 'string' || !/^[0-9a-f]{16,64}$/.test(b.device)) throw fail(400, '기기 번호가 올바르지 않아요.');
      await q(db.from('bj_bots').delete().like('id', b.device + '%'));
      return { ok: true };
    }
    // ── 회원(운영자) ──
    case 'members': {
      const [rows, cs, rs]: any = await Promise.all([
        q(db.from('bj_members').select('id,login_id,kakao,nickname,verified,state,created,seen').order('created', { ascending: false }).limit(2000)),
        q(db.from('bj_comments').select('member').eq('state', 'visible').limit(50000)),
        q(db.from('bj_reports').select('bj_comments!inner(member)').limit(50000))
      ]);
      const count = (list: any[], key: (x: any) => string) => { const m = new Map<string, number>(); for (const x of list) m.set(key(x), (m.get(key(x)) || 0) + 1); return m; };
      const cm = count(cs, (x) => x.member), rm = count(rs, (x) => x.bj_comments?.member);
      return { ok: true, members: rows.map((m: any) => ({ id: m.id, nickname: m.nickname, loginId: m.login_id, kakao: Boolean(m.kakao), verified: Boolean(m.verified), state: m.state, created: m.created, seen: m.seen, comments: cm.get(m.id) || 0, reported: rm.get(m.id) || 0 })) };
    }
    case 'member-ban': case 'member-unban': {
      if (typeof b.member !== 'string' || !MID.test(b.member)) throw fail(400, '회원 번호가 올바르지 않아요.');
      const m: any = await q(db.from('bj_members').select('id,person').eq('id', b.member).maybeSingle());
      if (!m) throw fail(404, '회원을 찾을 수 없어요.');
      if (b.action === 'member-unban') {
        await q(db.from('bj_members').update({ state: 'active' }).eq('id', m.id));
        if (m.person) await q(db.from('bj_banned_people').delete().eq('person', m.person));
        return { ok: true };
      }
      await q(db.from('bj_members').update({ state: 'banned' }).eq('id', m.id));
      if (m.person) await q(db.from('bj_banned_people').upsert({ person: m.person, at: now, note: text(b.note, 200, '메모') }));
      await q(db.from('bj_sessions').delete().eq('member', m.id));
      // 그 회원 댓글을 모두 숨긴다
      const hidden: any = await q(db.from('bj_comments').update({ state: 'deleted', text: '', deleted_by: 'admin' }).eq('member', m.id).eq('state', 'visible').select('album'));
      for (const a of new Set(hidden.map((x: any) => x.album))) scheduleSnap(a as string);
      return { ok: true, hidden: hidden.length };
    }
  }
  throw fail(400, '모르는 요청이에요.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const route = new URL(req.url).pathname.replace(/^.*?\/bakje\/?/, '').replace(/\/+$/, '');
  const now = Date.now();
  try {
    if (req.method === 'GET' && route === 'health') return json(200, { ok: true, v: VERSION, kinds: KINDS, bot: true, donor: true, theme: true, visit: true, ends: true, albums: true, albumInfo: true, members: true });
    if (req.method === 'GET' && route === 'feed') {
      const ip = await ipHash(req);
      if (!await hit('bjf:' + ip, 60, 20)) throw fail(429, '너무 자주 불러왔어요. 잠깐 뒤에 다시 해 주세요.');
      const album = await albumRow(new URL(req.url).searchParams.get('album') || LEGACY, now);
      return json(200, { ok: true, snap: await buildSnap(album.id, now) });
    }
    if (req.method === 'GET' && route === 'host') return json(200, await hostLookup(req, now));
    if (req.method === 'GET' && route === 'members-config') return json(200, { ok: true, members: { password: true, kakao: kakaoReady(), verify: verifyReady() ? { storeId: env('PORTONE_STORE_ID'), channelKey: env('PORTONE_CHANNEL_KEY') } : null } });
    if (req.method === 'GET' && route === 'kakao-start') return await kakaoStart(req, now);
    if (req.method === 'GET' && route === 'kakao') return await kakaoBack(req, now);
    if (req.method === 'GET' && route === 'comments') return json(200, await commentsList(req, now));
    if (req.method === 'POST' && route === 'member') return json(200, await member(req, now));
    if (req.method === 'POST' && route === 'comment') return json(200, await comment(req, now));
    if (req.method === 'POST' && route === 'admin') return json(200, await admin(req, now));
    if (req.method === 'POST' && route === 'heart') return json(200, await heart(req, now));
    if (req.method === 'POST' && route === 'visit') return json(200, await visit(req, now));
    if (req.method === 'POST' && route === 'owner') return json(200, await owner(req, now));
    if (req.method === 'POST' && route === 'bot') return json(200, await bot(req, now));
    return json(404, { ok: false, error: '찾을 수 없어요.' });
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { ok: false, error: e.message });
    if (e instanceof Json409) return json(409, e.body);
    console.error(e);
    return json(500, { ok: false, error: BROKEN });
  }
});
