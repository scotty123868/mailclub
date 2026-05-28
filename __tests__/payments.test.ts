import { CREDIT_PACKS } from "@/src/data/credits";
import * as stripeRN from "@stripe/stripe-react-native";
import { purchasePack, isStripeConfigured } from "@/src/services/payments";
import { supabase } from "@/src/services/supabase";

jest.mock("expo-constants", () => ({
 __esModule: true,
 default: {
 expoConfig: {
 extra: {
 supabaseUrl: "https://example.supabase.co",
 supabaseAnonKey: "anon",
 stripePublishableKey: "pk_test_dummy",
 },
 },
 },
}));

// Force SUPABASE_CONFIGURED true for this suite by re-mocking the module
jest.mock("@/src/services/supabase", () => ({
 supabase: {
 functions: {
 invoke: jest.fn(),
 },
 },
 SUPABASE_CONFIGURED: true,
}));

describe("payments service", () => {
 beforeEach(() => {
 jest.clearAllMocks();
 });

 it("isStripeConfigured returns true with a pk_test_ key", () => {
 expect(isStripeConfigured()).toBe(true);
 });

 it("purchasePack returns ok on a successful sheet flow", async () => {
 (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
 data: {
 paymentIntent: "pi_abc_secret_xyz",
 ephemeralKey: "ek_abc",
 customer: "cus_abc",
 publishableKey: "pk_test_dummy",
 },
 error: null,
 });
 (stripeRN.initPaymentSheet as jest.Mock).mockResolvedValueOnce({ error: undefined });
 (stripeRN.presentPaymentSheet as jest.Mock).mockResolvedValueOnce({ error: undefined });

 const result = await purchasePack(CREDIT_PACKS[0]);
 if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
 expect(result.creditsAdded).toBe(5);
 expect(result.paymentIntentId).toBe("pi_abc");
 });

 it("purchasePack returns cancelled when the user dismisses the sheet", async () => {
 (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
 data: {
 paymentIntent: "pi_abc_secret_xyz",
 ephemeralKey: "ek_abc",
 customer: "cus_abc",
 publishableKey: "pk_test_dummy",
 },
 error: null,
 });
 (stripeRN.initPaymentSheet as jest.Mock).mockResolvedValueOnce({ error: undefined });
 (stripeRN.presentPaymentSheet as jest.Mock).mockResolvedValueOnce({
 error: { code: "Canceled", message: "User canceled" },
 });

 const result = await purchasePack(CREDIT_PACKS[1]);
 if (result.ok) throw new Error("expected cancelled, got ok");
 expect(result.reason).toBe("cancelled");
 });

 it("purchasePack returns network error when create-payment-intent fails", async () => {
 (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
 data: null,
 error: { message: "boom" },
 });
 // With only 2 packs (p5, p25), cycle index 0 for this third test.
 const result = await purchasePack(CREDIT_PACKS[0]);
 if (result.ok) throw new Error("expected failure");
 expect(result.reason).toBe("network");
 });

 it("purchasePack returns declined when the sheet errors with a non-cancel code", async () => {
 (supabase.functions.invoke as jest.Mock).mockResolvedValueOnce({
 data: {
 paymentIntent: "pi_abc_secret_xyz",
 ephemeralKey: "ek_abc",
 customer: "cus_abc",
 publishableKey: "pk_test_dummy",
 },
 error: null,
 });
 (stripeRN.initPaymentSheet as jest.Mock).mockResolvedValueOnce({ error: undefined });
 (stripeRN.presentPaymentSheet as jest.Mock).mockResolvedValueOnce({
 error: { code: "Failed", message: "Your card was declined." },
 });

 const result = await purchasePack(CREDIT_PACKS[1]);
 if (result.ok) throw new Error("expected failure");
 expect(result.reason).toBe("declined");
 });
});
