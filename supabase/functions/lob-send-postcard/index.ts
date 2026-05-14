// Supabase Edge Function: lob-send-postcard
//
// Receives a postcard ID + the public URLs of the rendered front/back PNGs
// (already uploaded to Storage by the client), and forwards them to Lob's
// Postcards API. Persists Lob's response (lob_id, lob_status, expected
// delivery, error) back to the `postcards` row.
//
// AUTH MODEL (v0.6.1 hardening, codex audit Phase 6):
//   - Caller MUST present an Authorization: Bearer <jwt> header. We verify
//     it against Supabase auth and resolve the user ID.
//   - The postcard's sender_id must equal the auth'd user. This prevents
//     anyone from calling the function with someone else's postcard_id to
//     burn down our Lob budget.
//   - The `claim` edge function calls this with an internal service-role
//     header (X-Mailroom-Internal) for magic-link redemptions. That code
//     path bypasses the user check but still must present the shared
//     secret stored in MAILROOM_INTERNAL_SECRET.
//
// Deploy:
//   supabase secrets set LOB_API_KEY=test_xxxxx
//   supabase secrets set MAILROOM_INTERNAL_SECRET=$(openssl rand -hex 32)
//   supabase functions deploy lob-send-postcard
//   (NO --no-verify-jwt; we want JWT enforcement on the edge)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOB_API = "https://api.lob.com/v1/postcards";

type Body = {
  postcard_id: string;
  front_url?: string;
  back_url?: string;
  render_mode?: "html"; // v0.7.0.11: server-side render path for claim flow
};

// v0.7.0.11: HTML templates for server-side render (send-link claim flow).
// Sized for 4x6 USPS postcards: 6.25" × 4.25" with 1/8" bleed. Lob's render
// pipeline accepts inline HTML in the `front`/`back` API fields. The recipient
// address is rendered automatically by Lob in the right half of the back —
// we leave it blank intentionally so their address barcode + IMb don't collide
// with our text.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildFrontHtml(photoUrl: string): string {
  // Full-bleed photo. If no photo, fall back to a warm parchment background
  // so the card still ships without a black void on the front.
  const bg = photoUrl
    ? `<img src="${escapeHtml(photoUrl)}" />`
    : `<div class="placeholder">Mailroom</div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { margin: 0; size: 6.25in 4.25in; }
html, body { margin: 0; padding: 0; width: 6.25in; height: 4.25in; }
img { width: 100%; height: 100%; object-fit: cover; display: block; }
.placeholder {
  width: 100%; height: 100%;
  background: #F8F1E3;
  display: flex; align-items: center; justify-content: center;
  font-family: Georgia, serif; font-size: 48pt; color: #17223B;
}
</style></head><body>${bg}</body></html>`;
}

function buildBackHtml(message: string): string {
  // Message on the LEFT half (~3in wide). Lob renders the recipient address
  // + IMb barcode on the right half automatically when we pass `to[...]`
  // form fields. Keeping the right half blank avoids the IMb collision.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { margin: 0; size: 6.25in 4.25in; }
html, body {
  margin: 0; padding: 0; width: 6.25in; height: 4.25in;
  background: #FFFEF9; color: #17223B;
  font-family: 'Caveat', 'Bradley Hand', 'Comic Sans MS', cursive;
}
.message {
  position: absolute;
  top: 0.4in;
  left: 0.4in;
  width: 2.9in;
  height: 3.45in;
  font-size: 17pt;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow: hidden;
}
</style></head><body>
<div class="message">${escapeHtml(message)}</div>
</body></html>`;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405 });
  }

  // -- AUTH --------------------------------------------------------------
  // Either: (a) Bearer JWT from a signed-in user, or (b) internal service
  // call from the claim function with the shared secret. Reject everything
  // else. This closes the abuse vector codex flagged: the function used to
  // accept any request with a valid postcard_id and front/back URLs.
  const authHeader = req.headers.get("authorization") ?? "";
  const internalSecret = req.headers.get("x-mailroom-internal") ?? "";
  const expectedInternal = Deno.env.get("MAILROOM_INTERNAL_SECRET") ?? "";

  let callerUserId: string | null = null;
  let isInternalCall = false;

  if (internalSecret && expectedInternal && internalSecret === expectedInternal) {
    // Internal service-to-service call (claim → lob-send-postcard).
    // Skip the user-id check; the claim function already validated the
    // claim token.
    isInternalCall = true;
  } else if (authHeader.toLowerCase().startsWith("bearer ")) {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid auth token" }),
        { status: 401 },
      );
    }
    callerUserId = userData.user.id;
  } else {
    return new Response(
      JSON.stringify({ ok: false, error: "Auth required (Bearer JWT or internal secret)" }),
      { status: 401 },
    );
  }

  let body: Body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), { status: 400 });
  }

  // v0.7.0.11: two input modes:
  //   1. {postcard_id, front_url, back_url} — original "PNG URLs" path
  //      used by the welcome flow and Send tab via view-shot capture.
  //   2. {postcard_id, render_mode: "html"} — server-side HTML render,
  //      used by the claim function for send-link cards where there's
  //      no client to capture views (recipient is filling in their
  //      address on a web page, sender's app may not even be running).
  //      We build front/back HTML from the postcard data + photo URL
  //      and pass HTML strings to Lob, which renders them server-side.
  const useInlineHtml = body.render_mode === "html";
  if (!body.postcard_id) {
    return new Response(
      JSON.stringify({ ok: false, error: "postcard_id required" }),
      { status: 400 },
    );
  }
  if (!useInlineHtml && (!body.front_url || !body.back_url)) {
    return new Response(
      JSON.stringify({ ok: false, error: "front_url + back_url required unless render_mode=html" }),
      { status: 400 },
    );
  }

  const lobKey = Deno.env.get("LOB_API_KEY");
  if (!lobKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "LOB_API_KEY env var missing" }),
      { status: 500 },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Load the postcard + recipient address + sender info.
  // v0.7.0.11: also embed postcard_claims for send-link cards. The
  // recipient address lives on the claim row (claimed_*), not on a
  // friend record, because send-link cards never create a friend.
  const { data: postcard, error: pcErr } = await supabase
    .from("postcards")
    .select(
      "*, friend:to_friend_id(*), sender:sender_id(*), claim:claim_id(*)",
    )
    .eq("id", body.postcard_id)
    .single();

  // -- OWNERSHIP CHECK --------------------------------------------------
  // User JWT callers can only send their own postcards. Internal callers
  // (claim → lob-send-postcard) skip this since the claim function already
  // validated the claim token AND created the postcard server-side.
  if (postcard && !isInternalCall && callerUserId && (postcard as any).sender_id !== callerUserId) {
    return new Response(
      JSON.stringify({ ok: false, error: "Postcard does not belong to caller" }),
      { status: 403 },
    );
  }

  if (pcErr || !postcard) {
    return new Response(
      JSON.stringify({ ok: false, error: pcErr?.message ?? "Postcard not found" }),
      { status: 404 },
    );
  }

  const friend = (postcard as any).friend;
  const sender = (postcard as any).sender;
  const claim = (postcard as any).claim;
  const toKind = (postcard as any).to_kind;

  // Resolve the recipient address. Two source paths:
  //   - to_kind="friend"|"void"|"self": from the friend record
  //   - to_kind="claim": from the postcard_claims claimed_* fields
  let recipient: {
    name: string;
    address_line1: string;
    address_line2?: string;
    address_city: string;
    address_state: string;
    address_zip: string;
    address_country: string;
  } | null = null;
  if (toKind === "claim" && claim?.claimed_address_line1) {
    recipient = {
      name: claim.claimed_name ?? "Recipient",
      address_line1: claim.claimed_address_line1,
      address_line2: claim.claimed_address_line2 ?? undefined,
      address_city: claim.claimed_city ?? "",
      address_state: claim.claimed_state ?? "",
      address_zip: claim.claimed_zip ?? "",
      address_country: claim.claimed_country ?? "US",
    };
  } else if (friend?.address_line1) {
    recipient = {
      name: friend.name,
      address_line1: friend.address_line1,
      address_line2: friend.address_line2 ?? undefined,
      address_city: friend.address_city,
      address_state: friend.address_state,
      address_zip: friend.address_zip,
      address_country: friend.address_country ?? "US",
    };
  }
  if (!recipient || !recipient.address_line1 || !recipient.address_city || !recipient.address_state || !recipient.address_zip) {
    return new Response(
      JSON.stringify({ ok: false, error: "No recipient address available (need either a friend with an address or a claimed claim row)" }),
      { status: 400 },
    );
  }

  // For html render mode, build the front + back HTML from the postcard
  // data + a signed URL to the photo. Lob renders it server-side. This
  // is how send-link cards reach Lob — the claim function can call this
  // function with just postcard_id + render_mode="html" once the
  // recipient address has been claimed.
  let frontPayload = body.front_url;
  let backPayload = body.back_url;
  if (useInlineHtml) {
    // Sign the photo URL. The postcard-photos bucket is private; we
    // give Lob a 7-day signed URL which is plenty for them to fetch +
    // render it on their side. They store their own copy after.
    let photoUrl = "";
    if ((postcard as any).photo_path) {
      const path = (postcard as any).photo_path as string;
      if (path.startsWith("http")) {
        photoUrl = path;
      } else {
        const { data: signed } = await supabase.storage
          .from("postcard-photos")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        if (signed?.signedUrl) photoUrl = signed.signedUrl;
      }
    }
    frontPayload = buildFrontHtml(photoUrl);
    backPayload = buildBackHtml((postcard as any).message ?? "");
  }

  const params = new URLSearchParams({
    description: `Mailroom postcard ${postcard.id}`,
    "to[name]": recipient.name,
    "to[address_line1]": recipient.address_line1,
    ...(recipient.address_line2 ? { "to[address_line2]": recipient.address_line2 } : {}),
    "to[address_city]": recipient.address_city,
    "to[address_state]": recipient.address_state,
    "to[address_zip]": recipient.address_zip,
    "to[address_country]": recipient.address_country,
    "from[name]": sender?.name ?? "Mailroom Member",
    "from[address_line1]": sender?.address_line1 ?? "1 Mailroom Way",
    "from[address_city]": sender?.city ?? "Denver",
    "from[address_state]": sender?.state ?? "CO",
    "from[address_zip]": sender?.address_zip ?? "80202",
    "from[address_country]": "US",
    front: frontPayload,
    back: backPayload,
    size: "4x6",
  });

  let lobResp: Response;
  try {
    lobResp = await fetch(LOB_API, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(lobKey + ":")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Network error to Lob";
    await supabase.from("postcards").update({ lob_error: msg }).eq("id", postcard.id);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 502 });
  }

  const json = await lobResp.json();

  if (!lobResp.ok) {
    const msg = json?.error?.message ?? `Lob returned ${lobResp.status}`;
    await supabase.from("postcards").update({ lob_error: msg }).eq("id", postcard.id);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: lobResp.status });
  }

  // Success — persist Lob's metadata on the postcard row.
  // v0.7.0.10: also overwrite photo_path with the rendered front PNG's
  // Storage URL when the URL-mode caller (welcome/Send tab) supplied one,
  // so the journal renders the actual rendered front instead of the
  // volatile ImagePicker tmp file. In html mode (send-link claim path)
  // there's no rendered URL to write — keep the original photo_path
  // (which is the postcard-photos Storage path, resolved to signed URLs
  // on the client via fetchPostcards in v0.7.0.11).
  const update: Record<string, unknown> = {
    lob_id: json.id,
    lob_status: "queued",
    lob_expected_delivery: json.expected_delivery_date,
    lob_error: null,
  };
  if (!useInlineHtml && body.front_url) {
    update.photo_path = body.front_url;
  }
  await supabase.from("postcards").update(update).eq("id", postcard.id);

  return new Response(
    JSON.stringify({
      ok: true,
      lob_id: json.id,
      expected_delivery_date: json.expected_delivery_date,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
