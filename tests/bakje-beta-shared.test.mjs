// bakje-beta 가 bakje-billing 에서 복사해 둔 주소 이름 규칙이 어긋나지 않았는지: node --test tests/bakje-beta-shared.test.mjs
// bakje-billing 은 정기결제(auto-renew) v7 로 크게 바뀌는 중이에요. 한쪽만 고치면 이 시험이 깨져요 — 두 곳을 같이 고치거나, 합친 뒤 하나로.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'functions');
const read = (name) => fs.readFileSync(path.join(FN, name, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const billing = read('bakje-billing'), beta = read('bakje-beta');
// 한 줄짜리 상수(const NAME = …;) — 줄 끝 설명 주석(// …)은 빼고 값만 비교
const constLine = (src, name) => {
  const m = src.match(new RegExp(`^const ${name} = (.*?);(?:\\s*//.*)?$`, 'm'));
  assert.ok(m, `${name} 를 찾지 못했어요`);
  return m[1];
};
// 함수 본문(function name( 부터 맨 앞의 } 줄까지)
const fnBody = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} 를 찾지 못했어요`);
  const j = src.indexOf('\n}\n', i);
  assert.ok(j > i, `${name} 끝을 찾지 못했어요`);
  return src.slice(i, j + 2);
};

test('주소 이름 규칙 LABEL_RE 가 bakje-billing 과 같다', () => {
  assert.equal(constLine(beta, 'LABEL_RE'), constLine(billing, 'LABEL_RE'));
});

test('쓸 수 없는 주소 이름 LABEL_RESERVED 가 bakje-billing 과 같다', () => {
  assert.equal(constLine(beta, 'LABEL_RESERVED'), constLine(billing, 'LABEL_RESERVED'));
});

test('labelOf 본문이 bakje-billing 과 같다(그 안에서 쓰는 주소 끝 ALBUM_SUFFIX 도)', () => {
  const a = fnBody(beta, 'labelOf'), b = fnBody(billing, 'labelOf');
  assert.ok(a.length > 300, 'labelOf 본문이 너무 짧아요');
  assert.equal(a, b);
  assert.equal(constLine(beta, 'ALBUM_SUFFIX'), constLine(billing, 'ALBUM_SUFFIX'));
});
