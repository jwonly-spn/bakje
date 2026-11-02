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

-- 사진(원본 크기 줄인 것·작은 그림)과 미리 만든 목록 snap/feed.json
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bakje', 'bakje', true, 15728640, array['image/jpeg', 'application/json'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
