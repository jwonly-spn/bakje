-- 박제관 — 내 박제판·박제 편지를 올리는 개인 SNS (Supabase 프로젝트 aksegkhhugqvvaidgvro, 마이그레이션 bakje_schema)
-- 표는 모두 서버 함수(bakje, service_role)만 읽고 쓴다(RLS 켜고 정책 없음). 사진·미리 만든 목록은 공개 버킷 bakje.
-- 함께 쓰는 것: fp_hit·fp_limits(호출 한도), junlive_access_nonces(서명 한 번만), junlive_secrets ip_salt.

create table if not exists bj_devices (
  id text primary key,                 -- 공개키(SPKI DER)의 SHA-256 hex
  public_key text not null,            -- base64url SPKI
  label text not null default '',
  state text not null check (state in ('approved', 'revoked')),
  created bigint not null,
  seen bigint not null
);

create table if not exists bj_posts (
  id text primary key,                 -- 10자 무작위
  kind text not null check (kind in ('board', 'letter')),
  caption text not null default '',
  letter jsonb,                        -- {to, text, from, paper}
  photos jsonb not null default '[]',  -- [{f, t, w, h}] 버킷 안 경로
  at bigint not null,                  -- 보여 주는 날짜(정렬)
  created bigint not null,
  updated bigint not null,
  pinned boolean not null default false,
  hearts integer not null default 0
);
create index if not exists bj_posts_order on bj_posts (pinned desc, at desc, created desc);

create table if not exists bj_hearts (
  post text not null references bj_posts(id) on delete cascade,
  voter text not null,                 -- sha256(소금 + 브라우저 무작위 열쇠)
  created bigint not null,
  primary key (post, voter)
);

create table if not exists bj_meta (
  key text primary key,                -- profile · owner_code
  value jsonb not null
);

alter table bj_devices enable row level security;
alter table bj_posts enable row level security;
alter table bj_hearts enable row level security;
alter table bj_meta enable row level security;
revoke all on bj_devices, bj_posts, bj_hearts, bj_meta from anon, authenticated;
grant select, insert, update, delete on bj_devices, bj_posts, bj_hearts, bj_meta to service_role;

-- 하트 켜기·끄기를 한 번에(같은 사람 두 번 안 셈)
create or replace function bj_heart(p_post text, p_voter text, p_on boolean, p_now bigint)
returns json language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not exists (select 1 from bj_posts where id = p_post) then
    return json_build_object('ok', false);
  end if;
  if p_on then
    insert into bj_hearts(post, voter, created) values (p_post, p_voter, p_now) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 then update bj_posts set hearts = hearts + 1 where id = p_post; end if;
  else
    delete from bj_hearts where post = p_post and voter = p_voter;
    get diagnostics n = row_count;
    if n > 0 then update bj_posts set hearts = greatest(hearts - 1, 0) where id = p_post; end if;
  end if;
  return json_build_object('ok', true, 'changed', n > 0, 'hearts', (select hearts from bj_posts where id = p_post));
end $$;
revoke execute on function bj_heart(text, text, boolean, bigint) from public, anon, authenticated;
grant execute on function bj_heart(text, text, boolean, bigint) to service_role;

-- 최초 박제판(2026-11-03, 마이그레이션 bakje_first_board): 글 종류 first(1:1) + 먼치킨 봇이 저절로 올리는 글
alter table bj_posts drop constraint if exists bj_posts_kind_check;
alter table bj_posts add constraint bj_posts_kind_check check (kind in ('board', 'first', 'letter'));
-- 2026-11-05 bakje_post_kind_sso: 일반 게시물(post)  (로그인 이어 주기 표는 파일 맨 끝)
alter table bj_posts drop constraint if exists bj_posts_kind_check;
alter table bj_posts add constraint bj_posts_kind_check check (kind in ('post', 'board', 'first', 'letter'));
alter table bj_posts add column if not exists src text;      -- 먼치킨이 올린 글: fb:<기기 번호 앞 16자>:<판 번호>
alter table bj_posts add column if not exists extra jsonb;   -- {title, filled, total, bot, hash}
create unique index if not exists bj_posts_src on bj_posts (src) where src is not null;
create table if not exists bj_bots (
  id text primary key,                 -- 먼치킨 승인 기기 번호(junlive_devices.id). 이 표에 있는 기기만 POST bot 을 쓸 수 있다
  label text not null default '',
  created bigint not null
);
create table if not exists bj_bot_gone (
  src text primary key,                -- 주인이 지운 먼치킨 글(다시 만들지 않는다)
  at bigint not null
);
alter table bj_bots enable row level security;
alter table bj_bot_gone enable row level security;
revoke all on bj_bots, bj_bot_gone from anon, authenticated;
grant select, insert, update, delete on bj_bots, bj_bot_gone to service_role;
-- 기기를 넣을 때(예: 이 PC 먼치킨): insert into bj_bots (id, label, created) select id, '이 PC 먼치킨', (extract(epoch from now())*1000)::bigint
--   from junlive_devices where id like '<기기 번호 앞자리>%' and state = 'approved';

-- 후원자 닉네임(2026-11-03, 마이그레이션 bakje_donor): 주인이 적는 한 줄 — 사진 왼쪽 위·글 칸에 보인다
alter table bj_posts add column if not exists donor text not null default '';
-- 스푼 테마 이름(2026-11-03, 마이그레이션 bakje_theme): 주인이 적는 한 줄 — 글 칸에 보인다
alter table bj_posts add column if not exists theme text not null default '';

-- 종료 날짜(2026-11-03, 마이그레이션 bakje_ends): 최초 박제판마다 주인이 적는 YYYY-MM-DD(한국 날짜) — 사이트가 남은 날을 계산한다
alter table bj_posts add column if not exists ends text not null default '';

-- 방문자 수(2026-11-03, 마이그레이션 bakje_visits): 브라우저마다(해시) 하루 한 번. bj_visits 는 이틀 지나면 지운다, 수는 bj_visit_counts(날짜·total)
create table if not exists bj_visits (day text not null, voter text not null, primary key (day, voter));
create table if not exists bj_visit_counts (key text primary key, n bigint not null default 0);
alter table bj_visits enable row level security;
alter table bj_visit_counts enable row level security;
revoke all on bj_visits, bj_visit_counts from anon, authenticated;
grant select, insert, update, delete on bj_visits, bj_visit_counts to service_role;
create or replace function bj_visit(p_day text, p_voter text, p_count boolean) returns json language plpgsql set search_path = public as $$
declare added int := 0; t bigint; a bigint;
begin
  if p_count then
    insert into bj_visits (day, voter) values (p_day, p_voter) on conflict do nothing;
    get diagnostics added = row_count;
    if added > 0 then
      insert into bj_visit_counts (key, n) values (p_day, 1), ('total', 1)
        on conflict (key) do update set n = bj_visit_counts.n + 1;
      delete from bj_visits where day < to_char(p_day::date - 2, 'YYYY-MM-DD');
    end if;
  end if;
  select n into t from bj_visit_counts where key = p_day;
  select n into a from bj_visit_counts where key = 'total';
  return json_build_object('today', coalesce(t, 0), 'total', coalesce(a, 0));
end $$;
revoke all on function bj_visit(text, text, boolean) from public, anon, authenticated;
grant execute on function bj_visit(text, text, boolean) to service_role;

-- 추억앨범 여러 개(2026-11-04, 마이그레이션 bakje_albums): DJ마다 따로 떨어진 앨범. 지금 있는 것은 모두 앨범 hanijun.
--  사이트는 주소(호스트)로 앨범을 고른다(공개 버킷 h/<호스트>.json). 목록은 snap/<앨범>/feed.json. 모든 앨범을 모아 보는 곳은 없다.
create table if not exists bj_albums (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{1,30}$'),
  name text not null default '',
  state text not null default 'active' check (state in ('active', 'readonly')),   -- readonly: 보기만(글쓰기·봇 올리기 막힘)
  note text not null default '',
  created bigint not null
);
create table if not exists bj_hosts (
  host text primary key check (host ~ '^[a-z0-9.-]{3,253}$'),   -- 퓨니코드 소문자
  album text not null references bj_albums(id) on delete cascade,
  created bigint not null
);
alter table bj_albums enable row level security;
alter table bj_hosts enable row level security;
revoke all on bj_albums, bj_hosts from anon, authenticated;
grant select, insert, update, delete on bj_albums, bj_hosts to service_role;

insert into bj_albums (id, name, created) values ('hanijun', '한이준 추억앨범', (extract(epoch from now()) * 1000)::bigint) on conflict do nothing;
insert into bj_hosts (host, album, created)
select h, 'hanijun', (extract(epoch from now()) * 1000)::bigint
from unnest(array['xn--hu5bi2af5y.com', 'www.xn--hu5bi2af5y.com', 'jwonly-spn.github.io']) as h
on conflict do nothing;

alter table bj_posts add column if not exists album text not null default 'hanijun' references bj_albums(id) on delete cascade;
alter table bj_devices add column if not exists album text not null default 'hanijun' references bj_albums(id) on delete cascade;
alter table bj_bots add column if not exists album text not null default 'hanijun' references bj_albums(id) on delete cascade;
alter table bj_meta add column if not exists album text not null default 'hanijun' references bj_albums(id) on delete cascade;
alter table bj_meta drop constraint if exists bj_meta_pkey;
alter table bj_meta add primary key (album, key);
create index if not exists bj_posts_album_order on bj_posts (album, pinned desc, at desc, created desc);
create index if not exists bj_devices_album on bj_devices (album);

-- 방문자 수: 앨범마다 따로(열쇠 = <앨범>:<날짜> · <앨범>:total)
update bj_visit_counts set key = 'hanijun:' || key where key not like '%:%';
create or replace function bj_visit(p_album text, p_day text, p_voter text, p_count boolean) returns json language plpgsql set search_path = public as $$
declare added int := 0; t bigint; a bigint;
begin
  if p_count then
    insert into bj_visits (day, voter) values (p_day, p_voter) on conflict do nothing;
    get diagnostics added = row_count;
    if added > 0 then
      insert into bj_visit_counts (key, n) values (p_album || ':' || p_day, 1), (p_album || ':total', 1)
        on conflict (key) do update set n = bj_visit_counts.n + 1;
      delete from bj_visits where day < to_char(p_day::date - 2, 'YYYY-MM-DD');
    end if;
  end if;
  select n into t from bj_visit_counts where key = p_album || ':' || p_day;
  select n into a from bj_visit_counts where key = p_album || ':total';
  return json_build_object('today', coalesce(t, 0), 'total', coalesce(a, 0));
end $$;
revoke all on function bj_visit(text, text, text, boolean) from public, anon, authenticated;
grant execute on function bj_visit(text, text, text, boolean) to service_role;

-- 하트: 어느 앨범 글인지도 돌려준다(그 앨범 목록만 다시 쓰게)
create or replace function bj_heart(p_post text, p_voter text, p_on boolean, p_now bigint)
returns json language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not exists (select 1 from bj_posts where id = p_post) then
    return json_build_object('ok', false);
  end if;
  if p_on then
    insert into bj_hearts(post, voter, created) values (p_post, p_voter, p_now) on conflict do nothing;
    get diagnostics n = row_count;
    if n > 0 then update bj_posts set hearts = hearts + 1 where id = p_post; end if;
  else
    delete from bj_hearts where post = p_post and voter = p_voter;
    get diagnostics n = row_count;
    if n > 0 then update bj_posts set hearts = greatest(hearts - 1, 0) where id = p_post; end if;
  end if;
  return json_build_object('ok', true, 'changed', n > 0, 'hearts', (select hearts from bj_posts where id = p_post), 'album', (select album from bj_posts where id = p_post));
end $$;
revoke execute on function bj_heart(text, text, boolean, bigint) from public, anon, authenticated;
grant execute on function bj_heart(text, text, boolean, bigint) to service_role;

-- 회원·본인인증·댓글(2026-11-04, 마이그레이션 bakje_members): 사용자 "회원가입 한 사람들은 댓글을 달 수 있어 · 악플러 방지를 위해 본인인증".
--  한 계정을 모든 앨범에서. 로그인 = 아이디·비밀번호(PBKDF2) 또는 카카오(회원번호의 소금 해시). 본인인증(포트원 V2·다날)은 가입 때 한 번 —
--  저장하는 것은 같은 사람 값(DI)의 소금 해시(person)뿐(이름·전화번호·생년월일은 저장하지 않는다). 한 사람 = 한 계정(person 유일).
--  운영자가 쫓아낸 사람(bj_banned_people)은 새 계정도 인증이 안 된다. 세션·표는 원문 대신 sha256 만 둔다.
create table if not exists bj_members (
  id text primary key check (id ~ '^m[a-z2-9]{11}$'),
  login_id text unique check (login_id is null or login_id ~ '^[a-z0-9_]{4,20}$'),
  pw text,                                  -- pbkdf2$<반복>$<소금>$<값>
  kakao text unique,                        -- sha256(소금 + 카카오 회원번호) 앞 40자
  nickname text not null default '',
  person text unique,                       -- sha256(소금 + DI) 앞 48자 — 본인인증한 사람
  verified bigint,                          -- 본인인증한 때(ms) · null = 아직
  state text not null default 'active' check (state in ('active', 'banned')),
  created bigint not null,
  seen bigint not null,
  check (login_id is not null or kakao is not null)
);
create unique index if not exists bj_members_nick on bj_members (lower(nickname)) where nickname <> '';
create table if not exists bj_banned_people (person text primary key, at bigint not null, note text not null default '');
create table if not exists bj_sessions (
  token text primary key,                   -- sha256(세션 열쇠)
  member text not null references bj_members(id) on delete cascade,
  created bigint not null, seen bigint not null, expires bigint not null
);
create index if not exists bj_sessions_member on bj_sessions (member);
create table if not exists bj_tickets (       -- 카카오 로그인 뒤 사이트로 넘기는 표(login, 2분) · 비밀번호 새로 정하기 표(reset, 10분) — 한 번만
  token text primary key, kind text not null check (kind in ('login', 'reset')),
  member text not null references bj_members(id) on delete cascade, host text not null default '', expires bigint not null
);
create table if not exists bj_oauth_states (state text primary key, host text not null, path text not null, expires bigint not null);
create table if not exists bj_verifications (  -- 본인인증 번호(포트원 identityVerificationId) — join: 가입 · find: 아이디·비밀번호 찾기
  id text primary key, purpose text not null check (purpose in ('join', 'find')),
  member text references bj_members(id) on delete cascade, created bigint not null, done bigint
);
create table if not exists bj_comments (
  id text primary key,
  album text not null references bj_albums(id) on delete cascade,
  post text not null references bj_posts(id) on delete cascade,
  member text not null references bj_members(id) on delete cascade,
  text text not null,
  created bigint not null,
  state text not null default 'visible' check (state in ('visible', 'deleted')),
  deleted_by text
);
create index if not exists bj_comments_post on bj_comments (post, created);
create index if not exists bj_comments_album on bj_comments (album, state);
create index if not exists bj_comments_member on bj_comments (member);
create table if not exists bj_album_blocks (   -- 앨범 주인이 막은 회원(그 앨범에서만)
  album text not null references bj_albums(id) on delete cascade,
  member text not null references bj_members(id) on delete cascade,
  at bigint not null, primary key (album, member)
);
create table if not exists bj_reports (
  comment text not null references bj_comments(id) on delete cascade,
  reporter text not null references bj_members(id) on delete cascade,
  reason text not null default '', at bigint not null, primary key (comment, reporter)
);
alter table bj_members enable row level security;
alter table bj_banned_people enable row level security;
alter table bj_sessions enable row level security;
alter table bj_tickets enable row level security;
alter table bj_oauth_states enable row level security;
alter table bj_verifications enable row level security;
alter table bj_comments enable row level security;
alter table bj_album_blocks enable row level security;
alter table bj_reports enable row level security;
revoke all on bj_members, bj_banned_people, bj_sessions, bj_tickets, bj_oauth_states, bj_verifications, bj_comments, bj_album_blocks, bj_reports from anon, authenticated;
grant select, insert, update, delete on bj_members, bj_banned_people, bj_sessions, bj_tickets, bj_oauth_states, bj_verifications, bj_comments, bj_album_blocks, bj_reports to service_role;

-- 사진(원본 크기 줄인 것·작은 그림)과 미리 만든 목록 snap/feed.json
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bakje', 'bakje', true, 15728640, array['image/jpeg', 'application/json'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- 2026-11-05 bakje_post_kind_sso: 앨범 사이 로그인 이어 주기(서버 쿠키 bj_sso — 한 번 로그인하면 다른 DJ 앨범 주소에서도)
alter table bj_tickets drop constraint if exists bj_tickets_kind_check;
alter table bj_tickets add constraint bj_tickets_kind_check check (kind in ('login', 'reset', 'sso'));

-- 2026-11-05 bakje_dj_accounts: DJ 계정(회원가입 때 청취자/DJ, DJ 는 등록 코드로 앨범을 계정에 잇는다 — 주인 기기 대신). 앨범마다 결제 끝나는 날(비우면 시범 — 검사 안 함).
alter table bj_members add column if not exists role text not null default 'listener';
alter table bj_members drop constraint if exists bj_members_role_check;
alter table bj_members add constraint bj_members_role_check check (role in ('listener', 'dj'));
create table if not exists bj_album_owners (
  album text not null references bj_albums(id) on delete cascade,
  member text not null references bj_members(id) on delete cascade,
  created bigint not null,
  primary key (album, member)
);
create index if not exists bj_album_owners_member on bj_album_owners(member);
alter table bj_album_owners enable row level security;
revoke all on bj_album_owners from anon, authenticated;
grant all on bj_album_owners to service_role;
alter table bj_albums add column if not exists paid_until bigint;
