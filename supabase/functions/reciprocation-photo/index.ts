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
// Deploy:
//   supabase functions deploy reciprocation-photo

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
    return json({ ok: false, error: "token required" });
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
  if (rpcErr) return json({ ok: false, error: rpcErr.message });
  if (!rpcResult?.ok) {
    return json({ ok: false, reason: rpcResult?.reason ?? "NOT_FOUND" });
  }

  // 2. Mint a signed URL for the path. The path never leaves this function.
  const { data: signed, error: signErr } = await admin
    .storage
    .from("postcard-photos")
    .createSignedUrl(rpcResult.photo_path, expiresIn);
  if (signErr || !signed?.signedUrl) {
    return json({ ok: false, error: signErr?.message ?? "Could not sign photo URL" });
  }

  return json({
    ok: true,
    signed_url: signed.signedUrl,
    expires_in: expiresIn,
  });
});
