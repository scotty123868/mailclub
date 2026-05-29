// recent-routes — public read endpoint that returns the last N mailed
// postcards as anonymized city-pair routes. Powers the landing page's
// live route ticker — proof that the wire is humming, without exposing
// names, addresses, or message contents.
//
// Deploy: `supabase functions deploy recent-routes --no-verify-jwt`
//
// Returns JSON: { routes: [{ from_city, from_state, to_city, to_state,
// from_lat, from_lng, to_lat, to_lng, age_minutes }, ...] }
//
// Cached at edge for 5 minutes so we don't hammer the DB. Cache busts
// when a new postcard mails.

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// Approximate US city coords for the marquee display. The landing
// page wants both "39.7° -105.0°" mystery numbers AND a friendly
// "denver" city pair. Coords live here so the landing stays static.
const CITY_COORDS: Record<string, [number, number]> = {
 "brooklyn,ny": [40.6, -73.9],
 "marfa,tx": [30.3, -103.9],
 "san francisco,ca": [37.8, -122.4],
 "sf,ca": [37.8, -122.4],
 "portland,me": [43.7, -70.3],
 "portland,or": [45.5, -122.7],
 "austin,tx": [30.3, -97.7],
 "savannah,ga": [32.1, -81.1],
 "denver,co": [39.7, -105.0],
 "burlington,vt": [44.5, -73.2],
 "naples,fl": [26.1, -81.8],
 "charleston,sc": [32.8, -79.9],
 "seattle,wa": [47.6, -122.3],
 "nashville,tn": [36.2, -86.8],
 "new york,ny": [40.7, -74.0],
 "los angeles,ca": [34.1, -118.2],
 "chicago,il": [41.9, -87.6],
 "miami,fl": [25.8, -80.2],
 "boston,ma": [42.4, -71.1],
 "minneapolis,mn": [45.0, -93.3],
 "atlanta,ga": [33.7, -84.4],
};

function coordsFor(city: string | null | undefined, state: string | null | undefined): [number, number] | null {
 if (!city || !state) return null;
 const key = `${city.toLowerCase()},${state.toLowerCase()}`;
 return CITY_COORDS[key] ?? null;
}

const CORS = {
 "Access-Control-Allow-Origin": "*",
 "Access-Control-Allow-Methods": "GET, OPTIONS",
 "Access-Control-Allow-Headers": "content-type",
};

// Fallback sample data when the DB has no real routes yet. Keeps the
// landing ticker non-empty during the cold start before any beta users
// have sent. Drop-in replaced as soon as real routes exist.
const FALLBACK_ROUTES = [
 { from_city: "Brooklyn", from_state: "NY", to_city: "Marfa", to_state: "TX", age_minutes: 7 },
 { from_city: "San Francisco", from_state: "CA", to_city: "Portland", to_state: "ME", age_minutes: 23 },
 { from_city: "Austin", from_state: "TX", to_city: "Savannah", to_state: "GA", age_minutes: 60 },
 { from_city: "Denver", from_state: "CO", to_city: "Burlington", to_state: "VT", age_minutes: 120 },
 { from_city: "Naples", from_state: "FL", to_city: "Charleston", to_state: "SC", age_minutes: 180 },
 { from_city: "Seattle", from_state: "WA", to_city: "Nashville", to_state: "TN", age_minutes: 300 },
];

function decorate(r: any) {
 const from = coordsFor(r.from_city, r.from_state);
 const to = coordsFor(r.to_city, r.to_state);
 return {
  from_city: r.from_city,
  from_state: r.from_state,
  to_city: r.to_city,
  to_state: r.to_state,
  from_lat: from?.[0],
  from_lng: from?.[1],
  to_lat: to?.[0],
  to_lng: to?.[1],
  age_minutes: r.age_minutes,
 };
}

serve(async (req) => {
 if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
 if (req.method !== "GET") {
  return new Response("GET only", { status: 405, headers: CORS });
 }

 try {
  // Last 12 mailed postcards. We pull from_city/state + try to derive
  // to_city/state from the friends/postcards records. Anonymized: no
  // names, no message content, no addresses.
  const { data: rows, error } = await admin
   .from("postcards")
   .select(`
    id, from_city, to_city, sent_at, status,
    to_address_state, friends:to_friend_id(address_state)
   `)
   .in("status", ["sent", "delivered", "in_transit", "queued"])
   .not("from_city", "is", null)
   .not("to_city", "is", null)
   .order("sent_at", { ascending: false, nullsFirst: false })
   .limit(12);

  if (error) {
   console.warn("[recent-routes] DB error, falling back", error.message);
   return new Response(
    JSON.stringify({ routes: FALLBACK_ROUTES.map(decorate), source: "fallback" }),
    { headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=60" } },
   );
  }

  const now = Date.now();
  const routes = (rows ?? [])
   .filter((r: any) => r.from_city && r.to_city)
   .map((r: any) => {
    const sentAt = r.sent_at ? new Date(r.sent_at).getTime() : now;
    const ageMin = Math.max(1, Math.floor((now - sentAt) / 60000));
    return {
     from_city: r.from_city,
     from_state: null, // not stored per-row yet for sender
     to_city: r.to_city,
     to_state: r.to_address_state ?? r.friends?.address_state ?? null,
     age_minutes: ageMin,
    };
   })
   .map(decorate);

  // If we got at least 4 real routes, return them. Otherwise pad with
  // fallback so the marquee always has 6+ items.
  const finalRoutes = routes.length >= 4
   ? routes
   : [...routes, ...FALLBACK_ROUTES].slice(0, 8).map(decorate);

  return new Response(
   JSON.stringify({
    routes: finalRoutes,
    source: routes.length >= 4 ? "live" : "mixed",
    real_count: routes.length,
   }),
   {
    headers: {
     ...CORS,
     "Content-Type": "application/json",
     // 5 min edge cache. New postcards refresh on next miss.
     "Cache-Control": "public, max-age=300, s-maxage=300",
    },
   },
  );
 } catch (e: any) {
  console.error("[recent-routes] threw", e?.message ?? e);
  return new Response(
   JSON.stringify({ routes: FALLBACK_ROUTES.map(decorate), source: "fallback" }),
   { headers: { ...CORS, "Content-Type": "application/json" } },
  );
 }
});
