// 함수 bakje-beta(추억앨범 베타테스터 10명 추가 모집) 시험: node --test tests/bakje-beta.test.mjs
// index.ts 의 "시험이 따로 읽는 곳"만 잘라(타입은 node 의 stripTypeScriptTypes 로 지움) 가짜 DB·가짜 저장소로 돌린다(bakje-billing-card.test.mjs 꼴).
// 기준: 기획/베타테스터-20261125/작업/박제관/.superpowers/sdd/만들기-계획/task-1-brief.md · common.md(서버 약속).
// 이름은 모두 지어낸 것이에요(DJ 먼치 · 청취자 별사탕·구름빵·달토끼).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'supabase', 'functions', 'bakje-beta', 'index.ts');
const raw = fs.existsSync(SRC) ? fs.readFileSync(SRC, 'utf8') : '';
const START = '// ==== 시험이 따로 읽는 곳 시작 ====', END = '// ==== 시험이 따로 읽는 곳 끝 ====';
const part = raw.indexOf(START) >= 0 ? raw.slice(raw.indexOf(START), raw.indexOf(END)) : '';
assert.ok(part.length > 1000, '시험할 곳을 찾지 못했어요(supabase/functions/bakje-beta/index.ts)');
const code = stripTypeScriptTypes(part) + '\nreturn { makeHandler };';
const freshHandler = (deps) => new Function(code)().makeHandler(deps);

// ---- 시험 값(지어낸 것) ----
const DAY = 86400000;
const NOW = Date.parse('2026-11-26T12:00:00+09:00');
const BETA_UNTIL = Date.parse('2026-12-31T23:59:59+09:00');
const PAID_FROM = Date.parse('2027-01-01T00:00:00+09:00');
const CLOSED = { open: false, seats: 10, until: BETA_UNTIL, closedAt: null };   // 마이그레이션이 넣는 처음 값
const OPEN = { ...CLOSED, open: true };
const NOT_YET = '아직 모집을 시작하지 않았어요.', ENDED = '베타테스터 모집이 끝났어요.';
const OPS_ONLY = '운영자만 쓸 수 있어요.';
const TAKEN_OTHER = '다른 분이 먼저 신청한 주소예요. 다른 이름을 골라 주세요.';
const hostOf = (label) => new URL('https://' + label + '.먼치킨.com').hostname;

// ---- 가짜 Supabase(이 함수가 쓰는 만큼) ----
const KEYS = { bj_beta_apps: ['id'], bj_entitlements: ['member', 'product'], bj_settings: ['key'], bj_albums: ['id'], bj_hosts: ['host'], bj_album_owners: ['album', 'member'],
  bj_bots: ['id'], bj_members: ['id'], bj_sessions: ['token'], bj_member_devices: ['device'], junlive_devices: ['id'], bj_orders: ['id'], jl_watch_alerts: ['id'] };
const UNIQUE = { bj_beta_apps: [['member']] };
// 마이그레이션 20261125_bakje_beta 의 기본값·제약
const DEFAULTS = { bj_beta_apps: { nick: null, msg: null, photos: [], state: 'wait', decided: null, album: null }, bj_albums: { state: 'active', note: '', paid_until: null } };
const CHECKS = {
  bj_beta_apps: (r) => ['wait', 'picked', 'passed', 'canceled'].includes(r.state) && typeof r.spoon_nick === 'string' && typeof r.want_label === 'string' && typeof r.want_host === 'string' && typeof r.want_name === 'string' && Array.isArray(r.photos) && Number.isFinite(r.created),
  jl_watch_alerts: (r) => ['warn', 'ok', 'info'].includes(r.level) && typeof r.title === 'string' && typeof r.key === 'string'
};
const clone = (v) => structuredClone(v);

function fakeDb(seed) {
  const T = {};
  for (const [k, rows] of Object.entries(seed)) T[k] = rows.map((r) => ({ ...(DEFAULTS[k] || {}), ...clone(r) }));
  const tbl = (name) => (T[name] ||= []);
  const hits = new Map(), broken = new Set();
  const same = (a, b, cols) => cols.every((c) => a[c] === b[c]);
  const clash = (name, row, skip) => [KEYS[name] || ['id'], ...(UNIQUE[name] || [])].some((cols) => !cols.some((c) => row[c] == null) && tbl(name).some((r) => r !== skip && same(r, row, cols)));
  const bad = (name, row) => CHECKS[name] && !CHECKS[name](row);
  function from(name) {
    const st = { op: 'select', filters: [], order: null, limit: null, ret: false, single: false, vals: null, opts: {} };
    const keep = (r) => st.filters.every((f) => f(r));
    function run() {
      const rows = tbl(name);
      if (st.op !== 'select' && broken.has(name)) return { data: null, error: { code: 'XX000', message: '시험: 표 고장' } };
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
  // 가짜 Storage: 칸마다 파일(path → {size, mimetype, text}) · 서명 올리기 주소는 진짜 모양(…/storage/v1/object/upload/sign/<칸>/<경로>?token=…)
  const files = new Map(), signs = [], removed = [];
  let tokens = 0, api = null;
  const STORE = 'https://example.supabase.co/storage/v1';
  const storage = {
    from(bucket) {
      return {
        upload: async (p, blob, opts = {}) => { const text = await blob.text(); files.set(`${bucket}/${p}`, { text, size: text.length, mimetype: opts.contentType }); return { data: { path: p }, error: null }; },
        remove: async (paths) => {
          if (broken.has('storage')) return { data: null, error: { message: '시험: 저장소 고장' } };
          for (const p of paths) { files.delete(`${bucket}/${p}`); removed.push(`${bucket}/${p}`); }
          return { data: paths.map((name) => ({ name })), error: null };
        },
        createSignedUploadUrl: async (p) => {
          const token = 'tok-' + ++tokens;
          signs.push(`${bucket}/${p}`);
          return { data: { signedUrl: `${STORE}/object/upload/sign/${bucket}/${p}?token=${token}`, path: p, token }, error: null };
        },
        list: async (prefix = '', opts = {}) => {
          if (api.beforeList) { const f = api.beforeList; api.beforeList = null; f(prefix); }   // 시험: 목록을 읽기 직전에 다른 요청이 끼어든 것처럼(한 번)
          if (broken.has('storage-list')) return { data: null, error: { message: '시험: 목록 고장' } };
          const pre = `${bucket}/` + (prefix ? prefix.replace(/\/+$/, '') + '/' : '');
          const seen = new Map();
          for (const [k, f] of files) {
            if (!k.startsWith(pre)) continue;
            const rest = k.slice(pre.length);
            if (rest.includes('/')) { const name = rest.split('/')[0]; if (!seen.has(name)) seen.set(name, { name, id: null, metadata: null }); }
            else seen.set(rest, { name: rest, id: 'id-' + rest, metadata: { size: f.size, mimetype: f.mimetype } });
          }
          const all = [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
          const off = opts.offset || 0, lim = opts.limit || 100;
          return { data: all.slice(off, off + lim), error: null };
        },
        createSignedUrl: async (p, sec) => ({ data: files.has(`${bucket}/${p}`) ? { signedUrl: `${STORE}/object/sign/${bucket}/${p}?token=view-${sec}` } : null, error: files.has(`${bucket}/${p}`) ? null : { message: 'Object not found' } }),
        createSignedUrls: async (paths, sec) => ({ data: paths.map((p) => (files.has(`${bucket}/${p}`) ? { path: p, error: null, signedUrl: `${STORE}/object/sign/${bucket}/${p}?token=view-${sec}` } : { path: p, error: 'Either the requested object does not exist', signedUrl: null })), error: null })
      };
    }
  };
  api = {
    T, hits, broken, files, signs, removed, from, storage, beforeClaim: null, beforeList: null,
    rpc: async (name, a) => {
      if (name === 'fp_hit') {
        const n = (hits.get(a.p_key) || 0) + 1;
        hits.set(a.p_key, n);
        return { data: n <= a.p_max, error: null };
      }
      if (name === 'bj_beta_claim') {
        if (api.beforeClaim) api.beforeClaim(a);   // 시험: 자리를 잡기 직전에 다른 요청이 끼어든 것처럼
        // 마이그레이션의 잠금 함수와 같은 판단: wait·passed 인지 → 뽑힌 수 < seats 인지 → picked
        const r = tbl('bj_beta_apps').find((x) => x.id === a.p_id);
        if (!r || !['wait', 'passed'].includes(r.state)) return { data: 'state', error: null };
        if (tbl('bj_beta_apps').filter((x) => x.state === 'picked').length >= a.p_seats) return { data: 'full', error: null };
        r.state = 'picked'; r.decided = a.p_now;
        return { data: 'ok', error: null };
      }
      throw new Error('시험에서 모르는 rpc 예요: ' + name);
    }
  };
  return api;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const MEMBERS = [
  { id: 'mmunchi22222', login_id: 'munchi', nickname: '먼치', verified: null, state: 'active', is_admin: false, role: 'listener' },
  { id: 'mstar2222222', login_id: 'byeolsatang', nickname: '별사탕', verified: null, state: 'active', is_admin: false, role: 'listener' },
  { id: 'mcloud222222', login_id: 'gureumppang', nickname: '구름빵', verified: null, state: 'active', is_admin: false, role: 'listener' },
  { id: 'mrabbit22222', login_id: 'daltokki', nickname: '달토끼', verified: null, state: 'active', is_admin: false, role: 'listener' },
  { id: 'mops22222222', login_id: 'opsmunchi', nickname: '운영', verified: null, state: 'active', is_admin: true, role: 'dj' }
];
const DJ = 'mmunchi22222', STAR = 'mstar2222222', CLOUD = 'mcloud222222', RABBIT = 'mrabbit22222', OPS = 'mops22222222';
const URL_FN = 'https://example.supabase.co/functions/v1/bakje-beta';
// 뽑기 시험용 지어낸 청취자(팬1 …)
const fanId = (i) => 'mfan' + 'abcdefghjkmnpq'[i] + '222222';

function setup({ now = NOW, beta = CLOSED, fans = 0, albums = [], owners = [], ents = [], hosts = [], orders = [], apps = [], more = [] } = {}) {
  let clock = now;
  const members = [...MEMBERS, ...more, ...Array.from({ length: fans }, (_, i) => ({ id: fanId(i), login_id: 'fan' + i, nickname: '팬' + (i + 1), verified: null, state: 'active', is_admin: false, role: 'listener' }))];
  const tokens = {}, sessions = [];
  for (const m of members) { const t = crypto.randomBytes(32).toString('base64url'); tokens[m.id] = t; sessions.push({ token: sha(t), member: m.id, expires: now + 365 * DAY }); }
  const db = fakeDb({
    bj_members: members, bj_sessions: sessions, bj_beta_apps: apps, bj_entitlements: ents, bj_orders: orders, jl_watch_alerts: [],
    bj_settings: beta ? [{ key: 'beta', value: beta, updated: 0 }] : [],
    bj_albums: albums, bj_hosts: hosts, bj_album_owners: owners, bj_member_devices: [], junlive_devices: [], bj_bots: []
  });
  const handler = freshHandler({ db, clock: () => clock });
  const call = async (who, action, body = {}, headers = {}) => {
    const h = { 'Content-Type': 'application/json', ...(who ? { 'x-bj-session': tokens[who] || who } : {}), ...headers };
    const res = await handler(new Request(URL_FN, { method: 'POST', headers: h, body: JSON.stringify({ action, ...body }) }));
    return { status: res.status, body: await res.json() };
  };
  // 브라우저가 서명 올리기 주소로 PUT 한 것처럼 파일을 둔다
  const put = (url, meta = {}) => {
    const m = String(url).match(/^https:\/\/example\.supabase\.co\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)\?token=tok-\d+$/);
    assert.ok(m, '서명 올리기 주소 모양이 달라요: ' + url);
    db.files.set(`${m[1]}/${m[2]}`, { text: 'img', size: 300000, mimetype: 'image/webp', ...meta });
  };
  return { db, T: db.T, call, handler, put, setNow: (t) => { clock = t; } };
}
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.ok, true); return r.body; };
const no = (r, status, text) => { assert.equal(r.status, status, JSON.stringify(r.body)); assert.equal(r.body.ok, false); if (text) assert.ok(r.body.error.includes(text), r.body.error); return r.body; };
// 사진 n 장을 올린다(photo-url → PUT) → 경로들
async function shoot(s, who, n, meta = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = ok(await s.call(who, 'photo-url', { type: 'image/webp' }));
    s.put(r.url, meta);
    out.push(r.path);
  }
  return out;
}
const form = (photos, over = {}) => ({ spoonNick: '먼치', label: '먼치', name: '', msg: '매일 밤 라디오 해요', photos, ...over });
const appOf = (s, member) => s.T.bj_beta_apps.find((a) => a.member === member);
const betaCfg = (s) => s.T.bj_settings.find((r) => r.key === 'beta')?.value;
// 바로 넣어 두는 신청 줄(뽑기 시험용)
const seedApp = (i, member, label, over = {}) => ({ id: 'bseedapp' + 'abcdefghjkmnpq'[i] + 'aaa', member, nick: '', spoon_nick: label, want_label: label, want_host: hostOf(label), want_name: label + ' 추억앨범', msg: null, photos: [], state: 'wait', created: NOW - (20 - i) * 60000, ...over });

// ================= 시험 =================

test('함수 글에 백슬래시-u 글자 표기가 없다(MCP 로 올릴 때 풀려 버림)', () => {
  assert.ok(!/\\u[0-9a-fA-F]{4}/.test(raw));
  assert.ok(!/\\u\{/.test(raw));
  assert.ok(raw.includes('bakje-billing 과 같은 일'), '파일 머리 주석에 "bakje-billing 과 같은 일 — 정기결제(auto-renew) 합친 뒤 하나로"');
});

test('마이그레이션·schema.sql: 표·RLS·잠금 함수·비공개 사진 칸·처음 설정', () => {
  const mig = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261125_bakje_beta.sql'), 'utf8');
  const schema = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
  for (const sql of [mig, schema]) {
    assert.match(sql, /create table if not exists bj_beta_apps/);
    assert.match(sql, /member text not null unique/);
    assert.match(sql, /photos text\[\] not null default '\{\}'/);
    assert.match(sql, /check \(state in \('wait', 'picked', 'passed', 'canceled'\)\)/);
    assert.match(sql, /alter table bj_beta_apps enable row level security/);
    assert.match(sql, /revoke all on bj_beta_apps from anon, authenticated/);
    assert.match(sql, /grant all on bj_beta_apps to service_role/);
    assert.match(sql, /function bj_beta_claim\(p_id text, p_seats int, p_now bigint\)\s+returns text/);
    assert.match(sql, /pg_advisory_xact_lock\(hashtext\('bj_beta'\)\)/);
    assert.match(sql, /revoke all on function bj_beta_claim\(text, int, bigint\) from public, anon, authenticated/);
    assert.match(sql, /\('bakje-beta', 'bakje-beta', false, 5242880, array\['image\/webp', 'image\/jpeg', 'image\/png'\]\)/);
    assert.ok(sql.includes(`('beta', '{"open":false,"seats":10,"until":${BETA_UNTIL},"closedAt":null}'::jsonb, 0) on conflict (key) do nothing`), '처음 설정 beta');
  }
  assert.match(mig, /notify pgrst, 'reload schema';/);
  assert.match(mig, /되돌리기/);
});

test('health: v 1', async () => {
  const s = setup();
  const res = await s.handler(new Request(URL_FN + '/health'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, v: 1 });
  const pre = await s.handler(new Request(URL_FN, { method: 'OPTIONS' }));
  assert.equal(pre.status, 204);
  assert.ok(pre.headers.get('access-control-allow-headers').includes('x-bj-session'));
});

test('status 로그인 없이: 닫힘 기본', async () => {
  for (const beta of [CLOSED, null]) {
    const s = setup({ beta });
    const r = ok(await s.call(null, 'status'));
    assert.deepEqual(r, { ok: true, open: false, seats: 10, picked: 0, left: 10, until: BETA_UNTIL, closedAt: null, mine: null });
  }
  const o = ok(await setup({ beta: OPEN }).call(null, 'status'));
  assert.equal(o.open, true);
  assert.equal(o.left, 10);
  assert.equal(o.closedAt, null);
  // 끝난 모집은 closedAt(화면이 "모집이 끝났어요"와 "아직 시작하지 않았어요"를 가름)
  const e = ok(await setup({ beta: { ...CLOSED, closedAt: NOW - DAY } }).call(null, 'status'));
  assert.equal(e.open, false);
  assert.equal(e.closedAt, NOW - DAY);
});

test('status 틀린 세션은 401 이 아니라 mine null', async () => {
  const s = setup({ beta: OPEN });
  for (const bad of ['wrong-token', 'A'.repeat(43)]) {
    const r = ok(await s.call(bad, 'status'));
    assert.equal(r.mine, null);
    assert.equal(r.open, true);
  }
  const me = ok(await s.call(DJ, 'status')).mine;
  assert.deepEqual(me, { state: 'none', hasAlbum: false, canApply: true });
  // 세션이 필요한 요청은 401
  no(await s.call('wrong-token', 'apply', form([])), 401);
  no(await s.call(null, 'photo-url', { type: 'image/webp' }), 401);
});

test('photo-url: 경로 <회원>/<12자>.<확장자> · 서명 올리기 주소(PUT) · 모집이 열려 있을 때만 · 그림 형식만', async () => {
  const s = setup({ beta: OPEN });
  const w = ok(await s.call(DJ, 'photo-url', { type: 'image/webp' }));
  assert.match(w.path, new RegExp(`^${DJ}/[a-z0-9]{12}\\.webp$`));
  assert.equal(w.url, `https://example.supabase.co/storage/v1/object/upload/sign/bakje-beta/${w.path}?token=tok-1`);
  assert.match(ok(await s.call(DJ, 'photo-url', { type: 'image/jpeg' })).path, /\.jpg$/);
  assert.match(ok(await s.call(DJ, 'photo-url', { type: 'image/png' })).path, /\.png$/);
  assert.match(ok(await s.call(DJ, 'photo-url', { type: 'jpg' })).path, /\.jpg$/);
  for (const type of ['image/gif', 'text/html', '__proto__', 'constructor', '', null, 3]) no(await s.call(DJ, 'photo-url', { type }), 400);
  assert.ok(s.db.signs.every((p) => p.startsWith('bakje-beta/' + DJ + '/')));
  // 한 시간 60번
  s.db.hits.set('bjbp:' + DJ, 60);
  no(await s.call(DJ, 'photo-url', { type: 'image/webp' }), 429);
  // 모집 닫힘 → 주소를 주지 않음
  const c = setup({ beta: CLOSED });
  no(await c.call(DJ, 'photo-url', { type: 'image/webp' }), 400, NOT_YET);
  assert.equal(c.db.signs.length, 0);
});

test('apply 사진 2장이면 거절', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 2);
  no(await s.call(DJ, 'apply', form(p)), 400, '3장');
  // 같은 경로를 여러 번 보내도 한 장으로 셈
  no(await s.call(DJ, 'apply', form([p[0], p[0], p[1]])), 400, '3장');
  no(await s.call(DJ, 'apply', form('사진')), 400, '3장');
  assert.equal(s.T.bj_beta_apps.length, 0);
});

test('apply 사진 11장이면 거절', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 10);
  no(await s.call(DJ, 'apply', form([...p, `${DJ}/abcdefghjkmn.webp`])), 400, '10장');
  assert.equal(s.T.bj_beta_apps.length, 0);
  ok(await s.call(DJ, 'apply', form(p)));
});

test('photo-url: 지금 신청에 없는 사진이 폴더에 이미 10장이면 거절(먼저 보내거나 정리)', async () => {
  const MORE = '사진을 먼저 보내거나 뺀 사진을 정리해 주세요.';
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 10);
  no(await s.call(DJ, 'photo-url', { type: 'image/webp' }), 400, MORE);
  // 보내면(신청에 들어가면) 다시 올릴 수 있음
  ok(await s.call(DJ, 'apply', form(p.slice(0, 3))));   // 나머지 7장은 신청에서 빠져 지워짐
  const more = await shoot(s, DJ, 10);
  no(await s.call(DJ, 'photo-url', { type: 'image/webp' }), 400, MORE);
  ok(await s.call(DJ, 'apply', form([...p.slice(0, 3), ...more.slice(0, 7)])));
  assert.equal(appOf(s, DJ).photos.length, 10);
  ok(await s.call(DJ, 'photo-url', { type: 'image/webp' }));
});

test('회원 번호 모양(m + 영어 소문자·숫자 11자)이 아니면 사진 칸을 쓰지 않음', async () => {
  const odd = { id: 'mODD22222222', login_id: 'oddone', nickname: '구름빵2', verified: null, state: 'active', is_admin: false, role: 'listener' };
  const s = setup({ beta: OPEN, more: [odd] });
  no(await s.call(odd.id, 'photo-url', { type: 'image/webp' }), 503);
  assert.equal(s.db.signs.length, 0);
});

test('apply 남의 폴더 사진 경로 거절', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  const theirs = await shoot(s, STAR, 1);
  no(await s.call(DJ, 'apply', form([p[0], p[1], 'other/abcdefghjkmn.webp'])), 400);
  no(await s.call(DJ, 'apply', form([p[0], p[1], theirs[0]])), 400);
  for (const bad of [`${DJ}/../${STAR}/abcdefghjkmn.webp`, `${DJ}/abcdefghjkmn.gif`, `${DJ}/ABCDEFGHJKMN.webp`, `${DJ}/a/abcdefghjkmn.webp`, 7]) no(await s.call(DJ, 'apply', form([p[0], p[1], bad])), 400);
  assert.equal(s.T.bj_beta_apps.length, 0);
});

test('apply Storage 에 없는 사진 거절 · 5MB 넘거나 그림이 아니면 거절', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 2);
  no(await s.call(DJ, 'apply', form([...p, `${DJ}/abcdefghjkmn.webp`])), 400);
  const big = await shoot(s, DJ, 1, { size: 5242881 });
  no(await s.call(DJ, 'apply', form([...p, ...big])), 400);
  const html = await shoot(s, DJ, 1, { mimetype: 'text/html' });
  no(await s.call(DJ, 'apply', form([...p, ...html])), 400);
  const edge = await shoot(s, DJ, 1, { size: 5242880, mimetype: 'image/png' });
  ok(await s.call(DJ, 'apply', form([...p, ...edge])));
});

test('apply 모집 닫힘이면 거절(시작 전 / 끝)', async () => {
  const a = setup({ beta: CLOSED });
  no(await a.call(DJ, 'apply', form([])), 400, NOT_YET);
  const b = setup({ beta: { ...CLOSED, closedAt: NOW - DAY } });
  no(await b.call(DJ, 'apply', form([])), 400, ENDED);
  assert.equal(a.T.bj_beta_apps.length + b.T.bj_beta_apps.length, 0);
});

test('apply 앨범이 있으면 거절', async () => {
  const s = setup({ beta: OPEN, albums: [{ id: 'amunchi', name: '먼치 추억앨범', state: 'active', paid_until: null }], owners: [{ album: 'amunchi', member: DJ, created: 1 }] });
  no(await s.call(DJ, 'apply', form([])), 400, '이미 추억앨범이 있어요.');
  no(await s.call(DJ, 'photo-url', { type: 'image/webp' }), 400, '이미 추억앨범이 있어요.');
  const me = ok(await s.call(DJ, 'status')).mine;
  assert.deepEqual(me, { state: 'none', hasAlbum: true, canApply: false });
});

test('apply 주소 규칙·겹침', async () => {
  const s = setup({ beta: OPEN, hosts: [{ host: hostOf('달빛'), album: 'aother', created: 1 }],
    orders: [{ id: 'oorder000001', member: RABBIT, state: 'pending', want_host: hostOf('별빛'), want_label: '별빛' }] });
  const p = await shoot(s, DJ, 3);
  no(await s.call(DJ, 'apply', form(p, { label: '' })), 400, '주소 이름을 적어 주세요.');
  no(await s.call(DJ, 'apply', form(p, { label: 'a_b' })), 400, '주소 이름은 한글·영어 소문자·숫자로 1~15자예요. - 는 가운데에만 쓸 수 있어요.');
  no(await s.call(DJ, 'apply', form(p, { label: '운영자' })), 400, '쓸 수 없는 주소 이름이에요. 다른 이름을 골라 주세요.');
  no(await s.call(DJ, 'apply', form(p, { label: 'xn--abc' })), 400, '이 이름으로는 주소를 만들 수 없어요. 다른 이름을 골라 주세요.');
  no(await s.call(DJ, 'apply', form(p, { label: '달빛' })), 409, '이미 쓰이고 있는 주소예요. 다른 이름을 골라 주세요.');
  no(await s.call(DJ, 'apply', form(p, { label: '별빛' })), 409, TAKEN_OTHER);
  // 다른 회원의 wait 베타 신청 주소
  const q = await shoot(s, STAR, 3);
  ok(await s.call(STAR, 'apply', form(q, { spoonNick: '별사탕', label: '사탕' })));
  no(await s.call(DJ, 'apply', form(p, { label: '사탕' })), 409, TAKEN_OTHER);
  // 이름 칸: 스푼 닉네임 1~20자 · 앨범 이름 2~40자 · 하고 싶은 말 100자
  no(await s.call(DJ, 'apply', form(p, { spoonNick: '  ' })), 400, '스푼 닉네임');
  no(await s.call(DJ, 'apply', form(p, { spoonNick: '가'.repeat(21) })), 400, '스푼 닉네임');
  no(await s.call(DJ, 'apply', form(p, { name: '가' })), 400, '앨범 이름');
  no(await s.call(DJ, 'apply', form(p, { name: '가'.repeat(41) })), 400, '앨범 이름');
  no(await s.call(DJ, 'apply', form(p, { msg: '가'.repeat(101) })), 400, '100자');
  assert.equal(s.T.bj_beta_apps.length, 1);
  ok(await s.call(DJ, 'apply', form(p, { spoonNick: '가'.repeat(20), name: '가'.repeat(40), msg: '가'.repeat(100) })));
});

test('apply 성공 → 표 한 줄 wait + jl_watch_alerts 한 줄', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  const r = ok(await s.call(DJ, 'apply', form(p)));
  assert.deepEqual(r.mine, { state: 'wait', hasAlbum: false, canApply: true,
    app: { spoonNick: '먼치', label: '먼치', name: '먼치 추억앨범', msg: '매일 밤 라디오 해요', photos: 3, created: NOW } });
  assert.equal(s.T.bj_beta_apps.length, 1);
  const a = appOf(s, DJ);
  assert.match(a.id, /^b[a-z0-9]{11}$/);
  assert.equal(a.state, 'wait');
  assert.equal(a.nick, '먼치');
  assert.equal(a.spoon_nick, '먼치');
  assert.equal(a.want_label, '먼치');
  assert.equal(a.want_host, hostOf('먼치'));
  assert.equal(a.want_name, '먼치 추억앨범');
  assert.deepEqual(a.photos, p);
  assert.equal(a.created, NOW);
  assert.equal(s.T.jl_watch_alerts.length, 1);
  const al = s.T.jl_watch_alerts[0];
  assert.equal(al.key, 'beta-apply');
  assert.equal(al.level, 'info');
  assert.equal(al.title, '🧪 추억앨범 베타 신청 — 먼치');
  assert.equal(al.body, ['스푼 닉네임: 먼치', '원하는 주소: 먼치.먼치킨.com', '하고 싶은 말: 매일 밤 라디오 해요', '첨부: 박제 사진 3장 (운영자 앱에서 보기)', '지금 신청 1명 · 뽑힘 0명 / 10명', '운영자 앱: https://한이준.com/ops/ → 베타'].join('\n'));
  assert.ok(!al.body.includes('bakje-beta/'), '사진 주소는 알림에 넣지 않아요');
  // 하고 싶은 말이 없으면 그 줄이 없음 · 제목은 스푼 닉네임(번호 없음 — 수는 "지금 신청" 줄)
  const q = await shoot(s, STAR, 4);
  ok(await s.call(STAR, 'apply', form(q, { spoonNick: '별사탕', label: '사탕', name: '사탕 앨범', msg: '' })));
  const b2 = s.T.jl_watch_alerts[1];
  assert.equal(b2.title, '🧪 추억앨범 베타 신청 — 별사탕');
  assert.equal(b2.body, ['스푼 닉네임: 별사탕', '원하는 주소: 사탕.먼치킨.com', '첨부: 박제 사진 4장 (운영자 앱에서 보기)', '지금 신청 2명 · 뽑힘 0명 / 10명', '운영자 앱: https://한이준.com/ops/ → 베타'].join('\n'));
  assert.equal(appOf(s, STAR).msg, null);
  // 한 시간 10번
  s.db.hits.set('bjba:' + CLOUD, 10);
  const c = await shoot(s, CLOUD, 3);
  no(await s.call(CLOUD, 'apply', form(c, { spoonNick: '구름빵', label: '구름' })), 429);
});

test('apply 다시 보내면 고치기(줄 하나 그대로, 알림 다시 안 감), 빠진 사진은 Storage 에서 지움', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 4);
  ok(await s.call(DJ, 'apply', form(p)));
  const first = { ...appOf(s, DJ) };
  const extra = await shoot(s, DJ, 1);
  const orphan = await shoot(s, DJ, 1);   // 올리고 신청에 안 넣은 사진
  s.setNow(NOW + 3600000);
  const r = ok(await s.call(DJ, 'apply', form([p[0], p[2], ...extra], { label: '먼치랑', name: '먼치의 밤', msg: '고쳤어요' })));
  assert.equal(r.mine.state, 'wait');
  assert.equal(r.mine.app.photos, 3);
  assert.equal(r.mine.app.label, '먼치랑');
  assert.equal(s.T.bj_beta_apps.length, 1);
  const a = appOf(s, DJ);
  assert.equal(a.id, first.id);
  assert.equal(a.created, NOW, '신청 때는 그대로');
  assert.equal(a.want_host, hostOf('먼치랑'));
  assert.equal(a.want_name, '먼치의 밤');
  assert.deepEqual(a.photos, [p[0], p[2], ...extra]);
  assert.equal(s.T.jl_watch_alerts.length, 1, '고치기는 알림을 다시 보내지 않아요');
  for (const gone of [p[1], p[3], orphan[0]]) assert.ok(!s.db.files.has('bakje-beta/' + gone), '빠진 사진 지움 ' + gone);
  for (const kept of [p[0], p[2], extra[0]]) assert.ok(s.db.files.has('bakje-beta/' + kept));
  // 넘긴(passed) 신청도 고칠 수 있음 · 뽑힌 신청은 못 고침
  s.T.bj_beta_apps[0].state = 'passed';
  ok(await s.call(DJ, 'apply', form([p[0], p[2], ...extra], { label: '먼치랑' })));
  assert.equal(appOf(s, DJ).state, 'passed');
  s.T.bj_beta_apps[0].state = 'picked';
  no(await s.call(DJ, 'apply', form([p[0], p[2], ...extra])), 400, '이미 뽑혔어요.');
});

test('apply 알림 넣기 실패해도 신청은 됨', async () => {
  const s = setup({ beta: OPEN });
  s.db.broken.add('jl_watch_alerts');
  const p = await shoot(s, DJ, 3);
  const r = ok(await s.call(DJ, 'apply', form(p)));
  assert.equal(r.mine.state, 'wait');
  assert.equal(s.T.bj_beta_apps.length, 1);
  assert.equal(s.T.jl_watch_alerts.length, 0);
});

test('cancel → canceled, 사진 지움, mine.state none', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  const r = ok(await s.call(DJ, 'cancel'));
  assert.deepEqual(r.mine, { state: 'none', hasAlbum: false, canApply: true });
  const a = appOf(s, DJ);
  assert.equal(a.state, 'canceled');
  assert.equal(a.decided, NOW);
  assert.deepEqual(a.photos, []);
  for (const x of p) assert.ok(!s.db.files.has('bakje-beta/' + x));
  // 신청이 없어도 cancel 은 그대로 답함 · 다시 신청하면 같은 줄이 새 신청(알림 다시)
  ok(await s.call(DJ, 'cancel'));
  const q = await shoot(s, DJ, 3);
  s.setNow(NOW + 60000);
  const again = ok(await s.call(DJ, 'apply', form(q)));
  assert.equal(again.mine.state, 'wait');
  assert.equal(s.T.bj_beta_apps.length, 1);
  assert.equal(appOf(s, DJ).state, 'wait');
  assert.equal(appOf(s, DJ).created, NOW + 60000);
  assert.equal(appOf(s, DJ).decided, null);
  assert.equal(s.T.jl_watch_alerts.length, 2);
  // 뽑힌 신청은 취소 못 함 · 사진도 그대로
  s.T.bj_beta_apps[0].state = 'picked';
  no(await s.call(DJ, 'cancel'), 400, '이미 뽑혔어요.');
  assert.equal(appOf(s, DJ).state, 'picked');
  for (const x of q) assert.ok(s.db.files.has('bakje-beta/' + x), '뽑힌 신청 사진은 지우지 않아요 ' + x);
});

test('cancel 은 상태를 먼저 바꾸고, 실제로 바뀐 때만 사진을 지움(그사이 뽑혔으면 사진을 지우지 않음)', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  // 사진 목록을 읽는 순간 운영자가 뽑음(뽑기는 wait·passed 일 때만 된다)
  s.db.beforeList = () => { const a = appOf(s, DJ); if (['wait', 'passed'].includes(a.state)) a.state = 'picked'; };
  const r = await s.call(DJ, 'cancel');
  const a = appOf(s, DJ);
  if (a.state === 'picked') {
    for (const x of p) assert.ok(s.db.files.has('bakje-beta/' + x), '뽑힌 신청의 사진을 지우면 안 돼요 ' + x);
  }
  // 상태를 먼저 바꾸므로 취소가 이기고(그 뒤엔 뽑을 수 없음) 사진이 지워짐
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(a.state, 'canceled');
  for (const x of p) assert.ok(!s.db.files.has('bakje-beta/' + x));
  // 이미 취소한 신청에 다시 cancel: 바뀐 것이 없으니 사진을 지우지 않음
  const later = await shoot(s, DJ, 1);
  ok(await s.call(DJ, 'cancel'));
  assert.ok(s.db.files.has('bakje-beta/' + later[0]));
});

test('ops-* 운영자 아니면 403', async () => {
  const s = setup({ beta: OPEN });
  for (const action of ['ops-list', 'ops-pick', 'ops-pass', 'ops-wait', 'ops-open', 'ops-purge']) {
    no(await s.call(DJ, action, { id: 'bxxxxxxxxxxx', open: false }), 403, OPS_ONLY);
    no(await s.call(null, action), 401);
  }
  assert.equal(betaCfg(s).open, true);
  no(await s.call(DJ, 'gold'), 400);
});

test('ops-list: 새것부터 · 사진은 서명 보기 주소(1시간) · 모집 숫자', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  s.setNow(NOW + 1000);
  const q = await shoot(s, STAR, 3);
  ok(await s.call(STAR, 'apply', form(q, { spoonNick: '별사탕', label: '사탕', msg: '' })));
  const r = ok(await s.call(OPS, 'ops-list'));
  assert.equal(r.open, true);
  assert.equal(r.seats, 10);
  assert.equal(r.picked, 0);
  assert.equal(r.left, 10);
  assert.equal(r.until, BETA_UNTIL);
  assert.equal(r.closedAt, null);
  assert.deepEqual(r.apps.map((a) => a.spoonNick), ['별사탕', '먼치']);
  const m = r.apps[1];
  assert.deepEqual(Object.keys(m).sort(), ['album', 'created', 'decided', 'host', 'id', 'label', 'msg', 'name', 'nick', 'photos', 'spoonNick', 'state'].sort());
  assert.equal(m.id, appOf(s, DJ).id);
  assert.equal(m.nick, '먼치');
  assert.equal(m.label, '먼치');
  assert.equal(m.host, hostOf('먼치'));
  assert.equal(m.name, '먼치 추억앨범');
  assert.equal(m.msg, '매일 밤 라디오 해요');
  assert.equal(m.state, 'wait');
  assert.equal(m.created, NOW);
  assert.equal(m.decided, null);
  assert.equal(m.album, null);
  assert.deepEqual(m.photos, p.map((x) => `https://example.supabase.co/storage/v1/object/sign/bakje-beta/${x}?token=view-3600`));
});

test('ops-pick → 앨범·주소·주인 생김, paid_until = BETA_UNTIL, 이용권 album = max(있던 값, BETA_UNTIL), 신청 album 칸, state picked', async () => {
  const s = setup({ beta: OPEN, ents: [{ member: STAR, product: 'album', until: PAID_FROM + 30 * DAY }, { member: DJ, product: 'album', until: NOW - DAY }] });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  const id = appOf(s, DJ).id;
  s.setNow(NOW + 5000);
  const r = ok(await s.call(OPS, 'ops-pick', { id }));
  const a = appOf(s, DJ);
  assert.equal(a.state, 'picked');
  assert.equal(a.decided, NOW + 5000);
  assert.match(a.album, /^a[a-z0-9]{9}$/);
  const album = s.T.bj_albums.find((x) => x.id === a.album);
  assert.equal(album.name, '먼치 추억앨범');
  assert.equal(album.note, '베타테스터 ' + id);
  assert.equal(album.paid_until, BETA_UNTIL);
  assert.equal(album.created, NOW + 5000);
  assert.ok(s.T.bj_hosts.some((h) => h.host === hostOf('먼치') && h.album === a.album));
  assert.deepEqual(JSON.parse(s.db.files.get(`bakje/h/${hostOf('먼치')}.json`).text), { album: a.album, name: '먼치 추억앨범' });
  assert.ok(s.T.bj_album_owners.some((o) => o.album === a.album && o.member === DJ));
  assert.equal(s.T.bj_members.find((m) => m.id === DJ).role, 'dj');
  assert.equal(s.T.bj_entitlements.find((e) => e.member === DJ && e.product === 'album').until, BETA_UNTIL);
  assert.equal(r.left, 9);
  assert.equal(r.closed, false);
  assert.equal(r.app.id, id);
  assert.equal(r.app.state, 'picked');
  assert.equal(r.app.album, a.album);
  assert.equal(r.app.photos.length, 3);
  const me = ok(await s.call(DJ, 'status'));
  assert.equal(me.picked, 1);
  assert.equal(me.left, 9);
  assert.deepEqual(me.mine, { state: 'picked', hasAlbum: true, canApply: false,
    app: { spoonNick: '먼치', label: '먼치', name: '먼치 추억앨범', msg: '매일 밤 라디오 해요', photos: 3, created: NOW }, album: { host: hostOf('먼치'), label: '먼치' } });
  // 이미 더 늦은 이용권이 있으면 그대로(max)
  const q = await shoot(s, STAR, 3);
  ok(await s.call(STAR, 'apply', form(q, { spoonNick: '별사탕', label: '사탕' })));
  ok(await s.call(OPS, 'ops-pick', { id: appOf(s, STAR).id }));
  assert.equal(s.T.bj_entitlements.find((e) => e.member === STAR && e.product === 'album').until, PAID_FROM + 30 * DAY);
  // 두 번 뽑기 · 없는 신청
  no(await s.call(OPS, 'ops-pick', { id }), 409);
  no(await s.call(OPS, 'ops-pick', { id: 'bnothere0000' }), 404);
  assert.equal(s.T.bj_albums.length, 2);
});

test('ops-pick 10명째에 모집 저절로 닫힘 → status open false · 11명째는 거절(full)', async () => {
  const fans = 11;
  const apps = Array.from({ length: fans }, (_, i) => seedApp(i, fanId(i), 'fan' + (i + 1)));
  const s = setup({ beta: OPEN, fans, apps });
  for (let i = 0; i < 9; i++) {
    const r = ok(await s.call(OPS, 'ops-pick', { id: apps[i].id }));
    assert.equal(r.left, 10 - (i + 1));
    assert.equal(r.closed, false);
  }
  assert.equal(ok(await s.call(null, 'status')).open, true);
  s.setNow(NOW + 777);
  const tenth = ok(await s.call(OPS, 'ops-pick', { id: apps[9].id }));
  assert.equal(tenth.left, 0);
  assert.equal(tenth.closed, true);
  assert.equal(betaCfg(s).open, false);
  assert.equal(betaCfg(s).closedAt, NOW + 777);
  assert.equal(betaCfg(s).seats, 10);
  assert.equal(betaCfg(s).until, BETA_UNTIL);
  const st = ok(await s.call(null, 'status'));
  assert.deepEqual([st.open, st.picked, st.left, st.closedAt], [false, 10, 0, NOW + 777]);
  // 안 뽑힌 신청은 "모집이 끝났어요"(closed) · 새 신청은 끝
  assert.equal(ok(await s.call(fanId(10), 'status')).mine.state, 'closed');
  no(await s.call(DJ, 'apply', form([])), 400, ENDED);
  // 자리가 다 차면 다시 열 수 없음(설정 그대로)
  no(await s.call(OPS, 'ops-open', { open: true }), 400, '자리가 다 찼거나 모집 기한이 지나 다시 열 수 없어요.');
  assert.deepEqual([betaCfg(s).open, betaCfg(s).closedAt], [false, NOW + 777]);
  // 11명째
  const r = no(await s.call(OPS, 'ops-pick', { id: apps[10].id }), 409);
  assert.ok(r.error.includes('10명'), r.error);
  assert.equal(s.T.bj_beta_apps.find((a) => a.id === apps[10].id).state, 'wait');
  assert.equal(s.T.bj_albums.length, 10);
});

test('ops-pick 주소가 그새 쓰였으면 state 되돌림(wait) + 409', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  const id = appOf(s, DJ).id;
  s.T.bj_hosts.push({ host: hostOf('먼치'), album: 'aother', created: 2 });
  no(await s.call(OPS, 'ops-pick', { id }), 409);
  const a = appOf(s, DJ);
  assert.equal(a.state, 'wait');
  assert.equal(a.decided, null);
  assert.equal(a.album, null);
  assert.equal(s.T.bj_albums.length, 0);
  assert.equal(s.T.bj_album_owners.length, 0);
  assert.equal(s.T.bj_entitlements.length, 0);
  // 주소 파일을 쓰다 실패해도 되돌림(앨범·주소 지움)
  s.T.bj_hosts = [];
  s.db.broken.add('bj_album_owners');
  no(await s.call(OPS, 'ops-pick', { id }), 503);
  assert.equal(appOf(s, DJ).state, 'wait');
  assert.equal(s.T.bj_albums.length, 0);
  assert.ok(!s.db.files.has(`bakje/h/${hostOf('먼치')}.json`));
  s.db.broken.delete('bj_album_owners');
  // 그새 앨범이 생긴 회원은 뽑지 않음
  s.T.bj_album_owners.push({ album: 'aother', member: DJ, created: 3 });
  no(await s.call(OPS, 'ops-pick', { id }), 409);
  assert.equal(appOf(s, DJ).state, 'wait');
});

test('ops-pick 은 자리를 잡은 뒤 신청을 다시 읽어 그 주소로 만든다(읽은 뒤 고친 신청) · 그새 앨범이 생긴 회원은 되돌림', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  const id = appOf(s, DJ).id;
  // 운영자가 신청을 읽은 뒤 · 자리를 잡기 전에 신청한 분이 주소를 고침
  s.db.beforeClaim = () => { const a = appOf(s, DJ); a.want_label = '먼치랑'; a.want_host = hostOf('먼치랑'); a.want_name = '먼치의 밤'; };
  ok(await s.call(OPS, 'ops-pick', { id }));
  const a = appOf(s, DJ);
  assert.ok(s.T.bj_hosts.some((h) => h.host === hostOf('먼치랑') && h.album === a.album), '고친 주소로 만듦');
  assert.ok(!s.T.bj_hosts.some((h) => h.host === hostOf('먼치')));
  assert.equal(s.T.bj_albums.find((x) => x.id === a.album).name, '먼치의 밤');
  // 자리를 잡는 사이 다른 길(이용권 신청 확인)로 앨범이 생긴 회원
  const q = await shoot(s, STAR, 3);
  ok(await s.call(STAR, 'apply', form(q, { spoonNick: '별사탕', label: '사탕' })));
  s.db.beforeClaim = () => { s.T.bj_album_owners.push({ album: 'aother', member: STAR, created: 9 }); };
  no(await s.call(OPS, 'ops-pick', { id: appOf(s, STAR).id }), 409);
  assert.equal(appOf(s, STAR).state, 'wait');
  assert.equal(s.T.bj_albums.length, 1);
});

test('ops-pick: 자리를 잡은 뒤 주소를 다시 봄 — 그새 다른 분 이용권 신청이 잡은 주소면 되돌림 + 409', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  s.T.bj_orders.push({ id: 'oorder000009', member: RABBIT, state: 'pending', want_host: hostOf('먼치'), want_label: '먼치' });
  no(await s.call(OPS, 'ops-pick', { id: appOf(s, DJ).id }), 409, '주소가 이미 쓰이고 있어요');
  assert.equal(appOf(s, DJ).state, 'wait');
  assert.equal(s.T.bj_albums.length, 0);
  assert.equal(s.T.bj_hosts.length, 0);
});

test('ops-pick: 같은 회원의 확인을 기다리는 새 추억앨범 이용권 신청이 있으면 되돌림 + 409', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  s.T.bj_orders.push({ id: 'oorder000010', member: DJ, state: 'pending', want_host: hostOf('별빛'), want_label: '별빛' });
  no(await s.call(OPS, 'ops-pick', { id: appOf(s, DJ).id }), 409, '확인을 기다리는 새 추억앨범 이용권 신청이 있는 분이에요. 그 신청을 먼저 확인하거나 거절해 주세요.');
  assert.equal(appOf(s, DJ).state, 'wait');
  assert.equal(s.T.bj_albums.length, 0);
  // 새 앨범이 아닌(want_host 없는) 기다리는 신청·끝난 신청은 막지 않음
  s.T.bj_orders = [{ id: 'oorder000011', member: DJ, state: 'pending', want_host: null }, { id: 'oorder000012', member: DJ, state: 'rejected', want_host: hostOf('별빛') }];
  ok(await s.call(OPS, 'ops-pick', { id: appOf(s, DJ).id }));
});

test('기한(12/31)이 지나면: 뽑기 400 · 다시 열기 400 · 닫을 때 끝난 날은 기한', async () => {
  const LATE_PICK = '모집 기한이 지나 뽑을 수 없어요.', NO_REOPEN = '자리가 다 찼거나 모집 기한이 지나 다시 열 수 없어요.';
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  s.setNow(BETA_UNTIL + DAY);
  no(await s.call(OPS, 'ops-pick', { id: appOf(s, DJ).id }), 400, LATE_PICK);
  assert.equal(appOf(s, DJ).state, 'wait');
  const off = ok(await s.call(OPS, 'ops-open', { open: false }));
  assert.deepEqual(off, { ok: true, open: false, closedAt: BETA_UNTIL }, '기한 지난 뒤 닫아도 30일은 기한부터');
  no(await s.call(OPS, 'ops-open', { open: true }), 400, NO_REOPEN);
  assert.deepEqual([betaCfg(s).open, betaCfg(s).closedAt], [false, BETA_UNTIL], '설정은 그대로');
  // 이미 닫혀 있으면 다시 닫아도 끝난 날 그대로
  ok(await s.call(OPS, 'ops-open', { open: false }));
  assert.equal(betaCfg(s).closedAt, BETA_UNTIL);
});

test('ops-pass → 신청한 분 mine 은 모집 중이면 wait, 닫히면 closed · ops-wait 로 되돌림 · ops-open', async () => {
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  const id = appOf(s, DJ).id;
  const r = ok(await s.call(OPS, 'ops-pass', { id }));
  assert.equal(r.app.state, 'passed');
  assert.equal(appOf(s, DJ).state, 'passed');
  assert.equal(appOf(s, DJ).decided, NOW);
  assert.equal(ok(await s.call(DJ, 'status')).mine.state, 'wait');
  no(await s.call(OPS, 'ops-pass', { id }), 404);
  // 모집 닫기
  no(await s.call(OPS, 'ops-open', { open: 'no' }), 400);
  s.setNow(NOW + 100);
  const off = ok(await s.call(OPS, 'ops-open', { open: false }));
  assert.deepEqual(off, { ok: true, open: false, closedAt: NOW + 100 });
  const me = ok(await s.call(DJ, 'status'));
  assert.equal(me.open, false);
  assert.equal(me.closedAt, NOW + 100);
  assert.equal(me.mine.state, 'closed');
  assert.equal(me.mine.canApply, false);
  no(await s.call(STAR, 'apply', form([])), 400, ENDED);
  // 다시 열기 → closedAt 비움
  const on = ok(await s.call(OPS, 'ops-open', { open: true }));
  assert.deepEqual(on, { ok: true, open: true, closedAt: null });
  assert.equal(betaCfg(s).seats, 10);
  // ops-wait: 넘긴 신청을 기다림으로
  const w = ok(await s.call(OPS, 'ops-wait', { id }));
  assert.equal(w.app.state, 'wait');
  assert.equal(appOf(s, DJ).decided, null);
  no(await s.call(OPS, 'ops-wait', { id }), 404);
  // 넘긴 신청도 뽑을 수 있음
  ok(await s.call(OPS, 'ops-pass', { id }));
  assert.equal(ok(await s.call(OPS, 'ops-pick', { id })).app.state, 'picked');
});

test('ops-purge 는 모집이 끝났을 때만(open false + closedAt): 안 뽑힌 줄은 통째로 지우고, 뽑힌 줄은 사진·하고 싶은 말만 비움', async () => {
  const PURGE_LATER = '모집이 끝난 뒤에 정리할 수 있어요.';
  // 시작 전(open false · closedAt 없음)에는 못 함
  no(await setup({ beta: CLOSED }).call(OPS, 'ops-purge'), 400, PURGE_LATER);
  const s = setup({ beta: OPEN });
  const p = await shoot(s, DJ, 3);
  ok(await s.call(DJ, 'apply', form(p)));
  const q = await shoot(s, STAR, 4);
  ok(await s.call(STAR, 'apply', form(q, { spoonNick: '별사탕', label: '사탕' })));
  const r3 = await shoot(s, RABBIT, 3);
  ok(await s.call(RABBIT, 'apply', form(r3, { spoonNick: '달토끼', label: '토끼' })));
  ok(await s.call(RABBIT, 'cancel'));
  const orphan = await shoot(s, CLOUD, 2);   // 올리기만 하고 신청하지 않은 사진
  ok(await s.call(OPS, 'ops-pick', { id: appOf(s, DJ).id }));
  ok(await s.call(OPS, 'ops-pass', { id: appOf(s, STAR).id }));
  const oldStar = appOf(s, STAR).id;
  // 열려 있을 때는 못 함
  no(await s.call(OPS, 'ops-purge'), 400, PURGE_LATER);
  assert.equal(s.T.bj_beta_apps.length, 3);
  assert.equal([...s.db.files.keys()].filter((k) => k.startsWith('bakje-beta/')).length, 9);
  ok(await s.call(OPS, 'ops-open', { open: false }));
  s.T.jl_watch_alerts.push({ id: 900, key: 'health-kiugi', level: 'warn', title: '다른 감시 알림', body: '' });
  assert.equal(s.T.jl_watch_alerts.filter((x) => x.key === 'beta-apply').length, 3);
  const r = ok(await s.call(OPS, 'ops-purge'));
  assert.equal(r.removed, 9);
  assert.deepEqual(s.T.jl_watch_alerts.map((x) => x.key), ['health-kiugi'], '베타 신청 알림 줄만 지움');
  assert.equal([...s.db.files.keys()].filter((k) => k.startsWith('bakje-beta/')).length, 0);
  for (const x of [...p, ...q, ...orphan]) assert.ok(s.db.removed.includes('bakje-beta/' + x));
  assert.ok(s.db.files.has(`bakje/h/${hostOf('먼치')}.json`), '앨범 주소 파일(bakje 칸)은 그대로');
  // 안 뽑힌 줄(넘김·취소)은 없어짐 · 뽑힌 줄은 스푼 닉네임·주소·앨범 이름이 남고 사진·하고 싶은 말만 비움
  assert.deepEqual(s.T.bj_beta_apps.map((a) => a.member), [DJ]);
  const a = appOf(s, DJ);
  assert.equal(a.state, 'picked');
  assert.equal(a.spoon_nick, '먼치');
  assert.equal(a.want_label, '먼치');
  assert.equal(a.want_host, hostOf('먼치'));
  assert.equal(a.want_name, '먼치 추억앨범');
  assert.ok(a.album);
  assert.deepEqual(a.photos, []);
  assert.equal(a.msg, null);
  assert.equal(a.nick, null, '계정 닉네임도 비움(스푼 닉네임·주소·앨범 이름만 남음)');
  const list = ok(await s.call(OPS, 'ops-list'));
  assert.deepEqual(list.apps.map((x) => [x.spoonNick, x.photos.length, x.msg]), [['먼치', 0, '']]);
  // 지운 뒤 같은 회원이 다시 신청할 수 있음(회원마다 한 줄 — 지운 줄은 막지 않음)
  ok(await s.call(OPS, 'ops-open', { open: true }));
  const again = await shoot(s, STAR, 3);
  const re = ok(await s.call(STAR, 'apply', form(again, { spoonNick: '별사탕', label: '사탕' })));
  assert.equal(re.mine.state, 'wait');
  assert.notEqual(appOf(s, STAR).id, oldStar);
  assert.equal(s.T.bj_beta_apps.length, 2);
});

test('status until 지나면 open false', async () => {
  const s = setup({ beta: OPEN, now: BETA_UNTIL });
  assert.equal(ok(await s.call(null, 'status')).open, true);
  s.setNow(BETA_UNTIL + 1);
  const st = ok(await s.call(null, 'status'));
  assert.equal(st.open, false);
  assert.equal(st.left, 10);
  no(await s.call(DJ, 'apply', form([])), 400, ENDED);
  no(await s.call(DJ, 'photo-url', { type: 'image/webp' }), 400, ENDED);
});

test('요청 몸통 8KB 넘으면 413', async () => {
  const s = setup({ beta: OPEN });
  no(await s.call(DJ, 'apply', form([], { msg: 'a'.repeat(9000) })), 413);
  // 글자 수가 아니라 바이트로 셈(한글 3000자 = 9000바이트)
  no(await s.call(DJ, 'apply', form([], { msg: '가'.repeat(3000) })), 413);
  no(await s.call(null, 'status', { pad: 'a'.repeat(8200) }), 413);
  ok(await s.call(null, 'status', { pad: 'a'.repeat(7000) }));
  no(await s.call(null, 'status', {}, { 'content-length': '9000' }), 413);
  // 모양이 틀린 몸통
  const res = await s.handler(new Request(URL_FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).ok, false);
});
