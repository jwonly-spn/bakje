-- 2026-11-25 bakje_beta: 추억앨범 베타테스터 10명 추가 모집(함수 bakje-beta v1). schema.sql 맨 끝 구역과 같은 내용(마이그레이션 이름 bakje_beta).
-- 순서: ① 이 마이그레이션(표·잠금 함수·사진 칸·처음 설정 open:false) → ② 함수 bakje-beta 올리기(verify_jwt false) → get_edge_function 으로 한국어 글 확인.
--  처음엔 모집 닫힘(open:false)으로 올리고, 다 시험한 뒤 운영자가 운영자 앱에서 연다(ops-open).
-- 되돌리기(신청·사진이 모두 사라져요):
--  drop function if exists bj_beta_claim(text, int, bigint); drop table if exists bj_beta_apps;
--  사진 칸 bakje-beta 는 안의 파일을 먼저 비운 뒤(대시보드 Storage 또는 함수 ops-purge) 대시보드에서 칸을 지운다(storage 표를 SQL 로 직접 지우지 않는다).
--  delete from bj_settings where key = 'beta';
--  뽑혀서 생긴 앨범(bj_albums note '베타테스터 …' · 주소 · 주인 · 추억앨범 이용권)과 운영자 알림 줄(jl_watch_alerts key 'beta-apply')은 남아요(필요하면 따로 지운다).
--
--  bj_beta_apps: 베타 신청(회원마다 한 줄 — 다시 보내면 그 줄을 고친다). 읽기·쓰기는 서버 함수(service_role)만 — RLS 켜고 정책 없음.
--   id 'b' + 11자 · member 먼치킨 계정 · nick 계정 닉네임 · spoon_nick 적은 스푼 닉네임 · want_label 주소 이름 · want_host 주소(퓨니코드)
--   want_name 앨범 이름 · msg 하고 싶은 말 · photos 첨부 사진 경로(bakje-beta 칸의 '<member>/<12자>.<webp|jpg|png>', 3~10장)
--   state wait(기다림) | picked(뽑힘 — 앨범이 생김) | passed(넘김 — 신청한 분 화면엔 모집 중엔 기다림) | canceled(취소)
--   created 신청 때 · decided 정한 때(뽑기·넘기기·취소) · album 뽑혀서 생긴 앨범 번호
--   모집 끝 정리(ops-purge): 안 뽑힌 줄(wait·passed·canceled)은 통째로 지우고, 뽑힌 줄은 사진·하고 싶은 말·계정 닉네임(nick)을 비운다(스푼 닉네임·주소·앨범 이름만 남음).
--  bj_beta_claim: 뽑기 자리 잡기 — 한 번에 하나(advisory lock). wait·passed 인지, 뽑힌 수가 seats 보다 적은지 보고 picked 로. 'ok' | 'full' | 'state'.
--  bakje-beta 칸: 비공개(public false), 장당 5MB, webp·jpeg·png 만. 화면은 함수가 주는 서명 올리기 주소로만 올리고, 운영자 앱은 1시간짜리 서명 보기 주소로만 본다.
--  bj_settings "beta": {open, seats:10, until:2026-12-31 23:59:59(한국), closedAt} — 없을 때만 넣는다.
create table if not exists bj_beta_apps (
  id text primary key,                                           -- 'b' + 11자
  member text not null unique references bj_members(id) on delete cascade,
  nick text,                                                     -- 먼치킨 계정 닉네임(신청 때)
  spoon_nick text not null,                                      -- 적은 스푼 닉네임
  want_label text not null,                                      -- 주소 이름(예: 먼치)
  want_host text not null,                                       -- 주소(퓨니코드, <이름>.xn--s22bu18a0ub.com)
  want_name text not null,                                       -- 앨범 이름
  msg text,                                                      -- 하고 싶은 말(100자 · 정리 때 비우거나 줄째 지움)
  photos text[] not null default '{}',                           -- 첨부 사진 경로(bakje-beta 칸)
  state text not null default 'wait' check (state in ('wait', 'picked', 'passed', 'canceled')),
  created bigint not null,
  decided bigint,
  album text references bj_albums(id) on delete set null
);
create index if not exists bj_beta_apps_state on bj_beta_apps(state, created desc);
create index if not exists bj_beta_apps_want_host on bj_beta_apps(want_host);
alter table bj_beta_apps enable row level security;
revoke all on bj_beta_apps from anon, authenticated;
grant all on bj_beta_apps to service_role;

create or replace function bj_beta_claim(p_id text, p_seats int, p_now bigint)
  returns text
  language plpgsql
  set search_path = public
as $$
declare
  cur text;
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('bj_beta'));
  select state into cur from bj_beta_apps where id = p_id for update;
  if cur is null or cur not in ('wait', 'passed') then
    return 'state';
  end if;
  select count(*) into n from bj_beta_apps where state = 'picked';
  if n >= p_seats then
    return 'full';
  end if;
  update bj_beta_apps set state = 'picked', decided = p_now where id = p_id;
  return 'ok';
end;
$$;
revoke all on function bj_beta_claim(text, int, bigint) from public, anon, authenticated;
grant execute on function bj_beta_claim(text, int, bigint) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bakje-beta', 'bakje-beta', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into bj_settings (key, value, updated)
  values ('beta', '{"open":false,"seats":10,"until":1798729199000,"closedAt":null}'::jsonb, 0) on conflict (key) do nothing;

notify pgrst, 'reload schema';
