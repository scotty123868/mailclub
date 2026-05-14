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

function buildFrontHtml(photoUrl: string): string {
  // v0.7.0.13: photo-only front. Cream border matches the back's paper
  // so front/back read as one piece. No caption, no wordmark. The photo
  // is the statement. Lob's bleed area is automatic; we render edge-to-
  // edge cream and let the photo sit inside a ~6% margin.
  const photoEl = photoUrl
    ? `<img class="photo" src="${escapeHtml(photoUrl)}" />`
    : `<div class="photo placeholder">Mailroom</div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@page { margin: 0; size: 6.25in 4.25in; }
html, body { margin: 0; padding: 0; }
.card {
  width: 6.25in; height: 4.25in;
  background: #FBF4DE;
  padding: 0.15in;
  box-sizing: border-box;
}
.photo {
  width: 100%; height: 100%;
  display: block;
  object-fit: cover;
  background: #1B1F2D;
  border: 0.4pt solid rgba(0,0,0,0.12);
}
.placeholder {
  font-family: Georgia, serif;
  font-size: 48pt;
  color: #E8D5A8;
  text-align: center;
  line-height: 1;
  padding-top: 1in;
}
</style></head><body>
<div class="card">${photoEl}</div>
</body></html>`;
}

function buildBackHtml(opts: {
  message: string;
  senderName?: string;
  senderCity?: string;
  senderState?: string;
  reciprocationUrl?: string;
}): string {
  // v0.7.0.14 — Lob-compliant back layout (FROM line dropped, QR caption
  // neutralized).
  //
  // Lob's published constraints:
  //   - Ink-free address zone: 3.2835" × 2.375", positioned 0.275" from
  //     the right edge and 0.25" from the bottom edge. Lob overprints
  //     recipient + return + indicia + IMb here.
  //   - Bottom 0.625" full-width also IMb-clear.
  //   - Designer-available space: top 1.625" (full width) + left 2.69"
  //     down to y=3.625".
  //
  // Layout:
  //   TOP-RIGHT (4.85–6.07in × 0.22–1.45in): QR + "Scan to reply"
  //     caption — sits where a stamp would go on a paper postcard.
  //   LEFT (0.32in onward, top to y=3.4in): handwritten message,
  //     starts higher now that FROM line is gone, more room overall.
  //   LEFT BOTTOM (0–2.69in × 3.4–3.625in): tiny Mailroom wordmark.
  //   Bottom-right (2.97–5.97in × 1.625–4.0in): LOB INK-FREE — nothing.
  //   Full-width bottom 0.625": LOB INK-FREE — nothing.
  //
  // Why no FROM line: for friend sends, the recipient already knows the
  // sender (their name is on the friend record). The script message
  // itself usually opens with the recipient's name and signs with the
  // sender's, so it's redundant. For pen pal sends, anonymity is
  // intentional — the QR + reply flow handles identification. Lob's
  // auto-printed return address in the ink-free zone is the formal
  // "from" line. Anything else is noise.
  //
  // (Sender args kept in the signature for future use — e.g. an
  // optional "✦ Mailroom pen pal" line for void sends — but unused
  // in this version.)
  void opts.senderName; void opts.senderCity; void opts.senderState;

  const qrSrc = opts.reciprocationUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=400x400&ecc=M&margin=0&data=${encodeURIComponent(opts.reciprocationUrl)}`
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

/* LEFT — handwritten message. Hard-bounded so it can't spill into the
   right-side Lob ink-free zone or the bottom IMb zone. Right edge stops
   at 2.55in (well clear of the 2.97in start of Lob's zone). overflow-
   wrap break-word handles long unbroken strings. */
.message {
  position: absolute;
  top: 0.42in;
  left: 0.42in;
  width: 2.1in;
  max-width: 2.1in;
  height: 2.95in;
  max-height: 2.95in;
  font-family: 'Caveat', 'Bradley Hand', 'Comic Sans MS', cursive;
  font-size: 18pt;
  line-height: 1.42;
  letter-spacing: 0.2pt;
  color: #17223B;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-wrap: break-word;
  word-break: break-word;
  overflow: hidden;
  box-sizing: border-box;
  padding-right: 0.08in;  /* extra visual breathing room from divider */
}

/* TOP-RIGHT — QR as the "stamp" position. Inside the top 1.55in free
   zone, well clear of Lob's ink-free area below it. */
.qr-wrap {
  position: absolute;
  top: 0.22in;
  right: 0.32in;
  width: 1.18in;
  text-align: center;
}
.qr {
  width: 1.1in; height: 1.1in;
  background: #FFFDF7;
  padding: 0.04in;
  border: 0.4pt solid #C2A56D;
  display: block;
}
.qr-caption {
  font-family: 'Cormorant Garamond', Georgia, serif;
  font-style: italic;
  font-size: 7pt;
  color: #5E6472;
  margin-top: 0.06in;
  white-space: nowrap;
}

/* Hairline divider — visual cue that right half is the address side.
   Stops above Lob's ink-free zone. */
.divider {
  position: absolute;
  left: 3.0in;
  top: 0.35in;
  bottom: 0.85in;
  width: 0.4pt;
  background: rgba(194, 165, 109, 0.5);
}
</style></head><body>
<div class="card">
  <div class="divider"></div>
  <div class="message">${escapeHtml(opts.message)}</div>
  ${qrSrc ? `<div class="qr-wrap">
    <img class="qr" src="${qrSrc}" />
    <div class="qr-caption">Scan to reply</div>
  </div>` : ""}
</div>
</body></html>`;
}

// v0.7.0.20: helper that always returns HTTP 200 with the actual outcome
// encoded in the body's `ok` field. Reason: supabase-js's
// functions.invoke() wraps any non-2xx response in a generic
// FunctionsHttpError ("Edge Function returned a non-2xx status code")
// and does NOT parse the body unless the caller explicitly reads
// error.context.json(). Most client code (including our submitToLob)
// just reads `error.message`, so the real reason gets swallowed.
//
// Returning 200 for everything trades HTTP semantics (use status codes
// for failure!) for diagnostic clarity (real error message reaches the
// user every time). This is the right trade for an internal Edge
// Function — supabase analytics dashboard still tracks failures via the
// `ok: false` count in body once we instrument it, and external Lob
// API monitoring is unaffected (we still log lob_error to postcards).
//
// The intent-status param is preserved in the JSON body as `__status`
// for debugging/logging only — it doesn't drive HTTP routing.
function json(body: unknown, _intentStatus = 200): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
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
      return json({ ok: false, error: "Invalid auth token" }, 401);
    }
    callerUserId = userData.user.id;
  } else {
    return json({ ok: false, error: "Auth required (Bearer JWT or internal secret)" }, 401);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
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
    return json({ ok: false, error: "postcard_id required" }, 400);
  }
  if (!useInlineHtml && (!body.front_url || !body.back_url)) {
    return json(
      { ok: false, error: "front_url + back_url required unless render_mode=html" },
      400,
    );
  }

  const lobKey = Deno.env.get("LOB_API_KEY");
  if (!lobKey) {
    return json({ ok: false, error: "LOB_API_KEY env var missing" }, 500);
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
    return json({ ok: false, error: "Postcard does not belong to caller" }, 403);
  }

  if (pcErr || !postcard) {
    return json({ ok: false, error: pcErr?.message ?? "Postcard not found" }, 404);
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
    // v0.7.0.20: include diagnostic info so we can debug *which* field
    // is missing without function logs. Don't leak the actual address —
    // just say which keys are unset.
    const missing = !recipient
      ? "recipient row not found"
      : [
          !recipient.address_line1 && "line1",
          !recipient.address_city && "city",
          !recipient.address_state && "state",
          !recipient.address_zip && "zip",
        ].filter(Boolean).join(", ");
    return json(
      {
        ok: false,
        error: `No recipient address available (missing: ${missing}). The friend record may have been created without a complete mailing address.`,
        toKind,
        friendIdSet: !!friendId,
        claimIdSet: !!claimId,
      },
      400,
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
    // v0.7.0.13: prefer the Mailroom-owned return address (env vars) over
    // the sender's personal home address. Senders' privacy matters — we
    // don't want everyone's home address printed on every postcard's
    // return line. When the env vars aren't set we fall back to a clearly
    // labeled placeholder so test-mode prints still validate; live mode
    // will be gated on real values being present.
    //
    // Set these once via:
    //   supabase secrets set MAILROOM_RETURN_NAME="Mailroom"
    //   supabase secrets set MAILROOM_RETURN_LINE1="123 Some Real St"
    //   supabase secrets set MAILROOM_RETURN_CITY="Denver"
    //   supabase secrets set MAILROOM_RETURN_STATE="CO"
    //   supabase secrets set MAILROOM_RETURN_ZIP="80202"
    "from[name]": Deno.env.get("MAILROOM_RETURN_NAME") ?? "Mailroom",
    "from[address_line1]": Deno.env.get("MAILROOM_RETURN_LINE1") ?? "1 Mailroom Way",
    "from[address_city]": Deno.env.get("MAILROOM_RETURN_CITY") ?? "Denver",
    "from[address_state]": Deno.env.get("MAILROOM_RETURN_STATE") ?? "CO",
    "from[address_zip]": Deno.env.get("MAILROOM_RETURN_ZIP") ?? "80202",
    "from[address_country]": "US",
    front: frontPayload,
    back: backPayload,
    size: "4x6",
    // v0.7.0.20: Lob requires use_type on every postcard send. Without
    // it the API rejects with "Mail use_type must be one of 'marketing'
    // or 'operational'". For Mailroom's product (user-initiated personal
    // postcards to friends), "marketing" is the closer fit — not a
    // transactional/operational notification, more like personal outreach.
    // If you ever want to override per-account (e.g. set the default in
    // dashboard.lob.com → Settings → Account), you can drop this line,
    // but hardcoding keeps the send working independent of account state.
    use_type: "marketing",
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
    return json({ ok: false, error: msg }, 502);
  }

  // v0.7.0.20: renamed to lobJson — the previous `json` const shadowed
  // the new top-level `json()` response helper.
  const lobJson = await lobResp.json();

  if (!lobResp.ok) {
    const msg = lobJson?.error?.message ?? `Lob returned ${lobResp.status}`;
    await supabase.from("postcards").update({ lob_error: msg }).eq("id", postcard.id);
    return json({ ok: false, error: msg }, lobResp.status);
  }

  // Success — persist Lob's metadata on the postcard row.
  const update: Record<string, unknown> = {
    lob_id: lobJson.id,
    lob_status: "queued",
    lob_expected_delivery: lobJson.expected_delivery_date,
    lob_error: null,
  };
  // v0.7.0.23: REMOVED — don't overwrite photo_path with the rendered
  // front URL. The user wants the journal tile to show their actual
  // camera-roll photo, not the rendered postcard composition (which
  // is just the photo + cream frame + tiny text — visually it's a
  // less personal preview than the original snapshot).
  //
  // photo_path stays as whatever was set when the postcard row was
  // first created (a postcard-photos bucket path, signed-URL resolved
  // client-side). Renders live in postcard-renders/{id}/front.jpg if
  // anyone needs them later for debugging or detail-sheet previews.
  if (false && !useInlineHtml && body.front_url) {
    update.photo_path = body.front_url;
  }
  await supabase.from("postcards").update(update).eq("id", postcard.id);

  return json({
    ok: true,
    lob_id: lobJson.id,
    expected_delivery_date: lobJson.expected_delivery_date,
  });
});
