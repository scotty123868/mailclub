// postcard-confirmation. resolves a draft token → returns the data the
// confirmation web page needs to render the live map + preview + status
// timeline.
//
// Called by mailroom-site/c/<token>/index.html on load and on every
// Realtime tick. Public endpoint (token is the credential). same trust
// model as sms-draft-resolve.
//
// Deploy: `supabase functions deploy postcard-confirmation --no-verify-jwt`
//
// GET /functions/v1/postcard-confirmation?token=<draft_token>
// →
// {
// ok: true,
// postcard_id: "...",
// photo_url: "...signed URL...",
// message: "Wish you were here.",
// recipient: { name, city, state },
// sender: { city, state },
// status: "sent",
// lob_status: "in_production" | "mailed" | "in_transit" | ...
// expected_delivery: "2026-06-02",
// sent_at: "2026-05-26T...",
// timeline: [
// { event: "queued", at: "..." },
// { event: "in_production", at: "..." },
// { event: "mailed", at: "..." },
// ...
// ]
// }

// @ts-nocheck. Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
 "Access-Control-Allow-Origin": "*",
 "Access-Control-Allow-Headers": "authorization, content-type, apikey",
 "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
 return new Response(JSON.stringify(body), {
 status,
 headers: { ...CORS, "Content-Type": "application/json" },
 });
}

serve(async (req) => {
 if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

 let token = "";
 if (req.method === "GET") {
 token = new URL(req.url).searchParams.get("token") ?? "";
 } else if (req.method === "POST") {
 try {
 const body = await req.json();
 token = String(body?.token ?? "");
 } catch {
 return json({ ok: false, reason: "bad_json" }, 400);
 }
 } else {
 return json({ ok: false, reason: "method_not_allowed" }, 405);
 }
 if (!token || token.length < 16) {
 return json({ ok: false, reason: "bad_token" }, 400);
 }

 // 1. Resolve the draft → postcard_id
 const { data: draft } = await admin
 .from("sms_postcard_drafts")
 .select("token, photo_path, postcard_id, consumed_at, expires_at")
 .eq("token", token)
 .maybeSingle();
 if (!draft) return json({ ok: false, reason: "not_found" });
 if (!draft.postcard_id) {
 return json({ ok: false, reason: "not_sent_yet" });
 }

 // 2. Fetch postcard + friend
 const { data: postcard } = await admin
 .from("postcards")
 .select(`
 id, message, from_city, to_city, status, lob_id, lob_status,
 lob_expected_delivery, sent_at, scheduled_send_at,
 sender_id, to_friend_id, photo_path,
 lob_front_thumbnail_url
 `)
 .eq("id", draft.postcard_id)
 .maybeSingle();
 if (!postcard) return json({ ok: false, reason: "postcard_missing" });

 const { data: friend } = await admin
 .from("friends")
 .select("name, city, state, address_city, address_state")
 .eq("id", postcard.to_friend_id)
 .maybeSingle();

 const { data: profile } = await admin
 .from("profiles")
 .select("city, state")
 .eq("id", postcard.sender_id)
 .maybeSingle();

 // 3. Image priority:
 // a. Lob's rendered front thumbnail (the actual composed card,
 //    photo + cream frame + greeting + stamp). Best preview because
 //    the tracking page now mirrors what the recipient holds.
 // b. The raw camera-roll photo (postcard.photo_path), signed 24h.
 // c. The draft's MMS photo (pre-postcard creation fallback).
 let photoUrl = "";
 if (postcard.lob_front_thumbnail_url) {
 photoUrl = postcard.lob_front_thumbnail_url;
 }
 if (!photoUrl && postcard.photo_path) {
 if (postcard.photo_path.startsWith("http")) {
 photoUrl = postcard.photo_path;
 } else {
 const { data: signed } = await admin.storage
 .from("postcard-photos")
 .createSignedUrl(postcard.photo_path, 60 * 60 * 24);
 photoUrl = signed?.signedUrl ?? "";
 }
 }
 if (!photoUrl && draft.photo_path) {
 if (draft.photo_path.startsWith("http")) {
 photoUrl = draft.photo_path;
 } else {
 const { data: signed } = await admin.storage
 .from("sms-photos")
 .createSignedUrl(draft.photo_path, 60 * 60 * 24);
 photoUrl = signed?.signedUrl ?? "";
 }
 }

 // 4. Build a tiny timeline from lob_status.
 // We don't track historical Lob events yet (no events table), so for
 // now we synthesize the timeline from the current lob_status. Phase 3
 // will persist each webhook event with a timestamp for true history.
 const lobStatus = (postcard.lob_status ?? "queued").toLowerCase();
 const lobSequence = [
 "queued", "received", "in_production", "mailed",
 "in_transit", "processed_for_delivery", "delivered",
 ];
 const currentIdx = Math.max(0, lobSequence.indexOf(lobStatus));
 const timeline = lobSequence.map((event, i) => ({
 event,
 done: i <= currentIdx,
 current: i === currentIdx,
 }));

 return json({
 ok: true,
 postcard_id: postcard.id,
 photo_url: photoUrl,
 message: postcard.message,
 recipient: {
 name: friend?.name ?? "your friend",
 city: friend?.address_city ?? friend?.city ?? postcard.to_city ?? "",
 state: friend?.address_state ?? friend?.state ?? "",
 },
 sender: {
 city: profile?.city ?? postcard.from_city ?? "",
 state: profile?.state ?? "",
 },
 status: postcard.status,
 lob_status: lobStatus,
 expected_delivery: postcard.lob_expected_delivery,
 sent_at: postcard.sent_at,
 // v1.2 scheduled sending. when the card is queued for future mailing
 // (status='scheduled'), the page shows "Mailing on [send_date]" instead
 // of the live Lob timeline. The cron job flips status → 'sent' when the
 // window arrives, at which point the normal timeline kicks in.
 scheduled_send_at: postcard.scheduled_send_at,
 timeline,
 });
});
