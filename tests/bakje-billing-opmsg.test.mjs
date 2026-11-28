// 함수 bakje-billing 운영자 메시지(v17, 2026-11-28 밤) 시험: node --test tests/bakje-billing-opmsg.test.mjs
// index.ts 의 "시험이 따로 읽는 곳"만 잘라(타입은 node 의 stripTypeScriptTypes 로 지움) 가짜 DB·가짜 푸시로 돌린다(bakje-billing-card.test.mjs 꼴).
// 기준: 기획/운영자메시지-20261128/설계.md "서버 — bakje-billing" · 표 bj_op_messages(마이그레이션 20261128_bakje_op_messages).
// 이름·글은 모두 지어낸 것이에요(DJ 먼치·밤톨 · 운영자 운영).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'supabase', 'functions', 'bakje-billing', 'index.ts');
const raw = fs.readFileSync(SRC, 'utf8');
const START = '// ==== 시험이 따로 읽는 곳 시작 ====', END = '// ==== 시험이 따로 읽는 곳 끝 ====';
const part = raw.indexOf(START) >= 0 ? raw.slice(raw.indexOf(START), raw.indexOf(END)) : '';
assert.ok(part.length > 1000, '시험할 곳을 찾지 못했어요');
const code = stripTypeScriptTypes(part) + '\nreturn { makeHandler };';
const freshHandler = (deps) => new Function(code)().makeHandler(deps);

const DAY = 86400000;
const NOW = Date.parse('2026-11-28T22:00:00+09:00');
const URL_FN = 'https://example.supabase.co/functions/v1/bakje-billing';
const ch = (n) => String.fromCharCode(n);

// ---- 가짜 Supabase(이 시험이 부르는 만큼 — card 시험의 fakeDb 꼴 + 번호 자동·gte) ----
// db.before(표, 질의) = 질의를 돌리기 전에 기다릴 것(두 요청이 동시에 읽게 — 검토 3) · db.fail(표, 질의) = 참이면 그 질의를 DB 오류로
const KEYS = { bj_members: ['id'], bj_sessions: ['token'], bj_op_messages: ['id'], bj_push_subs: ['id'], bj_member_devices: ['device'], junlive_devices: ['id'], bj_settings: ['key'] };
const DEFAULTS = { bj_op_messages: { by_member: null, delivered: null, seen: null, batch: null } };
// 표의 check(char_length(body) between 1 and 500) — 글자 수는 코드 포인트로 센다(Postgres char_length 와 같음)
const CHECKS = { bj_op_messages: (r) => typeof r.body === 'string' && [...r.body].length >= 1 && [...r.body].length <= 500 && typeof r.member === 'string' && Number.isSafeInteger(r.created) };
const clone = (v) => structuredClone(v);
function fakeDb(seed) {
  const T = {}, log = [], db = { before: null, fail: null };
  let seq = 100;
  for (const [k, rows] of Object.entries(seed)) T[k] = rows.map((r) => ({ ...(DEFAULTS[k] || {}), ...clone(r) }));
  const tbl = (name) => (T[name] ||= []);
  const same = (a, b, cols) => cols.every((c) => a[c] === b[c]);
  function from(name) {
    const st = { op: 'select', cols: '', filters: [], order: null, limit: null, ret: false, single: false, vals: null, opts: {} };
    const keep = (r) => st.filters.every((f) => f(r));
    function run() {
      log.push({ table: name, op: st.op, cols: st.cols });
      if (db.fail?.(name, st)) return { data: null, error: { code: 'XX000', message: '가짜 DB 오류' } };
      const rows = tbl(name);
      if (st.op === 'insert' || st.op === 'upsert') {
        const out = [];
        for (const v of Array.isArray(st.vals) ? st.vals : [st.vals]) {
          const cols = st.opts.onConflict ? st.opts.onConflict.split(',') : KEYS[name] || ['id'];
          const old = st.op === 'upsert' ? rows.find((r) => same(r, v, cols)) : null;
          if (old) { if (!st.opts.ignoreDuplicates) Object.assign(old, clone(v)); out.push(old); continue; }
          const row = { ...(DEFAULTS[name] || {}), ...clone(v) };
          if (name === 'bj_op_messages') { assert.equal(row.id, undefined, 'id 는 표가 만든다(generated always)'); row.id = ++seq; }
          if (CHECKS[name] && !CHECKS[name](row)) return { data: null, error: { code: '23514', message: 'check' } };
          rows.push(row); out.push(row);
        }
        return { data: st.ret ? clone(out) : null, error: null };
      }
      if (st.op === 'update') {
        const hit = rows.filter(keep);
        for (const r of hit) Object.assign(r, clone(st.vals));
        return { data: st.ret ? clone(hit) : null, error: null };
      }
      if (st.op === 'delete') { T[name] = rows.filter((r) => !keep(r)); return { data: null, error: null }; }
      let out = rows.filter(keep);
      if (st.order) { const [c, asc] = st.order; out = [...out].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1)); }
      if (st.limit != null) out = out.slice(0, st.limit);
      if (st.single) return { data: out[0] ? clone(out[0]) : null, error: null };
      return { data: clone(out), error: null };
    }
    const b = {
      select(cols = '*') { if (st.op !== 'select') st.ret = true; else st.cols = cols; return b; },
      insert(v) { st.op = 'insert'; st.vals = v; return b; },
      upsert(v, opts = {}) { st.op = 'upsert'; st.vals = v; st.opts = opts; return b; },
      update(v) { st.op = 'update'; st.vals = v; return b; },
      delete() { st.op = 'delete'; return b; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return b; },
      in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return b; },
      is(c, v) { st.filters.push((r) => (r[c] ?? null) === v); return b; },
      lt(c, v) { st.filters.push((r) => r[c] != null && r[c] < v); return b; },
      gte(c, v) { st.filters.push((r) => r[c] != null && r[c] >= v); return b; },
      order(c, o = {}) { st.order = [c, o.ascending !== false]; return b; },
      limit(n) { st.limit = n; return b; },
      maybeSingle() { st.single = true; return Promise.resolve().then(() => db.before?.(name, st)).then(run); },
      then(res, rej) { return Promise.resolve().then(() => db.before?.(name, st)).then(run).then(res, rej); }
    };
    return b;
  }
  return Object.assign(db, { T, log, from, rpc: async () => ({ data: true, error: null }) });
}

// 운영자 앱 푸시를 받는 가짜 휴대폰(웹 푸시 열쇠) — 서버가 보낸 암호문(aes128gcm)을 풀어 알림 글을 본다(card 시험의 fakePhone 꼴)
async function fakePhone(member = 'mOp') {
  const wc = crypto.webcrypto.subtle;
  const kp = await wc.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await wc.exportKey('raw', kp.publicKey));
  const auth = crypto.randomBytes(16);
  const hkdf = async (salt, ikm, info, len) => new Uint8Array(await wc.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await wc.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8));
  const cat = (...a) => Buffer.concat(a.map((x) => Buffer.from(x)));
  const open = async (msg) => {
    const salt = msg.slice(0, 16), idlen = msg[20], server = msg.slice(21, 21 + idlen), body = msg.slice(21 + idlen);
    const shared = new Uint8Array(await wc.deriveBits({ name: 'ECDH', public: await wc.importKey('raw', server, { name: 'ECDH', namedCurve: 'P-256' }, false, []) }, kp.privateKey, 256));
    const ikm = await hkdf(auth, shared, cat(Buffer.from('WebPush: info' + ch(0)), pub, server), 32);
    const cek = await hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm' + ch(0)), 16);
    const nonce = await hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce' + ch(0)), 12);
    const plain = new Uint8Array(await wc.decrypt({ name: 'AES-GCM', iv: nonce }, await wc.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), body));
    return JSON.parse(Buffer.from(plain.slice(0, plain.lastIndexOf(2))).toString('utf8'));
  };
  const sub = { id: 'pPhone', member, endpoint: 'https://fcm.googleapis.com/fcm/send/test-phone', p256dh: Buffer.from(pub).toString('base64url'), auth: auth.toString('base64url'), label: '운영 폰', created: 1 };
  return { sub, open };
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const MEMBERS = [
  { id: 'mDj', login_id: 'munchi', nickname: '먼치', verified: false, state: 'active', is_admin: false, role: 'dj' },
  { id: 'mNo', login_id: null, kakao: 'k-test', nickname: '', verified: false, state: 'active', is_admin: false, role: 'dj' },   // 먼치킨 닉네임을 안 정한 카카오 가입자
  { id: 'mBare', login_id: null, kakao: 'k-test-2', nickname: null, verified: false, state: 'active', is_admin: false, role: 'listener' },   // 닉네임도 기기도 없음
  { id: 'mOp', login_id: 'opsmunchi', nickname: '운영', verified: false, state: 'active', is_admin: true, role: 'dj' },
  { id: 'mBan', login_id: 'banned1', nickname: '막힘', verified: false, state: 'banned', is_admin: false, role: 'dj' },   // 막힌 회원(봇 기기 있음 — 전체 메시지에서 빠짐)
  { id: 'mStu', login_id: 'studio1', nickname: '송출만', verified: false, state: 'active', is_admin: false, role: 'dj' }   // 송출 기기만 있음(전체 메시지에서 빠짐)
];
async function setup({ now = NOW, msgs = [], devices = [] } = {}) {
  let clock = now;
  const tokens = {}, sessions = [];
  for (const m of MEMBERS) { const t = crypto.randomBytes(32).toString('base64url'); tokens[m.id] = t; sessions.push({ token: sha(t), member: m.id, expires: now + 365 * DAY }); }
  const phone = await fakePhone();
  const db = fakeDb({
    bj_members: MEMBERS, bj_sessions: sessions, bj_op_messages: msgs, bj_push_subs: [phone.sub], bj_settings: [],
    // 스푼 닉네임(지어낸 이름): mNo 는 봇 기기(밤톨)와 송출 기기(옛 이름) — 봇 기기 이름을 쓴다
    bj_member_devices: [{ device: 'd1', member: 'mNo', program: 'studio', created: 1, seen: 90 }, { device: 'd2', member: 'mNo', program: 'bot', created: 1, seen: 50 },
      { device: 'd3', member: 'mDj', program: 'bot', created: 1, seen: 10 }, ...devices],
    junlive_devices: [{ id: 'd1', nickname: '밤톨 옛', tag: 'bam_old', seen: 90 }, { id: 'd2', nickname: '밤톨', tag: 'bamtol', seen: 50 }, { id: 'd3', nickname: '먼치 스푼', tag: 'munchi', seen: 10 }]
  });
  const pushes = [];
  const fetch = async (url, init = {}) => {
    if (String(url).startsWith('https://fcm.googleapis.com/')) { pushes.push(new Uint8Array(init.body)); return new Response(null, { status: 201 }); }
    throw new Error('시험에서 모르는 주소예요: ' + url);
  };
  const handler = freshHandler({ db, env: () => undefined, fetch, clock: () => clock });
  const call = async (who, action, body = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(who ? { 'x-bj-session': tokens[who] } : {}) };
    const res = await handler(new Request(URL_FN, { method: 'POST', headers, body: JSON.stringify({ action, ...body }) }));
    return { status: res.status, body: await res.json() };
  };
  const pushed = () => Promise.all(pushes.map(phone.open));
  return { db, T: db.T, call, handler, pushes, pushed, setNow: (t) => { clock = t; } };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true); return r.body; };
const msg = (s, id) => s.T.bj_op_messages.find((m) => m.id === id);
// Math.random 을 잠깐 바꿔 가끔(2%) 하는 정리를 꼭 하게/안 하게
async function withRandom(v, fn) { const keep = Math.random; Math.random = () => v; try { return await fn(); } finally { Math.random = keep; } }

// ================= 시험 =================

test('health: opMsg true(그대로 v 7 — 엠베서더처럼 칸만 더함)', async () => {
  const s = await setup();
  const j = await (await s.handler(new Request(URL_FN + '/health'))).json();
  assert.equal(j.opMsg, true);
  assert.equal(j.v, 7);
});

test('ops-msg-*: 운영자만(보통 회원 403 · 로그인 안 함 401) — 아무것도 안 생기고 안 지워짐', async () => {
  const s = await setup({ msgs: [{ id: 1, member: 'mDj', body: '먼저 보낸 글', created: NOW - DAY }] });
  for (const who of ['mDj', 'mNo']) {
    assert.equal((await s.call(who, 'ops-msg-send', { member: 'mDj', body: '안녕하세요' })).status, 403);
    assert.equal((await s.call(who, 'ops-msgs')).status, 403);
    assert.equal((await s.call(who, 'ops-msg-del', { id: 1 })).status, 403);
  }
  for (const a of ['ops-msg-send', 'ops-msgs', 'ops-msg-del', 'op-msg-seen']) assert.equal((await s.call(null, a, { member: 'mDj', body: 'x', id: 1 })).status, 401, a);
  assert.equal(s.T.bj_op_messages.length, 1);
  assert.equal(msg(s, 1).seen, null);
});

test('ops-msg-send: 넣고 {msg} · 보낸 운영자·보낸 때 · 없는 회원 404 · 회원 번호가 글이 아니면 404', async () => {
  const s = await setup();
  const r = ok(await s.call('mOp', 'ops-msg-send', { member: 'mDj', body: '먼치님, 다음 판 시험을\n도와주실 수 있을까요?' }));
  assert.deepEqual(r.msg, { id: 101, member: 'mDj', name: '먼치', body: '먼치님, 다음 판 시험을\n도와주실 수 있을까요?', created: NOW, delivered: null, seen: null, batch: null });
  assert.deepEqual(s.T.bj_op_messages[0], { id: 101, member: 'mDj', body: '먼치님, 다음 판 시험을\n도와주실 수 있을까요?', created: NOW, by_member: 'mOp', delivered: null, seen: null, batch: null });
  assert.equal((await s.call('mOp', 'ops-msg-send', { member: 'mNone', body: '안녕' })).status, 404);
  assert.equal((await s.call('mOp', 'ops-msg-send', { member: { id: 'mDj' }, body: '안녕' })).status, 404);
  assert.equal((await s.call('mOp', 'ops-msg-send', { body: '안녕' })).status, 404);
  assert.equal(s.T.bj_op_messages.length, 1);
  assert.equal(s.pushes.length, 0, '보낼 때는 운영자 푸시가 없다');
});

test('글 다듬기: 제어 문자는 빼고 줄바꿈은 둠(\\r\\n·\\r → \\n, 탭 → 빈칸) · 앞뒤 공백 자름 · 500자까지(글자 수) · 빈 글·글 아님 400', async () => {
  const s = await setup();
  const send = (body) => s.call('mOp', 'ops-msg-send', { member: 'mDj', body });
  // 제어 문자(NUL·BEL·ESC·DEL·C1 의 NEL·CSI)는 빠지고, 줄바꿈·이모지·한글은 남는다
  const dirty = '  ' + ch(0) + '첫' + ch(7) + '줄' + ch(27) + '\r\n둘째' + ch(127) + '\t줄\r셋째' + ch(0x85) + ch(0x9b) + ' 줄 📩\n\n' + ch(11) + ch(12) + '  ';
  const a = ok(await send(dirty));
  assert.equal(a.msg.body, '첫줄\n둘째 줄\n셋째 줄 📩');
  assert.ok(![...a.msg.body].some((c) => (c.charCodeAt(0) < 32 && c !== '\n') || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159)), '남은 제어 문자 없음');
  // 500자 됨 · 501자 400 · 이모지 500개(코드 포인트 500)도 됨 — 앞뒤 공백은 세지 않는다
  assert.equal([...ok(await send('가'.repeat(500))).msg.body].length, 500);
  assert.equal([...ok(await send('📩'.repeat(500))).msg.body].length, 500);
  assert.equal([...ok(await send('   ' + '나'.repeat(500) + '\n\n  ')).msg.body].length, 500);
  const long = await send('다'.repeat(501));
  assert.equal(long.status, 400);
  assert.match(long.body.error, /500자까지/);
  // 빈 글 · 빈칸·줄바꿈·제어 문자만 · 글이 아님 → 400
  for (const bad of ['', '   ', '\n\n\t', ch(0) + ch(7) + ch(127), null, 123, ['글'], { body: '글' }]) {
    const r = await send(bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error, '보낼 글을 적어 주세요.');
  }
  assert.equal(s.T.bj_op_messages.length, 4, '된 것만 들어감(4개)');
  assert.ok(s.T.bj_op_messages.every((m) => [...m.body].length >= 1 && [...m.body].length <= 500));
});

test('ops-msgs: 최근 7일 전부 새것부터 · {id, member, name, body, created, delivered, seen} · 이름 = 닉네임 → 봇 기기 스푼 닉네임 → DJ', async () => {
  const msgs = [
    { id: 1, member: 'mDj', body: '오래된 글', created: NOW - 8 * DAY, by_member: 'mOp' },
    { id: 2, member: 'mDj', body: '닿고 확인함', created: NOW - 3 * DAY, by_member: 'mOp', delivered: NOW - 3 * DAY + 5, seen: NOW - 2 * DAY },
    { id: 3, member: 'mNo', body: '닿기만 함', created: NOW - DAY, by_member: 'mOp', delivered: NOW - DAY + 9 },
    { id: 4, member: 'mBare', body: '아직 안 닿음', created: NOW - 1000, by_member: 'mOp' },
    { id: 5, member: 'mDj', body: '딱 7일', created: NOW - 7 * DAY, by_member: 'mOp' }
  ];
  const s = await setup({ msgs });
  const j = ok(await s.call('mOp', 'ops-msgs'));
  assert.deepEqual(j.msgs.map((m) => m.id), [4, 3, 2, 5], '새것부터 · 7일 넘은 것(1)은 빠짐');
  assert.deepEqual(j.msgs.find((m) => m.id === 2), { id: 2, member: 'mDj', name: '먼치', body: '닿고 확인함', created: NOW - 3 * DAY, delivered: NOW - 3 * DAY + 5, seen: NOW - 2 * DAY, batch: null });
  assert.equal(j.msgs.find((m) => m.id === 3).name, '밤톨', '닉네임이 없으면 봇 기기의 스푼 닉네임(송출 기기가 더 최근이어도 봇 먼저)');
  assert.equal(j.msgs.find((m) => m.id === 4).name, 'DJ', '닉네임도 기기도 없으면 DJ');
  assert.deepEqual([j.msgs[0].delivered, j.msgs[0].seen], [null, null]);
  assert.ok(!JSON.stringify(j).includes('by_member') && !JSON.stringify(j).includes('bamtol'), '정해진 칸만(스푼 태그·보낸 운영자 칸 없음)');
  // 메시지가 없으면 빈 목록
  const e = await setup();
  assert.deepEqual(ok(await e.call('mOp', 'ops-msgs')).msgs, []);
});

test('op-msg-seen: 내 메시지 → seen 을 적고 운영자 휴대폰에 푸시 한 번 · 이미 확인한 것은 그대로(푸시 다시 안 함)', async () => {
  const body = '먼치님 안녕하세요.\n다음 주에 새 기능 시험을 같이 해 주실 수 있을까요? 시간 되실 때 디스코드로 알려 주세요!';
  const s = await setup({ msgs: [{ id: 7, member: 'mDj', body, created: NOW - 600000, by_member: 'mOp', delivered: NOW - 300000 }] });
  const r = ok(await s.call('mDj', 'op-msg-seen', { id: 7 }));
  assert.deepEqual(r, { ok: true, seen: NOW });
  assert.equal(msg(s, 7).seen, NOW);
  const [p] = await s.pushed();
  assert.equal(s.pushes.length, 1);
  assert.equal(p.title, '✅ 메시지 확인');
  assert.equal(p.url, '/ops/#msgs');
  const head = [...body.replace(/\s+/g, ' ')].slice(0, 40).join('');
  assert.equal(p.body, `먼치님이 확인했어요 — ${head}…`, '글 앞 40자(줄바꿈은 빈칸) · 더 길면 …');
  // 다시 눌러도(다른 PC·다시 보냄) 처음 확인한 때 그대로 · 푸시 없음
  s.setNow(NOW + 60000);
  assert.deepEqual(ok(await s.call('mDj', 'op-msg-seen', { id: 7 })), { ok: true, seen: NOW });
  assert.deepEqual(ok(await s.call('mDj', 'op-msg-seen', { id: '7' })), { ok: true, seen: NOW }, '번호를 글로 보내도 됨');
  assert.equal(msg(s, 7).seen, NOW);
  assert.equal(s.pushes.length, 1, '푸시는 처음 한 번만');
});

test('op-msg-seen: 동시에 두 번 와도(둘 다 "아직 확인 안 함"을 읽음) 푸시는 한 번 · 짧은 글은 … 없이 · 닉네임이 없으면 봇의 스푼 닉네임', async () => {
  const s = await setup({ msgs: [{ id: 8, member: 'mNo', body: '확인 부탁해요', created: NOW - 1000 }] });
  // 첫 읽기(id,member,body,seen)를 두 요청이 모두 마칠 때까지 붙잡는다 → 둘 다 seen 이 빈 것을 보고 update 로 간다(진짜 동시)
  let arrived = 0, release; const gate = new Promise((r) => { release = r; });
  s.db.before = async (name, st) => { if (name === 'bj_op_messages' && st.op === 'select' && st.cols !== 'seen') { if (++arrived === 2) release(); await gate; } };
  const [a, b] = await Promise.all([s.call('mNo', 'op-msg-seen', { id: 8 }), s.call('mNo', 'op-msg-seen', { id: 8 })]);
  s.db.before = null;
  assert.equal(arrived, 2);
  assert.equal(s.db.log.filter((x) => x.table === 'bj_op_messages' && x.op === 'update').length, 2, '두 요청 모두 update 까지 감');
  assert.deepEqual([ok(a).seen, ok(b).seen], [NOW, NOW]);
  assert.equal(s.pushes.length, 1, '조건부 update(seen 이 빌 때만)를 채운 한 요청만 푸시');
  assert.equal((await s.pushed())[0].body, '밤톨님이 확인했어요 — 확인 부탁해요');
});

test('op-msg-seen: 남의 메시지 · 없는 번호 · 이상한 번호 → 404 (seen 안 바뀜 · 푸시 없음)', async () => {
  const s = await setup({ msgs: [{ id: 9, member: 'mDj', body: '먼치님께', created: NOW - 1000 }] });
  for (const [who, id] of [['mNo', 9], ['mOp', 9], ['mDj', 999], ['mDj', 0], ['mDj', -9], ['mDj', 9.5], ['mDj', 'abc'], ['mDj', null], ['mDj', { id: 9 }], ['mDj', '9 or 1=1']]) {
    const r = await s.call(who, 'op-msg-seen', { id });
    assert.equal(r.status, 404, `${who} ${JSON.stringify(id)}`);
    assert.equal(r.body.error, '메시지를 찾을 수 없어요.');
  }
  assert.equal(msg(s, 9).seen, null);
  assert.equal(s.pushes.length, 0);
});

test('ops-msg-send: 글을 넣은 뒤 이름 읽기가 막혀도 503 이 아님(이름은 DJ) — 다시 보내 같은 글이 두 번 가지 않게(검토 2)', async () => {
  const s = await setup();
  s.db.fail = (name) => name === 'bj_member_devices';   // namesOf 의 기기 읽기만 막힘
  const r = ok(await s.call('mOp', 'ops-msg-send', { member: 'mDj', body: '한 번만 가야 하는 글' }));
  assert.equal(r.msg.name, 'DJ');
  assert.equal(r.msg.body, '한 번만 가야 하는 글');
  assert.equal(s.T.bj_op_messages.length, 1);
  s.db.fail = null;
  assert.equal(ok(await s.call('mOp', 'ops-msgs')).msgs[0].name, '먼치', '목록에서는 제 이름');
});

test('op-msg-seen 알림 글: 40자는 글자 덩어리로 — 가족·깃발·피부색 이모지가 반으로 잘리지 않음(검토 4)', async () => {
  const family = String.fromCodePoint(0x1F468, 0x200D, 0x1F469, 0x200D, 0x1F467), flag = String.fromCodePoint(0x1F1F0, 0x1F1F7), thumb = String.fromCodePoint(0x1F44D, 0x1F3FB);
  const cases = [['가'.repeat(39) + family + '나나', '가'.repeat(39) + family + '…'], ['가'.repeat(39) + flag + flag, '가'.repeat(39) + flag + '…'],
    ['가'.repeat(39) + thumb + '끝', '가'.repeat(39) + thumb + '…'], ['가'.repeat(38) + family + thumb, '가'.repeat(38) + family + thumb]];
  for (const [i, [body, head]] of cases.entries()) {
    const s = await setup({ msgs: [{ id: 20 + i, member: 'mDj', body, created: NOW - 1000 }] });
    ok(await s.call('mDj', 'op-msg-seen', { id: 20 + i }));
    assert.equal((await s.pushed())[0].body, `먼치님이 확인했어요 — ${head}`, 'case ' + i);
  }
});

test('ops-msg-del: 지우기 → 목록에서 빠지고 확인도 404 · 없는 번호여도 ok · 번호가 아니면 400', async () => {
  const s = await setup({ msgs: [{ id: 11, member: 'mDj', body: '지울 글', created: NOW - 1000 }, { id: 12, member: 'mDj', body: '남는 글', created: NOW - 500 }] });
  assert.deepEqual(ok(await s.call('mOp', 'ops-msg-del', { id: 11 })), { ok: true });
  assert.deepEqual(s.T.bj_op_messages.map((m) => m.id), [12]);
  assert.deepEqual(ok(await s.call('mOp', 'ops-msgs')).msgs.map((m) => m.id), [12]);
  assert.equal((await s.call('mDj', 'op-msg-seen', { id: 11 })).status, 404);
  assert.deepEqual(ok(await s.call('mOp', 'ops-msg-del', { id: 11 })), { ok: true }, '이미 지운 것도 ok');
  assert.equal((await s.call('mOp', 'ops-msg-del', { id: 'abc' })).status, 400);
  assert.deepEqual(s.T.bj_op_messages.map((m) => m.id), [12]);
});

test('30일 지난 줄은 가끔(2%) 지운다 — ops-msg-send·ops-msgs 때 · 30일 안 것은 남음 · 98% 는 안 지움', async () => {
  const msgs = [{ id: 1, member: 'mDj', body: '31일 전', created: NOW - 31 * DAY }, { id: 2, member: 'mDj', body: '29일 전', created: NOW - 29 * DAY }];
  const s = await setup({ msgs });
  await withRandom(0.5, async () => { ok(await s.call('mOp', 'ops-msgs')); ok(await s.call('mOp', 'ops-msg-send', { member: 'mDj', body: '새 글' })); });
  assert.deepEqual(s.T.bj_op_messages.map((m) => m.id).sort((a, b) => a - b), [1, 2, 101], '이번엔 안 지움');
  await withRandom(0.01, async () => { ok(await s.call('mOp', 'ops-msgs')); });
  assert.deepEqual(s.T.bj_op_messages.map((m) => m.id).sort((a, b) => a - b), [2, 101]);
  const t = await setup({ msgs });
  await withRandom(0, async () => { ok(await t.call('mOp', 'ops-msg-send', { member: 'mDj', body: '새 글' })); });
  assert.deepEqual(t.T.bj_op_messages.map((m) => m.id).sort((a, b) => a - b), [2, 101]);
});

// ================= 전체 메시지(v18) =================
// 봇 기기를 가진 회원: mDj(봇 2개 — 한 번만) · mNo(봇+송출) · mOp(운영자 — 빠짐) · mBan(막힘 — 빠짐) · mStu(송출만 — 빠짐) · mBare(기기 없음 — 빠짐)
const MORE_DEVS = [{ device: 'd4', member: 'mDj', program: 'bot', created: 1, seen: 5 }, { device: 'd5', member: 'mOp', program: 'bot', created: 1, seen: 5 },
  { device: 'd6', member: 'mBan', program: 'bot', created: 1, seen: 5 }, { device: 'd7', member: 'mStu', program: 'studio', created: 1, seen: 5 }];

test('health: opMsgAll true', async () => {
  const s = await setup();
  assert.equal((await (await s.handler(new Request(URL_FN + '/health'))).json()).opMsgAll, true);
});

test('ops-msg-send-all: 운영자만(보통 회원·막힌 회원 403 · 로그인 안 함 401) — 아무것도 안 들어감', async () => {
  const s = await setup({ devices: MORE_DEVS });
  for (const who of ['mDj', 'mNo', 'mStu', 'mBan']) assert.equal((await s.call(who, 'ops-msg-send-all', { body: '모두에게' })).status, 403, who);
  assert.equal((await s.call(null, 'ops-msg-send-all', { body: '모두에게' })).status, 401);
  assert.equal(s.T.bj_op_messages.length, 0);
});

test('ops-msg-send-all: 받는 사람 = 봇 기기가 있는 회원(한 사람에 한 줄) — 운영자·막힌 회원·송출만·기기 없음은 빠짐 · 같은 batch · {batch, count} · 푸시 없음', async () => {
  const s = await setup({ devices: MORE_DEVS });
  const r = ok(await s.call('mOp', 'ops-msg-send-all', { body: '  다음 주에 새 판이 나와요.\r\n업데이트해 주세요!  ' }));
  assert.match(r.batch, /^b[a-z2-9]{11}$/);
  assert.equal(r.count, 2);
  const rows = s.T.bj_op_messages;
  assert.deepEqual(rows.map((m) => m.member).sort(), ['mDj', 'mNo']);
  for (const m of rows) assert.deepEqual({ ...m, id: 0 }, { id: 0, member: m.member, body: '다음 주에 새 판이 나와요.\n업데이트해 주세요!', created: NOW, by_member: 'mOp', delivered: null, seen: null, batch: r.batch }, '글 다듬기도 같음');
  assert.equal(new Set(rows.map((m) => m.id)).size, 2, '줄마다 번호가 다름');
  assert.equal(s.pushes.length, 0);
  // 다시 보내면 새 묶음
  const r2 = ok(await s.call('mOp', 'ops-msg-send-all', { body: '두 번째 공지' }));
  assert.notEqual(r2.batch, r.batch);
  assert.equal(s.T.bj_op_messages.length, 4);
});

test('ops-msg-send-all: 받는 사람이 0명이면 400(쉬운 글) · 글이 비거나 500자 넘으면 400 · 아무것도 안 들어감', async () => {
  const s = await setup({ devices: MORE_DEVS });
  const empty = await s.call('mOp', 'ops-msg-send-all', { body: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, '보낼 글을 적어 주세요.');
  assert.equal((await s.call('mOp', 'ops-msg-send-all', { body: '가'.repeat(501) })).status, 400);
  // 봇 기기 줄이 운영자·막힌 회원 것과 송출뿐
  s.T.bj_member_devices = s.T.bj_member_devices.filter((d) => !['mDj', 'mNo'].includes(d.member));
  const none = await s.call('mOp', 'ops-msg-send-all', { body: '모두에게' });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /받을 회원이 없어요/);
  assert.equal(s.T.bj_op_messages.length, 0);
});

test('ops-msgs: 줄마다 batch(전체 메시지 묶음, 한 사람 것은 null) · 이름은 그대로', async () => {
  const s = await setup({ devices: MORE_DEVS });
  ok(await s.call('mOp', 'ops-msg-send', { member: 'mDj', body: '먼치님께' }));
  const { batch } = ok(await s.call('mOp', 'ops-msg-send-all', { body: '모두에게' }));
  const j = ok(await s.call('mOp', 'ops-msgs'));
  assert.equal(j.msgs.length, 3);
  assert.deepEqual(j.msgs.filter((m) => m.batch === batch).map((m) => [m.member, m.name]).sort(), [['mDj', '먼치'], ['mNo', '밤톨']]);
  assert.deepEqual(j.msgs.filter((m) => m.batch === null).map((m) => m.body), ['먼치님께']);
});

test('op-msg-seen: 전체 메시지(batch)는 seen 만 적고 운영자 푸시는 안 보냄 · 한 사람 메시지는 그대로 푸시 · 같은 묶음이어도 남의 줄은 404', async () => {
  const s = await setup({ devices: MORE_DEVS });
  ok(await s.call('mOp', 'ops-msg-send-all', { body: '모두에게 알려요' }));
  const row = (member) => s.T.bj_op_messages.find((m) => m.member === member);
  assert.deepEqual(ok(await s.call('mDj', 'op-msg-seen', { id: row('mDj').id })), { ok: true, seen: NOW });
  assert.equal(row('mDj').seen, NOW);
  assert.equal(s.pushes.length, 0, '전체 메시지 확인은 푸시 없음');
  assert.equal(row('mNo').seen, null, '다른 회원 줄은 그대로');
  assert.equal((await s.call('mDj', 'op-msg-seen', { id: row('mNo').id })).status, 404);
  ok(await s.call('mNo', 'op-msg-seen', { id: row('mNo').id }));
  assert.equal(row('mNo').seen, NOW);
  assert.equal(s.pushes.length, 0);
  // 한 사람 메시지는 전처럼 푸시
  const one = ok(await s.call('mOp', 'ops-msg-send', { member: 'mDj', body: '먼치님께만' })).msg;
  ok(await s.call('mDj', 'op-msg-seen', { id: one.id }));
  assert.equal(s.pushes.length, 1);
});

test('ops-msg-del {batch}: 그 묶음 줄을 모두 지움 · 다른 묶음·한 사람 것은 남음 · 없는 묶음 ok · 이상한 batch 400 · {id} 는 그대로', async () => {
  const s = await setup({ devices: MORE_DEVS });
  const a = ok(await s.call('mOp', 'ops-msg-send-all', { body: '첫 공지' })).batch;
  const b = ok(await s.call('mOp', 'ops-msg-send-all', { body: '둘째 공지' })).batch;
  const one = ok(await s.call('mOp', 'ops-msg-send', { member: 'mDj', body: '먼치님께' })).msg;
  assert.equal((await s.call('mDj', 'ops-msg-del', { batch: a })).status, 403, '운영자만');
  assert.equal(s.T.bj_op_messages.length, 5);
  assert.deepEqual(ok(await s.call('mOp', 'ops-msg-del', { batch: a })), { ok: true });
  assert.deepEqual(s.T.bj_op_messages.map((m) => String(m.batch)).sort(), [b, b, 'null'].sort());
  assert.deepEqual(ok(await s.call('mOp', 'ops-msg-del', { batch: a })), { ok: true }, '이미 지운 묶음도 ok');
  assert.deepEqual(ok(await s.call('mOp', 'ops-msg-del', { batch: 'bzzzzzzzzzzz' })), { ok: true }, '없는 묶음');
  for (const bad of ['', 'x', 'B' + b.slice(1), b + 'x', 123, { batch: b }, ['b']]) assert.equal((await s.call('mOp', 'ops-msg-del', { batch: bad })).status, 400, JSON.stringify(bad));
  assert.equal(s.T.bj_op_messages.length, 3, '이상한 batch 로는 아무것도 안 지움');
  ok(await s.call('mOp', 'ops-msg-del', { id: one.id }));
  assert.deepEqual(s.T.bj_op_messages.map((m) => m.batch), [b, b]);
});

test('표(마이그레이션 bakje_op_messages_all · schema.sql): batch 칸·색인·되돌리기 글 · 두 곳이 같은 내용', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261128_bakje_op_messages_all.sql'), 'utf8').replace(/\r\n/g, '\n');
  const schema = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8').replace(/\r\n/g, '\n');
  for (const re of [/alter table bj_op_messages add column if not exists batch text;/, /create index if not exists bj_op_messages_batch on bj_op_messages\(batch\) where batch is not null;/,
    /alter table bj_op_messages drop column if exists batch;/, /drop index if exists bj_op_messages_batch;/]) { assert.match(sql, re); assert.match(schema, re); }
  const tail = (s) => s.slice(s.indexOf('alter table bj_op_messages add column if not exists batch text;'));
  assert.ok(tail(sql).length > 100);
  assert.equal(tail(schema), tail(sql), 'schema.sql 맨 끝 구역 = 마이그레이션');
});

test('표(마이그레이션·schema.sql): 칸·제약·색인·RLS·권한 · 되돌리기 글 · 두 곳이 같은 내용', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261128_bakje_op_messages.sql'), 'utf8').replace(/\r\n/g, '\n');
  const schema = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8').replace(/\r\n/g, '\n');
  for (const re of [/id bigint generated always as identity primary key/, /member text not null references bj_members\(id\) on delete cascade/,
    /body text not null check \(char_length\(body\) between 1 and 500\)/, /created bigint not null/, /by_member text references bj_members\(id\) on delete set null/,
    /delivered bigint,/, /seen bigint\n\);/, /create index if not exists bj_op_messages_member on bj_op_messages\(member, created desc\);/,
    /create index if not exists bj_op_messages_created on bj_op_messages\(created\);/, /alter table bj_op_messages enable row level security;/,
    /revoke all on bj_op_messages from anon, authenticated;/, /grant all on bj_op_messages to service_role;/, /drop table if exists bj_op_messages;/]) assert.match(sql, re);
  const body = (s) => s.slice(s.indexOf('create table if not exists bj_op_messages'), s.indexOf('grant usage, select on sequence bj_op_messages_id_seq to service_role;'));
  assert.ok(body(sql).length > 200);
  assert.equal(body(schema), body(sql), 'schema.sql 맨 끝 구역 = 마이그레이션');
});
