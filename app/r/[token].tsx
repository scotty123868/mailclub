import WelcomeMailScreen from "@/app/welcome-mail/[token]";

/**
 * /r/[token] — Universal-Link short URL for QR-scanned postcards.
 *
 * The QR on the back of every Mailroom-printed postcard encodes a URL like
 * https://mailroom.app/r/<token>. iOS Universal Links (when the AASA file
 * is hosted on the user's domain) open the app directly at this path. Without
 * Universal Links, the same path hits the welcome-mail Supabase Edge
 * Function HTML, which then tries `mailroom://` to open an installed app.
 *
 * This route exists so Expo Router has a matching file for `/r/<token>`.
 * The implementation is the welcome-mail screen — same component, different
 * URL. (codex P2, Phase 3 review: AASA maps `/r/*` but the original screen
 * lived only at `/welcome-mail/[token]`; iOS doesn't rewrite paths, so we
 * needed a literal `app/r/[token].tsx` file.)
 */
export default function ShortReciprocationRoute() {
  return <WelcomeMailScreen />;
}
