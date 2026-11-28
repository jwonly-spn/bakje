-- 2026-11-28 bakje_ambassadors: 먼치킨 엠베서더(사용자 "디제이 몇 명을 뽑아 엠베서더 권한 — 먼치킨도 추억앨범도 전부 무료").
--  운영자가 운영자 앱 "회원" 탭에서 주고 푼다(함수 bakje-billing ops-amb). 줄이 있으면 엠베서더, 풀면 줄을 지운다.
--  엠베서더인 동안: 먼치킨·송출 이용권(munchkin-pass)이 늘 있음 · 가진 추억앨범은 결제 끝나는 날이 지나도 씀(bakje·bakje-pick) · 댓글 표시 DJ(bakje-social).
--  이용권 줄(bj_entitlements)·앨범 결제 끝나는 날(bj_albums.paid_until)은 건드리지 않는다 — 풀면 그 자리에서 보통 회원과 같아진다.
-- 순서: ① 이 마이그레이션 → ② 함수 bakje · bakje-pick · bakje-social · bakje-billing 올리기(모두 verify_jwt false) → ③ 운영자 앱·먼치킨.com·추억앨범 화면.
--  함수가 먼저 올라가면 이 표가 없어 엠베서더를 묻는 곳이 503 이 된다(그래서 꼭 이것부터).
-- 되돌리기: 함수를 앞 판으로 되돌린 뒤 drop table if exists bj_ambassadors;
create table if not exists bj_ambassadors (
  member text primary key references bj_members(id) on delete cascade,
  since bigint not null,
  note text not null default '',
  by_member text references bj_members(id) on delete set null
);
alter table bj_ambassadors enable row level security;
revoke all on bj_ambassadors from anon, authenticated;
grant all on bj_ambassadors to service_role;
