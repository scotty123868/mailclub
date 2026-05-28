import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

/**
 * Supabase client wired up with AsyncStorage for session persistence.
 *
 * URL + anon key are PUBLIC. They live in app.json `extra` and are bundled
 * into every binary. RLS on the database is what actually protects user
 * data. never trust the anon key as a gate.
 */
const extra = (Constants.expoConfig?.extra ?? (Constants.manifest as any)?.extra ?? {}) as {
 supabaseUrl?: string;
 supabaseAnonKey?: string;
};

const SUPABASE_URL = extra.supabaseUrl ?? "";
const SUPABASE_ANON_KEY = extra.supabaseAnonKey ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
 // eslint-disable-next-line no-console
 console.warn("Supabase URL or anon key missing from app.json `extra`. The app will run, but all backend calls will fail.");
}

// v0.7.0.58 STALE-DATA FIX (revised): iOS NSURLSession was serving
// cached PostgREST responses because Supabase doesn't send any
// Cache-Control header, so NSURLSession applies heuristic freshness on
// its own. First attempt used `cache: "no-store"` in the fetch options,
// which is silently dropped by React Native's whatwg-fetch polyfill
// (RN's fetch is implemented on top of XMLHttpRequest, which doesn't
// support that option). So the stale data kept coming back.
//
// This revision uses TWO defenses NSURLSession actually honors:
// 1. Explicit Cache-Control + Pragma request headers. tells iOS to
// bypass URLCache for this specific request.
// 2. Cache-busting query string suffix. URLCache keys responses by
// URL, so making each URL unique guarantees we miss the cache even
// if some intermediary ignores the headers. PostgREST treats
// unknown query params as ignored (it does not interpret `_t` as a
// column filter unless we use the `_t=eq.X` operator syntax).
const noCacheFetch: typeof fetch = (input, init) => {
 const newInit: RequestInit = { ...(init ?? {}) };
 const newHeaders = new Headers(newInit.headers);
 // Tested: PostgREST returns 400 on unknown query params (`_t=NOW`
 // gets parsed as a column filter and fails). So we can't bust the
 // URLCache key by changing the URL. Headers are the only lever.
 // NSURLSession honors `Cache-Control: no-cache` on REQUESTS:
 // "treat as expired, revalidate with origin." Supabase doesn't send
 // ETag/Last-Modified, so iOS will always reload. exactly what we
 // want for live row state.
 newHeaders.set("Cache-Control", "no-cache, no-store, must-revalidate");
 newHeaders.set("Pragma", "no-cache");
 newInit.headers = newHeaders;
 return fetch(input, newInit);
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
 auth: {
 storage: AsyncStorage,
 autoRefreshToken: true,
 persistSession: true,
 detectSessionInUrl: false, // RN has no URL bar
 },
 global: {
 fetch: noCacheFetch,
 },
});

export const SUPABASE_CONFIGURED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
