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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 1) Authenticate caller via JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Not authenticated" }, 401);

  // 2) Parse body
  let body: { postcard_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad JSON" }, 400);
  }
  if (!body.postcard_id) return json({ error: "postcard_id required" }, 400);

  // 3) Verify ownership + orphan state
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: pc, error: pcErr } = await admin
    .from("postcards")
    .select("id, sender_id, to_kind, lob_id, status")
    .eq("id", body.postcard_id)
    .maybeSingle();
  if (pcErr) return json({ error: pcErr.message }, 500);
  if (!pc) return json({ error: "Postcard not found" }, 404);
  if (pc.sender_id !== user.id) return json({ error: "Not your postcard" }, 403);
  if (pc.lob_id) return json({ error: "Already shipped", lob_id: pc.lob_id }, 409);

  // 4) Forward to lob-send-postcard with html render mode. Works for
  //    both friend-mode and claim-mode orphans because the function
  //    looks up the address from whichever side has it.
  if (!MAILROOM_INTERNAL_SECRET) {
    return json({ error: "Internal secret not configured" }, 500);
  }
  const lobFnUrl = `${SUPABASE_URL}/functions/v1/lob-send-postcard`;
  const lobRes = await fetch(lobFnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mailroom-internal": MAILROOM_INTERNAL_SECRET,
    },
    body: JSON.stringify({
      postcard_id: body.postcard_id,
      render_mode: "html",
    }),
  });
  const lobJson = await lobRes.json().catch(() => ({}));
  if (!lobRes.ok || !lobJson.ok) {
    return json(
      { error: lobJson.error ?? `Lob retry failed (${lobRes.status})` },
      502,
    );
  }
  return json({
    ok: true,
    lob_id: lobJson.lob_id,
    expected_delivery_date: lobJson.expected_delivery_date,
  });
});
