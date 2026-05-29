-- Reply-threaded Lob status updates: when a postcard moves through Lob's
-- lifecycle (in_production -> in_transit -> delivered), we want to fire
-- an iMessage that replies IN-THREAD to the original "📮 Mailed" bubble
-- the sender saw. LoopMessage's reply_to_id achieves that, but requires
-- the message_id of the original Mailed bubble.
--
-- Save the message_id from loopSend's response on the Mailed Act 1
-- bubble. lob-webhook will look it up + thread future updates.

alter table public.postcards
  add column if not exists mailed_imessage_id text;

comment on column public.postcards.mailed_imessage_id is
  'LoopMessage message_id of the "📮 Mailed" Act 1 bubble. Used by '
  'lob-webhook to thread later status updates as replies to this bubble '
  '(creates an in-thread timeline: Mailed → In Transit → Delivered).';

-- For lob-webhook to know which phone number to text on a status update
-- without joining through profiles, denormalize from_phone onto the row.
alter table public.postcards
  add column if not exists from_phone text;

comment on column public.postcards.from_phone is
  'Denormalized sender phone (E.164) so lob-webhook can fire iMessage '
  'replies without a profiles join. Set at insert time in doMail / '
  'doMailStranger / doSchedule.';
