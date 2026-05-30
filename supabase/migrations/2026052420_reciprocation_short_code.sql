-- Reciprocation short codes: 6-char A-Z+0-9 codes for the new
-- "Text REPLY CODE to NUMBER" postcard back template.
--
-- The full claim_token stays for the URL form factor.
-- The short code is what gets printed on paper + typed into iMessage.
-- Easier to read, easier to type.
--
-- Generation: 6 chars from 31-char alphabet (drop 0/O/1/I/L for
-- legibility). Collision space = 31^6 ≈ 887M. We retry on conflict.

alter table public.postcard_claims
  add column if not exists short_code text;

create unique index if not exists postcard_claims_short_code_idx
  on public.postcard_claims(short_code)
  where short_code is not null;

create or replace function public.generate_reciprocation_short_code()
returns text
language plpgsql
as $$
declare
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
  v_i int;
begin
  for v_i in 1..6 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  return v_code;
end;
$$;

-- Backfill short codes for existing claims
do $$
declare
  v_row record;
  v_code text;
  v_attempts int;
begin
  for v_row in
    select claim_token from public.postcard_claims where short_code is null
  loop
    v_attempts := 0;
    loop
      v_code := public.generate_reciprocation_short_code();
      begin
        update public.postcard_claims
          set short_code = v_code
          where claim_token = v_row.claim_token;
        exit;
      exception when unique_violation then
        v_attempts := v_attempts + 1;
        if v_attempts > 10 then
          raise warning 'Could not assign short code for claim %', v_row.claim_token;
          exit;
        end if;
      end;
    end loop;
  end loop;
end$$;

-- Lookup RPC: bot calls this when a recipient texts "REPLY <code>".
-- Returns the original sender's home address so the bot can route a
-- reply card back to them.
create or replace function public.lookup_reciprocation_short_code(p_code text)
returns table (
  postcard_id uuid,
  claim_token text,
  sender_id uuid,
  sender_first_name text,
  sender_city text,
  sender_state text,
  sender_line1 text,
  sender_line2 text,
  sender_zip text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select
      pc.id as postcard_id,
      cl.claim_token,
      p.id as sender_id,
      coalesce(nullif(split_part(p.name, ' ', 1), ''), 'your pen pal') as sender_first_name,
      p.city as sender_city,
      p.state as sender_state,
      p.home_line1 as sender_line1,
      p.home_line2 as sender_line2,
      p.home_zip as sender_zip
    from public.postcard_claims cl
    join public.postcards pc on pc.id = cl.postcard_id
    join public.profiles p on p.id = pc.sender_id
    where cl.short_code = upper(trim(p_code))
      and (cl.expires_at is null or cl.expires_at > now())
    limit 1;
end;
$$;

grant execute on function public.lookup_reciprocation_short_code(text) to service_role;

comment on function public.lookup_reciprocation_short_code is
  'Bot calls this when a user texts "REPLY <code>". Returns the original '
  'sender + their home address so the bot can route the reply card back.';
