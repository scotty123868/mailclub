-- v1.2 SMS magic moment prereq. add 'awaiting_sender_location' step
-- to the state machine so we can capture the sender's city/state for
-- the post-SEND delivery map confirmation page.
--
-- Without this step the confirmation page can render the recipient's
-- pin on the map but not the sender's, so the animated "you → them"
-- line is incomplete. Cheap to ask (1 SMS), high payoff in the
-- magical moment.
--
-- Repeat senders whose profile already has city set skip this step.

alter table public.sms_conversation_state
  drop constraint if exists sms_conversation_state_step_check;

alter table public.sms_conversation_state
  add constraint sms_conversation_state_step_check check (step in (
    'idle',
    'awaiting_recipient_name',
    'awaiting_recipient_address',
    'awaiting_address_confirm',
    'awaiting_message',
    'awaiting_sender_location',
    'awaiting_send_confirm'
  ));
