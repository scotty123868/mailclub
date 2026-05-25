-- v1.1: SMS-to-postcard flow.
--
-- The user texts a photo (+ optional caption) to Mailroom's Twilio
-- number. We download the MMS media, stash it in Supabase Storage,
-- create a "draft" row keyed by phone + token, and SMS the user back
-- with a magic compose URL. The user opens the URL in mobile Safari,
-- finishes composing (message + recipient), authenticates via phone
-- OTP, and submits. We then re-use the existing send_postcard RPC +
-- lob-send-postcard Edge Function to actually print/mail.
--
-- Two schema changes here:
--
--   1. sms_postcard_drafts table — short-lived rows that live in the
--      window between "user texted us a photo" and "user finished
--      composing on the web." Tokens expire after 24 hours so abandoned
--      drafts don't accumulate.
--
--   2. postcards.sms_origin boolean — flags postcards that came in via
--      the SMS surface vs the iOS app. Used by:
--        a) the Lob template to render a small "Sent via Mailroom" mark
--           on the back (SMS users haven't seen our brand otherwise)
--        b) the confirmation-SMS Edge Function to know it should text
--           the sender on lob_status changes (iOS users get Realtime;
--           SMS users get SMS)

create table if not exists public.sms_postcard_drafts (
  id uuid primary key default gen_random_uuid(),
  -- Cryptographically random URL-safe token. The compose page reads
  -- the draft by token (not by id) so the magic link is unguessable.
  -- 32 chars base32 ≈ 160 bits entropy.
  token text unique not null,
  -- Sender's phone in E.164 (Twilio's standard format). We use this
  -- to lookup an existing profile on submit, or create one tied to
  -- this number via Supabase Auth phone OTP.
  from_phone text not null,
  -- The optional text the user sent alongside the photo. Stripped
  -- of media URLs etc. by the inbound handler. May be empty.
  caption text not null default '',
  -- Supabase Storage path to the downloaded MMS media. We pull it
  -- from Twilio's CDN once + persist it in our own bucket so the
  -- compose page (and Lob handoff later) work without Twilio creds.
  -- Example: 'sms-photos/<token>/photo.jpg'
  photo_path text not null,
  -- Original Twilio media URL — kept for debugging only. Not exposed
  -- to clients (RLS blocks it).
  twilio_media_url text,
  -- When the draft was created. The 24h expiry is computed as
  -- created_at + interval '24 hours'.
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  -- Set when the user submits the compose form. Until then, the link
  -- is reusable (user can re-open and edit message). After consume,
  -- the link returns "already submitted, your card is in flight."
  consumed_at timestamptz,
  -- After submission, the actual postcards.id created from this draft.
  -- Used by the SMS confirmation flow + status webhook to map back.
  postcard_id uuid references public.postcards(id) on delete set null
);

create index if not exists sms_postcard_drafts_token_idx
  on public.sms_postcard_drafts(token);
create index if not exists sms_postcard_drafts_from_phone_idx
  on public.sms_postcard_drafts(from_phone);
-- Helps a periodic cleanup job find expired unconsumed drafts.
create index if not exists sms_postcard_drafts_expires_idx
  on public.sms_postcard_drafts(expires_at)
  where consumed_at is null;

-- RLS: drafts are NEVER readable via PostgREST. All access goes through
-- service-role Edge Functions. The compose page uses an unauthenticated
-- Edge Function (`sms-draft-resolve`) that takes a token and returns
-- the photo URL + safe metadata only.
alter table public.sms_postcard_drafts enable row level security;

revoke all on public.sms_postcard_drafts from anon, authenticated;
-- (service_role bypasses RLS by default — Edge Functions using SUPABASE_SERVICE_ROLE_KEY
--  can read/write freely.)

------------------------------------------------------------
-- postcards.sms_origin flag
------------------------------------------------------------

alter table public.postcards
  add column if not exists sms_origin boolean not null default false;

-- comment for the next person who reads the schema.
comment on column public.postcards.sms_origin is
  'true when the postcard was created via the SMS flow (text-a-photo). '
  'Drives the Lob "Sent via Mailroom" branding mark on the back and '
  'routes status updates to SMS instead of in-app Realtime.';

------------------------------------------------------------
-- profiles.phone — store the verified phone for SMS users so we
-- can lookup repeat senders by phone (Supabase Auth tracks phone
-- separately; we mirror it here for join-friendly access)
------------------------------------------------------------

alter table public.profiles
  add column if not exists phone text unique;

comment on column public.profiles.phone is
  'E.164 phone number, verified via Supabase Auth phone OTP. '
  'Used to lookup an existing account when a phone texts our '
  'Twilio number a second time. Nullable for users created via '
  'Apple Sign In without a phone.';

------------------------------------------------------------
-- create_sms_draft RPC — service-role only. Called by sms-inbound
-- Edge Function when a new MMS comes in.
------------------------------------------------------------

create or replace function public.create_sms_draft(
  p_token text,
  p_from_phone text,
  p_caption text,
  p_photo_path text,
  p_twilio_media_url text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Reject anonymous callers — service_role only.
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  insert into public.sms_postcard_drafts (
    token, from_phone, caption, photo_path, twilio_media_url
  ) values (
    p_token, p_from_phone, p_caption, p_photo_path, p_twilio_media_url
  ) returning id into v_id;

  return v_id;
end
$$;

grant execute on function public.create_sms_draft(text, text, text, text, text) to service_role;

------------------------------------------------------------
-- resolve_sms_draft RPC — service-role only. Reads a draft by
-- token and returns the public-safe shape for the compose page.
-- Refuses if expired or already consumed.
------------------------------------------------------------

create or replace function public.resolve_sms_draft(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sms_postcard_drafts;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select * into v_row from public.sms_postcard_drafts where token = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_row.consumed_at is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'already_consumed',
      'postcard_id', v_row.postcard_id
    );
  end if;
  if v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  return jsonb_build_object(
    'ok', true,
    'draft_id', v_row.id,
    'from_phone', v_row.from_phone,
    'caption', v_row.caption,
    'photo_path', v_row.photo_path,
    'created_at', v_row.created_at,
    'expires_at', v_row.expires_at
  );
end
$$;

grant execute on function public.resolve_sms_draft(text) to service_role;

------------------------------------------------------------
-- consume_sms_draft RPC — marks a draft consumed and links it to
-- the postcard that was created. Called from the submit Edge
-- Function after send_postcard runs successfully.
------------------------------------------------------------

create or replace function public.consume_sms_draft(
  p_token text,
  p_postcard_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  update public.sms_postcard_drafts
    set consumed_at = now(),
        postcard_id = p_postcard_id
    where token = p_token
      and consumed_at is null;
end
$$;

grant execute on function public.consume_sms_draft(text, uuid) to service_role;
