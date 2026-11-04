// 추억앨범 댓글(답글 한 단계 · DJ/청취자 표시) · DJ 알림(하트·댓글·답글) — Supabase Edge Function "bakje-social" (verify_jwt false, 2026-11-05)
// 큰 함수 bakje 를 다시 올리지 않으려고 따로 뗐다. 댓글 지우기·신고·주인 관리는 그대로 bakje(POST comment · owner).
//  GET  comments?album=&post=  → 댓글 목록(r: owner 이 앨범 DJ · dj 다른 DJ · fan 청취자, p: 답글이 달린 댓글)
//  POST comment {action:'add', album, post, text, parent?} → 댓글·답글 달기 + DJ 알림
//  POST heart-note {post, vid, on} → 하트를 누른 뒤 사이트가 부른다(진짜 하트가 있을 때만 알림을 남김). 로그인했으면 닉네임, 아니면 손님.
//  POST notes {album} + 세션(DJ 계정) 또는 주인 기기 서명(BAKJE/1, action notes) → 최근 60일 알림
// 표: bj_notes · bj_comments.parent (schema.sql "bakje_replies_notes"). 목록 파일(snap)은 bakje 와 같은 모양으로 다시 쓴다(댓글 수).
// 주의: MCP 로 올릴 때 백슬래시-u 글자 표기가 풀려 버리므로 이 파일에는 그런 표기를 쓰지 않는다.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const SNAP_VERSION = 8, BUCKET = 'bakje', LEGACY = 'hanijun', PREFIX = 'BAKJE/1';
const ALBUM_RE = /^[a-z][a-z0-9-]{1,30}$/, ID = /^[a-z2-9]{10}$/, CID = /^c[a-z2-9]{11}$/, NONCE = /^[-_A-Za-z0-9]{32}$/;
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
const BROKEN = '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.';
const NOTE_DAYS = 60;
const enc = new TextEncoder();
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-bj-session',
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
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256hex = async (s: string | Uint8Array) => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s));
const decode64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const rid = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => ALPHA[x & 31]).join('');
function text(v: unknown, max: number, what: string) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw fail(400, what + ' 모양이 올바르지 않아요.');
  const s = [...v.replace(/\r\n?/g, '\n')].filter((ch) => { const c = ch.charCodeAt(0); return c === 10 || (c >= 32 && c !== 127); }).join('').trim();
  if ([...s].length > max) throw fail(400, `${what}은(는) ${max}자까지 쓸 수 있어요.`);
  return s;
}
async function readJson(req: Request, max: number) {
  const raw = await req.text();
  if (raw.length > max) throw fail(413, '보낸 내용이 너무 커요.');
  try { return JSON.parse(raw); } catch { throw fail(400, '요청 모양이 올바르지 않아요.'); }
}
let saltPromise: Promise<string> | null = null;
const salt = () => (saltPromise ||= q(db.from('junlive_secrets').select('value').eq('key', 'ip_salt').maybeSingle())
  .then((r: any) => { if (!r?.value) throw fail(503, BROKEN); return r.value as string; })
  .catch((e) => { saltPromise = null; throw e; }));
const ipOf = (req: Request) => (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
const ipHash = async (req: Request) => (await sha256hex((await salt()) + ':ip:' + ipOf(req))).slice(0, 32);
const hit = async (key: string, seconds: number, max: number) => Boolean(await q(db.rpc('fp_hit', { p_key: key, p_seconds: seconds, p_max: max })));
const getMeta = async (album: string, key: string) => ((await q(db.from('bj_meta').select('value').eq('album', album).eq('key', key).maybeSingle())) as any)?.value ?? null;
async function albumRow(id: unknown) {
  if (typeof id !== 'string' || !ALBUM_RE.test(id)) throw fail(400, '앨범이 올바르지 않아요.');
  const row: any = await q(db.from('bj_albums').select('id,name,state').eq('id', id).maybeSingle());
  if (!row) throw fail(404, '없는 앨범이에요.');
  return row;
}
// 회원 세션(bakje 와 같은 표)
async function sessionMember(req: Request, now: number) {
  const token = req.headers.get('x-bj-session') || '';
  if (!/^[-_A-Za-z0-9]{43}$/.test(token)) return null;
  const s: any = await q(db.from('bj_sessions').select('member,expires').eq('token', await sha256hex(token)).maybeSingle());
  if (!s || s.expires < now) return null;
  return await q(db.from('bj_members').select('id,nickname,verified,state,role').eq('id', s.member).maybeSingle()) as any;
}
async function needMember(req: Request, now: number) {
  const m = await sessionMember(req, now);
  if (!m) throw fail(401, '다시 로그인해 주세요.');
  if (m.state === 'banned') throw fail(403, '이용이 막힌 계정이에요.');
  return m;
}
const albumOwners = async (album: string) => new Set(((await q(db.from('bj_album_owners').select('member').eq('album', album))) as any[]).map((r) => r.member));
// owner(이 앨범 DJ) · dj(다른 DJ) · fan(청취자)
const roleOf = (owners: Set<string>, member: string | null, role: unknown) => (member && owners.has(member) ? 'owner' : role === 'dj' ? 'dj' : 'fan');
async function addNote(row: Record<string, unknown>) {
  const { error } = await db.from('bj_notes').insert(row);
  if (error) console.error('note', error.message);   // 알림이 안 남아도 댓글·하트는 그대로
}
async function postIn(album: string, post: unknown) {
  if (typeof post !== 'string' || !ID.test(post) || !await q(db.from('bj_posts').select('id').eq('id', post).eq('album', album).maybeSingle())) throw fail(404, '글을 찾을 수 없어요.');
  return post;
}
async function canWrite(me: any, album: any) {
  if (album.state !== 'active' || (await getMeta(album.id, 'comments'))?.off === true) return 'off';
  if (!me) return 'login';
  if (me.state === 'banned') return 'banned';
  if (!me.verified) return 'verify';
  if (!me.nickname) return 'nickname';
  if (await q(db.from('bj_album_blocks').select('member').eq('album', album.id).eq('member', me.id).maybeSingle())) return 'blocked';
  return null;
}

// ---- 목록 파일(bakje buildSnap 과 같은 모양 — 댓글 수 cc 를 새로) ----
const storage = () => db.storage.from(BUCKET);
async function buildSnap(album: string, now: number) {
  const [posts, profile, a, cmts] = await Promise.all([
    q(db.from('bj_posts').select('id,kind,caption,letter,photos,at,pinned,hearts,extra,donor,theme,ends').eq('album', album).order('pinned', { ascending: false }).order('at', { ascending: false }).order('created', { ascending: false }).limit(3000)),
    getMeta(album, 'profile'),
    albumRow(album),
    q(db.from('bj_comments').select('post').eq('album', album).eq('state', 'visible').limit(50000))
  ]);
  const cc = new Map<string, number>();
  for (const c of cmts as any[]) cc.set(c.post, (cc.get(c.post) || 0) + 1);
  const out = (posts as any[]).map(({ extra, donor, theme, ends, ...p }) => ({
    ...p, ...(donor ? { donor } : {}), ...(theme ? { theme } : {}), ...(ends ? { ends } : {}), ...(cc.get(p.id) ? { cc: cc.get(p.id) } : {}),
    ...(isObj(extra) ? { extra: { title: extra.title || '', filled: extra.filled || 0, total: extra.total || 0, bot: extra.bot === true } } : {})
  }));
  const pr: any = profile || {};
  const snap = { v: SNAP_VERSION, snapAt: now, album: { id: album, name: a.name || '', state: a.state }, profile: { name: pr.name || '', bio: pr.bio || '', link: pr.link || '', avatar: pr.avatar || '' }, posts: out };
  const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
  for (const path of [`snap/${album}/feed.json`, ...(album === LEGACY ? ['snap/feed.json'] : [])]) {
    const { error } = await storage().upload(path, blob, { upsert: true, contentType: 'application/json', cacheControl: '10' });
    if (error) console.error('snap', path, error.message);
  }
}
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const later = (p: Promise<unknown>) => { try { EdgeRuntime?.waitUntil(p.catch((e) => console.error(e))); } catch { /* local */ } };

// ---- 댓글 ----
async function commentsList(req: Request, now: number) {
  if (!await hit('bjcl:' + await ipHash(req), 60, 60)) throw fail(429, '너무 자주 불러왔어요. 잠깐 뒤에 다시 해 주세요.');
  const u = new URL(req.url), album = await albumRow(u.searchParams.get('album') || LEGACY);
  const post = await postIn(album.id, u.searchParams.get('post'));
  const [me, rows, owners]: any = await Promise.all([
    sessionMember(req, now),
    q(db.from('bj_comments').select('id,member,text,created,parent,bj_members!bj_comments_member_fkey(nickname,role)').eq('post', post).eq('state', 'visible').order('created', { ascending: true }).limit(500)),
    albumOwners(album.id)
  ]);
  const why = await canWrite(me, album);
  return {
    ok: true, off: why === 'off',
    comments: rows.map((c: any) => ({ id: c.id, m: c.member, nick: c.bj_members?.nickname || '(알 수 없음)', text: c.text, at: c.created, mine: Boolean(me && me.id === c.member),
      r: roleOf(owners, c.member, c.bj_members?.role), ...(c.parent ? { p: c.parent } : {}) })),
    me: { can: why === null, why }
  };
}
const WHY: Record<string, string> = { off: '댓글을 받지 않는 앨범이에요.', verify: '본인인증을 하면 댓글을 달 수 있어요.', nickname: '닉네임을 정하면 댓글을 달 수 있어요.', blocked: '이 앨범에서는 댓글을 달 수 없어요.', banned: '이용이 막힌 계정이에요.' };
async function commentAdd(req: Request, now: number) {
  const b = await readJson(req, 8192);
  if (!isObj(b) || b.action !== 'add') throw fail(400, '모르는 요청이에요.');
  const me = await needMember(req, now);
  const album = await albumRow(b.album === undefined ? LEGACY : b.album);
  const post = await postIn(album.id, b.post);
  const why = await canWrite(me, album);
  if (why) throw fail(403, WHY[why] || '댓글을 달 수 없어요.');
  const raw = text(b.text, 300, '댓글');
  const body = raw.split('\n').reduce((acc: string[], line) => { if (acc.length < 5) acc.push(line); else acc[4] += ' ' + line; return acc; }, []).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!body) throw fail(400, '댓글을 써 주세요.');
  // 답글은 한 단계만(답글에 단 답글은 그 위 댓글에 붙는다)
  let parent: string | null = null;
  if (b.parent !== undefined && b.parent !== null) {
    if (typeof b.parent !== 'string' || !CID.test(b.parent)) throw fail(400, '답글을 달 댓글을 다시 골라 주세요.');
    const pc: any = await q(db.from('bj_comments').select('id,parent,post,state').eq('id', b.parent).maybeSingle());
    if (!pc || pc.post !== post || pc.state !== 'visible') throw fail(404, '답글을 달 댓글을 찾을 수 없어요.');
    parent = pc.parent || pc.id;
  }
  if (!await hit('bjcm:' + me.id, 10, 1)) throw fail(429, '10초 뒤에 다시 달아 주세요.');
  if (!await hit('bjch:' + me.id, 3600, 30)) throw fail(429, '한 시간에 달 수 있는 댓글을 넘었어요. 조금 뒤에 다시 달아 주세요.');
  const id = 'c' + rid(11);
  await q(db.from('bj_comments').insert({ id, album: album.id, post, member: me.id, text: body, created: now, parent }));
  const owners = await albumOwners(album.id);
  if (!owners.has(me.id)) await addNote({ album: album.id, kind: parent ? 'reply' : 'comment', post, member: me.id, nick: me.nickname || '', text: [...body.replace(/\s+/g, ' ')].slice(0, 80).join(''), comment: id, created: now });
  later(buildSnap(album.id, now));
  return { ok: true, comment: { id, m: me.id, nick: me.nickname, text: body, at: now, mine: true, r: roleOf(owners, me.id, me.role), ...(parent ? { p: parent } : {}) } };
}

// ---- 하트 알림(하트 자체는 bakje 가 센다) ----
async function heartNote(req: Request, now: number) {
  const b = await readJson(req, 1024);
  if (!isObj(b) || typeof b.post !== 'string' || !ID.test(b.post) || typeof b.vid !== 'string' || !NONCE.test(b.vid) || typeof b.on !== 'boolean') throw fail(400, '요청 모양이 올바르지 않아요.');
  if (!await hit('bjhn:' + await ipHash(req), 86400, 500)) return { ok: true };
  const voter = (await sha256hex((await salt()) + ':voter:' + b.vid)).slice(0, 40);
  if (!b.on) {
    if (!await q(db.from('bj_hearts').select('post').eq('post', b.post).eq('voter', voter).maybeSingle())) await q(db.from('bj_notes').delete().eq('kind', 'heart').eq('post', b.post).eq('voter', voter));
    return { ok: true };
  }
  const [heart, had, post, me]: any = await Promise.all([
    q(db.from('bj_hearts').select('created').eq('post', b.post).eq('voter', voter).maybeSingle()),
    q(db.from('bj_notes').select('id').eq('kind', 'heart').eq('post', b.post).eq('voter', voter).limit(1)),
    q(db.from('bj_posts').select('album').eq('id', b.post).maybeSingle()),
    sessionMember(req, now)
  ]);
  if (!heart || !post || had.length) return { ok: true };            // 진짜 하트가 없거나 이미 남김
  if (me && (await albumOwners(post.album)).has(me.id)) return { ok: true };   // DJ 본인 하트는 빼고
  await addNote({ album: post.album, kind: 'heart', post: b.post, member: me?.id || null, voter, nick: me?.nickname || '', created: now });
  return { ok: true };
}

// ---- DJ 알림 목록 ----
async function verifyDevice(b: any, now: number) {
  if (!isObj(b) || b.action !== 'notes' || !Number.isSafeInteger(b.timestamp) || Math.abs(now - b.timestamp) > 10 * 60000
    || typeof b.nonce !== 'string' || !NONCE.test(b.nonce) || typeof b.publicKey !== 'string' || !/^[-_A-Za-z0-9]{122}$/.test(b.publicKey)
    || typeof b.signature !== 'string' || !/^[-_A-Za-z0-9]{86}$/.test(b.signature)) throw fail(400, '요청이 만료되었거나 올바르지 않아요. 기기 시간을 확인해 주세요.');
  const msg = `${PREFIX}\n${b.action}\n${b.timestamp}\n${b.nonce}\n${b.publicKey}\n${await sha256hex(JSON.stringify(b.payload ?? null))}`;
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('spki', decode64url(b.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, decode64url(b.signature), enc.encode(msg));
  } catch { /* 이상한 키 */ }
  if (!ok) throw fail(403, '기기 확인에 실패했어요.');
  const { error } = await db.from('junlive_access_nonces').insert({ id: 'bj:' + b.nonce, expires: now + 20 * 60000 });
  if (error) { if (error.code === '23505') throw fail(409, '같은 요청이 두 번 왔어요. 다시 해 주세요.'); console.error(error); throw fail(503, BROKEN); }
  return await sha256hex(decode64url(b.publicKey));
}
async function notes(req: Request, now: number) {
  const b = await readJson(req, 4096);
  let album = '';
  if (isObj(b) && b.publicKey !== undefined) {
    const id = await verifyDevice(b, now);
    const a = isObj(b.payload) ? b.payload.album : undefined;
    const dev: any = await q(db.from('bj_devices').select('state,album').eq('id', id).maybeSingle());
    if (!dev || dev.state !== 'approved' || dev.album !== (a === undefined ? LEGACY : a)) throw fail(403, '주인 기기로 등록되지 않았어요.');
    album = dev.album;
  } else {
    const me = await needMember(req, now);
    const a = isObj(b) && b.album !== undefined ? b.album : LEGACY;
    if (typeof a !== 'string' || !ALBUM_RE.test(a) || !(await albumOwners(a)).has(me.id)) throw fail(403, '이 앨범을 관리하는 DJ 계정이 아니에요.');
    album = a;
  }
  if (!await hit('bjnt:' + album, 60, 60)) throw fail(429, '너무 자주 불러왔어요. 잠깐 뒤에 다시 해 주세요.');
  const since = now - NOTE_DAYS * 86400000;
  if (Math.random() < 0.05) await q(db.from('bj_notes').delete().eq('album', album).lt('created', since));
  const rows: any[] = await q(db.from('bj_notes').select('id,kind,post,member,nick,text,comment,created').eq('album', album).gte('created', since).order('created', { ascending: false }).limit(300));
  // 지워진 댓글의 알림은 빼고 보인다
  const cids = rows.map((n) => n.comment).filter(Boolean);
  const alive = new Set(cids.length ? ((await q(db.from('bj_comments').select('id').in('id', cids).eq('state', 'visible'))) as any[]).map((c) => c.id) : []);
  return { ok: true, notes: rows.filter((n) => !n.comment || alive.has(n.comment)).map((n) => ({ id: n.id, kind: n.kind, post: n.post, m: n.member || null, nick: n.nick || '', text: n.text || '', c: n.comment || null, at: Number(n.created) })) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const route = new URL(req.url).pathname.replace(/^.*?\/bakje-social\/?/, '').replace(/\/+$/, '');
  const now = Date.now();
  try {
    if (req.method === 'GET' && route === 'health') return json(200, { ok: true, v: 1, replies: true, notes: true, roles: true });
    if (req.method === 'GET' && route === 'comments') return json(200, await commentsList(req, now));
    if (req.method === 'POST' && route === 'comment') return json(200, await commentAdd(req, now));
    if (req.method === 'POST' && route === 'heart-note') return json(200, await heartNote(req, now));
    if (req.method === 'POST' && route === 'notes') return json(200, await notes(req, now));
    return json(404, { ok: false, error: '찾을 수 없어요.' });
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { ok: false, error: e.message });
    console.error(e);
    return json(500, { ok: false, error: BROKEN });
  }
});
