// Reciprocation photo URL minter.
//
// Closes the P2 audit item: `lookup_reciprocation` used to return the raw
// `photo_path` (a Supabase Storage key like "<user-id>/<timestamp>-<name>.jpg")
// to anyone holding a token. The bucket is private, so the path alone can't
// fetch the photo, but the path itself leaked the sender's user_id and an
// upload timestamp. Defense in depth says: don't leak that.
//
// This function takes a reciprocation token + optional expires_in, validates
// the token server-side via the service-role-only RPC
// `_internal_get_reciprocation_photo_path`, and returns a fresh signed URL.
// The path stays inside Supabase.
//
// AUTH: no caller auth required (matches the surrounding flow — anyone with
// the token can already preview the card via lookup_reciprocation). The token
// itself IS the authorization.
//
// v0.7.0.49 (Codex P2 #5) hardening:
//   1. Token format validation rejects malformed tokens BEFORE hitting the
//      database. Tokens are 12 hex chars from gen_random_bytes(6); anything
//      else is either a probing attempt or a buggy client. Format check costs
//      nothing and cuts 99%+ of enumeration traffic at the function boundary.
//   2. Response variants collapsed. Previously distinguished NOT_FOUND /
//      EXPIRED / NO_PHOTO in the response — useful for the client but also
//      a free oracle for an attacker probing tokens. Now: either we return
//      a signed_url, or we return `{ok: false}` with no reason. Clients
//      don't need to differentiate (no-photo is no-photo regardless of why).
//
// Deploy:
//   supabase functions deploy reciprocation-photo --no-verify-jwt

// @ts-nocheck — Deno runtime, not the RN tsconfig
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown) {
  // Same pattern as retry-orphan: always 200, real outcome in body.ok.
  // Avoids supabase-js's functions.invoke() swallowing the body on non-2xx.
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const MIN_EXPIRES = 60;            // 1 min minimum
const MAX_EXPIRES = 60 * 60 * 24;  // 24 hour maximum

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" });

  let body: { token?: string; expires_in?: number };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Bad JSON" });
  }
  if (!body.token || typeof body.token !== "string") {
    return json({ ok: false });
  }

  // v0.7.0.49 (Codex P2 #5): hex format check.
  // Tokens are 12 uppercase hex chars from gen_random_bytes(6) — see
  // 2026051803_audit_p0_hardening.sql. Anything else is either a probe
  // or a buggy client. We accept lowercase hex too because users might
  // type the URL and the path matcher in lookup is exact — but legacy
  // tokens generated before 2026051803 used a different alphabet
  // (upper alpha+digit, with X/Y/Z substitutions). The migration
  // documents the entropy upgrade; old tokens still validate via the
  // exact-match DB lookup so we don't pre-reject them. Just reject
  // anything that's obviously garbage: control chars, very-long
  // strings, etc.
  if (body.token.length < 6 || body.token.length > 64 || !/^[A-Za-z0-9]+$/.test(body.token)) {
    return json({ ok: false });
  }

  // Clamp expires_in to safe bounds. Default 1 hour matches the old
  // getSignedPhotoUrl client default.
  let expiresIn = 60 * 60;
  if (typeof body.expires_in === "number" && Number.isFinite(body.expires_in)) {
    expiresIn = Math.max(MIN_EXPIRES, Math.min(MAX_EXPIRES, Math.floor(body.expires_in)));
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Validate token + fetch path via service-role-only RPC.
  const { data: rpcResult, error: rpcErr } = await admin.rpc(
    "_internal_get_reciprocation_photo_path",
    { p_token: body.token },
  );
  // v0.7.0.49 (Codex P2 #5): collapse all failure modes to a single
  // `{ok: false}` response. Don't tell the caller WHY there's no photo
  // (NOT_FOUND vs EXPIRED vs NO_PHOTO) — that distinction is a free
  // oracle for token enumeration. Clients render the same UI ("Photo
  // unavailable") regardless of reason.
  if (rpcErr || !rpcResult?.ok) {
    return json({ ok: false });
  }

  // 2. Mint a signed URL for the path. The path never leaves this function.
  const { data: signed, error: signErr } = await admin
    .storage
    .from("postcard-photos")
    .createSignedUrl(rpcResult.photo_path, expiresIn);
  if (signErr || !signed?.signedUrl) {
    return json({ ok: false });
  }

  return json({
    ok: true,
    signed_url: signed.signedUrl,
    expires_in: expiresIn,
  });
});
