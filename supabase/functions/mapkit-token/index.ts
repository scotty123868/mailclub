// mapkit-token. mints short-lived JWTs that authenticate the browser to
// Apple's MapKit JS SDK.
//
// Flow:
// 1. mailroom-site /c/<token>/index.html loads mapkit.js from Apple's CDN
// 2. mapkit.init() calls our /functions/v1/mapkit-token endpoint with no
// args (it's a public token. anyone visiting /c/ needs to render the
// map)
// 3. We sign a JWT using the ES256 private key from MAPKIT_PRIVATE_KEY,
// issued for ~10 minutes
// 4. Browser gets the JWT, finishes initializing MapKit JS, renders the
// route
//
// Apple's docs:
// https://developer.apple.com/documentation/mapkitjs/creating-a-maps-token
//
// JWT spec:
// header: { "alg": "ES256", "typ": "JWT", "kid": KEY_ID }
// payload: { "iss": TEAM_ID, "iat": now, "exp": now + 600, "origin": "https://app.themailroom.club" }
// signature: ES256(P-256 SHA-256) over base64url(header).base64url(payload)
//
// Required Supabase secrets (set via `supabase secrets set`):
// MAPKIT_TEAM_ID. Apple Developer Team ID (10 chars)
// MAPKIT_KEY_ID. MapKit JS Key ID from developer.apple.com
// MAPKIT_PRIVATE_KEY. full contents of AuthKey_XXX.p8 file
//
// Deploy: `supabase functions deploy mapkit-token --no-verify-jwt`
//
// Public endpoint. no auth required. Rate-limited at the Edge by Supabase.
// If we see abuse, we can add a referer check (Origin: https://app.themailroom.club).

// @ts-nocheck. Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const TEAM_ID = Deno.env.get("MAPKIT_TEAM_ID") ?? "";
const KEY_ID = Deno.env.get("MAPKIT_KEY_ID") ?? "";
const PRIVATE_KEY_PEM = Deno.env.get("MAPKIT_PRIVATE_KEY") ?? "";

// Tokens live 10 minutes. MapKit JS auto-refetches before expiry.
const TOKEN_TTL_SECONDS = 600;

// Origin lock. restricts the JWT to our domain. Apple verifies this on
// every map tile request. If we ever move to a new domain, update here.
const ALLOWED_ORIGIN = "https://app.themailroom.club";

const CORS = {
 "Access-Control-Allow-Origin": "*",
 "Access-Control-Allow-Methods": "GET, OPTIONS",
 "Access-Control-Allow-Headers": "content-type",
};

function base64urlEncode(buf: ArrayBuffer | Uint8Array): string {
 const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
 let str = "";
 for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
 return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlEncodeJson(obj: unknown): string {
 return base64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

// Strip the PEM headers + base64-decode to the raw EC private key DER bytes.
function pemToPkcs8Der(pem: string): Uint8Array {
 const cleaned = pem
 .replace(/-----BEGIN PRIVATE KEY-----/g, "")
 .replace(/-----END PRIVATE KEY-----/g, "")
 .replace(/\s+/g, "");
 const binary = atob(cleaned);
 const bytes = new Uint8Array(binary.length);
 for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
 return bytes;
}

async function signMapKitToken(): Promise<string> {
 if (!TEAM_ID || !KEY_ID || !PRIVATE_KEY_PEM) {
 throw new Error("missing_credentials");
 }

 const now = Math.floor(Date.now() / 1000);

 const header = { alg: "ES256", typ: "JWT", kid: KEY_ID };
 const payload = {
 iss: TEAM_ID,
 iat: now,
 exp: now + TOKEN_TTL_SECONDS,
 origin: ALLOWED_ORIGIN,
 };

 const headerB64 = base64urlEncodeJson(header);
 const payloadB64 = base64urlEncodeJson(payload);
 const signingInput = `${headerB64}.${payloadB64}`;

 // Import the P-256 private key (PKCS#8 PEM → CryptoKey).
 const keyData = pemToPkcs8Der(PRIVATE_KEY_PEM);
 const cryptoKey = await crypto.subtle.importKey(
 "pkcs8",
 keyData,
 { name: "ECDSA", namedCurve: "P-256" },
 false,
 ["sign"],
 );

 // Sign. WebCrypto's ECDSA output is raw r||s (64 bytes for P-256), which
 // is exactly what JWS ES256 expects. no DER unwrapping needed.
 const sigBuf = await crypto.subtle.sign(
 { name: "ECDSA", hash: "SHA-256" },
 cryptoKey,
 new TextEncoder().encode(signingInput),
 );
 const sigB64 = base64urlEncode(sigBuf);

 return `${signingInput}.${sigB64}`;
}

serve(async (req) => {
 if (req.method === "OPTIONS") {
 return new Response("ok", { headers: CORS });
 }
 if (req.method !== "GET") {
 return new Response("GET only", { status: 405, headers: CORS });
 }

 try {
 const token = await signMapKitToken();
 return new Response(token, {
 status: 200,
 headers: {
 ...CORS,
 "Content-Type": "text/plain",
 // Tokens are short-lived; let the browser cache for half the TTL
 // so a quick page refresh doesn't burn function quota.
 "Cache-Control": `public, max-age=${Math.floor(TOKEN_TTL_SECONDS / 2)}`,
 },
 });
 } catch (e: any) {
 console.error("[mapkit-token] sign failed", e?.message ?? e);
 if (e?.message === "missing_credentials") {
 return new Response(
 JSON.stringify({
 error: "MapKit credentials not configured",
 help: "Set MAPKIT_TEAM_ID, MAPKIT_KEY_ID, MAPKIT_PRIVATE_KEY via `supabase secrets set`.",
 }),
 { status: 503, headers: { ...CORS, "Content-Type": "application/json" } },
 );
 }
 return new Response(
 JSON.stringify({ error: e?.message ?? "unknown" }),
 { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
 );
 }
});
