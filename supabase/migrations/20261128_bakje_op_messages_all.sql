-- 2026-11-28 bakje_op_messages_all: 운영자 전체 메시지(사용자 "운영자 페이지에서 전체 메세지도 가능하게") — 함수 bakje-billing v18 ops-msg-send-all.
--  받는 사람(먼치킨 봇을 쓰는 회원 — 운영자·막힌 회원은 빼고)마다 bj_op_messages 에 한 줄씩 넣고(fan-out), 같은 묶음 번호 batch('b' + 11자)를 적는다.
--  batch null = 한 사람에게 보낸 것(지금까지의 줄 모두). 봇·spoon-link 는 바뀌지 않는다(회원마다 자기 줄을 그대로 받음).
--  묶음 메시지는 DJ 가 [확인했어요]를 눌러도 운영자 푸시를 보내지 않는다(seen 은 적음). 운영자 앱은 batch 로 묶어 보이고 ops-msg-del {batch} 로 한꺼번에 지운다.
-- 순서: ① bakje_op_messages(먼저 — 표) → ② 이 마이그레이션 → ③ 함수 bakje-billing v18 → ④ 운영자 앱.
--  v17 함수는 batch 칸을 모르니 이것만 먼저 적용해도 그대로 돈다. 거꾸로 v18 을 먼저 올리면 전체 메시지 보내기·묶음 지우기가 503(칸이 없음).
-- 되돌리기: 함수를 v17 로 되돌린 뒤(전체 메시지로 들어간 줄도 지우려면 먼저 delete from bj_op_messages where batch is not null;)
--  drop index if exists bj_op_messages_batch; alter table bj_op_messages drop column if exists batch; notify pgrst, 'reload schema';
alter table bj_op_messages add column if not exists batch text;
create index if not exists bj_op_messages_batch on bj_op_messages(batch) where batch is not null;

notify pgrst, 'reload schema';
