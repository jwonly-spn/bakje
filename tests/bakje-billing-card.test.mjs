// 함수 bakje-billing 카드 결제(포트원 V2 · KG이니시스) 시험: node --test tests/bakje-billing-card.test.mjs
// index.ts 의 "시험이 따로 읽는 곳"만 잘라(타입은 node 의 stripTypeScriptTypes 로 지움) 가짜 DB·가짜 fetch(포트원·디스코드)로 돌린다.
// 기준: 기획/결제창-20261122/변경-1123.md(이것이 이김) · 약속.md(서버 ↔ 화면 약속 1~6) · 설계안.md 2·3장 · 6장 T2 의 ①~⑪.
// 이름·계좌·키는 모두 지어낸 시험 값이에요(진짜 비밀 값 아님).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions', 'bakje-billing', 'index.ts');
const raw = fs.readFileSync(SRC, 'utf8');
const START = '// ==== 시험이 따로 읽는 곳 시작 ====', END = '// ==== 시험이 따로 읽는 곳 끝 ====';
const part = raw.indexOf(START) >= 0 ? raw.slice(raw.indexOf(START), raw.indexOf(END)) : '';
assert.ok(part.length > 1000, '시험할 곳을 찾지 못했어요');
const code = stripTypeScriptTypes(part) + '\nreturn { makeHandler };';
// 시험마다 새로 읽는다(모듈 안 값 — vapid 등 — 이 섞이지 않게)
const freshHandler = (deps) => new Function(code)().makeHandler(deps);

// ---- 시험 값(지어낸 것) ----
const STORE = 'store-00000000-0000-test', CHANNEL = 'channel-key-00000000-0000-test', SECRET = 'portone-secret-for-test-only';
const HOOK = 'https://discord.com/api/webhooks/1/test-hook';
const DAY = 86400000;
const BEFORE_DEC = Date.parse('2026-11-23T12:00:00+09:00');   // 12/1 전(11/23 — 신청을 받기 시작한 날)
const AFTER_DEC = Date.parse('2026-12-05T12:00:00+09:00');    // 12/1 뒤
const PAID_FROM = Date.parse('2027-01-01T00:00:00+09:00');    // 유료화 — 이용 기간을 세기 시작하는 때
const AFTER_JAN = Date.parse('2027-01-10T12:00:00+09:00');    // 유료화 뒤
const ALBUM_BETA = '추억앨범은 지금 베타 테스트 중이라 아직 신청할 수 없어요. 추후 공개할게요.';
const BILLING = { bank: '먼치은행', number: '000-0000-0000', holder: '먼치', prices: { munchkin: 3000, album: 3000, bundle: 5000 }, year: { munchkin: 30000, album: 30000, bundle: 50000 } };
// 변경-1123 4번: 카드 단추는 모두(on all) · 테스트 모드 동안 결제는 심사 계정·운영자만 · live 면 모두
const CARD = { on: 'all', mode: 'test', channelKey: CHANNEL, testers: ['inicistest'] };
const LIVE = { ...CARD, mode: 'live' };

// ---- 가짜 Supabase(이 함수가 쓰는 만큼) ----
const KEYS = { bj_orders: ['id'], bj_entitlements: ['member', 'product'], bj_settings: ['key'], bj_albums: ['id'], bj_hosts: ['host'], bj_album_owners: ['album', 'member'],
  bj_push_subs: ['id'], bj_bots: ['id'], bj_members: ['id'], bj_sessions: ['token'], bj_member_devices: ['device'], junlive_devices: ['id'] };
const UNIQUE = { bj_orders: [['pay_id']], bj_push_subs: [['endpoint']] };
// 마이그레이션 bakje_card_pay 뒤의 bj_orders 기본값·제약
const DEFAULTS = { bj_orders: { state: 'pending', sent: null, done: null, note: '', until_to: null, want_host: null, want_label: null, want_name: null, pay: 'bank', pay_id: null, pay_at: null, pay_channel: null, test_only: false } };
const CHECKS = { bj_orders: (r) => ['pending', 'paid', 'rejected', 'canceled', 'test'].includes(r.state) && ['bank', 'card'].includes(r.pay) };
const clone = (v) => structuredClone(v);

function fakeDb(seed) {
  const T = {};
  for (const [k, rows] of Object.entries(seed)) T[k] = rows.map((r) => ({ ...(DEFAULTS[k] || {}), ...clone(r) }));
  const tbl = (name) => (T[name] ||= []);
  const hits = new Map(), files = new Map();
  const same = (a, b, cols) => cols.every((c) => a[c] === b[c]);
  const clash = (name, row, skip) => [KEYS[name] || ['id'], ...(UNIQUE[name] || [])].some((cols) => !cols.some((c) => row[c] == null) && tbl(name).some((r) => r !== skip && same(r, row, cols)));
  const bad = (name, row) => CHECKS[name] && !CHECKS[name](row);
  function from(name) {
    const st = { op: 'select', filters: [], order: null, limit: null, ret: false, single: false, vals: null, opts: {} };
    const keep = (r) => st.filters.every((f) => f(r));
    function run() {
      const rows = tbl(name);
      if (st.op === 'insert' || st.op === 'upsert') {
        const out = [];
        for (const v of Array.isArray(st.vals) ? st.vals : [st.vals]) {
          const cols = st.opts.onConflict ? st.opts.onConflict.split(',') : KEYS[name] || ['id'];
          const old = st.op === 'upsert' ? rows.find((r) => same(r, v, cols)) : null;
          if (old) {
            if (st.opts.ignoreDuplicates) continue;
            const next = { ...old, ...clone(v) };
            if (bad(name, next)) return { data: null, error: { code: '23514', message: 'check' } };
            Object.assign(old, clone(v)); out.push(old); continue;
          }
          const row = { ...(DEFAULTS[name] || {}), ...clone(v) };
          if (clash(name, row)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          if (bad(name, row)) return { data: null, error: { code: '23514', message: 'check' } };
          rows.push(row); out.push(row);
        }
        return { data: st.ret ? clone(out) : null, error: null };
      }
      if (st.op === 'update') {
        const hit = rows.filter(keep);
        for (const r of hit) {
          const next = { ...r, ...clone(st.vals) };
          if (bad(name, next) || clash(name, next, r)) return { data: null, error: { code: '23514', message: 'check' } };
        }
        for (const r of hit) Object.assign(r, clone(st.vals));
        return { data: st.ret ? clone(hit) : null, error: null };
      }
      if (st.op === 'delete') {
        T[name] = rows.filter((r) => !keep(r));
        return { data: null, error: null };
      }
      let out = rows.filter(keep);
      if (st.order) {
        const [c, asc] = st.order;
        // Postgres 처럼: 오름차순은 null 이 뒤, 내림차순은 null 이 앞
        out = [...out].sort((a, b) => (a[c] == null && b[c] == null ? 0 : a[c] == null ? (asc ? 1 : -1) : b[c] == null ? (asc ? -1 : 1) : (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1)));
      }
      if (st.limit != null) out = out.slice(0, st.limit);
      if (st.single) return { data: out[0] ? clone(out[0]) : null, error: null };
      return { data: clone(out), error: null };
    }
    const b = {
      select() { if (st.op !== 'select') st.ret = true; return b; },
      insert(v) { st.op = 'insert'; st.vals = v; return b; },
      upsert(v, opts = {}) { st.op = 'upsert'; st.vals = v; st.opts = opts; return b; },
      update(v) { st.op = 'update'; st.vals = v; return b; },
      delete() { st.op = 'delete'; return b; },
      eq(c, v) { st.filters.push((r) => r[c] === v); return b; },
      neq(c, v) { st.filters.push((r) => r[c] != null && r[c] !== v); return b; },
      in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return b; },
      is(c, v) { st.filters.push((r) => (r[c] ?? null) === v); return b; },
      not(c, op, v) { assert.equal(op, 'is'); st.filters.push((r) => (r[c] ?? null) !== v); return b; },
      lt(c, v) { st.filters.push((r) => r[c] != null && r[c] < v); return b; },
      order(c, o = {}) { st.order = [c, o.ascending !== false]; return b; },
      limit(n) { st.limit = n; return b; },
      maybeSingle() { st.single = true; return Promise.resolve().then(run); },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); }
    };
    return b;
  }
  return {
    T, hits, files, from,
    rpc: async (name, a) => {
      assert.equal(name, 'fp_hit');
      const n = (hits.get(a.p_key) || 0) + 1;
      hits.set(a.p_key, n);
      return { data: n <= a.p_max, error: null };
    },
    storage: {
      from(bucket) {
        return {
          upload: async (p, blob, opts) => { files.set(`${bucket}/${p}`, { text: await blob.text(), opts }); return { data: { path: p }, error: null }; },
          remove: async (paths) => { for (const p of paths) files.delete(`${bucket}/${p}`); return { data: [], error: null }; }
        };
      }
    }
  };
}

// ---- 가짜 인터넷: 포트원 결제 조회 · 디스코드 웹후크 ----
function fakeNet() {
  const calls = [], hooks = [], payments = {};
  let down = false, delay = 0;
  const fetch = async (url, init = {}) => {
    url = String(url);
    if (url.startsWith('https://api.portone.io/')) {
      calls.push({ url, method: init.method || 'GET', auth: new Headers(init.headers || {}).get('authorization') });
      if (delay) await new Promise((r) => setTimeout(r, delay));   // 동시에 온 요청이 모두 포트원 답을 기다리게(경쟁 시험)
      if (down) return new Response(JSON.stringify({ type: 'UNKNOWN', message: '시험: 포트원 고장' }), { status: 500 });
      const m = url.match(/^https:\/\/api\.portone\.io\/payments\/([^/?]+)$/);
      const p = m && payments[decodeURIComponent(m[1])];
      if (!p) return new Response(JSON.stringify({ type: 'PAYMENT_NOT_FOUND', message: '결제 건이 존재하지 않습니다.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify(p), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://discord.com/api/webhooks/')) { hooks.push(JSON.parse(init.body).content); return new Response(null, { status: 204 }); }
    throw new Error('시험에서 모르는 주소예요: ' + url);
  };
  return { fetch, calls, hooks, payments, setDown: (v) => { down = v; }, setDelay: (ms) => { delay = ms; } };
}
// 포트원 V2 GET /payments/{paymentId} 답(필요한 칸만)
const payment = (o, over = {}) => ({
  status: 'PAID', id: 'mk-' + o.id, transactionId: 'tx-test-1', merchantId: 'merchant-test', storeId: STORE,
  channel: { type: 'LIVE', id: 'channel-id-test', key: CHANNEL, name: 'KG이니시스', pgProvider: 'INICIS_V2', pgMerchantId: 'INIpayTest' },
  orderName: '시험', amount: { total: o.amount, taxFree: 0, vat: 0, supply: o.amount, discount: 0, paid: o.amount, cancelled: 0, cancelledTaxFree: 0 },
  currency: 'KRW', paidAt: '2026-12-05T03:00:00Z', ...over
});
const TEST_CHANNEL = { type: 'TEST', id: 'channel-id-test', key: CHANNEL, name: 'KG이니시스 테스트', pgProvider: 'INICIS_V2', pgMerchantId: 'INIpayTest' };

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const MEMBERS = [
  { id: 'mDj', login_id: 'bamtol', nickname: '밤톨', verified: false, state: 'active', is_admin: false, role: 'dj' },
  { id: 'mKg', login_id: 'inicistest', nickname: '심사', verified: false, state: 'active', is_admin: false, role: 'dj' },
  { id: 'mOp', login_id: 'opsmunchi', nickname: '운영', verified: false, state: 'active', is_admin: true, role: 'dj' },
  { id: 'mEtc', login_id: 'dalmuri', nickname: '달무리', verified: false, state: 'active', is_admin: false, role: 'listener' }
];
const URL_FN = 'https://example.supabase.co/functions/v1/bakje-billing';

function setup({ now = BEFORE_DEC, card = CARD, billing = BILLING, env = {}, owners = [], albums = [], ents = [], hosts = [] } = {}) {
  let clock = now;
  const tokens = {}, sessions = [];
  for (const m of MEMBERS) { const t = crypto.randomBytes(32).toString('base64url'); tokens[m.id] = t; sessions.push({ token: sha(t), member: m.id, expires: now + 365 * DAY }); }
  const db = fakeDb({
    bj_members: MEMBERS, bj_sessions: sessions, bj_orders: [], bj_entitlements: ents, bj_push_subs: [],
    bj_settings: [{ key: 'billing', value: billing, updated: 0 }, ...(card ? [{ key: 'card', value: card, updated: 0 }] : [])],
    bj_albums: albums, bj_hosts: [...albums.map((a) => ({ host: `${a.id}.xn--s22bu18a0ub.com`, album: a.id, created: 1 })), ...hosts.map((host) => ({ host, album: albums[0]?.id || 'aany', created: 1 }))], bj_album_owners: owners
  });
  const net = fakeNet();
  const E = { PORTONE_API_SECRET: SECRET, PORTONE_STORE_ID: STORE, BILLING_WEBHOOK: HOOK, ...env };
  const handler = freshHandler({ db, env: (k) => E[k], fetch: net.fetch, clock: () => clock });
  const call = async (who, action, body = {}) => {
    // who = null 이면 로그인 안 한 방문자(머리말 없음)
    const headers = { 'Content-Type': 'application/json', ...(who ? { 'x-bj-session': tokens[who] } : {}) };
    const res = await handler(new Request(URL_FN, { method: 'POST', headers, body: JSON.stringify({ action, ...body }) }));
    return { status: res.status, body: await res.json() };
  };
  return { db, T: db.T, net, call, handler, setNow: (t) => { clock = t; }, now: () => clock };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true); return r.body; };
const row = (s, id) => s.T.bj_orders.find((o) => o.id === id);
const entOf = (s, member, product) => s.T.bj_entitlements.find((e) => e.member === member && e.product === product)?.until;

// ================= 시험 =================

test('함수 글에 백슬래시-u 글자 표기가 없다(MCP 로 올릴 때 풀려 버림)', () => {
  assert.ok(!/\\u[0-9a-fA-F]{4}/.test(raw));
  assert.ok(!/\\u\{/.test(raw));
});

test('health: v 6 · card true', async () => {
  const s = setup();
  const res = await s.handler(new Request(URL_FN + '/health'));
  const j = await res.json();
  assert.equal(res.status, 200);
  assert.equal(j.v, 6);
  assert.equal(j.card, true);
  assert.equal(j.munchkinPass, true);
});

test('⑨ info.card(변경 4): 테스트 모드면 모두 show · 결제(canPay)는 심사 계정·운영자만 · 다른 회원 card-start 403', async () => {
  const s = setup();
  const dj = ok(await s.call('mDj', 'info'));
  assert.deepEqual(dj.card, { show: true, canPay: false, mode: 'test', storeId: STORE, channelKey: CHANNEL });
  const r = await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 });
  assert.equal(r.status, 403);
  assert.equal(r.body.ok, false);
  assert.equal(typeof r.body.error, 'string');
  assert.equal(s.T.bj_orders.length, 0);
  for (const who of ['mKg', 'mOp']) {
    const i = ok(await s.call(who, 'info'));
    assert.deepEqual(i.card, { show: true, canPay: true, mode: 'test', storeId: STORE, channelKey: CHANNEL }, who);
    assert.ok(!JSON.stringify(i).includes(SECRET), '비밀 값이 답에 나오면 안 돼요');
  }
});

test('⑨ card 설정: off·설정 없음 → 아무도 못 봄(키 빈 글) · 채널 키·상점 아이디 없으면 결제 못 함 · live 면 모두 결제', async () => {
  const hidden = { show: false, canPay: false, mode: 'test', storeId: '', channelKey: '' };
  for (const opt of [{ card: { ...CARD, on: 'off' } }, { card: null }]) {
    const s = setup(opt);
    for (const who of ['mDj', 'mKg', 'mOp']) assert.deepEqual(ok(await s.call(who, 'info')).card, hidden, JSON.stringify(opt) + who);
    assert.equal((await s.call('mKg', 'card-start', { plan: 'munchkin', months: 1 })).status, 403);
  }
  for (const opt of [{ card: { ...CARD, channelKey: '' } }, { env: { PORTONE_STORE_ID: '' } }]) {
    const s = setup(opt);
    for (const who of ['mDj', 'mKg', 'mOp']) {
      const c = ok(await s.call(who, 'info')).card;
      assert.equal(c.show, true);
      assert.equal(c.canPay, false, JSON.stringify(opt) + who);
    }
    assert.equal((await s.call('mKg', 'card-start', { plan: 'munchkin', months: 1 })).status, 403);
  }
  const live = setup({ card: LIVE });
  for (const who of ['mDj', 'mKg', 'mEtc']) assert.deepEqual(ok(await live.call(who, 'info')).card, { show: true, canPay: true, mode: 'live', storeId: STORE, channelKey: CHANNEL });
  // 모르는 이용권·기간은 order 와 같이 400
  assert.equal((await live.call('mDj', 'card-start', { plan: 'gold', months: 1 })).status, 400);
  assert.equal((await live.call('mDj', 'card-start', { plan: 'album', months: 2 })).status, 400);
});

test('변경 1: 12/1 신청 문 없음 · 추억앨범 새 앨범 신청은 기본 열림(albumOpen:false 면 닫힘) · info.now · munchkinFrom 은 지난 때', async () => {
  const s = setup({ now: BEFORE_DEC });
  const m = ok(await s.call('mDj', 'order', { plan: 'munchkin', months: 1 }));
  assert.equal(m.order.amount, 3000);
  const a = ok(await s.call('mEtc', 'order', { plan: 'bundle', months: 1, newAlbum: { label: '달빛', name: '달빛 추억앨범' } }));
  assert.ok(row(s, a.order.id).want_host.endsWith('.xn--s22bu18a0ub.com'));
  const info = ok(await s.call('mDj', 'info'));
  assert.equal(info.albumOpen, true);
  assert.equal(info.now, BEFORE_DEC);
  assert.equal(info.munchkinPaidFrom, PAID_FROM);
  assert.ok(info.munchkinFrom <= BEFORE_DEC, '옛 화면이 12/1 을 기다리지 않게');
  const closed = setup({ billing: { ...BILLING, albumOpen: false } });
  const beta = await closed.call('mEtc', 'order', { plan: 'bundle', months: 1, newAlbum: { label: '달빛', name: '달빛 추억앨범' } });
  assert.equal(beta.status, 403);
  assert.equal(beta.body.error, ALBUM_BETA);
  assert.equal(ok(await closed.call('mDj', 'info')).albumOpen, false);
  // 가진 앨범 연장은 닫혀 있어도 된다(전과 같이)
  const own = setup({ billing: { ...BILLING, albumOpen: false }, albums: [{ id: 'abamtol', name: '밤톨 추억앨범', state: 'active', paid_until: null }], owners: [{ album: 'abamtol', member: 'mDj', created: 1 }] });
  ok(await own.call('mDj', 'order', { plan: 'album', months: 1 }));
});

test('로그인 안 한 방문자: prices 로 상품·가격·카드 표시만(결제는 못 함) · 그 밖의 동작은 401', async () => {
  const s = setup();
  const p = ok(await s.call(null, 'prices'));
  assert.deepEqual(p.prices, BILLING.prices);
  assert.deepEqual(p.year, BILLING.year);
  assert.deepEqual(p.months, [1, 3, 6, 12]);
  assert.equal(p.open, true);
  assert.equal(p.albumOpen, true);
  assert.equal(p.munchkinPaidFrom, PAID_FROM);
  assert.equal(p.now, BEFORE_DEC);
  assert.deepEqual(p.card, { show: true, canPay: false, mode: 'test', storeId: '', channelKey: '' });
  assert.equal(p.bank, undefined, '계좌는 로그인한 회원에게만');
  assert.ok(!JSON.stringify(p).includes(SECRET));
  for (const action of ['info', 'order', 'card-start', 'card-done']) assert.equal((await s.call(null, action, { plan: 'munchkin', months: 1 })).status, 401, action);
  // 로그인한 회원이 prices 를 불러도 된다
  ok(await s.call('mDj', 'prices'));
});

test('테스트 모드 카드 신청(test_only): 금액은 서버가 · 같은 내용이면 같은 신청 · 새 앨범 주소는 잡지 않음 · 한도는 order 와 같이', async () => {
  const s = setup();
  const r = ok(await s.call('mKg', 'card-start', { plan: 'munchkin', months: 1, amount: 1, totalAmount: 1 }));
  const o = r.order;
  assert.match(o.id, /^o[a-z0-9]{11}$/);
  assert.equal(o.amount, 3000);
  assert.equal(o.state, 'pending');
  assert.equal(o.pay, 'card');
  assert.equal(o.payAt, null);
  assert.deepEqual(r.pay, { storeId: STORE, channelKey: CHANNEL, paymentId: 'mk-' + o.id, orderName: '먼치킨 이용권 1개월', totalAmount: 3000, currency: 'KRW', payMethod: 'CARD',
    redirectUrl: 'https://xn--s22bu18a0ub.com/album/?pay=' + o.id });
  assert.equal(r.bank, undefined, '카드 신청 답에 계좌는 없어요');
  const saved = row(s, o.id);
  assert.equal(saved.pay, 'card');
  assert.equal(saved.pay_id, 'mk-' + o.id);
  assert.equal(saved.test_only, true);
  const again = ok(await s.call('mKg', 'card-start', { plan: 'munchkin', months: 1 }));
  assert.equal(again.order.id, o.id);
  assert.equal(again.pay.paymentId, 'mk-' + o.id);
  assert.equal(s.T.bj_orders.length, 1);
  const three = ok(await s.call('mKg', 'card-start', { plan: 'munchkin', months: 3 }));
  assert.notEqual(three.order.id, o.id);
  assert.equal(three.pay.totalAmount, 9000);
  const b = ok(await s.call('mKg', 'card-start', { plan: 'bundle', months: 12, newAlbum: { label: '먼치', name: '먼치 추억앨범' } }));
  assert.equal(b.pay.totalAmount, 50000);
  assert.equal(b.pay.orderName, '먼치킨 + 추억앨범 이용권 1년');
  const brow = row(s, b.order.id);
  assert.equal(brow.want_host, null);
  assert.equal(brow.test_only, true);
  assert.match(brow.note, /먼치/);
  assert.equal(b.order.newAlbum, null);
  // 실연동(live)에서 만든 카드 신청은 test_only 가 아니다
  const l = setup({ card: LIVE });
  const lo = ok(await l.call('mKg', 'card-start', { plan: 'munchkin', months: 1 })).order;
  assert.equal(row(l, lo.id).test_only, false);
});

test('변경 6: card-start returnUrl — 먼치킨.com·그 하위 주소·추억앨범 주소만, 아니면 먼치킨.com/album', async () => {
  const s = setup({ card: LIVE, albums: [{ id: 'abamtol', name: '밤톨 추억앨범', state: 'active', paid_until: null }], owners: [{ album: 'abamtol', member: 'mDj', created: 1 }], hosts: ['album-test.example'] });
  const go = async (returnUrl, months = 1) => ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months, returnUrl })).pay.redirectUrl;
  const id = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order.id;
  assert.equal(await go('https://album-test.example/?tab=me#plan'), 'https://album-test.example/?tab=me&pay=' + id);
  assert.equal(await go('https://abamtol.xn--s22bu18a0ub.com/'), 'https://abamtol.xn--s22bu18a0ub.com/?pay=' + id);
  assert.equal(await go('https://xn--s22bu18a0ub.com/album/?pay=oold00000000&paymentId=mk-x&code=FAIL&message=no'), 'https://xn--s22bu18a0ub.com/album/?pay=' + id);
  assert.equal(await go('https://www.xn--s22bu18a0ub.com/album/'), 'https://www.xn--s22bu18a0ub.com/album/?pay=' + id);
  const DEF = 'https://xn--s22bu18a0ub.com/album/?pay=' + id;
  for (const bad of ['https://evil.example/', 'http://xn--s22bu18a0ub.com/album/', 'https://xn--s22bu18a0ub.com.evil.example/', 'https://user:pw@xn--s22bu18a0ub.com/', 'https://xn--s22bu18a0ub.com:8443/',
    'javascript:alert(1)', '//evil.example/', '/album/', 12, { href: 'https://evil.example/' }, 'https://album-test.example.evil.example/', 'https://evilxn--s22bu18a0ub.com/',
    // 고침 1회차 5번: 먼치킨.com 하위 주소라도 앨범 주소(bj_hosts)가 아니면 받지 않는다(bakje siteOf 와 같은 판단 — apex·www·bj_hosts)
    'https://nothere.xn--s22bu18a0ub.com/', 'https://a.b.xn--s22bu18a0ub.com/'])
    assert.equal(await go(bad), DEF, JSON.stringify(bad));
  assert.equal(s.T.bj_orders.length, 1, '돌아올 주소가 달라도 같은 신청');
});

test('① 실제 결제(LIVE)·금액 같음 → 이용권 한 번 · 운영자 알림 💳 · 1/1 전 결제는 1/1 부터', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const st = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 }));
  assert.equal(row(s, st.order.id).test_only, false);
  s.net.payments['mk-' + st.order.id] = payment(st.order);
  const r = ok(await s.call('mDj', 'card-done', { id: st.order.id }));
  assert.equal(r.state, 'paid');
  assert.equal(r.order.state, 'paid');
  assert.equal(r.order.pay, 'card');
  assert.equal(typeof r.order.payAt, 'number');
  assert.equal(entOf(s, 'mDj', 'munchkin'), PAID_FROM + 30 * DAY);
  const saved = row(s, st.order.id);
  assert.equal(saved.state, 'paid');
  assert.equal(saved.pay_channel, 'LIVE');
  assert.equal(saved.done, AFTER_DEC);
  assert.equal(s.net.calls.length, 1);
  assert.equal(s.net.calls[0].url, 'https://api.portone.io/payments/mk-' + st.order.id);
  assert.equal(s.net.calls[0].auth, 'PortOne ' + SECRET);
  assert.equal(s.net.hooks.filter((t) => t.includes('💳')).length, 1);
  assert.ok(!s.net.hooks.join('\n').includes(SECRET));
  const pass = ok(await s.call('mDj', 'munchkin-pass'));
  assert.equal(pass.until, PAID_FROM + 30 * DAY);
  // 1/1 뒤 결제는 그때부터
  const j = setup({ card: LIVE, now: AFTER_JAN });
  const jo = ok(await j.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  j.net.payments['mk-' + jo.id] = payment(jo);
  ok(await j.call('mDj', 'card-done', { id: jo.id }));
  assert.equal(entOf(j, 'mDj', 'munchkin'), AFTER_JAN + 30 * DAY);
});

test('① 가진 앨범 연장(먼치킨 + 추억앨범 1년) · 새 추억앨범 카드 결제 → 앨범·주소까지 · 추억앨범도 1/1 부터(변경 3)', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC, albums: [{ id: 'abamtol', name: '밤톨 추억앨범', state: 'active', paid_until: null }], owners: [{ album: 'abamtol', member: 'mDj', created: 1 }] });
  const st = ok(await s.call('mDj', 'card-start', { plan: 'bundle', months: 12 }));
  assert.equal(st.pay.totalAmount, 50000);
  s.net.payments['mk-' + st.order.id] = payment(st.order);
  assert.equal(ok(await s.call('mDj', 'card-done', { id: st.order.id })).state, 'paid');
  assert.equal(entOf(s, 'mDj', 'munchkin'), PAID_FROM + 360 * DAY);
  assert.equal(entOf(s, 'mDj', 'album'), PAID_FROM + 360 * DAY);
  assert.equal(s.T.bj_albums.find((a) => a.id === 'abamtol').paid_until, PAID_FROM + 360 * DAY);
  const n = ok(await s.call('mEtc', 'card-start', { plan: 'album', months: 1, newAlbum: { label: '달빛', name: '달빛 추억앨범' } }));
  assert.ok(row(s, n.order.id).want_host.endsWith('.xn--s22bu18a0ub.com'));
  assert.equal(ok(await s.call('mEtc', 'card-start', { plan: 'album', months: 1, newAlbum: { label: '달빛', name: '달빛 추억앨범' } })).order.id, n.order.id);
  assert.equal((await s.call('mEtc', 'order', { plan: 'album', months: 3, newAlbum: { label: '별빛', name: '별빛 추억앨범' } })).status, 409);
  s.net.payments['mk-' + n.order.id] = payment(n.order);
  const done = ok(await s.call('mEtc', 'card-done', { id: n.order.id }));
  assert.equal(done.state, 'paid');
  const albumId = row(s, n.order.id).album;
  assert.match(albumId, /^a[a-z0-9]{9}$/);
  assert.ok(s.T.bj_album_owners.some((x) => x.album === albumId && x.member === 'mEtc'));
  assert.ok(s.T.bj_hosts.some((h) => h.album === albumId));
  assert.equal(entOf(s, 'mEtc', 'album'), PAID_FROM + 30 * DAY);
  assert.equal(s.T.bj_albums.find((a) => a.id === albumId).paid_until, PAID_FROM + 30 * DAY, '새 앨범은 바로 쓰고, 돈 낸 기간은 1/1 부터');
});

test('① 카드로 새 앨범을 샀는데 그새 주소가 쓰이면: paid 그대로 + 운영자 알림(앨범 못 만듦)', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const n = ok(await s.call('mEtc', 'card-start', { plan: 'album', months: 1, newAlbum: { label: '달빛', name: '달빛 추억앨범' } }));
  const host = row(s, n.order.id).want_host;
  s.T.bj_hosts.push({ host, album: 'aother', created: 2 });
  s.net.payments['mk-' + n.order.id] = payment(n.order);
  const r = ok(await s.call('mEtc', 'card-done', { id: n.order.id }));
  assert.equal(r.state, 'paid');
  assert.equal(typeof r.message, 'string');
  assert.equal(row(s, n.order.id).state, 'paid');
  assert.equal(entOf(s, 'mEtc', 'album'), PAID_FROM + 30 * DAY);
  assert.ok(s.net.hooks.some((t) => t.includes('앨범') && t.includes('환불')));
});

test('② card-done 두 번 · card-done 과 info 다시 확인이 동시에 와도 이용 기간은 한 번만', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const st = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 }));
  s.net.payments['mk-' + st.order.id] = payment(st.order);
  assert.equal(ok(await s.call('mDj', 'card-done', { id: st.order.id })).state, 'paid');
  assert.equal(ok(await s.call('mDj', 'card-done', { id: st.order.id })).state, 'paid');
  assert.equal(entOf(s, 'mDj', 'munchkin'), PAID_FROM + 30 * DAY);
  assert.equal(s.net.hooks.filter((t) => t.includes('💳')).length, 1);

  const c = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await c.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  c.net.payments['mk-' + o.id] = payment(o);
  c.setNow(AFTER_DEC + 2 * 60000);   // 1분 지난 신청 → info 가 다시 물어 본다
  c.net.setDelay(30);
  const all = await Promise.all([c.call('mDj', 'card-done', { id: o.id }), c.call('mDj', 'card-done', { id: o.id }), c.call('mDj', 'info'), c.call('mDj', 'info')]);
  for (const r of all) ok(r);
  assert.equal(c.net.calls.length, 4, '네 요청이 모두 기다림 상태를 보고 포트원에 물었어요(경쟁)');
  assert.equal(entOf(c, 'mDj', 'munchkin'), PAID_FROM + 30 * DAY);
  assert.equal(c.T.bj_orders.filter((x) => x.state === 'paid').length, 1);
  assert.equal(c.net.hooks.filter((t) => t.includes('💳')).length, 1);
});

test('② info 다시 확인: 1분 안 된 신청은 묻지 않고, 1분 지나면 물어서 마친다(창을 닫아 버린 경우)', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  s.net.payments['mk-' + o.id] = payment(o);
  s.setNow(AFTER_DEC + 30000);
  const early = ok(await s.call('mDj', 'info'));
  assert.equal(s.net.calls.length, 0);
  assert.equal(early.orders[0].state, 'pending');
  s.setNow(AFTER_DEC + 61000);
  const late = ok(await s.call('mDj', 'info'));
  assert.equal(s.net.calls.length, 1);
  assert.equal(late.orders[0].state, 'paid');
  assert.equal(late.ents.munchkin, PAID_FROM + 30 * DAY);
  const n = setup({ card: LIVE, now: AFTER_DEC, env: { PORTONE_API_SECRET: '' } });
  ok(await n.call('mDj', 'card-start', { plan: 'munchkin', months: 1 }));
  n.setNow(AFTER_DEC + 120000);
  ok(await n.call('mDj', 'info'));
  assert.equal(n.net.calls.length, 0);
  const d = setup({ card: LIVE, now: AFTER_DEC });
  ok(await d.call('mDj', 'card-start', { plan: 'munchkin', months: 1 }));
  d.net.setDown(true);
  d.setNow(AFTER_DEC + 120000);
  ok(await d.call('mDj', 'info'));
});

test('③ 테스트 채널(TEST) 결제 → state test · 이용권·앨범 없음 · 운영자 알림 🧪 (live 모드·보통 회원이어도)', async () => {
  const s = setup();
  const o = ok(await s.call('mKg', 'card-start', { plan: 'munchkin', months: 1 })).order;
  s.net.payments['mk-' + o.id] = payment(o, { channel: TEST_CHANNEL });
  const r = ok(await s.call('mKg', 'card-done', { id: o.id }));
  assert.equal(r.state, 'test');
  assert.equal(r.order.state, 'test');
  assert.equal(typeof r.order.payAt, 'number');
  assert.equal(row(s, o.id).pay_channel, 'TEST');
  assert.equal(s.T.bj_entitlements.length, 0);
  assert.equal(s.net.hooks.filter((t) => t.includes('🧪')).length, 1);
  assert.equal(ok(await s.call('mKg', 'card-done', { id: o.id })).state, 'test');
  assert.equal(s.net.hooks.filter((t) => t.includes('🧪')).length, 1);

  const a = setup({ card: LIVE, now: AFTER_DEC });
  const o2 = ok(await a.call('mEtc', 'card-start', { plan: 'bundle', months: 1, newAlbum: { label: '달빛', name: '달빛 추억앨범' } })).order;
  a.net.payments['mk-' + o2.id] = payment(o2, { channel: TEST_CHANNEL });
  assert.equal(ok(await a.call('mEtc', 'card-done', { id: o2.id })).state, 'test');
  assert.equal(a.T.bj_entitlements.length, 0);
  assert.equal(a.T.bj_albums.length, 0, '테스트 결제로 앨범이 생기면 안 돼요');
  assert.equal(ok(await a.call('mEtc', 'munchkin-pass')).active, false);
  const u = setup({ card: LIVE, now: AFTER_DEC });
  const o3 = ok(await u.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  u.net.payments['mk-' + o3.id] = payment(o3, { channel: { pgProvider: 'INICIS_V2' } });
  assert.notEqual(ok(await u.call('mDj', 'card-done', { id: o3.id })).state, 'paid');
  assert.equal(u.T.bj_entitlements.length, 0);
});

test('④ 테스트 모드에서 만든 카드 신청(test_only)에 실제 돈(LIVE)이 들어와도 이용권 없음 · 운영자에게 환불 알림', async () => {
  const s = setup();
  const o = ok(await s.call('mKg', 'card-start', { plan: 'munchkin', months: 1 })).order;
  s.net.payments['mk-' + o.id] = payment(o);
  const r = ok(await s.call('mKg', 'card-done', { id: o.id }));
  assert.equal(r.state, 'test');
  assert.equal(typeof r.message, 'string');
  assert.equal(row(s, o.id).state, 'test');
  assert.equal(row(s, o.id).pay_channel, 'LIVE');
  assert.equal(s.T.bj_entitlements.length, 0);
  assert.equal(s.net.hooks.filter((t) => t.includes('환불')).length, 1);
  const op = ok(await s.call('mOp', 'card-start', { plan: 'munchkin', months: 1 })).order;
  s.net.payments['mk-' + op.id] = payment(op);
  assert.equal(ok(await s.call('mOp', 'card-done', { id: op.id })).state, 'test');
  assert.equal(s.T.bj_entitlements.length, 0);
  // 나중에 live 로 바꿔도, 테스트 모드에서 만든 신청은 그대로 이용권 없음
  const k = setup();
  const ko = ok(await k.call('mKg', 'card-start', { plan: 'munchkin', months: 1 })).order;
  k.T.bj_settings.find((x) => x.key === 'card').value = LIVE;
  k.net.payments['mk-' + ko.id] = payment(ko);
  assert.equal(ok(await k.call('mKg', 'card-done', { id: ko.id })).state, 'test');
  assert.equal(k.T.bj_entitlements.length, 0);
});

test('⑤ 금액·통화·결제 번호·상점이 다르면 이용권 없음 · 신청은 기다림 그대로 · 운영자 알림 한 번', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  s.net.payments['mk-' + o.id] = payment(o, { amount: { total: 100, paid: 100, cancelled: 0 } });
  const r = ok(await s.call('mDj', 'card-done', { id: o.id }));
  assert.equal(r.state, 'failed');
  assert.equal(typeof r.message, 'string');
  assert.equal(row(s, o.id).state, 'pending');
  assert.equal(s.T.bj_entitlements.length, 0);
  assert.equal(ok(await s.call('mDj', 'card-done', { id: o.id })).state, 'failed');
  assert.equal(s.net.hooks.filter((t) => t.includes('금액')).length, 1);
  for (const over of [{ currency: 'USD' }, { id: 'mk-oelse0000000' }, { storeId: 'store-else' }]) {
    const t = setup({ card: LIVE, now: AFTER_DEC });
    const x = ok(await t.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
    t.net.payments['mk-' + x.id] = payment(x, over);
    assert.equal(ok(await t.call('mDj', 'card-done', { id: x.id })).state, 'failed', JSON.stringify(over));
    assert.equal(t.T.bj_entitlements.length, 0);
  }
});

test('⑥ 결제 전(READY·결제 없음) → pending · FAILED·CANCELLED → failed · 신청은 기다림 그대로 · 실패 뒤 다시 결제하면 된다', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  const none = ok(await s.call('mDj', 'card-done', { id: o.id }));
  assert.equal(none.state, 'pending');
  assert.equal(none.order.state, 'pending');
  s.net.payments['mk-' + o.id] = { status: 'READY', id: 'mk-' + o.id, storeId: STORE, channel: { type: 'LIVE' }, amount: { total: o.amount }, currency: 'KRW' };
  assert.equal(ok(await s.call('mDj', 'card-done', { id: o.id })).state, 'pending');
  s.net.payments['mk-' + o.id] = { status: 'FAILED', id: 'mk-' + o.id, storeId: STORE, channel: { type: 'LIVE' }, amount: { total: o.amount }, currency: 'KRW', failure: { reason: '카드 한도 초과' } };
  const failed = ok(await s.call('mDj', 'card-done', { id: o.id }));
  assert.equal(failed.state, 'failed');
  assert.equal(typeof failed.message, 'string');
  assert.equal(row(s, o.id).state, 'pending');
  s.net.payments['mk-' + o.id] = payment(o, { status: 'CANCELLED' });
  assert.equal(ok(await s.call('mDj', 'card-done', { id: o.id })).state, 'failed');
  assert.equal(row(s, o.id).state, 'pending');
  assert.equal(s.T.bj_entitlements.length, 0);
  s.net.payments['mk-' + o.id] = payment(o);
  assert.equal(ok(await s.call('mDj', 'card-done', { id: o.id })).state, 'paid');
  assert.equal(entOf(s, 'mDj', 'munchkin'), PAID_FROM + 30 * DAY);
  const d = setup({ card: LIVE, now: AFTER_DEC });
  const x = ok(await d.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  d.net.setDown(true);
  assert.equal((await d.call('mDj', 'card-done', { id: x.id })).status, 503);
  assert.equal(row(d, x.id).state, 'pending');
  const c = setup({ card: LIVE, now: AFTER_DEC });
  const y = ok(await c.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  ok(await c.call('mDj', 'cancel', { id: y.id }));
  // 고침 1회차 1번: 취소한 카드 신청도 card-done 이 오면 포트원에 묻는다(결제 없음 → failed, 이용권 없음)
  const calls = c.net.calls.length;
  const late = ok(await c.call('mDj', 'card-done', { id: y.id }));
  assert.equal(late.state, 'failed');
  assert.equal(late.order.state, 'canceled');
  assert.equal(c.net.calls.length, calls + 1);
  assert.equal(c.net.hooks.length, 0);
});

test('⑦ 남의 신청 번호 · 계좌이체 신청 · 없는 번호로 card-done → 404 (포트원에 묻지 않음)', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  s.net.payments['mk-' + o.id] = payment(o);
  const other = await s.call('mEtc', 'card-done', { id: o.id });
  assert.equal(other.status, 404);
  assert.equal(other.body.ok, false);
  const bank = ok(await s.call('mDj', 'order', { plan: 'munchkin', months: 3 })).order;
  assert.equal((await s.call('mDj', 'card-done', { id: bank.id })).status, 404);
  assert.equal((await s.call('mDj', 'card-done', { id: 'onothing00000' })).status, 404);
  assert.equal((await s.call('mDj', 'card-done', {})).status, 404);
  assert.equal(s.net.calls.length, 0);
  assert.equal(row(s, o.id).state, 'pending');
  assert.equal(s.T.bj_entitlements.length, 0);
});

test('⑧ 카드 신청은 sent·ops-confirm 이 거절 · 운영자 기다림 목록에서 빠짐(지난 신청엔 pay card)', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  const sent = await s.call('mDj', 'sent', { id: o.id });
  assert.equal(sent.status, 404);
  assert.equal(row(s, o.id).sent, null);
  assert.equal(s.net.hooks.length, 0);
  const conf = await s.call('mOp', 'ops-confirm', { id: o.id });
  assert.equal(conf.status, 404);
  assert.equal(row(s, o.id).state, 'pending');
  assert.equal(s.T.bj_entitlements.length, 0);
  const bank = ok(await s.call('mDj', 'order', { plan: 'munchkin', months: 3 })).order;
  const list = ok(await s.call('mOp', 'ops-orders'));
  assert.deepEqual(list.waiting.map((x) => x.id), [bank.id]);
  assert.equal(list.waiting[0].pay, 'bank');
  const t = ok(await s.call('mOp', 'card-start', { plan: 'munchkin', months: 1 })).order;
  s.net.payments['mk-' + t.id] = payment(t, { channel: TEST_CHANNEL });
  ok(await s.call('mOp', 'card-done', { id: t.id }));
  const after = ok(await s.call('mOp', 'ops-orders'));
  const done = after.recent.find((x) => x.id === t.id);
  assert.equal(done.pay, 'card');
  assert.equal(done.state, 'test');
  assert.ok(!after.waiting.some((x) => x.id === t.id || x.id === o.id));
});

test('⑩ cancel: 카드 신청은 먼저 포트원에 물어 PAID 면 취소 대신 마치기 · 결제 전이면 취소 · 못 물으면 취소 안 함', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  s.net.payments['mk-' + o.id] = payment(o);
  const r = ok(await s.call('mDj', 'cancel', { id: o.id }));
  assert.equal(r.finished, true);
  assert.equal(r.state, 'paid');
  assert.equal(r.order.state, 'paid');
  assert.equal(typeof r.message, 'string');
  assert.equal(row(s, o.id).state, 'paid');
  assert.equal(entOf(s, 'mDj', 'munchkin'), PAID_FROM + 30 * DAY);
  const k = setup();
  const t = ok(await k.call('mKg', 'card-start', { plan: 'munchkin', months: 1 })).order;
  k.net.payments['mk-' + t.id] = payment(t, { channel: TEST_CHANNEL });
  const kr = ok(await k.call('mKg', 'cancel', { id: t.id }));
  assert.equal(kr.state, 'test');
  assert.equal(row(k, t.id).state, 'test');
  for (const p of [null, { status: 'READY' }, { status: 'FAILED' }]) {
    const c = setup({ card: LIVE, now: AFTER_DEC });
    const x = ok(await c.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
    if (p) c.net.payments['mk-' + x.id] = { ...p, id: 'mk-' + x.id, storeId: STORE, channel: { type: 'LIVE' }, amount: { total: x.amount }, currency: 'KRW' };
    const cr = ok(await c.call('mDj', 'cancel', { id: x.id }));
    assert.equal(cr.order.state, 'canceled', JSON.stringify(p));
    assert.equal(c.net.calls.length, 1);
  }
  const d = setup({ card: LIVE, now: AFTER_DEC });
  const y = ok(await d.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  d.net.setDown(true);
  assert.equal((await d.call('mDj', 'cancel', { id: y.id })).status, 503);
  assert.equal(row(d, y.id).state, 'pending');
  const b = setup({ now: AFTER_DEC });
  const bo = ok(await b.call('mDj', 'order', { plan: 'munchkin', months: 1 })).order;
  assert.equal(ok(await b.call('mDj', 'cancel', { id: bo.id })).order.state, 'canceled');
  assert.equal(b.net.calls.length, 0);
  const z = setup({ card: LIVE, now: AFTER_DEC });
  const zo = ok(await z.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  assert.equal((await z.call('mEtc', 'cancel', { id: zo.id })).status, 404);
  assert.equal(z.net.calls.length, 0);
});

test('⑪ 지금 계좌이체 흐름 그대로: order · sent · ops-confirm(1/1 전 확인은 1/1 부터)', async () => {
  const s = setup({ now: AFTER_DEC });
  const r = ok(await s.call('mDj', 'order', { plan: 'munchkin', months: 3, amount: 1 }));
  assert.equal(r.order.amount, 9000);
  assert.match(r.order.payer, /^밤톨\d{4}$/);
  assert.equal(r.order.pay, 'bank');
  assert.equal(r.order.payAt, null);
  assert.equal(r.order.state, 'pending');
  assert.deepEqual(r.bank, { bank: BILLING.bank, number: BILLING.number, holder: BILLING.holder });
  assert.equal(r.pay, undefined);
  const saved = row(s, r.order.id);
  assert.equal(saved.pay, 'bank');
  assert.equal(saved.pay_id, null);
  assert.equal(saved.test_only, false);
  const info = ok(await s.call('mDj', 'info'));
  assert.equal(info.open, true);
  assert.deepEqual(info.bank, { bank: BILLING.bank, number: BILLING.number, holder: BILLING.holder });
  assert.equal(info.orders[0].pay, 'bank');
  const sent = ok(await s.call('mDj', 'sent', { id: r.order.id }));
  assert.equal(sent.order.sent, AFTER_DEC);
  assert.equal(s.net.hooks.length, 1);
  assert.ok(s.net.hooks[0].includes('💸 입금했어요'));
  assert.ok(s.net.hooks[0].includes(r.order.payer));
  const list = ok(await s.call('mOp', 'ops-orders'));
  assert.deepEqual(list.waiting.map((x) => x.id), [r.order.id]);
  assert.equal((await s.call('mDj', 'ops-confirm', { id: r.order.id })).status, 403);
  const conf = ok(await s.call('mOp', 'ops-confirm', { id: r.order.id }));
  assert.equal(conf.order.state, 'paid');
  assert.equal(conf.until.munchkin, PAID_FROM + 90 * DAY);
  assert.equal(entOf(s, 'mDj', 'munchkin'), PAID_FROM + 90 * DAY);
  assert.equal((await s.call('mOp', 'ops-confirm', { id: r.order.id })).status, 404, '두 번 확인은 안 돼요');
  assert.equal(entOf(s, 'mDj', 'munchkin'), PAID_FROM + 90 * DAY);
  assert.equal(s.net.calls.length, 0);
});

test('⑪ 변경 3: 추억앨범 계좌이체도 1/1 전 확인은 1/1 부터(가진 앨범 연장 · 새 앨범) · 1/1 뒤는 그때부터', async () => {
  const s = setup({ now: AFTER_DEC, albums: [{ id: 'abamtol', name: '밤톨 추억앨범', state: 'active', paid_until: null }], owners: [{ album: 'abamtol', member: 'mDj', created: 1 }] });
  const a = ok(await s.call('mDj', 'order', { plan: 'album', months: 1 })).order;
  const conf = ok(await s.call('mOp', 'ops-confirm', { id: a.id }));
  assert.equal(conf.until.album, PAID_FROM + 30 * DAY);
  assert.equal(conf.until.albumPaid, PAID_FROM + 30 * DAY);
  assert.equal(s.T.bj_albums.find((x) => x.id === 'abamtol').paid_until, PAID_FROM + 30 * DAY);
  const n = ok(await s.call('mEtc', 'order', { plan: 'bundle', months: 3, newAlbum: { label: '달빛', name: '달빛 추억앨범' } })).order;
  const nc = ok(await s.call('mOp', 'ops-confirm', { id: n.id }));
  assert.ok(nc.order.newAlbum);
  assert.equal(nc.until.munchkin, PAID_FROM + 90 * DAY);
  assert.equal(nc.until.album, PAID_FROM + 90 * DAY);
  const made = s.T.bj_albums.find((x) => x.id === row(s, n.id).album);
  assert.equal(made.paid_until, PAID_FROM + 90 * DAY);
  const j = setup({ now: AFTER_JAN, albums: [{ id: 'abamtol', name: '밤톨 추억앨범', state: 'active', paid_until: null }], owners: [{ album: 'abamtol', member: 'mDj', created: 1 }] });
  const ja = ok(await j.call('mDj', 'order', { plan: 'album', months: 1 })).order;
  assert.equal(ok(await j.call('mOp', 'ops-confirm', { id: ja.id })).until.album, AFTER_JAN + 30 * DAY);
});

test('⑪ 추가(add-album) 금액: 한 달 값(1년치면 1년 값 ÷ 12) × 남은 날 ÷ 30, 100원 올림 — 남은 날은 1/1 부터 센다(변경 3)', async () => {
  const s = setup({ now: AFTER_DEC, albums: [{ id: 'abamtol', name: '밤톨 추억앨범', state: 'active', paid_until: null }], owners: [{ album: 'abamtol', member: 'mDj', created: 1 }] });
  const y = ok(await s.call('mDj', 'order', { plan: 'munchkin', months: 12 })).order;
  assert.equal(y.amount, 30000);
  ok(await s.call('mOp', 'ops-confirm', { id: y.id }));
  const end = PAID_FROM + 360 * DAY;
  const days = Math.ceil((end - PAID_FROM) / DAY);
  const expect = Math.ceil((2500 * days / 30) / 100) * 100;
  const info = ok(await s.call('mDj', 'info'));
  assert.equal(info.addons['add-album'].amount, expect);
  assert.equal(info.addons['add-album'].until, end);
  assert.equal(info.addons['add-album'].days, days);
  const add = ok(await s.call('mDj', 'order', { plan: 'add-album', album: 'abamtol' })).order;
  assert.equal(add.amount, expect);
  assert.equal(add.months, 0);
  assert.equal(add.until_to, end);
  ok(await s.call('mOp', 'ops-confirm', { id: add.id }));
  assert.equal(entOf(s, 'mDj', 'album'), end);
  assert.equal(s.T.bj_albums.find((a) => a.id === 'abamtol').paid_until, end);
  // 1/1 뒤에는 지금부터
  const j = setup({ now: AFTER_JAN, ents: [{ member: 'mDj', product: 'munchkin', until: AFTER_JAN + 60 * DAY }], albums: [{ id: 'abamtol', name: '밤톨 추억앨범', state: 'active', paid_until: null }], owners: [{ album: 'abamtol', member: 'mDj', created: 1 }] });
  const q = ok(await j.call('mDj', 'info')).addons['add-album'];
  assert.equal(q.days, 60);
  assert.equal(q.amount, Math.ceil((3000 * 60 / 30) / 100) * 100);
});

// ================= 고침 1회차(보안 검토) =================
const late = (o, over = {}) => payment(o, over);

test('고침 1: 취소한 뒤 다른 창에서 결제가 끝나면 → card-done 이 포트원에 묻고 이용권 없이 운영자에게 환불 알림 한 번', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  assert.equal(ok(await s.call('mDj', 'cancel', { id: o.id })).order.state, 'canceled');   // 그때는 결제 전(404)
  s.net.payments['mk-' + o.id] = late(o);                                                  // 그 사이 결제가 끝남
  const r = ok(await s.call('mDj', 'card-done', { id: o.id }));
  assert.equal(r.state, 'failed');
  assert.equal(r.order.state, 'canceled');
  assert.equal(typeof r.order.payAt, 'number', '돈이 들어온 때를 남긴다');
  assert.match(r.message, /취소한 신청/);
  assert.equal(row(s, o.id).pay_channel, 'LIVE');
  assert.equal(s.T.bj_entitlements.length, 0);
  assert.equal(s.net.hooks.filter((t) => t.includes('취소한 신청') && t.includes('환불')).length, 1);
  // 다시 눌러도 알림은 한 번
  ok(await s.call('mDj', 'card-done', { id: o.id }));
  assert.equal(s.net.hooks.filter((t) => t.includes('취소한 신청')).length, 1);
  assert.equal(s.T.bj_entitlements.length, 0);
});

test('고침 1: card-done 이 안 와도(창을 닫음) info 다시 확인이 취소한 신청을 한 번 묻는다 — 결제 있으면 알림, 없으면 다시 안 물음', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  ok(await s.call('mDj', 'cancel', { id: o.id }));
  s.net.payments['mk-' + o.id] = late(o);
  s.setNow(AFTER_DEC + 2 * 60000);
  ok(await s.call('mDj', 'info'));
  assert.equal(s.net.hooks.filter((t) => t.includes('취소한 신청') && t.includes('환불')).length, 1);
  assert.equal(s.T.bj_entitlements.length, 0);
  const calls = s.net.calls.length;
  ok(await s.call('mDj', 'info'));
  assert.equal(s.net.calls.length, calls, '결제를 본 신청은 다시 묻지 않아요');
  // 결제가 없는 취소 신청: 한 번 묻고 'NONE' 표시 → 다음 info 는 안 물음
  const n = setup({ card: LIVE, now: AFTER_DEC });
  const x = ok(await n.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  ok(await n.call('mDj', 'cancel', { id: x.id }));
  n.setNow(AFTER_DEC + 2 * 60000);
  const c0 = n.net.calls.length;
  ok(await n.call('mDj', 'info'));
  assert.equal(n.net.calls.length, c0 + 1);
  assert.equal(row(n, x.id).pay_channel, 'NONE');
  ok(await n.call('mDj', 'info'));
  assert.equal(n.net.calls.length, c0 + 1);
  // 그래도 card-done 은 묻는다(그 뒤에 결제가 끝난 경우)
  n.net.payments['mk-' + x.id] = late(x);
  assert.equal(ok(await n.call('mDj', 'card-done', { id: x.id })).state, 'failed');
  assert.equal(n.net.hooks.filter((t) => t.includes('취소한 신청')).length, 1);
  assert.equal(row(n, x.id).pay_channel, 'LIVE');
  // 테스트 채널 결제면 환불 알림이 아니라 테스트 표시
  const t = setup();
  const to = ok(await t.call('mKg', 'card-start', { plan: 'munchkin', months: 1 })).order;
  ok(await t.call('mKg', 'cancel', { id: to.id }));
  t.net.payments['mk-' + to.id] = late(to, { channel: TEST_CHANNEL });
  ok(await t.call('mKg', 'card-done', { id: to.id }));
  assert.equal(t.net.hooks.filter((h) => h.includes('환불')).length, 0);
  assert.equal(t.net.hooks.filter((h) => h.includes('🧪')).length, 1);
  assert.equal(row(t, to.id).pay_at, null, '실제 돈이 아니면 pay_at 을 남기지 않아요');
});

// 결제창을 닫아 버린 카드 신청을 바로 넣어 둔다(카드 신청은 card-start 때마다 앞의 것을 정리하므로)
const seedCard = (s, id, months, created) => s.T.bj_orders.push({ ...DEFAULTS.bj_orders, id, member: 'mDj', nick: '밤톨', plan: 'munchkin', months, amount: 3000 * months,
  payer: '밤톨0000', album: null, created, pay: 'card', pay_id: 'mk-' + id, test_only: false });
const READY = (id, amount) => ({ status: 'READY', id: 'mk-' + id, storeId: STORE, channel: { type: 'LIVE' }, amount: { total: amount }, currency: 'KRW' });

test('고침 2: 결제창을 닫은 카드 신청 3개가 있어도 다른 내용의 [카드로 결제]는 된다 — 포트원이 결제 없음(404)·READY 면 취소로 정리', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const A = 'o' + 'a'.repeat(11), B = 'o' + 'b'.repeat(11), C = 'o' + 'c'.repeat(11);
  seedCard(s, A, 1, AFTER_DEC - 60000); seedCard(s, B, 3, AFTER_DEC - 50000); seedCard(s, C, 6, AFTER_DEC - 40000);
  s.net.payments['mk-' + B] = READY(B, 9000);
  // C 와 같은 내용 → C 를 다시 쓰고, 다른 내용의 A(404)·B(READY)는 정리
  assert.equal(ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 6 })).order.id, C);
  assert.equal(row(s, A).state, 'canceled');
  assert.equal(row(s, B).state, 'canceled');
  assert.equal(row(s, A).pay_channel, 'NONE');
  assert.equal(row(s, B).pay_channel, 'NONE');
  assert.equal(row(s, C).state, 'pending');
  // 다른 내용(1년)은 409 없이 새 신청 — C 도 정리
  const d = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 12 }));
  assert.equal(d.order.state, 'pending');
  assert.equal(row(s, C).state, 'canceled');
  assert.deepEqual(s.T.bj_orders.filter((x) => x.state === 'pending').map((x) => x.id), [d.order.id]);
  assert.equal(s.T.bj_entitlements.length, 0);
  // 정리된 신청에 뒤늦게 결제가 끝나면 → 고침 1 과 같이 환불 알림(이용권 없음)
  s.net.payments['mk-' + A] = late({ id: A, amount: 3000 });
  assert.equal(ok(await s.call('mDj', 'card-done', { id: A })).state, 'failed');
  assert.equal(s.net.hooks.filter((t) => t.includes('취소한 신청') && t.includes('환불')).length, 1);
  assert.equal(s.T.bj_entitlements.length, 0);
});

test('고침 2: 결제가 진행된 카드 신청(FAILED·결제 있음)·계좌이체 신청은 정리하지 않는다 · 기다리는 신청 3개 한도는 그대로', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const f = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  s.net.payments['mk-' + f.id] = { status: 'FAILED', id: 'mk-' + f.id, storeId: STORE, channel: { type: 'LIVE' }, amount: { total: f.amount }, currency: 'KRW' };
  ok(await s.call('mDj', 'order', { plan: 'munchkin', months: 3 }));
  ok(await s.call('mDj', 'order', { plan: 'munchkin', months: 6 }));
  const full = await s.call('mDj', 'card-start', { plan: 'munchkin', months: 12 });
  assert.equal(full.status, 409);
  assert.equal(row(s, f.id).state, 'pending');
  assert.equal(s.T.bj_orders.filter((x) => x.state === 'pending').length, 3);
});

test('고침 2: info 다시 확인도 1분 지난 결제 없음(404)·READY 신청을 정리하고, 정리된 것은 다시 안 묻는다', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const A = 'o' + 'd'.repeat(11), B = 'o' + 'e'.repeat(11);
  seedCard(s, A, 1, AFTER_DEC); seedCard(s, B, 3, AFTER_DEC);
  s.net.payments['mk-' + B] = READY(B, 9000);
  s.setNow(AFTER_DEC + 30000);
  ok(await s.call('mDj', 'info'));
  assert.equal(s.net.calls.length, 0, '1분 안 된 신청은 묻지 않아요');
  assert.equal(row(s, A).state, 'pending');
  s.setNow(AFTER_DEC + 2 * 60000);
  const i = ok(await s.call('mDj', 'info'));
  assert.equal(s.net.calls.length, 2);
  assert.deepEqual(i.orders.map((x) => x.state), ['canceled', 'canceled']);
  ok(await s.call('mDj', 'info'));
  assert.equal(s.net.calls.length, 2, '정리된 것은 다시 안 물어요');
});

test('고침 3: 금액이 다른 결제가 들어온 신청은 취소할 수 있고(알림은 이미 한 번), 운영자 지난 신청에 보이고, 같은 내용으로 다시 누르면 새 신청', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  s.net.payments['mk-' + o.id] = payment(o, { amount: { total: 100, paid: 100, cancelled: 0 } });
  assert.equal(ok(await s.call('mDj', 'card-done', { id: o.id })).state, 'failed');
  assert.equal(typeof row(s, o.id).pay_at, 'number');
  const before = ok(await s.call('mOp', 'ops-orders'));
  const seen = before.recent.find((x) => x.id === o.id);
  assert.ok(seen, '운영자 지난 신청에 보여요');
  assert.equal(seen.state, 'pending');
  assert.equal(typeof seen.payAt, 'number');
  assert.ok(!before.waiting.some((x) => x.id === o.id));
  const again = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 }));
  assert.notEqual(again.order.id, o.id, '돈이 들어온 신청은 다시 쓰지 않아요');
  const c = ok(await s.call('mDj', 'cancel', { id: o.id }));
  assert.equal(c.order.state, 'canceled');
  assert.equal(s.net.hooks.filter((t) => t.includes('신청과 달라요')).length, 1);
  assert.equal(s.T.bj_entitlements.length, 0);
  const after = ok(await s.call('mOp', 'ops-orders'));
  assert.equal(after.recent.filter((x) => x.id === o.id).length, 1);
  assert.equal(after.recent.find((x) => x.id === o.id).state, 'canceled');
});

test('고침 4: card-done 횟수 제한 — album-name 과 같은 1시간 300번(bjcd:)', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const o = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  for (let i = 0; i < 300; i++) assert.equal((await s.call('mDj', 'card-done', { id: o.id })).status, 200, '번째 ' + i);
  const r = await s.call('mDj', 'card-done', { id: o.id });
  assert.equal(r.status, 429);
  assert.equal(s.db.hits.get('bjcd:mDj'), 301);
  assert.equal(s.net.calls.length, 300, '막힌 요청은 포트원에 묻지 않아요');
});

test('고침 10: 봇 munchkin-pass 의 waiting 은 계좌이체 신청만 · ops-reject 는 계좌이체 신청만', async () => {
  const s = setup({ card: LIVE, now: AFTER_DEC });
  const card = ok(await s.call('mDj', 'card-start', { plan: 'munchkin', months: 1 })).order;
  let pass = ok(await s.call('mDj', 'munchkin-pass'));
  assert.equal(pass.waiting, 0);
  const bank = ok(await s.call('mDj', 'order', { plan: 'munchkin', months: 3 })).order;
  pass = ok(await s.call('mDj', 'munchkin-pass'));
  assert.equal(pass.waiting, 1);
  assert.equal((await s.call('mOp', 'ops-reject', { id: card.id, note: '시험' })).status, 404);
  assert.equal(row(s, card.id).state, 'pending');
  assert.equal(ok(await s.call('mOp', 'ops-reject', { id: bank.id, note: '시험' })).order.state, 'rejected');
});
