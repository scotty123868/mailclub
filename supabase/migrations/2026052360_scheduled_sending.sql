-- v1.2 magic moment — scheduled sending.
--
-- User can say "mail this for her birthday June 15" or "send in 3 days"
-- during the SMS compose flow. We save the postcard with status='scheduled'
-- and a scheduled_send_at timestamp set to ~7 days before the target arrival
-- date. A pg_cron job runs daily, finds scheduled cards whose send-at has
-- arrived, hands them off to Lob, and flips status to 'sent'.
--
-- Same column drives iOS app's "Schedule for later" date picker once that's
-- built — single source of truth for delayed delivery.

------------------------------------------------------------
-- 1. postcards.scheduled_send_at column + 'scheduled' status
------------------------------------------------------------

alter table public.postcards
  add column if not exists scheduled_send_at timestamptz;

-- Extend the status check to include 'scheduled'. The full set is now:
--   draft, sent, delivered, queued, awaiting_address, in_transit, returned, scheduled
-- (prior to this, the set came from 2026051211_phase6_hardening; this just adds 'scheduled')
do $$
begin
  alter table public.postcards drop constraint if exists postcards_status_check;
exception when others then null;
end$$;

alter table public.postcards
  add constraint postcards_status_check check (status in (
    'draft', 'sent', 'delivered',
    'queued', 'awaiting_address',
    'in_transit', 'returned',
    'scheduled'
  ));

create index if not exists postcards_scheduled_send_at_idx
  on public.postcards(scheduled_send_at)
  where status = 'scheduled';

comment on column public.postcards.scheduled_send_at is
  'When set, the postcard is held until this timestamp (NOT the arrival '
  'date — this is the date we hand off to Lob). Cron job fires Lob when '
  'now() >= scheduled_send_at AND status = ''scheduled''. To target an '
  'arrival date, set this to arrival_date - 7 days (Lob avg transit).';

------------------------------------------------------------
-- 2. send_postcard_sms RPC — add p_scheduled_send_at param
--    If set, status starts as 'scheduled' and Lob handoff is deferred.
------------------------------------------------------------

drop function if exists public.send_postcard_sms(uuid, uuid, text, text, text, text);

create or replace function public.send_postcard_sms(
  p_user_id uuid,
  p_to_friend_id uuid,
  p_message text,
  p_photo_path text,
  p_to_city text default '',
  p_from_city text default '',
  p_scheduled_send_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_cost integer := 1;
  v_postcard_id uuid;
  v_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select credits into v_credits from public.profiles where id = p_user_id;
  if v_credits is null or v_credits < v_cost then
    raise exception 'insufficient_credits' using
      detail = format('user has %s, needs %s', coalesce(v_credits, 0), v_cost);
  end if;

  -- Status: 'scheduled' if a future send-at was provided, else 'sent'.
  -- The cron job flips 'scheduled' → 'sent' when the date arrives + Lob
  -- handoff succeeds.
  v_status := case
    when p_scheduled_send_at is not null and p_scheduled_send_at > now()
      then 'scheduled'
    else 'sent'
  end;

  insert into public.postcards (
    sender_id, to_kind, to_friend_id, from_city, to_city, category,
    credit_cost, status, message, photo_path, sms_origin, scheduled_send_at
  ) values (
    p_user_id, 'friend', p_to_friend_id, p_from_city, p_to_city, 'photo',
    v_cost, v_status, p_message, p_photo_path, true, p_scheduled_send_at
  )
  returning id into v_postcard_id;

  update public.profiles
    set credits = credits - v_cost
    where id = p_user_id;

  insert into public.credit_transactions (owner_id, delta, reason, postcard_id)
    values (p_user_id, -v_cost, 'send_postcard_sms', v_postcard_id);

  if p_to_friend_id is not null then
    update public.friends
      set cards_sent = cards_sent + 1,
          last_interaction_at = now()
      where id = p_to_friend_id and owner_id = p_user_id;
  end if;

  return v_postcard_id;
end
$$;

grant execute on function public.send_postcard_sms(
  uuid, uuid, text, text, text, text, timestamptz
) to service_role;

------------------------------------------------------------
-- 3. Helper RPC: list scheduled postcards due for Lob handoff.
--    Called by the fire-scheduled Edge Function (cron-triggered).
------------------------------------------------------------

create or replace function public.list_due_scheduled_postcards()
returns table (id uuid, scheduled_send_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, scheduled_send_at
    from public.postcards
    where status = 'scheduled'
      and scheduled_send_at <= now()
    order by scheduled_send_at
    limit 50;
$$;

grant execute on function public.list_due_scheduled_postcards() to service_role;
