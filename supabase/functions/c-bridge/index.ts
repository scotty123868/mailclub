// c-bridge — server-rendered HTML "shim" for /c/<token>.
//
// Why this exists:
// /c/index.html is a static SPA. Its <meta property="og:image"> tag
// is GENERIC for every postcard because static HTML can't be templated
// per token. iMessage's OG crawler doesn't run JS, so dynamic meta
// injection client-side doesn't help.
//
// This Edge Function returns SERVER-RENDERED HTML with per-token OG
// tags (title, description, image — the photo from the postcard).
// It includes a meta-refresh redirect to /c/<token> so REAL browsers
// land on the interactive page. The OG crawler just reads the
// meta tags and never follows the refresh.
//
// Outbound from the bot: instead of sending /c/<token>, we send
// /functions/v1/c-bridge?token=<token>. iMessage shows the rich
// preview, recipient taps it, lands on /c/<token>.

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Build the per-token HTML. Title + description + og:image are all
// dynamic. Body is empty (meta refresh handles redirect for real
// browsers). Cache-Control: short TTL so iMessage's preview refreshes
// as the postcard moves through its lifecycle.
function buildHtml(opts: {
  token: string;
  title: string;
  description: string;
  imageUrl: string;
  destinationUrl: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(opts.title)}</title>
  <meta name="description" content="${escapeHtml(opts.description)}" />

  <!-- OpenGraph: per-token. This is the whole point of c-bridge. -->
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(opts.title)}" />
  <meta property="og:description" content="${escapeHtml(opts.description)}" />
  <meta property="og:image" content="${escapeHtml(opts.imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:url" content="${escapeHtml(opts.destinationUrl)}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(opts.title)}" />
  <meta name="twitter:description" content="${escapeHtml(opts.description)}" />
  <meta name="twitter:image" content="${escapeHtml(opts.imageUrl)}" />

  <!-- iOS smart app banner (kept consistent with /c/) -->
  <meta name="apple-itunes-app" content="app-id=6768460855" />

  <!-- Redirect real browsers to the interactive page. OG crawlers
       ignore meta-refresh and just parse the meta tags above. -->
  <meta http-equiv="refresh" content="0; url=${escapeHtml(opts.destinationUrl)}" />

  <style>
    body {
      margin: 0; padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
      background: #fdfaf1; color: #11141c; text-align: center;
    }
    a { color: #b8483a; }
  </style>
</head>
<body>
  <noscript>
    <p>Open your postcard tracking page:</p>
    <p><a href="${escapeHtml(opts.destinationUrl)}">${escapeHtml(opts.destinationUrl)}</a></p>
  </noscript>
  <script>
    // Belt + suspenders: also redirect via JS in case meta refresh
    // hits an edge case (some in-app browsers swallow it).
    window.location.replace(${JSON.stringify(opts.destinationUrl)});
  </script>
</body>
</html>`;
}

function notFoundHtml(): string {
  return buildHtml({
    token: "",
    title: "Mailroom — A magical mail club",
    description: "Real paper postcards by text. First one's on us.",
    imageUrl: "https://app.themailroom.club/og-card.png",
    destinationUrl: "https://app.themailroom.club/",
  });
}

serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("GET only", { status: 405 });
  }

  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token || token.length < 16) {
    return new Response(notFoundHtml(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Resolve the draft → postcard → recipient + friend + photo + ETA.
  // This mirrors postcard-confirmation's logic but only pulls what we
  // need for the OG meta tags. No signed-URL refresh dance — the
  // photo_path is already a Lob-acceptable HTTPS URL by the time the
  // card is mailed.
  const { data: draft } = await admin
    .from("sms_postcard_drafts")
    .select("token, postcard_id")
    .eq("token", token)
    .maybeSingle();
  if (!draft?.postcard_id) {
    return new Response(notFoundHtml(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const { data: postcard } = await admin
    .from("postcards")
    .select(`
      id, message, from_city, to_city, status,
      lob_expected_delivery, sent_at, scheduled_send_at,
      sender_id, to_friend_id, photo_path,
      lob_front_thumbnail_url
    `)
    .eq("id", draft.postcard_id)
    .maybeSingle();
  if (!postcard) {
    return new Response(notFoundHtml(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const { data: friend } = await admin
    .from("friends").select("name, address_city, address_state").eq("id", postcard.to_friend_id).maybeSingle();
  const { data: profile } = await admin
    .from("profiles").select("city, state").eq("id", postcard.sender_id).maybeSingle();

  // OG image priority:
  // 1. Lob's rendered front thumbnail (the actual composed card —
  //    photo + cream frame + greeting + stamp). Best preview because
  //    it shows what the recipient will hold in their hands.
  // 2. The raw camera-roll photo, signed for 7 days.
  // 3. Generic Mailroom og-card.png (fallback for scheduled cards
  //    that haven't hit Lob yet).
  //
  // Lob hosts thumbnail URLs for ~90 days. Postcard delivery cycle
  // is ~5-7 days, so the URL outlives the preview need.
  let imageUrl = "https://app.themailroom.club/og-card.png";
  if (postcard.lob_front_thumbnail_url) {
    imageUrl = postcard.lob_front_thumbnail_url;
  } else if (postcard.photo_path) {
    if (postcard.photo_path.startsWith("http")) {
      imageUrl = postcard.photo_path;
    } else {
      const { data: signed } = await admin.storage
        .from("sms-photos")
        .createSignedUrl(postcard.photo_path, 60 * 60 * 24 * 7);
      imageUrl = signed?.signedUrl ?? imageUrl;
    }
  }

  // Build the title + description from postcard context.
  const recipientFirst = (friend?.name ?? "your friend").split(/\s+/)[0] || "your friend";
  const fromCity = profile?.city ?? postcard.from_city ?? "";
  const toCity = friend?.address_city ?? postcard.to_city ?? "";
  const routeBit = fromCity && toCity
    ? `${fromCity} → ${toCity}`
    : (fromCity || toCity || "");

  let title: string;
  let description: string;

  if (postcard.status === "scheduled" && postcard.scheduled_send_at) {
    const sendDate = new Date(postcard.scheduled_send_at);
    const sendLabel = sendDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    title = `Postcard for ${recipientFirst}, mailing ${sendLabel}`;
    description = routeBit
      ? `${routeBit}. Scheduled with Mailroom.`
      : `Scheduled with Mailroom.`;
  } else if (postcard.status === "delivered") {
    title = `Postcard delivered to ${recipientFirst}`;
    description = routeBit
      ? `${routeBit}. Real paper, in their mailbox.`
      : `Real paper, in their mailbox.`;
  } else {
    const etaLabel = postcard.lob_expected_delivery
      ? new Date(postcard.lob_expected_delivery).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "in 3-5 days";
    title = `Postcard on its way to ${recipientFirst}`;
    description = routeBit
      ? `${routeBit}. Arrives ${etaLabel}.`
      : `Arrives ${etaLabel}.`;
  }

  const destinationUrl = `https://app.themailroom.club/c/${encodeURIComponent(token)}`;

  const html = buildHtml({ token, title, description, imageUrl, destinationUrl });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Short cache so iMessage preview refreshes as Lob lifecycle
      // events move the card from sent → in_transit → delivered.
      "Cache-Control": "public, max-age=600, s-maxage=600",
    },
  });
});
