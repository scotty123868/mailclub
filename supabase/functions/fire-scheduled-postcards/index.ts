// fire-scheduled-postcards — pg_cron-triggered daily.
//
// Reads scheduled postcards whose scheduled_send_at <= now() AND
// status = 'scheduled'. For each, atomically claims the row by flipping
// status → 'queued', hands off to lob-send-postcard, then on success
// the lob-send-postcard function flips status → 'sent' as part of its
// normal flow. On Lob failure we revert back to 'scheduled' for the
// next cron tick to retry.
//
// Deploy: `supabase functions deploy fire-scheduled-postcards --no-verify-jwt`
// Trigger: pg_cron job in migration 2026052370_cron_fire_scheduled.sql
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
//   CRON_TRIGGER_SECRET                     (inbound auth — only pg_cron knows this)
//   MAILROOM_INTERNAL_SECRET                (outbound to lob-send-postcard)
//
// Auth: requires x-cron-trigger header matching CRON_TRIGGER_SECRET. pg_cron
// pulls that value from Vault and supplies it in the header.

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_TRIGGER_SECRET") ?? "";
const INTERNAL_SECRET = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Public anon JWT — same hardcoded value used in sms-inbound. lob-send-postcard
// expects an anon Authorization header in addition to the internal secret.
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sd25tZ3d5bG1tbmFlbWRuemxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1MDI1NjksImV4cCI6MjA5NDA3ODU2OX0.rZlWORqFLfFCBQQ4RPUOBtrqAX_Tc0Gf_sI5hPPENxM";

serve(async (req) => {
  // Auth gate — the cron secret must match. Reject anything else.
  const headerSecret = req.headers.get("x-cron-trigger");
  if (!CRON_SECRET || headerSecret !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 1. Pull up to 50 due cards
  const { data: due, error: listErr } = await admin.rpc("list_due_scheduled_postcards");
  if (listErr) {
    console.error("[fire-scheduled] list_due rpc failed", listErr);
    return new Response(
      JSON.stringify({ ok: false, error: listErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const cards = Array.isArray(due) ? due : [];
  if (cards.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, fired: 0, failed: 0, message: "nothing due" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  let fired = 0;
  let failed = 0;
  const errors: Array<{ id: string; error: string }> = [];

  for (const card of cards) {
    // 2. Atomic claim — flip 'scheduled' → 'queued'. If 0 rows, someone else
    //    grabbed it (concurrent cron run or admin retry); skip.
    const { data: claimed } = await admin
      .from("postcards")
      .update({ status: "queued" })
      .eq("id", card.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    // 3. Hand off to lob-send-postcard. Same shape as sms-inbound's submitToLob.
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/lob-send-postcard`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON_KEY}`,
          apikey: ANON_KEY,
          "x-mailroom-internal": INTERNAL_SECRET,
        },
        body: JSON.stringify({ postcard_id: card.id, render_mode: "html" }),
      });
      const raw = await res.text();
      let data: any = {};
      try { data = JSON.parse(raw); } catch { /* ignore */ }
      if (data?.ok && data?.lob_id) {
        fired++;
        // lob-send-postcard sets status='sent' + sent_at as part of its flow.
        // If it didn't (defensive), flip here.
        await admin
          .from("postcards")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", card.id)
          .eq("status", "queued"); // only if still in 'queued' state
      } else {
        failed++;
        errors.push({ id: card.id, error: data?.error ?? `HTTP ${res.status}` });
        // Revert claim so next cron tick retries.
        await admin
          .from("postcards")
          .update({ status: "scheduled" })
          .eq("id", card.id)
          .eq("status", "queued");
      }
    } catch (e: any) {
      failed++;
      errors.push({ id: card.id, error: e?.message ?? "network error" });
      await admin
        .from("postcards")
        .update({ status: "scheduled" })
        .eq("id", card.id)
        .eq("status", "queued");
    }
  }

  console.log("[fire-scheduled] done", { total: cards.length, fired, failed });

  return new Response(
    JSON.stringify({ ok: true, total: cards.length, fired, failed, errors }),
    { headers: { "Content-Type": "application/json" } },
  );
});
