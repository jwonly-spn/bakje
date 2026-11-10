// 함수 bakje-pick 시험: node --test tests/bakje-pick.test.mjs
// index.ts 의 "시험이 따로 읽는 곳"만 잘라(타입은 node 의 stripTypeScriptTypes 로 지움) 가짜 DB·저장소로 돌린다.
// 서명은 먼치킨 본체(bot-side.cjs device-sign)와 같은 방법으로 만든다(P-256 · sha256 · ieee-p1363 · base64url, 머리말 JUN-LIVE-BAKJE/1).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions', 'bakje-pick', 'index.ts');
const raw = fs.readFileSync(SRC, 'utf8');
const START = '// ==== 시험이 따로 읽는 곳 시작 ====', END = '// ==== 시험이 따로 읽는 곳 끝 ====';
const part = raw.slice(raw.indexOf(START), raw.indexOf(END));
assert.ok(part.length > 1000, '시험할 곳을 찾지 못했어요');
const { makeHandler, checkPick } = new Function(stripTypeScriptTypes(part) + '\nreturn { makeHandler, checkPick };')();

// ---- 가짜 Supabase(필요한 만큼만) ----
function fakeDb({ devices = {}, bots = {}, albums = {} } = {}) {
  const nonces = new Set(), files = new Map(), hits = new Map(), log = [];
  const tables = { junlive_devices: devices, bj_bots: bots, bj_albums: albums };
  const db = {
    files, hits, log,
    from(table) {
      if (table === 'junlive_access_nonces') {
        return { insert: async (row) => { if (nonces.has(row.id)) return { error: { code: '23505' } }; nonces.add(row.id); return { error: null }; } };
      }
      const where = [];
      const b = {
        select() { return b; },
        eq(col, val) { where.push([col, val]); return b; },
        maybeSingle: async () => ({ data: Object.values(tables[table] || {}).find((r) => where.every(([c, v]) => r[c] === v)) || null, error: null })
      };
      return b;
    },
    rpc: async (name, a) => {
      assert.equal(name, 'fp_hit');
      const n = (hits.get(a.p_key) || 0) + 1;
      hits.set(a.p_key, n);
      return { data: n <= a.p_max, error: null };
    },
    storage: {
      from(bucket) {
        return {
          upload: async (p, blob, opts) => { log.push(['upload', bucket, p]); files.set(`${bucket}/${p}`, { text: await blob.text(), opts }); return { data: { path: p }, error: null }; },
          remove: async (paths) => { log.push(['remove', bucket, ...paths]); for (const p of paths) files.delete(`${bucket}/${p}`); return { data: [], error: null }; }
        };
      }
    }
  };
  return db;
}

// ---- 먼치킨 기기(서명) ----
function makeDevice() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return { privateKey, publicKey: der.toString('base64url'), id: crypto.createHash('sha256').update(der).digest('hex') };
}
function sign(dev, action, payload, { prefix = 'JUN-LIVE-BAKJE/1', timestamp = Date.now() } = {}) {
  const body = { action, payload, publicKey: dev.publicKey, timestamp, nonce: crypto.randomBytes(24).toString('base64url') };
  const digest = crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex');
  body.signature = crypto.sign('sha256', Buffer.from(`${prefix}\n${body.action}\n${body.timestamp}\n${body.nonce}\n${body.publicKey}\n${digest}`), { key: dev.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return body;
}
const URL_FN = 'https://example.supabase.co/functions/v1/bakje-pick';
const post = (handler, body, url = URL_FN) => handler(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }));

function board(over = {}) {
  return {
    v: 1, id: 'pk-20261110-abc', title: '추억의 뽑기판', cells: 30, blank: '꽝', state: 'live', startedAt: 1793000000000, endedAt: null,
    prizes: [{ name: '1등', count: 1, left: 1 }, { name: '2등', count: 2, left: 1 }, { name: '3등', count: 3, left: 3 }],
    opened: [{ n: 13, prize: '2등', name: '밤톨' }, { n: 2, prize: null, name: '달무리' }, { n: 7, prize: null }],
    ...over
  };
}
function setup({ approved = true, linked = true, album = { id: 'dodam', name: '도담 추억앨범', state: 'active', paid_until: null } } = {}) {
  const dev = makeDevice();
  const db = fakeDb({
    devices: { [dev.id]: { id: dev.id, state: approved ? 'approved' : 'revoked' } },
    bots: linked ? { [dev.id]: { id: dev.id, album: album.id } } : {},
    albums: { [album.id]: album }
  });
  return { dev, db, handler: makeHandler(db) };
}
async function answer(res) { return { status: res.status, body: await res.json() }; }

test('health', async () => {
  const { handler } = setup();
  const r = await answer(await handler(new Request(URL_FN + '/health')));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, v: 1, pick: true });
});

test('실시간 판을 snap/<앨범>/pick.json 에 쓴다 (서버가 updatedAt, 비밀 자리는 버림)', async () => {
  const { dev, db, handler } = setup();
  const before = Date.now();
  const r = await answer(await post(handler, sign(dev, 'pick-live', board({ layout: [0, -1, 1], secret: 'x' }))));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true });
  const f = db.files.get('bakje/snap/dodam/pick.json');
  assert.ok(f, '파일이 써지지 않았어요');
  assert.deepEqual(f.opts, { upsert: true, contentType: 'application/json', cacheControl: '2' });
  const j = JSON.parse(f.text);
  assert.ok(j.updatedAt >= before && j.updatedAt <= Date.now());
  assert.equal(j.layout, undefined);
  assert.equal(j.secret, undefined);
  const { updatedAt, ...rest } = j;
  assert.deepEqual(rest, {
    v: 1, id: 'pk-20261110-abc', title: '추억의 뽑기판', cells: 30, blank: '꽝', state: 'live', startedAt: 1793000000000, endedAt: null,
    prizes: [{ name: '1등', count: 1, left: 1 }, { name: '2등', count: 2, left: 1 }, { name: '3등', count: 3, left: 3 }],
    opened: [{ n: 13, prize: '2등', name: '밤톨' }, { n: 2, prize: null, name: '달무리' }, { n: 7, prize: null }]
  });
  // 다음 판(끝남)은 같은 파일을 덮어쓴다
  const r2 = await answer(await post(handler, sign(dev, 'pick-live', board({ state: 'done', endedAt: 1793000600000 }))));
  assert.equal(r2.status, 200);
  assert.equal(JSON.parse(db.files.get('bakje/snap/dodam/pick.json').text).state, 'done');
});

test('state off 면 파일을 지운다(다른 칸은 없어도 된다)', async () => {
  const { dev, db, handler } = setup();
  await post(handler, sign(dev, 'pick-live', board()));
  assert.ok(db.files.has('bakje/snap/dodam/pick.json'));
  const r = await answer(await post(handler, sign(dev, 'pick-live', { v: 1, state: 'off' })));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!db.files.has('bakje/snap/dodam/pick.json'));
  const r2 = await answer(await post(handler, sign(dev, 'pick-live', { v: 1, id: 'pk-1', state: 'off' })));
  assert.equal(r2.status, 200);
});

test('서명: 같은 요청 두 번 409 · 머리말 다르면 403 · 내용 바꾸면 403 · 시간 지나면 400 · 다른 action 400', async () => {
  const { dev, db, handler } = setup();
  const body = sign(dev, 'pick-live', board());
  assert.equal((await post(handler, body)).status, 200);
  assert.equal((await post(handler, body)).status, 409);
  assert.equal((await post(handler, sign(dev, 'pick-live', board(), { prefix: 'BAKJE/1' }))).status, 403);
  const changed = sign(dev, 'pick-live', board());
  changed.payload.title = '바꾼 이름';
  assert.equal((await post(handler, changed)).status, 403);
  assert.equal((await post(handler, sign(dev, 'pick-live', board(), { timestamp: Date.now() - 11 * 60000 }))).status, 400);
  assert.equal((await post(handler, sign(dev, 'board-save', board()))).status, 400);
  assert.equal((await post(handler, sign(dev, 'album-info', {}))).status, 400);
  // 다른 기기의 공개 키를 붙이면 서명이 안 맞는다
  const other = makeDevice(), stolen = sign(other, 'pick-live', board());
  stolen.publicKey = dev.publicKey;
  assert.equal((await post(handler, stolen)).status, 403);
  assert.equal((await post(handler, '{망가진')).status, 400);
  assert.equal(db.log.filter((x) => x[0] === 'upload').length, 1);
});

test('승인 안 된 기기·앨범에 안 이어진 기기는 403', async () => {
  for (const opt of [{ approved: false }, { linked: false }]) {
    const { dev, db, handler } = setup(opt);
    const r = await answer(await post(handler, sign(dev, 'pick-live', board())));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, '추억앨범에 올릴 수 있는 먼치킨이 아니에요.');
    assert.equal(db.files.size, 0);
  }
});

test('보기만 앨범(readonly·결제 끝남)은 403, 있던 파일도 지운다 · off 는 그대로 된다', async () => {
  for (const album of [{ id: 'dodam', state: 'readonly', paid_until: null }, { id: 'dodam', state: 'active', paid_until: Date.now() - 1000 }]) {
    const { dev, db, handler } = setup({ album });
    db.files.set('bakje/snap/dodam/pick.json', { text: '{}', opts: {} });
    const r = await answer(await post(handler, sign(dev, 'pick-live', board())));
    assert.equal(r.status, 403);
    assert.match(r.body.error, /보기만/);
    assert.ok(!db.files.has('bakje/snap/dodam/pick.json'));
    assert.equal((await post(handler, sign(dev, 'pick-live', { v: 1, state: 'off' }))).status, 200);
  }
});

test('기기마다 1분 40번', async () => {
  const { dev, db, handler } = setup();
  for (let i = 0; i < 40; i++) assert.equal((await post(handler, sign(dev, 'pick-live', board()))).status, 200, '번째 ' + i);
  const r = await answer(await post(handler, sign(dev, 'pick-live', board())));
  assert.equal(r.status, 429);
  assert.equal(db.hits.get('bjpk:' + dev.id), 41);
});

test('판 모양 검사(약속 문서 2·3절)', async () => {
  const bad = (over, msg) => assert.throws(() => checkPick(board(over)), (e) => e.status === 400 && (!msg || msg.test(e.message)), JSON.stringify(over));
  const good = (over) => checkPick(board(over));
  // 판
  bad({ v: 2 }); bad({ state: 'ready' }); bad({ state: 'LIVE' });
  bad({ id: '' }); bad({ id: 5 }); bad({ id: '../x' }); bad({ id: undefined });
  bad({ title: '' }, /판 이름/); bad({ title: '   ' }, /판 이름/); bad({ title: '가'.repeat(21) }, /20자/); good({ title: '가'.repeat(20) });
  bad({ cells: 8 }, /9칸부터 100칸/); bad({ cells: 101 }); bad({ cells: 9.5 }); bad({ cells: '30' });
  good({ cells: 9, prizes: [], opened: [] }); good({ cells: 100 });
  bad({ blank: '' }); bad({ blank: '가'.repeat(9) }, /8자/); good({ blank: '다음 기회에' });
  bad({ startedAt: '어제' }); bad({ startedAt: -1 }); bad({ endedAt: Infinity }); good({ startedAt: null, endedAt: 1793000600000 }); good({ startedAt: undefined });
  // 상품
  bad({ prizes: 'x' }); bad({ prizes: Array.from({ length: 31 }, (_, i) => ({ name: 'p' + i, count: 1, left: 1 })) }, /30개/);
  good({ cells: 30, prizes: Array.from({ length: 30 }, (_, i) => ({ name: 'p' + i, count: 1, left: 1 })), opened: [] });
  bad({ prizes: [{ name: '', count: 1, left: 1 }] }); bad({ prizes: [{ name: '가'.repeat(21), count: 1, left: 1 }] });
  bad({ prizes: [{ name: '1등', count: 0, left: 0 }] }); bad({ prizes: [{ name: '1등', count: 1.5, left: 1 }] });
  bad({ prizes: [{ name: '1등', count: 2, left: 3 }] }); bad({ prizes: [{ name: '1등', count: 2, left: -1 }] });
  bad({ cells: 10, prizes: [{ name: '1등', count: 6, left: 6 }, { name: '2등', count: 5, left: 5 }], opened: [] }, /칸 수보다 많아요/);
  good({ cells: 10, prizes: [{ name: '1등', count: 6, left: 6 }, { name: '2등', count: 4, left: 4 }], opened: [] });
  // 열린 칸
  bad({ opened: 'x' }); bad({ cells: 9, prizes: [], opened: Array.from({ length: 10 }, (_, i) => ({ n: (i % 9) + 1, prize: null })) });
  bad({ opened: [{ n: 0, prize: null }] }); bad({ opened: [{ n: 31, prize: null }] }); bad({ opened: [{ n: '3', prize: null }] });
  bad({ opened: [{ n: 3, prize: null }, { n: 3, prize: '1등' }] }, /두 번/);
  bad({ opened: [{ n: 3, prize: '가'.repeat(21) }] }); bad({ opened: [{ n: 3, prize: 7 }] });
  bad({ opened: [{ n: 3, prize: null, name: '가'.repeat(41) }] }); bad({ opened: [{ n: 3, prize: null, name: 12 }] });
  const ok = good({ opened: [{ n: 3, prize: '', name: '' }, { n: 4, name: '가'.repeat(40) }, { n: 5, prize: ' 1등 ' }] });
  assert.deepEqual(ok.opened, [{ n: 3, prize: null }, { n: 4, prize: null, name: '가'.repeat(40) }, { n: 5, prize: '1등' }]);
  // 글자: 줄바꿈은 빈칸으로, 제어 문자는 뺀다, 이모지·점자 빈칸 닉네임 그대로
  assert.equal(good({ title: '할로윈\n뽑기' }).title, '할로윈 뽑기');
  assert.equal(good({ opened: [{ n: 1, prize: null, name: '⠀밤 톨🎃' }] }).opened[0].name, '⠀밤 톨🎃');
  assert.deepEqual(checkPick({ v: 1, state: 'off' }), { state: 'off' });
  assert.throws(() => checkPick(null)); assert.throws(() => checkPick([]));
});

test('몸이 너무 크면 413', async () => {
  const { handler } = setup();
  const r = await post(handler, JSON.stringify({ action: 'pick-live', pad: 'x'.repeat(40000) }));
  assert.equal(r.status, 413);
});
