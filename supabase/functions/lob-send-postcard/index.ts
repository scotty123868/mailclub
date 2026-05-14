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
  front_url: string;
  back_url: string;
};

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

  if (!body.postcard_id || !body.front_url || !body.back_url) {
    return new Response(
      JSON.stringify({ ok: false, error: "postcard_id, front_url, back_url all required" }),
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

  // Load the postcard + recipient address + sender info
  const { data: postcard, error: pcErr } = await supabase
    .from("postcards")
    .select("*, friend:to_friend_id(*), sender:sender_id(*)")
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
  if (!friend?.address_line1 || !friend?.address_city || !friend?.address_state || !friend?.address_zip) {
    return new Response(
      JSON.stringify({ ok: false, error: "Friend has no mailing address on file." }),
      { status: 400 },
    );
  }

  const params = new URLSearchParams({
    description: `Mailroom postcard ${postcard.id}`,
    "to[name]": friend.name,
    "to[address_line1]": friend.address_line1,
    ...(friend.address_line2 ? { "to[address_line2]": friend.address_line2 } : {}),
    "to[address_city]": friend.address_city,
    "to[address_state]": friend.address_state,
    "to[address_zip]": friend.address_zip,
    "to[address_country]": friend.address_country ?? "US",
    "from[name]": sender?.name ?? "Mailroom Member",
    "from[address_line1]": sender?.address_line1 ?? "1 Mailroom Way",
    "from[address_city]": sender?.city ?? "Denver",
    "from[address_state]": sender?.state ?? "CO",
    "from[address_zip]": sender?.address_zip ?? "80202",
    "from[address_country]": "US",
    front: body.front_url,
    back: body.back_url,
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
  // Storage URL. The client originally wrote the local ImagePicker file://
  // URI here, but iOS cleans that up so the journal showed a blank tile.
  // front_url is in Supabase Storage and has a stable public URL.
  await supabase
    .from("postcards")
    .update({
      lob_id: json.id,
      lob_status: "queued",
      lob_expected_delivery: json.expected_delivery_date,
      lob_error: null,
      photo_path: body.front_url,
    })
    .eq("id", postcard.id);

  return new Response(
    JSON.stringify({
      ok: true,
      lob_id: json.id,
      expected_delivery_date: json.expected_delivery_date,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
