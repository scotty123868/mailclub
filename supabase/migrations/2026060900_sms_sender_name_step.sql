-- Add the 'awaiting_sender_name' conversation step.
--
-- The deferred return-address capture (first friend send + pen-pal up-front)
-- now also collects the sender's NAME so pen pals can write back to a real
-- person, not a blank "from". We ask for name + address together; when the
-- user gives only the address we fall back to a dedicated one-question step
-- (awaiting_sender_name). advance_sms_conversation() sets that step, so it
-- has to clear the CHECK constraint or the RPC silently fails and strands the
-- user (the exact failure mode 2026060200 was written to fix).
--
-- Additive superset of the prior allowed values, so no existing row can
-- violate the new constraint.

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
    'awaiting_sender_name',
    'awaiting_sender_address_confirm',
    'awaiting_send_confirm',
    'sending'
  ));
