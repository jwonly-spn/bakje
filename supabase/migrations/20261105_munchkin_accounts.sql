-- 2026-11-05 munchkin_accounts: 먼치킨 계정 — 먼치킨 프로그램(봇·송출)도 같은 회원 계정(bj_members)으로 로그인한다(함수 bakje v9 · bakje-billing v4).
-- schema.sql 맨 끝 구역과 같은 내용(마이그레이션 이름 munchkin_accounts). 함수를 올리기 전에 먼저 적용한다(bakje-billing v4 가 bj_orders want_* 칸을 쓴다).
--  bj_member_devices: 로그인한 먼치킨 기기(junlive_devices.id = 기기 공개 키 sha256 hex) ↔ 회원. 입금 확인으로 새 앨범이 생기면 그 회원의 봇 기기를 bj_bots 에 잇는다.
--  bj_app_logins: 프로그램 카카오 로그인 자리(10분) — 프로그램이 비밀 값의 sha256 만 보내고(secret), 브라우저에서 로그인한 회원이 승인하면(member) 프로그램이 비밀 값으로 세션을 받아 간다.
--  bj_orders want_*: 앨범이 없는 DJ 의 새 추억앨범 신청(주소 이름 · 퓨니코드 주소 · 앨범 이름) — 운영자가 입금을 확인하면 앨범·주소가 저절로 생긴다.
create table if not exists bj_member_devices (
  device text primary key,                  -- junlive_devices.id(기기 공개 키 sha256 hex)
  member text not null references bj_members(id) on delete cascade,
  program text not null default 'bot' check (program in ('bot', 'studio')),
  created bigint not null,
  seen bigint not null
);
create index if not exists bj_member_devices_member on bj_member_devices(member);
create table if not exists bj_app_logins (
  id text primary key,                      -- 'app-' + 20자
  secret text not null,                     -- sha256(프로그램이 만든 비밀 값) hex
  member text references bj_members(id) on delete cascade,   -- 승인한 회원(아직이면 null)
  created bigint not null,
  expires bigint not null
);
alter table bj_orders add column if not exists want_host text;    -- 새 앨범 주소(퓨니코드, 예: xn--qh3bm70b.xn--s22bu18a0ub.com)
alter table bj_orders add column if not exists want_label text;   -- 주소 이름(예: 밤톨)
alter table bj_orders add column if not exists want_name text;    -- 앨범 이름(예: 밤톨 추억앨범)
create index if not exists bj_orders_want_host on bj_orders(want_host) where want_host is not null;
alter table bj_member_devices enable row level security;
alter table bj_app_logins enable row level security;
revoke all on bj_member_devices, bj_app_logins from anon, authenticated;
grant all on bj_member_devices, bj_app_logins to service_role;
