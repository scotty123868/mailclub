import AsyncStorage from "@react-native-async-storage/async-storage";
import { AddressDraft, isAddressComplete } from "@/src/types/address";

/**
 * Self-address — the user's own mailing address, used when they pick
 * "Yourself" on the Send → Recipient step.
 *
 * Stored on-device (AsyncStorage) so the Send flow can detect first-time
 * vs. returning self-sender and skip the address step on every send after
 * the first. The user fills the address in once; from then on it's reused
 * silently. Editable from Settings (My Card → Address) once the settings
 * surface ships (queued for build 39).
 *
 * Why on-device instead of profiles row: the profiles schema today has
 * only city/state. Adding line1/zip would require a migration + RPC
 * updates + RLS audit. AsyncStorage lets us ship the right UX now and
 * promote to server storage in a later build without changing the API
 * shape send.tsx consumes.
 *
 * Namespaced `mailroom.selfAddress.v1` so a future schema change can
 * coexist with a .v2 without colliding.
 */

const KEY = "mailroom.selfAddress.v1";

export async function getSelfAddress(): Promise<AddressDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AddressDraft;
    // Basic shape guard — bail if storage was corrupted or written by a
    // pre-v1 schema. The caller will treat null as "no address yet".
    if (!parsed || typeof parsed.line1 !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Returns true if the device has a complete (deliverable) self-address
 * cached. Send screen uses this to skip the self-address step entirely
 * on repeat sends.
 */
export async function hasCompleteSelfAddress(): Promise<boolean> {
  const a = await getSelfAddress();
  return !!a && isAddressComplete(a);
}

export async function setSelfAddress(addr: AddressDraft): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(addr));
  } catch (e) {
    // Non-fatal: worst case the user gets asked again next send.
    // eslint-disable-next-line no-console
    console.warn("setSelfAddress failed:", e);
  }
}

export async function clearSelfAddress(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
