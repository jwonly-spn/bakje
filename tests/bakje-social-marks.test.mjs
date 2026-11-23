// 추억앨범 댓글 마크 시험(2026-11-23 사용자 "먼치킨에서 결제한 사람들만 DJ 마크, 결제하지 않은 사람은 리스너 마크"): node --test tests/bakje-social-marks.test.mjs
// bakje-social/index.ts 의 "시험이 따로 읽는 곳"(roleOf · paidMembers)만 잘라 가짜 DB 로 돌린다. 화면 글(docs/app.js)도 함께 본다.
// 이름은 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'supabase', 'functions', 'bakje-social', 'index.ts');
const raw = fs.readFileSync(SRC, 'utf8');
const START = '// ==== 시험이 따로 읽는 곳 시작 ====', END = '// ==== 시험이 따로 읽는 곳 끝 ====';
const part = raw.indexOf(START) >= 0 ? raw.slice(raw.indexOf(START), raw.indexOf(END)) : '';
assert.ok(part.length > 200, '시험할 곳을 찾지 못했어요');
const { roleOf, paidMembers } = new Function(stripTypeScriptTypes(part) + '\nreturn { roleOf, paidMembers };')();

// 가짜 DB: bj_orders 만(select · in · eq · limit · 기다리기)
function fakeDb(orders) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, 'bj_orders');
      const f = [];
      const b = {
        select(cols) { calls.push(cols); return b; },
        in(c, vs) { f.push((r) => vs.includes(r[c])); return b; },
        eq(c, v) { f.push((r) => r[c] === v); return b; },
        limit() { return b; },
        then(ok, no) { return Promise.resolve({ data: orders.filter((r) => f.every((x) => x(r))).map((r) => ({ member: r.member })), error: null }).then(ok, no); }
      };
      return b;
    }
  };
}
const ORDERS = [
  { member: 'mPaid', state: 'paid' },          // 계좌 입금 확인 · 카드 실결제
  { member: 'mPaid', state: 'canceled' },
  { member: 'mTest', state: 'test' },          // 테스트 결제(실제 결제 아님)
  { member: 'mWait', state: 'pending' },
  { member: 'mCancel', state: 'canceled' },
  { member: 'mRejected', state: 'rejected' },
  { member: 'mOwnerPaid', state: 'paid' },
  { member: 'mElse', state: 'paid' }           // 댓글을 안 단 회원
];
async function marks(owners, members) {
  const db = fakeDb(ORDERS);
  const q = paidMembers(db, members);
  const rows = q ? (await q).data : [];
  const paid = new Set(rows.map((r) => r.member));
  return { db, out: Object.fromEntries(members.map((m) => [String(m), roleOf(new Set(owners), m, paid)])) };
}

test('결제한 회원(bj_orders state paid 가 하나라도)은 DJ · 테스트 결제·기다림·취소·거절만 있거나 신청이 없으면 리스너', async () => {
  const { out } = await marks([], ['mPaid', 'mTest', 'mWait', 'mCancel', 'mRejected', 'mNone']);
  assert.deepEqual(out, { mPaid: 'dj', mTest: 'fan', mWait: 'fan', mCancel: 'fan', mRejected: 'fan', mNone: 'fan' });
});

test('앨범 주인은 결제와 상관없이 주인 표시 그대로(owner)', async () => {
  const { out } = await marks(['mOwner', 'mOwnerPaid'], ['mOwner', 'mOwnerPaid', 'mPaid', 'mNone']);
  assert.deepEqual(out, { mOwner: 'owner', mOwnerPaid: 'owner', mPaid: 'dj', mNone: 'fan' });
});

test('탈퇴 등으로 회원이 없는 댓글은 리스너 · 댓글 단 사람만 묻는다(같은 사람은 한 번) · 아무도 없으면 묻지 않음', async () => {
  const { db, out } = await marks([], [null, 'mPaid', 'mPaid', '']);
  assert.equal(out.null, 'fan');
  assert.equal(out[''], 'fan');
  assert.equal(out.mPaid, 'dj');
  assert.equal(db.calls.length, 1);
  assert.equal(paidMembers(fakeDb(ORDERS), [null, '']), null);
  assert.equal(paidMembers(fakeDb(ORDERS), []), null);
});

test('함수 글에 백슬래시-u 글자 표기가 없다(MCP 로 올릴 때 풀려 버림)', () => {
  assert.ok(!/\\u[0-9a-fA-F]{4}/.test(raw));
});

// ---- 화면 글(docs/app.js) ----
const app = fs.readFileSync(path.join(ROOT, 'docs', 'app.js'), 'utf8');
test('화면: 로그인·가입 화면과 그리로 가는 단추에 "먼치킨 계정"이 보인다', () => {
  assert.match(app, /title: '먼치킨 계정으로 로그인'/);
  assert.match(app, /title: '먼치킨 계정 만들기'/);
  assert.ok(app.includes('먼치킨.com·먼치킨 봇·먼치킨 송출과 같은 계정이에요'));
  assert.match(app, /login-btn', type: 'button', text: '먼치킨 계정으로 로그인'/);
  assert.ok(app.includes("linkBtn('먼치킨 계정 만들기'"));
  assert.ok(!app.includes("linkBtn('회원가입'"), '회원가입 링크 글이 남아 있어요');
  assert.ok(app.includes("cta('먼치킨 계정으로 로그인하고 댓글 달기'"));
});
test('화면: 댓글 마크는 DJ·리스너(청취자 글은 없음), 배지 글로도 보인다', () => {
  assert.ok(app.includes("fan: ['headphones', '리스너', 'role-fan']"));
  assert.ok(!/ROLE_ICON[^\n]*청취자/.test(app));
  assert.ok(app.includes("h('span', { class: 'cm-tag cm-tag-paid', text: 'DJ' })"));
  assert.ok(app.includes("h('span', { class: 'cm-tag cm-tag-fan', text: '리스너' })"));
});
