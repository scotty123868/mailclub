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

// v0.7.0.12: HTML templates for server-side render (send-link claim flow
// AND retry-orphan path). Designed to MATCH the in-app PostcardPreview
// components 1:1 — same Polaroid front, same paper-grain back with FROM
// line, script message, postage stamp, postmark, USPS guide lines, and
// reciprocation QR. The card mailed to your friend is the same card you
// saw on your phone.
//
// 4x6 USPS postcard: 6.25" × 4.25" with 1/8" bleed. Lob overprints the
// recipient address + IMb barcode on the right half of the back (the
// USPS-compliant zone), so our back design only puts decorative elements
// in that area — no text or graphics that would conflict.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildFrontHtml(photoUrl: string, caption?: string): string {
  // Polaroid: white paper frame with photo inset, optional handwritten
  // caption below, tiny MAILROOM wordmark in the lower-right. Matches
  // PostcardFrontPreview after v0.7.0.12 redesign.
  const photoEl = photoUrl
    ? `<img class="photo" src="${escapeHtml(photoUrl)}" />`
    : `<div class="photo placeholder">Mailroom</div>`;
  const captionEl = caption
    ? `<div class="caption">${escapeHtml(caption)}</div>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { margin: 0; size: 6.25in 4.25in; }
html, body { margin: 0; padding: 0; }
.card {
  width: 6.25in; height: 4.25in;
  background: #FFFEFA;
  padding: 0.22in 0.28in 0.65in;
  box-sizing: border-box;
  position: relative;
  font-family: 'Caveat', 'Bradley Hand', 'Comic Sans MS', cursive;
}
.photo {
  width: 100%; height: 100%;
  display: block;
  object-fit: cover;
  background: #1B1F2D;
  border: 0.5pt solid rgba(0,0,0,0.12);
  position: relative;
}
.placeholder {
  font-family: Georgia, serif;
  font-size: 48pt;
  color: #F2EBDA;
  text-align: center;
  line-height: 1;
  padding-top: 1in;
}
.caption {
  position: absolute;
  left: 0; right: 0;
  bottom: 0.22in;
  text-align: center;
  font-size: 20pt;
  color: #17223B;
  letter-spacing: 0.3pt;
}
.mark {
  position: absolute;
  bottom: 0.13in;
  right: 0.28in;
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-weight: 700;
  font-size: 7.5pt;
  letter-spacing: 2.2pt;
  color: rgba(94, 100, 114, 0.65);
}
</style></head><body>
<div class="card">${photoEl}${captionEl}<div class="mark">MAILROOM</div></div>
</body></html>`;
}

function buildBackHtml(opts: {
  message: string;
  senderName?: string;
  senderCity?: string;
  senderState?: string;
  reciprocationUrl?: string;
}): string {
  // Match PostcardBackPreview: cream paper backdrop, gold vertical divider,
  // FROM line + script message on the left, USPS guide lines + postage
  // stamp imagery + reciprocation QR on the left side (right is reserved
  // for Lob's overprint of the recipient address + IMb).
  const fromLine = opts.senderName
    ? `FROM: ${escapeHtml(opts.senderName.toUpperCase())}${opts.senderCity ? `, ${escapeHtml(opts.senderCity.toUpperCase())}` : ""}${opts.senderState ? ` ${escapeHtml(opts.senderState.toUpperCase())}` : ""}`
    : "";
  // QR via qrserver.com — Lob's renderer fetches the image. 300px is
  // plenty for a 0.8in print. ecc=M for moderate error correction.
  const qrSrc = opts.reciprocationUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=300x300&ecc=M&margin=0&data=${encodeURIComponent(opts.reciprocationUrl)}`
    : "";
  const qrBlock = qrSrc
    ? `<div class="qr-wrap">
        <img class="qr" src="${qrSrc}" />
        <div class="qr-caption">Scan to reply free →</div>
      </div>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { margin: 0; size: 6.25in 4.25in; }
html, body {
  margin: 0; padding: 0;
  width: 6.25in; height: 4.25in;
  background: #FBF4DE;
  color: #17223B;
}
.card { position: relative; width: 100%; height: 100%; }
.divider {
  position: absolute;
  left: 49.9%;
  top: 0.25in;
  bottom: 0.25in;
  width: 0.5pt;
  background: #C2A56D;
  opacity: 0.75;
}
.left {
  position: absolute;
  top: 0; bottom: 0; left: 0;
  width: 50%;
  padding: 0.32in 0.28in 0.32in 0.32in;
  box-sizing: border-box;
}
.from {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-weight: 700;
  font-size: 7.5pt;
  letter-spacing: 0.6pt;
  text-transform: uppercase;
  color: #5E6472;
  margin-bottom: 0.18in;
}
.message {
  font-family: 'Caveat', 'Bradley Hand', 'Comic Sans MS', cursive;
  font-size: 21pt;
  line-height: 1.42;
  letter-spacing: 0.3pt;
  color: #17223B;
  white-space: pre-wrap;
  overflow: hidden;
  height: calc(100% - 1.6in);
}
.qr-wrap {
  position: absolute;
  left: 0.32in;
  bottom: 0.32in;
  width: 1in;
  text-align: center;
}
.qr {
  width: 0.92in; height: 0.92in;
  background: #FFFDF7;
  padding: 0.05in;
  border: 0.5pt solid #C2A56D;
}
.qr-caption {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-style: italic;
  font-size: 7pt;
  color: #5E6472;
  margin-top: 0.04in;
  white-space: nowrap;
}
/* Right half: deliberately empty. Lob overprints recipient + IMb here.
   We render the postage stamp + postmark as decoration in the TOP-RIGHT
   corner only — Lob's address zone is the middle-lower right. */
.stamp {
  position: absolute;
  top: 0.22in;
  right: 0.32in;
  width: 0.72in;
  height: 0.86in;
  transform: rotate(-4deg);
  background: #B84A3A;
  border: 0.8pt solid #7A2218;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  display: flex;
  align-items: center;
  justify-content: center;
}
.stamp-inner {
  width: 0.62in;
  height: 0.76in;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 0.05in 0;
  color: #FFFDF7;
}
.stamp-top {
  font-family: 'Helvetica Neue', Arial, sans-serif;
  font-weight: 700;
  font-size: 6pt;
  letter-spacing: 0.8pt;
}
.stamp-dove {
  font-family: Georgia, serif;
  font-size: 22pt;
  line-height: 1;
}
.stamp-denom {
  background: #FFFDF7;
  color: #B84A3A;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-weight: 700;
  font-size: 7pt;
  padding: 1pt 4pt;
}
.postmark {
  position: absolute;
  top: 0.42in;
  right: 0.92in;
  width: 0.62in;
  height: 0.62in;
  border: 1.5pt solid #B84A3A;
  border-radius: 50%;
  opacity: 0.7;
  transform: rotate(-8deg);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #B84A3A;
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-size: 5.5pt;
  letter-spacing: 0.8pt;
  text-align: center;
  line-height: 1.2;
}
</style></head><body>
<div class="card">
  <div class="divider"></div>
  <div class="left">
    ${fromLine ? `<div class="from">${fromLine}</div>` : ""}
    <div class="message">${escapeHtml(opts.message)}</div>
    ${qrBlock}
  </div>
  <div class="stamp">
    <div class="stamp-inner">
      <div class="stamp-top">MAILROOM</div>
      <div class="stamp-dove">✶</div>
      <div class="stamp-denom">FOREVER</div>
    </div>
  </div>
  <div class="postmark">
    MAILROOM<br>WITH CARE<br>2026
  </div>
</div>
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

  // Load the postcard. v0.7.0.11: switched off PostgREST embedded
  // selects after the cache stopped resolving postcards→profiles for
  // sender_id and postcards→postcard_claims for claim_id. Three
  // explicit queries instead — slower but cache-invariant.
  const { data: postcard, error: pcErr } = await supabase
    .from("postcards")
    .select("*")
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

  const toKind = (postcard as any).to_kind;
  const senderId = (postcard as any).sender_id;
  const friendId = (postcard as any).to_friend_id;
  const claimId = (postcard as any).claim_id;

  // Sender profile — always need this for the from-address.
  const { data: sender } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", senderId)
    .maybeSingle();

  // Recipient — either via friend or claim depending on to_kind.
  let friend: any = null;
  let claim: any = null;
  if (toKind === "claim" && claimId) {
    const { data } = await supabase
      .from("postcard_claims")
      .select("*")
      .eq("id", claimId)
      .maybeSingle();
    claim = data;
  } else if (friendId) {
    const { data } = await supabase
      .from("friends")
      .select("*")
      .eq("id", friendId)
      .maybeSingle();
    friend = data;
  }

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
    // v0.7.0.12: mint a reciprocation token for the back QR so the
    // recipient can scan + reply free. If one already exists for this
    // postcard, the RPC returns the existing token (idempotent).
    let reciprocationUrl = "";
    try {
      const { data: tokenData } = await supabase.rpc("create_reciprocation_token", {
        p_postcard_id: postcard.id,
      });
      if (tokenData && typeof tokenData === "object" && (tokenData as any).url) {
        reciprocationUrl = (tokenData as any).url as string;
      } else if (tokenData && typeof tokenData === "object" && (tokenData as any).token) {
        // Some versions of the RPC return just the token; build the URL.
        reciprocationUrl = `https://app.mailrooms.app/welcome-mail/${(tokenData as any).token}`;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[lob-send-postcard] reciprocation token mint failed:", err);
      // Continue without QR — postcard still ships, just no reply hook.
    }
    frontPayload = buildFrontHtml(photoUrl);
    backPayload = buildBackHtml({
      message: (postcard as any).message ?? "",
      senderName: sender?.name ?? undefined,
      senderCity: sender?.city ?? undefined,
      senderState: sender?.state ?? undefined,
      reciprocationUrl: reciprocationUrl || undefined,
    });
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
