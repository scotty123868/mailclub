/**
 * Web fallback for the Mailroom claim flow.
 *
 * URL: https://mailroomclub.vercel.app/claim?t=TOKEN
 *
 * Behavior:
 *   • On iOS 14+ with the App Clip installable: iOS intercepts the
 *     Universal Link (because the AASA file at /.well-known/apple-app-
 *     site-association advertises this URL pattern for our App Clip) and
 *     opens the native SwiftUI form. This page is never rendered.
 *
 *   • On iOS 14+ with the FULL Mailroom app installed: iOS opens the
 *     full app's expo-router /claim?t=TOKEN route, which handles the
 *     redemption natively.
 *
 *   • On Android / desktop / iOS pre-14 / any device where Universal
 *     Links don't fire: this Next.js page renders as a web fallback.
 *     Same form, same Supabase Edge Function endpoint. Lets the
 *     recipient claim without needing the app at all.
 *
 * Drop this file in the Mailroom marketing Next.js repo under
 *   app/claim/page.tsx
 * Also drop:
 *   public/.well-known/apple-app-site-association  (from vercel-staging/)
 *   vercel.json                                     (from vercel-staging/)
 */

"use client";

import { useEffect, useState } from "react";

type FieldKey = "name" | "line1" | "line2" | "city" | "state" | "zip";

export default function ClaimPage({
  searchParams,
}: {
  searchParams: { t?: string };
}) {
  const token = searchParams?.t;
  const [fields, setFields] = useState<Record<FieldKey, string>>({
    name: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    zip: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No-op effect for now. If we ever want to fire an analytics ping
    // on Universal-Link-not-intercepted (i.e., this fallback ran), do
    // it here.
  }, []);

  if (!token) {
    return (
      <main style={page}>
        <div style={card}>
          <h1 style={h1}>No claim link found</h1>
          <p style={body}>
            Tap the link from your iMessage or email — it has the postcard&apos;s
            claim token attached.
          </p>
        </div>
      </main>
    );
  }

  if (done) {
    return (
      <main style={page}>
        <div style={card}>
          <div style={{ fontSize: 64, textAlign: "center" }}>🎉</div>
          <h1 style={h1}>Done — your postcard is on its way</h1>
          <p style={body}>
            USPS time is 4–7 days. We mailed it from our printer. Save your
            address? Install the full Mailroom app from the App Store —
            you can send postcards too.
          </p>
        </div>
      </main>
    );
  }

  const canSubmit =
    fields.name.trim() &&
    fields.line1.trim() &&
    fields.city.trim() &&
    fields.state.trim().length === 2 &&
    /^\d{5}(-\d{4})?$/.test(fields.zip.trim());

  async function submit() {
    if (!canSubmit || !token) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        "https://nlwnmgwylmmnaemdnzlq.functions.supabase.co/claim",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            name: fields.name.trim(),
            line1: fields.line1.trim(),
            line2: fields.line2.trim() || undefined,
            city: fields.city.trim(),
            state: fields.state.trim().toUpperCase(),
            zip: fields.zip.trim(),
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `HTTP ${res.status}`);
      }
      setDone(true);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't save your address. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={page}>
      <div style={card}>
        <div style={kicker}>YOU HAVE MAIL</div>
        <h1 style={h1}>Someone sent you a postcard.</h1>
        <p style={body}>
          Share your mailing address and we&apos;ll print + ship it. Your
          address stays private.
        </p>

        <Field
          label="Your name"
          value={fields.name}
          onChange={(v) => setFields({ ...fields, name: v })}
          placeholder="Maya Chen"
        />
        <Field
          label="Street address"
          value={fields.line1}
          onChange={(v) => setFields({ ...fields, line1: v })}
          placeholder="123 Main St"
        />
        <Field
          label="Apt, suite (optional)"
          value={fields.line2}
          onChange={(v) => setFields({ ...fields, line2: v })}
          placeholder="Apt 4B"
        />
        <div style={{ display: "flex", gap: 12 }}>
          <Field
            label="City"
            value={fields.city}
            onChange={(v) => setFields({ ...fields, city: v })}
            placeholder="Denver"
            style={{ flex: 1 }}
          />
          <Field
            label="State"
            value={fields.state}
            onChange={(v) =>
              setFields({ ...fields, state: v.toUpperCase().slice(0, 2) })
            }
            placeholder="CO"
            style={{ width: 90 }}
          />
        </div>
        <Field
          label="ZIP"
          value={fields.zip}
          onChange={(v) => setFields({ ...fields, zip: v })}
          placeholder="80218"
        />

        {error ? <div style={errorStyle}>{error}</div> : null}

        <button
          onClick={submit}
          disabled={!canSubmit || submitting}
          style={{
            ...btn,
            opacity: !canSubmit || submitting ? 0.4 : 1,
            cursor: !canSubmit || submitting ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Sending..." : "Send my address →"}
        </button>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  style,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ marginTop: 12, ...style }}>
      <div style={fieldLabel}>{label.toUpperCase()}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={input}
      />
    </div>
  );
}

// ----- Styles (inline so this drops into any Next.js project without
//        depending on Tailwind / CSS modules / etc) ---------------------

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
  padding: 24,
  maxWidth: 480,
  width: "100%",
  boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
};
const kicker: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1.6,
  color: postalRed,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const h1: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 600,
  color: ink,
  marginTop: 8,
  marginBottom: 8,
};
const body: React.CSSProperties = {
  fontSize: 14,
  color: mutedInk,
  fontStyle: "italic",
  marginBottom: 20,
};
const fieldLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: 0.8,
  color: mutedInk,
  marginBottom: 6,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  fontSize: 15,
  fontFamily: "ui-serif, Georgia, serif",
  color: ink,
  background: "white",
  border: `1px solid ${line}`,
  borderRadius: 8,
  boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  width: "100%",
  padding: "16px",
  marginTop: 20,
  fontSize: 16,
  fontWeight: 600,
  fontFamily: "ui-serif, Georgia, serif",
  background: ink,
  color: "white",
  border: "none",
  borderRadius: 12,
};
const errorStyle: React.CSSProperties = {
  fontSize: 13,
  color: postalRed,
  marginTop: 12,
  fontStyle: "italic",
};
