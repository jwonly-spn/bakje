// 추억앨범 읽기 좋은 줄바꿈(2026-11-23 사용자 "글들이 너무 다 줄바꿈 없이 난해해 보여"): node --test tests/readable.test.mjs
// 글 내용은 그대로 두고 나누기만 — 안내 글은 문장마다 줄을 나누고, 사용자 글(댓글·소개·캡션)은 손대지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const app = read('docs', 'app.js'), ops = read('docs', 'ops', 'ops.js'), css = read('docs', 'styles.css');

function splitterOf(src) {
  const m = /const SENTENCE_END = (\/.+\/[a-z]*);/.exec(src);
  assert.ok(m, '문장 나누기 규칙을 찾지 못했어요');
  return new Function(`return ${m[1]};`)();
}

test('문장 나누기: 한글 문장 끝(. ? !) 뒤 빈칸에서만 — 주소·번호·괄호 안은 그대로', () => {
  for (const src of [app, ops]) {
    const re = splitterOf(src);
    const parts = (s) => s.split(re);
    assert.deepEqual(parts('카드 결제는 KG이니시스 심사가 끝나면 열려요. 지금은 계좌이체로 결제할 수 있어요.'), ['카드 결제는 KG이니시스 심사가 끝나면 열려요.', '지금은 계좌이체로 결제할 수 있어요.']);
    assert.deepEqual(parts('쓰고 있는 기간이 남아 있으면 그 끝에 이어서 늘어나요. 한 달 = 30일.'), ['쓰고 있는 기간이 남아 있으면 그 끝에 이어서 늘어나요.', '한 달 = 30일.']);
    assert.deepEqual(parts('결제를 확인하고 있어요. 잠시 뒤 [결제 다시 확인]을 눌러 주세요.').length, 2);
    assert.deepEqual(parts('먼치킨.com·먼치킨 봇·먼치킨 송출과 같은 계정이에요.'), ['먼치킨.com·먼치킨 봇·먼치킨 송출과 같은 계정이에요.']);
    assert.deepEqual(parts('버전 1. 2 와 3.5 는 그대로예요'), ['버전 1. 2 와 3.5 는 그대로예요']);
    assert.deepEqual(parts('내 정보 › "DJ 계정으로 이 앨범 관리하기"를 먼저 해 주세요. 끝'), ['내 정보 › "DJ 계정으로 이 앨범 관리하기"를 먼저 해 주세요.', '끝']);
  }
});

test('화면: 안내 글은 문장마다 줄(lines) — 이용권·로그인·가입 안내, 칸 설명', () => {
  assert.ok(app.includes("else if (k === 'lines') el.append(linesOf(v));"));
  for (const s of ["text: CARD_LATER", "class: 'acct-lead', text: '먼치킨.com·먼치킨 봇"]) assert.ok(!app.includes(s), s + ' 가 아직 text 예요');
  assert.ok(app.includes("h('p', { class: 'field-hint', id: later, lines: CARD_LATER })"));
  assert.ok(app.includes("hint ? h('p', { class: 'field-hint', id: id + '-hint', lines: hint }) : null"));
  assert.ok(ops.includes("else if (k === 'lines') el.append(linesOf(v));"));
});

test('사용자 글(댓글·소개·캡션)은 나누지 않는다', () => {
  assert.ok(app.includes("h('p', { class: 'cm-text', text: c.text || '' })"));
  assert.ok(app.includes("prof.bio ? h('p', { text: prof.bio })"));
});

test('모양: 끝줄 한 글자 막기(text-wrap: pretty) · 제목 고르게(balance) · 긴 줄은 읽기 좋은 너비', () => {
  assert.match(css, /text-wrap: pretty/);
  assert.match(css, /text-wrap: balance/);
  assert.match(css, /\.doc p, \.doc li[^{]*\{ max-width: 42em; \}/);
  assert.match(css, /\.pf-bio p \{ max-width: 36em; \}/);
});

test('약관·방침: 한 항목에 붙은 문장은 줄로 나눈다(뜻은 그대로)', () => {
  for (const f of ['terms.html', 'privacy.html']) {
    const html = read('docs', f);
    const items = [...html.matchAll(/<(li|td|p class="doc-lead")[^>]*>([\s\S]*?)<\/(li|td|p)>/g)].map((m) => m[2]);
    assert.ok(items.length > 10, f);
    for (const t of items) assert.ok(!/[가-힣)"][.?!](<\/b>)? [가-힣(<"]/.test(t), `${f}: 줄을 안 나눈 곳 — ${t.slice(0, 60)}`);
  }
});
