import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Pending invite. survives the sign-up boundary.
 *
 * When a brand-new user scans a Mailroom QR code, the welcome-mail screen
 * loads their token but they aren't signed in yet. We stash the token here
 * BEFORE routing them through onboarding. After `completeSignup` succeeds,
 * the MailClub context consumes the token by calling the reciprocation
 * scan RPC, which adds the sender to the receiver's rolodex and inserts
 * the postcard into their received map.
 *
 * TTL = 30 days. Beyond that the token is probably stale, the receiver
 * has moved on, or they're not signing up after all. Short enough to keep
 * the stash from rotting, long enough that someone can scan, install, set
 * up Apple Sign In, and reach the consume step without losing state.
 *
 * Storage key is namespaced (`mailroom.pendingInvite.v1`) so future schema
 * changes (e.g. multiple pending tokens, or token + recipient_name) can
 * coexist with a `.v2`. Reading `.v1` after a schema bump just returns
 * null and the old token gets dropped. acceptable for a v1 → v2 jump
 * given how rare this lifecycle event is.
 */

const KEY = "mailroom.pendingInvite.v1";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type PendingInvite = {
 token: string;
 storedAt: number; // epoch ms, used for TTL check
};

/**
 * Stash a token from a QR scan. Idempotent. overwrites whatever was
 * there. We only ever track ONE pending invite at a time; multiple QR
 * scans before sign-up just keep the most recent one. Rationale: a fresh
 * user scanning two cards from two different senders in a row most likely
 * cares about the latest one. If both senders should be added, the user
 * can scan the older card again post-signup.
 */
export async function setPendingInvite(token: string): Promise<void> {
 const payload: PendingInvite = { token, storedAt: Date.now() };
 try {
 await AsyncStorage.setItem(KEY, JSON.stringify(payload));
 } catch (e) {
 // AsyncStorage failures here are not fatal. the receiver flow still
 // works for signed-in users. Worst case: a fresh user has to scan
 // again after sign-up.
 // eslint-disable-next-line no-console
 console.warn("setPendingInvite failed:", e);
 }
}

/**
 * Read the current pending invite without consuming it. Used by the
 * WelcomeSheet to acknowledge "you have a card waiting" copy at the top
 * of the sign-up flow. Returns null if missing, malformed, or expired.
 */
export async function peekPendingInvite(): Promise<PendingInvite | null> {
 try {
 const raw = await AsyncStorage.getItem(KEY);
 if (!raw) return null;
 const parsed = JSON.parse(raw) as PendingInvite;
 if (typeof parsed?.token !== "string" || typeof parsed?.storedAt !== "number") {
 // Malformed. treat as missing.
 await AsyncStorage.removeItem(KEY);
 return null;
 }
 if (Date.now() - parsed.storedAt > TTL_MS) {
 // Expired. drop and report none.
 await AsyncStorage.removeItem(KEY);
 return null;
 }
 return parsed;
 } catch (e) {
 return null;
 }
}

/**
 * Take and remove the pending invite atomically. Call this exactly once
 * per consume attempt. the MailClub context invokes it right after
 * `completeSignup` succeeds, then forwards the token to the reciprocation
 * scan RPC.
 *
 * Remove-then-return order matters: if the app crashes between the read
 * and the remove, the next launch will re-consume and re-attempt the
 * scan. The server-side RPC is idempotent (first scan wins, same-user
 * subsequent scans return the existing friend_id), so double-fires are
 * harmless. Removing AFTER the RPC would be wrong because the RPC could
 * fail for a transient reason and we'd lose the token.
 */
export async function consumePendingInvite(): Promise<string | null> {
 try {
 const raw = await AsyncStorage.getItem(KEY);
 await AsyncStorage.removeItem(KEY);
 if (!raw) return null;
 const parsed = JSON.parse(raw) as PendingInvite;
 if (typeof parsed?.token !== "string" || typeof parsed?.storedAt !== "number") {
 return null;
 }
 if (Date.now() - parsed.storedAt > TTL_MS) {
 return null;
 }
 return parsed.token;
 } catch (e) {
 return null;
 }
}

/**
 * Clear without returning the token. Used by Settings → Sign Out so the
 * pending invite doesn't carry across user identities. Also: if the user
 * deliberately dismisses the welcome-mail screen, we drop the pending
 * stash so the next sign-up isn't haunted by a card they ignored.
 */
export async function clearPendingInvite(): Promise<void> {
 try {
 await AsyncStorage.removeItem(KEY);
 } catch (e) {
 // ignore
 }
}
