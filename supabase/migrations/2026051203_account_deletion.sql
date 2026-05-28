-- Apple Guideline 5.1.1(v). account-creation apps must allow deletion in-app.
-- This RPC deletes the auth.users row; ON DELETE CASCADE on the foreign keys
-- of profiles / friends / postcards / void_replies / credit_transactions
-- wipes the rest of the user's data atomically.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = v_user;
end;
$$;

grant execute on function public.delete_my_account() to authenticated;
