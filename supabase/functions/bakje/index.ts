// 박제관 — Supabase Edge Function "bakje" (verify_jwt false).
// 보는 사람은 로그인하지 않는다(목록은 공개 버킷의 snap/feed.json, 하트만 이 함수로).
// 글쓰기는 "주인 기기"만: 브라우저가 만든 P-256 열쇠로 서명(BAKJE/1). 처음 등록은 등록 코드로.
// 표·버킷: supabase/schema.sql (bj_devices·bj_posts·bj_hearts·bj_meta, 버킷 bakje).
// 최초 박제판(2026-11-03): 글 종류 first(1:1). 먼치킨 봇(개인용)의 최초 박제판이 저절로 올라온다 — POST bot, 머리말 JUN-LIVE-BAKJE/1,
//  서명 열쇠 = 먼치킨의 승인 기기 키(junlive_devices approved) + 추억앨범 봇 목록(bj_bots)에 있는 기기만. 판마다 글 하나(src), 이름이 더 채워지면 사진만 바꾼다.
//  주인이 그 글을 지우면 bj_bot_gone 에 남겨 다시 만들지 않는다(봇이 again:true 로 부를 때만 다시).
// 후원자 닉네임·스푼 테마(2026-11-03, v3): 글마다 donor·theme 한 줄씩(주인이 적음) — donor 는 사진 왼쪽 위와 글 칸, theme 은 글 칸에 보인다.
// 주의: MCP 로 올릴 때 백슬래시-u 글자 표기가 풀려 버리므로 이 파일에는 그런 표기를 쓰지 않는다.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const VERSION = 3, BUCKET = 'bakje', PREFIX = 'BAKJE/1', BOT_PREFIX = 'JUN-LIVE-BAKJE/1';
const KINDS = ['board', 'first', 'letter'];
const BOT_ACTIONS = new Set(['board-begin', 'board-save']);
const BOARD_REF = /^[a-z0-9][a-z0-9-]{0,47}$/; // 먼치킨 판 번호(+ "-g<몇 번째 글>")
const BROKEN = '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.';
const MAX_PHOTOS = 10, MAX_DEVICES = 10;
const PAPERS = ['cream', 'rose', 'sky', 'lilac', 'mint'];
const ACTIONS = new Set(['register', 'me', 'devices', 'revoke', 'newcode', 'upload', 'post', 'edit', 'pin', 'delete', 'profile']);
const ID = /^[a-z2-9]{10}$/, NONCE = /^[-_A-Za-z0-9]{32}$/;
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32글자
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 I·L·O·0·1 뺌
const KST = 9 * 3600000;
const enc = new TextEncoder();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info',
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

let saltPromise: Promise<string> | null = null;
const salt = () => (saltPromise ||= q(db.from('junlive_secrets').select('value').eq('key', 'ip_salt').maybeSingle())
  .then((r: any) => { if (!r?.value) throw fail(503, BROKEN); return r.value as string; })
  .catch((e) => { saltPromise = null; throw e; }));
const ipOf = (req: Request) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
const ipHash = async (req: Request) => (await sha256hex((await salt()) + ':ip:' + ipOf(req))).slice(0, 32);
const hit = async (key: string, seconds: number, max: number) => Boolean(await q(db.rpc('fp_hit', { p_key: key, p_seconds: seconds, p_max: max })));
const getMeta = async (key: string) => ((await q(db.from('bj_meta').select('value').eq('key', key).maybeSingle())) as any)?.value ?? null;
const setMeta = (key: string, value: unknown) => q(db.from('bj_meta').upsert({ key, value }));

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
async function buildSnap(now: number) {
  const [posts, profile] = await Promise.all([
    q(db.from('bj_posts').select('id,kind,caption,letter,photos,at,pinned,hearts,extra,donor,theme').order('pinned', { ascending: false }).order('at', { ascending: false }).order('created', { ascending: false }).limit(3000)),
    getMeta('profile')
  ]);
  // extra: 먼치킨이 올린 최초 박제판의 판 이름·채운 칸 수({title, filled, total, bot}) — 그 밖의 글은 빼서 작게
  // donor·theme: 주인이 적은 후원자 닉네임·스푼 테마 이름 — 없으면 뺀다
  const out = (posts as any[]).map(({ extra, donor, theme, ...p }) => ({
    ...p, ...(donor ? { donor } : {}), ...(theme ? { theme } : {}),
    ...(isObj(extra) ? { extra: { title: extra.title || '', filled: extra.filled || 0, total: extra.total || 0, bot: extra.bot === true } } : {})
  }));
  const snap = { v: VERSION, snapAt: now, profile: profileOut(profile), posts: out };
  const { error } = await storage().upload('snap/feed.json', new Blob([JSON.stringify(snap)], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '10' });
  if (error) console.error('snap', error.message);
  lastSnap = now;
  return snap;
}
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
let lastSnap = 0, snapLater: Promise<unknown> | null = null;
// 하트가 몰려도 3초에 한 번만 다시 쓴다
function scheduleSnap() {
  if (snapLater) return;
  const wait = Math.max(0, lastSnap + 3000 - Date.now());
  snapLater = new Promise((r) => setTimeout(r, wait)).then(() => buildSnap(Date.now())).catch((e) => console.error(e)).finally(() => { snapLater = null; });
  try { EdgeRuntime?.waitUntil(snapLater); } catch { /* local */ }
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
  const dev: any = await q(db.from('bj_devices').select('id,state,label,created,seen').eq('id', id).maybeSingle());

  if (body.action === 'me') return { ok: true, state: dev?.state || 'none', label: dev?.label || '' };
  if (body.action === 'register') {
    if (dev?.state === 'approved') return { ok: true, state: 'approved' };
    const ip = await ipHash(req);
    if (!await hit('bjc:' + ip, 3600, 10)) throw fail(429, '여러 번 틀렸어요. 1시간 뒤에 다시 해 주세요.');
    const code = normCode(p.code);
    if (code.length !== 8) throw fail(400, '등록 코드 8자리를 넣어 주세요.');
    const c = await getMeta('owner_code');
    if (!c || c.expires < now || c.uses >= c.max || c.hash !== await sha256hex('bj-code:' + code)) throw fail(403, '등록 코드가 맞지 않거나 시간이 지났어요.');
    const used: any = await q(db.from('bj_meta').update({ value: { ...c, uses: c.uses + 1 } }).eq('key', 'owner_code').eq('value->>uses', String(c.uses)).select('key'));
    if (!used?.length) throw fail(409, '잠깐 겹쳤어요. 다시 해 주세요.');
    const count: any = await q(db.from('bj_devices').select('id').eq('state', 'approved'));
    if (count.length >= MAX_DEVICES) throw fail(400, `주인 기기는 ${MAX_DEVICES}개까지예요. 안 쓰는 기기를 먼저 막아 주세요.`);
    await q(db.from('bj_devices').upsert({ id, public_key: body.publicKey, label: text(p.label, 40, '기기 이름') || '내 기기', state: 'approved', created: dev?.created ?? now, seen: now }));
    return { ok: true, state: 'approved' };
  }
  if (!dev || dev.state !== 'approved') throw fail(403, '주인 기기로 등록되지 않았어요.');
  if (!await hit('bjo:' + id, 60, 120)) throw fail(429, '너무 빨라요. 잠깐 뒤에 다시 해 주세요.');
  if (now - Number(dev.seen || 0) > 60000) await q(db.from('bj_devices').update({ seen: now }).eq('id', id));

  switch (body.action) {
    case 'devices': {
      const rows: any = await q(db.from('bj_devices').select('id,label,state,created,seen').order('created', { ascending: true }));
      return { ok: true, me: id, devices: rows };
    }
    case 'revoke': {
      if (typeof p.id !== 'string' || !/^[0-9a-f]{64}$/.test(p.id)) throw fail(400, '기기를 다시 골라 주세요.');
      await q(db.from('bj_devices').update({ state: 'revoked' }).eq('id', p.id));
      return { ok: true };
    }
    case 'newcode': {
      const code = newCode();
      const value = { hash: await sha256hex('bj-code:' + code), expires: now + 30 * 60000, uses: 0, max: 1, at: now };
      await setMeta('owner_code', value);
      return { ok: true, code: code.slice(0, 4) + '-' + code.slice(4), expires: value.expires };
    }
    case 'upload': {
      if (!await hit('bju:' + id, 3600, 300)) throw fail(429, '한 시간에 올릴 수 있는 사진을 넘었어요. 조금 뒤에 다시 해 주세요.');
      if (p.avatar === true) return { ok: true, files: [{ full: await signedUpload(`a/${rid(12)}.jpg`) }] };
      const count = Number(p.count);
      if (!Number.isInteger(count) || count < 1 || count > MAX_PHOTOS) throw fail(400, `사진은 한 번에 ${MAX_PHOTOS}장까지예요.`);
      let post = p.post;
      if (post !== undefined) {
        if (typeof post !== 'string' || !ID.test(post) || !await q(db.from('bj_posts').select('id').eq('id', post).maybeSingle())) throw fail(404, '글을 찾을 수 없어요.');
      } else post = rid(10);
      const files = [];
      for (let i = 0; i < count; i++) {
        const base = `p/${post}/${rid(8)}`;
        files.push({ full: await signedUpload(base + '.jpg'), thumb: await signedUpload(base + '-t.jpg') });
      }
      return { ok: true, post, files };
    }
    case 'post': {
      if (typeof p.id !== 'string' || !ID.test(p.id)) throw fail(400, '글 번호가 올바르지 않아요.');
      if (await q(db.from('bj_posts').select('id').eq('id', p.id).maybeSingle())) throw fail(409, '이미 올린 글이에요.');
      const photos = photosOf(p.photos, p.id, Array.isArray(p.photos) && p.photos.length ? await listFolder('p/' + p.id) : new Set());
      const letter = p.kind === 'letter' ? letterOf(p.letter) : null;
      checkPost(p.kind, photos, letter);
      await q(db.from('bj_posts').insert({ id: p.id, kind: p.kind, caption: text(p.caption, 2200, '글'), donor: lineOf(p.donor, '후원자 닉네임'), theme: lineOf(p.theme, '스푼 테마'), letter, photos, at: atOf(p.day, now), created: now, updated: now, pinned: p.pinned === true }));
      return { ok: true, id: p.id, snap: await buildSnap(now) };
    }
    case 'edit': {
      if (typeof p.id !== 'string' || !ID.test(p.id)) throw fail(400, '글 번호가 올바르지 않아요.');
      const old: any = await q(db.from('bj_posts').select('id,photos,at').eq('id', p.id).maybeSingle());
      if (!old) throw fail(404, '글을 찾을 수 없어요.');
      const exists = await listFolder('p/' + p.id);
      const photos = photosOf(p.photos, p.id, exists);
      const letter = p.kind === 'letter' ? letterOf(p.letter) : null;
      checkPost(p.kind, photos, letter);
      await q(db.from('bj_posts').update({ kind: p.kind, caption: text(p.caption, 2200, '글'), donor: lineOf(p.donor, '후원자 닉네임'), theme: lineOf(p.theme, '스푼 테마'), letter, photos, at: atOf(p.day, now, Number(old.at)), updated: now, pinned: p.pinned === true }).eq('id', p.id));
      // 빠진 사진과, 올렸다가 쓰지 않은 사진을 지운다
      const keep = new Set(photos.flatMap((x) => [x.f, x.t]));
      await removeFiles([...exists].filter((x) => !keep.has(x)));
      return { ok: true, id: p.id, snap: await buildSnap(now) };
    }
    case 'pin': {
      if (typeof p.id !== 'string' || !ID.test(p.id)) throw fail(400, '글 번호가 올바르지 않아요.');
      await q(db.from('bj_posts').update({ pinned: p.pinned === true, updated: now }).eq('id', p.id));
      return { ok: true, snap: await buildSnap(now) };
    }
    case 'delete': {
      if (typeof p.id !== 'string' || !ID.test(p.id)) throw fail(400, '글 번호가 올바르지 않아요.');
      // 먼치킨이 올린 최초 박제판이면 지운 것을 남겨 둔다(다음에 이름이 더 채워져도 다시 만들지 않게)
      const old: any = await q(db.from('bj_posts').select('src').eq('id', p.id).maybeSingle());
      if (old?.src) await q(db.from('bj_bot_gone').upsert({ src: old.src, at: now }));
      await q(db.from('bj_posts').delete().eq('id', p.id));
      await removeFiles([...await listFolder('p/' + p.id)]);
      return { ok: true, snap: await buildSnap(now) };
    }
    case 'profile': {
      const old = (await getMeta('profile')) || {};
      let link = text(p.link, 300, '링크');
      if (link && !/^https:\/\/[^\s]+$/i.test(link)) throw fail(400, '링크는 https:// 로 시작해야 해요.');
      let avatar = old.avatar || '';
      if (p.avatar !== undefined) {
        if (p.avatar === '' || p.avatar === null) avatar = '';
        else if (typeof p.avatar === 'string' && /^a\/[a-z2-9]{12}\.jpg$/.test(p.avatar)) {
          if (!(await listFolder('a')).has(p.avatar)) throw fail(400, '프로필 사진이 아직 올라가지 않았어요. 다시 해 주세요.');
          avatar = p.avatar;
        } else throw fail(400, '프로필 사진 정보가 올바르지 않아요.');
      }
      await setMeta('profile', { name: text(p.name, 30, '이름'), bio: text(p.bio, 300, '소개'), link, avatar, updated: now });
      if (old.avatar && old.avatar !== avatar) await removeFiles([old.avatar]);
      return { ok: true, snap: await buildSnap(now) };
    }
  }
  throw fail(400, '모르는 요청이에요.');
}

// ---- 먼치킨 봇(최초 박제판 저절로 올리기) ----
// board-begin {board, hash, again} → 지운 글이면 {gone:true}, 아니면 그 판의 글 번호와 그림 두 장(큰·작은)의 올리기 주소
// board-save {board, post, f, w, h, title, filled, total, hash} → 처음이면 새 글(최초 박제판, 오늘 날짜), 있으면 사진만 바꾼다(글·날짜·고정은 주인이 고친 그대로)
async function bot(req: Request, now: number) {
  const body = await readJson(req, 16384);
  const id = await verify(body, now, BOT_PREFIX, BOT_ACTIONS);
  const [dev, allow]: any = await Promise.all([
    q(db.from('junlive_devices').select('state').eq('id', id).maybeSingle()),
    q(db.from('bj_bots').select('id').eq('id', id).maybeSingle())
  ]);
  if (dev?.state !== 'approved' || !allow) throw fail(403, '추억앨범에 올릴 수 있는 먼치킨이 아니에요.');
  if (!await hit('bjb:' + id, 3600, 240)) throw fail(429, '한 시간에 올릴 수 있는 만큼 넘었어요. 조금 뒤에 다시 올려요.');
  const p = isObj(body.payload) ? body.payload : {};
  if (typeof p.board !== 'string' || !BOARD_REF.test(p.board)) throw fail(400, '박제판 번호가 올바르지 않아요.');
  const src = `fb:${id.slice(0, 16)}:${p.board}`;
  if (p.again === true) await q(db.from('bj_bot_gone').delete().eq('src', src));
  const [gone, post]: any = await Promise.all([
    q(db.from('bj_bot_gone').select('src').eq('src', src).maybeSingle()),
    q(db.from('bj_posts').select('id,photos').eq('src', src).maybeSingle())
  ]);
  if (gone) return { ok: true, gone: true };
  if (body.action === 'board-begin') {
    const postId = post?.id || rid(10), base = `p/${postId}/${rid(8)}`;
    return { ok: true, post: postId, full: await signedUpload(base + '.jpg'), thumb: await signedUpload(base + '-t.jpg') };
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
  if (post) await q(db.from('bj_posts').update({ photos, extra, updated: now }).eq('id', p.post));
  else await q(db.from('bj_posts').insert({ id: p.post, kind: 'first', caption: title ? `🏆 ${title} 최초 박제판` : '🏆 최초 박제판', letter: null, photos, at: now, created: now, updated: now, pinned: false, hearts: 0, src, extra }));
  // 이번 그림 두 장만 남기고 지난 그림·올렸다가 쓰지 않은 그림을 지운다
  const keep = new Set(photos.flatMap((x) => [x.f, x.t]));
  await removeFiles([...exists].filter((x) => !keep.has(x)));
  await buildSnap(now);
  return { ok: true, post: p.post, created: !post };
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
  if (r.changed) scheduleSnap();
  return { ok: true, on: b.on, hearts: r.hearts };
}

// ---- 방문자 수(누구나) ----
// visit {vid, peek} → {today, total}. 같은 브라우저(vid)는 하루(한국 날짜)에 한 번만 센다. peek:true(주인 기기)는 세지 않고 수만 준다.
async function visit(req: Request, now: number) {
  const b = await readJson(req, 1024);
  if (!isObj(b) || typeof b.vid !== 'string' || !NONCE.test(b.vid)) throw fail(400, '요청 모양이 올바르지 않아요.');
  const s = await salt();
  const count = b.peek !== true && await hit('bjv:' + await ipHash(req), 86400, 30);
  const voter = (await sha256hex(s + ':visit:' + b.vid)).slice(0, 40);
  const r: any = await q(db.rpc('bj_visit', { p_day: kstDay(now), p_voter: voter, p_count: count }));
  return { ok: true, today: Number(r?.today) || 0, total: Number(r?.total) || 0 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const route = new URL(req.url).pathname.replace(/^.*?\/bakje\/?/, '').replace(/\/+$/, '');
  const now = Date.now();
  try {
    if (req.method === 'GET' && route === 'health') return json(200, { ok: true, v: VERSION, kinds: KINDS, bot: true, donor: true, theme: true, visit: true });
    if (req.method === 'GET' && route === 'feed') {
      const ip = await ipHash(req);
      if (!await hit('bjf:' + ip, 60, 20)) throw fail(429, '너무 자주 불러왔어요. 잠깐 뒤에 다시 해 주세요.');
      return json(200, { ok: true, snap: await buildSnap(now) });
    }
    if (req.method === 'POST' && route === 'heart') return json(200, await heart(req, now));
    if (req.method === 'POST' && route === 'visit') return json(200, await visit(req, now));
    if (req.method === 'POST' && route === 'owner') return json(200, await owner(req, now));
    if (req.method === 'POST' && route === 'bot') return json(200, await bot(req, now));
    return json(404, { ok: false, error: '찾을 수 없어요.' });
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { ok: false, error: e.message });
    console.error(e);
    return json(500, { ok: false, error: BROKEN });
  }
});
