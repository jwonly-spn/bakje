// 추억앨범 가입 창(2026-11-23 사용자 "추천대로 해"): "청취자로 가입 / DJ로 가입" 고르기와 내 정보 "계정: DJ/청취자" 줄을 없앤다.
// DJ·리스너는 이제 댓글 마크처럼 결제로만 정해진다(서버 bakje-social). 서버 가입은 그대로 — role 을 안 보내면 지금 기본값(listener).
// node --test tests/album-signup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(ROOT, 'docs', 'app.js'), 'utf8');
const bakje = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'bakje', 'index.ts'), 'utf8');

test('가입 창에 청취자/DJ 고르기가 없다', () => {
  for (const s of ['청취자로 가입', 'DJ로 가입', "'가입 종류'", 'role-seg', 'roleHint']) assert.ok(!app.includes(s), s + ' 가 남아 있어요');
});

test('가입 요청에 role 을 보내지 않는다(서버 기본값 그대로)', () => {
  assert.ok(app.includes("memberCall('signup', { loginId, password: pw.value, agree: true, age14: true })"));
  assert.ok(!/memberCall\('signup', \{[^}]*role/.test(app));
  // 서버 가입은 바꾸지 않음: role 이 없으면 listener
  assert.ok(bakje.includes("role: b.role === 'dj' ? 'dj' : 'listener'"));
});

test('내 정보에 "계정: DJ/청취자" 줄이 없다 · 가입 뒤 고르기로 앨범 연결 창을 열지 않는다', () => {
  assert.ok(!app.includes("row('계정'"));
  assert.ok(!app.includes("ss.get('bj_join_role') === 'dj'"));
  assert.ok(!app.includes("ss.set('bj_join_role'"));
  // 앨범 연결은 내 정보 메뉴에 그대로
  assert.ok(app.includes("item('DJ 계정으로 이 앨범 관리하기'"));
});
