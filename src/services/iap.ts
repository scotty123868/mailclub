/**
 * In-App Purchase service interface.
 *
 * v0.3 ships a DEMO implementation that grants credits locally. The real
 * StoreKit integration (next release) will:
 *
 *   1. Call `connect()` on app launch.
 *   2. Call `loadProducts(productIds)` with App Store Connect product IDs that
 *      match `CREDIT_PACKS` in src/data/credits.ts (mailclub.credits.5,
 *      mailclub.credits.10, mailclub.credits.25, mailclub.credits.50).
 *   3. On a tapped pack, call `purchase(productId)` which prompts StoreKit.
 *   4. On success, validate the receipt server-side, then call
 *      `useMailClub().purchaseCredits(packId)` from the context to grant the
 *      credits locally.
 *
 * The interface is shaped to be swappable with `react-native-iap` or
 * `expo-in-app-purchases` (when re-released) without changing call sites.
 *
 * App Store Connect setup checklist (Phase 8, not v0.3):
 *   - Create 4 consumable products with IDs above
 *   - Match prices: $4.99 / $9.99 / $24.99 / $49.99 (Apple price tiers don't
 *     allow exact $5/$10/$25/$50 — closest tier shown in UI as approximate)
 *   - Banking + tax setup must be complete before products go live
 *   - Submit products for review alongside the app build
 */

import type { CreditPack } from "@/src/data/credits";

export type ProductInfo = {
  productId: string;
  priceFormatted: string; // e.g. "$4.99"
  priceUsd: number;
};

export type PurchaseOutcome =
  | { ok: true; productId: string; transactionId: string }
  | { ok: false; reason: "cancelled" | "pending" | "network" | "unavailable"; message?: string };

export interface IapService {
  /** Initialize the IAP connection. Idempotent. */
  connect(): Promise<{ ok: boolean }>;
  /** Disconnect cleanly. Call on app teardown. */
  disconnect(): Promise<void>;
  /** Fetch product metadata from the App Store. */
  loadProducts(productIds: string[]): Promise<ProductInfo[]>;
  /** Initiate purchase. Resolves after the user closes the StoreKit sheet. */
  purchase(productId: string): Promise<PurchaseOutcome>;
  /** Restore non-consumable purchases. (No-op for our consumable credit packs.) */
  restorePurchases(): Promise<{ ok: boolean }>;
  /** True if running in a sandbox/dev/non-IAP context. */
  isDemo: boolean;
}

/**
 * Demo implementation used in v0.3. Logs intent and returns deterministic OK
 * responses; the actual credit grant happens in `MailClubContext.purchaseCredits`.
 */
class DemoIapService implements IapService {
  isDemo = true;
  private connected = false;

  async connect() {
    this.connected = true;
    return { ok: true };
  }

  async disconnect() {
    this.connected = false;
  }

  async loadProducts(productIds: string[]): Promise<ProductInfo[]> {
    return productIds.map((id) => ({
      productId: id,
      priceFormatted: priceFromId(id),
      priceUsd: priceUsdFromId(id),
    }));
  }

  async purchase(productId: string): Promise<PurchaseOutcome> {
    if (!this.connected) {
      return { ok: false, reason: "unavailable", message: "IAP not connected" };
    }
    return {
      ok: true,
      productId,
      transactionId: `demo-${Date.now()}`,
    };
  }

  async restorePurchases() {
    return { ok: true };
  }
}

function priceFromId(id: string): string {
  const map: Record<string, string> = {
    "mailclub.credits.5": "$4.99",
    "mailclub.credits.10": "$9.99",
    "mailclub.credits.25": "$24.99",
    "mailclub.credits.50": "$49.99",
  };
  return map[id] ?? "—";
}

function priceUsdFromId(id: string): number {
  const map: Record<string, number> = {
    "mailclub.credits.5": 4.99,
    "mailclub.credits.10": 9.99,
    "mailclub.credits.25": 24.99,
    "mailclub.credits.50": 49.99,
  };
  return map[id] ?? 0;
}

export function productIdForPack(pack: CreditPack): string {
  return `mailclub.credits.${pack.credits}`;
}

let _service: IapService = new DemoIapService();

export function getIap(): IapService {
  return _service;
}

/** Test seam: swap the active service. Production code shouldn't call this. */
export function __setIapService(s: IapService) {
  _service = s;
}

export function resetIapToDemo() {
  _service = new DemoIapService();
}
