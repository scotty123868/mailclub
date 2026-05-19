-- =========================================================================
-- 2026-05-19 — Lob submission lease (Codex audit P1)
-- =========================================================================
--
-- Background: lob-send-postcard had an early-return guard checking
-- `postcard.lob_id != null`. That catches LATE retries (one POST already
-- finished, second POST sees the lob_id and bails). It DOES NOT catch
-- concurrent first submissions: two POSTs arrive at the same millisecond,
-- both SELECT the row before either has written lob_id, both pass the
-- guard, both POST to Lob, both write back — last-write-wins. The user
-- gets two physical postcards for one credit.
--
-- Fix: an idempotency lease table. Before calling Lob, the function
-- atomically inserts a lease row keyed on postcard_id. The first INSERT
-- wins via the primary-key constraint; concurrent callers get a
-- unique_violation and fall through to a re-fetch that picks up the
-- winner's lob_id once written.
--
-- The lease is short-lived (10 min default) so a stuck submission
-- (network hang to Lob, function timeout) doesn't lock the postcard
-- forever. retry-orphan / future workers can claim an expired lease.
-- =========================================================================

create table if not exists public.postcard_lob_submissions (
  postcard_id uuid primary key references public.postcards(id) on delete cascade,
  attempt_id uuid not null default gen_random_uuid(),
  status text not null check (status in ('in_flight', 'succeeded', 'failed')) default 'in_flight',
  lob_id text,
  lob_error text,
  attempted_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default (now() + interval '10 minutes'),
  finished_at timestamptz
);

comment on table public.postcard_lob_submissions is
  'v0.7.0.49: idempotency lease for lob-send-postcard. One row per '
  'postcard_id; insert wins the right to call Lob. A succeeded row '
  'persists the lob_id; failed/expired rows can be claimed by retry-orphan.';

create index if not exists postcard_lob_submissions_status_idx
  on public.postcard_lob_submissions (status, lease_expires_at)
  where status = 'in_flight';

-- RLS — owners + service_role only. Sender can read their own
-- submissions for the retry-orphan UI to surface failure detail.
alter table public.postcard_lob_submissions enable row level security;

drop policy if exists postcard_lob_submissions_owner_select on public.postcard_lob_submissions;
create policy postcard_lob_submissions_owner_select
  on public.postcard_lob_submissions for select
  using (
    exists (
      select 1 from public.postcards p
      where p.id = postcard_lob_submissions.postcard_id
        and p.sender_id = auth.uid()
    )
  );

-- Writes go through SECURITY DEFINER functions only. No client INSERT
-- or UPDATE is permitted directly.
revoke insert, update, delete on public.postcard_lob_submissions
  from public, authenticated, anon;
grant select on public.postcard_lob_submissions to authenticated;
grant all on public.postcard_lob_submissions to service_role;

-- -------------------------------------------------------------------------
-- Helper: try_acquire_lob_lease(postcard_id, attempt_id, lease_seconds)
--
-- Atomically inserts (or updates an expired-stale row) for this postcard.
-- Returns the attempt_id that won. If the caller's attempt_id matches the
-- returned value, they own the lease and should call Lob. Otherwise
-- another caller is in flight; they should re-fetch and idempotency-guard.
-- -------------------------------------------------------------------------
create or replace function public.try_acquire_lob_lease(
  p_postcard_id uuid,
  p_attempt_id uuid,
  p_lease_seconds integer default 600
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_winning_attempt uuid;
begin
  -- First try an INSERT. Wins on first attempt; ON CONFLICT path
  -- handles re-attempts where the prior lease has expired or already
  -- terminated. We allow re-acquisition when the previous lease has
  -- either expired or been marked failed.
  insert into public.postcard_lob_submissions
    (postcard_id, attempt_id, status, lease_expires_at)
  values
    (p_postcard_id, p_attempt_id, 'in_flight',
     now() + make_interval(secs => p_lease_seconds))
  on conflict (postcard_id) do update
    set attempt_id = excluded.attempt_id,
        status = 'in_flight',
        lease_expires_at = excluded.lease_expires_at,
        attempted_at = now(),
        finished_at = null,
        lob_error = null
    where postcard_lob_submissions.status in ('failed')
       or postcard_lob_submissions.lease_expires_at < now()
  returning attempt_id into v_winning_attempt;

  if v_winning_attempt is null then
    -- ON CONFLICT WHERE clause didn't match: a non-expired in_flight or
    -- succeeded lease exists. Return whoever owns it.
    select attempt_id into v_winning_attempt
      from public.postcard_lob_submissions
      where postcard_id = p_postcard_id;
  end if;

  return v_winning_attempt;
end;
$$;

revoke execute on function public.try_acquire_lob_lease(uuid, uuid, integer)
  from public, authenticated, anon;
grant execute on function public.try_acquire_lob_lease(uuid, uuid, integer)
  to service_role;

create or replace function public.finalize_lob_lease(
  p_postcard_id uuid,
  p_attempt_id uuid,
  p_status text,
  p_lob_id text default null,
  p_lob_error text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'invalid lease status: %', p_status;
  end if;
  update public.postcard_lob_submissions
    set status = p_status,
        lob_id = coalesce(p_lob_id, lob_id),
        lob_error = coalesce(p_lob_error, lob_error),
        finished_at = now()
    where postcard_id = p_postcard_id
      and attempt_id = p_attempt_id;
end;
$$;

revoke execute on function public.finalize_lob_lease(uuid, uuid, text, text, text)
  from public, authenticated, anon;
grant execute on function public.finalize_lob_lease(uuid, uuid, text, text, text)
  to service_role;
