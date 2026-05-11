import { CREDIT_PACKS } from "@/src/data/credits";
import { __setIapService, getIap, IapService, productIdForPack, resetIapToDemo } from "@/src/services/iap";

afterEach(() => {
  resetIapToDemo();
});

describe("IAP service (demo)", () => {
  it("default service is in demo mode", () => {
    expect(getIap().isDemo).toBe(true);
  });

  it("connect resolves ok:true", async () => {
    const result = await getIap().connect();
    expect(result.ok).toBe(true);
  });

  it("loadProducts returns one ProductInfo per requested ID", async () => {
    const ids = CREDIT_PACKS.map(productIdForPack);
    const products = await getIap().loadProducts(ids);
    expect(products).toHaveLength(ids.length);
    expect(products[0].productId).toBe("mailclub.credits.5");
    expect(products[0].priceFormatted).toBe("$4.99");
  });

  it("purchase resolves ok:true with a transaction id after connect", async () => {
    const iap = getIap();
    await iap.connect();
    const result = await iap.purchase("mailclub.credits.10");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.productId).toBe("mailclub.credits.10");
      expect(result.transactionId).toMatch(/^demo-/);
    }
  });

  it("purchase fails with unavailable reason before connect", async () => {
    // Reset to a fresh disconnected demo service
    resetIapToDemo();
    const result = await getIap().purchase("mailclub.credits.5");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unavailable");
    }
  });
});

describe("productIdForPack", () => {
  it("maps each pack credits count to the App Store Connect product ID", () => {
    expect(productIdForPack(CREDIT_PACKS[0])).toBe("mailclub.credits.5");
    expect(productIdForPack(CREDIT_PACKS[1])).toBe("mailclub.credits.10");
    expect(productIdForPack(CREDIT_PACKS[2])).toBe("mailclub.credits.25");
    expect(productIdForPack(CREDIT_PACKS[3])).toBe("mailclub.credits.50");
  });
});

describe("__setIapService (test seam)", () => {
  it("allows substituting a fake IAP service for failure cases", async () => {
    const fake: IapService = {
      isDemo: false,
      connect: jest.fn().mockResolvedValue({ ok: true }),
      disconnect: jest.fn().mockResolvedValue(undefined),
      loadProducts: jest.fn().mockResolvedValue([]),
      purchase: jest.fn().mockResolvedValue({ ok: false, reason: "cancelled" as const }),
      restorePurchases: jest.fn().mockResolvedValue({ ok: true }),
    };
    __setIapService(fake);
    const result = await getIap().purchase("anything");
    expect(result.ok).toBe(false);
    expect(fake.purchase).toHaveBeenCalledWith("anything");
  });
});
