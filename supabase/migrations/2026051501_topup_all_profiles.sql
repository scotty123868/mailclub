-- v0.7.0.27 follow-up. broader top-up.
--
-- The earlier 2026051500_topup_test_credits.sql matched by
-- auth.users.email = 'scotty@lasolasvc.com'. Apple Sign In often
-- stores the user's address as a private-relay alias
-- (...@privaterelay.appleid.com) or leaves auth.users.email NULL
-- entirely if the user picked "Hide My Email." Result: zero rows
-- updated and the user kept hitting INSUFFICIENT_CREDITS.
--
-- This pass is brute force: every profile gets credits topped to at
-- least 25, free_credits_remaining at least 5, and the three
-- onboarding flags set so older client builds (pre-build-42, before
-- the WelcomeGate returning-user gate broadened) don't force the
-- user back through welcome and re-deplete what we just gave them.
--
-- SAFE for this project state. it's a test environment with one
-- builder account and zero production traffic. NEVER re-apply this
-- migration logic against a real user base; it would top up paying
-- users' credits beyond what they purchased.

update public.profiles
set
  credits = greatest(coalesce(credits, 0), 25),
  free_credits_remaining = greatest(coalesce(free_credits_remaining, 0), 5),
  has_completed_signup = true,
  has_seen_free_credits_intro = true;
