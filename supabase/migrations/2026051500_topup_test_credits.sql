-- v0.7.0.27 — one-off top-up of test credits.
--
-- The user has been re-signing-up in TestFlight across many builds.
-- Each test session burns through their 5 free credits, and the
-- server-side credit count persists across builds (which is correct
-- behavior for real users — it's just brutal for testers who need
-- many sessions). After build 41 they reported being at 0 credits with
-- no way to verify the photo-in-journal fix or any other send-flow
-- regression.
--
-- This migration tops up scotty@lasolasvc.com's profile to 25 credits
-- so they have headroom to test the build 42 fixes (photo-in-journal,
-- celebration timing, etc.) end-to-end. The free_credits_remaining
-- counter goes up too so the OnboardingFreeCreditsBanner doesn't
-- nag them while they test.
--
-- ONE-OFF: this is not a re-runnable utility. It targets the specific
-- builder account by email. Once they've tested the build, they can
-- continue paying for credits via Stripe or another top-up like this
-- (which we should probably wrap in an admin-only RPC for tonight,
-- but a migration is the fastest path right now).
--
-- Production users are not affected — the WHERE clause filters by
-- the specific email.

update public.profiles
set credits = 25,
    free_credits_remaining = 5
where id in (
  select id
  from auth.users
  where email = 'scotty@lasolasvc.com'
);
