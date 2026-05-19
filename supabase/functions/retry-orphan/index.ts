// Retry Lob submission for an orphan postcard.
//
// An "orphan" is a postcards row where:
//   - status = 'sent' or 'awaiting_address' (i.e. supposed to ship)
//   - lob_id IS NULL (i.e. Lob never accepted it)
//   - sender_id = caller (i.e. the user owns it)
//
// These come from earlier broken builds where the welcome-flow Lob
// capture was failing silently (Modal-hosted view-shot bug). v0.7.0.11
// gives the user a Retry button in PostcardDetailSheet to push them
// through again.
//
// AUTH: caller must present a Bearer JWT. The RPC verifies they own the
// postcard before forwarding to lob-send-postcard.
//
// Deploy:
//   supabase functions deploy retry-orphan

// @ts-nocheck — Deno runtime, not the RN tsconfig
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MAILROOM_INTERNAL_SECRET = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// v0.7.0.48 FIX (Codex bug 4): always return HTTP 200 with the outcome
// in the body's `ok` field. supabase-js's functions.invoke() wraps any
// non-2xx response in a generic "Edge Function returned a non-2xx status
// code" error and does NOT parse the body — so the actual reason was
// hidden from the user every time. Mirrors the same pattern that
// lob-send-postcard already uses (see v0.7.0.20 in that file).
function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" });

  // 1) Authenticate caller via JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "Missing Authorization header" });
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return json({ ok: false, error: "Not authenticated" });

  // 2) Parse body
  let body: { postcard_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad JSON" });
  }
  if (!body.postcard_id) return json({ ok: false, error: "postcard_id required" });

  // 3) Verify ownership + orphan state.
  // v0.7.0.49 (Codex audit): include lob_error so the client can show
  // the real reason the original send failed (was persisted by the
  // claim function on missing-secret path + by lob-send-postcard on
  // Lob rejection, but never read on retry).
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: pc, error: pcErr } = await admin
    .from("postcards")
    .select("id, sender_id, to_kind, lob_id, lob_error, status")
    .eq("id", body.postcard_id)
    .maybeSingle();
  if (pcErr) return json({ ok: false, error: pcErr.message });
  if (!pc) return json({ ok: false, error: "Postcard not found" });
  if (pc.sender_id !== user.id) return json({ ok: false, error: "Not your postcard" });
  if (pc.lob_id) return json({ ok: false, error: "Already shipped", lob_id: pc.lob_id });

  // 4) Forward to lob-send-postcard with html render mode. Works for
  //    both friend-mode and claim-mode orphans because the function
  //    looks up the address from whichever side has it.
  if (!MAILROOM_INTERNAL_SECRET) {
    return json({ ok: false, error: "Internal secret not configured" });
  }
  const lobFnUrl = `${SUPABASE_URL}/functions/v1/lob-send-postcard`;
  const lobRes = await fetch(lobFnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mailroom-internal": MAILROOM_INTERNAL_SECRET,
      // Platform JWT gate accepts anon key. Function-level auth then
      // takes the internal-secret path.
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      postcard_id: body.postcard_id,
      render_mode: "html",
    }),
  });
  const lobJson = await lobRes.json().catch(() => ({}));
  if (!lobJson.ok) {
    // Surface Lob's real error to the client. The most common cause is
    // "failed_deliverability_strictness" when USPS won't verify the
    // recipient address — lob-send-postcard already humanizes that
    // before returning, so we pass it through verbatim.
    return json({
      ok: false,
      error: lobJson.error ?? `Lob retry failed (HTTP ${lobRes.status})`,
    });
  }
  return json({
    ok: true,
    lob_id: lobJson.lob_id,
    expected_delivery_date: lobJson.expected_delivery_date,
  });
});
