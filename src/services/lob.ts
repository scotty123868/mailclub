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
async function captureViewToFile(viewRef: any, _filename: string): Promise<string> {
  // v0.7.0.20: changed result from "tmpfile" to "base64".
  //
  // Why: react-native-view-shot's tmpfile mode writes a real PNG to
  // /private/var/.../tmp/ReactNative/xxx.png. But on iOS, RN's
  // fetch(file://...).blob() returns a *zero-byte* blob silently — the
  // upload succeeds, the bucket row appears with size_bytes=0, and Lob
  // rejects with "front file must be a valid PDF, JPEG, PNG, or HTML file"
  // because it fetches the public URL and gets an empty body. We
  // confirmed this by querying storage.objects: every recent upload
  // had size_bytes=0.
  //
  // base64 mode returns the actual PNG bytes as a base64 string. We
  // prefix with the data: scheme so fetch() handles it as a data-URI
  // (which works correctly in RN, unlike file://). The downstream
  // uploadSide code path is otherwise unchanged.
  const base64 = await captureRef(viewRef, {
    format: "png",
    quality: 1,
    width: LOB_RENDER_WIDTH,
    height: Math.round(LOB_RENDER_WIDTH / LOB_ASPECT_W_OVER_H),
    result: "base64",
  });
  return `data:image/png;base64,${base64}`;
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
  if (uri.startsWith("data:")) {
    const commaIdx = uri.indexOf(",");
    const b64 = commaIdx >= 0 ? uri.slice(commaIdx + 1) : uri;
    bytes = base64ToBytes(b64);
    if (bytes.length === 0) {
      throw new Error("Decoded PNG is empty — view-shot returned no data.");
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
      contentType: "image/png",
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
  return { width: LOB_RENDER_WIDTH, height: Math.round(LOB_RENDER_WIDTH / LOB_ASPECT_W_OVER_H) };
}
