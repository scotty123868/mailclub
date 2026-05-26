-- v1.2 SMS-only flow — conversational state machine.
--
-- Replaces the hybrid SMS→web compose flow with an end-to-end SMS
-- conversation. The user never leaves Messages. Each inbound text
-- advances them through: photo → recipient name → recipient address
-- → message → confirmation → mailed.
--
-- The web /compose URL still exists for users who'd rather finish in
-- a browser, but the default + first-class path is text-only.
--
-- This migration adds the state-tracking table the new sms-inbound
-- handler keys conversations off. One row per phone number; the row
-- is mutated as the user advances. On completion (card mailed) the
-- row goes back to step='idle' and conversation_data is cleared so
-- the next photo starts a fresh draft.

create table if not exists public.sms_conversation_state (
  -- One row per E.164 phone. Composite-PK alternative was {phone,
  -- conversation_id} but in practice a phone only has one in-flight
  -- conversation at a time — newer photo = restart. Simpler.
  phone text primary key,
  -- The state machine's current step. See sms-inbound for the full
  -- transition table.
  step text not null default 'idle' check (step in (
    'idle',
    'awaiting_recipient_name',
    'awaiting_recipient_address',
    'awaiting_address_confirm',
    'awaiting_message',
    'awaiting_send_confirm'
  )),
  -- The draft (sms_postcard_drafts) the user is currently composing.
  -- Null when step='idle'. Set when a photo arrives + new draft is
  -- minted. Cleared on completion or restart.
  draft_token text references public.sms_postcard_drafts(token) on delete set null,
  -- Recipient + message accumulated as the conversation progresses.
  -- Stored as jsonb so we don't have to keep ALTER-TABLE'ing as the
  -- flow evolves. Shape:
  -- {
  --   recipient_name: string,
  --   recipient: { line1, line2, city, state, zip },
  --   message: string
  -- }
  conversation_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sms_conversation_state_step_idx
  on public.sms_conversation_state(step) where step <> 'idle';

alter table public.sms_conversation_state enable row level security;
revoke all on public.sms_conversation_state from anon, authenticated;
-- Service-role only — sms-inbound is the sole writer.

-- Helper RPC: atomically advance the state machine. Used by sms-inbound
-- to set the next step + merge in new conversation_data fields in one
-- transaction (otherwise two writes could race against a fast retry).
create or replace function public.advance_sms_conversation(
  p_phone text,
  p_step text,
  p_draft_token text default null,
  p_data_patch jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.sms_conversation_state;
  v_merged jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select * into v_existing from public.sms_conversation_state where phone = p_phone;
  v_merged := coalesce(v_existing.conversation_data, '{}'::jsonb) || coalesce(p_data_patch, '{}'::jsonb);

  insert into public.sms_conversation_state (
    phone, step, draft_token, conversation_data, updated_at
  ) values (
    p_phone, p_step, p_draft_token, v_merged, now()
  )
  on conflict (phone) do update
    set step = excluded.step,
        draft_token = excluded.draft_token,
        conversation_data = excluded.conversation_data,
        updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'step', p_step, 'data', v_merged);
end
$$;

grant execute on function public.advance_sms_conversation(text, text, text, jsonb)
  to service_role;

-- Helper: reset to idle (called when card is mailed or user cancels).
create or replace function public.reset_sms_conversation(p_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'service_role required';
  end if;

  insert into public.sms_conversation_state (phone, step, draft_token, conversation_data, updated_at)
  values (p_phone, 'idle', null, '{}'::jsonb, now())
  on conflict (phone) do update
    set step = 'idle',
        draft_token = null,
        conversation_data = '{}'::jsonb,
        updated_at = now();
end
$$;

grant execute on function public.reset_sms_conversation(text) to service_role;
