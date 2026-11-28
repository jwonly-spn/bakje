-- 2026-11-28 bakje_op_messages: 운영자 메시지(사용자 "먼치킨 쓰는 사람들한테 개인적으로 봇에 메세지 … 답장 기능 없이 내가 메세지 보내고, 그 사람이 확인하기 누르면 나한테 확인했음").
--  운영자가 운영자 앱 "회원" 탭에서 회원 한 명에게 글(1~500자, 줄바꿈 됨)을 보낸다(함수 bakje-billing v17 ops-msg-send). 답장은 없다.
--  DJ 의 먼치킨 봇(0.24.2~)은 켜져 있는 동안 5분마다 보내는 상태 한 줄(함수 spoon-link v10 report — 본 줄 저장소)의 답으로 그 회원의 최근 7일 메시지를 받는다
--  (서버 호출 수는 늘지 않는다). 처음 실린 때 delivered 를 채운다. DJ 가 [확인했어요]를 누르면 bakje-billing op-msg-seen → seen 을 채우고 운영자 휴대폰에 푸시(처음 한 번만).
--  30일 지난 줄은 bakje-billing 이 가끔(2%) 지운다. 청취자 정보는 없다(운영자가 쓴 글과 때만).
--  id 번호(자동) · member 받는 회원 · body 글 · created 보낸 때(ms — bj 표들과 같음) · by_member 보낸 운영자 · delivered 봇에 처음 닿은 때 · seen [확인했어요] 누른 때
--  읽기·쓰기는 서버 함수(service_role)만 — RLS 켜고 정책 없음.
-- 순서: ① 이 마이그레이션 → ② 함수 bakje-billing v17 → ③ 함수 spoon-link v10(본 줄 저장소, get_edge_function 으로 한국어 글 확인) → ④ 운영자 앱(박제관 deploy.cjs) → ⑤ 봇 0.24.2.
--  함수가 먼저 올라가면 이 표가 없어 bakje-billing 의 메시지 동작이 503 이 된다(spoon-link report 는 msgs 칸 없이 {ok:true} — 봇은 그대로 돈다). 그래서 꼭 이것부터.
-- 되돌리기(보낸 메시지가 모두 사라져요): 함수 bakje-billing·spoon-link 를 앞 판으로 되돌린 뒤 drop table if exists bj_op_messages;
create table if not exists bj_op_messages (
  id bigint generated always as identity primary key,
  member text not null references bj_members(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created bigint not null,
  by_member text references bj_members(id) on delete set null,
  delivered bigint,
  seen bigint
);
create index if not exists bj_op_messages_member on bj_op_messages(member, created desc);
create index if not exists bj_op_messages_created on bj_op_messages(created);
alter table bj_op_messages enable row level security;
revoke all on bj_op_messages from anon, authenticated;
grant all on bj_op_messages to service_role;
grant usage, select on sequence bj_op_messages_id_seq to service_role;
