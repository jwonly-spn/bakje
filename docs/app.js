// 추억앨범 — 최초 박제판·박제판을 모아 두는 DJ 개인 SNS(DJ마다 따로 떨어진 앨범, 주소마다 하나).
// 어느 앨범인지: 주소(호스트)로 고른다 — 공개 버킷 h/<호스트>.json(없으면 함수 GET host). 미리 보기(localhost)는 ?album=.
// 보기: 공개 버킷의 snap/<앨범>/feed.json(서버가 글이 바뀔 때마다 새로 씀). 하트·글쓰기: Supabase 함수 bakje.
// 글쓰기는 "주인 기기"만 — 이 브라우저가 만든 열쇠(IndexedDB, 밖으로 못 꺼냄)로 서명한다(BAKJE/1).

const SB = 'https://aksegkhhugqvvaidgvro.supabase.co';
const KEY = 'sb_publishable_45cIqG4dGLSlev-rmNiVDg_uG8szVzD';
const API = SB + '/functions/v1/bakje/';
const PUB = SB + '/storage/v1/object/public/bakje/';
const MAX_PHOTOS = 10;
const PAPERS = [['cream', '크림'], ['rose', '분홍'], ['sky', '하늘'], ['lilac', '라일락'], ['mint', '민트']];
const KIND_NAME = { post: '게시물', board: '박제판', first: '최초 박제판', letter: '박제 편지' };
// 화면 틀(세로 ÷ 가로): 모든 글 9:16. 사진이 틀과 다르면 자르지 않고 남는 곳을 같은 사진으로 흐리게 채운다.
const FRAME = 16 / 9;
// 탭: 게시물 = 일반 게시물(post, 2026-11-05) + 최초 박제판(먼치킨 최초 박제판이 저절로 올라온다) · 박제판 = 올린 박제판 사진 · 달력 = 박제판을 달·날로 골라 보기
const tabOf = (kind) => (kind === 'first' || kind === 'post' ? 'all' : 'board');
const byDate = (list) => [...list].sort((a, b) => b.at - a.at);   // 날짜가 새것 먼저(같으면 서버 차례)
const LEGACY = 'hanijun';   // 한이준 앨범(처음 앨범)
const ALBUM_RE = /^[a-z][a-z0-9-]{1,30}$/;
const HOST = location.hostname.toLowerCase();
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(HOST);
const siteName = () => S.feed?.album?.name || (ALBUM === LEGACY ? '한이준 추억앨범' : '추억앨범');
// 프로필 사진을 따로 올리지 않았을 때(설정 › 사진 바꾸기로 바꾼다) — 한이준 앨범만 그림이 있다
const defaultAvatar = () => (ALBUM === LEGACY ? 'profile.webp' : 'icon.svg');
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
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="8.5" cy="14.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="1" fill="currentColor" stroke="none"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20.5c1.4-3.6 4.4-5.5 8-5.5s6.6 1.9 8 5.5"/>',
  comment: '<path d="M20.5 11.6c0 4.4-3.8 7.9-8.5 7.9-1.3 0-2.6-.3-3.7-.8L3.5 20l1.3-3.9c-.9-1.3-1.3-2.8-1.3-4.5 0-4.4 3.8-7.9 8.5-7.9s8.5 3.5 8.5 7.9z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  block: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>'
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
// 이 탭에서만 기억(휴대폰 본인인증 창에 갔다 돌아올 때 무엇을 하던 중이었는지)
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* 저장 못 해도 됨 */ } },
  del(k) { try { sessionStorage.removeItem(k); } catch { /* 없음 */ } }
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

// ---------- 카카오 로그인·휴대폰 본인인증에서 돌아온 자리 ----------
// 주소에 붙어 온 값(#bjlogin=… · ?bjverify=1&identityVerificationId=…)을 맨 먼저 떼어 두고 주소를 원래대로 돌린다
//  (앨범·탭·글 번호를 읽기 전에 — 본인인증을 시작할 때 있던 주소로 되돌린다).
const RETURN = (() => {
  try {
    const m = /^#(bjlogin|bjlogin-error|bjsso)=([-_A-Za-z0-9]{1,64})$/.exec(location.hash);
    if (m) {
      history.replaceState(history.state, '', location.pathname + location.search);
      return m[1] === 'bjlogin' ? { kind: 'ticket', ticket: m[2] } : m[1] === 'bjsso' ? { kind: 'sso', code: m[2] } : { kind: 'login-error', code: m[2] };
    }
    const q = new URLSearchParams(location.search);
    if (q.get('bjverify') !== '1') return null;
    let saved = null;
    try { saved = JSON.parse(ss.get('bj_verify') || 'null'); } catch { /* 없음 */ }
    ss.del('bj_verify');
    const back = typeof saved?.back === 'string' && /^(\?.*)?$/.test(saved.back) && !saved.back.includes('bjverify') ? saved.back : '';
    history.replaceState(null, '', location.pathname + back);
    const id = q.get('identityVerificationId') || '';
    return {
      kind: 'verify', mode: saved?.mode === 'find' || saved?.mode === 'join' ? saved.mode : '', savedId: typeof saved?.id === 'string' ? saved.id : '',
      id: /^[-_A-Za-z0-9]{4,80}$/.test(id) ? id : '', code: q.get('code') || '', message: (q.get('message') || '').slice(0, 200)
    };
  } catch { return null; }
})();

// ---------- 어느 앨범인지 ----------
// 한 번 알아낸 앨범은 이 브라우저에 기억해 두고(다음엔 바로 그린다), 뒤에서 다시 확인한다.
const albumParam = LOCAL ? (param('album') || '') : '';
let ALBUM = ALBUM_RE.test(albumParam) ? albumParam : (ls.get('bj_album') || (LOCAL ? LEGACY : ''));
async function resolveAlbum() {
  if (LOCAL) return ALBUM;
  try {
    const r = await fetch(PUB + 'h/' + HOST + '.json?t=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (ALBUM_RE.test(j?.album || '')) return j.album; }
  } catch { /* 함수로 */ }
  try { const j = await call('host', { query: { h: HOST } }); if (ALBUM_RE.test(j.album || '')) return j.album; }
  catch (e) { if (e.status === 404) return null; }
  return ALBUM || undefined;   // 인터넷 문제: 기억한 앨범(없으면 모름)
}
const feedKey = () => (ALBUM === LEGACY ? 'bj_feed' : 'bj_feed:' + ALBUM);

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
// session: 회원 로그인 표(x-bj-session)를 함께 보낸다(있을 때만)
async function call(path, { method = 'GET', body, query = {}, timeout = 25000, session = false } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const sess = session && S.session ? { 'x-bj-session': S.session } : {};
  let res;
  try {
    const qs = method === 'GET' ? '?' + new URLSearchParams({ apikey: KEY, ...(ALBUM ? { album: ALBUM } : {}), ...query }) : '';
    res = await fetch(API + path + qs, {
      method, signal: ctl.signal, cache: 'no-store',
      headers: method === 'GET' ? sess : { apikey: KEY, 'Content-Type': 'application/json', ...sess },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw Object.assign(Error('인터넷 연결을 확인해 주세요.'), { status: 0 });
  } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { /* 아래 */ }
  if (!res.ok || !data?.ok) throw Object.assign(Error(data?.error || '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.'), { status: res.status, data });
  return data;
}
// 주인 요청에는 늘 이 앨범을 넣는다(서명 안 — 다른 앨범 주소에서 쓸 수 없다)
// 주인 동작: 이 기기가 주인 기기면 기기 서명, 아니면 DJ 계정(로그인 + 이 앨범 연결)으로(2026-11-05)
const acctOwner = () => Boolean(S.session && Array.isArray(S.owns) && S.owns.includes(ALBUM));
const ownerCall = async (action, payload) => (acctOwner() && ls.get('bj_owner') !== '1')
  ? call('owner', { method: 'POST', body: { action, payload: { ...payload, album: ALBUM } }, session: true })
  : call('owner', { method: 'POST', body: await signed(action, { ...payload, album: ALBUM }) });
// 주인 표시 = 주인 기기 또는 DJ 계정
function syncOwner() {
  const on = ls.get('bj_owner') === '1' || acctOwner();
  if (on !== S.owner) { S.owner = on; render(); }
}
async function fetchFeed(fresh) {
  try {
    const r = await fetch(PUB + `snap/${ALBUM}/feed.json?t=` + (fresh ? Date.now() : Math.floor(Date.now() / 10000)), { cache: 'no-store' });
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
  cal: calFromUrl(),   // 달력: {ym: 'YYYY-MM' | null(가장 최근 박제판이 있는 달), day: 'YYYY-MM-DD' | null(그 달 전체)}
  // 회원: members = 서버의 회원 설정(없으면 예전 서버 — 회원·댓글 화면을 숨긴다), session = 로그인 표(이 주소의 localStorage), me = 내 계정
  members: null,
  session: /^[-_A-Za-z0-9]{43}$/.test(ls.get('bj_session') || '') ? ls.get('bj_session') : '',
  me: null,
  owns: [],      // 내 계정이 관리하는 앨범(DJ 계정) — 서버 me 의 owns
  banned: false
};
if (S.session) {
  try { const m = JSON.parse(ls.get('bj_me') || 'null'); if (m && typeof m.id === 'string') S.me = m; } catch { /* 없음 */ }
  try { const o = JSON.parse(ls.get('bj_owns') || '[]'); if (Array.isArray(o)) S.owns = o.filter((x) => typeof x === 'string'); } catch { /* 없음 */ }
  if (S.owns.includes(ALBUM)) S.owner = true;
}
const posts = () => S.feed?.posts || [];
const findPost = (id) => posts().find((p) => p.id === id);
// 지금 보이는 글(큰 화면의 이전·다음 차례와 같다): 날짜가 새것 먼저. 달력 탭은 고른 달·날의 박제판
function shown() {
  if (S.tab === 'cal') return calSelection();
  return byDate(posts().filter((p) => tabOf(p.kind) === S.tab));
}
const profileName = () => S.feed?.profile?.name || siteName();
function setFeed(feed) {
  if (!feed || !Array.isArray(feed.posts)) return;
  if (S.feed && feed.snapAt < S.feed.snapAt) return;
  S.feed = feed;
  try { ls.set(feedKey(), JSON.stringify(feed)); } catch { /* 너무 크면 안 남김 */ }
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
const avatarSrc = (path) => (path ? photoUrl(path) : defaultAvatar());
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
// 사진 비율(세로 ÷ 가로) — 휴대폰 큰 화면의 사진 칸 높이. 아주 극단적인 사진만 0.25~4 로 막는다.
const photoRatio = (ph) => (ph?.w > 0 && ph?.h > 0 ? String(Math.min(4, Math.max(0.25, ph.h / ph.w))) : '');
// 사진 넘기기: 사진은 자르지 않는다(contain). 휴대폰은 칸이 사진 비율 그대로, PC 는 남는 곳이 검정(2026-11-05)
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
      // 휴대폰: 사진 칸 높이를 지금 사진 비율에 맞춘다(사진마다 비율이 달라도 여백 없이)
      if (list[i]) wrap.closest('.post')?.style.setProperty('--pratio', photoRatio(list[i]));
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
  const talk = !preview && !!S.members;   // 댓글(서버가 회원 기능을 아는 판일 때만)
  const actions = h('div', { class: 'p-actions' },
    heartButton(post),
    talk ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '댓글 달기', onclick: () => focusComposer(post.id) }, icon('comment')) : null,
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
    post.caption ? h('p', { class: 'p-caption', text: post.caption }) : null,
    talk ? h('section', { class: 'cm', 'aria-label': '댓글', dataset: { comments: post.id } }) : null);
  const card = h('article', { class: 'post in-viewer' + (preview ? ' is-preview' : '') + (talk ? ' has-compose' : ''), dataset: { post: post.id } },
    head, media, actions, body, talk ? h('div', { class: 'p-compose', dataset: { compose: post.id } }) : null);
  card.style.setProperty('--ratio', String(FRAME));
  // 휴대폰(2026-11-04 사용자 "모바일에서 이런 여백들이 너무 거슬려"): 사진 칸을 첫 사진 비율(세로/가로) 그대로 — 화면 너비를 꽉 채우고 흐린 여백이 없다.
  //  비율이 너무 극단이면 0.5~2 사이로(나머지는 예전처럼 흐린 채움). 넓은 화면은 9:16 틀 그대로(--ratio).
  const p0 = hasPhotos ? post.photos[0] : null;
  if (photoRatio(p0)) card.style.setProperty('--pratio', photoRatio(p0));   // 넘기면 carousel 이 그 사진 비율로 바꾼다
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
  // 댓글 수(cc — 서버가 미리 만든 목록에 있을 때만, 0이면 안 보임 · 회원 기능을 숨긴 동안은 안 보임)
  const cc = S.members && Number(post.cc) > 0 ? Number(post.cc) : 0;
  const badges = h('span', { class: 'badges' },
    cc ? h('span', { class: 'cc' }, icon('comment', 'fillable'), h('span', { text: num(cc) })) : null,
    post.pinned ? icon('pin') : null,
    post.photos?.length > 1 ? icon('stack') : null,
    post.kind === 'letter' && first ? icon('letter') : null);
  const over = h('span', { class: 't-over' },
    h('span', { class: 'o-item' }, icon('heart', 'fillable'), h('span', { dataset: { heartsOf: post.id }, text: num(post.hearts) })),
    cc ? h('span', { class: 'o-item' }, icon('comment', 'fillable'), h('span', { text: num(cc) })) : null);
  const endLabel = fi ? endsInfo(post)?.long : '';
  return h('button', { class: 'tile', type: 'button', 'aria-label': `${KIND_NAME[post.kind]} · ${post.donor ? post.donor + ' · ' : ''}${endLabel ? endLabel + ' · ' : ''}${cc ? `댓글 ${num(cc)}개 · ` : ''}${dateText(post.at)} 열기`, onclick: () => openViewer(post.id) },
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
  const stage = h('div', { class: 'v-stage', onclick: (e) => { if (e.target.classList.contains('v-stage')) closeViewer(); } },
    h('button', { class: 'v-close', type: 'button', 'aria-label': '닫기', onclick: () => closeViewer() }, icon('close')),
    prev ? h('button', { class: 'v-nav prev', type: 'button', 'aria-label': '이전 글', onclick: () => openViewer(prev.id, { replace: true }) }, icon('left')) : null,
    postCard(post),
    next ? h('button', { class: 'v-nav next', type: 'button', 'aria-label': '다음 글', onclick: () => openViewer(next.id, { replace: true }) }, icon('right')) : null);
  if (S.members) paintComments(post.id, stage);   // 받아 둔 댓글이 있으면 바로 그린다(새로 받는 건 openViewer)
  return stage;
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
      if (e.target?.closest?.('textarea, input')) return;   // 댓글을 쓰는 중에는 글을 넘기지 않는다
      const b = viewer?.querySelector(e.key === 'ArrowLeft' ? '.v-nav.prev' : '.v-nav.next');
      if (b) { e.preventDefault(); b.click(); }
    });
    document.body.append(viewer);
    viewer.showModal();
  }
  viewer.dataset.post = id;
  if (S.members) loadComments(id);
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
      h('a', { class: 'brand', href: './', text: siteName() }),
      h('div', { class: 'row' },
        S.owner ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '새 게시물', title: '새 게시물', onclick: () => openComposer() }, icon('plus-square')) : null,
        S.owner ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '설정', title: '설정', onclick: () => openSettings() }, icon('gear')) : null,
        !S.owner ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': '이 앨범 링크 공유', title: '링크 공유', onclick: () => sharePost(null) }, icon('share')) : null,
        h('span', { id: 'member-slot', class: 'member-slot' }, memberButton()))));
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
    h('p', null, siteName(), !S.owner ? [' · ', h('a', { href: '?owner', text: '주인 기기 등록' })] : null),
    S.members ? h('p', { class: 'foot-links' },
      h('a', { href: 'terms.html', target: '_blank', rel: 'noopener', text: '이용약관' }), ' · ',
      h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener', text: '개인정보처리방침' })) : null,
    // 운영자 사업자 정보(결제·본인인증 회사 심사용 — 모든 앨범 같은 운영자)
    h('p', { class: 'foot-biz', text: '제이원스튜디오 · 대표 이지원 · 사업자등록번호 174-93-02335 · 대구광역시 수성구 동대구로 336 · likegorogoro@naver.com' }));
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
  // 새 글: 지금 보는 탭에 맞춰(게시물 탭 → 일반 게시물, 박제판·달력 탭 → 박제판)
  let kind = KIND_NAME[post?.kind] ? post.kind : (S.tab === 'all' ? 'post' : 'board');
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

  // 종류 = 올라갈 탭(2026-11-05 사용자 "탭은 게시물·박제판인데 올릴 땐 박제판·최초 박제판이라 이상해 · 어느 걸 누른 건지 모르겠어"):
  //  일반 게시물·최초 박제판 → 게시물 탭, 박제판 → 박제판·달력 탭. 고른 것은 파란 칸 + 체크. 예전 박제 편지 글을 고칠 때만 편지가 보인다.
  const KINDS = [['post', '일반 게시물', 'grid', '게시물 탭'], ['board', '박제판', 'photo', '박제판 탭'], ['first', '최초 박제판', 'trophy', '게시물 탭'],
    ...(post?.kind === 'letter' ? [['letter', '박제 편지', 'letter', '박제판 탭']] : [])];
  function paintKind() {
    kindSeg.replaceChildren(...KINDS.map(([k, label, ic, where]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(kind === k), class: 'kind-opt' + (kind === k ? ' on' : ''),
      onclick: () => { kind = k; paintKind(); paintStrip(); }
    }, h('span', { class: 'kind-top' }, kind === k ? icon('check') : icon(ic), label), h('span', { class: 'kind-where', text: where }))));
    letterBox.hidden = kind !== 'letter';
    endsBox.hidden = kind !== 'first';
    boardRow.hidden = kind === 'post';
    photoHint.textContent = kind === 'post' ? `사진을 골라 주세요 (${MAX_PHOTOS}장까지 · 어떤 비율이든 괜찮아요)`
      : kind === 'board' ? `9:16 박제판 사진을 골라 주세요 (${MAX_PHOTOS}장까지)`
      : kind === 'first' ? '최초 박제판 사진을 골라 주세요 (먼치킨 최초 박제판은 저절로 올라와요)'
      : '편지를 그림으로 올리려면 9:16 사진을 골라 주세요 (안 골라도 돼요)';
    caption.placeholder = kind === 'letter' ? '한마디 더 적어 보세요 (안 써도 돼요)' : kind === 'post' ? '이야기를 적어 보세요 (안 써도 돼요)' : '이 박제판 이야기를 적어 보세요 (안 써도 돼요)';
  }
  // 박제판 사진이 9:16 이 아니면 알려 준다(일반 게시물은 어떤 비율이든 그대로)
  function paintRatio() {
    const off = kind === 'post' ? 0 : photos.filter((p) => p.w && p.h && Math.abs(p.h / p.w - FRAME) / FRAME > 0.03).length;
    ratioHint.textContent = off ? `${off}장은 9:16 사진이 아니에요. 휴대폰에선 사진 비율 그대로, PC에선 남는 곳이 검게 보여요.` : '';
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
  // 후원자 닉네임·스푼 테마(박제판만 — 일반 게시물에선 숨김)
  const boardRow = h('div', { class: 'row two' },
    h('div', { class: 'stack' }, h('label', { for: 'donor', text: '후원자 닉네임' }), donor),
    h('div', { class: 'stack' }, h('label', { for: 'theme', text: '스푼 테마' }), theme));
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
    if (kind !== 'letter' && !photos.length) { status.textContent = '사진을 한 장 이상 골라 주세요.'; status.classList.add('bad'); return; }
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
      boardRow,
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

// ---------- 프로필 사진 1:1 자르기(정사각형이 아닌 사진을 골랐을 때) ----------
// 끌어서 옮기기 · 손가락 두 개/휠/막대로 확대. 고른 영역을 512×512 JPEG 로 돌려준다(그만두면 null).
function cropSquare(img) {
  return new Promise((resolve) => {
    const W = img.naturalWidth, H = img.naturalHeight;
    const S = Math.max(200, Math.min(320, window.innerWidth - 72));
    const base = S / Math.min(W, H);
    let z = 1, ox = 0, oy = 0, result = null;
    const pic = h('img', { class: 'crop-img', src: img.src, alt: '', draggable: 'false' });
    const stage = h('div', { class: 'crop-stage' }, pic, h('div', { class: 'crop-ring' }));
    stage.style.width = stage.style.height = S + 'px';             // CSP: style 속성은 막혀 있어 CSSOM 으로
    const range = h('input', { class: 'crop-zoom', type: 'range', min: '100', max: '400', value: '100', 'aria-label': '확대' });
    const clamp = () => {
      const sc = base * z, dw = W * sc, dh = H * sc;
      ox = Math.min(0, Math.max(S - dw, ox)); oy = Math.min(0, Math.max(S - dh, oy));
      pic.style.width = dw + 'px'; pic.style.height = dh + 'px';
      pic.style.transform = `translate(${ox}px, ${oy}px)`;
    };
    // (cx, cy) 자리를 그대로 두고 확대
    const zoomAt = (nz, cx = S / 2, cy = S / 2) => {
      nz = Math.min(4, Math.max(1, nz));
      const sc = base * z, ns = base * nz;
      ox = cx - (cx - ox) / sc * ns; oy = cy - (cy - oy) / sc * ns;
      z = nz; range.value = String(Math.round(z * 100)); clamp();
    };
    // 처음: 가운데(세로로 긴 사진은 얼굴이 위쪽에 있는 일이 많아 위에서 1/4 쯤)
    ox = (S - W * base) / 2; oy = H > W ? -(H * base - S) / 4 : (S - H * base) / 2; clamp();
    range.addEventListener('input', () => zoomAt(Number(range.value) / 100));
    const pts = new Map();
    let last = null;
    const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const pinch = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, local(e)); last = pts.size === 2 ? pinch() : null; });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e), prev = pts.get(e.pointerId);
      pts.set(e.pointerId, p);
      if (pts.size === 1) { ox += p.x - prev.x; oy += p.y - prev.y; clamp(); }
      else if (pts.size === 2) { const now = pinch(); if (last && last.d > 0) { ox += now.x - last.x; oy += now.y - last.y; zoomAt(z * now.d / last.d, now.x, now.y); } last = now; }
    });
    const up = (e) => { pts.delete(e.pointerId); last = pts.size === 2 ? pinch() : null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), p.x, p.y); }, { passive: false });
    const ok = h('button', { class: 'btn primary', type: 'button', text: '이 영역으로 쓰기' });
    ok.addEventListener('click', () => {
      const sc = base * z, side = S / sc;
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, 512, 512);
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, -ox / sc, -oy / sc, side, side, 0, 0, 512, 512);
      ok.disabled = true;
      c.toBlob((b) => { c.width = c.height = 0; result = b; d.dismiss(); }, 'image/jpeg', 0.88);
    });
    const d = sheet(h('div', { class: 'crop' },
      h('div', { class: 'sheet-head' }, h('h2', { text: '프로필 사진 영역 고르기' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: () => d.dismiss() }, icon('close'))),
      h('div', { class: 'sheet-body stack' },
        h('p', { class: 'muted small', text: '사진을 끌어서 옮기고, 아래 막대(휴대폰은 두 손가락)로 크기를 맞춰 주세요.' }),
        stage, range,
        h('div', { class: 'row end' }, h('button', { class: 'btn', type: 'button', text: '그만두기', onclick: () => d.dismiss() }), ok))
    ), { label: '프로필 사진 영역 고르기', sticky: true, onClose: () => resolve(result) });
  });
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
      let blob = null;
      try {
        // 정사각형(2% 안)이면 그대로, 아니면 1:1 영역을 고르게 한다
        const W = img.naturalWidth, H = img.naturalHeight;
        blob = Math.abs(W - H) <= Math.max(W, H) * 0.02 ? (await shrink(img, 512, 0.88)).blob : await cropSquare(img);
      } finally { URL.revokeObjectURL(url); }
      if (!blob) return;
      avatarBlob = blob;
      if (avatarPreview) URL.revokeObjectURL(avatarPreview);
      avatarPreview = URL.createObjectURL(avatarBlob);
      paintAvatar();
    } catch (e) { toast(e.message, true); }
  });
  const name = h('input', { class: 'input', id: 'pname', maxlength: '30', value: prof.name || '', placeholder: siteName() });
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
      S.members ? ownerCommentSettings(() => d.dismiss()) : null,
      h('h3', { text: '관리 · 주인 기기' }),
      h('p', { class: 'muted small', text: '앨범에 연결한 DJ 계정과, 여기 있는 주인 기기에서 글을 올리고 고칠 수 있어요.' }),
      devList,
      h('div', { class: 'stack tight' }, makeCode, codeOut),
      h('p', { class: 'muted small', text: '이 코드는 다른 DJ 계정을 이 앨범에 연결할 때(내 정보 › DJ 계정으로 이 앨범 관리하기)나, 이 사이트 맨 아래 "주인 기기 등록"에 넣으면 돼요.' }),
      ls.get('bj_owner') === '1' ? h('div', { class: 'row end' }, leave) : h('p', { class: 'muted small', text: 'DJ 계정으로 관리하고 있어요. 다른 기기에서도 로그인만 하면 돼요.' })
    )), { cls: 'settings-sheet', label: '설정' });
}

// ---------- 회원(로그인·가입·본인인증) ----------
// 한 계정을 모든 앨범에서 쓰지만, 로그인은 주소(앨범 사이트)마다 따로다 — 로그인 표는 이 주소의 localStorage(bj_session).
// 서버가 예전 판이라 members-config 가 없으면 회원·댓글 화면은 모두 숨긴다(S.members = null).
// 본인인증은 포트원 V2 브라우저 SDK(누를 때만 불러온다). PC 는 결과가 바로 오고, 휴대폰은 ?bjverify=1 로 돌아온다(RETURN).
const PORTONE_SDK = 'https://cdn.portone.io/v2/browser-sdk.js';
const NO_SESSION = new Set(['signup', 'login', 'ticket', 'find-start', 'find-done', 'reset']);
const LOGIN_ID_RE = /^[a-z0-9_]{4,20}$/;
const VERIFY_TEXT = '악플을 막으려고 휴대폰 본인인증을 한 번 해요. 이름·전화번호·생년월일은 저장하지 않아요. 만 14세 이상만 가입할 수 있어요.';
const KAKAO_ERRORS = {
  cancel: '카카오 로그인을 그만뒀어요.',
  fail: '카카오 로그인을 하지 못했어요. 다시 해 주세요.',
  banned: '이용이 막힌 계정이에요.',
  setup: '카카오 로그인 준비 중이에요.',
  'sso-none': '다른 추억앨범에서 로그인한 기록이 없어요. 여기서 로그인해 주세요.'
};
// 시험용: 주소에 ?members=1 이 있으면(이 탭에서는 계속) 본인인증이 아직 준비되지 않았어도 회원·댓글 화면을 보인다
if (param('members') === '1') ss.set('bj_members_test', '1');
const membersTest = () => ss.get('bj_members_test') === '1';
// 'ok' · 'old'(예전 서버 — 회원 기능 없음) · 'hidden'(본인인증이 아직 준비 안 됨 — 회원·댓글을 모두 숨김) · 'net'(인터넷 문제)
async function loadMembersConfig() {
  try {
    const m = (await call('members-config')).members;
    if (!m || typeof m !== 'object') return 'old';
    const v = m.verify;
    const verify = v && typeof v.storeId === 'string' && v.storeId && typeof v.channelKey === 'string' && v.channelKey ? { storeId: v.storeId, channelKey: v.channelKey } : null;
    if (!verify && !membersTest()) return 'hidden';
    S.members = { password: m.password !== false, kakao: m.kakao === true, verify };
    return 'ok';
  } catch (e) { return e.status === 0 ? 'net' : 'old'; }
}
function saveMe(member, banned) {
  S.me = member && typeof member.id === 'string' ? member : null;
  if (banned !== undefined) S.banned = banned === true;
  if (S.me) ls.set('bj_me', JSON.stringify(S.me)); else ls.del('bj_me');
}
function setSession(token, member) {
  if (!/^[-_A-Za-z0-9]{43}$/.test(token || '')) throw Error('로그인을 처음부터 다시 해 주세요.');
  S.session = token;
  ls.set('bj_session', token);
  saveMe(member, false);
  memberChanged();
}
function setOwns(list) {
  S.owns = Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  if (S.owns.length) ls.set('bj_owns', JSON.stringify(S.owns)); else ls.del('bj_owns');
  syncOwner();
}
function dropSession() {
  const had = Boolean(S.session || S.me);
  S.session = '';
  ls.del('bj_session');
  saveMe(null, false);
  setOwns([]);
  if (had) memberChanged();
}
// 로그아웃 = 모든 추억앨범에서(서버가 이 계정의 세션을 모두 지운다 — 다른 앨범 주소도 다음에 열면 로그아웃)
async function logoutAll() {
  await memberCall('logout').catch(() => {});
  dropSession();
  ls.del('bj_sso_at'); ss.set('bj_sso_tried', '1');
}
// ---- 앨범 사이 로그인 이어 주기(2026-11-05) ----
// 다른 DJ 앨범 주소(예: 한이준.com ↔ 도담.먼치킨.com)는 로그인 표를 서로 못 보므로, 서버 주소에 쿠키를 하나 맡겨 둔다(sso-set).
//  열 때: 로그인 표가 없으면 그 쿠키로 바로 로그인(쿠키를 막는 브라우저는 로그인 창의 "다른 앨범 계정으로 계속" 한 번)
const SSO_FRESH_MS = 50 * 86400000;
async function trySso() {
  if (S.session || ss.get('bj_sso_tried')) return;
  ss.set('bj_sso_tried', '1');
  try {
    const r = await fetch(API + 'sso-check?' + new URLSearchParams({ h: location.host }), { credentials: 'include', cache: 'no-store' }).then((x) => x.json());
    if (!r?.ticket || S.session) return;
    const t = await memberCall('ticket', { ticket: r.ticket });
    setSession(t.session, t.member);
    ls.set('bj_sso_at', String(Date.now()));
    await loadMe();
    toast('다른 추억앨범에서 로그인한 계정으로 이어서 로그인했어요');
  } catch { /* 조용히 — 로그인 단추로 하면 된다 */ }
}
// 로그인한 뒤: 서버에 쿠키를 맡겨 둔다(이미 있으면 그대로, 없으면 서버 주소에 잠깐 들렀다 돌아온다 — 50일에 한 번쯤)
async function ssoRemember() {
  if (!S.session || Date.now() - Number(ls.get('bj_sso_at') || 0) < SSO_FRESH_MS) return;
  try {
    const r = await fetch(API + 'sso-check?' + new URLSearchParams({ h: location.host, peek: '1' }), { credentials: 'include', cache: 'no-store' }).then((x) => x.json());
    if (r?.has) { ls.set('bj_sso_at', String(Date.now())); return; }
    const t = await memberCall('sso-ticket');
    location.href = API + 'sso-set?' + new URLSearchParams({ t: t.ticket, h: location.host, r: location.pathname + location.search });
  } catch { /* 다음에 다시 */ }
}
function ssoContinue() {
  location.href = API + 'sso?' + new URLSearchParams({ h: location.host, r: location.pathname + location.search });
}
// 로그인·로그아웃·닉네임·본인인증이 바뀌면: 맨 위 줄 + 열린 글의 댓글(내 댓글·쓰기 칸)
function memberChanged() {
  syncOwner();
  paintMember();
  if (!S.session) for (const st of CM.values()) {
    st.list?.forEach((c) => { c.mine = false; });
    if (st.me) st.me = { can: false, why: st.off ? 'off' : 'login' };
  }
  const id = viewer?.dataset.post;
  if (id) { paintComments(id); loadComments(id); }
}
async function memberCall(action, body = {}) {
  const auth = !NO_SESSION.has(action);
  try { return await call('member', { method: 'POST', body: { action, ...body }, session: auth }); }
  catch (e) { if (auth && e.status === 401) dropSession(); throw e; }
}
async function commentCall(action, body = {}) {
  try { return await call('comment', { method: 'POST', body: { action, ...body }, session: true }); }
  catch (e) { if (e.status === 401) dropSession(); throw e; }
}
async function loadMe() {
  if (!S.session) { saveMe(null, false); return; }
  try { const r = await memberCall('me'); saveMe(r.member, r.banned === true); setOwns(r.owns); }
  catch { /* 401 이면 이미 로그아웃했고, 인터넷 문제면 기억해 둔 계정으로 */ }
}

// 맨 위 줄: 로그인 전 "로그인", 로그인 뒤 닉네임(할 일이 남았으면 빨간 점)
function memberButton() {
  if (!S.members) return null;
  if (!S.me) return h('button', { class: 'btn small primary login-btn', type: 'button', text: '로그인', onclick: () => openAccount('login') });
  const todo = !S.me.verified || !S.me.nickname;
  return h('button', { class: 'me-btn', type: 'button', title: '내 정보', 'aria-label': `내 정보${S.me.nickname ? ' · ' + S.me.nickname : ''}${todo ? ' · 할 일이 남았어요' : ''}`, onclick: () => openAccount('me') },
    icon('user'), h('span', { class: 'me-name', text: S.me.nickname || '내 정보' }), todo ? h('i', { class: 'me-dot', 'aria-hidden': 'true' }) : null);
}
function paintMember() {
  const slot = $('#member-slot');
  if (slot) slot.replaceChildren(...[memberButton()].filter(Boolean));
}

// ---------- 회원 창(로그인·가입·본인인증·닉네임·찾기·내 정보) — 한 창 안에서 단계만 바꾼다 ----------
let acct = null;   // {d, box, step}
function openAccount(step, data = {}) {
  if (!S.members) return null;
  if (!acct) {
    const box = h('div', { class: 'acct' });
    const d = sheet(box, { cls: 'small acct-sheet', label: '회원', sticky: true, onClose: () => { if (acct?.d === d) acct = null; } });
    acct = { d, box, step: '' };
  }
  showStep(step, data);
  return acct;
}
function closeAccount() { acct?.d.dismiss(); }
function showStep(step, data = {}) {
  if (!acct) return void openAccount(step, data);
  const v = (STEPS[step] || STEPS.login)(data || {});
  acct.step = v.name || step;
  const head = h('div', { class: 'sheet-head' },
    v.back ? h('button', { class: 'icon-btn sheet-back', type: 'button', 'aria-label': '뒤로', onclick: () => showStep(v.back, v.backData || {}) }, icon('left')) : null,
    h('h2', { text: v.title }),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': '닫기', onclick: () => closeAccount() }, icon('close')));
  const body = h('div', { class: 'sheet-body stack acct-body' }, v.body);
  acct.box.replaceChildren(head, body);
  acct.d.setAttribute('aria-label', v.title);
  if (v.focus && !matchMedia('(pointer: coarse)').matches) setTimeout(() => v.focus.focus(), 30);
  v.after?.();
}
const statusEl = () => h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
function say(el, message, bad = false) { el.textContent = message || ''; el.classList.toggle('bad', !!bad); }
async function busy(btn, st, fn) {
  if (btn.dataset.busy) return;
  btn.dataset.busy = '1'; btn.disabled = true; say(st, '');
  try { await fn(); } catch (e) { say(st, e.message, true); } finally { delete btn.dataset.busy; btn.disabled = false; }
}
const linkBtn = (text, onclick) => h('button', { class: 'link-btn', type: 'button', text, onclick });
function field(id, label, input, hint) {
  if (hint) input.setAttribute('aria-describedby', id + '-hint');
  return [h('label', { for: id, text: label }), input, hint ? h('p', { class: 'field-hint', id: id + '-hint', text: hint }) : null];
}
const pwInput = (id, auto) => h('input', { class: 'input', id, type: 'password', autocomplete: auto, maxlength: '64' });
function checkNewPassword(pw, pw2) {
  const n = [...pw.value].length;
  if (n < 8 || n > 64) { pw.focus(); return '비밀번호는 8~64자로 정해 주세요.'; }
  if (pw.value !== pw2.value) { pw2.focus(); return '비밀번호 두 칸이 서로 달라요.'; }
  return '';
}
// 가입 단계 표시(1 가입 → 2 본인인증 → 3 닉네임)
function joinSteps(at) {
  return h('ol', { class: 'join-steps', 'aria-label': `가입 ${at}단계 (모두 3단계)` }, ['가입', '본인인증', '닉네임'].map((t, i) =>
    h('li', { class: i + 1 === at ? 'on' : i + 1 < at ? 'done' : '' }, h('b', null, i + 1 < at ? icon('check') : String(i + 1)), h('span', { text: t }))));
}
// 카카오 로그인 단추(카카오 디자인 안내: 노란 #FEE500 · 검은 말풍선 · 글자 85% 검정 · 모서리 12px)
function kakaoSymbol() {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 18 18');
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('class', 'kakao-sym');
  el.innerHTML = '<path fill="#000" d="M9 1.6C4.58 1.6 1 4.4 1 7.86c0 2.21 1.47 4.16 3.69 5.27l-.94 3.45c-.08.3.26.55.52.38l4.12-2.72c.2.02.4.02.61.02 4.42 0 8-2.8 8-6.4S13.42 1.6 9 1.6z"/>';
  return el;
}
function kakaoButton() {
  return h('button', { class: 'kakao-btn', type: 'button', onclick: () => kakaoLogin() }, kakaoSymbol(), h('span', { text: '카카오 로그인' }));
}
// 카카오에서 돌아오면 같은 주소 #bjlogin=<표> (RETURN → handleReturn)
function kakaoLogin() {
  location.href = API + 'kakao-start?' + new URLSearchParams({ apikey: KEY, h: location.host, r: location.pathname + location.search });
}
function afterLogin(message) {
  toast(message);
  if (S.me && !S.me.verified) openAccount('verify', { join: true });
  else if (S.me && !S.me.nickname) openAccount('nickname', { join: true });
  else { closeAccount(); afterJoin(); }
}
// 가입·로그인을 다 마친 뒤: DJ 로 가입했으면 앨범 연결로, 아니면 서버에 로그인 맡겨 두기
function afterJoin() {
  if (ss.get('bj_join_role') === 'dj' && !acctOwner()) { openAccount('claim', { join: true }); return; }
  ss.del('bj_join_role');
  ssoRemember();
}

// 포트원 본인인증 SDK — 처음 쓸 때만 불러온다(본인인증 단계를 열면 미리 받아 둔다)
let portoneLoading = null;
function loadPortOne() {
  if (window.PortOne?.requestIdentityVerification) return Promise.resolve(window.PortOne);
  if (portoneLoading) return portoneLoading;
  portoneLoading = new Promise((resolve, reject) => {
    const s = h('script', {
      src: PORTONE_SDK, async: true,
      onload: () => (window.PortOne?.requestIdentityVerification ? resolve(window.PortOne) : reject(Error('본인인증 창을 열지 못했어요. 다시 해 주세요.'))),
      onerror: () => { portoneLoading = null; s.remove(); reject(Error('본인인증 창을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); }
    });
    document.head.append(s);
  });
  return portoneLoading;
}
// mode: 'join'(내 계정 본인인증) · 'find'(아이디·비밀번호 찾기). PC 는 끝난 본인인증 번호를 돌려주고,
//  휴대폰은 본인인증 창으로 넘어갔다가 ?bjverify=1 로 돌아온다(이 함수는 끝나지 않는다).
async function portoneVerify(mode) {
  const cfg = S.members?.verify;
  if (!cfg) throw Error('본인인증 준비 중이에요. 조금 뒤에 다시 해 주세요.');
  const sdk = loadPortOne();
  sdk.catch(() => {});
  const { id } = await memberCall(mode === 'find' ? 'find-start' : 'verify-start');
  const PortOne = await sdk;
  ss.set('bj_verify', JSON.stringify({ mode, id, back: location.search, at: Date.now() }));
  let res;
  try {
    res = await PortOne.requestIdentityVerification({
      storeId: cfg.storeId, identityVerificationId: id, channelKey: cfg.channelKey,
      redirectUrl: location.origin + location.pathname + '?bjverify=1',
      // 다날: 만 14세 미만은 인증 창에서부터 막고(서버도 다시 확인한다), 인증 창에 서비스 이름을 보인다.
      // KG이니시스 통합인증(포트원 시험 채널은 이것만 있음): 고객 정보를 미리 채우지 않음(flgFixedUser 는 꼭 넣어야 함).
      // 채널의 결제대행사 것만 쓰이고 나머지는 무시된다.
      bypass: { danal: { AGELIMIT: 14, CPTITLE: '먼치킨 추억앨범' }, inicisUnified: { flgFixedUser: 'N' } }
    });
  } catch (e) {
    ss.del('bj_verify');
    throw Error(e?.message || '본인인증 창을 열지 못했어요. 다시 해 주세요.');
  }
  ss.del('bj_verify');
  if (!res) throw Error('본인인증 결과를 받지 못했어요. 다시 해 주세요.');
  if (res.code != null) throw Error(res.message || '본인인증을 마치지 못했어요. 다시 해 주세요.');
  return id;
}

const STEPS = {
  login(x) {
    if (S.me) return STEPS.me();
    const id = h('input', { class: 'input', id: 'm-id', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '20', value: x.loginId || '' });
    const pw = pwInput('m-pw', 'current-password');
    const st = statusEl();
    const go = h('button', { class: 'btn primary block', type: 'submit', text: '로그인' });
    const form = h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      const loginId = id.value.trim().toLowerCase();
      if (!loginId || !pw.value) { say(st, '아이디와 비밀번호를 넣어 주세요.', true); (loginId ? pw : id).focus(); return; }
      busy(go, st, async () => {
        const r = await memberCall('login', { loginId, password: pw.value });
        setSession(r.session, r.member);
        afterLogin('로그인했어요');
      });
    } }, field('m-id', '아이디', id), field('m-pw', '비밀번호', pw), st, go);
    return {
      title: '로그인', focus: x.loginId ? pw : id,
      body: [
        h('p', { class: 'acct-lead', text: '로그인하면 앨범에 댓글을 달 수 있어요. 계정 하나로 모든 DJ 추억앨범에서 써요.' }),
        h('button', { class: 'btn block sso-btn', type: 'button', onclick: () => ssoContinue() }, icon('check'), '다른 추억앨범에서 로그인했다면 → 그 계정으로 계속'),
        S.members.kakao ? [kakaoButton(), h('p', { class: 'or' }, h('span', { text: '또는' }))] : null,
        form,
        h('div', { class: 'acct-links' }, linkBtn('회원가입', () => showStep('signup')), h('span', { class: 'sep', 'aria-hidden': 'true' }), linkBtn('아이디·비밀번호 찾기', () => showStep('find')))
      ]
    };
  },

  signup() {
    if (S.me) return STEPS.me();
    const id = h('input', { class: 'input', id: 's-id', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', maxlength: '20' });
    id.addEventListener('input', (e) => { if (e.isComposing) return; const v = id.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); if (v !== id.value) id.value = v; });
    const pw = pwInput('s-pw', 'new-password'), pw2 = pwInput('s-pw2', 'new-password');
    const all = h('input', { type: 'checkbox', id: 'agree-all' });
    const terms = h('input', { type: 'checkbox', id: 'agree-terms' });
    const privacy = h('input', { type: 'checkbox', id: 'agree-privacy' });
    all.addEventListener('change', () => { terms.checked = privacy.checked = all.checked; });
    for (const c of [terms, privacy]) c.addEventListener('change', () => { all.checked = terms.checked && privacy.checked; });
    const agreeRow = (box, forId, text, href) => h('div', { class: 'agree-row' },
      h('label', { class: 'check', for: forId }, box, h('span', null, h('em', { text: '(필수)' }), ' ' + text)),
      h('a', { class: 'agree-view', href, target: '_blank', rel: 'noopener', text: '보기', 'aria-label': text.replace(/에 동의해요$/, '') + ' 보기' }));
    // 청취자 / DJ(2026-11-05) — DJ 는 가입을 마친 뒤 앨범 등록 코드(먼치킨 이용권 결제 뒤 받음)로 내 앨범을 잇는다
    let role = ss.get('bj_join_role') === 'dj' ? 'dj' : 'listener';
    const roleSeg = h('div', { class: 'seg wide role-seg', role: 'radiogroup', 'aria-label': '가입 종류' });
    const roleHint = h('p', { class: 'field-hint' });
    const paintRole = () => {
      roleSeg.replaceChildren(...[['listener', '청취자로 가입'], ['dj', 'DJ로 가입']].map(([k, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(role === k), class: 'kind-opt' + (role === k ? ' on' : ''),
        onclick: () => { role = k; paintRole(); }
      }, h('span', { class: 'kind-top' }, role === k ? icon('check') : null, label))));
      roleHint.textContent = role === 'dj'
        ? 'DJ는 가입한 뒤 앨범 등록 코드를 넣으면 이 계정으로 내 추억앨범을 관리해요. 코드는 먼치킨 이용권을 결제하면 드려요.'
        : '댓글을 달고 하트를 누를 수 있어요.';
    };
    paintRole();
    const st = statusEl();
    const go = h('button', { class: 'btn primary block', type: 'submit', text: '가입하기' });
    const form = h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      const loginId = id.value.trim().toLowerCase();
      if (!LOGIN_ID_RE.test(loginId)) { say(st, '아이디는 영어 소문자·숫자·_ 로 4~20자예요.', true); id.focus(); return; }
      const bad = checkNewPassword(pw, pw2);
      if (bad) { say(st, bad, true); return; }
      if (!terms.checked || !privacy.checked) { say(st, '이용약관과 개인정보 수집·이용에 동의해 주세요.', true); return; }
      busy(go, st, async () => {
        const r = await memberCall('signup', { loginId, password: pw.value, agree: true, role });
        if (role === 'dj') ss.set('bj_join_role', 'dj'); else ss.del('bj_join_role');
        setSession(r.session, r.member);
        toast('가입했어요');
        showStep('verify', { join: true });
      });
    } },
      roleSeg, roleHint,
      field('s-id', '아이디', id, '영어 소문자·숫자·_ 로 4~20자'),
      field('s-pw', '비밀번호', pw, '8자 이상'),
      field('s-pw2', '비밀번호 확인', pw2),
      h('div', { class: 'agree' },
        h('label', { class: 'check agree-all', for: 'agree-all' }, all, h('span', { text: '모두 동의해요' })),
        agreeRow(terms, 'agree-terms', '이용약관에 동의해요', 'terms.html'),
        agreeRow(privacy, 'agree-privacy', '개인정보 수집·이용에 동의해요', 'privacy.html')),
      h('p', { class: 'field-hint', text: '만 14세 이상만 가입할 수 있어요.' }),
      st, go);
    return {
      title: '회원가입', back: 'login', focus: id,
      body: [
        joinSteps(1),
        S.members.kakao ? [kakaoButton(), h('p', { class: 'or' }, h('span', { text: '또는 아이디로 가입' }))] : null,
        form
      ]
    };
  },

  verify(x) {
    if (!S.me) return STEPS.login({});
    if (S.me.verified) return {
      title: '본인인증', back: x.from === 'me' ? 'me' : null,
      body: [h('p', { class: 'acct-lead' }, '이미 본인인증했어요.'), h('button', { class: 'btn primary block', type: 'button', text: '확인', onclick: () => (x.from === 'me' ? showStep('me') : closeAccount()) })]
    };
    const cfg = S.members.verify;
    const st = statusEl();
    const go = h('button', { class: 'btn primary block', type: 'button', text: '휴대폰 본인인증하기', disabled: !cfg });
    const conflict = h('div', { class: 'notice', hidden: true });
    const next = () => {
      if (x.from === 'me') { showStep('me'); return; }
      if (!S.me?.nickname) showStep('nickname', { join: x.join });
      else { closeAccount(); toast('이제 댓글을 달 수 있어요'); }
    };
    const finish = async (id) => {
      say(st, '본인인증 결과를 확인하는 중…');
      try {
        const r = await memberCall('verify-done', { id });
        saveMe(r.member);
        memberChanged();
        toast('본인인증을 마쳤어요');
        next();
      } catch (e) {
        // 같은 사람이 이미 다른 계정으로 인증했다 → 그 계정을 알려 준다(아이디는 일부만)
        if (e.status === 409 && e.data?.hint) {
          const hint = e.data.hint;
          say(st, '');
          go.hidden = true;
          conflict.hidden = false;
          conflict.replaceChildren(...[
            h('strong', { text: e.data.error || '이미 본인인증한 계정이 있어요. 그 계정으로 로그인해 주세요.' }),
            hint.loginId ? h('p', null, '그 계정의 아이디: ', h('b', { text: hint.loginId })) : null,
            hint.kakao ? h('p', { text: '그 계정은 카카오로 가입했어요.' }) : null,
            h('button', { class: 'btn small primary', type: 'button', text: '로그아웃하고 그 계정으로 로그인', onclick: async () => { await logoutAll(); showStep('login', {}); } })
          ].filter(Boolean));
          return;
        }
        throw e;
      }
    };
    go.addEventListener('click', () => busy(go, st, async () => { await finish(await portoneVerify('join')); }));
    if (!cfg) say(st, '본인인증 준비 중이에요. 조금 뒤에 다시 해 주세요.');
    else if (x.error) say(st, x.error, true);
    return {
      title: '본인인증', back: x.from === 'me' ? 'me' : null,
      body: [
        x.join ? joinSteps(2) : null,
        h('p', { class: 'acct-lead strong', text: VERIFY_TEXT }),
        h('ul', { class: 'acct-points' }, h('li', { text: '가입할 때 한 번만 하면 돼요.' }), h('li', { text: '한 사람은 계정을 하나만 만들 수 있어요.' })),
        conflict, st, go,
        x.from === 'me' ? null : h('div', { class: 'acct-links' }, linkBtn('나중에 할게요', () => { if (!S.me?.nickname) showStep('nickname', { join: x.join }); else closeAccount(); }))
      ],
      after: () => {
        if (cfg) loadPortOne().catch(() => {});
        if (x.pendingId) busy(go, st, () => finish(x.pendingId));
      }
    };
  },

  nickname(x) {
    if (!S.me) return STEPS.login({});
    const had = S.me.nickname || '';
    const nk = h('input', { class: 'input', id: 'm-nick', maxlength: '12', value: had, autocomplete: 'nickname', spellcheck: 'false' });
    const st = statusEl();
    const go = h('button', { class: 'btn primary block', type: 'submit', text: had ? '바꾸기' : '정하기' });
    const form = h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      const v = nk.value.normalize('NFC').trim().replace(/\s+/g, ' ');
      const n = [...v].length;
      if (n < 2 || n > 12) { say(st, '닉네임은 2~12자로 정해 주세요.', true); nk.focus(); return; }
      busy(go, st, async () => {
        if (v !== had) {
          const r = await memberCall('nickname', { nickname: v });
          saveMe(r.member);
          memberChanged();
          toast(had ? '닉네임을 바꿨어요' : '닉네임을 정했어요');
        }
        if (x.from === 'me') showStep('me');
        else { closeAccount(); if (S.me?.verified) toast('이제 댓글을 달 수 있어요'); afterJoin(); }
      });
    } }, field('m-nick', '닉네임', nk, '한글·영문·숫자·_ 로 2~12자예요. 가운데 빈칸도 쓸 수 있어요.'), st, go);
    return {
      title: had ? '닉네임 바꾸기' : '닉네임 정하기', back: x.from === 'me' ? 'me' : null, focus: nk,
      body: [
        x.join ? joinSteps(3) : null,
        h('p', { class: 'acct-lead', text: '댓글에는 닉네임만 보여요.' }),
        form,
        !S.me.verified && x.from !== 'me' ? h('p', { class: 'field-hint center' }, '본인인증을 마치면 댓글을 달 수 있어요. ', linkBtn('본인인증하기', () => showStep('verify', { join: x.join }))) : null
      ]
    };
  },

  find(x) {
    const cfg = S.members.verify;
    const st = statusEl();
    const go = h('button', { class: 'btn primary block', type: 'button', text: '휴대폰 본인인증하기', disabled: !cfg });
    const done = async (id) => {
      say(st, '본인인증 결과를 확인하는 중…');
      const r = await memberCall('find-done', { id });
      showStep('found', { account: r.account || {}, reset: typeof r.reset === 'string' ? r.reset : null });
    };
    go.addEventListener('click', () => busy(go, st, async () => { await done(await portoneVerify('find')); }));
    if (!cfg) say(st, '본인인증 준비 중이에요. 조금 뒤에 다시 해 주세요.');
    else if (x.error) say(st, x.error, true);
    return {
      title: '아이디·비밀번호 찾기', back: S.me ? null : 'login',
      body: [
        h('p', { class: 'acct-lead', text: '가입할 때 한 휴대폰 본인인증을 다시 하면 아이디를 알려 드리고, 비밀번호를 새로 정할 수 있어요.' }),
        st, go,
        h('div', { class: 'acct-links' }, linkBtn('회원가입', () => showStep('signup')))
      ],
      after: () => {
        if (cfg) loadPortOne().catch(() => {});
        if (x.pendingId) busy(go, st, () => done(x.pendingId));
      }
    };
  },

  found(x) {
    const a = x.account || {};
    const parts = [];
    if (a.loginId) {
      parts.push(h('div', { class: 'found-id' }, h('span', { text: '내 아이디' }), h('strong', { text: a.loginId })));
      if (x.reset && !S.me) {
        const pw = pwInput('r-pw', 'new-password'), pw2 = pwInput('r-pw2', 'new-password');
        const st = statusEl();
        const go = h('button', { class: 'btn primary block', type: 'submit', text: '새 비밀번호로 로그인' });
        parts.push(h('form', { class: 'stack', onsubmit: (e) => {
          e.preventDefault();
          const bad = checkNewPassword(pw, pw2);
          if (bad) { say(st, bad, true); return; }
          busy(go, st, async () => {
            const r = await memberCall('reset', { reset: x.reset, password: pw.value });
            setSession(r.session, r.member);
            afterLogin('비밀번호를 바꾸고 로그인했어요');
          });
        } },
          h('p', { class: 'acct-lead', text: '비밀번호를 새로 정하면 바로 로그인돼요. 10분 안에 해 주세요.' }),
          // 비밀번호 관리 프로그램이 아이디를 함께 기억하게
          h('input', { type: 'text', class: 'hidden', autocomplete: 'username', value: a.loginId, tabindex: '-1', 'aria-hidden': 'true' }),
          field('r-pw', '새 비밀번호', pw, '8자 이상'), field('r-pw2', '새 비밀번호 확인', pw2), st, go));
        parts.push(h('div', { class: 'acct-links' }, linkBtn('지금 비밀번호로 로그인할게요', () => showStep('login', { loginId: a.loginId }))));
      } else parts.push(h('button', { class: 'btn primary block', type: 'button', text: '로그인하러 가기', onclick: () => showStep('login', { loginId: a.loginId }) }));
    }
    if (a.kakao) parts.push(h('p', { class: 'acct-lead', text: '카카오로 가입한 계정이에요. 카카오 로그인을 눌러 주세요.' }), S.members.kakao ? kakaoButton() : null);
    if (!a.loginId && !a.kakao) parts.push(h('p', { class: 'acct-lead', text: '계정을 찾지 못했어요.' }));
    return { title: '계정 찾기', back: 'login', body: parts };
  },

  me() {
    if (!S.me) return STEPS.login({});
    const m = S.me;
    const row = (k, ...v) => h('div', { class: 'kv-row' }, h('dt', { text: k }), h('dd', null, ...v));
    const todo = !m.verified ? h('button', { class: 'btn primary block', type: 'button', text: '본인인증하기', onclick: () => showStep('verify', { from: 'me' }) })
      : !m.nickname ? h('button', { class: 'btn primary block', type: 'button', text: '닉네임 정하기', onclick: () => showStep('nickname', { from: 'me' }) }) : null;
    const item = (label, fn, cls = '') => h('button', { type: 'button', class: cls, onclick: fn }, label);
    return {
      title: '내 정보',
      body: [
        S.banned ? h('p', { class: 'notice bad-notice', text: '이용이 막힌 계정이에요. 댓글을 달 수 없어요.' }) : null,
        h('dl', { class: 'kv' },
          row('닉네임', m.nickname ? h('b', { text: m.nickname }) : h('span', { class: 'muted', text: '아직 안 정했어요' })),
          row('로그인', m.loginId ? `아이디 ${m.loginId}` : m.kakao ? '카카오' : '—'),
          row('계정', acctOwner() ? h('b', { text: 'DJ · 이 앨범 관리 중' }) : m.role === 'dj' ? 'DJ' : '청취자'),
          row('본인인증', m.verified ? h('span', { class: 'ok' }, icon('check'), '했어요') : h('span', { class: 'bad', text: '아직 안 했어요' }))),
        !m.verified ? h('p', { class: 'field-hint', text: '본인인증과 닉네임이 있어야 댓글을 달 수 있어요.' }) : null,
        todo,
        h('div', { class: 'menu acct-menu' },
          m.nickname ? item('닉네임 바꾸기', () => showStep('nickname', { from: 'me' })) : null,
          m.loginId ? item('비밀번호 바꾸기', () => showStep('password')) : null,
          !acctOwner() ? item('DJ 계정으로 이 앨범 관리하기', () => showStep('claim', { from: 'me' })) : null,
          item('로그아웃', async () => { await logoutAll(); closeAccount(); toast('모든 추억앨범에서 로그아웃했어요'); }),
          item('탈퇴하기', () => showStep('withdraw'), 'danger')),
        h('p', { class: 'acct-foot' },
          h('a', { href: 'terms.html', target: '_blank', rel: 'noopener', text: '이용약관' }), ' · ',
          h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener', text: '개인정보처리방침' }))
      ]
    };
  },

  // DJ 계정: 앨범 등록 코드로 이 앨범을 내 계정에 잇는다(주인 기기 대신 — 어느 기기에서든 로그인만 하면 관리)
  claim(x) {
    if (!S.me) return STEPS.login({});
    const code = h('input', { class: 'input', id: 'c-code', maxlength: '9', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCD-2345' });
    const st = statusEl();
    const go = h('button', { class: 'btn primary block', type: 'submit', text: '이 앨범 연결하기' });
    const done = () => { ss.del('bj_join_role'); closeAccount(); ssoRemember(); };
    const form = h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      if (!S.me.verified) { showStep('verify', { from: 'me' }); return; }
      if (code.value.replace(/[^A-Za-z0-9]/g, '').length !== 8) { say(st, '등록 코드 8자리를 넣어 주세요.', true); code.focus(); return; }
      busy(go, st, async () => {
        const r = await memberCall('album-claim', { album: ALBUM, code: code.value });
        if (r.member) saveMe(r.member);
        setOwns(r.owns);
        memberChanged();
        toast('이제 이 계정으로 앨범을 관리할 수 있어요');
        done();
      });
    } }, field('c-code', '앨범 등록 코드', code, '운영자에게 받은 8자리'), st, go);
    return {
      title: 'DJ 앨범 연결', back: x.from === 'me' ? 'me' : undefined, focus: code,
      body: [
        h('p', { class: 'acct-lead', text: `${siteName()}을(를) 이 계정으로 관리해요. 연결하면 어느 기기에서든 로그인만 하면 글을 올리고 고칠 수 있어요.` }),
        h('p', { class: 'field-hint', text: '앨범 등록 코드는 먼치킨 이용권을 결제하면 운영자가 드려요. 본인인증을 한 계정만 연결할 수 있어요.' }),
        form,
        x.join ? h('div', { class: 'acct-links' }, linkBtn('나중에 할게요', done)) : null
      ]
    };
  },

  password() {
    if (!S.me?.loginId) return STEPS.me();
    const old = pwInput('p-old', 'current-password'), pw = pwInput('p-new', 'new-password'), pw2 = pwInput('p-new2', 'new-password');
    const st = statusEl();
    const go = h('button', { class: 'btn primary block', type: 'submit', text: '바꾸기' });
    const form = h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      if (!old.value) { say(st, '지금 비밀번호를 넣어 주세요.', true); old.focus(); return; }
      const bad = checkNewPassword(pw, pw2);
      if (bad) { say(st, bad, true); return; }
      busy(go, st, async () => {
        await memberCall('password', { old: old.value, password: pw.value });
        toast('비밀번호를 바꿨어요');
        showStep('me');
      });
    } },
      h('input', { type: 'text', class: 'hidden', autocomplete: 'username', value: S.me.loginId, tabindex: '-1', 'aria-hidden': 'true' }),
      field('p-old', '지금 비밀번호', old), field('p-new', '새 비밀번호', pw, '8자 이상'), field('p-new2', '새 비밀번호 확인', pw2),
      h('p', { class: 'field-hint', text: '바꾸면 다른 기기에서는 다시 로그인해야 해요.' }), st, go);
    return { title: '비밀번호 바꾸기', back: 'me', focus: old, body: [form] };
  },

  withdraw() {
    if (!S.me) return STEPS.login({});
    const m = S.me;
    const pw = m.loginId ? pwInput('w-pw', 'current-password') : null;
    const st = statusEl();
    const go = h('button', { class: 'btn danger-fill block', type: 'button', text: '탈퇴하기' });
    go.addEventListener('click', async () => {
      if (pw && !pw.value) { say(st, '비밀번호를 넣어 주세요.', true); pw.focus(); return; }
      if (!await confirmBox('정말 탈퇴할까요? 계정과 내가 단 댓글이 모두 지워지고 되돌릴 수 없어요.', '탈퇴하기', true)) return;
      busy(go, st, async () => {
        await memberCall('withdraw', pw ? { password: pw.value } : {});
        dropSession();
        closeAccount();
        toast('탈퇴했어요');
      });
    });
    return {
      title: '탈퇴하기', back: 'me', focus: pw,
      body: [
        h('div', { class: 'notice' },
          h('strong', { text: '탈퇴하면' }),
          h('ul', null, h('li', { text: '계정과 내가 단 댓글이 모두 지워져요.' }), h('li', { text: '되돌릴 수 없어요.' }))),
        pw ? field('w-pw', '비밀번호', pw) : h('p', { class: 'field-hint', text: '카카오로 가입한 계정은 비밀번호 없이 탈퇴해요.' }),
        st, go
      ]
    };
  }
};

// ---------- 댓글(큰 화면) ----------
const CM = new Map();       // 글 번호 → {list, off, me:{can, why}} 또는 {err}
const cmSeq = new Map();    // 늦게 온 옛 답이 새 답을 덮지 않게
const drafts = new Map();   // 쓰던 댓글(다시 그려도 남게)
function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  const sameYear = dayOf(t).slice(0, 4) === dayOf(Date.now()).slice(0, 4);
  return new Intl.DateTimeFormat('ko-KR', { timeZone: KST, ...(sameYear ? {} : { year: 'numeric' }), month: 'long', day: 'numeric' }).format(new Date(t));
}
const fullTime = (t) => new Intl.DateTimeFormat('ko-KR', { timeZone: KST, year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
async function loadComments(id) {
  if (!S.members || !id) return;
  const seq = (cmSeq.get(id) || 0) + 1;
  cmSeq.set(id, seq);
  let next;
  try {
    const r = await call('comments', { query: { post: id }, session: true });
    next = {
      list: Array.isArray(r.comments) ? r.comments.filter((c) => c && typeof c.id === 'string') : [],
      off: r.off === true,
      me: r.me && typeof r.me === 'object' ? r.me : { can: false, why: 'login' }
    };
  } catch (e) {
    if (cmSeq.get(id) !== seq) return;
    if (e.status === 401) dropSession();
    if (!CM.get(id) || CM.get(id).err) CM.set(id, { list: [], err: e.status === 404 ? '댓글을 불러오지 못했어요.' : e.message });
    paintComments(id);
    return;
  }
  if (cmSeq.get(id) !== seq) return;
  CM.set(id, next);
  if (S.session && next.me.why === 'login') dropSession();   // 서버에서는 로그인이 이미 끝났다
  const p = findPost(id);
  if (p && (Number(p.cc) || 0) !== next.list.length) { p.cc = next.list.length; render(); }
  paintComments(id);
}
function paintComments(id, root = viewer) {
  if (!root) return;
  const st = CM.get(id);
  const box = root.querySelector(`[data-comments="${id}"]`);
  if (box) box.replaceChildren(...commentsContent(id, st));
  const comp = root.querySelector(`[data-compose="${id}"]`);
  if (!comp) return;
  const state = composerState(st);
  if (state === 'can' && comp.dataset.state === 'can' && comp.querySelector('textarea')) return;   // 쓰던 칸은 그대로
  comp.dataset.state = state;
  comp.replaceChildren(...composerContent(id, st));
}
function commentsContent(id, st) {
  const n = st?.list?.length || 0;
  const out = [h('h3', { class: 'cm-title' }, '댓글', n ? h('span', { text: num(n) }) : null)];
  if (!st) out.push(h('p', { class: 'cm-empty', text: '댓글을 불러오는 중…' }));
  else if (st.err) out.push(h('p', { class: 'cm-empty' }, st.err + ' ', h('button', { class: 'link-btn', type: 'button', text: '다시 불러오기', onclick: () => { CM.delete(id); paintComments(id); loadComments(id); } })));
  else if (!n) out.push(h('p', { class: 'cm-empty', text: st.off ? '아직 댓글이 없어요.' : '아직 댓글이 없어요. 첫 댓글을 남겨 보세요.' }));
  else out.push(h('ul', { class: 'cm-list' }, st.list.map((c) => commentItem(id, c))));
  return out;
}
function commentItem(postId, c) {
  const at = Number(c.at) || Date.now();
  return h('li', { class: 'cm-item' + (c.mine ? ' mine' : ''), dataset: { cid: c.id } },
    h('div', { class: 'cm-main' },
      h('p', { class: 'cm-head' },
        h('b', { class: 'cm-nick', text: c.nick || '(알 수 없음)' }),
        c.mine ? h('span', { class: 'cm-tag', text: '내 댓글' }) : null,
        h('time', { class: 'cm-time', datetime: new Date(at).toISOString(), title: fullTime(at), text: ago(at) })),
      h('p', { class: 'cm-text', text: c.text || '' })),
    h('button', { class: 'icon-btn cm-more', type: 'button', 'aria-label': `${c.nick || ''} 댓글 메뉴`, onclick: () => commentMenu(postId, c) }, icon('more')));
}
function composerState(st) {
  if (!st) return 'loading';
  if (st.err) return 'error';
  if (st.me?.can) return 'can';
  return st.me?.why || (st.off ? 'off' : 'login');
}
// 맨 아래 쓰기 칸 — 쓸 수 없으면 왜 그런지와 할 일(로그인·본인인증·닉네임)
function composerContent(id, st) {
  const state = composerState(st);
  if (state === 'loading' || state === 'error') return [];
  if (state === 'can') return [commentForm(id)];
  const cta = (label, fn, ic) => h('button', { class: 'cm-cta', type: 'button', onclick: fn }, icon(ic), h('span', { text: label }));
  const note = (text, btn) => h('p', { class: 'cm-why' }, h('span', { text }), btn || null);
  if (state === 'login') return [cta('로그인하고 댓글 달기', () => openAccount('login'), 'user')];
  if (state === 'verify') return [cta('본인인증하고 댓글 달기', () => openAccount('verify', {}), 'check')];
  if (state === 'nickname') return [note('닉네임을 정하면 댓글을 달 수 있어요', h('button', { class: 'btn small primary', type: 'button', text: '닉네임 정하기', onclick: () => openAccount('nickname', {}) }))];
  if (state === 'blocked') return [note('이 앨범에서는 댓글을 달 수 없어요')];
  if (state === 'off') return [note('댓글을 받지 않는 앨범이에요')];
  if (state === 'banned') return [note('이용이 막힌 계정이라 댓글을 달 수 없어요')];
  return [note('지금은 댓글을 달 수 없어요')];
}
function commentForm(id) {
  const ta = h('textarea', { class: 'cm-input', rows: '1', maxlength: '300', placeholder: '댓글 달기…', 'aria-label': '댓글 쓰기' });
  ta.value = drafts.get(id) || '';
  const send = h('button', { class: 'cm-send', type: 'submit', text: '게시' });
  const count = h('span', { class: 'cm-count', 'aria-live': 'polite' });
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 128) + 'px'; };
  const sync = () => {
    send.disabled = !ta.value.trim() || ta.readOnly;
    const n = [...ta.value].length;
    count.textContent = n > 250 ? `${n}/300` : '';
  };
  ta.addEventListener('input', () => { drafts.set(id, ta.value); sync(); grow(); });
  const form = h('form', { class: 'cm-form', onsubmit: (e) => { e.preventDefault(); postComment(id, ta, sync, grow); } }, ta, count, send);
  // PC: Ctrl(⌘)+Enter 로 바로 게시(Enter 는 줄바꿈 — 5줄까지)
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
  sync();
  requestAnimationFrame(grow);
  return form;
}
async function postComment(id, ta, sync, grow) {
  const text = ta.value.replace(/\r\n?/g, '\n').trim();
  if (!text || ta.readOnly) return;
  ta.readOnly = true;
  sync();
  try {
    const r = await commentCall('add', { album: ALBUM, post: id, text });
    drafts.delete(id);
    ta.value = '';
    grow();
    const st = CM.get(id);
    if (st?.list && r.comment && !st.list.some((c) => c.id === r.comment.id)) st.list.push({ ...r.comment, mine: true });
    bumpCc(id, 1);
    paintComments(id);
    viewer?.querySelector(`[data-comments="${id}"] .cm-list > li:last-child`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (e) {
    toast(e.message, true);
    if (e.status === 403) loadComments(id);   // 차단·댓글 끔 등 — 쓰기 칸을 새로(쓰던 글은 drafts 에 남는다)
  } finally {
    ta.readOnly = false;
    sync();
  }
}
// 하트 줄의 말풍선: 쓸 수 있으면 쓰기 칸으로, 아니면 할 일(로그인·본인인증·닉네임) 창으로
function focusComposer(id) {
  const comp = viewer?.querySelector(`[data-compose="${id}"]`);
  const ta = comp?.querySelector('textarea');
  if (ta) { comp.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); ta.focus({ preventScroll: true }); return; }
  const why = composerState(CM.get(id));
  if (why === 'login' || (why === 'loading' && !S.me)) openAccount('login');
  else if (why === 'verify') openAccount('verify', {});
  else if (why === 'nickname') openAccount('nickname', {});
  else comp?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function bumpCc(id, d) {
  const p = findPost(id);
  if (!p) return;
  p.cc = Math.max(0, (Number(p.cc) || 0) + d);
  render();
}
function dropComment(postId, cid) {
  const st = CM.get(postId);
  if (st?.list) st.list = st.list.filter((c) => c.id !== cid);
  bumpCc(postId, -1);
  paintComments(postId);
}
function commentMenu(postId, c) {
  const item = (label, ic, fn, danger = false) => h('button', { type: 'button', class: danger ? 'danger' : '', onclick: () => { d.dismiss(); fn(); } }, icon(ic), label);
  const items = [];
  if (c.mine) items.push(item('내 댓글 지우기', 'trash', () => deleteMyComment(postId, c), true));
  else items.push(item('신고하기', 'flag', () => reportComment(c)));
  if (S.owner && !c.mine) {
    items.push(item('댓글 지우기 (앨범 주인)', 'trash', () => ownerDeleteComment(postId, c), true));
    if (c.m) items.push(item('이 회원 차단하기', 'block', () => blockMember(c.m, c.nick), true));
  }
  items.push(h('button', { type: 'button', onclick: () => d.dismiss() }, '그만두기'));
  const d = sheet(h('div', { class: 'menu' }, h('p', { class: 'menu-title', text: `${c.nick || ''}님의 댓글` }), items), { cls: 'small', label: '댓글 메뉴' });
}
async function deleteMyComment(postId, c) {
  if (!await confirmBox('내 댓글을 지울까요?', '지우기', true)) return;
  try { await commentCall('delete', { id: c.id }); dropComment(postId, c.id); toast('댓글을 지웠어요'); }
  catch (e) { toast(e.message, true); }
}
async function ownerDeleteComment(postId, c) {
  if (!await confirmBox('이 댓글을 지울까요? 되돌릴 수 없어요.', '지우기', true)) return;
  try { await ownerCall('comment-delete', { id: c.id }); dropComment(postId, c.id); toast('댓글을 지웠어요'); }
  catch (e) { toast(e.message, true); }
}
async function blockMember(member, nick) {
  if (!member) return false;
  if (!await confirmBox(`${nick || '이 회원'}님이 이 앨범에 댓글을 달지 못하게 할까요? 이미 단 댓글은 남아 있어요. ⚙ 설정에서 언제든 풀 수 있어요.`, '차단하기', true)) return false;
  try { await ownerCall('member-block', { member }); toast(`${nick || '회원'}님을 차단했어요`); return true; }
  catch (e) { toast(e.message, true); return false; }
}
function reportComment(c) {
  if (!S.me) { toast('로그인하면 신고할 수 있어요.'); openAccount('login'); return; }
  const reasons = ['욕설·비하', '괴롭힘·따돌림', '광고·도배', '개인정보 노출', '그 밖의 이유'];
  const d = sheet(h('div', { class: 'menu' },
    h('p', { class: 'menu-title', text: '신고하는 이유를 골라 주세요' }),
    reasons.map((reason) => h('button', { type: 'button', onclick: async () => {
      d.dismiss();
      try { await commentCall('report', { id: c.id, reason }); toast('신고했어요. 앨범 주인과 운영자가 확인해요.'); }
      catch (e) { toast(e.message, true); }
    } }, reason)),
    h('button', { type: 'button', onclick: () => d.dismiss() }, '그만두기')), { cls: 'small', label: '댓글 신고' });
}

// ---------- 댓글 관리(주인 ⚙ 설정) ----------
function ownerCommentSettings(closeSettings) {
  const on = h('input', { type: 'checkbox', id: 'cm-on', class: 'switch', role: 'switch', disabled: true });
  const onNote = h('p', { class: 'muted small', text: '지금 상태를 확인하는 중…' });
  const blockList = h('ul', { class: 'devices' }, h('li', { class: 'muted', text: '불러오는 중…' }));
  const reportList = h('ul', { class: 'devices reports' }, h('li', { class: 'muted', text: '불러오는 중…' }));
  const paintOn = (v) => {
    on.checked = v;
    on.disabled = false;
    onNote.textContent = v ? '본인인증한 회원이 글마다 댓글을 달 수 있어요.' : '새 댓글을 받지 않아요. 이미 달린 댓글은 그대로 보여요.';
  };
  on.addEventListener('change', async () => {
    const want = on.checked;
    on.disabled = true;
    try {
      const r = await ownerCall('comments-set', { on: want });
      paintOn(typeof r.on === 'boolean' ? r.on : want);
      CM.clear();
      toast(want ? '댓글을 받아요' : '댓글을 받지 않아요');
    } catch (e) { paintOn(!want); toast(e.message, true); }
  });
  async function loadBlocks() {
    try {
      const r = await ownerCall('blocks', {});
      const rows = Array.isArray(r.blocks) ? r.blocks : [];
      blockList.replaceChildren(...(rows.length ? rows.map((b) => h('li', null,
        h('div', null, h('strong', { text: b.nick || '(닉네임 없음)' }), h('p', { class: 'muted small', text: b.at ? `${dateText(b.at)}에 차단` : '차단함' })),
        h('button', { class: 'btn small', type: 'button', text: '풀기', onclick: async () => {
          if (!await confirmBox(`${b.nick || '이 회원'}님의 차단을 풀까요?`, '풀기')) return;
          try { await ownerCall('member-unblock', { member: b.member }); toast('차단을 풀었어요'); loadBlocks(); } catch (e) { toast(e.message, true); }
        } }))) : [h('li', { class: 'muted', text: '차단한 회원이 없어요.' })]));
      if (typeof r.on === 'boolean') { paintOn(r.on); return true; }   // 서버가 댓글 받기 상태를 함께 알려 주면 그 값
    } catch (e) { blockList.replaceChildren(h('li', { class: 'bad', text: e.message })); }
    return false;
  }
  // 댓글 받기 상태를 따로 묻는 동작이 없으면: 가장 새 글의 댓글 목록(off)으로 안다. 글이 없으면 처음 값(켜짐)
  async function probeOn() {
    const p0 = byDate(posts())[0];
    if (!p0) { paintOn(true); return; }
    try { paintOn((await call('comments', { query: { post: p0.id } })).off !== true); }
    catch { paintOn(true); onNote.textContent = '지금 상태를 알 수 없어요. 바꾸면 그대로 저장돼요.'; }
  }
  async function loadReports() {
    try {
      const r = await ownerCall('reports', {});
      const rows = Array.isArray(r.reports) ? r.reports : [];
      reportList.replaceChildren(...(rows.length ? rows.map((x) => h('li', { class: 'report' },
        h('div', { class: 'r-main' },
          h('p', { class: 'r-head' }, h('strong', { text: x.nick || '(알 수 없음)' }), h('span', { class: 'tag warn', text: `신고 ${num(x.count || 1)}번` })),
          h('p', { class: 'r-text', text: x.text || '' }),
          h('p', { class: 'muted small', text: x.at ? `${ago(x.at)} 신고` : '' })),
        h('div', { class: 'r-actions' },
          findPost(x.post) ? h('button', { class: 'btn small', type: 'button', text: '글 보기', onclick: () => { closeSettings(); openViewer(x.post); } }) : null,
          h('button', { class: 'btn small danger', type: 'button', text: '지우기', onclick: async () => {
            if (!await confirmBox('신고된 이 댓글을 지울까요? 되돌릴 수 없어요.', '지우기', true)) return;
            try { await ownerCall('comment-delete', { id: x.comment }); CM.delete(x.post); bumpCc(x.post, -1); toast('댓글을 지웠어요'); loadReports(); } catch (e) { toast(e.message, true); }
          } }),
          x.member ? h('button', { class: 'btn small danger', type: 'button', text: '차단', onclick: async () => { if (await blockMember(x.member, x.nick)) loadBlocks(); } }) : null))) : [h('li', { class: 'muted', text: '신고된 댓글이 없어요.' })]));
    } catch (e) { reportList.replaceChildren(h('li', { class: 'bad', text: e.message })); }
  }
  loadBlocks().then((known) => { if (!known) probeOn(); });
  loadReports();
  return [
    h('h3', { text: '댓글' }),
    h('label', { class: 'switch-row', for: 'cm-on' }, h('span', { text: '댓글 받기' }), on),
    onNote,
    h('h4', { text: '차단한 회원' }),
    h('p', { class: 'muted small', text: '차단한 회원은 이 앨범에 댓글을 달 수 없어요.' }),
    blockList,
    h('h4', { text: '신고된 댓글' }),
    reportList
  ];
}

// 카카오·휴대폰 본인인증에서 돌아왔을 때 마무리(RETURN — 맨 위에서 주소를 이미 정리했다)
async function handleReturn() {
  const R = RETURN;
  if (!R) return;
  if (R.kind === 'sso') { if (R.code === 'ok') ls.set('bj_sso_at', String(Date.now())); return; }
  if (R.kind === 'login-error') {
    if (R.code === 'sso-none') { toast(KAKAO_ERRORS['sso-none']); openAccount('login'); return; }
    toast(KAKAO_ERRORS[R.code] || KAKAO_ERRORS.fail, R.code !== 'cancel'); return;
  }
  if (R.kind === 'ticket') {
    try {
      const r = await memberCall('ticket', { ticket: R.ticket });
      setSession(r.session, r.member);
      ls.set('bj_sso_at', String(Date.now()));   // 카카오·다른 앨범 계정 둘 다 서버 쿠키가 이미 있다
      await loadMe();
      afterLogin('로그인했어요');
    } catch (e) { toast(e.message, true); }
    return;
  }
  const mode = R.mode || (S.session ? 'join' : 'find');
  if (R.savedId && R.id && R.savedId !== R.id) { toast('본인인증을 처음부터 다시 해 주세요.', true); return; }
  if (mode === 'join' && !S.me) { toast('로그인이 풀렸어요. 다시 로그인한 뒤 본인인증을 해 주세요.', true); openAccount('login'); return; }
  if (R.code) { openAccount(mode === 'find' ? 'find' : 'verify', { error: R.message || '본인인증을 마치지 못했어요. 다시 해 주세요.' }); return; }
  if (!R.id) { toast('본인인증 결과를 받지 못했어요. 다시 해 주세요.', true); return; }
  openAccount(mode === 'find' ? 'find' : 'verify', { pendingId: R.id });
}
async function startMembers(pageReady) {
  let r = await loadMembersConfig();
  if (r === 'net') { await new Promise((ok) => setTimeout(ok, 5000)); r = await loadMembersConfig(); }
  if (r !== 'ok') {
    if (RETURN) {
      await pageReady;
      toast(RETURN.kind === 'login-error' ? (KAKAO_ERRORS[RETURN.code] || KAKAO_ERRORS.fail) : '지금은 로그인할 수 없어요. 조금 뒤에 다시 해 주세요.', RETURN.code !== 'cancel');
    }
    return;
  }
  await loadMe();
  syncOwner();
  if (!(param('owner') !== null && !S.owner)) render();   // 맨 위 로그인 단추·바닥 약관 링크(주인 기기 등록 화면은 그대로)
  if (!RETURN) { if (!S.session) trySso(); else ssoRemember(); }
  // 회원 설정보다 먼저 열린 큰 화면에는 댓글 칸이 없다 → 다시 그린다(이미 있으면 openViewer 가 불러왔다)
  const id = viewer?.dataset.post;
  if (id && findPost(id) && !viewer.querySelector('[data-comments]')) { viewer.replaceChildren(viewerStage(findPost(id))); loadComments(id); }
  await pageReady;
  await handleReturn();
}

// ---------- 시작 ----------
// 주인 기기인지(기기 서명으로 묻는다) + DJ 계정인지 → S.owner
async function checkOwner() {
  try {
    const me = await identity({ create: false });
    if (!me) ls.del('bj_owner');
    else {
      const r = await call('owner', { method: 'POST', body: await signed('me', { album: ALBUM }) });
      r.state === 'approved' ? ls.set('bj_owner', '1') : ls.del('bj_owner');
    }
  } catch { /* 인터넷 문제면 그대로 둔다 */ }
  syncOwner();
}
async function refresh(fresh = false) {
  try {
    const before = S.feed?.snapAt || 0;
    setFeed(await fetchFeed(fresh));
    if ((S.feed?.snapAt || 0) !== before) {
      if (!viewer) render();
      else {
        const id = viewer.dataset.post;
        render();
        // 댓글을 쓰고 있으면 큰 화면은 그대로 둔다(쓰던 칸·커서가 사라지지 않게)
        const typing = viewer.contains(document.activeElement) && document.activeElement.matches('textarea, input');
        if (!typing && findPost(id)) viewer.replaceChildren(viewerStage(findPost(id)));
      }
    }
  } catch (e) {
    if (!S.feed) { $('#app').replaceChildren(h('main', { class: 'wrap narrow' }, h('section', { class: 'card' }, h('h1', { text: '불러오지 못했어요' }), h('p', { text: e.message }), h('button', { class: 'btn primary', type: 'button', text: '다시 불러오기', onclick: () => refresh(true) })))); }
  }
}
// 방문자 수: 이 브라우저는 하루(한국 날짜)에 한 번만 센다. 주인 기기는 세지 않고 수만 본다.
const visitParts = () => ['오늘 ', h('b', { text: num(S.visits.today) }), h('span', { class: 'sep', text: '·' }), '전체 ', h('b', { text: num(S.visits.total) })];
async function countVisit() {
  try {
    const r = await call('visit', { method: 'POST', body: { album: ALBUM, vid: S.vid, peek: S.owner } });
    S.visits = { today: Number(r.today) || 0, total: Number(r.total) || 0 };
    const el = $('#visits');
    if (el) el.replaceChildren(...visitParts());
  } catch { /* 못 세도 화면은 그대로 */ }
}
function noAlbum(message) {
  $('#app').replaceChildren(h('main', { class: 'wrap narrow' }, h('section', { class: 'card' },
    h('h1', { text: '앨범을 찾을 수 없어요' }), h('p', { text: message }))));
}
(async function start() {
  // 처음 오는 브라우저는 앨범부터 알아낸다. 기억한 앨범이 있으면 바로 그리고 뒤에서 확인(바뀌었으면 다시 연다).
  if (!ALBUM) {
    const a = await resolveAlbum();
    if (!a) return noAlbum(a === null ? '주소를 다시 확인해 주세요.' : '인터넷 연결을 확인하고 다시 열어 주세요.');
    ALBUM = a; ls.set('bj_album', a);
  } else if (!LOCAL) {
    resolveAlbum().then((a) => {
      if (a === null) { ls.del('bj_album'); ls.del(feedKey()); location.reload(); }
      else if (a && a !== ALBUM) { ls.set('bj_album', a); location.reload(); }
    });
  }
  try { const cached = JSON.parse(ls.get(feedKey()) || 'null'); if (cached?.posts && (cached.album?.id || LEGACY) === ALBUM) S.feed = cached; } catch { /* 없음 */ }
  render();
  let pageReady;
  startMembers(new Promise((r) => { pageReady = r; }));
  await refresh();
  const p = param('p');
  if (p && findPost(p)) openViewer(p, { push: false });
  else if (p) history.replaceState(null, '', urlWith({ p: null }));
  pageReady();
  countVisit();
  checkOwner();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - (S.feed?.snapAt || 0) > 30000) refresh(); });
})();
