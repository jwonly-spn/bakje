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

-- 사진(원본 크기 줄인 것·작은 그림)과 미리 만든 목록 snap/feed.json
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bakje', 'bakje', true, 15728640, array['image/jpeg', 'application/json'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
