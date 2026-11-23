// 봇 "내 앨범 열기" 로그인 표(web-ticket host) 시험: node --test tests/bakje-web-ticket.test.mjs
// bakje/index.ts 의 "시험이 따로 읽는 곳"(siteOf · webTicketHost · ticketHostOk)만 잘라 가짜 DB 로 돌린다.
// 그 구역이 쓰는 바깥 이름(db · q · HOST_RE · CENTER · CENTER_HOST)은 시험이 넣어 준다. 주소는 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions', 'bakje', 'index.ts');
const raw = fs.readFileSync(SRC, 'utf8');
const START = '// ==== 시험이 따로 읽는 곳 시작 ====', END = '// ==== 시험이 따로 읽는 곳 끝 ====';
const part = raw.indexOf(START) >= 0 ? raw.slice(raw.indexOf(START), raw.indexOf(END)) : '';
assert.ok(part.length > 200, '시험할 곳을 찾지 못했어요');

const CENTER_HOST = 'xn--s22bu18a0ub.com', CENTER = new Set([CENTER_HOST, 'www.' + CENTER_HOST]);
const HOST_RE = /^[a-z0-9.-]{3,253}$/;
const ALBUM = 'abamtol.xn--s22bu18a0ub.com', OTHER = 'adalmuri.xn--s22bu18a0ub.com', OWN = 'xn--album-test.com';
function load(hosts = [ALBUM, OTHER, OWN]) {
  const db = {
    from(table) {
      assert.equal(table, 'bj_hosts');
      let want = null;
      const b = { select() { return b; }, eq(c, v) { want = v; return b; }, maybeSingle: async () => ({ data: hosts.includes(want) ? { host: want } : null, error: null }) };
      return b;
    }
  };
  const q = async (p) => { const { data, error } = await p; if (error) throw error; return data; };
  return new Function('db', 'q', 'HOST_RE', 'CENTER', 'CENTER_HOST', stripTypeScriptTypes(part) + '\nreturn { siteOf, webTicketHost, ticketHostOk };')(db, q, HOST_RE, CENTER, CENTER_HOST);
}

test('web-ticket host: 추억앨범 주소(bj_hosts)면 그 주소용 표 · 먼치킨.com·www 는 그대로 · 모르면 먼치킨.com', async () => {
  const { siteOf, webTicketHost } = load();
  const forHost = async (h) => webTicketHost(await siteOf(h), CENTER_HOST);
  assert.equal(await forHost(ALBUM), ALBUM);
  assert.equal(await forHost(OWN), OWN);
  assert.equal(await forHost(' ABAMTOL.xn--s22bu18a0ub.com '), ALBUM, '대문자·빈칸은 고쳐서 본다(siteOf 와 같게)');
  assert.equal(await forHost(CENTER_HOST), CENTER_HOST);
  assert.equal(await forHost('www.' + CENTER_HOST), 'www.' + CENTER_HOST);
  for (const bad of [undefined, null, '', 12, {}, 'nothere.xn--s22bu18a0ub.com', 'evil.example', 'abamtol.xn--s22bu18a0ub.com/x', 'abamtol.xn--s22bu18a0ub.com:8443',
    'user@abamtol.xn--s22bu18a0ub.com', 'x'.repeat(300), 'localhost:5320', '127.0.0.1:5320', 'http://abamtol.xn--s22bu18a0ub.com'])
    assert.equal(await forHost(bad), CENTER_HOST, JSON.stringify(bad));
});

test('표는 만든 주소에서만 쓸 수 있다(다른 앨범·먼치킨.com 에서는 안 됨) · 먼치킨.com 과 www 는 같은 곳', () => {
  const { ticketHostOk } = load();
  assert.equal(ticketHostOk(ALBUM, ALBUM, CENTER), true);
  assert.equal(ticketHostOk(OTHER, ALBUM, CENTER), false);
  assert.equal(ticketHostOk(CENTER_HOST, ALBUM, CENTER), false);
  assert.equal(ticketHostOk(ALBUM, CENTER_HOST, CENTER), false);
  assert.equal(ticketHostOk('www.' + CENTER_HOST, CENTER_HOST, CENTER), true);
  assert.equal(ticketHostOk(CENTER_HOST, 'www.' + CENTER_HOST, CENTER), true);
  // Origin 머리말이 없는 요청은 지금 규칙 그대로(표 자체가 2분·한 번·43자)
  assert.equal(ticketHostOk('', ALBUM, CENTER), true);
});

test('web-ticket 과 ticket 이 이 판단을 쓴다(코드 자리)', () => {
  assert.match(raw, /case 'web-ticket': \{[\s\S]{0,400}webTicketHost\(await siteOf\(b\.host\), CENTER_HOST\)/);
  assert.match(raw, /if \(!ticketHostOk\(origin, row\.host, CENTER\)\) throw fail\(403/);
  // 답에 표가 통하는 주소(host)도 같이 — 봇은 그 주소로 연다({ok, ticket, host})
  assert.match(raw, /case 'web-ticket': \{[\s\S]{0,600}return \{ ok: true, ticket: await loginTicket\(me\.id, host, now\), host \};/);
  assert.ok(!/\\u[0-9a-fA-F]{4}/.test(raw), '백슬래시-u 글자 표기가 없어야 해요');
});

// ---- 운영자 앱 글(A) ----
test('운영자 앱 로그인 글: 먼치킨 계정(운영자)', () => {
  const ops = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'ops', 'ops.js'), 'utf8');
  assert.ok(ops.includes('먼치킨 계정(운영자)으로 로그인해 주세요.'));
  assert.ok(!ops.includes('추억앨범 운영자 계정으로 로그인해 주세요.'));
});
