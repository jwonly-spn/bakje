// 추억앨범 베타테스터 10명 추가 모집 — Supabase Edge Function "bakje-beta" (verify_jwt false, v1 2026-11-25)
// bakje-billing 과 같은 일(needMember·labelOf·hostTaken·makeAlbum·line·hit·q·fail·CORS·json)을 이 파일 안에 복사해 두었다 — 정기결제(auto-renew) 합친 뒤 하나로.
//  (bakje-billing 은 정기결제 v7 이 크게 바꾸는 중이라 따로 둔다. 고칠 때는 두 곳을 같이 본다.)
// 흐름: 먼치킨.com/album 신청 화면 → photo-url 로 사진 올리기 주소를 받아 브라우저가 PUT(비공개 칸 bakje-beta, '<회원>/<12자>.<webp|jpg|png>')
//  → apply(스푼 닉네임·주소 이름·앨범 이름·하고 싶은 말·사진 3~10장 — 서버가 칸에 실제로 있는지·크기·형식을 다시 본다)
//  → 표 bj_beta_apps 한 줄(wait) + 운영자 DM 알림(jl_watch_alerts — 접수 봇이 5분마다 읽어 DM, 사진은 보내지 않음)
//  → 운영자 앱 "베타" 탭(ops-list: 사진은 1시간짜리 서명 보기 주소) → [뽑기](ops-pick: 잠금 함수 bj_beta_claim 으로 자리 → 앨범·주소·주인 · 12/31 까지 무료)
//     / [넘기기](ops-pass: 신청한 분 화면엔 모집이 끝날 때까지 "기다리는 중") · 10명째를 뽑으면 모집이 저절로 닫힘 · 모집이 끝나면 ops-purge 로 사진을 모두 지우고 안 뽑힌 신청은 줄째 지움(뽑힌 줄은 사진·하고 싶은 말만 비움).
// 모집 설정: bj_settings "beta" {open, seats, until, closedAt}. 열림 = open && 지금 <= until && 뽑힌 수 < seats. 시범 앨범 3개는 세지 않는다(뽑힌 신청만 셈).
// 회원 세션은 bakje 와 같은 x-bj-session(bj_sessions sha256). 표: 마이그레이션 20261125_bakje_beta(이 함수보다 먼저 적용).
// 주의: MCP 로 올릴 때 백슬래시-u 글자 표기가 풀려 버리므로 이 파일에는 그런 표기를 쓰지 않는다.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ==== 시험이 따로 읽는 곳 시작 ====
// 시험: tests/bakje-beta.test.mjs 가 이 사이만 잘라 가짜 DB·가짜 저장소로 돌린다(그 사이에는 Deno·바깥 모듈을 쓰지 않는다).
// db = supabase-js 손님(service_role) — makeHandler 가 넣는다.
let db: any = null;
const BROKEN = '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-bj-session',
  'Access-Control-Max-Age': '86400'
};
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
const enc = new TextEncoder();

class Fail extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const fail = (status: number, message: string) => new Fail(status, message);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
async function q<T = any>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) { console.error(error); throw fail(503, BROKEN); }
  return data;
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const rid = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => ALPHA[x & 31]).join('');
const hit = async (key: string, seconds: number, max: number) => Boolean(await q(db.rpc('fp_hit', { p_key: key, p_seconds: seconds, p_max: max })));
const line = (v: unknown, max: number) => typeof v === 'string' ? [...v.replace(/[\r\n\t]+/g, ' ')].filter((ch) => ch.charCodeAt(0) >= 32).join('').trim().slice(0, max) : '';
const chars = (s: string) => [...s].length;
const quiet = async (p: Promise<unknown>) => { try { await p; } catch (e) { console.error('조용히', e); } };

// ── 모집 ──
// 무료 끝(뽑힌 분의 앨범 paid_until · 추억앨범 이용권) = 2026-12-31 23:59:59(한국). 유료화(2027-01-01 0시)는 bakje-billing PAID_FROM 그대로.
const BETA_UNTIL = Date.parse('2026-12-31T23:59:59+09:00');
const SEATS = 10;
const MAX_BODY = 8192;                                  // 요청 몸통 8KB(바이트)
const BUCKET = 'bakje-beta';                            // 비공개 사진 칸(마이그레이션이 만든다 — 'bakje' 는 공개 칸이라 따로)
const PHOTO_MIN = 3, PHOTO_MAX = 10, PHOTO_BYTES = 5242880;
// 화면이 보내는 형식(type) → 확장자. 'image/webp' 꼴과 'webp' 꼴 둘 다 받는다(Map — 모르는 이름이 Object 의 숨은 칸에 걸리지 않게)
const PHOTO_EXT = new Map([['image/webp', 'webp'], ['webp', 'webp'], ['image/jpeg', 'jpg'], ['image/jpg', 'jpg'], ['jpeg', 'jpg'], ['jpg', 'jpg'], ['image/png', 'png'], ['png', 'png']]);
const PHOTO_MIME = /^image\/(?:webp|jpeg|png)$/;
const PHOTO_NAME = /^[a-z0-9]{12}\.(?:webp|jpg|png)$/;
const MEMBER_ID = /^[A-Za-z0-9_-]{1,40}$/;              // 사진 폴더 이름으로 쓰는 회원 번호(bj_members.id 는 m + 11자)
const VIEW_SECONDS = 3600;                              // 운영자 앱 사진 보기 주소 1시간
const OPS_APP = 'https://한이준.com/ops/';
const NOT_YET = '아직 모집을 시작하지 않았어요.';
const ENDED = '베타테스터 모집이 끝났어요.';
const HAS_ALBUM = '이미 추억앨범이 있어요.';
const PICKED = '이미 뽑혔어요.';
const OPS_ONLY = '운영자만 쓸 수 있어요.';
const PHOTO_FEW = '박제 사진·박제 편지를 3장 이상 올려 주세요.';
const PHOTO_MANY = '사진은 10장까지 올릴 수 있어요.';
const PHOTO_BAD = '사진 정보가 올바르지 않아요. 사진을 다시 올려 주세요.';
const PHOTO_MISSING = '아직 다 올라가지 않은 사진이 있어요. 사진을 다시 올려 주세요.';
const PHOTO_KIND = '사진은 5MB 이하의 jpg·png·webp 그림만 올릴 수 있어요.';
const CANT_PICK = '뽑을 수 없는 신청이에요(이미 뽑았거나 취소된 신청이에요).';

// ── 새 추억앨범 주소 이름(<이름>.먼치킨.com) — bakje-billing labelOf 와 같은 규칙 ──
// 한글·영어 소문자·숫자 1~15자, - 는 가운데에만. 주소는 퓨니코드 소문자(new URL 이 바꿔 준다).
const LABEL_RE = /^[가-힣a-z0-9](?:[가-힣a-z0-9-]{0,13}[가-힣a-z0-9])?$/;
const LABEL_RESERVED = new Set(['www', 'test', 'ops', 'api', 'admin', 'mail', 'help', 'app', 'dev', 'staging', 'album', '먼치킨', '운영자', '관리자', '추억앨범', '키우기', '공식', '스푼', 'spoon']);
const ALBUM_SUFFIX = '.xn--s22bu18a0ub.com';   // .먼치킨.com
const HOST_TAKEN_OPS = '주소가 이미 쓰이고 있어요 — 신청한 분이 다른 주소 이름으로 고쳐 다시 보내면 뽑을 수 있어요';
const TAKEN_OTHER = '다른 분이 먼저 신청한 주소예요. 다른 이름을 골라 주세요.';
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
// 주소가 쓰이고 있으면 그 까닭(빈 글 = 쓸 수 있음): 이미 있는 앨범 주소 · 다른 회원의 확인을 기다리는 이용권 신청(bj_orders)
//  · 다른 회원의 기다리는(wait·passed) 베타 신청 — 넘긴(passed) 신청도 다시 뽑을 수 있어 주소를 잡아 둔다
async function hostTaken(host: string, member: string) {
  if (await q(db.from('bj_hosts').select('host').eq('host', host).maybeSingle())) return '이미 쓰이고 있는 주소예요. 다른 이름을 골라 주세요.';
  const w: any = await q(db.from('bj_orders').select('member').eq('want_host', host).eq('state', 'pending').neq('member', member).limit(1));
  if (w.length) return TAKEN_OTHER;
  const b: any = await q(db.from('bj_beta_apps').select('member').eq('want_host', host).in('state', ['wait', 'passed']).neq('member', member).limit(1));
  if (b.length) return TAKEN_OTHER;
  return '';
}

// 로그인한 회원(bakje 와 같은 세션 표)
async function needMember(req: Request, now: number) {
  const token = req.headers.get('x-bj-session') || '';
  if (!/^[-_A-Za-z0-9]{43}$/.test(token)) throw fail(401, '다시 로그인해 주세요.');
  const s: any = await q(db.from('bj_sessions').select('member,expires').eq('token', await sha256hex(token)).maybeSingle());
  if (!s || s.expires < now) throw fail(401, '다시 로그인해 주세요.');
  const m: any = await q(db.from('bj_members').select('id,login_id,nickname,verified,state,is_admin').eq('id', s.member).maybeSingle());
  if (!m) throw fail(401, '다시 로그인해 주세요.');
  if (m.state === 'banned') throw fail(403, '이용이 막힌 계정이에요.');
  return m;
}

// 모집 설정(없거나 모양이 틀린 칸은 처음 값)
async function betaCfg() {
  const r: any = await q(db.from('bj_settings').select('value').eq('key', 'beta').maybeSingle());
  const v = isObj(r?.value) ? r.value : {};
  return {
    raw: v,
    open: v.open === true,
    seats: Number.isSafeInteger(v.seats) && v.seats > 0 && v.seats <= 1000 ? v.seats : SEATS,
    until: Number.isSafeInteger(v.until) && v.until > 0 ? v.until : BETA_UNTIL,
    closedAt: Number.isSafeInteger(v.closedAt) ? v.closedAt as number : null
  };
}
// 지금 모집 판: 설정 + 뽑힌 수 + 열림(open && 지금 <= until && 뽑힌 수 < seats)
async function board(now: number) {
  const [c, picked]: any = await Promise.all([betaCfg(), q(db.from('bj_beta_apps').select('id').eq('state', 'picked'))]);
  const n = picked.length;
  return { ...c, picked: n, left: Math.max(0, c.seats - n), isOpen: c.open && now <= c.until && n < c.seats };
}
type Board = Awaited<ReturnType<typeof board>>;
// 닫힌 까닭: 운영자가 아직 안 엶(closedAt 없음 · 기한 전 · 자리 남음) = 시작 전 · 그 밖(운영자가 닫음 · 12/31 지남 · 10명 다 뽑힘) = 끝
const closedMsg = (b: Board, now: number) => (!b.open && b.closedAt === null && now <= b.until && b.picked < b.seats ? NOT_YET : ENDED);
// 설정 고치기(모르는 칸은 그대로 둔다)
async function saveBeta(b: Board, change: Record<string, unknown>, now: number) {
  const value = { ...b.raw, open: b.open, seats: b.seats, until: b.until, closedAt: b.closedAt, ...change };
  await q(db.from('bj_settings').upsert({ key: 'beta', value, updated: now }));
  return value;
}

// 내 신청(mine): 표 상태 → 화면 상태. wait·passed → 모집 중이면 'wait', 닫혔으면 'closed' · picked → 'picked' · canceled·없음 → 'none'
async function mineOf(me: any, b: Board) {
  const [row, owns]: any = await Promise.all([
    q(db.from('bj_beta_apps').select('*').eq('member', me.id).maybeSingle()),
    q(db.from('bj_album_owners').select('album').eq('member', me.id).limit(1))]);
  const hasAlbum = owns.length > 0;
  const state = !row || row.state === 'canceled' ? 'none' : row.state === 'picked' ? 'picked' : b.isOpen ? 'wait' : 'closed';
  const out: Record<string, unknown> = { state, hasAlbum, canApply: b.isOpen && !hasAlbum && (state === 'none' || state === 'wait') };
  if (state !== 'none') out.app = { spoonNick: row.spoon_nick, label: row.want_label, name: row.want_name, msg: row.msg || '', photos: (row.photos || []).length, created: Number(row.created) };
  if (state === 'picked') out.album = { host: row.want_host, label: row.want_label };
  return out;
}
// 사진을 올리거나 신청할 수 있는가: 모집 열림 · 앨범 없음 · 아직 안 뽑힘 → 내 신청 줄(없으면 null)
async function gate(me: any, b: Board, now: number) {
  if (!b.isOpen) throw fail(400, closedMsg(b, now));
  const [row, owns]: any = await Promise.all([
    q(db.from('bj_beta_apps').select('*').eq('member', me.id).maybeSingle()),
    q(db.from('bj_album_owners').select('album').eq('member', me.id).limit(1))]);
  if (owns.length) throw fail(400, HAS_ALBUM);
  if (row?.state === 'picked') throw fail(400, PICKED);
  return row;
}

// ── 사진(비공개 칸 bakje-beta) ──
// 보낸 경로 검사: 내 폴더('<회원>/')의 '<12자>.<webp|jpg|png>' 만 · 같은 경로는 한 장 · 3~10장
function photosOf(v: unknown, member: string) {
  if (!Array.isArray(v)) throw fail(400, PHOTO_FEW);
  if (v.length > 50) throw fail(400, PHOTO_MANY);
  const out: string[] = [];
  for (const p of v) {
    if (typeof p !== 'string' || !p.startsWith(member + '/') || !PHOTO_NAME.test(p.slice(member.length + 1))) throw fail(400, PHOTO_BAD);
    if (!out.includes(p)) out.push(p);
  }
  if (out.length < PHOTO_MIN) throw fail(400, PHOTO_FEW);
  if (out.length > PHOTO_MAX) throw fail(400, PHOTO_MANY);
  return out;
}
// 칸 안 목록(폴더 하나 — '' 면 맨 위: 폴더는 id 가 없다). 1000개씩 넘겨 읽는다.
async function filesOf(folder: string) {
  const out: any[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const page: any = await q(db.storage.from(BUCKET).list(folder, { limit: 1000, offset }));
    const rows = Array.isArray(page) ? page : [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
// 서버가 다시 본다(화면이 보낸 장수·형식은 안 믿음): 칸에 실제로 있는지 · 5MB 이하 · image/webp|jpeg|png
async function checkStored(photos: string[], member: string) {
  const files = await filesOf(member);
  const byPath = new Map(files.filter((f) => f && f.id != null && typeof f.name === 'string').map((f) => [member + '/' + f.name, f]));
  for (const p of photos) {
    const f = byPath.get(p);
    if (!f) throw fail(400, PHOTO_MISSING);
    const size = Number(f.metadata?.size), type = String(f.metadata?.mimetype || '');
    if (!(size > 0 && size <= PHOTO_BYTES) || !PHOTO_MIME.test(type)) throw fail(400, PHOTO_KIND);
  }
}
async function removeFiles(paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) await q(db.storage.from(BUCKET).remove(paths.slice(i, i + 100)));
  return paths.length;
}
// 내 폴더에서 keep 에 없는 사진을 지운다(신청에서 뺀 사진 · 올리고 안 쓴 사진)
async function cleanFolder(member: string, keep: string[]) {
  const files = await filesOf(member);
  return removeFiles(files.filter((f) => f && f.id != null).map((f) => member + '/' + f.name).filter((p) => !keep.includes(p)));
}
// 운영자 앱 보기 주소(1시간) — 없어진 파일은 빠진다
async function viewUrls(paths: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 100) {
    const r: any = await q(db.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 100), VIEW_SECONDS));
    for (const x of Array.isArray(r) ? r : []) if (x && typeof x.signedUrl === 'string' && x.signedUrl && !x.error) out.set(x.path, x.signedUrl);
  }
  return out;
}
const appOut = (r: any, urls: Map<string, string>) => ({ id: r.id, nick: r.nick || '', spoonNick: r.spoon_nick, label: r.want_label, host: r.want_host, name: r.want_name, msg: r.msg || '',
  state: r.state, created: Number(r.created), decided: r.decided == null ? null : Number(r.decided), album: r.album ?? null,
  photos: ((r.photos || []) as string[]).map((p) => urls.get(p)).filter(Boolean) });
const appWithUrls = async (r: any) => appOut(r, await viewUrls(r.photos || []));

// 운영자 DM 알림(접수 봇이 jl_watch_alerts 를 읽어 보낸다) — 제목 한 줄 + 한 줄에 한 가지. 사진·사진 주소는 넣지 않는다.
//  제목에 번호는 없다(줄을 지우면 번호가 겹쳐서 — 고침 1회차). 수는 "지금 신청 A명 · 뽑힘 B명" 줄이 알려 준다.
async function alertApply(app: any, b: Board) {
  const rows: any[] = await q(db.from('bj_beta_apps').select('state'));
  const live = rows.filter((r) => r.state !== 'canceled').length, picked = rows.filter((r) => r.state === 'picked').length;
  const body = [
    `스푼 닉네임: ${app.spoon_nick}`,
    `원하는 주소: ${app.want_label}.먼치킨.com`,
    ...(app.msg ? [`하고 싶은 말: ${app.msg}`] : []),
    `첨부: 박제 사진 ${(app.photos || []).length}장 (운영자 앱에서 보기)`,
    `지금 신청 ${live}명 · 뽑힘 ${picked}명 / ${b.seats}명`,
    `운영자 앱: ${OPS_APP} → 베타`
  ].join('\n');
  await q(db.from('jl_watch_alerts').insert({ key: 'beta-apply', level: 'info', title: `🧪 추억앨범 베타 신청 — ${app.spoon_nick}`, body: body.slice(0, 1500) }));
}

// ── 새 추억앨범 만들기(운영자가 뽑을 때) — bakje-billing makeAlbum 과 같은 일 ──
// 앨범(bj_albums, 결제 끝나는 날 = 12/31 무료 끝) → 주소(bj_hosts) → 사이트가 읽는 주소 파일(공개 칸 bakje 의 h/<주소>.json — bakje writeHost 와 같은 모양)
//  → 주인(신청한 계정, bj_album_owners) → 그 계정을 DJ 로 → 신청에 새 앨범 번호 → 그 계정의 먼치킨(봇 프로그램 중 사용 승인된 가장 최근 기기)을 bj_bots 에 잇기
//  → 추억앨범 이용권 = max(있던 값, 12/31 무료 끝). 중간에 실패하면 만든 것을 지운다(앨범을 지우면 주소·주인·봇 줄은 함께 지워진다).
async function makeAlbum(a: any, now: number) {
  const host = String(a.want_host || '');
  if (!host.endsWith(ALBUM_SUFFIX)) throw fail(409, HOST_TAKEN_OPS);
  if (await q(db.from('bj_hosts').select('host').eq('host', host).maybeSingle())) throw fail(409, HOST_TAKEN_OPS);
  const name = line(a.want_name, 40) || '추억앨범';
  let id = '';
  for (let i = 0; i < 5 && !id; i++) {
    const cand = 'a' + rid(9);   // ALBUM_RE ^[a-z][a-z0-9-]{1,30}$ 에 맞는 번호
    const { error } = await db.from('bj_albums').insert({ id: cand, name, note: '베타테스터 ' + a.id, created: now, paid_until: BETA_UNTIL });
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
    await q(db.from('bj_album_owners').upsert({ album: id, member: a.member, created: now }));
    await q(db.from('bj_members').update({ role: 'dj' }).eq('id', a.member));
    await q(db.from('bj_beta_apps').update({ album: id }).eq('id', a.id));
    const devs: any[] = await q(db.from('bj_member_devices').select('device,seen').eq('member', a.member).eq('program', 'bot').order('seen', { ascending: false }).limit(20));
    if (devs.length) {
      const ok: any[] = await q(db.from('junlive_devices').select('id,nickname,tag').in('id', devs.map((d) => d.device)).eq('state', 'approved'));
      const pick = devs.map((d) => ok.find((x) => x.id === d.device)).find(Boolean);
      if (pick) await q(db.from('bj_bots').upsert({ id: pick.id, album: id, label: [pick.nickname, pick.tag && '@' + pick.tag].filter(Boolean).join(' ').slice(0, 40), created: now }));
    }
    const e: any = await q(db.from('bj_entitlements').select('until').eq('member', a.member).eq('product', 'album').maybeSingle());
    await q(db.from('bj_entitlements').upsert({ member: a.member, product: 'album', until: Math.max(Number(e?.until) || 0, BETA_UNTIL) }));
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
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY) throw fail(413, '보낸 내용이 너무 커요.');
  const raw = await req.text();
  if (enc.encode(raw).length > MAX_BODY) throw fail(413, '보낸 내용이 너무 커요.');
  let b: any; try { b = JSON.parse(raw); } catch { throw fail(400, '요청 모양이 올바르지 않아요.'); }
  if (!isObj(b) || typeof b.action !== 'string') throw fail(400, '요청 모양이 올바르지 않아요.');
  // 모집 상황(누구나 — 남은 자리만, 신청한 사람 이름은 없음). 세션이 있으면 내 신청도(틀린 세션이면 mine null — 401 아님)
  //  closedAt: 설정 값(없으면 null) — 화면이 "모집이 끝났어요"와 "아직 시작하지 않았어요"를 가른다(고침 1회차)
  if (b.action === 'status') {
    const bd = await board(now);
    let me: any = null;
    try { me = await needMember(req, now); } catch (e) { if (!(e instanceof Fail) || e.status >= 500) throw e; }
    return { ok: true, open: bd.isOpen, seats: bd.seats, picked: bd.picked, left: bd.left, until: bd.until, closedAt: bd.closedAt, mine: me ? await mineOf(me, bd) : null };
  }
  const me = await needMember(req, now);
  switch (b.action) {
    // 사진 올리기 주소(한 장에 하나): 경로 '<회원>/<12자>.<webp|jpg|png>' · url = 서명 올리기 주소(2시간 — 화면이 PUT 으로 파일 몸통, Content-Type 그림 형식)
    case 'photo-url': {
      const bd = await board(now);
      await gate(me, bd, now);
      if (!MEMBER_ID.test(String(me.id))) { console.error('회원 번호 모양이 달라요'); throw fail(503, BROKEN); }
      const ext = typeof b.type === 'string' ? PHOTO_EXT.get(b.type.trim().toLowerCase()) : undefined;
      if (!ext) throw fail(400, '사진은 jpg·png·webp 그림만 올릴 수 있어요.');
      if (!await hit('bjbp:' + me.id, 3600, 60)) throw fail(429, '사진을 너무 많이 올렸어요. 조금 뒤에 다시 해 주세요.');
      const path = `${me.id}/${rid(12)}.${ext}`;
      const up: any = await q(db.storage.from(BUCKET).createSignedUploadUrl(path));
      if (!up || typeof up.signedUrl !== 'string' || !up.signedUrl.startsWith('https://')) { console.error('서명 올리기 주소가 없어요'); throw fail(503, BROKEN); }
      return { ok: true, path, url: up.signedUrl };
    }
    // 신청(처음 · 다시 보내기). 기다림·넘김이면 같은 줄을 고친다(알림 다시 안 감) · 취소했던 줄이면 새 신청으로(알림 감) · 뽑혔으면 못 고침
    case 'apply': {
      const bd = await board(now);
      const row = await gate(me, bd, now);
      const spoonNick = line(b.spoonNick, 100);
      if (chars(spoonNick) < 1 || chars(spoonNick) > 20) throw fail(400, '스푼 닉네임을 1~20자로 적어 주세요.');
      const n = labelOf(b.label);
      if (n.reason) throw fail(400, n.reason);
      const name = line(b.name, 200) || `${spoonNick} 추억앨범`;
      if (chars(name) < 2 || chars(name) > 40) throw fail(400, '앨범 이름은 2~40자로 정해 주세요.');
      const msg = line(b.msg, 1000);
      if (chars(msg) > 100) throw fail(400, '하고 싶은 말은 100자까지 적을 수 있어요.');
      const photos = photosOf(b.photos, me.id);
      if (!await hit('bjba:' + me.id, 3600, 10)) throw fail(429, '신청을 너무 자주 보냈어요. 조금 뒤에 다시 해 주세요.');
      const taken = await hostTaken(n.host, me.id);
      if (taken) throw fail(409, taken);
      await checkStored(photos, me.id);
      const fields = { nick: me.nickname || '', spoon_nick: spoonNick, want_label: n.label, want_host: n.host, want_name: name, msg: msg || null, photos };
      let saved: any, fresh = false;
      if (row && row.state !== 'canceled') {
        const r: any = await q(db.from('bj_beta_apps').update(fields).eq('id', row.id).in('state', ['wait', 'passed']).select('*'));
        if (!r?.[0]) throw fail(409, '신청 상태가 바뀌었어요. 화면을 새로 고쳐 주세요.');
        saved = r[0];
      } else if (row) {
        const r: any = await q(db.from('bj_beta_apps').update({ ...fields, state: 'wait', created: now, decided: null, album: null }).eq('id', row.id).eq('state', 'canceled').select('*'));
        if (!r?.[0]) throw fail(409, '신청 상태가 바뀌었어요. 화면을 새로 고쳐 주세요.');
        saved = r[0]; fresh = true;
      } else {
        const ins = { id: 'b' + rid(11), member: me.id, ...fields, state: 'wait', created: now };
        const { error } = await db.from('bj_beta_apps').insert(ins);
        if (error) { if (error.code === '23505') throw fail(409, '조금 전에 보낸 신청이 있어요. 화면을 새로 고쳐 주세요.'); console.error(error); throw fail(503, BROKEN); }
        saved = ins; fresh = true;
      }
      await quiet(cleanFolder(me.id, photos));            // 신청에서 뺀 사진 · 올리고 안 쓴 사진 지우기(실패해도 신청은 됨 — 모집 끝 정리 때 지워짐)
      if (fresh) await quiet(alertApply(saved, bd));      // 운영자 DM(실패해도 신청은 됨 — 운영자 앱에는 보임)
      return { ok: true, mine: await mineOf(me, bd) };
    }
    // 신청 취소: 상태를 먼저 조건부로 바꾸고(wait·passed → canceled — 그 뒤엔 뽑을 수 없음) 실제로 바뀐 때만 내 폴더 사진을 지운다(고침 1회차).
    //  그사이 뽑혔으면 400 이미 뽑혔어요(사진은 그대로). 신청이 없거나 이미 취소면 아무것도 지우지 않고 그대로 답한다.
    //  사진 지우기가 실패해도 취소는 된 것 — 남은 사진은 다음 신청 때·모집 끝 정리(ops-purge) 때 지워진다.
    case 'cancel': {
      const r: any = await q(db.from('bj_beta_apps').update({ state: 'canceled', decided: now, photos: [] }).eq('member', me.id).in('state', ['wait', 'passed']).select('id'));
      if (r?.[0]) { if (MEMBER_ID.test(String(me.id))) await quiet(cleanFolder(me.id, [])); }
      else {
        const row: any = await q(db.from('bj_beta_apps').select('state').eq('member', me.id).maybeSingle());
        if (row?.state === 'picked') throw fail(400, PICKED);
      }
      return { ok: true, mine: await mineOf(me, await board(now)) };
    }
  }
  // ── 운영자(bj_members.is_admin) ──
  if (b.action.startsWith('ops-') && me.is_admin !== true) throw fail(403, OPS_ONLY);
  switch (b.action) {
    case 'ops-list': {
      const [bd, rows]: any = await Promise.all([board(now), q(db.from('bj_beta_apps').select('*').order('created', { ascending: false }).limit(300))]);
      const urls = await viewUrls(rows.flatMap((r: any) => r.photos || []));
      return { ok: true, open: bd.isOpen, seats: bd.seats, picked: bd.picked, left: bd.left, until: bd.until, closedAt: bd.closedAt, apps: rows.map((r: any) => appOut(r, urls)) };
    }
    // 뽑기: 자리 잡기(잠금 함수 — 한 번에 하나, seats 넘으면 'full') → 앨범 만들기 → 실패하면 기다림으로 되돌림. 10명째면 모집이 저절로 닫힌다.
    case 'ops-pick': {
      const id = String(b.id || '');
      const app: any = await q(db.from('bj_beta_apps').select('*').eq('id', id).maybeSingle());
      if (!app) throw fail(404, '신청을 찾을 수 없어요.');
      if (app.state !== 'wait' && app.state !== 'passed') throw fail(409, CANT_PICK);
      const owns: any = await q(db.from('bj_album_owners').select('album').eq('member', app.member).limit(1));
      if (owns.length) throw fail(409, '이미 추억앨범이 있는 분이에요. 넘기기를 눌러 주세요.');
      const c = await betaCfg();
      const got = await q(db.rpc('bj_beta_claim', { p_id: id, p_seats: c.seats, p_now: now }));
      if (got === 'full') throw fail(409, `${c.seats}명이 다 뽑혔어요.`);
      if (got !== 'ok') throw fail(409, CANT_PICK);
      // 자리를 잡은 뒤 다시 읽는다: 위에서 읽은 뒤 신청한 분이 주소·이름을 고쳤을 수 있다(picked 가 된 뒤로는 고칠 수 없음)
      //  · 그사이 다른 길(이용권 신청 확인)로 앨범이 생긴 회원이면 되돌림
      try {
        const cur: any = await q(db.from('bj_beta_apps').select('*').eq('id', id).maybeSingle());
        if (!cur || cur.state !== 'picked') throw fail(409, CANT_PICK);
        const owned: any = await q(db.from('bj_album_owners').select('album').eq('member', cur.member).limit(1));
        if (owned.length) throw fail(409, '이미 추억앨범이 있는 분이에요. 넘기기를 눌러 주세요.');
        await makeAlbum(cur, now);
      }
      catch (e) {
        const { error } = await db.from('bj_beta_apps').update({ state: 'wait', decided: null, album: null }).eq('id', id).eq('state', 'picked');
        if (error) console.error('되돌리기', error);
        throw e;
      }
      let bd = await board(now);
      const closed = bd.picked >= bd.seats;
      if (closed && (bd.open || bd.closedAt === null)) { await saveBeta(bd, { open: false, closedAt: now }, now); bd = await board(now); }
      const fresh: any = await q(db.from('bj_beta_apps').select('*').eq('id', id).maybeSingle());
      return { ok: true, app: await appWithUrls(fresh || app), left: bd.left, closed };
    }
    // 넘기기(신청한 분 화면엔 모집이 끝날 때까지 "기다리는 중") · 되돌리기(넘긴 것을 기다림으로)
    case 'ops-pass': {
      const r: any = await q(db.from('bj_beta_apps').update({ state: 'passed', decided: now }).eq('id', String(b.id || '')).eq('state', 'wait').select('*'));
      if (!r?.[0]) throw fail(404, '넘길 신청을 찾을 수 없어요(이미 처리했을 수 있어요).');
      return { ok: true, app: await appWithUrls(r[0]) };
    }
    case 'ops-wait': {
      const r: any = await q(db.from('bj_beta_apps').update({ state: 'wait', decided: null }).eq('id', String(b.id || '')).eq('state', 'passed').select('*'));
      if (!r?.[0]) throw fail(404, '되돌릴 신청을 찾을 수 없어요(이미 처리했을 수 있어요).');
      return { ok: true, app: await appWithUrls(r[0]) };
    }
    // 모집 열기·닫기: 열면 closedAt 비움(시작 전/끝 구분은 closedAt) · 닫으면 closedAt = 지금(이미 닫혀 있으면 그대로)
    case 'ops-open': {
      if (typeof b.open !== 'boolean') throw fail(400, '모집을 열지 닫을지 정해 주세요.');
      const bd = await board(now);
      await saveBeta(bd, b.open ? { open: true, closedAt: null } : { open: false, closedAt: bd.closedAt ?? now }, now);
      const after = await board(now);
      return { ok: true, open: after.isOpen, closedAt: after.closedAt };
    }
    // 모집 끝 정리 — 모집이 끝났을 때만(설정 open false + closedAt 있음. 시작 전·열려 있으면 400). 컨트롤러 판정(고침 1회차):
    //  ① 칸 안 사진을 모두 지운다(뽑힌 분 것·신청하지 않고 올리기만 한 것까지 — 앨범에 저절로 올리지 않음). 못 지우면 503, 표는 그대로.
    //  ② 뽑힌 줄은 사진·하고 싶은 말만 비운다(스푼 닉네임·주소·앨범 이름은 앨범 정보로 남김).
    //  ③ 안 뽑힌 줄(기다림·넘김·취소)은 줄째 지운다 — 그 회원은 다음 모집에 다시 신청할 수 있다(회원마다 한 줄).
    //  removed = 지운 사진 수.
    case 'ops-purge': {
      const c = await betaCfg();
      if (c.open || c.closedAt === null) throw fail(400, '모집이 끝난 뒤에 정리할 수 있어요.');
      let removed = 0;
      for (const f of await filesOf('')) {
        if (!f || typeof f.name !== 'string' || !f.name) continue;
        if (f.id == null) removed += await removeFiles((await filesOf(f.name)).filter((x) => x && x.id != null).map((x) => f.name + '/' + x.name));
        else removed += await removeFiles([f.name]);
      }
      await q(db.from('bj_beta_apps').update({ photos: [], msg: null }).eq('state', 'picked'));
      await q(db.from('bj_beta_apps').delete().in('state', ['wait', 'passed', 'canceled']));
      return { ok: true, removed };
    }
  }
  throw fail(400, '모르는 요청이에요.');
}

function makeHandler(deps: { db: any; clock?: () => number }) {
  db = deps.db;
  const clock = deps.clock || Date.now;
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const route = new URL(req.url).pathname.replace(/^.*?\/bakje-beta\/?/, '').replace(/\/+$/, '');
    try {
      if (req.method === 'GET' && route === 'health') return json(200, { ok: true, v: 1 });
      if (req.method === 'POST' && (route === '' || route === 'api')) return json(200, await handle(req, clock()));
      return json(404, { ok: false, error: '찾을 수 없어요.' });
    } catch (e) {
      if (e instanceof Fail) return json(e.status, { ok: false, error: e.message });
      console.error(e);
      return json(500, { ok: false, error: BROKEN });
    }
  };
}
// ==== 시험이 따로 읽는 곳 끝 ====

Deno.serve(makeHandler({
  db: createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
}));
