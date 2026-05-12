-- Single-word names like "Pat" were producing "P" instead of "PA".
-- Branch: if the name contains whitespace, take first letter of each word;
-- otherwise take first 2 chars.

create or replace function public.complete_signup(p_name text, p_city text, p_state text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.profiles;
  v_clean text;
  v_initials text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  v_clean := trim(coalesce(p_name, ''));
  if v_clean ~ '\s' then
    v_initials := upper(substr(regexp_replace(v_clean, '(\S)\S*\s*', '\1', 'g'), 1, 2));
  else
    v_initials := upper(substr(v_clean, 1, 2));
  end if;
  update public.profiles set
    name = coalesce(nullif(v_clean, ''), 'Mailroom member'),
    city = coalesce(nullif(trim(p_city), ''), 'Somewhere'),
    state = coalesce(nullif(trim(p_state), ''), ''),
    since = to_char(now(), 'YYYY'),
    avatar_initials = coalesce(nullif(v_initials, ''), '?'),
    has_completed_signup = true,
    has_seen_free_credits_intro = true
  where id = auth.uid()
  returning * into result;
  return result;
end;
$$;
