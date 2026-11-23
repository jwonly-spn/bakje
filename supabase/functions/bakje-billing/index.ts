// 추억앨범·먼치킨 계좌이체 이용권 — Supabase Edge Function "bakje-billing" (verify_jwt false, 2026-11-05)
// 흐름: 로그인한 회원이 이용권 신청(먼치킨 / 추억앨범 / 먼치킨+추억앨범 × 1개월·1년) → 운영자 계좌·금액·입금자명을 보고 이체
//  추가(add-album·add-munchkin): 가진 이용권 끝나는 날까지, 더하는 것의 한 달 값(1년치로 샀으면 1년 값÷12) × 남은 날÷30
//  → "입금했어요"(운영자 앱 푸시 bj_push_subs + 디스코드 웹후크 BILLING_WEBHOOK 이 있으면 그것도)
//  → 운영자(bj_members.is_admin)가 운영자 앱(사이트 /ops/ 를 아이폰 홈 화면에 추가)에서 확인 → 이용 기간 30일 단위로 연장(bj_entitlements, 추억앨범은 bj_albums.paid_until 도)
// 회원 세션은 bakje 와 같은 x-bj-session(bj_sessions sha256). 표: supabase/schema.sql "bakje_billing".
// v4(2026-11-05 밤, 먼치킨 계정): 앨범이 없는 DJ 도 먼치킨.com/album 에서 추억앨범을 신청한다 — 주소 이름(<이름>.먼치킨.com)·앨범 이름을 함께 적고(order newAlbum),
//  운영자가 입금을 확인하면(ops-confirm) 앨범·주소(bj_hosts + 저장소 h/<주소>.json)가 저절로 생기고 신청한 계정이 바로 주인(bj_album_owners)이 된다.
//  그 계정에 이어진 먼치킨(bj_member_devices, 봇 프로그램)이 있으면 최초 박제판 저절로 올리기도 잇는다(bj_bots). info 에 가진 앨범 목록(albums), album-name(주소 이름 확인).
// v5(2026-11-07, 사용자 "2027년 1월 1일부터 이용권을 사지 않은 DJ 의 먼치킨은 바로 막기"):
//  ① munchkin-pass: 로그인한 먼치킨(봇 프로그램)이 켤 때·방송마다 자기 계정의 먼치킨 이용권을 묻는다(회원 세션 — info 와 같은 길) → {active, until, kind, from, now, free, waiting, sent}
//     kind = 'munchkin'(먼치킨만) | 'bundle'(먼치킨 + 추억앨범·먼치킨 추가) | null. 청취자 정보는 오가지 않는다(계정의 이용권만).
//  ② (v6 ⑥ 에서 없앰 — 지금부터 받음) 먼치킨 이용권 신청은 2026-12-01 부터 받는다(12월 띠의 [이용권 신청] — 1월 1일 전에 미리 낼 수 있게). 무료 기간에 확인된 먼치킨 기간은 2027-01-01 부터 센다
//     (12월에 낸 1개월 = 1월 1일 ~ 1월 31일 — 무료인 12월 날을 돈 내고 쓴 것으로 치지 않는다). 먼치킨 추가(add-munchkin) 값도 1월 1일부터의 날만 센다.
//  ③ info 의 munchkinFrom = 먼치킨 이용권 신청을 받기 시작하는 때(v6: 11월 23일 — 옛 화면용), munchkinPaidFrom = 이용권이 있어야 쓰는 때(1월 1일).
// v6(2026-11-23, 사용자 11/22 "응 붙여" — KG이니시스 심사용 카드 결제창 1단계, 포트원 V2):
//  ① card-start: order 와 같은 검사·같은 금액(buildOrder) → bj_orders(pending, pay 'card', pay_id 'mk-<신청 번호>') + 결제창에 넘길 값(pay)
//     같은 내용(이용권·기간·앨범·금액)의 결제 안 끝난 카드 신청이 있으면 그것을 다시 준다(기다리는 신청 3개 한도에 안 걸리게).
//  ② card-done: 서버가 포트원 GET /payments/{paymentId}(Authorization: PortOne <PORTONE_API_SECRET>)로 직접 물어 마무리(finishCard).
//     TEST 채널 → state 'test'(이용권 없음) · LIVE 라도 테스트 모드에서 만든 신청(test_only) → 'test'(운영자에게 환불 알림) · LIVE + 보통 신청 + 결제 번호·상점·금액·통화 맞음 → paid + 기간(grantOrder).
//     pending → 다음 상태는 조건부 update 한 번(두 번 반영 막음). 금액이 다르면 신청은 기다림 그대로 + 운영자 알림 한 번(pay_channel 로 표시).
//  ③ 카드 단추(info.card {show, canPay, mode, storeId, channelKey}): bj_settings "card" {on off|testers|all, mode test|live, channelKey, testers[login_id]}.
//     show = on 이 off 가 아님 · canPay = show + 채널 키·상점 아이디(비밀 값 PORTONE_STORE_ID) 있음 + (mode live 거나 testers·운영자).
//     mode test 에서 만든 카드 신청은 test_only(어떤 결제가 와도 이용권 없음 — 새 앨범 주소는 잡지 않고 메모에만).
//  ⑥ 변경-1123(사용자 11/23 "모든 사람들이 볼 수 있게"): 12/1 신청 문을 없애고 지금부터 받는다 · 새 추억앨범 신청은 기본 열림(billing.albumOpen:false 면 닫힘)
//     · 1/1 전에 확인된 결제는 먼치킨·추억앨범 모두 2027-01-01 0시부터 센다(PAID_FROM — 새 앨범은 바로 만들어져 쓰고, 돈 낸 기간은 1/1 부터)
//     · prices: 로그인 안 한 방문자도 가격·카드 표시를 본다(계좌·결제는 로그인 뒤) · card-start returnUrl(먼치킨.com·그 하위·추억앨범 주소만, 아니면 먼치킨.com/album).
//  ④ 카드 신청은 sent·ops-confirm 이 받지 않고 운영자 기다림 목록·알림 숫자에서 빠진다. cancel 은 카드면 먼저 포트원에 물어 PAID 면 취소 대신 마친다.
//  ⑤ info 를 부를 때 내 결제 안 끝난 카드 신청(1분 지난 것, 최대 3개)을 다시 물어 마무리(창을 닫아 버린 경우). 결제하는 분 이름·휴대폰·이메일은 받지도 두지도 않는다(화면 → 결제창).
//  ⑦ 고침 1회차(보안 검토 11/23): 취소·거절한 카드 신청에 뒤늦게 결제가 끝나면 이용권 없이 운영자에게 환불 알림 한 번(lateCard)
//     · 결제창을 닫은 카드 신청(포트원 결제 없음 404·READY)은 card-start(다른 내용일 때)·info 다시 확인 때 취소로 정리(dropCard) — pay_channel 'NONE' = 결제 없음을 확인함
//     · 금액이 다른 결제가 들어온 신청은 취소할 수 있고 운영자 지난 신청에도 보임 · card-done 1시간 300번(album-name 과 같은 값)
//     · returnUrl 은 bakje siteOf 와 같은 판단(먼치킨.com·www + bj_hosts) · 봇 waiting·ops-reject 는 계좌이체 신청만
//  표: 마이그레이션 bakje_card_pay(bj_orders pay·pay_id·pay_at·pay_channel·test_only, state 'test') — 이 함수보다 먼저 적용한다.
// 주의: MCP 로 올릴 때 백슬래시-u 글자 표기가 풀려 버리므로 이 파일에는 그런 표기를 쓰지 않는다.
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ==== 시험이 따로 읽는 곳 시작 ====
// 시험: tests/bakje-billing-card.test.mjs 가 이 사이만 잘라 가짜 DB·가짜 fetch 로 돌린다(그 사이에는 Deno·바깥 모듈을 쓰지 않는다).
// db = supabase-js 손님(service_role) · envOf = 비밀 값 읽기 · http = fetch — makeHandler 가 넣는다.
let db: any = null;
let envOf: (k: string) => string | undefined = () => undefined;
let http: typeof fetch = (input, init) => fetch(input, init);
const BROKEN = '잠시 문제가 생겼어요. 조금 뒤에 다시 해 주세요.';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, x-bj-session',
  'Access-Control-Max-Age': '86400'
};
const PLANS: Record<string, { name: string; products: string[] }> = {
  munchkin: { name: '먼치킨', products: ['munchkin'] },
  album: { name: '추억앨범', products: ['album'] },
  bundle: { name: '먼치킨 + 추억앨범', products: ['munchkin', 'album'] },
  // 남은 기간에 맞춰 추가(먼치킨을 쓰다가 추억앨범을 더하기 등): 가진 이용권이 끝나는 날까지, 남은 날만큼 낸다(addonQuote)
  'add-album': { name: '추억앨범 추가', products: ['album'] },
  'add-munchkin': { name: '먼치킨 추가', products: ['munchkin'] }
};
const ADDON: Record<string, { have: string; add: string }> = { 'add-album': { have: 'munchkin', add: 'album' }, 'add-munchkin': { have: 'album', add: 'munchkin' } };
const MONTHS = [1, 12];
const DAY = 86400000, MONTH_MS = 30 * DAY;
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
const enc = new TextEncoder();

class Fail extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const fail = (status: number, message: string) => new Fail(status, message);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
async function q<T = any>(p: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await p;
  if (error) { console.error(error); throw fail(503, BROKEN); }
  return data;
}
const env = (k: string) => (envOf(k) || '').trim();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha256hex = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const rid = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => ALPHA[x & 31]).join('');
const digits4 = () => String(1000 + (crypto.getRandomValues(new Uint16Array(1))[0] % 9000));
const hit = async (key: string, seconds: number, max: number) => Boolean(await q(db.rpc('fp_hit', { p_key: key, p_seconds: seconds, p_max: max })));
const line = (v: unknown, max: number) => typeof v === 'string' ? [...v.replace(/[\r\n\t]+/g, ' ')].filter((ch) => ch.charCodeAt(0) >= 32).join('').trim().slice(0, max) : '';

// ── 새 추억앨범 주소 이름(<이름>.먼치킨.com) ──
// 한글·영어 소문자·숫자 1~15자, - 는 가운데에만. 주소는 퓨니코드 소문자(new URL 이 바꿔 준다).
const LABEL_RE = /^[가-힣a-z0-9](?:[가-힣a-z0-9-]{0,13}[가-힣a-z0-9])?$/;
const LABEL_RESERVED = new Set(['www', 'test', 'ops', 'api', 'admin', 'mail', 'help', 'app', 'dev', 'staging', 'album', '먼치킨', '운영자', '관리자', '추억앨범', '키우기', '공식', '스푼', 'spoon']);
const ALBUM_SUFFIX = '.xn--s22bu18a0ub.com';   // .먼치킨.com
const HOST_TAKEN_OPS = '주소가 이미 쓰이고 있어요 — 거절하고 다른 주소로 다시 신청하게 해 주세요';
function labelOf(v: unknown) {
  const label = typeof v === 'string' ? v.normalize('NFC').trim().toLowerCase() : '';
  if (!label) return { label, host: '', reason: '주소 이름을 적어 주세요.' };
  if (!LABEL_RE.test(label)) return { label, host: '', reason: '주소 이름은 한글·영어 소문자·숫자로 1~15자예요. - 는 가운데에만 쓸 수 있어요.' };
  if (LABEL_RESERVED.has(label)) return { label, host: '', reason: '쓸 수 없는 주소 이름이에요. 다른 이름을 골라 주세요.' };
  // xn-- 로 시작하는 이름은 한글 주소를 바꾼 글자(퓨니코드)라 그대로 받지 않는다(다른 한글 이름과 같은 주소가 된다)
  if (label.startsWith('xn--')) return { label, host: '', reason: '이 이름으로는 주소를 만들 수 없어요. 다른 이름을 골라 주세요.' };
  let host = '';
  try { host = new URL('https://' + label + '.먼치킨.com').hostname.toLowerCase(); } catch { /* 아래 */ }
  if (!/^[a-z0-9.-]{3,253}$/.test(host) || !host.endsWith(ALBUM_SUFFIX) || host.slice(0, -ALBUM_SUFFIX.length).includes('.')) return { label, host: '', reason: '이 이름으로는 주소를 만들 수 없어요. 다른 이름을 골라 주세요.' };
  return { label, host, reason: '' };
}
// 주소가 쓰이고 있으면 그 까닭(빈 글 = 쓸 수 있음): 이미 있는 앨범 주소 · 다른 회원이 신청해 확인을 기다리는 주소
async function hostTaken(host: string, member: string) {
  if (await q(db.from('bj_hosts').select('host').eq('host', host).maybeSingle())) return '이미 쓰이고 있는 주소예요. 다른 이름을 골라 주세요.';
  const w: any = await q(db.from('bj_orders').select('member').eq('want_host', host).eq('state', 'pending').neq('member', member).limit(1));
  if (w.length) return '다른 분이 먼저 신청한 주소예요. 다른 이름을 골라 주세요.';
  return '';
}
// 새 추억앨범 신청 값(order newAlbum {label, name}) — album-name 과 같은 검사 + 앨범 이름은 한 줄 2~40자(비우면 '<닉네임> 추억앨범')
const ALBUM_WAITING = '확인을 기다리는 추억앨범 신청이 있어요. 그 신청을 마치거나 취소한 뒤 다시 해 주세요.';
const albumNameOf = (v: any, me: any) => {
  const name = line(v.name, 200) || `${me.nickname || 'DJ'} 추억앨범`;
  if ([...name].length < 2 || [...name].length > 40) throw fail(400, '앨범 이름은 2~40자로 정해 주세요.');
  return name;
};
async function newAlbumOf(v: unknown, me: any, pay = 'bank') {
  if (!isObj(v)) throw fail(400, '새 추억앨범의 주소 이름을 정해 주세요.');
  const n = labelOf(v.label);
  if (n.reason) throw fail(400, n.reason);
  const taken = await hostTaken(n.host, me.id);
  if (taken) throw fail(409, taken);
  const name = albumNameOf(v, me);
  // 새 앨범 신청은 한 번에 하나만(입금 확인 때 앨범이 둘 생기지 않게)
  //  카드(v6): 결제 안 끝난(돈이 들어온 적 없는) 카드 새 앨범 신청이면 넘긴다(busy — buildOrder 가 같은 내용이면 다시 쓰고, 다르면 정리한 뒤 다시 본다)
  const mine: any = await q(db.from('bj_orders').select('id,pay,want_host,pay_channel').eq('member', me.id).eq('state', 'pending').not('want_host', 'is', null).limit(1));
  const busy = Boolean(mine.length && pay === 'card' && mine[0].pay === 'card' && !mine[0].pay_channel);
  if (mine.length && !busy) throw fail(409, ALBUM_WAITING);
  return { host: n.host, label: n.label, name, busy };
}
// 테스트 모드 카드 신청의 새 앨범 칸(v6): 같은 검사를 하되 주소는 잡아 두지 않고(want_host 비움 — 이용권이 안 생기는 신청이 진짜 DJ 의 주소를 막지 않게) 적은 이름만 메모에
function testAlbumNote(v: unknown, me: any) {
  if (!isObj(v)) throw fail(400, '새 추억앨범의 주소 이름을 정해 주세요.');
  const n = labelOf(v.label);
  if (n.reason) throw fail(400, n.reason);
  return `테스트 결제 신청 — 새 추억앨범 주소 이름 ${n.label} · ${albumNameOf(v, me)}`;
}
// 대표 주소: www 아닌 것 먼저, 그다음 먼저 넣은 것(bakje album-info 와 같게)
const mainHost = (hosts: any[]) => [...hosts].sort((a, b) => Number(a.host.startsWith('www.')) - Number(b.host.startsWith('www.')) || (a.created || 0) - (b.created || 0))[0]?.host || '';
// 가진 앨범: [{id, name, host(퓨니코드), site, paidUntil, state}]
async function albumsOf(ids: string[]) {
  if (!ids.length) return [];
  const [rows, hosts]: any = await Promise.all([
    q(db.from('bj_albums').select('id,name,state,paid_until').in('id', ids)),
    q(db.from('bj_hosts').select('host,album,created').in('album', ids))]);
  return ids.map((id) => rows.find((r: any) => r.id === id)).filter(Boolean).map((a: any) => {
    const host = mainHost(hosts.filter((h: any) => h.album === a.id));
    return { id: a.id, name: a.name || '', host, site: host ? `https://${host}/` : '', paidUntil: a.paid_until ? Number(a.paid_until) : null, state: a.state };
  });
}

// 로그인한 회원(bakje 와 같은 세션 표)
async function needMember(req: Request, now: number) {
  const token = req.headers.get('x-bj-session') || '';
  if (!/^[-_A-Za-z0-9]{43}$/.test(token)) throw fail(401, '다시 로그인해 주세요.');
  const s: any = await q(db.from('bj_sessions').select('member,expires').eq('token', await sha256hex(token)).maybeSingle());
  if (!s || s.expires < now) throw fail(401, '다시 로그인해 주세요.');
  const m: any = await q(db.from('bj_members').select('id,login_id,nickname,verified,state,is_admin').eq('id', s.member).maybeSingle());
  if (!m) throw fail(401, '다시 로그인해 주세요.');
  if (m.state === 'banned') throw fail(403, '이용이 막힌 계정이에요.');
  return m;
}
async function cfg() {
  const r: any = await q(db.from('bj_settings').select('value').eq('key', 'billing').maybeSingle());
  const v = isObj(r?.value) ? r.value : {};
  const p = isObj(v.prices) ? v.prices : {};
  const y = isObj(v.year) ? v.year : {};
  const price = (o: any, k: string) => (Number.isSafeInteger(o[k]) && o[k] > 0 ? o[k] : 0);
  return {
    bank: line(v.bank, 30), number: line(v.number, 40), holder: line(v.holder, 30),
    prices: { munchkin: price(p, 'munchkin'), album: price(p, 'album'), bundle: price(p, 'bundle') } as Record<string, number>,
    // 1년치 한 번에(12개월) 할인 값 — 없으면 월 값 × 12
    year: { munchkin: price(y, 'munchkin'), album: price(y, 'album'), bundle: price(y, 'bundle') } as Record<string, number>,
    // 새 추억앨범 신청을 받는가 — 2026-11-23(변경-1123) 기본 열림. 운영자가 끄려면 albumOpen:false(그때 화면은 베타 안내). 가진 앨범 연장은 늘 된다
    albumOpen: v.albumOpen !== false
  };
}
// 유료화 2027년 1월 1일 0시(한국) — 그때부터 이용권이 있어야 봇이 방송에 들어간다(앱 desktop/munchkin-pass.cjs 의 PAID_FROM 과 같은 때).
// 신청은 지금부터 받는다(변경-1123 — 12/1 문 없앰). 1/1 전에 확인된 결제는 먼치킨·추억앨범 모두 이용 기간을 1월 1일부터 센다(무료인 날을 돈 내고 쓴 것으로 치지 않는다).
const PAID_FROM = Date.parse('2027-01-01T00:00:00+09:00');
// 옛 화면(먼치킨.com/album v10)은 info.munchkinFrom 이 지나야 먼치킨 이용권 신청 칸을 연다 — 신청을 받기 시작한 때(11/23)를 준다(새 화면은 쓰지 않음)
const ORDER_OPENED = Date.parse('2026-11-23T00:00:00+09:00');
// 먼치킨 이용 기간이 생기는 신청(먼치킨만·먼치킨 + 추억앨범·먼치킨 추가)
const MUNCHKIN_PLANS = ['munchkin', 'bundle', 'add-munchkin'];
const ALBUM_BETA = '추억앨범은 지금 베타 테스트 중이라 아직 신청할 수 없어요. 추후 공개할게요.';
const yearOf = (c: any, k: string) => c.year[k] || c.prices[k] * 12;
const priceOf = (c: any, plan: string, months: number) => (months === 12 ? yearOf(c, plan) : c.prices[plan] * months);
// 추가 값: 더하는 것의 한 달 값 × 남은 날 ÷ 30, 100원 단위 올림. 끝나는 날은 가진 이용권과 같게.
//  한 달 값 = 가진 이용권을 1년치로 샀으면 더하는 것 1년 값 ÷ 12(예: 30,000 ÷ 12 = 2,500), 달마다 샀으면 더하는 것 월 값.
function addonQuote(c: any, plan: string, ents: Record<string, number>, now: number, yearly: boolean) {
  const a = ADDON[plan];
  const end = ents[a.have] || 0;
  if (end <= now + DAY) return null;                       // 가진 이용권이 없거나 하루도 안 남음
  if ((ents[a.add] || 0) >= end) return null;              // 이미 그날까지 있음
  // 무료 기간(12월 31일까지) 날은 세지 않는다(먼치킨·추억앨범 모두 — 변경-1123)
  const from = Math.max(now, ents[a.add] || 0, PAID_FROM);
  if (from >= end) return null;
  const days = Math.ceil((end - from) / DAY);
  const perMonth = yearly ? yearOf(c, a.add) / 12 : c.prices[a.add];
  if (!(perMonth > 0)) return null;
  const amount = Math.ceil((perMonth * days / 30) / 100) * 100;
  return { amount, until: end, days, perMonth: Math.round(perMonth), yearly };
}
// 가진 이용권을 마지막으로 1년치로 샀는지(마지막 확인된 일반 신청 기준)
async function boughtYearly(member: string, product: string) {
  const plans = Object.keys(PLANS).filter((k) => !ADDON[k] && PLANS[k].products.includes(product));
  const r: any = await q(db.from('bj_orders').select('months').eq('member', member).eq('state', 'paid').in('plan', plans).order('done', { ascending: false }).limit(1));
  return r?.[0]?.months === 12;
}
async function addonsOf(c: any, member: string, ents: Record<string, number>, now: number) {
  const out: Record<string, any> = {};
  for (const k of Object.keys(ADDON)) {
    if ((ents[ADDON[k].have] || 0) <= now + DAY) continue;
    const quote = addonQuote(c, k, ents, now, await boughtYearly(member, ADDON[k].have));
    if (quote) out[k] = quote;
  }
  return out;
}
const open = (c: any) => Boolean(c.bank && c.number && c.holder);
const ownsOf = async (member: string) => ((await q(db.from('bj_album_owners').select('album').eq('member', member))) as any[]).map((r) => r.album);
const entsOf = async (member: string) => Object.fromEntries(((await q(db.from('bj_entitlements').select('product,until').eq('member', member))) as any[]).map((e) => [e.product, Number(e.until)]));
// 이용 기간 + 가진 앨범: 추억앨범 기간은 bj_entitlements 와 가진 앨범의 결제 끝나는 날(paid_until) 중 늦은 쪽(운영자가 앨범에 바로 넣은 기간도 보이게)
async function entsFull(member: string) {
  const [ents, albums]: any = await Promise.all([entsOf(member), ownsOf(member).then(albumsOf)]);
  for (const a of albums) if (a.paidUntil && a.paidUntil > (ents.album || 0)) ents.album = a.paidUntil;
  return { ents, albums };
}
// newAlbum: 새 추억앨범 신청이면 {label(주소 이름), name(앨범 이름), host(퓨니코드)} — 확인되면 album 에 새 앨범 번호가 들어간다
// pay(v6) = 'bank'(계좌이체) | 'card'(카드) · payAt = 카드 결제가 끝난 때 · state 'test' = 테스트 결제(실제 결제 아님 — 이용권 없음)
const orderOut = (o: any) => ({ id: o.id, plan: o.plan, months: o.months, amount: o.amount, payer: o.payer, album: o.album, state: o.state, created: o.created, sent: o.sent ?? null, done: o.done ?? null, nick: o.nick, until_to: o.until_to ?? null,
  newAlbum: o.want_host ? { label: o.want_label || '', name: o.want_name || '', host: o.want_host } : null, pay: o.pay === 'card' ? 'card' : 'bank', payAt: o.pay_at ?? null });
const periodText = (o: any) => (o.months ? `${o.months === 12 ? '1년' : o.months + '개월'}` : `${new Date(Number(o.until_to) + 9 * 3600000).toISOString().slice(0, 10)}까지`);
const won = (n: number) => n.toLocaleString('ko-KR') + '원';
async function notifyOps(text: string, title: string, body: string) {
  await pushTo(null, { title, body, url: '/ops/', badge: await waitingCount() });
  const url = env('BILLING_WEBHOOK');
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(url)) return;
  try { await http(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: text.slice(0, 1900), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(8000) }); }
  catch { /* 알림이 안 가도 운영자 화면에 남아 있다 */ }
}
// 운영자 앱 알림 숫자: "입금했어요"를 누른 계좌이체 신청(카드 신청은 운영자가 확인할 것이 없어 빠진다 — v6)
const waitingCount = async () => ((await q(db.from('bj_orders').select('id').eq('state', 'pending').eq('pay', 'bank').not('sent', 'is', null))) as any[]).length;
const quiet = async (p: Promise<unknown>) => { try { await p; } catch (e) { console.error('알림', e); } };

// ── 운영자 앱 푸시(Web Push · VAPID · aes128gcm) ──
// 아이폰은 홈 화면에 추가한 웹 앱만 푸시를 받는다(iOS 16.4+). VAPID 열쇠는 처음 쓸 때 여기서 만들어 bj_settings "vapid" 에 둔다(밖으로 안 나감).
const Z = String.fromCharCode(0);
const PUSH_HOST = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of parts) { out.set(x, i); i += x.length; } return out; };
let vapidCache: { key: CryptoKey; pub: string } | null = null;
async function vapid() {
  if (vapidCache) return vapidCache;
  let r: any = await q(db.from('bj_settings').select('value').eq('key', 'vapid').maybeSingle());
  if (!r?.value?.jwk) {
    const kp: any = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const value = { jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    await q(db.from('bj_settings').upsert({ key: 'vapid', value, updated: Date.now() }, { onConflict: 'key', ignoreDuplicates: true }));
    r = await q(db.from('bj_settings').select('value').eq('key', 'vapid').maybeSingle());
  }
  const key = await crypto.subtle.importKey('jwk', r.value.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return (vapidCache = { key, pub: r.value.pub });
}
async function vapidAuth(endpoint: string) {
  const v = await vapid();
  const part = (o: unknown) => b64u(enc.encode(JSON.stringify(o)));
  const unsigned = part({ typ: 'JWT', alg: 'ES256' }) + '.' + part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:likegorogoro@naver.com' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc.encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${v.pub}`;
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}
async function seal(sub: any, text: string) {
  const ua = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  const mine: any = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const minePub = new Uint8Array(await crypto.subtle.exportKey('raw', mine.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, mine.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info' + Z), ua, minePub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm' + Z), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce' + Z), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(21); head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65;
  return cat(head, minePub, body);
}
// member 가 있으면 그 사람 기기만, 없으면 모든 운영자 기기. 받은 기기 수를 돌려준다.
async function pushTo(member: string | null, msg: Record<string, unknown>) {
  let ids: string[] = member ? [member] : ((await q(db.from('bj_members').select('id').eq('is_admin', true))) as any[]).map((r) => r.id);
  if (!ids.length) return 0;
  const subs: any[] = await q(db.from('bj_push_subs').select('*').in('member', ids));
  const text = JSON.stringify(msg);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const r = await http(s.endpoint, { method: 'POST', body: await seal(s, text), signal: AbortSignal.timeout(8000),
        headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high', Authorization: await vapidAuth(s.endpoint) } });
      if (r.status === 404 || r.status === 410) await q(db.from('bj_push_subs').delete().eq('id', s.id));   // 앱을 지웠거나 폰을 바꿈
      else if (r.ok) { sent++; await q(db.from('bj_push_subs').update({ ok: Date.now() }).eq('id', s.id)); }
      else console.error('push', r.status, (await r.text().catch(() => '')).slice(0, 200));
    } catch (e) { console.error('push', String(e)); }
  }));
  return sent;
}

// ── 새 추억앨범 만들기(운영자가 입금을 확인할 때) ──
// 앨범(bj_albums) → 주소(bj_hosts) → 사이트가 읽는 주소 파일(저장소 h/<주소>.json — bakje writeHost 와 같은 모양) → 주인(신청한 계정, bj_album_owners)
//  → 그 계정을 DJ 로 → 신청에 새 앨범 번호 → 그 계정의 먼치킨(봇 프로그램 중 사용 승인된 가장 최근 기기)을 최초 박제판 저절로 올리기에 잇는다(bj_bots).
// 중간에 실패하면 만든 것을 지운다(앨범을 지우면 주소·주인·봇 줄은 함께 지워진다).
async function makeAlbum(o: any, now: number) {
  if (!o.member) throw fail(409, '신청한 회원이 탈퇴했어요. 이 신청은 거절해 주세요.');
  const host = String(o.want_host || '');
  if (await q(db.from('bj_hosts').select('host').eq('host', host).maybeSingle())) throw fail(409, HOST_TAKEN_OPS);
  const name = line(o.want_name, 40) || '추억앨범';
  let id = '';
  for (let i = 0; i < 5 && !id; i++) {
    const cand = 'a' + rid(9);   // ALBUM_RE ^[a-z][a-z0-9-]{1,30}$ 에 맞는 번호
    const { error } = await db.from('bj_albums').insert({ id: cand, name, note: '먼치킨.com 신청 ' + o.id, created: now });
    if (!error) id = cand;
    else if (error.code !== '23505') { console.error(error); throw fail(503, BROKEN); }
  }
  if (!id) throw fail(503, BROKEN);
  let wrote = false;
  try {
    const h = await db.from('bj_hosts').insert({ host, album: id, created: now });
    if (h.error) { if (h.error.code === '23505') throw fail(409, HOST_TAKEN_OPS); console.error(h.error); throw fail(503, BROKEN); }
    const up = await db.storage.from('bakje').upload(`h/${host}.json`, new Blob([JSON.stringify({ album: id, name })], { type: 'application/json' }), { upsert: true, contentType: 'application/json', cacheControl: '60' });
    if (up.error) { console.error('host', up.error.message); throw fail(503, BROKEN); }
    wrote = true;
    await q(db.from('bj_album_owners').upsert({ album: id, member: o.member, created: now }));
    await q(db.from('bj_members').update({ role: 'dj' }).eq('id', o.member));
    await q(db.from('bj_orders').update({ album: id }).eq('id', o.id));
    const devs: any[] = await q(db.from('bj_member_devices').select('device,seen').eq('member', o.member).eq('program', 'bot').order('seen', { ascending: false }).limit(20));
    if (devs.length) {
      const ok: any[] = await q(db.from('junlive_devices').select('id,nickname,tag').in('id', devs.map((d) => d.device)).eq('state', 'approved'));
      const pick = devs.map((d) => ok.find((x) => x.id === d.device)).find(Boolean);
      if (pick) await q(db.from('bj_bots').upsert({ id: pick.id, album: id, label: [pick.nickname, pick.tag && '@' + pick.tag].filter(Boolean).join(' ').slice(0, 40), created: now }));
    }
    return id;
  } catch (e) {
    try {
      if (wrote) { const rm = await db.storage.from('bakje').remove([`h/${host}.json`]); if (rm.error) console.error('주소 파일 지우기', rm.error.message); }
      const del = await db.from('bj_albums').delete().eq('id', id);
      if (del.error) console.error('앨범 지우기', del.error);
    } catch (x) { console.error(x); }
    throw e;
  }
}

// ── 신청 만들기(order · card-start 가 같이 씀 — 검사가 두 벌이 되지 않게, v6) ──
// 금액은 서버가 정한다(priceOf · addonQuote — 화면이 보낸 값은 안 믿음). 한도·횟수는 order 의 것 그대로(1시간 10번 · 기다리는 신청 3개).
//  pay 'card' + testOnly(테스트 모드에서 만든 카드 신청): 어떤 결제가 와도 이용권 없음. 새 앨범 주소는 잡아 두지 않고 메모(note)에만.
//  카드는 같은 내용(이용권·기간·앨범·금액)의 결제 안 끝난 카드 신청이 있으면 새로 안 만들고 그것을 준다(reuse).
async function buildOrder(b: any, me: any, now: number, c: any, pay = 'bank', testOnly = false): Promise<{ row: any; reuse: boolean }> {
  if (!open(c)) throw fail(503, '이용권 신청을 준비하고 있어요. 조금 뒤에 다시 해 주세요.');
  const plan = typeof b.plan === 'string' && PLANS[b.plan] ? b.plan : '';
  if (!plan) throw fail(400, '이용권을 골라 주세요.');
  const add = ADDON[plan];
  if (!c.prices[add ? add.add : plan]) throw fail(400, '이 이용권은 아직 준비 중이에요.');
  const months = add ? 0 : Number(b.months);
  if (!add && !MONTHS.includes(months)) throw fail(400, '기간을 골라 주세요.');
  // 본인인증은 2026-11-18 뺐다 — 로그인한 회원이면 신청할 수 있다
  let amount = add ? 0 : priceOf(c, plan, months), untilTo: number | null = null;
  if (add) {
    const quote = (await addonsOf(c, me.id, (await entsFull(me.id)).ents, now))[plan];
    if (!quote) throw fail(400, `지금은 ${PLANS[plan].name}를 할 수 없어요. 일반 이용권으로 신청해 주세요.`);
    amount = quote.amount; untilTo = quote.until;
  }
  let album: string | null = null, want: { host: string; label: string; name: string; busy: boolean } | null = null, note = '';
  if (PLANS[plan].products.includes('album')) {
    const owns = await ownsOf(me.id);
    if (!owns.length) {   // 앨범이 아직 없는 DJ — 새 추억앨범 신청(v4). 베타 동안(albumOpen 아님)에는 받지 않는다(운영자가 직접 만든 시범 앨범만)
      if (testOnly) note = testAlbumNote(b.newAlbum, me);
      else {
        if (!c.albumOpen) throw fail(403, ALBUM_BETA);
        want = await newAlbumOf(b.newAlbum, me, pay);
      }
    }
    else {
      album = typeof b.album === 'string' && owns.includes(b.album) ? b.album : owns.length === 1 ? owns[0] : null;
      if (!album) throw fail(400, '연장할 추억앨범을 골라 주세요.');
    }
  }
  if (pay === 'card') {
    const mine: any[] = await q(db.from('bj_orders').select('*').eq('member', me.id).eq('state', 'pending').eq('pay', 'card'));
    const same = mine.find((o) => !o.pay_channel && o.plan === plan && o.months === months && (o.album ?? null) === album && (o.want_host ?? null) === (want?.host ?? null)
      && o.amount === amount && (o.until_to ?? null) === untilTo && o.test_only === testOnly);
    // 결제창을 닫아 버린 다른 내용의 카드 신청(돈이 들어온 적 없음)은 포트원에 물어 결제 없음(404)·READY 면 취소로 정리 — 기다리는 신청 한도에 막히지 않게(고침 2)
    await Promise.all(mine.filter((o) => o !== same && !o.pay_channel).map((o) => dropIfUnpaid(o, now)));
    if (same) return { row: same, reuse: true };
    // 새 앨범 신청은 한 번에 하나만 — 결제 안 끝난 카드 새 앨범 신청이 정리되고 나서도 남아 있으면 409
    if (want?.busy) {
      const still: any[] = await q(db.from('bj_orders').select('id').eq('member', me.id).eq('state', 'pending').not('want_host', 'is', null).limit(1));
      if (still.length) throw fail(409, ALBUM_WAITING);
    }
  }
  if (!await hit('bjod:' + me.id, 3600, 10)) throw fail(429, '신청을 너무 자주 했어요. 조금 뒤에 다시 해 주세요.');
  const waiting: any = await q(db.from('bj_orders').select('id').eq('member', me.id).eq('state', 'pending'));
  if (waiting.length >= 3) throw fail(409, '확인을 기다리는 신청이 있어요. 그 신청을 마치거나 취소한 뒤 다시 해 주세요.');
  const payer = ((me.nickname || 'DJ').replace(/\s+/g, '').slice(0, 6)) + digits4();
  const id = 'o' + rid(11);
  const row: any = { id, member: me.id, nick: me.nickname || '', plan, months, amount, payer, album, created: now, until_to: untilTo,
    want_host: want?.host ?? null, want_label: want?.label ?? null, want_name: want?.name ?? null,
    ...(pay === 'card' ? { pay: 'card', pay_id: 'mk-' + id, test_only: testOnly, ...(note ? { note } : {}) } : {}) };
  await q(db.from('bj_orders').insert(row));
  return { row: { ...row, state: 'pending' }, reuse: false };
}

// 이용 기간 늘리기(ops-confirm · 카드 결제가 같이 씀 — v6). 새 추억앨범 신청이면 앨범부터 만든다.
//  계좌이체(ops-confirm): 앨범을 만들다 실패하면 신청을 기다림으로 되돌리고 오류(운영자가 다시 확인하거나 거절).
//  카드(card): 돈이 이미 들어왔으니 paid 그대로 두고 기간은 늘린다 — albumFail 에 까닭(운영자 알림: 직접 만들거나 환불).
async function grantOrder(o: any, now: number, card = false) {
  let albumFail = '';
  if (o.want_host && !o.album) {
    try { o.album = await makeAlbum(o, now); }
    catch (e) {
      if (!card) {
        const { error } = await db.from('bj_orders').update({ state: 'pending', done: null }).eq('id', o.id).eq('state', 'paid');
        if (error) console.error('되돌리기', error);
        throw e;
      }
      console.error('카드 결제 앨범 만들기', e);
      albumFail = e instanceof Fail ? e.message : BROKEN;
    }
  }
  // 일반: 지금(또는 남은 끝)부터 개월 수 × 30일 더함 · 추가(months 0): 맞춘 끝나는 날(until_to)까지
  //  무료 기간(12월 31일까지)에 확인돼도 1월 1일부터 센다 — 먼치킨(v5)·추억앨범과 앨범 결제 끝나는 날 모두(변경-1123). 새 앨범은 바로 만들어져 그 전에도 쓴다
  const add = o.months * MONTH_MS, out: Record<string, number> = {};
  const next = (cur: number) => (o.months ? Math.max(now, cur, PAID_FROM) + add : Math.max(cur, Number(o.until_to) || now));
  if (o.member) {
    const ents = await entsOf(o.member);
    for (const p of PLANS[o.plan].products) {
      const until = next(ents[p] || 0);
      await q(db.from('bj_entitlements').upsert({ member: o.member, product: p, until }));
      out[p] = until;
    }
  }
  if (o.album && PLANS[o.plan].products.includes('album')) {
    const a: any = await q(db.from('bj_albums').select('paid_until').eq('id', o.album).maybeSingle());
    if (a) {
      const until = next(Number(a.paid_until || 0));
      await q(db.from('bj_albums').update({ paid_until: until }).eq('id', o.album));
      out.albumPaid = until;
    }
  }
  return { until: out, albumFail };
}

// ── 카드 결제(포트원 V2 · KG이니시스, v6) ──
// 설정은 billing 과 따로 bj_settings "card" 에 둔다(ops-billing 이 billing 을 통째로 새로 써서 모르는 칸이 지워진다).
// 채널 키·상점 아이디는 비밀이 아니다(브라우저 결제창에 넘김). 결제 확인 열쇠 PORTONE_API_SECRET 는 서버에만 — 답·기록·알림에 내보내지 않는다.
const PORTONE_API = 'https://api.portone.io';
const PAY_RETURN = 'https://xn--s22bu18a0ub.com/album/';   // 휴대폰 결제에서 돌아오는 곳(기본 — 먼치킨.com/album) — 포트원이 paymentId·code·message 를 덧붙인다
const PAY_ID_RE = /^mk-o[a-z0-9]{11}$/;
const CARD_RECHECK_AFTER = 60000;   // info 가 다시 물어보는 결제 안 끝난 카드 신청: 만든 지 1분 지난 것(설계안 2-4)
async function cardCfg() {
  const r: any = await q(db.from('bj_settings').select('value').eq('key', 'card').maybeSingle());
  const v = isObj(r?.value) ? r.value : {};
  return {
    on: v.on === 'testers' || v.on === 'all' ? v.on : 'off',
    mode: v.mode === 'live' ? 'live' : 'test',
    channelKey: line(v.channelKey, 200),
    testers: Array.isArray(v.testers) ? v.testers.filter((x: unknown) => typeof x === 'string').map((x: string) => x.trim().toLowerCase()) : []
  };
}
// 카드 단추(변경-1123 4번): show = on 이 off 가 아님(모두에게 보임) · canPay = 실제로 결제창을 열 수 있음
//  (채널 키·상점 아이디가 있고, mode live 거나 — test 동안은 — testers·운영자). show 가 거짓이면 키는 빈 글. me 가 없으면(로그인 안 함) 결제 못 함·키 빈 글.
function cardFor(cc: any, me: any) {
  const storeId = env('PORTONE_STORE_ID');
  const show = cc.on !== 'off';
  const tester = Boolean(me) && (me.is_admin === true || (typeof me.login_id === 'string' && cc.testers.includes(me.login_id)));
  const canPay = show && Boolean(me) && Boolean(cc.channelKey && storeId) && (cc.mode === 'live' || tester);
  const keys = show && Boolean(me);
  return { show, canPay, mode: cc.mode, storeId: keys ? storeId : '', channelKey: keys ? cc.channelKey : '' };
}
// 결제창에서 돌아올 주소(변경-1123 6번, 휴대폰 결제): 화면이 보낸 returnUrl 은 https 이고 주소가 먼치킨.com·www.먼치킨.com 이거나
//  추억앨범 주소(bj_hosts)일 때만 쓴다 — bakje siteOf(CENTER + bj_hosts)와 같은 판단(고침 5). 아니면 먼치킨.com/album. 그 주소에 ?pay=<신청 번호>(포트원이 paymentId·code·message 를 덧붙임).
const CENTER_HOST = 'xn--s22bu18a0ub.com';
const RETURN_DROP = ['pay', 'paymentId', 'code', 'message', 'pgCode', 'pgMessage', 'transactionType', 'txId'];
async function returnBase(v: unknown) {
  if (typeof v !== 'string' || !v.startsWith('https://')) return '';
  let u: URL;
  try { u = new URL(v); } catch { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
  const host = u.hostname.toLowerCase();
  const ok = host === CENTER_HOST || host === 'www.' + CENTER_HOST || Boolean(await q(db.from('bj_hosts').select('host').eq('host', host).maybeSingle()));
  if (!ok) return '';
  for (const k of RETURN_DROP) u.searchParams.delete(k);
  u.hash = '';
  return u.toString();
}
const withPay = (base: string, id: string) => { const u = new URL(base || PAY_RETURN); u.searchParams.set('pay', id); return u.toString(); };
// 결제창에 넘길 값 — 금액·이름·결제 번호는 모두 서버가 정한 것
const payOf = (o: any, card: any, back = '') => ({ storeId: card.storeId, channelKey: card.channelKey, paymentId: o.pay_id, orderName: `${PLANS[o.plan].name} 이용권 ${periodText(o)}`,
  totalAmount: o.amount, currency: 'KRW', payMethod: 'CARD', redirectUrl: withPay(back, o.id) });
// 포트원 결제 조회: 결제 시도 전이면 null(404), 못 물으면 503(이용권은 주지 않는다)
async function portonePayment(payId: string) {
  const secret = env('PORTONE_API_SECRET');
  if (!secret || !PAY_ID_RE.test(String(payId || ''))) { console.error('portone: 결제 확인 열쇠가 없거나 결제 번호 모양이 달라요'); throw fail(503, BROKEN); }
  let r: Response;
  try { r = await http(`${PORTONE_API}/payments/${encodeURIComponent(payId)}`, { headers: { Authorization: `PortOne ${secret}` }, signal: AbortSignal.timeout(10000) }); }
  catch (e) { console.error('portone', String(e)); throw fail(503, BROKEN); }
  if (r.status === 404) return null;
  const p: any = await r.json().catch(() => null);
  if (!r.ok || !isObj(p)) { console.error('portone', r.status, line(p?.type, 60)); throw fail(503, BROKEN); }
  return p;
}
const CARD_DONE_MSG: Record<string, string> = {
  failed: '결제가 되지 않았어요. 다시 결제하거나 신청을 취소해 주세요.',
  cancelled: '취소된 결제예요. 이 신청을 취소하고 새로 신청해 주세요.',
  mismatch: '결제 내용이 신청과 달라 이용권을 드리지 못했어요. 운영자가 확인하고 연락드릴게요.',
  refund: '테스트 결제 신청이라 이용권은 생기지 않아요. 실제로 나간 돈은 돌려 드려요.',
  album: '결제는 끝났어요. 앨범은 운영자가 곧 만들어 드릴게요.',
  grant: '결제는 끝났어요. 이용 기간은 운영자가 곧 넣어 드릴게요.',
  canceled: '취소한 신청이에요. 새로 신청해 주세요.',
  late: '취소한 신청이라 이용권은 생기지 않아요. 결제한 돈은 운영자가 돌려 드려요.',
  rejected: '운영자가 거절한 신청이에요. 새로 신청해 주세요.'
};
// 이미 끝난 신청은 포트원에 다시 묻지 않고 그 상태로 답한다
function settled(o: any) {
  if (!o) throw fail(404, '신청을 찾을 수 없어요.');
  if (o.state === 'paid' || o.state === 'test' || o.state === 'pending') return { state: o.state, order: o };
  return { state: 'failed', order: o, message: CARD_DONE_MSG[o.state === 'rejected' ? 'rejected' : 'canceled'] };
}
const reread = async (o: any) => await q(db.from('bj_orders').select('*').eq('id', o.id).maybeSingle());
// 조건부 update 가 빗나갔을 때(그 사이 다른 요청이 상태를 바꿈): 다시 읽어 취소·거절이 됐으면(예: 결제가 끝나는 순간 다른 탭의 card-start 가 READY 로 보고 정리)
//  이미 받은 포트원 답으로 lateCard — 이용권 없이 운영자에게 환불 알림 한 번(고침 2회차 1). 그 밖에는 그 상태로 답한다.
async function missed(o: any, now: number, p: any): Promise<{ state: string; order: any; message?: string }> {
  const fresh = await reread(o);
  if (fresh && (fresh.state === 'canceled' || fresh.state === 'rejected')) return lateCard(fresh, now, p);
  return settled(fresh);
}
// 카드 신청 마무리(card-done · cancel · info 다시 확인이 같이 씀). 이용권을 줄지는 화면이 아니라 포트원이 알려 준 결제로만 정한다:
//  TEST 채널(또는 모르는 채널) → 'test'(이용권·앨범 없음) · LIVE 라도 테스트 모드에서 만든 신청(test_only) → 'test' + 운영자에게 환불 알림
//  LIVE + 보통 신청 + 결제 번호·상점·금액·통화가 신청과 같음 → paid + 기간. pending 에서 바꾸기는 조건부 update 한 번(card-done 두 번·동시에 와도 한 번).
//  got: 이미 물어 본 포트원 답(cancel) — 없으면 여기서 묻는다.
async function finishCard(o: any, now: number, got?: any): Promise<{ state: string; order: any; message?: string }> {
  if (o.state === 'canceled' || o.state === 'rejected') return lateCard(o, now, got);
  if (o.state !== 'pending') return settled(o);
  const p = got === undefined ? await portonePayment(o.pay_id) : got;
  if (!p) return { state: 'pending', order: o };
  const status = String(p.status || '');
  if (status === 'FAILED') return { state: 'failed', order: o, message: CARD_DONE_MSG.failed };
  if (status === 'CANCELLED' || status === 'PARTIAL_CANCELLED') return { state: 'failed', order: o, message: CARD_DONE_MSG.cancelled };
  if (status !== 'PAID') return { state: 'pending', order: o };   // READY · PENDING 등 — 아직 결제가 안 끝남(다시 결제할 수 있음)
  const type = isObj(p.channel) ? p.channel.type : '';
  const channel = type === 'LIVE' || type === 'TEST' ? type : '?';
  const paidAt = Date.parse(String(p.paidAt || ''));
  const at = Number.isFinite(paidAt) ? paidAt : now;
  const what = `${o.nick || '(닉네임 없음)'} · ${PLANS[o.plan].name} ${periodText(o)}`;
  if (channel !== 'LIVE' || o.test_only === true) {
    const r: any = await q(db.from('bj_orders').update({ state: 'test', done: now, pay_at: at, pay_channel: channel }).eq('id', o.id).eq('state', 'pending').select('*'));
    if (!r?.[0]) return missed(o, now, p);
    const real = channel === 'LIVE';
    if (real) await quiet(notifyOps(`⚠️ 실제 돈이 들어온 테스트 결제 신청 — 환불 필요\n${what}\n금액 ${won(o.amount)} · 결제 번호 ${o.pay_id}\n이용권은 주지 않았어요. 포트원 콘솔에서 결제를 취소해 주세요.`,
      `⚠️ 테스트 결제 신청에 실제 결제 ${won(o.amount)}`, `${what}\n환불(결제 취소)이 필요해요.`));
    else await quiet(notifyOps(`🧪 테스트 결제 — 이용권 안 줌\n${what}\n금액 ${won(o.amount)} · 결제 번호 ${o.pay_id}`, `🧪 테스트 결제 ${won(o.amount)}`, `${what}\n테스트 결제라 이용권은 주지 않았어요.`));
    return { state: 'test', order: r[0], ...(real ? { message: CARD_DONE_MSG.refund } : {}) };
  }
  const total = isObj(p.amount) ? Number(p.amount.total) : NaN;
  if (p.id !== o.pay_id || p.storeId !== env('PORTONE_STORE_ID') || p.currency !== 'KRW' || total !== Number(o.amount)) {
    // 이용권 없음 · 신청은 기다림 그대로. 알림은 한 번만(pay_channel 이 비어 있을 때 채우면서)
    const r: any = await q(db.from('bj_orders').update({ pay_channel: channel, pay_at: at }).eq('id', o.id).eq('state', 'pending').is('pay_channel', null).select('id'));
    if (!r?.[0]) { const fresh = await reread(o); if (fresh && (fresh.state === 'canceled' || fresh.state === 'rejected')) return lateCard(fresh, now, p); }
    else await quiet(notifyOps(`⚠️ 카드 결제가 신청과 달라요 — 이용권 안 줌\n${what}\n신청 금액 ${won(o.amount)} · 결제 금액 ${Number.isFinite(total) ? won(total) : '?'} ${line(p.currency, 8)}\n결제 번호 ${o.pay_id} — 포트원 콘솔에서 확인하고 결제를 취소해 주세요.`,
      '⚠️ 카드 결제가 신청과 달라요', `${what}\n신청 금액 ${won(o.amount)} — 포트원 콘솔에서 확인해 주세요.`));
    return { state: 'failed', order: { ...o, pay_channel: channel, pay_at: o.pay_at ?? at }, message: CARD_DONE_MSG.mismatch };
  }
  const r: any = await q(db.from('bj_orders').update({ state: 'paid', done: now, pay_at: at, pay_channel: 'LIVE' }).eq('id', o.id).eq('state', 'pending').select('*'));
  if (!r?.[0]) return missed(o, now, p);
  const paid = r[0];
  let g: { until: Record<string, number>; albumFail: string } | null = null;
  try { g = await grantOrder(paid, now, true); } catch (e) { console.error('카드 결제 기간 늘리기', e); }
  const fresh = paid.want_host ? `\n📚 새 추억앨범 · ${paid.want_label}.먼치킨.com` : '';
  const after = !g ? '⚠️ 이용 기간을 늘리지 못했어요 — 직접 늘리거나 환불해 주세요.'
    : g.albumFail ? `⚠️ 앨범을 못 만들었어요(${g.albumFail}) — 직접 만들거나 환불해 주세요.` : '이용 기간을 늘렸어요.';
  await quiet(notifyOps(`💳 카드 결제 ${won(paid.amount)}\n${what}${fresh}\n${after}`, `💳 카드 결제 ${won(paid.amount)}`, `${what}${fresh}\n${after}`));
  return { state: 'paid', order: paid, ...(!g ? { message: CARD_DONE_MSG.grant } : g.albumFail ? { message: CARD_DONE_MSG.album } : {}) };
}
// 취소·거절한 카드 신청에 뒤늦게 결제가 끝난 경우(취소한 사이 다른 창·휴대폰 결제창에서 결제를 마침 — 고침 1):
//  이용권은 주지 않고, 결제를 처음 본 때 pay_channel(LIVE 면 pay_at 도)을 채우며 운영자에게 한 번 알린다(LIVE = 환불 필요).
//  결제가 없으면 pay_channel 'NONE'(결제 없음을 확인함)으로 표시해 info 다시 확인이 또 묻지 않게 한다. card-done 은 'NONE' 이어도 묻는다(그 뒤에 결제가 끝날 수 있어서).
async function lateCard(o: any, now: number, got?: any) {
  const base = settled(o);
  if (o.pay_channel && o.pay_channel !== 'NONE') return o.pay_channel === 'LIVE' ? { ...base, message: CARD_DONE_MSG.late } : base;
  const p = got === undefined ? await portonePayment(o.pay_id) : got;
  const same = (b: any) => (o.pay_channel ? b.eq('pay_channel', o.pay_channel) : b.is('pay_channel', null));
  if (!p || String(p.status || '') !== 'PAID') {
    if (!o.pay_channel) await q(same(db.from('bj_orders').update({ pay_channel: 'NONE' }).eq('id', o.id).eq('state', o.state)));
    return base;
  }
  const type = isObj(p.channel) ? p.channel.type : '';
  const channel = type === 'LIVE' || type === 'TEST' ? type : '?';
  const paidAt = Date.parse(String(p.paidAt || ''));
  const at = Number.isFinite(paidAt) ? paidAt : now;
  const real = channel === 'LIVE';
  const r: any = await q(same(db.from('bj_orders').update({ pay_channel: channel, ...(real ? { pay_at: at } : {}) }).eq('id', o.id).eq('state', o.state)).select('*'));
  const row = r?.[0] || (await reread(o)) || o;
  if (r?.[0]) {
    const what = `${o.nick || '(닉네임 없음)'} · ${PLANS[o.plan].name} ${periodText(o)}`;
    const total = isObj(p.amount) ? Number(p.amount.total) : NaN;
    const why = o.state === 'rejected' ? '거절한' : '취소한';
    if (real) await quiet(notifyOps(`⚠️ ${why} 신청에 결제가 들어왔어요 — 환불 필요\n${what}\n결제 금액 ${Number.isFinite(total) ? won(total) : '?'} · 결제 번호 ${o.pay_id}\n이용권은 주지 않았어요. 포트원 콘솔에서 결제를 취소해 주세요.`,
      `⚠️ ${why} 신청에 결제 ${Number.isFinite(total) ? won(total) : ''}`, `${what}\n환불(결제 취소)이 필요해요.`));
    else await quiet(notifyOps(`🧪 ${why} 신청에 테스트 결제가 들어왔어요(실제 돈 아님)\n${what}\n결제 번호 ${o.pay_id}`, `🧪 ${why} 신청에 테스트 결제`, what));
  }
  return { state: 'failed', order: row, message: real ? CARD_DONE_MSG.late : base.message };
}
// 결제창을 닫아 버린 카드 신청 정리(고침 2): 기다림 → 취소, pay_channel 'NONE'(결제 없음을 확인함). 돈이 들어온 적 있는 신청은 건드리지 않는다.
async function dropCard(o: any, now: number) {
  await q(db.from('bj_orders').update({ state: 'canceled', done: now, pay_channel: 'NONE' }).eq('id', o.id).eq('state', 'pending').is('pay_channel', null));
}
// card-start 때(다른 내용): 포트원이 결제 없음(404)·READY·카드 거절(FAILED — 돈이 없음)이라고 하면 정리 · 그 밖(결제 끝남·취소됨 등)은 그대로 — 못 물으면 그대로 둔다(신청은 막지 않는다)
async function dropIfUnpaid(o: any, now: number, got?: any) {
  try {
    const p = got === undefined ? await portonePayment(o.pay_id) : got;
    const status = p ? String(p.status || '') : '';
    if (!p || status === 'READY' || status === 'FAILED') { await dropCard(o, now); return true; }
  } catch (e) { if (!(e instanceof Fail)) console.error('카드 정리', e); }
  return false;
}
// 카드 신청 다시 확인(info — 결제창을 닫아 버린 경우): 만든 지 1분 지난 것·최대 3개. 못 물어도 info 는 그대로 된다.
//  기다림: 결제 없음(404) → 정리 · READY 는 그대로(결제창이 열려 있을 수 있음 — 다른 탭이 결제 중인 신청을 지우지 않게, READY 정리는 card-start 때만)
//   · 그 밖 → 마무리(finishCard) / 취소·거절(pay_channel 비어 있음): 뒤늦은 결제가 있나 한 번(lateCard).
//  pay_channel 이 채워진 것(결제를 봤거나 'NONE' 으로 정리·확인한 것)은 다시 묻지 않는다.
async function recheckCards(member: string, now: number) {
  if (!env('PORTONE_API_SECRET')) return;
  try {
    const rows: any[] = await q(db.from('bj_orders').select('*').eq('member', member).in('state', ['pending', 'canceled', 'rejected']).eq('pay', 'card').is('pay_channel', null)
      .lt('created', now - CARD_RECHECK_AFTER).order('created', { ascending: false }).limit(3));
    await Promise.all(rows.map(async (o) => {
      try {
        if (o.state !== 'pending') { await lateCard(o, now); return; }
        const p = await portonePayment(o.pay_id);
        if (!p) await dropCard(o, now);
        else await finishCard(o, now, p);
      } catch (e) { if (!(e instanceof Fail)) console.error('카드 다시 확인', e); }
    }));
  } catch (e) { if (!(e instanceof Fail)) console.error('카드 다시 확인', e); }
}

async function handle(req: Request, now: number) {
  const raw = await req.text();
  if (raw.length > 4096) throw fail(413, '보낸 내용이 너무 커요.');
  let b: any; try { b = JSON.parse(raw); } catch { throw fail(400, '요청 모양이 올바르지 않아요.'); }
  if (!isObj(b) || typeof b.action !== 'string') throw fail(400, '요청 모양이 올바르지 않아요.');
  // 가격·카드 표시(변경-1123 1번 — 로그인 안 한 방문자도 상품·가격·위 띠를 본다). 계좌·내 신청·결제 키는 주지 않는다.
  if (b.action === 'prices') {
    const [c, cc]: any = await Promise.all([cfg(), cardCfg()]);
    return { ok: true, open: open(c), prices: c.prices, year: { munchkin: yearOf(c, 'munchkin'), album: yearOf(c, 'album'), bundle: yearOf(c, 'bundle') }, months: MONTHS,
      albumOpen: c.albumOpen, munchkinFrom: ORDER_OPENED, munchkinPaidFrom: PAID_FROM, now, card: cardFor(cc, null) };
  }
  const me = await needMember(req, now);
  switch (b.action) {
    // 내 이용권 화면: 계좌·가격·지금 이용 기간·내 신청 · 가진 앨범(albums, v4)
    case 'info': {
      await recheckCards(me.id, now);   // 결제창을 닫아 버린 카드 신청 마무리(v6)
      const [c, cc, full, orders]: any = await Promise.all([cfg(), cardCfg(), entsFull(me.id),
        q(db.from('bj_orders').select('*').eq('member', me.id).order('created', { ascending: false }).limit(20))]);
      const { ents, albums } = full, owns = albums.map((a: any) => a.id);
      const addons = await addonsOf(c, me.id, ents, now);
      return { ok: true, open: open(c), bank: open(c) ? { bank: c.bank, number: c.number, holder: c.holder } : null, prices: c.prices, year: { munchkin: yearOf(c, 'munchkin'), album: yearOf(c, 'album'), bundle: yearOf(c, 'bundle') }, months: MONTHS, addons, ents, owns, albums, orders: orders.map(orderOut), admin: me.is_admin === true,
        // albumOpen: 새 추억앨범 신청을 받는지(아니면 베타 — 화면은 안내·미리 보기) · munchkinFrom: 먼치킨 이용권을 받기 시작하는 때(그 전엔 무료)
        // munchkinPaidFrom: 이용권이 있어야 먼치킨을 쓰는 때(그 전엔 무료 — v5)
        // card(v6): {show, canPay, mode, storeId, channelKey} — 카드 단추를 보일지 · 실제로 결제할 수 있는지 · now: 서버 시각(위 띠를 1/1 0시에 저절로 내리게)
        albumOpen: c.albumOpen, munchkinFrom: ORDER_OPENED, munchkinPaidFrom: PAID_FROM, now, card: cardFor(cc, me) };
    }
    // 먼치킨 이용권(v5): 로그인한 먼치킨 프로그램이 켤 때·방송마다 묻는다. 본인인증·신청 여부와 관계없이 답한다(가볍게 — 표 두 개만 본다).
    //  active = 지금 이용권 기간 안 · until = 끝나는 때(ms, 없으면 null) · kind = 마지막으로 확인된 먼치킨 신청이 먼치킨만이면 'munchkin', 추억앨범과 함께면 'bundle'
    //  waiting = 확인을 기다리는 먼치킨 신청 수 · sent = 그중 "입금했어요"를 누른 것이 있는가 · free = 아직 무료 기간 · now = 서버 시각(PC 시계가 틀렸을 때 앱이 맞춘다)
    case 'munchkin-pass': {
      const [ents, paid, waiting]: any = await Promise.all([entsOf(me.id),
        q(db.from('bj_orders').select('plan').eq('member', me.id).eq('state', 'paid').in('plan', MUNCHKIN_PLANS).order('done', { ascending: false }).limit(1)),
        q(db.from('bj_orders').select('sent').eq('member', me.id).eq('state', 'pending').eq('pay', 'bank').in('plan', MUNCHKIN_PLANS).limit(5))]);   // 확인을 기다리는 것은 계좌이체 신청만(v6)
      const until = Number(ents.munchkin) || 0, plan = paid?.[0]?.plan;
      return { ok: true, active: until > now, until: until || null, kind: until ? (plan && plan !== 'munchkin' ? 'bundle' : 'munchkin') : null,
        from: PAID_FROM, now, free: now < PAID_FROM, waiting: waiting.length, sent: waiting.some((o: any) => Boolean(o.sent)) };
    }
    // 새 추억앨범 주소 이름 확인(쓰는 대로 바로) → {label, host, free, reason?}
    case 'album-name': {
      if (!await hit('bjan:' + me.id, 3600, 300)) throw fail(429, '너무 자주 확인했어요. 조금 뒤에 다시 해 주세요.');
      const n = labelOf(b.label);
      if (n.reason) return { ok: true, label: n.label, host: n.host, free: false, reason: n.reason };
      const taken = await hostTaken(n.host, me.id);
      return { ok: true, label: n.label, host: n.host, free: !taken, ...(taken ? { reason: taken } : {}) };
    }
    case 'order': {
      const c = await cfg();
      const { row } = await buildOrder(b, me, now, c, 'bank', false);
      return { ok: true, order: orderOut(row), bank: { bank: c.bank, number: c.number, holder: c.holder } };
    }
    // 카드 결제 시작(v6): order 와 같은 검사·같은 금액으로 카드 신청을 만들고(같은 내용이 있으면 그것) 결제창에 넘길 값을 준다
    case 'card-start': {
      const [c, cc]: any = await Promise.all([cfg(), cardCfg()]);
      const card = cardFor(cc, me);
      if (!card.canPay) throw fail(403, '카드 결제는 KG이니시스 심사가 끝나면 열려요. 지금은 계좌이체로 결제할 수 있어요.');
      // 테스트 모드(mode test)에서 만든 카드 신청은 test_only — 어떤 결제가 와도 이용권 없음
      const { row } = await buildOrder(b, me, now, c, 'card', card.mode === 'test');
      return { ok: true, order: orderOut(row), pay: payOf(row, card, await returnBase(b.returnUrl)) };
    }
    // 카드 결제 마치기(v6): 서버가 포트원에 직접 물어 확인 → {state: paid | test | pending | failed, order, message?}
    case 'card-done': {
      if (!await hit('bjcd:' + me.id, 3600, 300)) throw fail(429, '너무 자주 확인했어요. 조금 뒤에 다시 해 주세요.');
      const o: any = await q(db.from('bj_orders').select('*').eq('id', String(b.id || '')).eq('member', me.id).eq('pay', 'card').maybeSingle());
      if (!o) throw fail(404, '신청을 찾을 수 없어요.');
      const r = await finishCard(o, now);
      return { ok: true, state: r.state, order: orderOut(r.order), ...(r.message ? { message: r.message } : {}) };
    }
    // "입금했어요" — 운영자에게 알림
    case 'sent': {
      const r: any = await q(db.from('bj_orders').update({ sent: now }).eq('id', String(b.id || '')).eq('member', me.id).eq('state', 'pending').eq('pay', 'bank').select('*'));   // 카드 신청은 받지 않는다(v6)
      const o = r?.[0];
      if (!o) throw fail(404, '신청을 찾을 수 없어요.');
      const fresh = o.want_host ? `\n📚 새 추억앨범 · ${o.want_label}.먼치킨.com` : '';
      await notifyOps(`💸 입금했어요\n${o.nick || '(닉네임 없음)'} · ${PLANS[o.plan].name} ${periodText(o)}${fresh}\n금액 ${won(o.amount)} · 입금자명 ${o.payer}\n운영자 앱에서 확인해 주세요.`,
        `💸 ${won(o.amount)} 입금했어요`, `${o.payer} · ${PLANS[o.plan].name} ${periodText(o)}${fresh}\n토스뱅크에서 들어왔는지 보고 확인해 주세요.`);
      return { ok: true, order: orderOut(o) };
    }
    case 'cancel': {
      // 카드 신청(v6): 먼저 포트원에 물어 결제가 끝나 있으면 취소하지 않고 마친다(결제했는데 취소돼 버리는 일 막기). 못 물으면 취소하지 않는다(503).
      const mine: any = await q(db.from('bj_orders').select('*').eq('id', String(b.id || '')).eq('member', me.id).eq('state', 'pending').maybeSingle());
      if (mine?.pay === 'card') {
        const p = await portonePayment(mine.pay_id);
        if (p && String(p.status || '') === 'PAID') {
          const done = await finishCard(mine, now, p);
          // 금액·통화·상점·결제 번호가 달라 이용권을 못 준 결제(failed): 신청은 취소로(돈은 운영자가 환불 — 알림은 이미 감)
          if (done.state !== 'failed') return { ok: true, finished: true, state: done.state, order: orderOut(done.order),
            message: done.message || (done.state === 'paid' ? '결제가 이미 끝나 있어서 취소하지 않았어요. 이용 기간이 생겼어요.' : '테스트 결제가 이미 끝나 있어서 취소하지 않았어요.') };
        }
      }
      const r: any = await q(db.from('bj_orders').update({ state: 'canceled', done: now }).eq('id', String(b.id || '')).eq('member', me.id).eq('state', 'pending').select('*'));
      if (!r?.[0]) throw fail(404, '취소할 신청을 찾을 수 없어요.');
      return { ok: true, order: orderOut(r[0]) };
    }
  }
  // ── 운영자 ──
  if (me.is_admin !== true) throw fail(403, '운영자만 할 수 있어요.');
  switch (b.action) {
    case 'ops-orders': {
      const [waiting, recent, odd, c]: any = await Promise.all([
        q(db.from('bj_orders').select('*').eq('state', 'pending').eq('pay', 'bank').order('created', { ascending: true }).limit(200)),   // 카드 신청은 확인할 것이 없어 빠진다(v6)
        q(db.from('bj_orders').select('*').neq('state', 'pending').order('done', { ascending: false }).limit(30)),
        // 돈이 들어왔는데 이용권을 못 준 기다림 카드 신청(금액이 다름 — 고침 3): 지난 신청 맨 위에(환불 확인용)
        q(db.from('bj_orders').select('*').eq('state', 'pending').eq('pay', 'card').not('pay_at', 'is', null).order('created', { ascending: false }).limit(30)),
        cfg()]);
      return { ok: true, waiting: waiting.map(orderOut), recent: [...odd, ...recent].map(orderOut), billing: c };
    }
    // 운영자 앱 알림 받는 기기
    case 'push-key': return { ok: true, key: (await vapid()).pub };
    case 'push-add': {
      const s = isObj(b.sub) ? b.sub : {}, k = isObj(s.keys) ? s.keys : {};
      const endpoint = typeof s.endpoint === 'string' && s.endpoint.length < 1000 && PUSH_HOST.test(s.endpoint) ? s.endpoint : '';
      const ok64 = (v: unknown, lo: number, hi: number) => typeof v === 'string' && /^[-_A-Za-z0-9]+$/.test(v) && v.length >= lo && v.length <= hi;
      if (!endpoint || !ok64(k.p256dh, 80, 100) || !ok64(k.auth, 16, 30)) throw fail(400, '알림 정보가 올바르지 않아요.');
      const old: any = await q(db.from('bj_push_subs').select('id').eq('endpoint', endpoint).maybeSingle());
      const row = { id: old?.id || 'p' + rid(11), member: me.id, endpoint, p256dh: k.p256dh, auth: k.auth, label: line(b.label, 40) || '내 폰', created: now };
      await q(db.from('bj_push_subs').upsert(row, { onConflict: 'endpoint' }));
      return { ok: true, id: row.id };
    }
    case 'push-list': {
      const r: any = await q(db.from('bj_push_subs').select('id,label,created,ok').eq('member', me.id).order('created', { ascending: false }));
      return { ok: true, devices: r };
    }
    case 'push-del': {
      await q(db.from('bj_push_subs').delete().eq('id', String(b.id || '')).eq('member', me.id));
      return { ok: true };
    }
    case 'push-test': {
      const n = await pushTo(me.id, { title: '🔔 시험 알림', body: '이 알림이 보이면 입금 알림도 이 폰으로 와요.', url: '/ops/', badge: await waitingCount() });
      return { ok: true, sent: n };
    }
    case 'ops-confirm': {
      // 계좌이체 신청만(카드 신청은 포트원 결제로만 마친다 — 운영자가 잘못 눌러 돈 없이 기간이 느는 일 막기, v6)
      const r: any = await q(db.from('bj_orders').update({ state: 'paid', done: now }).eq('id', String(b.id || '')).eq('state', 'pending').eq('pay', 'bank').select('*'));
      const o = r?.[0];
      if (!o) throw fail(404, '확인할 신청을 찾을 수 없어요(이미 처리했을 수 있어요).');
      // 새 추억앨범 신청: 상태를 먼저 paid 로 바꿔 두 번 확인을 막은 뒤 앨범을 만든다 — 만들다 실패하면 다시 기다림으로 되돌린다(grantOrder)
      const { until } = await grantOrder(o, now);
      return { ok: true, order: orderOut(o), until };
    }
    case 'ops-reject': {
      const r: any = await q(db.from('bj_orders').update({ state: 'rejected', done: now, note: line(b.note, 200) }).eq('id', String(b.id || '')).eq('state', 'pending').eq('pay', 'bank').select('*'));   // 계좌이체 신청만(v6)
      if (!r?.[0]) throw fail(404, '신청을 찾을 수 없어요.');
      return { ok: true, order: orderOut(r[0]) };
    }
    // 계좌·가격 정하기(가격 0 = 그 이용권은 "준비 중")
    case 'ops-billing': {
      const p = isObj(b.prices) ? b.prices : {};
      const y = isObj(b.year) ? b.year : {};
      const price = (o: any, k: string) => { const n = Number(o[k]); return Number.isSafeInteger(n) && n >= 0 && n <= 1000000 ? n : 0; };
      const value = { bank: line(b.bank, 30), number: line(b.number, 40), holder: line(b.holder, 30),
        prices: { munchkin: price(p, 'munchkin'), album: price(p, 'album'), bundle: price(p, 'bundle') },
        year: { munchkin: price(y, 'munchkin'), album: price(y, 'album'), bundle: price(y, 'bundle') },
        // 새 추억앨범 신청 받기: 보낸 값이 있으면 그것, 없으면 지금 값 그대로(운영자 앱 설정 저장으로 저절로 바뀌지 않게)
        albumOpen: typeof b.albumOpen === 'boolean' ? b.albumOpen : (await cfg()).albumOpen };
      await q(db.from('bj_settings').upsert({ key: 'billing', value, updated: now }));
      return { ok: true, billing: value };
    }
  }
  throw fail(400, '모르는 요청이에요.');
}

function makeHandler(deps: { db: any; env: (k: string) => string | undefined; fetch?: typeof fetch; clock?: () => number }) {
  db = deps.db; envOf = deps.env; http = deps.fetch || ((input, init) => fetch(input, init)); vapidCache = null;
  const clock = deps.clock || Date.now;
  return async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const route = new URL(req.url).pathname.replace(/^.*?\/bakje-billing\/?/, '').replace(/\/+$/, '');
    try {
      if (req.method === 'GET' && route === 'health') return json(200, { ok: true, v: 6, year: true, addon: true, push: true, newAlbum: true, albumGate: true, munchkinPass: true, card: true });
      if (req.method === 'POST' && (route === '' || route === 'api')) return json(200, await handle(req, clock()));
      return json(404, { ok: false, error: '찾을 수 없어요.' });
    } catch (e) {
      if (e instanceof Fail) return json(e.status, { ok: false, error: e.message });
      console.error(e);
      return json(500, { ok: false, error: BROKEN });
    }
  };
}
// ==== 시험이 따로 읽는 곳 끝 ====

Deno.serve(makeHandler({
  db: createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }),
  env: (k) => Deno.env.get(k)
}));
