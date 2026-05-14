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

const LOB_RENDER_WIDTH = 1875; // px — 6.25" × 300 DPI (includes 1/8" bleed)

/**
 * Capture a React Native View ref to a PNG file on disk.
 *
 * `viewRef` must point to a View rendered at the desired output dimensions —
 * not the on-screen preview at ~300px wide. Use the off-screen 1875×1250
 * <ViewShot> wrapper for that. See `captureForPrint` for the orchestration.
 */
async function captureViewToFile(viewRef: any, filename: string): Promise<string> {
  const localUri = await captureRef(viewRef, {
    format: "png",
    quality: 1,
    width: LOB_RENDER_WIDTH,
    // Aspect-ratio: 1.5:1 landscape → height proportionally
    height: Math.round(LOB_RENDER_WIDTH / 1.5),
    result: "tmpfile",
    fileName: filename,
  });
  return localUri;
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
  const ts = Date.now();
  const [frontUri, backUri] = await Promise.all([
    captureViewToFile(frontRef, `front-${ts}.png`),
    captureViewToFile(backRef, `back-${ts}.png`),
  ]);
  return { frontUri, backUri };
}

/**
 * Upload a single side to the `postcard-renders` Storage bucket and return
 * its public URL.
 */
async function uploadSide(localUri: string, path: string): Promise<string> {
  // v0.7.0.18: iOS view-shot's tmpfile mode sometimes returns a bare
  // /private/var/... path with no file:// scheme. RN's fetch() throws
  // "Invalid URL: /private/var/..." in that case, which surfaced as the
  // raw error on the welcome flow's "Mail it" step. Normalize the URI
  // here so the rest of the upload pipeline can stay scheme-agnostic.
  const safeUri = localUri.startsWith("file://")
    ? localUri
    : localUri.startsWith("/")
      ? `file://${localUri}`
      : localUri;
  const fetched = await fetch(safeUri);
  if (!fetched.ok) throw new Error(`Could not read local file ${safeUri}`);
  const blob = await fetched.blob();

  const { error } = await supabase.storage
    .from("postcard-renders")
    .upload(path, blob, {
      upsert: true,
      contentType: "image/png",
    });
  if (error) throw error;

  const { data } = supabase.storage.from("postcard-renders").getPublicUrl(path);
  return data.publicUrl;
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
    const frontPath = `${userId}/${input.postcardId}/front.png`;
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
  return { width: LOB_RENDER_WIDTH, height: Math.round(LOB_RENDER_WIDTH / 1.5) };
}
