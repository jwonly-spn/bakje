-- 2026-11-25 bakje_cash_receipt: 계좌이체 이용권 현금영수증 받을 번호(선택 — 함수 bakje-billing v7). 함수보다 먼저 적용한다.
-- schema.sql 맨 끝 구역과 같은 내용(마이그레이션 이름 bakje_cash_receipt). 새 칸 둘만 더한다(다른 표·칸은 그대로 — 지금 신청은 모두 null 로 남음).
--  손님이 "입금했어요"를 누를 때 원하면 적는다 → 운영자가 입금을 확인한 뒤 손택스로 발급(이용권은 모두 10만 원 밑이라 원할 때만).
--  receipt_kind: 'personal'(개인 소득공제) | 'business'(사업자 지출증빙) · receipt_no: 숫자만(휴대폰 번호·현금영수증 카드 번호 또는 사업자등록번호). 둘 다 null 이면 받지 않음.
--  번호는 운영자 목록에만 보이고, 회원 답·운영자 알림(디스코드·푸시)·함수 기록에는 넣지 않는다.
alter table bj_orders add column if not exists receipt_kind text;   -- 'personal' | 'business'
alter table bj_orders add column if not exists receipt_no text;     -- 숫자만(하이픈·빈칸 뺌)
alter table bj_orders drop constraint if exists bj_orders_receipt_kind_check;
alter table bj_orders add constraint bj_orders_receipt_kind_check check (receipt_kind is null or receipt_kind in ('personal', 'business'));
