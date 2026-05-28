import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { supabase, SUPABASE_CONFIGURED } from "./supabase";

/**
 * Sign in with Apple. Apple's native auth sheet on iOS, then exchange the
 * returned identity token for a Supabase session.
 *
 * Required infrastructure (see AUTH_FLOW_PLAN.md for exact steps):
 * 1. Apple Developer Console:
 * - App ID `com.mailroom.app` has "Sign in with Apple" capability ✓
 * - Services ID `com.mailroom.app.auth` created
 * - Sign in with Apple Key (.p8) downloaded
 * 2. Supabase Dashboard → Auth → Providers → Apple → enable with:
 * - Services ID, Team ID, Key ID, paste .p8 contents
 * 3. `app.json`:
 * - `"ios.usesAppleSignIn": true` ✓ (already set)
 *
 * The user taps the Apple button → Apple's sheet appears → they authorize
 * with Face ID → Apple gives us an identityToken (JWT) → we hand that to
 * Supabase via signInWithIdToken → Supabase verifies the token against the
 * configured Apple credentials and issues a session.
 */

export type AppleAuthResult =
 | {
 ok: true;
 email: string | null;
 fullName: string | null;
 isNewUser: boolean;
 }
 | { ok: false; error: string; cancelled: boolean };

/**
 * Check whether Sign in with Apple is available on this device.
 * iOS 13+ on real device, iOS 17+ on simulator (with iCloud signed in).
 */
export async function isAppleSignInAvailable(): Promise<boolean> {
 if (Platform.OS !== "ios") return false;
 try {
 return await AppleAuthentication.isAvailableAsync();
 } catch {
 return false;
 }
}

/**
 * Trigger the Apple sign-in sheet and exchange for a Supabase session.
 *
 * After a successful return:
 * - The user has a Supabase session. subsequent supabase calls use it.
 * - If `isNewUser` is true, the caller should advance to the identity
 * step in WelcomeSheet to collect display name + city. Apple only
 * returns the user's name on FIRST sign-in, so prefill from that.
 */
export async function signInWithApple(): Promise<AppleAuthResult> {
 if (!SUPABASE_CONFIGURED) {
 return {
 ok: false,
 error: "Supabase not configured. Apple sign-in needs a backend.",
 cancelled: false,
 };
 }

 let credential: AppleAuthentication.AppleAuthenticationCredential;
 try {
 credential = await AppleAuthentication.signInAsync({
 requestedScopes: [
 AppleAuthentication.AppleAuthenticationScope.EMAIL,
 AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
 ],
 });
 } catch (e: any) {
 const code = e?.code;
 if (code === "ERR_REQUEST_CANCELED") {
 return { ok: false, error: "cancelled", cancelled: true };
 }
 return { ok: false, error: e?.message ?? "Apple sign-in failed", cancelled: false };
 }

 if (!credential.identityToken) {
 return { ok: false, error: "Apple did not return an identity token.", cancelled: false };
 }

 const { data, error } = await supabase.auth.signInWithIdToken({
 provider: "apple",
 token: credential.identityToken,
 });

 if (error) {
 return { ok: false, error: error.message, cancelled: false };
 }

 // Apple returns the user's name ONLY on the first sign-in. Persist it.
 const fullName = credential.fullName
 ? [credential.fullName.givenName, credential.fullName.familyName]
 .filter(Boolean)
 .join(" ")
 .trim() || null
 : null;
 const email = credential.email ?? data.user?.email ?? null;

 // Detect new vs returning user. if profile row has a name already we're returning
 const userId = data.user?.id;
 let isNewUser = false;
 if (userId) {
 const { data: profile } = await supabase
 .from("profiles")
 .select("name")
 .eq("id", userId)
 .maybeSingle();
 isNewUser = !profile?.name;

 // If brand new + Apple gave us a name, seed the profile row immediately
 if (isNewUser && fullName) {
 await supabase
 .from("profiles")
 .update({ name: fullName })
 .eq("id", userId);
 }
 }

 return { ok: true, email, fullName, isNewUser };
}
