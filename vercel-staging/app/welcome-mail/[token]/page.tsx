/**
 * Welcome-mail web fallback — landing page for the QR code printed on the
 * back of every Mailroom postcard.
 *
 * URL: https://themailroom.club/welcome-mail/TOKEN
 *
 * Behavior:
 *   • iOS with full Mailroom app installed: iOS Universal Links intercepts
 *     (AASA at /.well-known/apple-app-site-association covers /welcome-mail/*)
 *     and opens the app's expo-router /welcome-mail/[token] route, which
 *     looks up the sender via the reciprocation RPC, records the scan,
 *     and routes the recipient into the send-a-reply flow. This web page
 *     is NEVER rendered on iOS-with-app.
 *
 *   • iOS without the app, Android, desktop, any pre-iOS-14 device:
 *     this Next.js page renders as a fallback. Shows a generic "You got
 *     mail" message + App Store install CTA. Reciprocation (sender lookup,
 *     scan recording, send-reply flow) happens after install.
 *
 * Personalization (sender name + city) is a follow-up: needs a Vercel
 * server component or Edge Function to securely fetch from Supabase
 * without exposing the anon key in the client bundle. Build 54 ships
 * the generic version because it unblocks the printed QR fix end-to-end.
 */

export default function WelcomeMailPage({
  params,
}: {
  params: { token: string };
}) {
  const token = params?.token;

  if (!token) {
    return (
      <main style={page}>
        <div style={card}>
          <h1 style={h1}>No token found</h1>
          <p style={body}>
            The QR didn&apos;t scan cleanly. Open the Mailroom app and scan
            again, or ask the sender for a fresh link.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={page}>
      <div style={card}>
        <div style={stamp}>✉ YOU HAVE MAIL</div>
        <h1 style={h1}>Someone sent you a postcard.</h1>
        <p style={subtitle}>via Mailroom · real paper, real USPS</p>
        <p style={body}>
          Install the Mailroom app to see who it&apos;s from and send a
          reply back. The link works for 5 years, so no rush.
        </p>

        <a
          href="https://apps.apple.com/app/mailroom/id6768460855"
          style={btnPrimary}
        >
          Get Mailroom on the App Store
        </a>

        <p style={footnote}>
          Already have the app? Open it on your iPhone and re-scan the QR
          on the back of your postcard.
        </p>

        <p style={privacy}>
          Mailroom prints &amp; mails real paper postcards via USPS. We
          never share addresses or use them for marketing.
        </p>
      </div>
    </main>
  );
}

// ----- Styles ---------------------------------------------------------

const ink = "#11141c";
const mutedInk = "#696969";
const postalRed = "#b8483a";
const line = "#d4c9b1";
const paper = "#F8F1E3";

const page: React.CSSProperties = {
  background: paper,
  minHeight: "100vh",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "40px 16px",
  fontFamily: "ui-serif, Georgia, serif",
};
const card: React.CSSProperties = {
  background: "white",
  borderRadius: 12,
  padding: 28,
  maxWidth: 480,
  width: "100%",
  boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
  textAlign: "center" as const,
};
const stamp: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.6,
  color: postalRed,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  display: "inline-block",
  padding: "4px 10px",
  border: `1px solid ${postalRed}`,
  borderRadius: 2,
  marginBottom: 20,
  transform: "rotate(-2deg)",
};
const h1: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 600,
  color: ink,
  marginTop: 0,
  marginBottom: 8,
};
const subtitle: React.CSSProperties = {
  fontSize: 17,
  color: mutedInk,
  fontStyle: "italic",
  marginTop: 0,
  marginBottom: 20,
};
const body: React.CSSProperties = {
  fontSize: 15,
  color: ink,
  lineHeight: 1.5,
  marginBottom: 24,
};
const btnPrimary: React.CSSProperties = {
  display: "inline-block",
  padding: "16px 24px",
  fontSize: 16,
  fontWeight: 600,
  fontFamily: "ui-serif, Georgia, serif",
  background: ink,
  color: "white",
  border: "none",
  borderRadius: 12,
  textDecoration: "none",
};
const footnote: React.CSSProperties = {
  fontSize: 13,
  color: mutedInk,
  fontStyle: "italic",
  marginTop: 20,
  marginBottom: 0,
};
const privacy: React.CSSProperties = {
  fontSize: 12,
  color: mutedInk,
  lineHeight: 1.5,
  marginTop: 28,
  paddingTop: 16,
  borderTop: `1px solid ${line}`,
};
