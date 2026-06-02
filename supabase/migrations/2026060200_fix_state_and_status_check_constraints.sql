-- Fix two CHECK constraints that silently broke live flows (codex P0/P1).
--
-- 1. sms_conversation_state_step_check (last set in 2026052380) never got
--    the Round 36 sender-address-confirm step or the anti-double-send
--    'sending' claim step. advance_sms_conversation() sets the former and a
--    direct UPDATE sets the latter; both hit the constraint and failed.
--    advanceState swallowed the RPC error, and the send-claim UPDATE then
--    matched 0 rows, so the bot treated every send as a duplicate and
--    silently returned. Add both steps.
--
-- 2. postcards_status_check (last set in 2026051211) predates scheduled
--    sending, claim expiry, and Lob cancel. It never allowed 'scheduled'
--    (set by send_postcard_sms / send_postcard_sms_direct for future
--    sends), 'expired' (claim 7-day expiry refund), or 'cancelled' (Lob
--    cancel). Those status writes rolled back. Add all three.
--
-- Both are additive supersets of the prior allowed values, so no existing
-- row can violate the new constraint.

alter table public.sms_conversation_state
  drop constraint if exists sms_conversation_state_step_check;
alter table public.sms_conversation_state
  add constraint sms_conversation_state_step_check check (step in (
    'idle',
    'awaiting_send_type',
    'awaiting_recipient_name',
    'awaiting_recipient_address',
    'awaiting_address_confirm',
    'awaiting_message',
    'awaiting_sender_location',
    'awaiting_sender_address_confirm',
    'awaiting_send_confirm',
    'sending'
  ));

do $$ begin
  alter table public.postcards drop constraint if exists postcards_status_check;
  alter table public.postcards
    add constraint postcards_status_check
    check (status in (
      'draft', 'sent', 'delivered',
      'queued', 'awaiting_address',
      'in_transit', 'returned',
      'scheduled', 'expired', 'cancelled'
    ));
exception when undefined_table then null; end $$;
