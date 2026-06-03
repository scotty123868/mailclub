// claim-nudge. pg_cron-triggered daily.
//
// A claim link (send-a-link flow) expires 7 days after it's created. If the
// recipient never adds their address the card silently expires and the
// sender hears nothing. This sends ONE gentle reminder: ~2 days after an
// unclaimed link is created (and while it's still live), the sender gets a
// text with the link so they can re-forward it. nudge_sent_at is stamped so
// each link is only ever nudged once.
//
// Deploy: `supabase functions deploy claim-nudge --no-verify-jwt`
// Trigger: pg_cron job in migration 2026060400_claim_nudge.sql
//
// Env vars:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto)
//   CRON_TRIGGER_SECRET            (inbound auth; only pg_cron knows this)
//   LOOPMESSAGE_API_KEY, LOOPMESSAGE_SENDER_ID  (outbound iMessage)
//
// Auth: requires x-cron-trigger header matching CRON_TRIGGER_SECRET. pg_cron
// pulls that value from Vault (cron_trigger_secret) and supplies it.

// @ts-nocheck. Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_TRIGGER_SECRET") ?? "";
const LOOP_API_KEY = Deno.env.get("LOOPMESSAGE_API_KEY") ?? "";
const LOOP_SENDER_ID = Deno.env.get("LOOPMESSAGE_SENDER_ID") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const CLAIM_BASE = "https://app.themailroom.club/claim?t=";

// Minimal LoopMessage outbound. Mirrors loop-inbound's loopSend().
async function loopSend(contact: string, text: string, subject?: string): Promise<boolean> {
 if (!LOOP_API_KEY) return false;
 const body: any = { contact, text };
 if (LOOP_SENDER_ID) body.sender = LOOP_SENDER_ID;
 if (subject) body.subject = subject;
 try {
  const res = await fetch("https://a.loopmessage.com/api/v1/message/send/", {
   method: "POST",
   headers: { Authorization: LOOP_API_KEY, "Content-Type": "application/json" },
   body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok && data?.success !== false;
 } catch (e: any) {
  console.warn("[claim-nudge] loopSend failed", e?.message ?? e);
  return false;
 }
}

serve(async (req) => {
 const headerSecret = req.headers.get("x-cron-trigger");
 if (!CRON_SECRET || headerSecret !== CRON_SECRET) {
  return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
   status: 403, headers: { "Content-Type": "application/json" },
  });
 }

 const now = Date.now();
 const nowIso = new Date(now).toISOString();
 const cutoffIso = new Date(now - 2 * 86400000).toISOString(); // created 2+ days ago

 // Unclaimed, un-nudged, not expired, at least 2 days old.
 const { data: due, error } = await admin
  .from("postcard_claims")
  .select("id, claim_token, expires_at, sender_id")
  .is("claimed_at", null)
  .is("nudge_sent_at", null)
  .lt("created_at", cutoffIso)
  .gt("expires_at", nowIso)
  .limit(100);

 if (error) {
  console.error("[claim-nudge] query failed", error);
  return new Response(JSON.stringify({ ok: false, error: error.message }), {
   status: 500, headers: { "Content-Type": "application/json" },
  });
 }

 const rows = Array.isArray(due) ? due : [];
 if (rows.length === 0) {
  return new Response(JSON.stringify({ ok: true, total: 0, sent: 0, message: "nothing due" }), {
   headers: { "Content-Type": "application/json" },
  });
 }

 // Resolve sender phones in one batch (service role bypasses RLS).
 const senderIds = [...new Set(rows.map((r: any) => r.sender_id).filter(Boolean))];
 const { data: profs } = await admin.from("profiles").select("id, phone").in("id", senderIds);
 const phoneById = new Map((profs ?? []).map((p: any) => [p.id, p.phone]));

 let sent = 0, skipped = 0;
 for (const row of rows as any[]) {
  const phone = phoneById.get(row.sender_id);
  if (!phone) { skipped++; continue; }
  const link = `${CLAIM_BASE}${row.claim_token}`;
  const daysLeft = Math.max(1, Math.round((new Date(row.expires_at).getTime() - now) / 86400000));
  const ok = await loopSend(
   phone,
   `Quick nudge: the postcard you started is still waiting on an address, so it hasn't shipped yet. The link's good for ${daysLeft} more day${daysLeft === 1 ? "" : "s"} — forward it again whenever:\n${link}`,
   "📮 Still waiting on an address",
  );
  // Stamp nudge_sent_at regardless of send outcome so a hard-failing
  // contact doesn't get re-hit every day. One best-effort nudge by design.
  await admin.from("postcard_claims").update({ nudge_sent_at: nowIso }).eq("id", row.id);
  if (ok) sent++; else skipped++;
 }

 console.log("[claim-nudge] done", { total: rows.length, sent, skipped });
 return new Response(JSON.stringify({ ok: true, total: rows.length, sent, skipped }), {
  headers: { "Content-Type": "application/json" },
 });
});
