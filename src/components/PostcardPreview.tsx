import { forwardRef } from "react";
import { Image, StyleSheet, Text, View, ViewStyle } from "react-native";
import QRCode from "react-native-qrcode-svg";
import Svg, { Circle, Defs, G, Line, Path, Pattern, Rect } from "react-native-svg";
import type { Friend } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Postcard preview — front + back, designed to look like an actual mailed
 * postcard. Both components forward a ref so they can be captured to PNG by
 * `react-native-view-shot` and uploaded to Lob.
 *
 *   • Real postcards are 6×4 in, 1.5:1 aspect ratio
 *   • Lob renders at 300 DPI = 1875 × 1275 px per side
 *   • With 1/8 inch bleed → 1950 × 1350 px max
 *
 * The previews render at any width and proportionally scale internal type.
 * For Lob capture, wrap the preview in <ViewShot> at width=1875 (off-screen).
 */

const ASPECT_RATIO = 1.5;
const DEFAULT_WIDTH = 320;

// =========================================================================
// FRONT — full-bleed photo with caption banner
// =========================================================================

type FrontProps = {
  photoUri?: string;
  caption?: string;
  width?: number;
  testID?: string;
  /** Lob-print dimensions. Set true for off-screen 1875px capture. */
  printScale?: boolean;
};

export const PostcardFrontPreview = forwardRef<View, FrontProps>(function PostcardFrontPreview(
  { photoUri, caption, width = DEFAULT_WIDTH, testID, printScale = false },
  ref,
) {
  const height = width / ASPECT_RATIO;
  // v0.7.0.13: photo dominates. Subtle cream border matches the back's
  // paper color so front + back read as one coherent piece when set
  // next to each other. No caption, no wordmark — the photo is the
  // statement. (`caption` prop kept for backward compat but ignored.)
  const pad = Math.max(6, width * 0.024); // ~6% of width — tight but visible
  const placeholderSize = Math.max(11, width * 0.04);

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.cardOuter, frontStyles.outer, { width, height }]}
      testID={testID ?? "postcard-front-preview"}
      accessibilityRole="image"
      accessibilityLabel="Postcard front"
    >
      <View
        style={[
          styles.cardInner,
          frontStyles.creamFrame,
          { padding: pad },
        ]}
      >
        <View style={frontStyles.photoWell}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
          ) : (
            <View style={frontStyles.photoPlaceholder}>
              <Text style={[frontStyles.placeholderText, { fontSize: placeholderSize }]}>
                Photo goes here
              </Text>
              <Text style={[frontStyles.placeholderSub, { fontSize: placeholderSize * 0.78 }]}>
                Tap "Add photo" on the Send screen
              </Text>
            </View>
          )}
          <View style={frontStyles.photoEdge} pointerEvents="none" />
        </View>
      </View>
    </View>
  );
});

// =========================================================================
// BACK — left handwritten message, right address + stamp + postmark
// =========================================================================

type BackProps = {
  message: string;
  recipient: Pick<Friend, "name" | "city" | "state"> & {
    addressLine1?: string;
    addressLine2?: string;
    zip?: string;
  };
  sender?: { name: string; city: string; state: string };
  width?: number;
  testID?: string;
  printScale?: boolean;
  /**
   * v0.5.0 Phase 3 — reciprocation QR. When provided, renders a small QR
   * in the bottom-right of the back so the receiver can scan it to join
   * Mailroom with the sender pre-loaded. Omit to keep the back clean
   * (e.g. for preview-only contexts or until the token is minted).
   */
  reciprocationUrl?: string;
};

export const PostcardBackPreview = forwardRef<View, BackProps>(function PostcardBackPreview(
  { message, recipient, sender, width = DEFAULT_WIDTH, testID, reciprocationUrl },
  ref,
) {
  const height = width / ASPECT_RATIO;
  const messageSize = Math.max(13, width * 0.052);
  const addressSize = Math.max(10, width * 0.04);
  const labelSize = Math.max(8, width * 0.03);
  // QR is sized as a fraction of card width so it stays readable at both
  // preview (300px wide) and print (1875px) scales. ~9% of card width is
  // big enough for a stable scan from arm's length, small enough not to
  // crowd the recipient address block.
  const qrSize = Math.max(48, width * 0.13);

  // Estimate how many lines fit on the left side so message doesn't overrun
  const messageLines = Math.max(4, Math.floor((height - 60) / (messageSize * 1.45)));

  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.cardOuter, backStyles.outer, { width, height }]}
      testID={testID ?? "postcard-back-preview"}
      accessibilityRole="text"
      accessibilityLabel={`Postcard back to ${recipient.name}: ${message}`}
    >
      <View style={[styles.cardInner, backStyles.inner]}>
        <PaperBackdrop />

        {/* Vertical divider — slightly off-vertical for hand-drawn feel */}
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Line
            x1="50.2%"
            y1="6%"
            x2="49.8%"
            y2="94%"
            stroke="#C2A56D"
            strokeWidth={0.8}
            opacity={0.7}
          />
        </Svg>

        {/* LEFT HALF — message + return address */}
        <View style={[backStyles.half, backStyles.leftHalf]}>
          {sender ? (
            <Text
              style={[backStyles.returnAddress, { fontSize: labelSize }]}
              numberOfLines={2}
            >
              FROM: {sender.name?.toUpperCase() || "YOU"}
              {sender.city ? `, ${sender.city.toUpperCase()}` : ""}
              {sender.state ? ` ${sender.state.toUpperCase()}` : ""}
            </Text>
          ) : null}
          <Text
            style={[
              backStyles.message,
              {
                fontSize: messageSize,
                lineHeight: messageSize * 1.45,
              },
            ]}
            numberOfLines={messageLines}
          >
            {message || "Your handwritten note appears here…"}
          </Text>
        </View>

        {/* RIGHT HALF — stamp + postmark + recipient block */}
        <View style={[backStyles.half, backStyles.rightHalf]}>
          {/* Postage stamp — top-right corner with perforation edges */}
          <View style={backStyles.stampWrap}>
            <PostageStamp size={Math.max(38, width * 0.14)} />
          </View>

          {/* Postmark — circular ink stamp, slightly off-register over the stamp */}
          <View style={[backStyles.postmarkWrap, { width: Math.max(46, width * 0.18) }]}>
            <PostmarkCircle size={Math.max(46, width * 0.18)} />
          </View>

          {/* Recipient address block — centered in the safe area */}
          <View style={backStyles.addressBlock}>
            <Text
              style={[backStyles.addressName, { fontSize: addressSize * 1.18 }]}
              numberOfLines={1}
            >
              {recipient.name || "Recipient name"}
            </Text>
            {recipient.addressLine1 ? (
              <Text style={[backStyles.addressLine, { fontSize: addressSize }]} numberOfLines={1}>
                {recipient.addressLine1}
              </Text>
            ) : null}
            {recipient.addressLine2 ? (
              <Text style={[backStyles.addressLine, { fontSize: addressSize }]} numberOfLines={1}>
                {recipient.addressLine2}
              </Text>
            ) : null}
            <Text style={[backStyles.addressLine, { fontSize: addressSize }]} numberOfLines={1}>
              {recipient.city}
              {recipient.state ? `, ${recipient.state}` : ""}
              {recipient.zip ? `  ${recipient.zip}` : ""}
            </Text>
          </View>

          {/* USPS address guide lines — bottom 5 lines */}
          <View style={backStyles.addressLines}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i} style={backStyles.addressGuideLine} />
            ))}
          </View>

          {/* Reciprocation QR — bottom-right corner of the back. Only rendered
              when a URL is supplied so the visible preview stays clean on the
              compose screens before a token is minted. The QR has a quiet zone
              built in (the white padding) and a "Scan to reply free →" label
              underneath so the receiver knows what to do. */}
          {reciprocationUrl ? (
            <View style={[backStyles.qrWrap, { width: qrSize + 6 }]}>
              <View style={[backStyles.qrInner, { padding: Math.max(3, qrSize * 0.05) }]}>
                <QRCode
                  value={reciprocationUrl}
                  size={qrSize}
                  color={colors.ink}
                  backgroundColor="#FFFDF7"
                  ecl="M"
                />
              </View>
              <Text
                style={[backStyles.qrCaption, { fontSize: Math.max(7, width * 0.022) }]}
                numberOfLines={1}
              >
                Scan to reply free →
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
});

// =========================================================================
// Postage stamp — drawn as SVG with perforation edges + dove motif
// =========================================================================

function PostageStamp({ size }: { size: number }) {
  const inner = size * 0.85;
  const perfRadius = size * 0.04;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        {/* Subtle gradient for the stamp's "printed" look */}
        <Pattern id="stampPaper" patternUnits="userSpaceOnUse" width="3" height="3">
          <Rect width="3" height="3" fill="#FFFDF7" />
          <Circle cx="1.5" cy="1.5" r="0.4" fill="#F5E9D2" />
        </Pattern>
      </Defs>
      {/* Perforated edge ring — small circles around perimeter to simulate stamp cut */}
      <G fill="#F8F1E3">
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i / 12) * 360;
          const rad = (angle * Math.PI) / 180;
          const cx = 50 + 47 * Math.cos(rad);
          const cy = 50 + 47 * Math.sin(rad);
          return <Circle key={`p-${i}`} cx={cx} cy={cy} r={3.5} />;
        })}
      </G>
      {/* Inner stamp body — postal red */}
      <Rect x="8" y="8" width="84" height="84" fill={colors.postalRed} stroke="#7A2218" strokeWidth={0.8} />
      {/* Paper texture inside the stamp body */}
      <Rect x="14" y="14" width="72" height="72" fill={colors.postalRed} />
      {/* Mailroom dove motif — simplified flying bird */}
      <Path
        d="M 30 55 Q 38 35, 52 38 Q 60 32, 68 36 L 64 42 Q 60 42, 56 44 Q 50 50, 44 52 L 48 56 Q 42 58, 36 58 Q 30 58, 30 55 Z"
        fill="#FFFDF7"
        opacity={0.95}
      />
      {/* Top text MAILROOM */}
      <Path d="M 18 22 L 82 22" stroke="rgba(0,0,0,0)" />
      {/* Bottom denomination */}
      <Rect x="38" y="76" width="24" height="10" fill="#FFFDF7" rx="1" />
    </Svg>
  );
}

// =========================================================================
// Postmark — circular ink stamp, hand-applied look
// =========================================================================

function PostmarkCircle({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" style={{ transform: [{ rotate: "-8deg" }] }}>
      <Defs>
        <Pattern id="postmark-ink" patternUnits="userSpaceOnUse" width="2" height="2">
          <Rect width="2" height="2" fill="rgba(0,0,0,0)" />
          <Circle cx="0.5" cy="0.5" r="0.18" fill="#B84A3A" opacity={0.75} />
        </Pattern>
      </Defs>
      {/* outer ring */}
      <Circle cx="50" cy="50" r="46" stroke="#B84A3A" strokeWidth={2} fill="none" opacity={0.7} />
      <Circle cx="50" cy="50" r="40" stroke="#B84A3A" strokeWidth={1} fill="none" opacity={0.6} />
      {/* curved top text MAILROOM */}
      <Path id="topcurve" d="M 14 50 A 36 36 0 0 1 86 50" fill="none" />
      <Path id="botcurve" d="M 14 50 A 36 36 0 0 0 86 50" fill="none" />
      <G fill="#B84A3A" opacity={0.78}>
        {/* Approximation: text on curve isn't available in react-native-svg pre v12 reliably; we use cleartext positioning */}
      </G>
      {/* Center: "WITH CARE" wedge bars */}
      <G stroke="#B84A3A" strokeWidth={1.4} fill="none" opacity={0.7}>
        <Line x1="22" y1="50" x2="34" y2="50" />
        <Line x1="66" y1="50" x2="78" y2="50" />
      </G>
      {/* speckle to look like uneven ink */}
      <Circle cx="32" cy="36" r="0.8" fill="#B84A3A" opacity={0.4} />
      <Circle cx="68" cy="42" r="0.6" fill="#B84A3A" opacity={0.35} />
      <Circle cx="58" cy="68" r="0.7" fill="#B84A3A" opacity={0.4} />
    </Svg>
  );
}

// =========================================================================
// Paper texture backdrop
// =========================================================================

function PaperBackdrop() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern id="paperGrain" patternUnits="userSpaceOnUse" width="6" height="6">
          <Rect width="6" height="6" fill="#FBF4DE" />
          <Path d="M 0 3 L 6 3" stroke="#E8DBBE" strokeWidth="0.2" />
          <Path d="M 3 0 L 3 6" stroke="#E8DBBE" strokeWidth="0.2" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#paperGrain)" />
    </Svg>
  );
}

// =========================================================================
// Styles
// =========================================================================

const styles = StyleSheet.create({
  cardOuter: {
    backgroundColor: "#FFFDF7",
    borderRadius: 4,
    shadowColor: "#2B1A08",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
    transform: [{ rotate: "-0.5deg" }],
  } as ViewStyle,
  cardInner: {
    flex: 1,
    borderRadius: 4,
    overflow: "hidden",
  } as ViewStyle,
  photo: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
});

const frontStyles = StyleSheet.create({
  outer: {},
  // v0.7.0.13: cream paper frame matching the back's `#FBF4DE` so front
  // and back read as one coherent piece when laid side by side. Thin
  // border (~2.4% of width on all four sides) — distinct enough to
  // separate from the photo but quiet enough that the photo dominates.
  // No caption, no wordmark. The photo is the statement.
  creamFrame: {
    backgroundColor: "#FBF4DE",
    position: "relative",
  },
  photoWell: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: "#1B1F2D",
    position: "relative",
  },
  photoEdge: {
    ...StyleSheet.absoluteFillObject,
    borderColor: "rgba(0,0,0,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#F2EBDA",
  },
  captionText: {
    color: colors.ink,
    fontFamily: fonts.script,
    letterSpacing: 0.3,
    textAlign: "center",
  },
  markCorner: {
    position: "absolute",
  },
  markText: {
    color: colors.mutedInk,
    fontFamily: fonts.sansBold,
    letterSpacing: 2.2,
    opacity: 0.7,
  },
  placeholderText: { color: colors.mutedInk, fontFamily: fonts.serifItalic },
  placeholderSub: { color: colors.mutedInk, fontFamily: fonts.serif, opacity: 0.65 },
});

const backStyles = StyleSheet.create({
  outer: {},
  inner: { backgroundColor: "#FBF4DE" },
  half: { paddingHorizontal: 14, paddingVertical: 12, position: "absolute", top: 0, bottom: 0 },
  leftHalf: { left: 0, width: "50%" },
  rightHalf: { right: 0, width: "50%" },
  returnAddress: {
    color: colors.mutedInk,
    fontFamily: fonts.sansBold,
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  message: {
    color: colors.ink,
    fontFamily: fonts.script,
    letterSpacing: 0.3,
  },
  stampWrap: { position: "absolute", right: 8, top: 8, transform: [{ rotate: "-4deg" }] },
  postmarkWrap: {
    position: "absolute",
    right: -8,
    top: 26,
    opacity: 0.85,
  },
  addressBlock: { gap: 2, marginTop: 70, paddingHorizontal: 8 },
  addressName: { color: colors.ink, fontFamily: fonts.serifSemi, letterSpacing: 0.3 },
  addressLine: { color: colors.ink, fontFamily: fonts.serif, letterSpacing: 0.2 },
  addressLines: { bottom: 12, gap: 9, left: 14, position: "absolute", right: 14 },
  addressGuideLine: { backgroundColor: colors.line, height: StyleSheet.hairlineWidth, opacity: 0.55 },
  // Reciprocation QR — bottom-right corner. Sits inside its own white card
  // so contrast against the postal-paper background is high enough to scan
  // cleanly even on cheap printers. The caption is a quiet italic so it
  // reads as an invitation, not a coupon.
  qrWrap: { alignItems: "center", bottom: 6, gap: 2, position: "absolute", right: 6 },
  qrInner: { backgroundColor: "#FFFDF7", borderColor: colors.line, borderRadius: 2, borderWidth: StyleSheet.hairlineWidth },
  qrCaption: { color: colors.mutedInk, fontFamily: fonts.serifItalic, marginTop: 2 },
});
