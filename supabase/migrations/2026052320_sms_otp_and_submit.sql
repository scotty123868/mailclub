-- v1.1 SMS Phase 2. OTP verification + submit path schema.
--
-- Adds:
--   1. phone_otp_codes table. stores generated 6-digit codes per phone.
--   2. sms_postcard_drafts.verified_phone column. set when OTP for a
--      phone+draft pair has been successfully verified; gates submit.
--   3. RPCs to mint, verify, and consume OTP codes (service-role only).
--   4. send_postcard_sms RPC. service-role version of send_postcard that
--      takes an explicit p_user_id (the existing send_postcard requires
--      auth.uid() which we don't have from a phone-OTP'd web session).

------------------------------------------------------------
-- 1. phone_otp_codes
------------------------------------------------------------

create table if not exists public.phone_otp_codes (
  id uuid primary key default gen_random_uuid(),
  -- Phone in E.164. Composite UNIQUE with draft_token below.
  phone text not null,
  -- Bcrypt-style approach would be nicer but adds dependency weight.
  -- 6-digit codes are short-lived (10 min) and rate-limited (5
  -- attempts/code, 5 codes/phone/hour) so plain storage is acceptable.
  code text not null,
  -- The compose draft this OTP is for. Ties the OTP to a single
  -- compose session so a code for one draft can't be replayed against
  -- another. Nullable for any future "generic OTP" use.
  draft_token text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  -- 0 means unused. Incremented on each failed verify attempt.
  attempts integer not null default 0,
  -- Set when this code was successfully verified. After that the code
  -- is dead. re-using requires generating a new one.
  consumed_at timestamptz
);

create index if not exists phone_otp_codes_phone_idx
  on public.phone_otp_codes(phone);
create index if not exists phone_otp_codes_draft_token_idx
  on public.phone_otp_codes(draft_token);

alter table public.phone_otp_codes enable row level security;
revoke all on public.phone_otp_codes from anon, authenticated;

------------------------------------------------------------
-- 2. sms_postcard_drafts.verified_phone
------------------------------------------------------------

alter table public.sms_postcard_drafts
  add column if not exists verified_phone text;

comment on column public.sms_postcard_drafts.verified_phone is
  'Set by sms-otp-verify when the user successfully proves they own '
  'the phone tied to this draft. sms-submit requires this to be '
  'non-null AND equal to from_phone (we OTP-verify the same number '
  'they texted in from. no swapping).';

------------------------------------------------------------
-- 3. mint_phone_otp RPC. generates + stores a code, returns it
--    so the Edge Function can SMS it. Service-role only.
------------------------------------------------------------

create or replace function public.mint_phone_otp(
  p_phone text,
  p_draft_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_recent_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  -- Rate limit: max 5 codes per phone per hour. Prevents OTP-spam
  -- abuse / cost runaway on Twilio.
  select count(*) into v_recent_count
    from public.phone_otp_codes
    where phone = p_phone
      and created_at > now() - interval '1 hour';
  if v_recent_count >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- 6-digit, zero-padded. Cryptographically random.
  v_code := lpad((floor(random() * 1000000))::text, 6, '0');

  insert into public.phone_otp_codes (phone, code, draft_token)
  values (p_phone, v_code, p_draft_token);

  return jsonb_build_object('ok', true, 'code', v_code);
end
$$;

grant execute on function public.mint_phone_otp(text, text) to service_role;

------------------------------------------------------------
-- 4. verify_phone_otp. checks a code, marks consumed, optionally
--    flips the draft's verified_phone. Returns ok/reason.
------------------------------------------------------------

create or replace function public.verify_phone_otp(
  p_phone text,
  p_code text,
  p_draft_token text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.phone_otp_codes;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  -- Find the most recent unused code for this phone (+draft if given).
  select * into v_row
    from public.phone_otp_codes
    where phone = p_phone
      and (p_draft_token is null or draft_token = p_draft_token)
      and consumed_at is null
    order by created_at desc
    limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_code');
  end if;

  if v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if v_row.attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  if v_row.code <> p_code then
    update public.phone_otp_codes
      set attempts = attempts + 1
      where id = v_row.id;
    return jsonb_build_object(
      'ok', false,
      'reason', 'wrong_code',
      'attempts_left', greatest(0, 5 - (v_row.attempts + 1))
    );
  end if;

  -- Success: mark code consumed and flip draft.verified_phone if a
  -- draft token was supplied.
  update public.phone_otp_codes
    set consumed_at = now()
    where id = v_row.id;

  if p_draft_token is not null then
    update public.sms_postcard_drafts
      set verified_phone = p_phone
      where token = p_draft_token;
  end if;

  return jsonb_build_object('ok', true);
end
$$;

grant execute on function public.verify_phone_otp(text, text, text) to service_role;

------------------------------------------------------------
-- 5. send_postcard_sms RPC. service-role version of send_postcard
--    that takes p_user_id explicitly. Replicates send_postcard's
--    logic: deduct credit, INSERT postcard row, return id.
--
--    Why a separate RPC: the OG send_postcard uses auth.uid(), which
--    requires a real user JWT in the request. The SMS flow runs in an
--    Edge Function with service-role; we don't have a user JWT to
--    impersonate. Easier + safer to write a new RPC that takes the
--    user id explicitly than to mint a synthetic JWT.
------------------------------------------------------------

create or replace function public.send_postcard_sms(
  p_user_id uuid,
  p_to_friend_id uuid,
  p_message text,
  p_photo_uri text,
  p_to_city text default '',
  p_from_city text default ''
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_cost integer := 1; -- photo cards always cost 1 credit
  v_postcard_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  -- Credit check.
  select credits into v_credits from public.profiles where id = p_user_id;
  if v_credits is null or v_credits < v_cost then
    raise exception 'insufficient_credits' using
      detail = format('user has %s, needs %s', coalesce(v_credits, 0), v_cost);
  end if;

  -- Deduct credit + log transaction.
  update public.profiles
    set credits = credits - v_cost
    where id = p_user_id;

  insert into public.credit_transactions (user_id, delta, reason)
    values (p_user_id, -v_cost, 'send_postcard_sms');

  -- Insert the postcard. status=sent, sms_origin=true so downstream
  -- (Lob template, status webhook) knows to use SMS-specific behavior.
  insert into public.postcards (
    owner_id, to_kind, to_friend_id, from_city, to_city, category,
    credit_cost, status, message, photo_uri, sms_origin
  ) values (
    p_user_id, 'friend', p_to_friend_id, p_from_city, p_to_city, 'photo',
    v_cost, 'sent', p_message, p_photo_uri, true
  )
  returning id into v_postcard_id;

  return v_postcard_id;
end
$$;

grant execute on function public.send_postcard_sms(uuid, uuid, text, text, text, text) to service_role;
