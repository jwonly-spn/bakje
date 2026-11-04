// 추억앨범 · 입금 확인(운영자 앱) — 아이폰 홈 화면에 추가해서 쓴다. 푸시 알림은 홈 화면 앱에서만 된다(iOS 16.4+).
// 서버: bakje(회원 로그인) · bakje-billing(입금 목록·확인·알림 기기). 세션은 이 앱 저장소(localStorage)에만.
'use strict';
const SB = 'https://aksegkhhugqvvaidgvro.supabase.co/functions/v1/';
const PLAN = { munchkin: '먼치킨', album: '추억앨범', bundle: '먼치킨 + 추억앨범', 'add-album': '추억앨범 추가', 'add-munchkin': '먼치킨 추가' };
const STATE = { paid: '확인함', rejected: '거절함', canceled: 'DJ가 취소', pending: '기다림' };
const app = document.getElementById('app');
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
};
const S = { session: ls.get('ops_session'), me: null, tab: 'wait', data: null, busy: false, devices: null };

// ---------- 작은 도구 ----------
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') el.textContent = v;
    else if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}
const won = (n) => Number(n || 0).toLocaleString('ko-KR') + '원';
const day = (ms) => { const d = new Date(Number(ms)); return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; };
const when = (ms) => {
  const s = Math.round((Date.now() - Number(ms)) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  const d = new Date(Number(ms));
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const period = (o) => (o.months ? (o.months === 12 ? '1년' : o.months + '개월') : `${day(o.until_to)}까지`);
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

// 확인 창(<dialog>)
function ask({ title, lines = [], ok = '확인', cancel = '취소', danger = false, input = null }) {
  return new Promise((resolve) => {
    const field = input ? h('input', { class: 'field', type: 'text', placeholder: input, maxlength: '200' }) : null;
    const dlg = h('dialog', { class: 'sheet' },
      h('h2', { text: title }),
      ...lines.map((l) => h('p', { text: l })),
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
  app.replaceChildren();
  if (!standalone() && isIOS() && !ls.get('ops_skip_install')) return app.append(installView());
  if (!S.session) return app.append(loginView());
  app.append(header(), tabs(), S.tab === 'wait' ? waitView() : S.tab === 'done' ? doneView() : settingsView());
}

function installView() {
  return h('section', { class: 'install' },
    h('img', { class: 'app-icon', src: 'icon-180.png', alt: '' }),
    h('h1', { text: '입금 확인 앱 설치' }),
    h('p', { class: 'muted', text: '홈 화면에 추가해야 입금 알림(푸시)을 받을 수 있어요. 스토어에서 받지 않아도 돼요.' }),
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
    h('p', { class: 'muted', text: '추억앨범 운영자 계정으로 로그인해 주세요.' }),
    id, pw, msg, btn);
  return form;
}

function header() {
  const n = (S.data?.waiting || []).filter((o) => o.sent).length;
  return h('header', { class: 'top' },
    h('div', null, h('h1', { text: '입금 확인' }), h('p', { class: 'muted small', text: S.me ? `${S.me.nickname || '운영자'} · 운영자` : '' })),
    h('button', { class: 'round', type: 'button', 'aria-label': '새로 고침', onclick: () => load(true) }, h('span', { class: S.busy ? 'spin' : '', text: '↻' })),
    n ? h('span', { class: 'sr-only', text: `입금했다고 한 신청 ${n}개` }) : null);
}

function tabs() {
  const n = (S.data?.waiting || []).length;
  const tab = (key, label) => h('button', { type: 'button', class: S.tab === key ? 'on' : '', 'aria-pressed': String(S.tab === key), onclick: () => { S.tab = key; render(); } }, label);
  return h('nav', { class: 'seg' }, tab('wait', `확인할 것${n ? ' ' + n : ''}`), tab('done', '처리한 것'), tab('set', '설정'));
}

function waitView() {
  if (!S.data) return h('p', { class: 'empty', text: '불러오는 중이에요…' });
  const list = [...S.data.waiting].sort((a, b) => (b.sent ? 1 : 0) - (a.sent ? 1 : 0) || (a.sent || a.created) - (b.sent || b.created));
  if (!list.length) return h('div', { class: 'empty' }, h('p', { class: 'big', text: '✓' }), h('p', { text: '확인할 입금이 없어요.' }));
  return h('section', { class: 'list' }, list.map(orderCard));
}

function orderCard(o) {
  return h('article', { class: 'card' + (o.sent ? ' sent' : '') },
    h('div', { class: 'card-top' },
      h('span', { class: 'chip ' + (o.sent ? 'green' : 'gray'), text: o.sent ? `입금했어요 · ${when(o.sent)}` : `신청만 함 · ${when(o.created)}` }),
      h('span', { class: 'muted small', text: o.nick || '(닉네임 없음)' })),
    h('p', { class: 'amount', text: won(o.amount) }),
    h('button', { class: 'payer', type: 'button', onclick: () => copy(o.payer, '입금자명') },
      h('span', { class: 'muted small', text: '입금자명' }), h('b', { text: o.payer }), h('span', { class: 'copy', text: '복사' })),
    h('p', { class: 'plan', text: `${PLAN[o.plan] || o.plan} · ${period(o)}${o.album ? ' · 앨범 ' + o.album : ''}` }),
    h('div', { class: 'card-btns' },
      h('button', { class: 'btn', type: 'button', text: '거절', onclick: () => reject(o) }),
      h('button', { class: 'btn primary', type: 'button', text: '입금 확인', onclick: () => confirmPaid(o) })));
}

async function confirmPaid(o) {
  const yes = await ask({ title: '입금이 들어왔나요?', ok: '들어왔어요 · 기간 늘리기', cancel: '아직',
    lines: [`토스뱅크에서 입금자명 "${o.payer}", ${won(o.amount)}이 들어왔는지 확인해 주세요.`, `${o.nick || 'DJ'} · ${PLAN[o.plan] || o.plan} ${period(o)}`] });
  if (!yes) return;
  try {
    const j = await bill('ops-confirm', { id: o.id });
    const u = j.until || {};
    const parts = [u.munchkin ? `먼치킨 ${day(u.munchkin)}까지` : '', u.album ? `추억앨범 ${day(u.album)}까지` : ''].filter(Boolean);
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
  return h('section', { class: 'list' }, list.map((o) => h('article', { class: 'row-card' },
    h('div', null, h('b', { text: `${won(o.amount)} · ${o.payer}` }), h('p', { class: 'muted small', text: `${o.nick || ''} · ${PLAN[o.plan] || o.plan} ${period(o)}` })),
    h('div', { class: 'right' }, h('span', { class: 'chip ' + (o.state === 'paid' ? 'green' : 'gray'), text: STATE[o.state] || o.state }), h('p', { class: 'muted small', text: o.done ? when(o.done) : '' })))));
}

function settingsView() {
  const wrap = h('section', { class: 'settings' });
  // 알림
  const perm = pushReady() ? Notification.permission : 'unsupported';
  const devs = S.devices;
  const mine = ls.get('ops_push_id');
  wrap.append(h('h2', { text: '알림' }),
    h('div', { class: 'group' },
      h('p', { class: 'small', text: !pushReady() ? (isIOS() && !standalone() ? '홈 화면에 추가한 앱에서만 알림을 켤 수 있어요.' : '이 기기에서는 알림을 쓸 수 없어요.')
        : perm === 'granted' ? 'DJ가 "입금했어요"를 누르면 이 폰으로 알림이 와요.'
        : perm === 'denied' ? '알림이 꺼져 있어요. 아이폰 설정 › 알림 › 입금 확인 에서 켜 주세요.'
        : '알림을 켜면 DJ가 입금했을 때 바로 알려 드려요.' }),
      pushReady() && perm !== 'denied' ? h('button', { class: 'btn primary wide', type: 'button', text: perm === 'granted' && mine ? '알림 다시 연결' : '알림 켜기', onclick: () => enablePush(true) }) : null,
      perm === 'granted' && mine ? h('button', { class: 'btn wide', type: 'button', text: '시험 알림 보내기', onclick: testPush }) : null),
    h('h2', { text: '알림 받는 기기' }),
    h('div', { class: 'group' },
      !devs ? h('p', { class: 'muted small', text: '불러오는 중이에요…' })
        : !devs.length ? h('p', { class: 'muted small', text: '아직 없어요.' })
        : devs.map((d) => h('div', { class: 'dev' },
          h('div', null, h('b', { text: d.label + (d.id === mine ? ' (이 폰)' : '') }), h('p', { class: 'muted small', text: `연결 ${day(d.created)}${d.ok ? ' · 마지막 알림 ' + when(d.ok) : ''}` })),
          h('button', { class: 'btn small', type: 'button', text: '지우기', onclick: () => removeDevice(d) }))),
      h('p', { class: 'muted small', text: '폰을 바꾸면: 새 폰에서 이 앱을 다시 홈 화면에 추가 → 로그인 → 알림 켜기. 예전 폰은 여기서 지우면 돼요(앱을 지운 폰은 저절로 빠져요).' })));
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

// ---------- 데이터 ----------
let loading = null;
async function load(manual = false) {
  if (!S.session) return render();
  if (loading) return loading;
  loading = (async () => {
    try {
      S.data = await bill('ops-orders');
      setBadge();
      if (manual) toast('새로 불러왔어요');
    } catch (err) { if (err.status !== 401) toast(err.message, true); }
    loading = null;
    render();
  })();
  return loading;
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
  S.session = null; S.me = null; S.data = null; S.devices = null;
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
navigator.serviceWorker?.addEventListener('message', (e) => { if (e.data === 'refresh' && S.session) load(); });
setInterval(() => { if (document.visibilityState === 'visible' && S.session) load(); }, 60000);
start();
