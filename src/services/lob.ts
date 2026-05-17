import { captureRef } from "react-native-view-shot";
import { supabase, SUPABASE_CONFIGURED } from "./supabase";

/**
 * Lob handoff — captures the user's postcard preview (front + back), uploads
 * both sides to Supabase Storage, and asks a Supabase Edge Function to POST
 * the public URLs to Lob's Postcards API.
 *
 * Why not call Lob directly from the device?
 *   • Lob's secret key would have to live in the app bundle. Extractable in
 *     2 minutes by anyone with macOS.
 *   • The Edge Function path keeps secrets server-side, lets us retry on
 *     failure, and webhook updates flow into the same place.
 *
 * Sized for Lob's 4×6 postcards: 1875 × 1275 px at 300 DPI.
 */

// v0.7.0.20: Lob's 4×6 postcard is actually 4.25" × 6.25" with bleed.
// width × DPI = 6.25" × 300 = 1875.
const LOB_RENDER_WIDTH = 1875;
// Aspect ratio = width / height = 6.25 / 4.25 = ~1.4706. The PREVIOUS
// constant used 1.5, which is what a true 4×6 postcard would be without
// bleed. Lob explicitly rejects anything that isn't ~4.25:6.25 height:width,
// so even being 0.03 off the ratio (1.5 vs 1.4706) trips their validator
// after the bytes finally reach them (build 30+ pipeline).
const LOB_ASPECT_W_OVER_H = 6.25 / 4.25;

/**
 * Capture a React Native View ref to a PNG file on disk.
 *
 * `viewRef` must point to a View rendered at the desired output dimensions —
 * not the on-screen preview at ~300px wide. Use the off-screen 1875×1250
 * <ViewShot> wrapper for that. See `captureForPrint` for the orchestration.
 */
// v0.7.0.21: per-side format choice. JPEG for the front (photo —
// invisible quality loss at q=0.92, ~5-8x smaller than PNG), PNG for
// the back (text + QR + dividers — JPEG would create halos around
// letters and could break QR scannability). Cuts the total upload
// from ~6 MB to ~3.5 MB; Lob's image fetch is ~40% faster end-to-end,
// pulling the round-trip well under iOS/Supabase's timeout window.
async function captureViewToFile(
  viewRef: any,
  format: "png" | "jpg",
  quality: number,
): Promise<string> {
  const base64 = await captureRef(viewRef, {
    format,
    quality,
    width: LOB_RENDER_WIDTH,
    height: Math.round(LOB_RENDER_WIDTH / LOB_ASPECT_W_OVER_H),
    result: "base64",
  });
  const mime = format === "jpg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${base64}`;
}

export type CapturedPostcard = {
  frontUri: string; // local file://
  backUri: string;
};

/**
 * Capture both sides of the postcard preview to local PNG files.
 *
 * The frontRef + backRef are React refs from off-screen <PostcardFrontPreview>
 * + <PostcardBackPreview> mounted at print scale (1875px wide).
 */
export async function capturePostcardForPrint(
  frontRef: any,
  backRef: any,
): Promise<CapturedPostcard> {
  // v0.7.0.22 — serialize the captures. The previous code used
  // Promise.all to capture front + back in parallel, but
  // react-native-view-shot's iOS implementation shares internal state
  // across captureRef calls and parallel invocations confuse it. The
  // visible symptom: the second capture (back) returned the actual
  // postcard back, but the first capture (front) returned a screenshot
  // of the user's current screen (the welcome form). Verified by
  // pulling the stored front.png from Supabase Storage — it was the
  // "From you" form with the error message visible, not the photo.
  //
  // Sequential captures fix it. ~50ms slower (still under a second
  // total) — worth it for actually capturing the right view.
  const frontUri = await captureViewToFile(frontRef, "jpg", 0.92);
  // Brief settle so iOS's CALayer animations / view-shot's internal
  // context reset cleanly between calls. Without this the second
  // capture sometimes inherits state from the first on slower devices.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const backUri = await captureViewToFile(backRef, "png", 1);
  return { frontUri, backUri };
}

/**
 * Upload a single side to the `postcard-renders` Storage bucket and return
 * its public URL.
 */
async function uploadSide(uri: string, path: string): Promise<string> {
  // v0.7.0.20: uri is now a data: URI from captureViewToFile (base64-encoded
  // PNG). Decode it directly to a Uint8Array instead of going through
  // fetch().blob() — that path returns zero bytes on iOS for file:// URIs
  // (see captureViewToFile for the full story) and probably has issues for
  // data: URIs too in some RN versions.
  //
  // Fall back to fetch() for backward-compat in case any caller still
  // passes a file:// URI (e.g. tests, send.tsx hasn't been updated yet).
  let bytes: Uint8Array | Blob;
  // v0.7.0.21: parse the actual mime from the data: URI so we upload
  // with the right Content-Type. Previously hardcoded image/png, which
  // would mislabel JPEGs and break Lob's content sniffing.
  let contentType = "image/png";
  if (uri.startsWith("data:")) {
    const commaIdx = uri.indexOf(",");
    const header = commaIdx >= 0 ? uri.slice(5, commaIdx) : "";
    if (header.startsWith("image/jpeg")) contentType = "image/jpeg";
    else if (header.startsWith("image/png")) contentType = "image/png";
    const b64 = commaIdx >= 0 ? uri.slice(commaIdx + 1) : uri;
    bytes = base64ToBytes(b64);
    if (bytes.length === 0) {
      throw new Error("Decoded image is empty — view-shot returned no data.");
    }
  } else {
    const safeUri = uri.startsWith("file://")
      ? uri
      : uri.startsWith("/")
        ? `file://${uri}`
        : uri;
    const fetched = await fetch(safeUri);
    if (!fetched.ok) throw new Error(`Could not read local file ${safeUri}`);
    bytes = await fetched.blob();
  }

  const { error } = await supabase.storage
    .from("postcard-renders")
    .upload(path, bytes, {
      upsert: true,
      contentType,
    });
  if (error) throw error;

  const { data } = supabase.storage.from("postcard-renders").getPublicUrl(path);
  return data.publicUrl;
}

/** Pure-JS base64 → Uint8Array. Uses atob (available in RN via Hermes
 *  and JavaScriptCore). No new dependencies needed. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type LobSubmitInput = {
  postcardId: string;
  frontUri: string; // local file://
  backUri: string;
};

export type LobSubmitResult =
  | { ok: true; lobId: string; expectedDelivery?: string; frontUrl: string; backUrl: string }
  | { ok: false; error: string };

/**
 * Top-level: upload both sides + invoke the Edge Function to forward to Lob.
 *
 * Returns the Lob postcard ID + expected delivery date when successful, so
 * the calling action can persist them on the `postcards` row.
 */
export async function submitToLob(input: LobSubmitInput): Promise<LobSubmitResult> {
  if (!SUPABASE_CONFIGURED) {
    return { ok: false, error: "Supabase not configured — capture + upload skipped." };
  }

  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) {
    return { ok: false, error: "Not signed in." };
  }

  try {
    // v0.7.0.21: front is JPEG (smaller, fast Lob fetch), back is PNG
    // (lossless for handwriting + QR). Path extensions match so anyone
    // browsing the bucket sees the right format at a glance.
    const frontPath = `${userId}/${input.postcardId}/front.jpg`;
    const backPath = `${userId}/${input.postcardId}/back.png`;
    const [frontUrl, backUrl] = await Promise.all([
      uploadSide(input.frontUri, frontPath),
      uploadSide(input.backUri, backPath),
    ]);

    // Call the Edge Function with the URLs
    const { data, error } = await supabase.functions.invoke("lob-send-postcard", {
      body: {
        postcard_id: input.postcardId,
        front_url: frontUrl,
        back_url: backUrl,
      },
    });
    if (error) return { ok: false, error: error.message };
    if (!data || !data.ok) {
      return { ok: false, error: (data && data.error) || "Edge function reported failure." };
    }
    return {
      ok: true,
      lobId: data.lob_id,
      expectedDelivery: data.expected_delivery_date,
      // v0.7.0.10: expose the Storage URLs so callers can persist the
      // FRONT png URL onto postcards.photo_path. The local file:// URI
      // from ImagePicker is volatile (iOS tmp cleanup), so the journal
      // tile was rendering blank. Using the rendered front gives us a
      // persistent thumbnail that survives app restarts + device sync.
      frontUrl,
      backUrl,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Unknown error" };
  }
}

/**
 * Helper used by the off-screen capture wrapper to know what width to render
 * the preview components at. Exposed so tests + other callers stay in sync.
 */
export function lobRenderDimensions() {
  return { width: LOB_RENDER_WIDTH, height: Math.round(LOB_RENDER_WIDTH / LOB_ASPECT_W_OVER_H) };
}

/**
 * Map a raw Lob/network error message into a user-facing string.
 *
 * v0.7.0.32 codex P1.5: extracted from WelcomeSheet.tsx so both the
 * welcome-flow path AND the in-app Send path use the same translation.
 * Previously the in-app Send caught Lob failures with console.warn only,
 * leaving the user with a missing credit and a card that never printed.
 */
export function humanizeLobError(raw: string | undefined): string {
  if (!raw) return "Couldn't print your card. Tap Mail it again — we'll retry.";
  const lower = raw.toLowerCase();
  if (lower.includes("deliverability strictness") || lower.includes("undeliverable")) {
    return "USPS couldn't verify that address. Double-check the street number, ZIP, and apt/suite — even one digit off and we can't ship.";
  }
  if (lower.includes("address") && (lower.includes("invalid") || lower.includes("not found"))) {
    return "That address didn't validate. Double-check the street number, city, and ZIP.";
  }
  if (lower.includes("network") || lower.includes("fetch")) {
    return "Couldn't reach our print service. Check your connection and tap Mail it again.";
  }
  // Fallback: surface the raw error so we can debug from the user's screen.
  return `Couldn't print your card: ${raw}`;
}
