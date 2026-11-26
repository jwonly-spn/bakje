-- 2026-11-26 bakje_beta_v2: 추억앨범 베타 신청을 쉽게(안 A — 함수 bakje-beta v2). schema.sql 맨 끝 구역과 같은 내용(마이그레이션 이름 bakje_beta_v2).
--  새 신청 화면은 주소 이름·앨범 이름을 받지 않고, 뽑힌 분이 나중에 정한다(함수 claim). 옛 화면은 계속 보낼 수 있다.
--  → bj_beta_apps 의 want_label·want_host·want_name 이 비어 있을 수 있게 not null 을 푼다. 셋은 함께 비거나 함께 찬다(bj_beta_apps_want_all).
--  다시 돌려도 된다(drop not null 은 이미 풀려 있어도 오류 없음 · 제약은 지우고 다시 만든다).
-- 순서: ① 이 마이그레이션 → ② 함수 bakje-beta v2 올리기(verify_jwt false) → get_edge_function 으로 한국어 글 확인 · GET …/bakje-beta/health 가 {ok:true, v:2}
--  → ③ 먼치킨.com 새 신청 화면(먼치킨.com/beta) · 봇·송출 0.23.6.
--  v1 함수는 주소 셋을 늘 채우므로 ①만 먼저 올려도 그대로 돈다. 거꾸로 ②를 먼저 올리면 주소 없는 신청이 not null 에 막혀 503.
-- 되돌리기(v1 로): 먼저 함수를 v1 로 되돌리고 새 화면을 내린 뒤, 주소가 빈 신청이 없을 때만(있으면 그분이 주소를 정하거나 신청을 정리한 뒤):
--  select count(*) from bj_beta_apps where want_label is null or want_host is null or want_name is null;   -- 0 이어야 함
--  alter table bj_beta_apps drop constraint if exists bj_beta_apps_want_all;
--  alter table bj_beta_apps alter column want_label set not null, alter column want_host set not null, alter column want_name set not null;
--  notify pgrst, 'reload schema';
alter table bj_beta_apps alter column want_label drop not null;
alter table bj_beta_apps alter column want_host drop not null;
alter table bj_beta_apps alter column want_name drop not null;
alter table bj_beta_apps drop constraint if exists bj_beta_apps_want_all;
alter table bj_beta_apps add constraint bj_beta_apps_want_all check ((want_label is null and want_host is null and want_name is null) or (want_label is not null and want_host is not null and want_name is not null));

notify pgrst, 'reload schema';
