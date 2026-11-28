// 추억앨범 · 입금 확인(운영자 앱) — 아이폰 홈 화면에 추가해서 쓴다. 푸시 알림은 홈 화면 앱에서만 된다(iOS 16.4+).
// 서버: bakje(회원 로그인) · bakje-billing(입금 목록·확인·알림 기기 · "회원" 탭 — 회원 목록·먼치킨 엠베서더 주기·풀기, 2026-11-28) · bakje-beta(추억앨범 베타테스터 신청 — "베타" 탭). 세션은 이 앱 저장소(localStorage)에만.
'use strict';
const SB = 'https://aksegkhhugqvvaidgvro.supabase.co/functions/v1/';
const PLAN = { munchkin: '먼치킨', album: '추억앨범', bundle: '먼치킨 + 추억앨범', 'add-album': '추억앨범 추가', 'add-munchkin': '먼치킨 추가' };
const STATE = { paid: '확인함', rejected: '거절함', canceled: 'DJ가 취소', pending: '기다림', test: '🧪 테스트' };
// 카드 결제(포트원 · KG이니시스) 신청은 운영자가 확인할 것이 없어 "확인할 것"에 오지 않는다 — 지난 신청에만 💳 로 보인다.
//  state test = 테스트 결제(실제 결제 아님, 이용권 없음). 입금자명 자리에는 "카드 결제".
const isCard = (o) => o.pay === 'card';
const payerText = (o) => (isCard(o) ? '카드 결제' : o.payer);
// 돈이 들어왔는데 이용권을 주지 않은 카드 신청(취소한 뒤 결제됨 · 금액이 다름): payAt 이 있고 결제됨·테스트가 아님 → 포트원 콘솔에서 환불 확인
const refundCheck = (o) => isCard(o) && o.payAt && o.state !== 'paid' && o.state !== 'test';
const stateText = (o) => (refundCheck(o) ? '⚠️ 환불 확인' : isCard(o) && o.state === 'paid' ? '💳 결제됨' : STATE[o.state] || o.state);
const app = document.getElementById('app');
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
};
// 화면(탭) — 주소 끝 #msgs 처럼 열면 그 화면부터(운영자 메시지 확인 알림을 누르면 /ops/#msgs, 2026-11-28)
const TABS = { wait: '확인할 것', done: '처리한 것', beta: '베타테스터', mem: '회원', msgs: '보낸 메시지', set: '설정' };
const tabOfHash = () => { const k = location.hash.slice(1); return Object.hasOwn(TABS, k) ? k : 'wait'; };
const S = { session: ls.get('ops_session'), me: null, tab: tabOfHash(), data: null, busy: false, devices: null, beta: null, betaErr: '', members: null, membersErr: '', mFilter: 'all', mQuery: '',
  msgs: null, msgsErr: '', drafts: {} };

// ---------- 작은 도구 ----------
// 안내 글 줄바꿈(2026-11-23 사용자 "글들이 줄바꿈 없이 난해해 보여"): 글은 그대로 두고 한글 문장 끝(. ? !) 뒤 빈칸에서 줄을 나눈다.
//  h(…, { lines: '…' }) 로 쓴다. 사용자 글(댓글·소개·캡션)에는 쓰지 않는다.
const SENTENCE_END = /(?<=[가-힣"”')\]][.?!])\s+/;
function linesOf(s) {
  const box = document.createElement('span');
  box.className = 'lines';
  String(s).split(SENTENCE_END).forEach((x, i) => { if (i) box.append(document.createElement('br')); box.append(x); });
  return box;
}
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'lines') el.append(linesOf(v));
    else if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
// 작은 그림(선 아이콘 — 글자색을 따라감). 아래 탭 막대·머리 단추에 쓴다(2026-11-28 휴대폰 정리).
const ICONS = {
  wait: ['M3.5 13.5h4.8l1.6 3h4.2l1.6-3h4.8', 'M6 5h12l2.5 8.5V19H3.5v-5.5z'],
  done: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M8 12.4l2.8 2.8L16.2 9.6'],
  beta: ['M12 3.6l2.6 5.2 5.7.8-4.15 4 1 5.7L12 16.6l-5.15 2.7 1-5.7-4.15-4 5.7-.8z'],
  mem: ['M9 4.8a3.2 3.2 0 1 0 0 6.4a3.2 3.2 0 1 0 0-6.4z', 'M3 19.2c.5-3.2 2.9-5.2 6-5.2s5.5 2 6 5.2', 'M16.3 6.4a2.6 2.6 0 1 1 0 5.2', 'M17.2 14.2c2.1.3 3.5 1.9 3.9 4.6'],
  msgs: ['M5.5 5.5h13a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16V8a2.5 2.5 0 0 1 2.5-2.5z', 'M3.6 7.4l8.4 6.1 8.4-6.1'],
  set: ['M4 7h9', 'M18 7h2', 'M4 17h3', 'M12 17h8', 'M15.5 4.8a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4z', 'M9.5 14.8a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4z'],
  refresh: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.8 4.2v4.6h-4.6']
};
function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ico');
  for (const d of ICONS[name] || []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
// 한 줄 정보(가입 방법 · 가입한 날 · 최근…): 조각마다 묶어서 좁은 화면에서도 조각 가운데서 끊기지 않게
const meta = (cls, parts) => { const list = parts.filter(Boolean); return list.length ? h('p', { class: 'meta ' + cls }, list.map((t) => h('span', { text: t }))) : null; };
const won = (n) => Number(n || 0).toLocaleString('ko-KR') + '원';
const day = (ms) => { const d = new Date(Number(ms)); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };
const ymd = (ms) => { const d = new Date(Number(ms)); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };   // 좁은 칸용(이용권 끝나는 날)
const mdhm = (ms) => { const d = new Date(Number(ms)); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const when = (ms) => {
  const s = Math.round((Date.now() - Number(ms)) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  const d = new Date(Number(ms));
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const period = (o) => (o.months ? (o.months === 12 ? '1년' : o.months + '개월') : `${day(o.until_to)}까지`);
// 새 추억앨범 신청(앨범이 없는 DJ 가 먼치킨.com/album 에서): 입금을 확인하면 앨범·주소가 바로 만들어진다
const newAlbumLine = (o) => (o.newAlbum ? `📚 새 추억앨범 · ${o.newAlbum.label}.먼치킨.com · ${o.newAlbum.name}` : '');
// 현금영수증(2026-11-25): DJ 가 "입금했어요" 때 적은 번호(서버 ops-orders 만 줌 — 숫자만). 입금을 확인한 뒤 손택스로 발급한다. 없으면 아무것도 안 보임.
//  보기 좋게 하이픈: 휴대폰 010-1234-5678 · 사업자등록번호 123-45-67890 · 현금영수증 카드 번호 4자리씩. [번호 복사]는 숫자만.
const RECEIPT = { personal: '소득공제', business: '지출증빙' };
const receiptOf = (o) => (o.receipt && Object.hasOwn(RECEIPT, o.receipt.kind) &&/^[0-9]+$/.test(String(o.receipt.number || '')) ? o.receipt : null);
function receiptNo(r) {
  const n = String(r.number);
  if (r.kind === 'business' && n.length === 10) return `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`;
  if (/^01[0-9]{8,9}$/.test(n)) return `${n.slice(0, 3)}-${n.slice(3, n.length - 4)}-${n.slice(-4)}`;
  return n.match(/.{1,4}/g).join('-');
}
const receiptText = (r) => `🧾 ${RECEIPT[r.kind]} ${receiptNo(r)}`;
const copyReceipt = (r) => copy(r.number, '현금영수증 번호');
let toastTimer = 0;
function toast(text, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = text; t.className = bad ? 'bad' : ''; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`${label} 복사했어요`); } catch { toast('복사하지 못했어요', true); }
}
const standalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const pushReady = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

class Fail extends Error { constructor(status, message) { super(message); this.status = status; } }
async function call(fn, body, timeout = 20000) {
  let r;
  try {
    r = await fetch(SB + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(S.session ? { 'x-bj-session': S.session } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  } catch { throw new Fail(0, '인터넷 연결을 확인해 주세요.'); }
  const j = await r.json().catch(() => null);
  if (r.status === 401 && S.session) { signOut(); throw new Fail(401, '다시 로그인해 주세요.'); }
  if (!r.ok || !j?.ok) throw new Fail(r.status, j?.error || '잠시 문제가 생겼어요.');
  return j;
}
const bill = (action, extra = {}) => call('bakje-billing', { action, ...extra });
const beta = (action, extra = {}) => call('bakje-beta', { action, ...extra });

// 확인 창(<dialog>)
function ask({ title, lines = [], ok = '확인', cancel = '취소', danger = false, input = null }) {
  return new Promise((resolve) => {
    const field = input ? h('input', { class: 'field', type: 'text', placeholder: input, maxlength: '200' }) : null;
    const dlg = h('dialog', { class: 'sheet' },
      h('h2', { text: title }),
      ...lines.map((l) => h('p', { lines: l })),
      field,
      h('div', { class: 'sheet-btns' },
        h('button', { class: 'btn', type: 'button', text: cancel, onclick: () => dlg.close('') }),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', text: ok, onclick: () => dlg.close('ok') })));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(dlg.returnValue === 'ok' ? (field ? field.value.trim() : true) : null); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

// ---------- 화면 ----------
function render() {
  const restore = keepStrips(), refocus = keepFocus();
  app.replaceChildren();
  document.body.classList.remove('tabs-on');
  if (!standalone() && isIOS() && !ls.get('ops_skip_install')) return app.append(installView());
  if (!S.session) return app.append(loginView());
  document.body.classList.add('tabs-on');
  const view = { wait: waitView, done: doneView, beta: betaView, mem: membersView, msgs: msgsView }[S.tab] || settingsView;
  app.append(header(), view(), tabs());
  restore(); refocus();
}
// 1분마다 다시 그려도 쓰던 찾기 칸은 그대로(글자·커서 자리)
function keepFocus() {
  const el = document.activeElement, key = el?.dataset?.keep;
  if (!key) return () => {};
  const [a, b] = [el.selectionStart, el.selectionEnd];
  return () => { const n = app.querySelector(`[data-keep="${key}"]`); if (n) { n.focus({ preventScroll: true }); try { n.setSelectionRange(a, b); } catch {} } };
}
// 탭 옮기기: 주소 끝(#)도 맞춘다(새로 고쳐도 그 화면) · 그 화면 데이터를 부른다 · 맨 위로
function go(key) {
  if (!Object.hasOwn(TABS, key)) key = 'wait';
  const same = S.tab === key;
  S.tab = key;
  try { history.replaceState(null, '', key === 'wait' ? location.pathname + location.search : '#' + key); } catch {}
  render();
  if (!same) scrollTo(0, 0);
  if (key === 'beta') loadBeta().then(render);
  if (key === 'mem') loadMembers().then(render);
  if (key === 'msgs') loadMsgs().then(render);
}
addEventListener('hashchange', () => { const k = tabOfHash(); if (k !== S.tab) go(k); });
// 1분마다 다시 그려도 옆으로 넘겨 보던 사진 줄 자리는 그대로(베타 탭)
function keepStrips() {
  const at = new Map([...app.querySelectorAll('.shots[data-id]')].map((el) => [el.dataset.id, el.scrollLeft]));
  return () => { for (const el of app.querySelectorAll('.shots[data-id]')) { const x = at.get(el.dataset.id); if (x) el.scrollLeft = x; } };
}

function installView() {
  return h('section', { class: 'install' },
    h('img', { class: 'app-icon', src: 'icon-180.png', alt: '' }),
    h('h1', { text: '입금 확인 앱 설치' }),
    h('p', { class: 'muted', lines: '홈 화면에 추가해야 입금 알림(푸시)을 받을 수 있어요. 스토어에서 받지 않아도 돼요.' }),
    h('ol', { class: 'steps' },
      h('li', null, h('b', { text: '아래쪽 가운데 ' }), h('span', { class: 'share-ico', 'aria-hidden': 'true', text: '⬆︎' }), h('b', { text: ' 공유 단추' }), '를 눌러요'),
      h('li', null, '목록을 내려 ', h('b', { text: '"홈 화면에 추가"' }), '를 눌러요'),
      h('li', null, h('b', { text: '"웹 앱으로 열기"' }), '가 켜져 있는지 보고 오른쪽 위 ', h('b', { text: '추가' }), '를 눌러요'),
      h('li', null, '홈 화면의 ', h('b', { text: '입금 확인' }), ' 아이콘으로 열어요')),
    h('button', { class: 'link', type: 'button', text: '설치하지 않고 여기서 보기(알림은 안 와요)', onclick: () => { ls.set('ops_skip_install', '1'); render(); } }));
}

function loginView() {
  const id = h('input', { class: 'field', type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: '아이디', required: true });
  const pw = h('input', { class: 'field', type: 'password', autocomplete: 'current-password', placeholder: '비밀번호', required: true });
  const msg = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary wide', type: 'submit', text: '로그인' });
  const form = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    if (S.busy) return;
    S.busy = true; btn.disabled = true; msg.textContent = '';
    try {
      const j = await call('bakje/member', { action: 'login', loginId: id.value.trim(), password: pw.value });
      S.session = j.session;
      const info = await bill('info');
      if (!info.admin) { S.session = null; throw new Fail(403, '운영자 계정이 아니에요.'); }
      ls.set('ops_session', S.session);
      S.me = j.member;
      await load();
      syncPush();
    } catch (err) { msg.textContent = err.message; }
    S.busy = false; btn.disabled = false;
  } },
    h('img', { class: 'app-icon', src: 'icon-180.png', alt: '' }),
    h('h1', { text: '입금 확인' }),
    h('p', { class: 'muted', text: '먼치킨 계정(운영자)으로 로그인해 주세요.' }),
    id, pw, msg, btn);
  return form;
}

// 머리: 지금 화면 이름(크게) · 운영자 이름 · [새로 고침] [설정](2026-11-28 휴대폰 정리 — 탭은 아래 막대로, 설정은 여기로)
function header() {
  const n = (S.data?.waiting || []).filter((o) => o.sent).length;
  return h('header', { class: 'top' },
    h('div', { class: 'top-text' }, h('h1', { text: TABS[S.tab] }), h('p', { class: 'muted small', text: S.me ? `입금 확인 · ${S.me.nickname || '운영자'}` : '입금 확인' })),
    h('div', { class: 'top-btns' },
      h('button', { class: 'round', type: 'button', 'aria-label': '새로 고침', onclick: () => load(true) }, h('span', { class: 'ico-wrap' + (S.busy ? ' spin' : '') }, icon('refresh'))),
      h('button', { class: 'round' + (S.tab === 'set' ? ' on' : ''), type: 'button', 'aria-label': '설정', 'aria-pressed': String(S.tab === 'set'), onclick: () => go('set') }, icon('set'))),
    n ? h('span', { class: 'sr-only', text: `입금했다고 한 신청 ${n}개` }) : null);
}

// 아래 탭 막대(엄지 닿는 곳) — 그림 + 이름 + 기다리는 수
function tabs() {
  const n = (S.data?.waiting || []).length;
  const nb = (S.beta?.apps || []).filter((a) => a.state === 'wait').length;
  const tab = (key, label, count = 0) => h('button', { type: 'button', class: 'tab' + (S.tab === key ? ' on' : ''), 'aria-current': S.tab === key ? 'page' : null,
    'aria-label': count ? `${label}, ${count}개` : label, onclick: () => go(key) },
    h('span', { class: 'tab-ico' }, icon(key), count ? h('span', { class: 'badge', 'aria-hidden': 'true', text: count > 99 ? '99+' : String(count) }) : null),
    h('span', { class: 'tab-label', text: label }));
  return h('nav', { class: 'tabbar', 'aria-label': '화면 고르기' },
    h('div', { class: 'tabbar-in' }, tab('wait', '확인할 것', n), tab('done', '처리한 것'), tab('beta', '베타', nb), tab('mem', '회원'), tab('msgs', '메시지')));
}

function waitView() {
  if (!S.data) return h('p', { class: 'empty', text: '불러오는 중이에요…' });
  const list = [...S.data.waiting].sort((a, b) => (b.sent ? 1 : 0) - (a.sent ? 1 : 0) || (a.sent || a.created) - (b.sent || b.created));
  if (!list.length) return h('div', { class: 'empty' }, h('p', { class: 'big', text: '✓' }), h('p', { text: '확인할 입금이 없어요.' }));
  return h('section', { class: 'list' }, list.map(orderCard));
}

function orderCard(o) {
  const r = receiptOf(o);
  return h('article', { class: 'card' + (o.sent ? ' sent' : '') },
    h('div', { class: 'card-top' },
      h('span', { class: 'chip ' + (o.sent ? 'green' : 'gray'), text: o.sent ? `입금했어요 · ${when(o.sent)}` : `신청만 함 · ${when(o.created)}` }),
      h('span', { class: 'muted small', text: o.nick || '(닉네임 없음)' })),
    h('p', { class: 'amount', text: won(o.amount) }),
    // 입금자명: 이름표 위 · 이름 아래(긴 이름도 한 줄 전체 폭 — 현금영수증 칸과 같은 모양)
    h('button', { class: 'payer', type: 'button', 'aria-label': `입금자명 ${o.payer} — 복사`, onclick: () => copy(o.payer, '입금자명') },
      h('span', { class: 'rc' }, h('span', { class: 'muted small', text: '입금자명' }), h('b', { text: o.payer })), h('span', { class: 'copy', text: '복사' })),
    // 현금영수증 번호(입금자명 칸과 같은 모양 — 누르면 숫자만 복사)
    r ? h('button', { class: 'payer receipt', type: 'button', 'aria-label': `${receiptText(r)} — 번호 복사`, onclick: () => copyReceipt(r) },
      h('span', { class: 'rc' }, h('span', { class: 'muted small', text: `🧾 ${RECEIPT[r.kind]}` }), h('b', { text: receiptNo(r) })), h('span', { class: 'copy', text: '번호 복사' })) : null,
    h('p', { class: 'plan', text: `${PLAN[o.plan] || o.plan} · ${period(o)}${o.album ? ' · 앨범 ' + o.album : ''}` }),
    o.newAlbum ? h('p', { class: 'plan new-album', text: newAlbumLine(o) }) : null,
    h('div', { class: 'card-btns' },
      h('button', { class: 'btn', type: 'button', text: '거절', onclick: () => reject(o) }),
      h('button', { class: 'btn primary', type: 'button', text: '입금 확인', onclick: () => confirmPaid(o) })));
}

async function confirmPaid(o) {
  const yes = await ask({ title: '입금이 들어왔나요?', ok: o.newAlbum ? '들어왔어요 · 앨범 만들기' : '들어왔어요 · 기간 늘리기', cancel: '아직',
    lines: [`토스뱅크에서 입금자명 "${o.payer}", ${won(o.amount)}이 들어왔는지 확인해 주세요.`, `${o.nick || 'DJ'} · ${PLAN[o.plan] || o.plan} ${period(o)}`,
      ...(o.newAlbum ? [newAlbumLine(o), '입금을 확인하면 앨범과 주소가 바로 만들어져요.'] : []),
      ...(receiptOf(o) ? [`${receiptText(receiptOf(o))} — 확인한 뒤 현금영수증을 발급해 주세요.`] : [])] });
  if (!yes) return;
  try {
    const j = await bill('ops-confirm', { id: o.id });
    const u = j.until || {};
    const parts = [u.munchkin ? `먼치킨 ${day(u.munchkin)}까지` : '', u.album ? `추억앨범 ${day(u.album)}까지` : ''].filter(Boolean);
    if (j.order?.newAlbum) parts.unshift(`앨범을 만들었어요 · ${j.order.newAlbum.label}.먼치킨.com`);
    toast(`확인했어요 · ${parts.join(' · ') || '기간을 늘렸어요'}`);
    await load();
  } catch (err) { toast(err.message, true); }
}

async function reject(o) {
  const note = await ask({ title: '이 신청을 거절할까요?', danger: true, ok: '거절', cancel: '닫기', input: '까닭(DJ에게 보여요, 비워도 돼요)',
    lines: [`${o.nick || 'DJ'} · ${won(o.amount)} · 입금자명 ${o.payer}`] });
  if (note == null) return;
  try { await bill('ops-reject', { id: o.id, note }); toast('거절했어요'); await load(); } catch (err) { toast(err.message, true); }
}

function doneView() {
  const list = S.data?.recent || [];
  if (!list.length) return h('p', { class: 'empty', text: '아직 처리한 신청이 없어요.' });
  // 한 장: 위 줄 = 상태 · 처리한 때, 아래 = 금액·입금자 · DJ·이용권(전체 폭 — 좁은 오른쪽 칸에서 날짜가 두 줄로 깨지던 것, 11/28)
  return h('section', { class: 'list' }, list.map((o) => {
    const r = receiptOf(o);
    return h('article', { class: 'card slim' },
      h('div', { class: 'card-top' }, h('span', { class: 'chip ' + (o.state === 'paid' ? 'green' : 'gray'), text: stateText(o) }), h('span', { class: 'muted small', text: o.done ? when(o.done) : '' })),
      h('b', { class: 'slim-title', text: `${won(o.amount)} · ${payerText(o)}` }),
      meta('muted small', [isCard(o) ? '💳 카드' : '', o.nick, `${PLAN[o.plan] || o.plan} ${period(o)}`]),
      o.newAlbum ? h('p', { class: 'muted small', text: newAlbumLine(o) }) : null,
      r ? h('div', { class: 'slim-row' }, h('p', { class: 'muted small', text: receiptText(r) }),
        h('button', { class: 'btn small', type: 'button', text: '번호 복사', 'aria-label': `${receiptText(r)} — 번호 복사`, onclick: () => copyReceipt(r) })) : null);
  }));
}

// ---------- 추억앨범 베타테스터(bakje-beta) ----------
// 신청(스푼 닉네임·하고 싶은 말·첨부한 박제 사진·편지 3~10장 · 옛 화면 신청은 주소 이름·앨범 이름도)을 보고 운영자가 [뽑기]·[넘기기].
//  뽑으면 12월 31일까지 무료 이용권이 바로 생긴다. 주소가 있는 신청은 서버가 앨범·주소도 바로 만들고,
//  주소가 없는 신청(11/26 쉬운 신청 — 주소는 뽑힌 뒤에)은 뽑힌 분이 주소를 정할 때 앨범이 생긴다(카드 "주소를 정하길 기다려요" · 서버 needAddress).
//  0원 결제 기록은 만들지 않는다 — 뽑힌 기록은 이 탭에만 보인다(11/25).
//  사진은 비공개 칸의 1시간짜리 보기 주소라 이 앱 안에서만 크게 본다. 모집이 끝난 날부터 30일 뒤 [지난 신청 정리하기](개인정보처리방침).
const BETA_STATE = { wait: ['기다림', 'blue'], picked: ['뽑힘', 'green'], passed: ['넘김', 'gray'], canceled: ['취소', 'gray'] };
const PURGE_AFTER = 30 * 86400000;
const albumHost = (label) => `${label}.먼치킨.com`;
const md = (ms) => { const d = new Date(Number(ms)); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
let acting = null;   // 지금 처리 중인 일 { id, kind } — 두 번 누르기 막기('head' = 모집 열기·닫기·정리)

// 사진 보기 주소는 불러올 때마다 새로 온다(1시간짜리) — 같은 사진은 50분 동안 처음 주소를 그대로 써서 1분마다 다시 내려받지 않게
const shotUrls = new Map();
function steadyUrl(u) {
  const key = String(u).split('?')[0], now = Date.now(), had = shotUrls.get(key);
  if (had && now - had.at < 50 * 60000) return had.url;
  shotUrls.set(key, { url: u, at: now });
  return u;
}

function betaView() {
  const b = S.beta;
  if (!b) return S.betaErr
    ? h('div', { class: 'empty' }, h('p', { text: S.betaErr }), h('button', { class: 'link', type: 'button', text: '다시 불러오기', onclick: () => loadBeta().then(render) }))
    : h('p', { class: 'empty', text: '불러오는 중이에요…' });
  const apps = b.apps || [];
  const of = (s) => apps.filter((a) => a.state === s);
  const wait = of('wait'), picked = of('picked'), passed = of('passed'), canceled = of('canceled');
  const part = (title, list, card) => (list.length ? [h('h2', { text: `${title} ${list.length}` }), h('div', { class: 'list' }, list.map(card))] : []);
  return h('section', { class: 'beta' },
    betaHead(b, apps),
    !apps.length ? h('p', { class: 'empty', text: '아직 신청이 없어요.' }) : [
      wait.length ? [h('h2', { text: `기다리는 신청 ${wait.length}` }), h('div', { class: 'list' }, wait.map(betaCard))] : h('h2', { text: '기다리는 신청이 없어요' }),
      part('뽑은 분', picked, betaCard),
      part('넘긴 신청', passed, betaCard),
      part('취소한 신청', canceled, betaRow)]);
}

// 위 칸: 모집 상태 · 뽑힘 B / 10 · 남은 자리 · [모집 열기]/[모집 닫기] · 모집이 끝나고 30일 뒤 [지난 신청 정리하기]
function betaHead(b, apps) {
  const now = Date.now();
  // 모집이 끝난 때 = 운영자가 닫았거나 10명이 차서 닫힌 때(closedAt). 서버 ops-purge 도 닫혀 있고 closedAt 이 있을 때만 정리한다.
  //  기한(12/31)이 지났는데 닫지 않았으면 끝난 날이 없다 → [모집 닫기]로 끝난 날을 남긴다.
  const endAt = !b.open && b.closedAt != null ? b.closedAt : null;
  const late = now > b.until;
  const [stateText, tone] = b.open ? ['모집 중', 'green'] : endAt == null && !late && b.left > 0 ? ['시작 전', 'gray'] : ['모집 끝', 'gray'];
  const busy = acting?.id === 'head' ? acting.kind : '';
  let action;
  const closeBtn = () => h('button', { class: 'btn wide', type: 'button', disabled: !!acting, text: busy === 'open' ? '닫는 중…' : '모집 닫기', onclick: () => setBetaOpen(false) });
  if (b.open) action = closeBtn();
  else if (endAt == null && late) action = [h('p', { class: 'muted small', lines: `모집 기한(${md(b.until)})이 지났어요. 모집을 닫으면 기한부터 30일 뒤 지난 신청을 정리할 수 있어요.` }), closeBtn()];
  else if (b.left <= 0) action = h('p', { class: 'muted small', text: `${b.seats}명을 다 뽑아 모집이 끝났어요.` });
  else if (late) action = h('p', { class: 'muted small', text: `모집 기한(${md(b.until)})이 지났어요.` });
  else action = h('button', { class: 'btn wide' + (endAt == null ? ' primary' : ''), type: 'button', disabled: !!acting, text: busy === 'open' ? '여는 중…' : '모집 열기', onclick: () => setBetaOpen(true) });   // 끝난 모집을 다시 열 때는 회색(정리 단추와 겹치지 않게)
  let tidy = null;
  if (endAt != null && apps.length) {
    const due = endAt + PURGE_AFTER;
    const left = apps.some((a) => a.state !== 'picked' || (a.photos || []).length || a.msg);
    if (!left) tidy = h('p', { class: 'muted small', text: '지난 신청을 정리했어요.' });
    else if (now >= due) tidy = h('div', { class: 'tidy' },
      h('b', { text: '모집이 끝난 지 30일이 지났어요' }),
      h('p', { class: 'small', text: '개인정보처리방침에 적은 대로 지난 신청을 정리해 주세요.' }),
      h('button', { class: 'btn danger wide', type: 'button', disabled: !!acting, text: busy === 'purge' ? '정리하는 중…' : '지난 신청 정리하기', onclick: purgeBeta }));
    else tidy = h('p', { class: 'muted small', text: `${md(due)}부터 지난 신청을 정리할 수 있어요(모집이 끝나고 30일 뒤).` });
  }
  return h('div', { class: 'beta-head' },
    h('div', { class: 'card-top' }, h('b', { class: 'beta-title', text: '추억앨범 베타테스터' }), h('span', { class: 'chip ' + tone, text: stateText })),
    h('div', { class: 'stats' },
      h('p', { class: 'stat' }, h('span', { text: '뽑힘' }), h('b', { text: `${b.picked} / ${b.seats}` })),
      h('p', { class: 'stat' }, h('span', { text: '남은 자리' }), h('b', { text: String(b.left) }))),
    h('p', { class: 'muted small', lines: `모집 기한은 ${md(b.until)}까지예요. 뽑힌 분은 12월 31일까지 무료로 써요.` }),
    action, tidy);
}

function betaCard(a) {
  const [label, tone] = BETA_STATE[a.state] || [a.state, 'gray'];
  const mine = acting?.id === a.id ? acting.kind : '';
  const stamp = a.state === 'picked' && a.decided ? `뽑음 ${when(a.decided)}` : a.state === 'passed' && a.decided ? `넘김 ${when(a.decided)}` : `신청 ${when(a.created)}`;
  let foot = null;
  // 모집 기한(12/31)이 지나면 서버가 뽑기를 받지 않는다 → [뽑기]를 숨기고 [넘기기]만
  const late = S.beta && Date.now() > S.beta.until;
  const passBtn = h('button', { class: 'btn' + (late ? ' wide' : ''), type: 'button', disabled: !!acting, text: mine === 'pass' ? '넘기는 중…' : '넘기기', onclick: () => passBeta(a) });
  if (a.state === 'wait' && late) foot = [h('p', { class: 'muted small', text: '모집 기한이 지나 뽑을 수 없어요.' }), passBtn];
  else if (a.state === 'wait') foot = h('div', { class: 'card-btns' },
    passBtn,
    h('button', { class: 'btn primary', type: 'button', disabled: !!acting, text: mine === 'pick' ? '뽑는 중…' : '뽑기', onclick: () => pickBeta(a) }));
  else if (a.state === 'passed') foot = h('button', { class: 'btn wide', type: 'button', disabled: !!acting, text: mine === 'wait' ? '되돌리는 중…' : '다시 기다림', onclick: () => unpassBeta(a) });
  else if (a.state === 'picked' && a.album && a.label) foot = h('a', { class: 'plan new-album made', href: `https://${a.host || albumHost(a.label)}/`, target: '_blank', rel: 'noopener' }, `앨범 만들었어요 · ${albumHost(a.label)}`);
  // 주소를 아직 안 정한 뽑힌 분(앨범은 그분이 주소를 정하면 생김) · 드물게 다른 길로 이미 앨범이 생긴 분
  else if (a.state === 'picked') foot = h('p', { class: 'plan need-addr', text: a.needAddress === false ? '이미 다른 추억앨범이 있는 분이에요' : '주소를 정하길 기다려요' });
  return h('article', { class: 'card beta-card ' + a.state },
    h('div', { class: 'card-top' }, h('span', { class: 'chip ' + tone, text: label }), h('span', { class: 'muted small', text: stamp })),
    h('div', null,
      h('p', { class: 'who', text: a.spoonNick }),
      h('p', { class: 'muted small', text: `계정 닉네임 ${a.nick || '(없음)'}` })),
    a.label ? h('p', { class: 'addr' }, h('b', { text: albumHost(a.label) }), a.name ? ` · ${a.name}` : '') : null,   // 주소 줄은 주소가 있을 때만
    a.msg ? h('p', { class: 'msg', text: a.msg }) : null,
    shotsRow(a),
    foot);
}

// 첨부 사진 줄(72px 작은 칸) — 누르면 앱 안에서 크게
function shotsRow(a) {
  const list = a.photos || [];
  if (!list.length) return a.state === 'picked' ? null : h('p', { class: 'muted small', text: '첨부 사진이 없어요(정리했거나 불러오지 못했어요).' });
  return h('div', { class: 'shots-wrap' },
    h('p', { class: 'muted small', text: `박제 사진·편지 ${list.length}장${list.length > 4 ? ' · 옆으로 넘겨 보세요' : ''}` }),
    h('div', { class: 'shots', 'data-id': a.id },
      list.map((u, i) => h('button', { class: 'shot', type: 'button', 'aria-label': `${a.spoonNick} 님 첨부 사진 ${i + 1}, 크게 보기`, onclick: () => viewShots(list, i, a.spoonNick) },
        h('img', { loading: 'lazy', decoding: 'async', draggable: 'false', alt: '', src: u, onerror: (e) => e.target.parentNode?.classList.add('broken') })))));
}

// 취소한 신청은 한 줄만(사진은 취소할 때 지워졌어요)
function betaRow(a) {
  return h('article', { class: 'card slim' },
    h('div', { class: 'card-top' }, h('span', { class: 'chip gray', text: '취소' }), h('span', { class: 'muted small', text: a.decided ? when(a.decided) : '' })),
    h('b', { class: 'slim-title', text: a.spoonNick }),
    meta('muted small', [a.label ? albumHost(a.label) : '', `신청 ${when(a.created)}`]));
}

// 사진 크게 보기(앱 안 겹쳐 보기): 바깥·✕·Esc 로 닫기 · ‹ › 또는 옆으로 밀어 다음 사진
function viewShots(list, start, who) {
  let i = start, x0 = null, swiped = false;
  const img = h('img', { class: 'viewer-img', draggable: 'false', alt: '' });
  const count = h('p', { class: 'viewer-count', 'aria-live': 'polite' });
  const prev = h('button', { class: 'viewer-nav prev', type: 'button', 'aria-label': '앞 사진', text: '‹', onclick: () => go(-1) });
  const next = h('button', { class: 'viewer-nav next', type: 'button', 'aria-label': '다음 사진', text: '›', onclick: () => go(1) });
  const stage = h('div', { class: 'viewer-stage' }, img);
  const many = list.length > 1;
  const dlg = h('dialog', { class: 'viewer', 'aria-label': `${who} 님 첨부 사진 크게 보기` },
    h('button', { class: 'viewer-close', type: 'button', 'aria-label': '닫기', text: '✕', onclick: () => dlg.close() }),
    stage, many ? h('div', { class: 'viewer-bar' }, prev, count, next) : null);
  function show() {
    img.src = list[i];
    img.alt = `${who} 님 첨부 사진 ${i + 1}`;
    count.textContent = `${i + 1} / ${list.length}`;
    prev.disabled = i === 0; next.disabled = i === list.length - 1;
  }
  function go(d) { const n = i + d; if (n >= 0 && n < list.length) { i = n; show(); } }
  dlg.addEventListener('click', (e) => { if (swiped) { swiped = false; return; } if (e.target === dlg || e.target === stage || e.target.classList.contains('viewer-bar')) dlg.close(); });
  dlg.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1); });
  stage.addEventListener('pointerdown', (e) => { x0 = e.clientX; swiped = false; });
  stage.addEventListener('pointerup', (e) => { if (x0 != null && many && Math.abs(e.clientX - x0) > 50) { swiped = true; go(e.clientX < x0 ? 1 : -1); } x0 = null; });
  dlg.addEventListener('close', () => dlg.remove());
  show();
  document.body.append(dlg);
  dlg.showModal();
}

// 처리 하나(두 번 누르기 막기) → 끝나면 목록 다시 불러오기
//  처리하는 사이 떠 있던 목록 요청(1분마다 새로 불러오기 등)은 처리 전 목록일 수 있어 끝나길 기다린 뒤 한 번 더 부른다(옛 목록이 다시 그려지지 않게)
async function betaAct(id, kind, job) {
  if (acting) return;
  acting = { id, kind }; render();
  try { await job(); } catch (err) { toast(err.message, true); }
  acting = null;
  if (betaLoading) await betaLoading;
  await loadBeta();
  render();
}
async function pickBeta(a) {
  if (acting) return;
  // 주소가 없는 신청(쉬운 신청)은 이용권만 바로 · 앨범은 뽑힌 분이 주소를 정할 때
  const yes = await ask({ title: `${a.spoonNick} 님을 뽑을까요?`, ok: '뽑기', cancel: '아직',
    lines: a.label ? [`앨범 ${albumHost(a.label)} 이 바로 만들어지고 12월 31일까지 무료예요.`, `앨범 이름: ${a.name}`]
      : [`12월 31일까지 무료 이용권이 바로 생기고, 앨범은 ${a.spoonNick} 님이 주소를 정하면 만들어져요.`] });
  if (!yes) return;
  await betaAct(a.id, 'pick', async () => {
    const j = await beta('ops-pick', { id: a.id });
    toast(`${a.spoonNick} 님을 뽑았어요 · ${j.closed ? '자리가 다 차서 모집을 닫았어요' : `남은 자리 ${j.left}`}`);
  });
}
async function passBeta(a) {
  await betaAct(a.id, 'pass', async () => { await beta('ops-pass', { id: a.id }); toast(`${a.spoonNick} 님 신청을 넘겼어요`); });
}
async function unpassBeta(a) {
  await betaAct(a.id, 'wait', async () => { await beta('ops-wait', { id: a.id }); toast('기다림으로 되돌렸어요'); });
}
async function setBetaOpen(open) {
  if (acting) return;
  const b = S.beta;
  const yes = await ask(open
    ? { title: '베타테스터 모집을 열까요?', ok: '모집 열기', lines: ['먼치킨.com/album 에서 신청을 받기 시작해요.', `남은 자리 ${b.left}명 · 모집 기한 ${md(b.until)}`] }
    : { title: '베타테스터 모집을 닫을까요?', ok: '모집 닫기', lines: ['새 신청을 더 받지 않아요.', '들어온 신청은 그대로 남아서 뽑을 수 있어요.'] });
  if (!yes) return;
  await betaAct('head', 'open', async () => {
    const j = await beta('ops-open', { open });
    if (open && !j.open) toast('모집을 열지 못했어요 · 자리가 다 찼거나 기한이 지났어요', true);
    else toast(j.open ? '모집을 열었어요' : '모집을 닫았어요');
  });
}
async function purgeBeta() {
  if (acting) return;
  const yes = await ask({ title: '지난 신청을 정리할까요?', danger: true, ok: '정리하기', cancel: '닫기',
    lines: ['뽑히지 않은 신청과 모든 첨부 사진을 지워요. 되돌릴 수 없어요.', '디스코드 DM 의 베타 신청 알림도 지워 주세요.'] });
  if (!yes) return;
  await betaAct('head', 'purge', async () => {
    const j = await beta('ops-purge');
    toast(typeof j.removed === 'number' ? `정리했어요 · 사진 ${j.removed}장을 지웠어요` : '정리했어요');
  });
}

function settingsView() {
  const wrap = h('section', { class: 'settings' });
  // 알림
  const perm = pushReady() ? Notification.permission : 'unsupported';
  const devs = S.devices;
  const mine = ls.get('ops_push_id');
  wrap.append(h('h2', { text: '알림' }),
    h('div', { class: 'group' },
      h('p', { class: 'small', lines: !pushReady() ? (isIOS() && !standalone() ? '홈 화면에 추가한 앱에서만 알림을 켤 수 있어요.' : '이 기기에서는 알림을 쓸 수 없어요.')
        : perm === 'granted' ? 'DJ가 "입금했어요"를 누르거나 운영자 메시지를 확인하면 이 폰으로 알림이 와요.'
        : perm === 'denied' ? '알림이 꺼져 있어요. 아이폰 설정 › 알림 › 입금 확인 에서 켜 주세요.'
        : '알림을 켜면 DJ가 입금했을 때 바로 알려 드려요.' }),
      pushReady() && perm !== 'denied' ? h('button', { class: 'btn primary wide', type: 'button', text: perm === 'granted' && mine ? '알림 다시 연결' : '알림 켜기', onclick: () => enablePush(true) }) : null,
      perm === 'granted' && mine ? h('button', { class: 'btn wide', type: 'button', text: '시험 알림 보내기', onclick: testPush }) : null),
    h('h2', { text: '알림 받는 기기' }),
    h('div', { class: 'group' },
      !devs ? h('p', { class: 'muted small', text: '불러오는 중이에요…' })
        : !devs.length ? h('p', { class: 'muted small', text: '아직 없어요.' })
        : devs.map((d) => h('div', { class: 'dev' },
          h('div', { class: 'dev-text' }, h('b', { text: d.label + (d.id === mine ? ' (이 폰)' : '') }), meta('muted small', [`연결 ${ymd(d.created)}`, d.ok ? '마지막 알림 ' + when(d.ok) : ''])),
          h('button', { class: 'btn small', type: 'button', text: '지우기', 'aria-label': `${d.label} 지우기`, onclick: () => removeDevice(d) }))),
      h('p', { class: 'muted small', lines: '폰을 바꾸면: 새 폰에서 이 앱을 다시 홈 화면에 추가 → 로그인 → 알림 켜기. 예전 폰은 여기서 지우면 돼요(앱을 지운 폰은 저절로 빠져요).' })));
  // 계좌·가격
  const b = S.data?.billing;
  if (b) {
    const f = (label, name, value, type = 'text') => h('label', { class: 'f' }, h('span', { text: label }), h('input', { class: 'field', name, value: value ?? '', type, inputmode: type === 'number' ? 'numeric' : null }));
    const form = h('form', { class: 'group', onsubmit: async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form));
      const n = (k) => Number(v[k] || 0);
      try {
        await bill('ops-billing', { bank: v.bank, number: v.number, holder: v.holder,
          prices: { munchkin: n('pm'), album: n('pa'), bundle: n('pb') }, year: { munchkin: n('ym'), album: n('ya'), bundle: n('yb') } });
        toast('저장했어요'); await load();
      } catch (err) { toast(err.message, true); }
    } },
      f('은행', 'bank', b.bank), f('계좌번호', 'number', b.number), f('예금주', 'holder', b.holder),
      h('p', { class: 'muted small', text: '한 달 값(0이면 "준비 중")' }),
      h('div', { class: 'grid3' }, f('먼치킨', 'pm', b.prices.munchkin, 'number'), f('추억앨범', 'pa', b.prices.album, 'number'), f('둘 다', 'pb', b.prices.bundle, 'number')),
      h('p', { class: 'muted small', text: '1년 한 번에(비우면 한 달 값 × 12)' }),
      h('div', { class: 'grid3' }, f('먼치킨', 'ym', b.year.munchkin || '', 'number'), f('추억앨범', 'ya', b.year.album || '', 'number'), f('둘 다', 'yb', b.year.bundle || '', 'number')),
      h('button', { class: 'btn primary wide', type: 'submit', text: '계좌·가격 저장' }));
    wrap.append(h('h2', { text: '계좌·가격' }), form);
  }
  wrap.append(h('h2', { text: '계정' }),
    h('div', { class: 'group' },
      h('p', { class: 'small', text: S.me ? `${S.me.nickname || ''}${S.me.loginId ? ' · ' + S.me.loginId : ''}` : '' }),
      h('button', { class: 'btn wide', type: 'button', text: '이 폰에서 로그아웃', onclick: logoutHere })));
  if (!devs) loadDevices();
  return wrap;
}

// ---------- 회원 · 먼치킨 엠베서더(2026-11-28, bakje-billing ops-members · ops-amb) ----------
// 사용자 "디제이 몇 명을 뽑아 먼치킨 엠베서더 — 먼치킨도 추억앨범도 전부 무료". 운영자가 이 탭에서 [엠베서더 주기]·[풀기].
//  엠베서더인 동안: 먼치킨·송출 이용권이 늘 있고, 가진 추억앨범은 결제 끝나는 날이 지나도 쓴다. 앨범이 없으면 먼치킨.com/album 내 정보에서 바로 만든다.
//  풀면 그 자리에서 보통 회원과 같아진다(산 이용권·앨범·글은 그대로). 비밀번호·카카오 번호·본인인증 값은 서버가 보내지 않는다.
const HOW = { kakao: '카카오', id: '아이디', both: '카카오 + 아이디' };
const M_FILTER = [['all', '전체'], ['amb', '엠베서더'], ['dj', 'DJ'], ['listener', '리스너']];
// 보이는 이름: 먼치킨 닉네임 → 없으면(카카오로 가입하며 안 정함) 이어진 먼치킨의 스푼 닉네임 → 그래도 없으면 (닉네임 없음) — 11/28 밤 사용자 "왜 긴새벽이 없지"
const spoonOf = (m) => (Array.isArray(m.spoon) ? m.spoon.filter((s) => s && (s.nick || s.tag)) : []);
const mNick = (m) => m.nick || spoonOf(m)[0]?.nick || '(닉네임 없음)';
const spoonText = (s) => [s.nick, s.tag ? '@' + s.tag : ''].filter(Boolean).join(' ');
// 찾기: 먼치킨 닉네임·스푼 닉네임·스푼 태그에서, 빈칸·꾸밈 글자는 빼고("긴새벽" 으로 "긴 새벽⸝⸝ ☾" 도 찾게)
const plain = (v) => String(v || '').toLowerCase().replace(/[^0-9a-z가-힣ㄱ-ㅎㅏ-ㅣ]+/g, '');
const mHit = (m, q) => !q || [m.nick, ...spoonOf(m).flatMap((s) => [s.nick, s.tag])].some((v) => plain(v).includes(q));
const recent = (ms) => Number(ms) > Date.now() - 7 * 86400000;
function membersView() {
  // 순서(11/28 밤 사용자 "최근 봇 사용순서대로"): 봇을 마지막으로 쓴 때(서버 botSeen — 없으면 0) → 같으면 최근 접속 → 가입
  const list = S.members && [...S.members].sort((a, b) => (Number(b.botSeen) || 0) - (Number(a.botSeen) || 0) || (Number(b.seen) || 0) - (Number(a.seen) || 0) || (Number(b.created) || 0) - (Number(a.created) || 0));
  if (!list) return S.membersErr
    ? h('div', { class: 'empty' }, h('p', { text: S.membersErr }), h('button', { class: 'link', type: 'button', text: '다시 불러오기', onclick: () => loadMembers().then(render) }))
    : h('p', { class: 'empty', text: '불러오는 중이에요…' });
  const amb = list.filter((m) => m.amb).length;
  const search = h('input', { class: 'field', type: 'search', placeholder: '닉네임·스푼 닉네임으로 찾기', value: S.mQuery, 'aria-label': '닉네임·스푼 닉네임으로 찾기', autocomplete: 'off', enterkeyhint: 'search', 'data-keep': 'm-search' });
  // 쓰는 동안 목록만 바꾼다(입력 칸을 다시 그리지 않아 글자가 끊기지 않게)
  search.addEventListener('input', () => { S.mQuery = search.value; const box = app.querySelector('.members .list'); if (box) box.replaceWith(memberList()); });
  const seg = h('nav', { class: 'seg small-seg', 'aria-label': '회원 고르기' }, M_FILTER.map(([k, label]) => h('button', { type: 'button', class: S.mFilter === k ? 'on' : '', 'aria-pressed': String(S.mFilter === k),
    onclick: () => { S.mFilter = k; render(); } }, label)));
  function memberList() {
    const qq = plain(S.mQuery);
    const rows = list.filter((m) => (S.mFilter === 'all' || (S.mFilter === 'amb' ? m.amb : m.role === S.mFilter)) && mHit(m, qq));
    return rows.length ? h('div', { class: 'list' }, rows.map(memberCard)) : h('div', { class: 'list' }, h('p', { class: 'empty', text: S.mFilter === 'amb' && !qq ? '아직 엠베서더가 없어요.' : '맞는 회원이 없어요.' }));
  }
  return h('section', { class: 'members' },
    h('div', { class: 'beta-head' },
      h('b', { class: 'beta-title', text: '먼치킨 계정' }),
      h('div', { class: 'stats three' },
        h('div', { class: 'stat' }, h('span', { text: '모든 회원' }), h('b', { text: String(list.length) })),
        h('div', { class: 'stat' }, h('span', { text: '최근 7일' }), h('b', { text: String(list.filter((m) => recent(m.seen)).length) })),
        h('div', { class: 'stat' }, h('span', { text: '엠베서더' }), h('b', { text: String(amb) }))),
      h('p', { class: 'muted small', lines: '엠베서더는 먼치킨·추억앨범·송출을 모두 무료로 써요. 언제든 풀 수 있어요.' }),
      seg, search),
    memberList());
}
// 회원 한 장(11/28 휴대폰 정리): 이름·표시 → 스푼 → 정보 두 줄 → [메시지] [엠베서더] 나란히(조용한 단추 — 예전엔 카드마다 큰 파란 단추)
function memberCard(m) {
  const busy = acting?.id === m.id;
  const uses = [m.bot ? '봇' : '', m.studio ? '송출' : ''].filter(Boolean);
  const ent = (k, name) => (m.ents?.[k] > Date.now() ? `${name} ${ymd(m.ents[k])}까지` : '');
  const ents = [ent('munchkin', '먼치킨'), ent('album', '추억앨범')].filter(Boolean);
  const msgBtn = h('button', { class: 'btn', type: 'button', 'aria-label': `${mNick(m)}님에게 메시지 보내기`, onclick: () => composeMsg(m) }, icon('msgs'), ' 메시지');
  let amb = null;
  if (m.admin) amb = null;   // 운영자는 엠베서더 단추 없음(아래 안내 한 줄) — [메시지]만 한 줄 가득
  else if (m.amb) amb = h('button', { class: 'btn', type: 'button', disabled: !!acting, text: busy ? '푸는 중…' : '엠베서더 풀기', onclick: () => setAmb(m, false) });
  else amb = h('button', { class: 'btn tonal', type: 'button', disabled: !!acting, text: busy ? '주는 중…' : '엠베서더 주기', onclick: () => setAmb(m, true) });
  return h('article', { class: 'card member' + (m.amb ? ' sent' : '') },
    h('div', { class: 'card-top' },
      h('b', { class: 'who-s', text: mNick(m) }),
      m.admin ? h('span', { class: 'chip blue', text: '운영자' }) : m.amb ? h('span', { class: 'chip green', text: '🎖️ 엠베서더' }) : h('span', { class: 'chip gray', text: m.role === 'dj' ? 'DJ' : '리스너' })),
    spoonOf(m).length ? h('p', { class: 'small spoon' }, h('span', { class: 'muted', text: '스푼 ' }), spoonOf(m).map(spoonText).join(' · '), m.nick ? '' : h('span', { class: 'muted', text: ' (먼치킨 닉네임 안 정함)' })) : null,
    meta('muted small', [HOW[m.how] || '—', `${md(m.created)} 가입`, m.botSeen ? '봇 ' + when(m.botSeen) : '최근 ' + (m.seen ? when(m.seen) : '—')]),
    meta('small', [uses.length ? `${uses.join('·')} 씀` : '프로그램 안 씀', m.albums ? `추억앨범 ${m.albums}개` : '추억앨범 없음']),
    ents.length ? meta('muted small', ents.map((t, i) => (i ? t : '이용권 ' + t))) : null,
    m.admin ? h('p', { class: 'muted small', text: '운영자 계정은 늘 무료예요.' }) : null,
    m.amb ? h('p', { class: 'plan new-album', text: `🎖️ ${md(m.amb.since)}부터 엠베서더${m.amb.note ? ' · ' + m.amb.note : ''}` }) : null,
    m.state === 'banned' ? h('p', { class: 'error', text: '이용이 막힌 계정이에요.' }) : null,
    h('div', { class: 'card-btns' + (amb ? ' even' : ' one') }, msgBtn, amb));
}
async function setAmb(m, on) {
  const nick = mNick(m);
  const note = on
    ? await ask({ title: `${nick}님을 먼치킨 엠베서더로 할까요?`, ok: '엠베서더 주기', input: '메모(운영자만 봐요, 비워도 돼요)',
      lines: ['엠베서더인 동안 먼치킨·추억앨범·송출을 모두 무료로 써요.', '추억앨범이 없으면 먼치킨.com/album 내 정보에서 바로 만들 수 있어요.', '언제든 풀 수 있어요.'] })
    : await ask({ title: `${nick}님의 엠베서더를 풀까요?`, ok: '풀기', danger: true,
      lines: ['풀면 바로 보통 회원과 같아져요. 1월 1일부터는 이용권이 있어야 먼치킨·송출을 쓰고, 추억앨범은 결제 끝나는 날이 지나면 보기만 돼요.', '산 이용권·만든 앨범·글은 그대로 남아요.'] });
  if (note == null) return;
  acting = { id: m.id, kind: on ? 'give' : 'take' };
  render();
  try {
    const j = await bill('ops-amb', { member: m.id, on, ...(on && note ? { note } : {}) });
    const i = S.members.findIndex((x) => x.id === m.id);
    if (i >= 0 && j.member) S.members[i] = j.member;
    toast(on ? `${nick}님을 엠베서더로 했어요` : `${nick}님의 엠베서더를 풀었어요`);
  } catch (err) { toast(err.message, true); }
  finally { acting = null; render(); }
}
let membersLoading = null;
function loadMembers() {
  if (!S.session) return Promise.resolve(false);
  if (membersLoading) return membersLoading;
  membersLoading = (async () => {
    try { S.members = (await bill('ops-members')).members || []; S.membersErr = ''; return true; }
    catch (err) { S.membersErr = err.message; if (S.tab === 'mem' && err.status !== 401) toast(err.message, true); return false; }
    finally { membersLoading = null; }
  })();
  return membersLoading;
}

// ---------- 운영자 메시지(2026-11-28, bakje-billing ops-msg-send · ops-msgs · ops-msg-del) ----------
// 사용자 "먼치킨 쓰는 사람들한테 개인적으로 봇에 메세지 … 그 사람이 확인하기 누르면 나한테 확인했음 하고 뜨게". 답장은 없다.
//  회원 카드 [메시지] → 아래에서 올라오는 쓰기 칸(1~500자, 줄바꿈 됨) → 보내기. DJ 봇(0.24.2+)은 5분마다 보내는 상태 한 줄의 답으로 받는다.
//  "메시지" 탭 = 최근 7일 보낸 것(새것부터): 아직 안 닿음(delivered 없음) · 봇에 닿음 · ✅ 확인(seen). DJ 가 확인하면 운영자 폰에 알림(누르면 /ops/#msgs).
const MSG_MAX = 500;
function msgState(x) {
  if (x.seen) return [`✅ 확인 ${mdhm(x.seen)}`, 'green'];
  if (x.delivered) return ['봇에 닿음', 'blue'];
  return ['아직 안 닿음', 'gray'];
}
// 쓰기 칸(아래에서 올라옴). 쓰던 글은 닫아도 회원마다 남겨 둔다(보내면 지움).
function composeMsg(m) {
  const nick = mNick(m);
  const area = h('textarea', { class: 'field msg-area', rows: '6', maxlength: String(MSG_MAX), placeholder: '보낼 글을 써 주세요.\n줄바꿈도 돼요.', 'aria-label': `${nick}님에게 보낼 글` });
  area.value = S.drafts[m.id] || '';
  const left = h('p', { class: 'msg-count muted small', 'aria-live': 'polite' });
  const send = h('button', { class: 'btn primary', type: 'submit', text: '보내기' });
  const cancel = h('button', { class: 'btn', type: 'button', text: '닫기', onclick: () => dlg.close() });
  let sending = false;
  const sync = () => {
    const n = area.value.length;
    left.textContent = `남은 글자 ${MSG_MAX - n}`;
    left.classList.toggle('warn', MSG_MAX - n <= 20);
    send.disabled = sending || !area.value.trim();
    S.drafts[m.id] = area.value;
  };
  area.addEventListener('input', sync);
  const form = h('form', { class: 'sheet-form', onsubmit: async (e) => {
    e.preventDefault();
    const body = area.value.trim();
    if (!body || sending) return;
    sending = true; send.textContent = '보내는 중…'; sync(); area.readOnly = true;
    try {
      const j = await bill('ops-msg-send', { member: m.id, body: area.value });
      delete S.drafts[m.id];
      // 메시지 탭 목록에 바로 더함(이름이 안 왔으면 카드의 이름) — 메시지 탭을 열면 서버에서 새로 받는다
      if (S.msgs && j.msg) S.msgs = [{ name: nick, member: m.id, created: Date.now(), delivered: null, seen: null, ...j.msg }, ...S.msgs.filter((x) => x.id !== j.msg.id)];
      dlg.close();
      toast(`${nick}님에게 보냈어요 · 메시지 탭에서 확인했는지 볼 수 있어요`);
      if (S.tab === 'msgs') render();
    } catch (err) {
      toast(err.message, true);   // 쓴 글은 그대로 남는다
      sending = false; send.textContent = '보내기'; area.readOnly = false; sync();
    }
  } },
    h('h2', { text: `${nick}님에게 메시지` }),
    h('p', { class: 'muted small', lines: '먼치킨 봇 화면에 창으로 떠요. DJ가 [확인했어요]를 누르면 알려 드려요.' }),
    m.bot ? null : h('p', { class: 'msg-warn small', lines: '이 회원은 아직 먼치킨 봇에 로그인하지 않았어요. 봇에 로그인하면 보여요.' }),
    area, left,
    h('div', { class: 'sheet-btns' }, cancel, send));
  const dlg = h('dialog', { class: 'sheet up', 'aria-label': `${nick}님에게 메시지 보내기` }, form);
  // 휴대폰 글자판이 올라오면 쓰기 칸도 그 위로(아이폰 홈 화면 앱은 화면 아래 칸을 글자판이 가린다)
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    dlg.style.bottom = kb + 'px';
    dlg.style.maxHeight = Math.max(240, vv.height - 12) + 'px';
  };
  vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit);
  dlg.addEventListener('click', (e) => { if (e.target === dlg && !sending) dlg.close(); });   // 바깥(어두운 곳)을 누르면 닫기
  dlg.addEventListener('cancel', (e) => { if (sending) e.preventDefault(); });
  dlg.addEventListener('close', () => { vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); dlg.remove(); });
  document.body.append(dlg);
  sync(); fit();
  dlg.showModal();
  area.focus({ preventScroll: true });
}

function msgsView() {
  const list = S.msgs;
  if (!list) return S.msgsErr
    ? h('div', { class: 'empty' }, h('p', { text: S.msgsErr }), h('button', { class: 'link', type: 'button', text: '다시 불러오기', onclick: () => loadMsgs().then(render) }))
    : h('p', { class: 'empty', text: '불러오는 중이에요…' });
  const seen = list.filter((x) => x.seen).length, notYet = list.filter((x) => !x.delivered).length;
  return h('section', { class: 'msgs' },
    h('div', { class: 'beta-head' },
      h('b', { class: 'beta-title', text: '최근 7일 보낸 메시지' }),
      h('div', { class: 'stats three' },
        h('div', { class: 'stat' }, h('span', { text: '보냄' }), h('b', { text: String(list.length) })),
        h('div', { class: 'stat' }, h('span', { text: '확인함' }), h('b', { text: String(seen) })),
        h('div', { class: 'stat' }, h('span', { text: '아직 안 닿음' }), h('b', { text: String(notYet) }))),
      h('p', { class: 'muted small', lines: '회원 탭에서 회원 카드의 [메시지]를 눌러 보내요. DJ가 확인하면 알림이 와요.' }),
      h('button', { class: 'btn wide', type: 'button', text: '회원 고르러 가기', onclick: () => go('mem') })),
    list.length ? h('div', { class: 'list' }, list.map(msgCard))
      : h('div', { class: 'empty' }, h('p', { lines: '최근 7일 동안 보낸 메시지가 없어요.' })));
}
function msgCard(x) {
  const [label, tone] = msgState(x);
  const busy = acting?.id === 'msg' + x.id;
  return h('article', { class: 'card msg-card' + (x.seen ? ' sent' : '') },
    h('div', { class: 'card-top' }, h('b', { class: 'who-s', text: x.name || 'DJ' }), h('span', { class: 'chip ' + tone, text: label })),
    h('p', { class: 'msg', text: x.body }),   // 운영자가 쓴 글 그대로(줄바꿈 그대로)
    h('div', { class: 'slim-row' },
      meta('muted small', [`보냄 ${when(x.created)}`, !x.delivered ? '먼치킨을 켜면 떠요' : !x.seen ? '아직 확인 전' : '']),
      h('button', { class: 'btn small', type: 'button', disabled: !!acting, text: busy ? '지우는 중…' : '지우기', 'aria-label': `${x.name || 'DJ'}님에게 보낸 메시지 지우기`, onclick: () => delMsg(x) })));
}
async function delMsg(x) {
  if (acting) return;
  const yes = await ask({ title: '이 메시지를 지울까요?', ok: '지우기', danger: true, cancel: '닫기',
    lines: [`${x.name || 'DJ'}님에게 ${when(x.created)} 보낸 메시지예요.`, 'DJ 봇의 알림칸에서도 사라져요. 되돌릴 수 없어요.'] });
  if (!yes) return;
  acting = { id: 'msg' + x.id, kind: 'del' };
  render();
  try {
    await bill('ops-msg-del', { id: x.id });
    if (S.msgs) S.msgs = S.msgs.filter((y) => y.id !== x.id);
    toast('메시지를 지웠어요');
  } catch (err) { toast(err.message, true); }
  finally { acting = null; render(); }
}
let msgsLoading = null;
function loadMsgs() {
  if (!S.session) return Promise.resolve(false);
  if (msgsLoading) return msgsLoading;
  msgsLoading = (async () => {
    try {
      const list = (await bill('ops-msgs')).msgs || [];
      S.msgs = [...list].sort((a, b) => Number(b.created) - Number(a.created)); S.msgsErr = '';
      return true;
    } catch (err) { S.msgsErr = err.message; if (S.tab === 'msgs' && err.status !== 401) toast(err.message, true); return false; }
    finally { msgsLoading = null; }
  })();
  return msgsLoading;
}

// ---------- 데이터 ----------
let loading = null;
async function load(manual = false) {
  if (!S.session) return render();
  if (loading) return loading;
  loading = (async () => {
    // 베타 신청은 베타 탭을 볼 때(와 처음 한 번 — 탭 글의 기다림 수) 함께 불러온다
    const withBeta = S.tab === 'beta' || !S.beta;
    const [ok, betaOk] = await Promise.all([
      (async () => {
        try { S.data = await bill('ops-orders'); setBadge(); return true; }
        catch (err) { if (err.status !== 401) toast(err.message, true); return false; }
      })(),
      withBeta ? loadBeta() : true,
      S.tab === 'mem' ? loadMembers() : true,
      S.tab === 'msgs' ? loadMsgs() : true]);
    if (manual && ok && betaOk) toast('새로 불러왔어요');
    loading = null;
    render();
  })();
  return loading;
}
// 베타 신청 목록(ops-list). 베타 탭이 아닐 때 실패하면 조용히(탭 글 숫자만 안 나옴)
let betaLoading = null;
function loadBeta() {
  if (!S.session) return Promise.resolve(false);
  if (betaLoading) return betaLoading;
  betaLoading = (async () => {
    try {
      const j = await beta('ops-list');
      for (const a of j.apps || []) a.photos = (a.photos || []).map(steadyUrl);
      const old = Date.now() - 60 * 60000;
      for (const [k, v] of shotUrls) if (v.at < old) shotUrls.delete(k);
      S.beta = j; S.betaErr = '';
      return true;
    } catch (err) {
      S.betaErr = err.message;
      if (S.tab === 'beta' && err.status !== 401) toast(err.message, true);
      return false;
    } finally { betaLoading = null; }
  })();
  return betaLoading;
}
function setBadge() {
  const n = (S.data?.waiting || []).filter((o) => o.sent).length;
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch {}
}
async function loadDevices() {
  try { S.devices = (await bill('push-list')).devices; } catch { S.devices = []; }
  if (S.tab === 'set') render();
}
function signOut() {
  S.session = null; S.me = null; S.data = null; S.devices = null; S.beta = null; S.betaErr = ''; S.members = null; S.membersErr = ''; S.msgs = null; S.msgsErr = ''; S.drafts = {};
  ls.set('ops_session', null);
  render();
}
async function logoutHere() {
  if (!await ask({ title: '이 폰에서 로그아웃할까요?', lines: ['이 폰으로 오던 입금 알림도 멈춰요.'], ok: '로그아웃', danger: true })) return;
  const mine = ls.get('ops_push_id');
  if (mine) { try { await bill('push-del', { id: mine }); } catch {} ls.set('ops_push_id', null); }
  try { const reg = await navigator.serviceWorker?.getRegistration(); await (await reg?.pushManager.getSubscription())?.unsubscribe(); } catch {}
  signOut();
}

// ---------- 푸시 ----------
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
function deviceLabel() {
  const ua = navigator.userAgent;
  const name = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android 폰' : '컴퓨터';
  const d = new Date();
  return `${name} · ${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} 연결`;
}
async function register() {
  if (!pushReady()) return null;
  return navigator.serviceWorker.register('sw.js', { scope: './' });
}
async function enablePush(fromTap) {
  if (!pushReady()) return toast(isIOS() && !standalone() ? '홈 화면에 추가한 앱에서 알림을 켤 수 있어요' : '이 기기에서는 알림을 쓸 수 없어요', true);
  try {
    const perm = Notification.permission === 'granted' ? 'granted' : fromTap ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') { if (fromTap) toast('알림이 허용되지 않았어요. 아이폰 설정 › 알림에서 켤 수 있어요', true); render(); return; }
    await register();
    const reg = await navigator.serviceWorker.ready;
    const { key } = await bill('push-key');
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const cur = sub.options?.applicationServerKey;
      const same = cur && btoa(String.fromCharCode(...new Uint8Array(cur))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === key;
      if (!same) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(key) });
    const j = await bill('push-add', { sub: sub.toJSON(), label: ls.get('ops_push_label') || deviceLabel() });
    if (!ls.get('ops_push_label')) ls.set('ops_push_label', deviceLabel());
    ls.set('ops_push_id', j.id);
    if (fromTap) toast('알림을 켰어요');
    S.devices = null;
    render();
  } catch (err) { if (fromTap) toast(err.message || '알림을 켜지 못했어요', true); }
}
// 앱을 열 때마다: 이미 허용했으면 조용히 다시 연결(서버 기록이 없어졌거나 폰을 바꾼 경우 대비)
function syncPush() { if (pushReady() && Notification.permission === 'granted') enablePush(false); }
async function testPush() {
  try { const j = await bill('push-test'); toast(j.sent ? `알림을 보냈어요(${j.sent}대)` : '받을 기기가 없어요. "알림 다시 연결"을 눌러 주세요', !j.sent); }
  catch (err) { toast(err.message, true); }
}
async function removeDevice(d) {
  if (!await ask({ title: '이 기기를 지울까요?', lines: [d.label, '이 기기로는 입금 알림이 더 오지 않아요.'], ok: '지우기', danger: true })) return;
  try { await bill('push-del', { id: d.id }); if (d.id === ls.get('ops_push_id')) ls.set('ops_push_id', null); S.devices = null; render(); }
  catch (err) { toast(err.message, true); }
}

// ---------- 시작 ----------
async function start() {
  register().catch(() => {});
  render();
  if (!S.session) return;
  try { S.me = (await call('bakje/member', { action: 'me' })).member; } catch {}   // 로그인 유지(60일씩 늘어남)
  await load();
  syncPush();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.session) load(); });
// 서비스 워커: 'refresh' = 새 알림이 옴 · { open: '#msgs' } = 알림을 눌렀음(앱이 이미 열려 있을 때 — 그 화면으로)
navigator.serviceWorker?.addEventListener('message', (e) => {
  const d = e.data;
  if (d && typeof d === 'object' && typeof d.open === 'string') { const k = d.open.replace(/^#/, ''); if (Object.hasOwn(TABS, k) && S.session) go(k); return; }
  if (d === 'refresh' && S.session) load();
});
setInterval(() => { if (document.visibilityState === 'visible' && S.session) load(); }, 60000);
start();
