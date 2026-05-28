-- ===========================================================================
-- 2026-05-22 v0.7.0.59. reliable sender postcard refresh after claim redeem
-- ===========================================================================
--
-- Bug:
--   Sender opens a send-link postcard after the recipient has submitted
--   their address, but the detail sheet still shows:
--     status = awaiting_address, lob_id = null
--
-- Root causes this migration addresses:
--   1. The client refresh path used a PostgREST GET with an embedded
--      postcard_claims join. That is both cache-prone on iOS and at odds
--      with the privacy migration that revoked sender SELECT on the raw
--      postcard_claims table.
--   2. The Realtime client-side fix requires public.postcards to actually
--      be in the supabase_realtime publication. REPLICA IDENTITY FULL alone
--      is not enough if the table was never added to the publication.
--   3. Claim redemption only flipped status. The sender-safe city field on
--      postcards stayed empty, so even a fresh sender view could not show
--      a useful destination city without joining claims.
--
-- Privacy:
--   This RPC deliberately returns only sender-safe claim fields:
--   claim_token, expires_at, claimed_at, claimed_name, claimed_city.
--   It never returns claimed street address, ZIP, or country.
-- ===========================================================================

-- Ensure UPDATE events for postcards can reach the app's Realtime channel.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'postcards'
     ) then
    alter publication supabase_realtime add table public.postcards;
  end if;
end $$;

-- Postcard UPDATE payloads should include the full row, not only the PK.
alter table public.postcards replica identity full;

-- Sender-safe, POST-backed postcard fetch. Using RPC avoids iOS URLCache
-- issues seen with PostgREST GET and avoids exposing raw postcard_claims.
create or replace function public.fetch_postcards_for_sender()
returns table (
  id uuid,
  sender_id uuid,
  to_kind text,
  to_friend_id uuid,
  from_city text,
  to_city text,
  category text,
  credit_cost integer,
  status text,
  message text,
  place_name text,
  photo_path text,
  custom_description text,
  custom_tone text,
  reference_photo_uris text[],
  sent_at timestamptz,
  lob_id text,
  lob_status text,
  lob_expected_delivery date,
  lob_error text,
  claim_token text,
  claim_expires_at timestamptz,
  claimed_at timestamptz,
  claimed_name text,
  claimed_city text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.sender_id,
    p.to_kind,
    p.to_friend_id,
    coalesce(p.from_city, '') as from_city,
    coalesce(p.to_city, '') as to_city,
    p.category,
    p.credit_cost,
    p.status,
    p.message,
    p.place_name,
    p.photo_path,
    p.custom_description,
    p.custom_tone,
    p.reference_photo_uris,
    p.sent_at,
    p.lob_id,
    p.lob_status,
    p.lob_expected_delivery,
    p.lob_error,
    pc.claim_token,
    pc.expires_at as claim_expires_at,
    pc.claimed_at,
    pc.claimed_name,
    pc.claimed_city
  from public.postcards p
  left join public.postcard_claims pc
    on pc.id = p.claim_id
  where p.sender_id = auth.uid()
  order by p.sent_at desc;
$$;

revoke execute on function public.fetch_postcards_for_sender() from public, anon;
grant execute on function public.fetch_postcards_for_sender() to authenticated;

comment on function public.fetch_postcards_for_sender is
  'Sender-safe postcard feed. Returns postcard rows plus redacted claim '
  'metadata, never claimed street address. Used instead of a cache-prone '
  'PostgREST GET + raw postcard_claims embed.';

-- Patch claim redemption so the sender-visible postcard row also carries
-- the recipient city. Full address remains private in postcard_claims.
create or replace function public.redeem_postcard_claim(
  p_claim_token text,
  p_name text,
  p_address_line1 text,
  p_city text,
  p_state text,
  p_zip text,
  p_address_line2 text default null,
  p_country text default 'US'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id uuid;
  v_postcard_id uuid;
begin
  update public.postcard_claims
    set claimed_at = now(),
        claimed_name = p_name,
        claimed_address_line1 = p_address_line1,
        claimed_address_line2 = p_address_line2,
        claimed_city = p_city,
        claimed_state = p_state,
        claimed_zip = p_zip,
        claimed_country = p_country,
        expires_at = now() + interval '5 years',
        flavor = 'reciprocation'
    where claim_token = p_claim_token
      and claimed_at is null
      and expires_at > now()
    returning id into v_claim_id;

  if v_claim_id is null then
    declare
      v_exists boolean;
      v_already_claimed timestamptz;
      v_expires_at timestamptz;
    begin
      select true, claimed_at, expires_at
        into v_exists, v_already_claimed, v_expires_at
        from public.postcard_claims
        where claim_token = p_claim_token;
      if not coalesce(v_exists, false) then
        return jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
      end if;
      if v_already_claimed is not null then
        return jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
      end if;
      if v_expires_at < now() then
        return jsonb_build_object('ok', false, 'reason', 'EXPIRED');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'UNKNOWN');
    end;
  end if;

  update public.postcards
    set status = 'queued',
        to_city = coalesce(nullif(trim(p_city), ''), to_city)
    where claim_id = v_claim_id
    returning id into v_postcard_id;

  return jsonb_build_object(
    'ok', true,
    'claim_id', v_claim_id,
    'postcard_id', v_postcard_id
  );
end;
$$;

revoke execute on function public.redeem_postcard_claim(text, text, text, text, text, text, text, text)
  from public, authenticated, anon;
grant execute on function public.redeem_postcard_claim(text, text, text, text, text, text, text, text)
  to service_role;

comment on function public.redeem_postcard_claim is
  'v0.7.0.59: atomic one-shot claim redeem; flips postcard to queued and '
  'copies only sender-safe claimed_city onto postcards.to_city for app UI.';
