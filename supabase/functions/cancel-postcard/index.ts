// cancel-postcard — sender-initiated cancellation within Lob's window.
//
// Flow:
//   1. Verify caller's JWT, look up the postcard, confirm sender_id ===
//      auth.uid() so a user can only cancel their own cards.
//   2. If postcard has no lob_id yet (awaiting_address claim or orphan),
//      skip the Lob round-trip and go straight to refund + status flip.
//   3. Otherwise DELETE https://api.lob.com/v1/postcards/{lob_id}. Lob
//      returns 200 if it accepted the cancellation, 422 if the card is
//      already in production.
//   4. On Lob success, call refund_cancelled_postcard RPC to refund the
//      credit + flip postcards.status to 'cancelled' atomically.
//   5. Return { ok, refunded_credits } so the client can update the UI.

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LOB_KEY = Deno.env.get("LOB_API_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // Auth: extract user from the JWT passed via Authorization header.
  const authHeader = req.headers.get("authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ ok: false, error: "No auth token" }, 401);

  const userClient = createClient(SUPABASE_URL, jwt);
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user?.id) {
    return json({ ok: false, error: "Invalid auth token" }, 401);
  }
  const userId = userData.user.id;

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }
  const postcardId = body?.postcard_id;
  if (!postcardId) return json({ ok: false, error: "postcard_id required" }, 400);

  // Look up the postcard with service-role so we can read sender_id +
  // lob_id without depending on the user's RLS view.
  const { data: postcard } = await admin
    .from("postcards")
    .select("id, sender_id, lob_id, status, cancelled_at")
    .eq("id", postcardId)
    .maybeSingle();
  if (!postcard) return json({ ok: false, error: "Postcard not found" }, 404);
  if (postcard.sender_id !== userId) {
    return json({ ok: false, error: "Not the sender" }, 403);
  }
  if (postcard.cancelled_at) {
    return json({ ok: true, reason: "already_cancelled" });
  }

  // Step 1: call Lob to cancel if there's a lob_id. Skip if not — the
  // postcard never made it to Lob in the first place (orphan or
  // claim-awaiting-address), so there's nothing to cancel externally.
  let lobOutcome: "skipped" | "cancelled" | "rejected" = "skipped";
  let lobError: string | null = null;
  if (postcard.lob_id) {
    if (!LOB_KEY) {
      return json({ ok: false, error: "LOB_API_KEY env var missing" }, 500);
    }
    try {
      const lobRes = await fetch(`https://api.lob.com/v1/postcards/${postcard.lob_id}`, {
        method: "DELETE",
        headers: {
          Authorization: "Basic " + btoa(LOB_KEY + ":"),
        },
      });
      if (lobRes.ok) {
        lobOutcome = "cancelled";
      } else {
        // Lob returns 422 when card is past the cancellation window.
        // Show the user a real reason, don't refund.
        const text = await lobRes.text().catch(() => "");
        lobOutcome = "rejected";
        try {
          const parsed = JSON.parse(text);
          lobError = parsed?.error?.message ?? text.slice(0, 200);
        } catch {
          lobError = text.slice(0, 200) || `HTTP ${lobRes.status}`;
        }
        return json({
          ok: false,
          reason: "lob_rejected",
          error: lobError,
        });
      }
    } catch (e) {
      return json({ ok: false, reason: "lob_network_error", error: String(e) }, 500);
    }
  }

  // Step 2: refund the credit + flip status via the SQL helper.
  const { data: refundData, error: refundErr } = await admin.rpc(
    "refund_cancelled_postcard",
    { p_postcard_id: postcardId },
  );
  if (refundErr) {
    return json({ ok: false, reason: "refund_failed", error: refundErr.message }, 500);
  }
  if (refundData?.ok === false) {
    return json({ ok: false, reason: refundData?.reason ?? "refund_failed" });
  }

  return json({
    ok: true,
    lob_outcome: lobOutcome,
    refunded: refundData?.refunded ?? 0,
  });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
