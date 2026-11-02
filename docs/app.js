// 한이준 추억앨범 — 최초 박제판·박제판을 모아 두는 개인 SNS.
// 보기: 공개 버킷의 snap/feed.json(서버가 글이 바뀔 때마다 새로 씀). 하트·글쓰기: Supabase 함수 bakje.
// 글쓰기는 "주인 기기"만 — 이 브라우저가 만든 열쇠(IndexedDB, 밖으로 못 꺼냄)로 서명한다(BAKJE/1).

const SB = 'https://aksegkhhugqvvaidgvro.supabase.co';
const KEY = 'sb_publishable_45cIqG4dGLSlev-rmNiVDg_uG8szVzD';
const API = SB + '/functions/v1/bakje/';
const PUB = SB + '/storage/v1/object/public/bakje/';
const MAX_PHOTOS = 10;
const PAPERS = [['cream', '크림'], ['rose', '분홍'], ['sky', '하늘'], ['lilac', '라일락'], ['mint', '민트']];
const KIND_NAME = { board: '박제판', first: '최초 박제판', letter: '박제 편지' };
// 화면 틀(세로 ÷ 가로): 모든 글 9:16. 사진이 틀과 다르면 자르지 않고 남는 곳을 같은 사진으로 흐리게 채운다.
const FRAME = 16 / 9;
// 탭: 게시물 = 최초 박제판(먼치킨 최초 박제판이 저절로 올라온다) · 박제판 = 올린 박제판 사진 · 달력 = 박제판을 달·날로 골라 보기
const tabOf = (kind) => (kind === 'first' ? 'all' : 'board');
const byDate = (list) => [...list].sort((a, b) => b.at - a.at);   // 날짜가 새것 먼저(같으면 서버 차례)
const SITE_NAME = '한이준 추억앨범';
const DEFAULT_AVATAR = 'profile.webp';   // 프로필 사진을 따로 올리지 않았을 때(설정 › 사진 바꾸기로 바꾼다)
const enc = new TextEncoder();

// ---------- 작은 도구 ----------
const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value') el.value = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (typeof v === 'boolean') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const ICONS = {
  heart: '<path d="M12 20.3s-7.4-4.5-9.2-9.1C1.5 7.9 3.5 4.6 7 4.6c2 0 3.6 1.1 5 2.9 1.4-1.8 3-2.9 5-2.9 3.5 0 5.5 3.3 4.2 6.6-1.8 4.6-9.2 9.1-9.2 9.1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  'plus-square': '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M12 8v8M8 12h8"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.3" fill="currentColor" stroke="none"/>',
  share: '<path d="M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M16 7l-4-4-4 4M12 3v13"/>',
  pin: '<path d="M9 3.5h6l-1 6.5 3 3H7l3-3-1-6.5zM12 13v7.5"/>',
  grid: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="6" rx="1.6"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.6"/><rect x="13.5" y="12.5" width="7" height="8" rx="1.6"/>',
  feed: '<rect x="4" y="3.5" width="16" height="12" rx="2"/><path d="M4 19h16M4 21.5h9"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  stack: '<rect x="7.5" y="7.5" width="13" height="13" rx="2"/><path d="M4 16.5V6a2 2 0 0 1 2-2h10.5"/>',
  letter: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.6 6.5l8.4 6.4 8.4-6.4"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5.5a2.5 2.5 0 0 0 2.6 4.4M16 6h2.5a2.5 2.5 0 0 1-2.6 4.4M12 13v3.5M8.5 20h7M10 16.5h4l.5 3.5h-5z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="1" fill="currentColor" stroke="none"/>'
};
function icon(name, cls = '') {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('class', ('ic ' + cls).trim());
  el.innerHTML = ICONS[name];
  return el;
}
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 됨 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 없음 */ } }
};
const b64url = (bytes) => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const hexOf = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256hex = async (v) => hexOf(await crypto.subtle.digest('SHA-256', typeof v === 'string' ? enc.encode(v) : v));
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(24)));
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
const randomId = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => ALPHA[x & 31]).join('');
const KST = 'Asia/Seoul';
const dayOf = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: KST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const dateText = (t) => new Intl.DateTimeFormat('ko-KR', { timeZone: KST, year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(t));
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const param = (k) => new URLSearchParams(location.search).get(k);
function urlWith(changes) {
  const u = new URL(location.href);
  for (const [k, v] of Object.entries(changes)) { if (v == null || v === '') u.searchParams.delete(k); else u.searchParams.set(k, v); }
  return u.pathname + u.search;
}
function vid() {
  let v = ls.get('bj_vid');
  if (!v || !/^[-_A-Za-z0-9]{32}$/.test(v)) { v = randomToken(); ls.set('bj_vid', v); }
  return v;
}
function readSet(k) { try { return new Set(JSON.parse(ls.get(k) || '[]')); } catch { return new Set(); } }

// ---------- 주인 기기 열쇠 ----------
const DEV_DB = 'bakje-owner', DEV_STORE = 'keys', DEV_ID = 'main';
const deviceSupported = () => typeof indexedDB !== 'undefined' && !!globalThis.crypto?.subtle && isSecureContext;
function openDevDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DEV_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DEV_STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function devTx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(DEV_STORE, mode);
    const req = fn(t.objectStore(DEV_STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}
let device = null;
async function identity({ create = true } = {}) {
  if (device) return device;
  if (!deviceSupported()) return null;
  const db = await openDevDb();
  try {
    let rec = await devTx(db, 'readonly', (s) => s.get(DEV_ID));
    if (!rec) {
      if (!create) return null;
      const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
      rec = { privateKey: pair.privateKey, publicKey: b64url(await crypto.subtle.exportKey('spki', pair.publicKey)), created: Date.now() };
      await devTx(db, 'readwrite', (s) => s.put(rec, DEV_ID));
      try { navigator.storage?.persist?.()?.catch?.(() => {}); } catch { /* 선택 */ }
    }
    device = rec;
    return rec;
  } finally { db.close(); }
}
async function forgetDevice() {
  device = null;
  await new Promise((resolve) => { const r = indexedDB.deleteDatabase(DEV_DB); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
}
async function signed(action, payload) {
  const me = await identity();
  if (!me) throw Error('이 브라우저에서는 주인 기기를 쓸 수 없어요.');
  const timestamp = Date.now(), nonce = randomToken();
  const text = `BAKJE/1\n${action}\n${timestamp}\n${nonce}\n${me.publicKey}\n${await sha256hex(JSON.stringify(payload ?? null))}`;
  const signature = b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, me.privateKey, enc.encode(text)));
  return { action, timestamp, nonce, publicKey: me.publicKey, signature, payload };
}

// ---------- 서버 ----------
async function call(path, { method = 'GET', body, timeout = 25000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(API + path + (method === 'GET' ? `?apikey=${KEY}` : ''), {
      method, signal: ctl.signal, cache: 'no-store',
      headers: method === 'GET' ? {} : { apikey: KEY, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw Object.assign(Error('인터넷 연결을 확인해 주세요.'), { status: 0 });
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { /* 아래 */ }
  if (!res.ok || !data?.ok) throw Object.assign(Error(data?.error || '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.'), { status: res.status });
  return data;
}
const ownerCall = async (action, payload) => call('owner', { method: 'POST', body: await signed(action, payload) });
async function fetchFeed(fresh) {
  try {
    const r = await fetch(PUB + 'snap/feed.json?t=' + (fresh ? Date.now() : Math.floor(Date.now() / 10000)), { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.posts)) return j; }
  } catch { /* 함수로 */ }
  return (await call('feed')).snap;
}
async function put(file, blob) {
  let res;
  try {
    res = await fetch(`${SB}/storage/v1/object/upload/sign/bakje/${file.path}?token=${encodeURIComponent(file.token)}`, {
      method: 'PUT', body: blob,
      headers: { apikey: KEY, 'Content-Type': 'image/jpeg', 'cache-control': 'max-age=31536000', 'x-upsert': 'false' }
    });
  } catch { throw Error('사진을 올리지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  if (!res.ok) throw Error(`사진을 올리지 못했어요 (${res.status}). 다시 해 주세요.`);
}

// ---------- 사진 줄이기(자르지 않음, 위치 정보 등은 빠짐) ----------
async function readImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try { await img.decode(); } catch { URL.revokeObjectURL(url); throw Error('사진을 읽을 수 없어요: ' + (file.name || '사진')); }
  return { img, url };
}
function shrink(img, maxEdge, quality) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const s = Math.min(1, maxEdge / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), hh = Math.max(1, Math.round(H * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const x = c.getContext('2d');
  x.fillStyle = '#fff';
  x.fillRect(0, 0, w, hh);
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, hh);
  return new Promise((resolve, reject) => c.toBlob((b) => {
    c.width = c.height = 0;
    b ? resolve({ blob: b, w, h: hh }) : reject(Error('사진을 바꾸지 못했어요.'));
  }, 'image/jpeg', quality));
}
async function preparePhoto(file) {
  const { img, url } = await readImage(file);
  try {
    const full = await shrink(img, 2560, 0.9);
    const thumb = await shrink(img, 720, 0.82);
    return { kind: 'new', full: full.blob, thumb: thumb.blob, w: full.w, h: full.h, preview: URL.createObjectURL(thumb.blob) };
  } finally { URL.revokeObjectURL(url); }
}

// ---------- 상태 ----------
const S = {
  feed: null,
  tab: ['board', 'cal'].includes(param('t')) ? param('t') : param('t') === 'letter' ? 'cal' : 'all',
  view: ls.get('bj_view') === 'feed' ? 'feed' : 'grid',
  owner: ls.get('bj_owner') === '1',
  hearted: readSet('bj_hearted'),
  vid: vid(),
  cal: calFromUrl()   // 달력: {ym: 'YYYY-MM' | null(가장 최근 박제판이 있는 달), day: 'YYYY-MM-DD' | null(그 달 전체)}
};
const posts = () => S.feed?.posts || [];
const findPost = (id) => posts().find((p) => p.id === id);
// 지금 보이는 글(큰 화면의 이전·다음 차례와 같다): 날짜가 새것 먼저. 달력 탭은 고른 달·날의 박제판
function shown() {
  if (S.tab === 'cal') return calSelection();
  return byDate(posts().filter((p) => tabOf(p.kind) === S.tab));
}
const profileName = () => S.feed?.profile?.name || SITE_NAME;
function setFeed(feed) {
  if (!feed || !Array.isArray(feed.posts)) return;
  if (S.feed && feed.snapAt < S.feed.snapAt) return;
  S.feed = feed;
  try { ls.set('bj_feed', JSON.stringify(feed)); } catch { /* 너무 크면 안 남김 */ }
}

// ---------- 알림·확인 ----------
let toastTimer = 0;
function toast(message, bad = false) {
  let el = $('#toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    // 큰 화면·글쓰기 창(맨 위 층) 위에도 보이게 popover 로 띄운다
    if ('popover' in HTMLElement.prototype) el.popover = 'manual';
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.toggle('bad', bad);
  if (el.popover) { try { el.hidePopover(); } catch { /* 이미 닫힘 */ } try { el.showPopover(); } catch { /* 안 됨 */ } }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    if (el.popover) setTimeout(() => { if (!el.classList.contains('show')) try { el.hidePopover(); } catch { /* 이미 닫힘 */ } }, 250);
  }, 2600);
}
// 작은 창. 닫을 때는 d.dismiss() — close 이벤트를 기다리지 않고 바로 치운다.
//  sticky: 바깥(어두운 곳)을 눌러도 닫지 않는다(쓰던 글이 날아가지 않게).
function sheet(content, { cls = '', label = '', sticky = false, onClose } = {}) {
  const d = h('dialog', { class: 'sheet ' + cls, 'aria-label': label });
  d.append(content);
  let done = false;
  d.dismiss = () => {
    if (done) return;
    done = true;
    try { if (d.open) d.close(); } catch { /* 이미 닫힘 */ }
    d.remove();
    onClose?.();
  };
  d.addEventListener('close', () => d.dismiss());
  d.addEventListener('click', (e) => { if (e.target === d && !sticky) d.dismiss(); });
  document.body.append(d);
  d.showModal();
  return d;
}
function confirmBox(message, okText = '확인', danger = false) {
  return new Promise((resolve) => {
    let answer = false;
    const ok = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), type: 'button', text: okText, onclick: () => { answer = true; d.dismiss(); } });
    const d = sheet(h('div', { class: 'confirm' },
      h('p', { text: message }),
      h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', text: '그만두기', onclick: () => d.dismiss() }), ok)
    ), { cls: 'small', label: '확인', onClose: () => resolve(answer) });
    ok.focus();
  });
}

// ---------- 하트 ----------
function paintHearts(id) {
  const p = findPost(id);
  if (!p) return;
  const on = S.hearted.has(id);
  document.querySelectorAll(`[data-heart="${id}"]`).forEach((b) => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? '하트 취소' : '하트');
    const c = b.querySelector('.count');
    if (c) c.textContent = num(p.hearts);
  });
  document.querySelectorAll(`[data-hearts-of="${id}"]`).forEach((el) => { el.textContent = num(p.hearts); });
  const total = $('#stat-hearts');
  if (total) total.textContent = num(posts().reduce((n, x) => n + (x.hearts || 0), 0));
}
const heartBusy = new Set();
async function toggleHeart(id, force) {
  const p = findPost(id);
  if (!p || heartBusy.has(id)) return;
  const on = force ?? !S.hearted.has(id);
  if (on === S.hearted.has(id)) return;
  heartBusy.add(id);
  const before = p.hearts || 0;
  p.hearts = Math.max(0, before + (on ? 1 : -1));
  on ? S.hearted.add(id) : S.hearted.delete(id);
  ls.set('bj_hearted', JSON.stringify([...S.hearted]));
  paintHearts(id);
  try {
    const r = await call('heart', { method: 'POST', body: { post: id, vid: S.vid, on } });
    if (typeof r.hearts === 'number') p.hearts = r.hearts;
  } catch (e) {
    p.hearts = before;
    on ? S.hearted.delete(id) : S.hearted.add(id);
    ls.set('bj_hearted', JSON.stringify([...S.hearted]));
    toast(e.message, true);
  } finally {
    heartBusy.delete(id);
    paintHearts(id);
  }
}
function burst(host) {
  const b = h('span', { class: 'burst', 'aria-hidden': 'true' }, icon('heart', 'fillable'));
  host.append(b);
  setTimeout(() => b.remove(), 900);
}

// ---------- 글 그리기(인스타그램처럼) ----------
// 저장소 경로 → 주소(글쓰기 미리 보기는 이 브라우저의 blob: 주소를 그대로 쓴다)
const photoUrl = (path) => (/^(blob:|https?:)/.test(path) ? path : PUB + path);
const avatarSrc = (path) => (path ? photoUrl(path) : DEFAULT_AVATAR);
function avatarEl(size = '', ring = false) {
  return h('span', { class: `avatar ${size}${ring ? ' ring' : ''}` },
    h('img', { class: 'avatar-img', src: avatarSrc(S.feed?.profile?.avatar), alt: '' }));
}
function letterCard(letter, at) {
  return h('div', { class: 'letter paper-' + (letter.paper || 'cream') },
    letter.to ? h('p', { class: 'to', text: 'To. ' + letter.to }) : null,
    letter.text ? h('p', { class: 'body', text: letter.text }) : null,
    h('div', { class: 'sign' },
      letter.from ? h('p', { class: 'from', text: 'From. ' + letter.from }) : null,
      h('p', { class: 'when', text: dateText(at) }))
  );
}
// 사진 넘기기: 사진은 자르지 않고(contain), 남는 곳은 같은 사진을 흐리게 깐다
function carousel(post) {
  const list = post.photos;
  const track = h('div', { class: 'slides', tabindex: '0', 'aria-label': '사진' });
  const dots = list.length > 1 ? h('div', { class: 'dots' }, list.map((_, i) => h('span', { class: i ? '' : 'on' }))) : null;
  const counter = list.length > 1 ? h('span', { class: 'counter', text: `1/${list.length}` }) : null;
  list.forEach((ph, i) => {
    track.append(h('div', { class: 'slide' },
      h('img', { class: 's-bg', src: photoUrl(ph.t), alt: '', 'aria-hidden': 'true', decoding: 'async', loading: i ? 'lazy' : 'eager' }),
      h('img', { class: 's-img', src: photoUrl(ph.f), alt: `${KIND_NAME[post.kind]} 사진 ${i + 1}`, decoding: 'async', loading: i ? 'lazy' : 'eager', width: String(ph.w), height: String(ph.h) })));
  });
  const go = (d) => track.scrollBy({ left: d * track.clientWidth, behavior: 'smooth' });
  const prev = list.length > 1 ? h('button', { class: 'nav prev', type: 'button', 'aria-label': '이전 사진', onclick: () => go(-1) }, icon('left')) : null;
  const next = list.length > 1 ? h('button', { class: 'nav next', type: 'button', 'aria-label': '다음 사진', onclick: () => go(1) }, icon('right')) : null;
  let raf = 0;
  track.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      if (dots) [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));
      if (counter) counter.textContent = `${i + 1}/${list.length}`;
      if (prev) prev.disabled = i <= 0;
      if (next) next.disabled = i >= list.length - 1;
    });
  }, { passive: true });
  if (prev) prev.disabled = true;
  track.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); } if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(1); } });
  // 두 번 톡 → 하트
  let last = 0, lx = 0, ly = 0;
  const wrap = h('div', { class: 'carousel' }, track, prev, next, counter, dots);
  track.addEventListener('pointerup', (e) => {
    const now = e.timeStamp;
    if (now - last < 320 && Math.abs(e.clientX - lx) < 30 && Math.abs(e.clientY - ly) < 30) {
      last = 0;
      burst(wrap);
      if (!S.hearted.has(post.id)) toggleHeart(post.id, true);
    } else { last = now; lx = e.clientX; ly = e.clientY; }
  });
  return wrap;
}
// 최초 박제판의 판 이름·채운 칸(먼치킨이 올린 글은 extra, 손으로 올린 글은 글 첫 줄에서)
function firstInfo(post) {
  const x = post.extra || {};
  const title = x.title || (post.caption || '').split('\n')[0].replace(/^🏆\s*/, '').replace(/\s*최초\s*박제판?\s*$/, '').trim().slice(0, 20);
  return { title, filled: Number(x.filled) || 0, total: Number(x.total) || 0, bot: x.bot === true };
}
// 최초 박제판 종료 날짜(ends, 한국 날짜) → 남은 날. 오늘이 끝나는 날이면 0, 지났으면 음수
function endsInfo(post) {
  if (post.kind !== 'first' || !/^\d{4}-\d{2}-\d{2}$/.test(post.ends || '')) return null;
  const left = Math.round((Date.parse(post.ends + 'T00:00:00Z') - Date.parse(dayOf(Date.now()) + 'T00:00:00Z')) / 86400000);
  const [, m, d] = post.ends.split('-').map(Number);
  const date = `${m}월 ${d}일`;
  return left > 0 ? { left, tag: `D-${left}`, text: `${date} 종료`, long: `종료까지 ${num(left)}일 · ${date}` }
    : left === 0 ? { left, tag: 'D-DAY', text: '오늘 종료', long: `오늘(${date}) 종료` }
    : { left, tag: '종료', text: `${date} 종료됨`, long: `${date}에 종료됐어요` };
}
// 한 글(큰 화면): 머리(앨범 이름) · 사진(왼쪽 위에 후원자 닉네임) · 하트 줄 · 글 칸(후원자 닉네임 → 스푼 테마 → 날짜 → 글).
//  넓은 화면에서는 사진 왼쪽, 나머지 오른쪽. 사진 칸은 9:16 틀이다. preview: 글쓰기 미리 보기(단추 없이)
function postCard(post, { preview = false } = {}) {
  const hasPhotos = post.photos?.length > 0;
  const fi = post.kind === 'first' ? firstInfo(post) : null;
  const sub = fi ? [h('span', { class: 'kind kind-first', text: KIND_NAME.first }), fi.total ? ` · ${num(fi.filled)}/${num(fi.total)}칸` : '']
    : post.pinned ? ['고정됨'] : [];
  const head = h('header', { class: 'p-head' },
    preview ? null : h('button', { class: 'icon-btn p-back', type: 'button', 'aria-label': '뒤로', onclick: () => closeViewer() }, icon('left')),
    avatarEl('sm'),
    h('div', { class: 'p-who' },
      h('strong', { text: profileName() }),
      sub.length ? h('span', { class: 'p-sub' }, sub) : null),
    S.owner && !preview ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '글 메뉴', onclick: () => postMenu(post) }, icon('more')) : null);
  const media = hasPhotos
    ? h('div', { class: 'p-media' }, carousel(post), donorMark(post))
    : h('div', { class: 'p-media letter-only paper-' + (post.letter?.paper || 'cream') }, letterCard(post.letter || {}, post.at));
  const actions = h('div', { class: 'p-actions' },
    heartButton(post),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '링크 공유', onclick: () => sharePost(post) }, icon('share')),
    h('p', { class: 'p-likes' }, '하트 ', h('b', { dataset: { heartsOf: post.id }, text: num(post.hearts) }), '개'));
  const theme = post.theme || fi?.title || '';
  const end = endsInfo(post);
  const body = h('div', { class: 'p-body' },
    h('div', { class: 'p-info' },
      post.donor ? h('strong', { class: 'p-donor', text: post.donor }) : null,
      theme ? h('p', { class: 'p-theme' }, h('span', { class: 'p-label', text: '스푼 테마' }), theme) : null,
      end ? h('p', { class: 'p-ends' + (end.left < 0 ? ' is-over' : end.left <= 3 ? ' is-soon' : '') },
        h('span', { class: 'p-dday', text: end.tag }), end.long) : null,
      h('time', { class: 'p-day', datetime: new Date(post.at).toISOString(), text: dateText(post.at) })),
    hasPhotos && post.letter ? letterCard(post.letter, post.at) : null,
    post.caption ? h('p', { class: 'p-caption', text: post.caption }) : null);
  const card = h('article', { class: 'post in-viewer' + (preview ? ' is-preview' : ''), dataset: { post: post.id } }, head, media, actions, body);
  card.style.setProperty('--ratio', String(FRAME));
  return card;
}
// 사진 왼쪽 위 후원자 닉네임(워터마크처럼)
const donorMark = (post, cls = 'donor-mark') => (post.donor ? h('span', { class: cls, text: post.donor }) : null);
function heartButton(post) {
  const on = S.hearted.has(post.id);
  return h('button', {
    class: 'heart' + (on ? ' on' : ''), type: 'button', dataset: { heart: post.id },
    'aria-pressed': String(on), 'aria-label': on ? '하트 취소' : '하트',
    onclick: () => toggleHeart(post.id)
  }, icon('heart', 'fillable'));
}
async function sharePost(post) {
  const url = location.origin + location.pathname + (post ? '?p=' + post.id : '');
  const title = post ? `${profileName()} · ${KIND_NAME[post.kind]}` : profileName();
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title, url }); return; }
  } catch (e) { if (e?.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); } catch { prompt('이 링크를 복사해 주세요', url); }
}

// ---------- 모아 보기(3칸 격자 9:16 — 사진은 자르지 않고 남는 곳은 흐리게) ----------
//  최초 박제판은 9:16 칸에서 위쪽에 판 그림, 아래에 판 이름·채운 칸을 보여 준다.
function tile(post) {
  const first = post.photos?.[0];
  const fi = post.kind === 'first' ? firstInfo(post) : null;
  let body;
  if (first && fi) {
    const src = photoUrl(first.t), pct = fi.total ? Math.round((fi.filled / fi.total) * 100) : 0, end = endsInfo(post);
    body = h('span', { class: 'first-tile' },
      h('img', { class: 't-bg', src, alt: '', 'aria-hidden': 'true', loading: 'lazy', decoding: 'async' }),
      h('span', { class: 'ft-img' }, h('img', { class: 't-img', src, alt: '', loading: 'lazy', decoding: 'async' })),
      h('span', { class: 'ft-info' },
        h('span', { class: 'ft-label' }, icon('trophy'), '최초 박제판'),
        fi.title ? h('strong', { class: 'ft-title', text: fi.title }) : null,
        fi.total ? h('span', { class: 'ft-bar' }, h('i', { style: { width: pct + '%' } })) : null,
        fi.total ? h('span', { class: 'ft-count', text: `${num(fi.filled)} / ${num(fi.total)}칸` }) : null,
        end ? h('span', { class: 'ft-ends' + (end.left < 0 ? ' is-over' : end.left <= 3 ? ' is-soon' : '') },
          h('b', { text: end.tag }), end.left < 0 ? null : end.text) : null));
  } else if (first) {
    const src = photoUrl(first.t);
    body = h('span', { class: 't-media' },
      h('img', { class: 't-bg', src, alt: '', 'aria-hidden': 'true', loading: 'lazy', decoding: 'async' }),
      h('img', { class: 't-img', src, alt: '', loading: 'lazy', decoding: 'async' }));
  } else {
    const l = post.letter || {};
    body = h('span', { class: 'letter-tile paper-' + (l.paper || 'cream') },
      l.to ? h('span', { class: 'to', text: 'To. ' + l.to }) : null,
      h('span', { class: 'body', text: (l.text || '').slice(0, 160) }));
  }
  const badges = h('span', { class: 'badges' },
    post.pinned ? icon('pin') : null,
    post.photos?.length > 1 ? icon('stack') : null,
    post.kind === 'letter' && first ? icon('letter') : null);
  const over = h('span', { class: 't-over' }, icon('heart', 'fillable'), h('span', { dataset: { heartsOf: post.id }, text: num(post.hearts) }));
  const endLabel = fi ? endsInfo(post)?.long : '';
  return h('button', { class: 'tile', type: 'button', 'aria-label': `${KIND_NAME[post.kind]} · ${post.donor ? post.donor + ' · ' : ''}${endLabel ? endLabel + ' · ' : ''}${dateText(post.at)} 열기`, onclick: () => openViewer(post.id) },
    body, first ? donorMark(post, 'donor-mark t-donor') : null, badges, over);
}

// ---------- 달력: 박제판을 달별로 모아 보기(달을 누르면 그 달, 날을 누르면 그날) ----------
const pad2 = (n) => String(n).padStart(2, '0');
const ymOf = (t) => dayOf(t).slice(0, 7);
function calFromUrl() {
  const d = param('d'), m = param('m');
  const okYm = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(d || '') && okYm(d.slice(0, 7)) && Number(d.slice(8)) >= 1 && Number(d.slice(8)) <= 31) return { ym: d.slice(0, 7), day: d };
  return { ym: okYm(m) ? m : null, day: null };
}
const calPosts = () => byDate(posts().filter((p) => tabOf(p.kind) === 'board'));
function calYm() { const l = calPosts()[0]; return S.cal.ym || (l ? ymOf(l.at) : dayOf(Date.now()).slice(0, 7)); }
function calSelection() {
  const ym = calYm(), d = S.cal.day;
  return calPosts().filter((p) => (d ? dayOf(p.at) === d : ymOf(p.at) === ym));
}
function setCal(ym, day = null) {
  S.cal = { ym, day };
  history.replaceState(history.state, '', urlWith({ m: day ? null : ym, d: day }));
  render();
}
function monthCalendar() {
  const items = calPosts(), ym = calYm(), [Y, M] = ym.split('-').map(Number), sel = S.cal.day;
  const byDay = new Map(), byMonth = new Map();
  for (const p of items) {
    const k = dayOf(p.at);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(p);
    byMonth.set(k.slice(0, 7), (byMonth.get(k.slice(0, 7)) || 0) + 1);
  }
  const today = dayOf(Date.now()), years = [Number(today.slice(0, 4)), Y, ...items.map((p) => Number(dayOf(p.at).slice(0, 4)))];
  const minY = Math.min(...years), maxY = Math.max(...years);
  // 다른 해로: 그해 박제판이 있는 가장 늦은 달(없으면 같은 달)
  const toYear = (y) => { const has = [...byMonth.keys()].filter((k) => k.startsWith(y + '-')).sort(); setCal(has.at(-1) || `${y}-${pad2(M)}`); };
  const yearNav = h('div', { class: 'cal-year' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '이전 해', disabled: Y <= minY, onclick: () => toYear(Y - 1) }, icon('left')),
    h('strong', { text: `${Y}년` }),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '다음 해', disabled: Y >= maxY, onclick: () => toYear(Y + 1) }, icon('right')));
  const months = h('div', { class: 'cal-months', 'aria-label': `${Y}년 달 고르기` }, Array.from({ length: 12 }, (_, i) => {
    const key = `${Y}-${pad2(i + 1)}`, n = byMonth.get(key) || 0, on = key === ym;
    return h('button', { type: 'button', class: 'cal-m' + (on ? ' on' : '') + (n ? ' has' : ''), 'aria-pressed': String(on && !sel), 'aria-label': `${i + 1}월 박제판 ${n}개`, onclick: () => setCal(key) },
      h('span', { text: `${i + 1}월` }), h('small', { text: n ? `${n}개` : '' }));
  }));
  const count = byMonth.get(ym) || 0;
  const head = h('div', { class: 'cal-head' },
    h('button', { type: 'button', class: 'cal-title' + (sel ? '' : ' on'), 'aria-pressed': String(!sel), onclick: () => setCal(ym) }, `${M}월`, h('span', { text: count ? ` 박제판 ${count}개` : ' 박제판 없음' })),
    sel ? h('button', { type: 'button', class: 'link-btn', text: `${M}월 전체 보기`, onclick: () => setCal(ym) }) : null);
  const firstDow = new Date(Date.UTC(Y, M - 1, 1)).getUTCDay(), days = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const cells = [...'일월화수목금토'].map((w, i) => h('span', { class: 'cal-w' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''), text: w }));
  for (let i = 0; i < firstDow; i++) cells.push(h('span', { class: 'cal-d blank', 'aria-hidden': 'true' }));
  for (let d = 1; d <= days; d++) {
    const key = `${ym}-${pad2(d)}`, list = byDay.get(key) || [], dow = (firstDow + d - 1) % 7;
    const cls = 'cal-d' + (key === sel ? ' on' : '') + (key === today ? ' today' : '') + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '');
    const dn = h('span', { class: 'dn', text: String(d) });
    if (!list.length) { cells.push(h('span', { class: cls }, dn)); continue; }
    const top = list[0], ph = top.photos?.[0];
    const face = ph
      ? h('span', { class: 'd-face' }, h('img', { class: 'd-bg', src: photoUrl(ph.t), alt: '', 'aria-hidden': 'true', loading: 'lazy', decoding: 'async' }), h('img', { class: 'd-img', src: photoUrl(ph.t), alt: '', loading: 'lazy', decoding: 'async' }))
      : h('span', { class: 'd-face d-paper paper-' + (top.letter?.paper || 'cream') }, icon('letter'));
    cells.push(h('button', { type: 'button', class: cls + ' has' + (ph ? ' photo' : ' paper'), 'aria-pressed': String(key === sel), 'aria-label': `${M}월 ${d}일 박제판 ${list.length}개`, onclick: () => setCal(ym, key === sel ? null : key) },
      face, dn, list.length > 1 ? h('span', { class: 'dc', text: String(list.length) }) : null));
  }
  return h('section', { class: 'cal', 'aria-label': '박제판 달력' }, yearNav, months, head, h('div', { class: 'cal-grid' }, cells));
}
function calView() {
  const list = calSelection(), sel = S.cal.day, [, M] = calYm().split('-').map(Number);
  const when = sel ? `${M}월 ${Number(sel.slice(8))}일` : `${M}월`;
  const out = [monthCalendar()];
  if (!calPosts().length) out.push(h('div', { class: 'empty-state' },
    h('span', { class: 'empty-icon' }, icon('calendar')), h('h2', { text: '아직 박제판이 없어요' }),
    h('p', { class: 'muted', text: '박제판 탭에 올린 사진을 여기서 달별로 모아 볼 수 있어요.' }),
    S.owner ? h('button', { class: 'link-btn', type: 'button', onclick: () => openComposer(), text: '첫 박제판 올리기' }) : null));
  else if (!list.length) out.push(h('p', { class: 'sel-empty', text: `${when}에는 박제판이 없어요. 위 달력에서 박제판이 있는 달이나 날을 눌러 보세요.` }));
  else out.push(h('h3', { class: 'sec-title sel-title' }, icon('photo'), `${when}의 박제판`, h('small', { text: num(list.length) })), h('div', { class: 'grid' }, list.map((p) => tile(p))));
  return h('div', { class: 'letters' }, out);
}
// 고정한 글 = 하이라이트 동그라미
function highlight(post) {
  const first = post.photos?.[0];
  const label = (post.caption || post.letter?.to || KIND_NAME[post.kind]).replace(/\s+/g, ' ').slice(0, 8);
  const face = first
    ? h('img', { src: photoUrl(first.t), alt: '', loading: 'lazy', decoding: 'async' })
    : h('span', { class: 'hl-letter paper-' + (post.letter?.paper || 'cream') }, icon('letter'));
  return h('button', { class: 'hl-item', type: 'button', 'aria-label': `고정한 글 ${label} 열기`, onclick: () => openViewer(post.id) },
    h('span', { class: 'hl-ring' }, h('span', { class: 'hl-face' }, face)), h('span', { class: 'hl-label', text: label }));
}

// ---------- 큰 화면(한 글) ----------
let viewer = null, pushedViewer = false;
function viewerStage(post) {
  const list = shown(), i = list.findIndex((p) => p.id === post.id);
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null;
  return h('div', { class: 'v-stage', onclick: (e) => { if (e.target.classList.contains('v-stage')) closeViewer(); } },
    h('button', { class: 'v-close', type: 'button', 'aria-label': '닫기', onclick: () => closeViewer() }, icon('close')),
    prev ? h('button', { class: 'v-nav prev', type: 'button', 'aria-label': '이전 글', onclick: () => openViewer(prev.id, { replace: true }) }, icon('left')) : null,
    postCard(post),
    next ? h('button', { class: 'v-nav next', type: 'button', 'aria-label': '다음 글', onclick: () => openViewer(next.id, { replace: true }) }, icon('right')) : null);
}
function openViewer(id, { push = true, replace = false } = {}) {
  const post = findPost(id);
  if (!post) { if (!push) { history.replaceState(null, '', urlWith({ p: null })); } toast('글을 찾을 수 없어요', true); return; }
  if (viewer?.open) viewer.replaceChildren(viewerStage(post));
  else {
    viewer = h('dialog', { class: 'viewer', 'aria-label': KIND_NAME[post.kind] }, viewerStage(post));
    viewer.addEventListener('cancel', (e) => { e.preventDefault(); closeViewer(); });
    viewer.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const b = viewer?.querySelector(e.key === 'ArrowLeft' ? '.v-nav.prev' : '.v-nav.next');
      if (b) { e.preventDefault(); b.click(); }
    });
    document.body.append(viewer);
    viewer.showModal();
  }
  viewer.dataset.post = id;
  if (replace) history.replaceState(history.state, '', urlWith({ p: id }));
  else if (push) { history.pushState({ p: id }, '', urlWith({ p: id })); pushedViewer = true; }
}
function closeViewer({ fromHistory = false } = {}) {
  if (!viewer) return;
  const v = viewer;
  viewer = null;
  v.close();
  v.remove();
  if (fromHistory) return;
  if (pushedViewer && history.state?.p) { pushedViewer = false; history.back(); }
  else history.replaceState(null, '', urlWith({ p: null }));
}
addEventListener('popstate', () => {
  const p = param('p');
  if (!p && viewer) closeViewer({ fromHistory: true });
  else if (p && viewer?.dataset.post !== p) openViewer(p, { push: false });
});

// ---------- 화면 ----------
function render() {
  const app = $('#app');
  if (param('owner') !== null && !S.owner) { app.replaceChildren(registerView()); return; }
  const all = posts();
  const counts = { all: all.filter((p) => tabOf(p.kind) === 'all').length, board: all.filter((p) => tabOf(p.kind) === 'board').length };
  const hearts = all.reduce((n, p) => n + (p.hearts || 0), 0);
  const prof = S.feed?.profile || {};
  document.title = profileName();
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-in' },
      h('a', { class: 'brand', href: './', text: SITE_NAME }),
      h('div', { class: 'row' },
        S.owner ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '새 게시물', title: '새 게시물', onclick: () => openComposer() }, icon('plus-square')) : null,
        S.owner ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '설정', title: '설정', onclick: () => openSettings() }, icon('gear')) : null,
        !S.owner ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '이 앨범 링크 공유', title: '링크 공유', onclick: () => sharePost(null) }, icon('share')) : null)));
  const stat = (n, label, id) => h('li', null, h('b', { id, text: num(n) }), h('span', { text: label }));
  const profile = h('section', { class: 'pf' },
    h('div', { class: 'pf-avatar' }, avatarEl('xl', true)),
    h('div', { class: 'pf-info' },
      h('div', { class: 'pf-row' },
        h('h1', { class: 'pf-name', text: profileName() }),
        S.owner ? h('div', { class: 'pf-actions' },
          h('button', { class: 'btn soft', type: 'button', text: '프로필 편집', onclick: () => openSettings() }),
          h('button', { class: 'btn soft', type: 'button', text: '새 게시물', onclick: () => openComposer() })) : null),
      h('ul', { class: 'pf-stats' },
        stat(counts.all, '게시물'), stat(counts.board, '박제판'), stat(hearts, '하트', 'stat-hearts'))),
    h('div', { class: 'pf-bio' },
      h('p', { class: 'pf-visit', id: 'visits' }, S.visits ? visitParts() : null),
      prof.bio ? h('p', { text: prof.bio }) : (S.owner ? h('p', { class: 'hint', text: '프로필 편집에서 이름·소개·프로필 사진을 바꿀 수 있어요.' }) : null),
      prof.link ? h('a', { class: 'pf-link', href: prof.link, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), prof.link.replace(/^https:\/\//, '').slice(0, 48)) : null));
  const pinned = all.filter((p) => p.pinned);
  const highlights = pinned.length ? h('div', { class: 'hl', 'aria-label': '고정한 글' }, pinned.map(highlight)) : null;
  const tabs = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': '종류' },
    [['all', '게시물', 'grid'], ['board', '박제판', 'photo'], ['cal', '달력', 'calendar']].map(([k, label, ic]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': String(S.tab === k), class: S.tab === k ? 'on' : '',
      onclick: () => {
        if (S.tab === k) return;
        S.tab = k;
        if (k === 'cal') S.cal = { ym: null, day: null };
        history.replaceState(history.state, '', urlWith({ t: k === 'all' ? null : k, m: null, d: null }));
        render();
      }
    }, icon(ic), h('span', { text: label }))));
  const list = shown();
  let body;
  if (!S.feed) body = h('div', { class: 'empty-state' }, h('p', { text: '불러오는 중…' }));
  else if (S.tab === 'cal') body = calView();
  else if (!list.length) body = h('div', { class: 'empty-state' },
    h('span', { class: 'empty-icon' }, icon(S.tab === 'all' ? 'trophy' : 'photo')),
    h('h2', { text: S.tab === 'all' ? '아직 게시물이 없어요' : '아직 박제판이 없어요' }),
    S.tab === 'all' ? h('p', { class: 'muted', text: '먼치킨 최초 박제판에 이름이 적히면 저절로 올라와요.' }) : null,
    S.owner && S.tab === 'board' ? h('button', { class: 'link-btn', type: 'button', onclick: () => openComposer(), text: '첫 박제판 올리기' }) : null);
  else body = h('div', { class: 'grid' }, list.map((p) => tile(p)));
  const footer = h('footer', { class: 'foot' },
    h('p', null, SITE_NAME, !S.owner ? [' · ', h('a', { href: '?owner', text: '주인 기기 등록' })] : null));
  app.replaceChildren(topbar, h('main', { class: 'wrap' }, profile, highlights, tabs, body), footer);
}

// ---------- 주인 기기 등록 ----------
function guessLabel() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return '아이폰';
  if (/iPad|Macintosh.*Mobile/.test(ua)) return '아이패드';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? '안드로이드 휴대폰' : '안드로이드 태블릿';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Mac/.test(ua)) return 'Mac';
  return '내 기기';
}
function registerView() {
  const back = h('a', { class: 'btn', href: './', text: '돌아가기' });
  if (!deviceSupported()) return h('main', { class: 'wrap narrow' }, h('section', { class: 'card' },
    h('h1', { text: '주인 기기 등록' }),
    h('p', { text: '이 브라우저에서는 등록할 수 없어요. 크롬·사파리·엣지 최신 버전으로 열어 주세요.' }), back));
  const code = h('input', { id: 'code', class: 'input code', inputmode: 'text', autocomplete: 'one-time-code', autocapitalize: 'characters', maxlength: '9', placeholder: 'ABCD-EFGH', required: true });
  code.addEventListener('input', () => {
    const v = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    code.value = v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v;
  });
  const label = h('input', { id: 'label', class: 'input', value: guessLabel(), maxlength: '40' });
  const status = h('p', { class: 'status', role: 'status' });
  const go = h('button', { class: 'btn primary', type: 'submit', text: '등록하기' });
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    go.disabled = true; status.textContent = '확인하는 중…'; status.classList.remove('bad');
    try {
      await ownerCall('register', { code: code.value, label: label.value });
      S.owner = true; ls.set('bj_owner', '1');
      history.replaceState(null, '', urlWith({ owner: null }));
      render();
      toast('주인 기기로 등록했어요');
    } catch (err) {
      status.textContent = err.message; status.classList.add('bad');
    } finally { go.disabled = false; }
  } },
    h('label', { for: 'code', text: '등록 코드 8자리' }), code,
    h('label', { for: 'label', text: '이 기기 이름' }), label,
    status, h('div', { class: 'row end' }, back, go));
  return h('main', { class: 'wrap narrow' }, h('section', { class: 'card' },
    h('h1', { text: '주인 기기 등록' }),
    h('p', { class: 'muted', text: '이 기기에서 박제판과 편지를 올릴 수 있게 등록해요. 등록 코드는 이미 등록한 기기의 ⚙ 설정 › "새 기기 등록 코드"에서 만들 수 있어요.' }),
    form));
}

// ---------- 글 메뉴(주인) ----------
function postMenu(post) {
  const d = sheet(h('div', { class: 'menu' },
    h('button', { type: 'button', onclick: () => { d.dismiss(); closeViewer(); openComposer(post); } }, icon('edit'), '고치기'),
    h('button', { type: 'button', onclick: async () => {
      d.dismiss();
      try { const r = await ownerCall('pin', { id: post.id, pinned: !post.pinned }); setFeed(r.snap); refreshAfterChange(post.id); toast(post.pinned ? '고정을 풀었어요' : '맨 위에 고정했어요'); }
      catch (e) { toast(e.message, true); }
    } }, icon('pin'), post.pinned ? '고정 풀기' : '맨 위에 고정'),
    h('button', { type: 'button', class: 'danger', onclick: async () => {
      d.dismiss();
      if (!await confirmBox('이 글을 지울까요? 사진도 함께 지워지고 되돌릴 수 없어요.', '지우기', true)) return;
      try { const r = await ownerCall('delete', { id: post.id }); setFeed(r.snap); closeViewer(); render(); toast('지웠어요'); }
      catch (e) { toast(e.message, true); }
    } }, icon('trash'), '지우기'),
    h('button', { type: 'button', onclick: () => d.dismiss() }, '그만두기')
  ), { cls: 'small', label: '글 메뉴' });
}
function refreshAfterChange(id) {
  render();
  if (viewer && id && findPost(id)) viewer.replaceChildren(viewerStage(findPost(id)));
}

// ---------- 글쓰기(주인) ----------
function openComposer(post = null) {
  const editing = !!post;
  let kind = KIND_NAME[post?.kind] ? post.kind : 'board';
  const photos = (post?.photos || []).map((p) => ({ kind: 'old', ...p, preview: photoUrl(p.t) }));
  const L = post?.letter || {};
  let paper = L.paper || 'cream';
  let busy = false, preparing = 0;

  const kindSeg = h('div', { class: 'seg wide', role: 'radiogroup', 'aria-label': '종류' });
  const strip = h('div', { class: 'strip' });
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden', id: 'pick' });
  const photoHint = h('p', { class: 'muted small' });
  const ratioHint = h('p', { class: 'muted small ratio-hint' });
  const letterBox = h('div', { class: 'stack' });
  const to = h('input', { class: 'input', id: 'to', maxlength: '40', value: L.to || '', placeholder: '예: 밤톨님' });
  const text = h('textarea', { class: 'input letter-input', id: 'ltext', rows: '8', maxlength: '5000', value: L.text || '', placeholder: '편지 내용을 적어 주세요' });
  const from = h('input', { class: 'input', id: 'from', maxlength: '40', value: editing ? (L.from || '') : (S.feed?.profile?.name || ''), placeholder: '보내는 사람' });
  const papers = h('div', { class: 'papers', role: 'radiogroup', 'aria-label': '편지지 색' });
  const caption = h('textarea', { class: 'input caption-input', id: 'caption', rows: '7', maxlength: '2200', value: post?.caption || '' });
  const donor = h('input', { class: 'input', id: 'donor', maxlength: '40', value: post?.donor || '', placeholder: '예: 밤톨 (사진 왼쪽 위에 보여요)', autocomplete: 'off' });
  const theme = h('input', { class: 'input', id: 'theme', maxlength: '40', value: post?.theme || '', placeholder: '예: 스푸니 가을', autocomplete: 'off' });
  const day = h('input', { class: 'input', id: 'day', type: 'date', value: dayOf(post?.at || Date.now()), max: dayOf(Date.now()) });
  // 최초 박제판만: 그 시즌 스푼이 끝나는 날(목록·글에 "D-5"처럼 남은 날이 보인다).
  //  먼치킨이 올린 판은 봇의 최초 박제판 화면에서 정한다(여기서 고쳐도 봇이 다시 덮으니 막아 둔다)
  const fromBot = post?.extra?.bot === true;
  const ends = h('input', { class: 'input', id: 'ends', type: 'date', value: post?.ends || '', min: '2015-01-01', disabled: fromBot });
  const endsBox = h('div', { class: 'stack' },
    h('label', { for: 'ends', text: '종료 날짜' }), ends,
    h('p', { class: 'muted small', text: fromBot
      ? '먼치킨 봇이 올린 박제판이라 종료 날짜는 봇의 최초 박제판 화면에서 정해요. 정하면 여기에도 바로 보여요.'
      : '시즌 스푼이 끝나는 날을 고르면 목록과 글에 "D-5"처럼 남은 날이 보여요. 비워 두면 안 보여요.' }));
  // 미리 보기: 지금 적은 내용이 휴대폰·PC 에서 어떻게 보일지(줄바꿈 그대로)
  let pvMode = matchMedia('(max-width: 735px)').matches ? 'm' : 'pc', pvRaf = 0;
  const pvSeg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '미리 보기 화면' });
  const pvBox = h('div', { class: 'pv-box' });
  const pvStage = h('div', { class: 'pv-stage' });
  pvBox.append(pvStage);
  function paintPreview() {
    cancelAnimationFrame(pvRaf);
    pvRaf = requestAnimationFrame(() => {
      pvSeg.replaceChildren(...[['m', '휴대폰'], ['pc', 'PC']].map(([k, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(pvMode === k), class: pvMode === k ? 'on' : '',
        onclick: () => { pvMode = k; paintPreview(); }
      }, label)));
      const shots = photos.filter((p) => p.preview).map((p) => ({ f: p.kind === 'new' ? p.preview : p.f, t: p.kind === 'new' ? p.preview : p.t, w: p.w || 9, h: p.h || 16 }));
      const fake = {
        id: post?.id || 'preview', kind, caption: caption.value.trim(), donor: donor.value.trim().replace(/\s+/g, ' '), theme: theme.value.trim().replace(/\s+/g, ' '), ends: kind === 'first' ? ends.value : '',
        at: day.value ? Date.parse(day.value + 'T12:00:00+09:00') : Date.now(), hearts: post?.hearts || 0, pinned: pinned.checked, photos: shots,
        letter: kind === 'letter' ? { to: to.value, text: text.value, from: from.value, paper } : null, extra: post?.extra
      };
      pvStage.className = 'pv-stage pv-' + pvMode;
      pvStage.replaceChildren(shots.length || kind === 'letter' ? postCard(fake, { preview: true }) : h('p', { class: 'muted small pv-empty', text: '사진을 고르면 여기에 미리 보여요.' }));
      // 상자 너비에 맞춰 줄인다(휴대폰 390 · PC 765 — styles.css .pv-m/.pv-pc 와 같게)
      const natural = pvMode === 'pc' ? 765 : 390;
      pvStage.style.zoom = String(Math.min(1, (pvBox.clientWidth || natural) / natural));
    });
  }
  const pinned = h('input', { type: 'checkbox', id: 'pinned', checked: !!post?.pinned });
  const status = h('p', { class: 'status', role: 'status' });
  const submit = h('button', { class: 'btn primary', type: 'submit', text: editing ? '고친 내용 저장' : '올리기' });

  // 박제판(박제판·달력 탭) · 최초 박제판(게시물 탭). 예전 박제 편지 글을 고칠 때만 편지가 보인다.
  const KINDS = [['board', '박제판', 'photo'], ['first', '최초 박제판', 'trophy'], ...(post?.kind === 'letter' ? [['letter', '박제 편지', 'letter']] : [])];
  function paintKind() {
    kindSeg.replaceChildren(...KINDS.map(([k, label, ic]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(kind === k), class: kind === k ? 'on' : '',
      onclick: () => { kind = k; paintKind(); paintStrip(); }
    }, icon(ic), label)));
    letterBox.hidden = kind !== 'letter';
    endsBox.hidden = kind !== 'first';
    photoHint.textContent = kind === 'board' ? `9:16 박제판 사진을 골라 주세요 (${MAX_PHOTOS}장까지)`
      : kind === 'first' ? '최초 박제판 사진을 골라 주세요 (게시물 탭에 올라가요 · 먼치킨 최초 박제판은 저절로 올라와요)'
      : '편지를 그림으로 올리려면 9:16 사진을 골라 주세요 (안 골라도 돼요)';
    caption.placeholder = kind === 'letter' ? '한마디 더 적어 보세요 (안 써도 돼요)' : '이 박제판 이야기를 적어 보세요 (안 써도 돼요)';
  }
  // 고른 사진이 9:16 이 아니면 알려 준다(자르지 않고 남는 곳을 흐리게 채운다)
  function paintRatio() {
    const off = photos.filter((p) => p.w && p.h && Math.abs(p.h / p.w - FRAME) / FRAME > 0.03).length;
    ratioHint.textContent = off ? `${off}장은 9:16 사진이 아니라 남는 곳이 흐리게 채워져요.` : '';
  }
  function paintPapers() {
    papers.replaceChildren(...PAPERS.map(([k, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(paper === k), 'aria-label': label + ' 편지지',
      class: `swatch paper-${k}` + (paper === k ? ' on' : ''), onclick: () => { paper = k; paintPapers(); }
    })));
  }
  function paintStrip() {
    const items = photos.map((p, i) => h('div', { class: 'thumb' },
      p.preview ? h('img', { src: p.preview, alt: `사진 ${i + 1}` }) : h('span', { class: 'spin' }),
      h('span', { class: 'no', text: String(i + 1) }),
      h('div', { class: 'thumb-tools' },
        h('button', { type: 'button', 'aria-label': '앞으로', disabled: i === 0, onclick: () => { [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]]; paintStrip(); } }, icon('left')),
        h('button', { type: 'button', 'aria-label': '빼기', onclick: () => { const [x] = photos.splice(i, 1); if (x.kind === 'new' && x.preview) URL.revokeObjectURL(x.preview); paintStrip(); } }, icon('close')),
        h('button', { type: 'button', 'aria-label': '뒤로', disabled: i === photos.length - 1, onclick: () => { [photos[i + 1], photos[i]] = [photos[i], photos[i + 1]]; paintStrip(); } }, icon('right')))));
    if (photos.length < MAX_PHOTOS) items.push(h('label', { class: 'thumb add', for: 'pick' }, icon('plus'), h('span', { text: '사진 고르기' })));
    strip.replaceChildren(...items);
    paintRatio();
    paintPreview();
  }
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files].slice(0, MAX_PHOTOS - photos.length);
    if (fileInput.files.length > files.length) toast(`사진은 ${MAX_PHOTOS}장까지예요`, true);
    fileInput.value = '';
    for (const f of files) {
      const slot = { kind: 'new', preview: '' };
      photos.push(slot);
      paintStrip();
      preparing++;
      try { Object.assign(slot, await preparePhoto(f)); }
      catch (e) { photos.splice(photos.indexOf(slot), 1); toast(e.message, true); }
      finally { preparing--; paintStrip(); }
    }
  });
  paintKind(); paintPapers(); paintStrip();
  letterBox.append(
    h('label', { for: 'to', text: '받는 사람' }), to,
    h('label', { for: 'ltext', text: '편지' }), text,
    h('label', { for: 'from', text: '보내는 사람' }), from,
    h('span', { class: 'label', text: '편지지' }), papers);

  const form = h('form', { class: 'composer-form', onsubmit: async (e) => {
    e.preventDefault();
    if (busy) return;
    if (preparing) { status.textContent = '사진을 준비하고 있어요. 잠깐만 기다려 주세요.'; return; }
    if (kind !== 'letter' && !photos.length) { status.textContent = '박제판 사진을 한 장 이상 골라 주세요.'; status.classList.add('bad'); return; }
    if (kind === 'letter' && !photos.length && !text.value.trim()) { status.textContent = '편지 내용을 쓰거나 사진을 골라 주세요.'; status.classList.add('bad'); text.focus(); return; }
    busy = true; submit.disabled = true; status.classList.remove('bad');
    try {
      let id = post?.id;
      const fresh = photos.filter((p) => p.kind === 'new' && !p.f);
      if (fresh.length) {
        status.textContent = '사진을 올릴 준비 중…';
        const up = await ownerCall('upload', id ? { post: id, count: fresh.length } : { count: fresh.length });
        id = up.post;
        for (let i = 0; i < fresh.length; i++) {
          status.textContent = `사진 올리는 중… ${i + 1}/${fresh.length}`;
          await put(up.files[i].full, fresh[i].full);
          await put(up.files[i].thumb, fresh[i].thumb);
          fresh[i].f = up.files[i].full.path;
        }
      }
      // 이번에 새로 고른 사진이 다른 글 번호로 올라갔으면(다시 시도 등) 그 번호를 쓴다
      if (!id) id = photos.find((p) => p.f)?.f.split('/')[1] || randomId(10);
      status.textContent = '저장하는 중…';
      const payload = {
        id, kind, caption: caption.value, donor: donor.value, theme: theme.value, ends: kind === 'first' ? ends.value : '', day: day.value, pinned: pinned.checked,
        photos: photos.map((p) => ({ f: p.f, w: p.w, h: p.h })),
        letter: kind === 'letter' ? { to: to.value, text: text.value, from: from.value, paper } : null
      };
      const r = await ownerCall(editing ? 'edit' : 'post', payload);
      setFeed(r.snap);
      photos.forEach((p) => { if (p.kind === 'new' && p.preview) URL.revokeObjectURL(p.preview); });
      d.dismiss();
      // 올린 글이 보이는 탭으로(달력을 보고 있으면 방금 올린 박제판의 달로)
      if (S.tab === 'cal' && tabOf(kind) === 'board') { if (day.value) S.cal = { ym: day.value.slice(0, 7), day: null }; history.replaceState(history.state, '', urlWith({ m: S.cal.ym, d: null })); }
      else if (!editing && S.tab !== tabOf(kind)) { S.tab = tabOf(kind); history.replaceState(history.state, '', urlWith({ t: S.tab === 'all' ? null : S.tab, m: null, d: null })); }
      refreshAfterChange(id);
      toast(editing ? '고쳤어요' : '올렸어요');
    } catch (err) {
      status.textContent = err.message; status.classList.add('bad');
    } finally { busy = false; submit.disabled = false; }
  } },
    h('div', { class: 'sheet-head' }, h('h2', { text: editing ? '글 고치기' : '새 글 올리기' }),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: async () => { if (!busy && (await maybeLeave())) d.dismiss(); } }, icon('close'))),
    h('div', { class: 'sheet-body stack' },
      kindSeg,
      h('span', { class: 'label', text: '사진' }), photoHint, strip, ratioHint, fileInput,
      letterBox,
      h('div', { class: 'row two' },
        h('div', { class: 'stack' }, h('label', { for: 'donor', text: '후원자 닉네임' }), donor),
        h('div', { class: 'stack' }, h('label', { for: 'theme', text: '스푼 테마' }), theme)),
      endsBox,
      h('label', { for: 'caption', text: '글' }), caption,
      h('div', { class: 'row two' },
        h('div', { class: 'stack' }, h('label', { for: 'day', text: '날짜' }), day),
        h('label', { class: 'check', for: 'pinned' }, pinned, h('span', { text: '맨 위에 고정' }))),
      h('div', { class: 'pv-head' }, h('span', { class: 'label', text: '미리 보기' }), pvSeg),
      h('p', { class: 'muted small', text: '줄바꿈이 실제 화면에서 어떻게 보이는지 확인해 보세요. 글을 고치면 바로 바뀌어요.' }),
      pvBox),
    h('div', { class: 'sheet-foot' }, status, submit));
  for (const el of [caption, donor, theme, ends, day, to, text, from]) el.addEventListener('input', paintPreview);
  pinned.addEventListener('change', paintPreview);
  // 창 너비가 바뀌면 미리 보기 배율만 다시(높이 변화로는 다시 그리지 않는다)
  let pvW = 0;
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (pvBox.clientWidth !== pvW) { pvW = pvBox.clientWidth; paintPreview(); } }).observe(pvBox);
  const dirty = () => photos.some((p) => p.kind === 'new') || caption.value !== (post?.caption || '') || text.value !== (L.text || '')
    || donor.value !== (post?.donor || '') || theme.value !== (post?.theme || '') || ends.value !== (post?.ends || '');
  const maybeLeave = async () => !dirty() || confirmBox('쓰던 내용을 버리고 닫을까요?', '닫기', true);
  const d = sheet(form, { cls: 'composer', label: editing ? '글 고치기' : '새 글 올리기', sticky: true });
  d.addEventListener('cancel', async (e) => { e.preventDefault(); if (!busy && (await maybeLeave())) d.dismiss(); });
}

// ---------- 설정(주인) ----------
function openSettings() {
  const prof = S.feed?.profile || {};
  let avatar = prof.avatar || '';
  let avatarBlob = null, avatarPreview = '';
  const avatarImg = h('div', { class: 'avatar-edit' });
  const paintAvatar = () => avatarImg.replaceChildren(h('img', { class: 'avatar lg', src: avatarPreview || avatarSrc(avatar), alt: '프로필 사진' }));
  paintAvatar();
  const pick = h('input', { type: 'file', accept: 'image/*', class: 'hidden', id: 'avatar-pick' });
  pick.addEventListener('change', async () => {
    const f = pick.files[0]; pick.value = '';
    if (!f) return;
    try {
      const { img, url } = await readImage(f);
      try { avatarBlob = (await shrink(img, 512, 0.88)).blob; } finally { URL.revokeObjectURL(url); }
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      avatarPreview = URL.createObjectURL(avatarBlob);
      paintAvatar();
    } catch (e) { toast(e.message, true); }
  });
  const name = h('input', { class: 'input', id: 'pname', maxlength: '30', value: prof.name || '', placeholder: SITE_NAME });
  const bio = h('textarea', { class: 'input', id: 'pbio', rows: '3', maxlength: '300', value: prof.bio || '', placeholder: '소개를 적어 주세요' });
  const link = h('input', { class: 'input', id: 'plink', type: 'url', maxlength: '300', value: prof.link || '', placeholder: 'https://' });
  const pstatus = h('p', { class: 'status', role: 'status' });
  const save = h('button', { class: 'btn primary', type: 'button', text: '프로필 저장' });
  save.addEventListener('click', async () => {
    save.disabled = true; pstatus.classList.remove('bad');
    try {
      const payload = { name: name.value, bio: bio.value, link: link.value.trim() };
      if (avatarBlob) {
        pstatus.textContent = '사진 올리는 중…';
        const up = await ownerCall('upload', { avatar: true });
        await put(up.files[0].full, avatarBlob);
        payload.avatar = up.files[0].full.path;
      } else if (!avatar && prof.avatar) payload.avatar = '';
      pstatus.textContent = '저장하는 중…';
      const r = await ownerCall('profile', payload);
      setFeed(r.snap);
      avatarBlob = null;
      render();
      pstatus.textContent = '저장했어요';
    } catch (e) { pstatus.textContent = e.message; pstatus.classList.add('bad'); }
    finally { save.disabled = false; }
  });
  const devList = h('ul', { class: 'devices' }, h('li', { class: 'muted', text: '불러오는 중…' }));
  async function loadDevices() {
    try {
      const r = await ownerCall('devices', {});
      devList.replaceChildren(...r.devices.map((dv) => h('li', { class: dv.state === 'approved' ? '' : 'off' },
        h('div', null,
          h('strong', { text: dv.label || '내 기기' }), dv.id === r.me ? h('span', { class: 'tag', text: '이 기기' }) : null,
          h('p', { class: 'muted small', text: dv.state === 'approved' ? `마지막 사용 ${dateText(dv.seen)}` : '막힘' })),
        dv.state === 'approved' && dv.id !== r.me ? h('button', { class: 'btn small', type: 'button', text: '막기', onclick: async () => {
          if (!await confirmBox(`"${dv.label}" 기기에서 더는 글을 올리지 못하게 할까요?`, '막기', true)) return;
          try { await ownerCall('revoke', { id: dv.id }); loadDevices(); } catch (e) { toast(e.message, true); }
        } }) : null)));
    } catch (e) { devList.replaceChildren(h('li', { class: 'bad', text: e.message })); }
  }
  loadDevices();
  const codeOut = h('p', { class: 'code-out', role: 'status' });
  const makeCode = h('button', { class: 'btn', type: 'button', text: '새 기기 등록 코드 만들기', onclick: async () => {
    makeCode.disabled = true;
    try {
      const r = await ownerCall('newcode', {});
      codeOut.replaceChildren(h('strong', { text: r.code }), h('span', { class: 'muted small', text: ` · ${new Date(r.expires).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}까지 한 번 쓸 수 있어요` }));
    } catch (e) { toast(e.message, true); }
    finally { makeCode.disabled = false; }
  } });
  const leave = h('button', { class: 'btn danger', type: 'button', text: '이 기기 등록 풀기', onclick: async () => {
    if (!await confirmBox('이 기기에서 더는 글을 올리지 않게 할까요? 다시 쓰려면 등록 코드가 필요해요.', '등록 풀기', true)) return;
    try {
      const me = await identity({ create: false });
      if (me) { const id = await sha256hex(Uint8Array.from(atob(me.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))); await ownerCall('revoke', { id }).catch(() => {}); }
    } finally {
      await forgetDevice();
      S.owner = false; ls.del('bj_owner');
      d.dismiss(); render(); toast('등록을 풀었어요');
    }
  } });
  const d = sheet(h('div', { class: 'settings' },
    h('div', { class: 'sheet-head' }, h('h2', { text: '설정' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: () => d.dismiss() }, icon('close'))),
    h('div', { class: 'sheet-body stack' },
      h('h3', { text: '프로필' }),
      h('div', { class: 'row' }, avatarImg, h('div', { class: 'stack tight' },
        h('label', { class: 'btn small', for: 'avatar-pick', text: '사진 바꾸기' }),
        h('button', { class: 'btn small', type: 'button', text: '기본 사진으로', onclick: () => { avatar = ''; avatarBlob = null; if (avatarPreview) URL.revokeObjectURL(avatarPreview); avatarPreview = ''; paintAvatar(); } })), pick),
      h('label', { for: 'pname', text: '이름' }), name,
      h('label', { for: 'pbio', text: '소개' }), bio,
      h('label', { for: 'plink', text: '링크 (예: 스푼 방송 주소)' }), link,
      h('div', { class: 'row end' }, pstatus, save),
      h('h3', { text: '주인 기기' }),
      h('p', { class: 'muted small', text: '여기 있는 기기에서만 글을 올리고 고칠 수 있어요.' }),
      devList,
      h('div', { class: 'stack tight' }, makeCode, codeOut),
      h('p', { class: 'muted small', text: '새 휴대폰이나 PC에서 이 사이트 맨 아래 "주인 기기 등록"을 누르고 코드를 넣으면 돼요.' }),
      h('div', { class: 'row end' }, leave)
    )), { cls: 'settings-sheet', label: '설정' });
}

// ---------- 시작 ----------
async function checkOwner() {
  try {
    const me = await identity({ create: false });
    if (!me) { if (S.owner) { S.owner = false; ls.del('bj_owner'); render(); } return; }
    const r = await ownerCall('me', {});
    const on = r.state === 'approved';
    if (on !== S.owner) { S.owner = on; on ? ls.set('bj_owner', '1') : ls.del('bj_owner'); render(); }
  } catch { /* 인터넷 문제면 그대로 둔다 */ }
}
async function refresh(fresh = false) {
  try {
    const before = S.feed?.snapAt || 0;
    setFeed(await fetchFeed(fresh));
    if ((S.feed?.snapAt || 0) !== before) {
      if (!viewer) render();
      else { const id = viewer.dataset.post; render(); if (findPost(id)) viewer.replaceChildren(viewerStage(findPost(id))); }
    }
  } catch (e) {
    if (!S.feed) { $('#app').replaceChildren(h('main', { class: 'wrap narrow' }, h('section', { class: 'card' }, h('h1', { text: '불러오지 못했어요' }), h('p', { text: e.message }), h('button', { class: 'btn primary', type: 'button', text: '다시 불러오기', onclick: () => refresh(true) })))); }
  }
}
// 방문자 수: 이 브라우저는 하루(한국 날짜)에 한 번만 센다. 주인 기기는 세지 않고 수만 본다.
const visitParts = () => ['오늘 ', h('b', { text: num(S.visits.today) }), h('span', { class: 'sep', text: '·' }), '전체 ', h('b', { text: num(S.visits.total) })];
async function countVisit() {
  try {
    const r = await call('visit', { method: 'POST', body: { vid: S.vid, peek: S.owner } });
    S.visits = { today: Number(r.today) || 0, total: Number(r.total) || 0 };
    const el = $('#visits');
    if (el) el.replaceChildren(...visitParts());
  } catch { /* 못 세도 화면은 그대로 */ }
}
(async function start() {
  try { const cached = JSON.parse(ls.get('bj_feed') || 'null'); if (cached?.posts) S.feed = cached; } catch { /* 없음 */ }
  render();
  await refresh();
  const p = param('p');
  if (p && findPost(p)) openViewer(p, { push: false });
  else if (p) history.replaceState(null, '', urlWith({ p: null }));
  countVisit();
  checkOwner();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - (S.feed?.snapAt || 0) > 30000) refresh(); });
})();
