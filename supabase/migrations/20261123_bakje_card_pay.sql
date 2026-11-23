-- 2026-11-23 bakje_card_pay: 이용권 카드 결제(포트원 V2 · KG이니시스 — 함수 bakje-billing v6). 지금 신청 0건이라 안전. 함수보다 먼저 적용한다.
-- schema.sql 맨 끝 구역과 같은 내용(마이그레이션 이름 bakje_card_pay). 함수 bakje-billing v6 을 올리기 전에 먼저 적용한다(v6 이 pay·pay_id·test_only 칸을 쓴다).
--  bj_orders pay: 'bank'(계좌이체 — 지금까지의 신청 모두) | 'card' · pay_id: 포트원 paymentId('mk-' + 신청 번호, 한 신청 = 한 결제 번호)
--  pay_at: 카드 결제가 끝난 때 · pay_channel: 포트원이 알려 준 채널 종류(TEST / LIVE) · test_only: 심사 보기로 만든 신청(어떤 결제가 와도 이용권 없음)
--  state 'test': 테스트 결제(실제 결제 아님 — 이용권·앨범 없음). munchkin-pass·boughtYearly 는 state 'paid' 만 보므로 저절로 빠진다.
--  bj_settings "card": 카드 단추를 누구에게(on off|testers|all) · mode test|live · 채널 키(비밀 아님) · 심사 계정 login_id. billing 과 따로(ops-billing 이 billing 을 통째로 새로 쓴다).
--  카드 결제 때 결제하는 분 이름·휴대폰·이메일은 이 표에 두지 않는다(화면 → 결제창으로만).
alter table bj_orders add column if not exists pay text not null default 'bank';
alter table bj_orders drop constraint if exists bj_orders_pay_check;
alter table bj_orders add constraint bj_orders_pay_check check (pay in ('bank', 'card'));
alter table bj_orders add column if not exists pay_id text;            -- 포트원 paymentId
create unique index if not exists bj_orders_pay_id on bj_orders(pay_id) where pay_id is not null;
alter table bj_orders add column if not exists pay_at bigint;           -- 결제 끝난 때
alter table bj_orders add column if not exists pay_channel text;        -- 포트원이 알려 준 채널 종류 TEST / LIVE · NONE = 포트원에 결제가 없는 것을 확인하고 정리함(다시 묻지 않음)
alter table bj_orders add column if not exists test_only boolean not null default false;  -- 심사 보기로 만든 신청(어떤 결제가 와도 이용권 없음)
alter table bj_orders drop constraint if exists bj_orders_state_check;
alter table bj_orders add constraint bj_orders_state_check check (state in ('pending', 'paid', 'rejected', 'canceled', 'test'));
insert into bj_settings (key, value, updated)
  values ('card', '{"on":"off","mode":"test","channelKey":"","testers":["inicistest"]}'::jsonb, 0) on conflict (key) do nothing;
