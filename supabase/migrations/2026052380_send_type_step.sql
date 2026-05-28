-- Pen pal flow prereq. add 'awaiting_send_type' to the state machine.
--
-- After photo intake we now ask the user to choose:
--   1. Send to a friend (existing flow)
--   2. Send to a stranger pen pal (coming with public beta. stubbed for
--      now to fall back to friend mode)
--
-- The choice lives in conversation_data.send_type as 'friend' | 'stranger'
-- so downstream handlers (doMail in particular) can branch on it without
-- a separate column.

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
    'awaiting_send_confirm'
  ));
