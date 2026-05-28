import { forwardRef } from "react";
import { Image, StyleSheet, Text, View, ViewStyle } from "react-native";
import QRCode from "react-native-qrcode-svg";
import Svg, { Circle, Defs, G, Line, Path, Pattern, Rect } from "react-native-svg";
import type { Friend } from "@/src/types/mail";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * Postcard preview. front + back, designed to look like an actual mailed
 * postcard. Both components forward a ref so they can be captured to PNG by
 * `react-native-view-shot` and uploaded to Lob.
 *
 * • Lob 4×6 postcards are actually 4.25" × 6.25" (incl. 1/8" bleed)
 * • Aspect ratio = 6.25 / 4.25 = ~1.4706
 * • Renders at 300 DPI = 1875 × 1275 px per side
 *
 * v0.7.0.20: ASPECT_RATIO was 1.5 (a true 4×6, no bleed). Lob rejects
 * anything outside ~4.25:6.25. even 0.03 off the ratio fails their
 * validator with "Expected height:width ratio of 4.25:6.25". Bringing
 * the on-screen + captured view to the right ratio so the captured
 * PNG passes.
 *
 * The previews render at any width and proportionally scale internal type.
 * For Lob capture, wrap the preview in <ViewShot> at width=1875 (off-screen).
 */

const ASPECT_RATIO = 6.25 / 4.25; // ~1.4706. matches Lob 4×6 with bleed
const DEFAULT_WIDTH = 320;

// =========================================================================
// FRONT. full-bleed photo with caption banner
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
 // next to each other. No caption, no wordmark. the photo is the
 // statement. (`caption` prop kept for backward compat but ignored.)
 const pad = Math.max(6, width * 0.024); // ~6% of width. tight but visible
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
// BACK. left handwritten message, right address + stamp + postmark
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
 * v0.5.0 Phase 3. reciprocation QR. When provided, renders a small QR
 * in the bottom-right of the back so the receiver can scan it to join
 * Mailroom with the sender pre-loaded. Omit to keep the back clean
 * (e.g. for preview-only contexts or until the token is minted).
 */
 reciprocationUrl?: string;
 /**
 * v0.7.0.28. when true, this render is the off-screen capture going
 * to Lob's printer. We MUST NOT render anything inside Lob's protected
 * zones (right column from x=2.97" + bottom 0.625") or our ink fights
 * Lob's auto-printed address + indicia + IMb barcode.
 *
 * Concrete differences when forPrint=true:
 * - DROP the recipient address block (Lob auto-prints it on the right)
 * - DROP the return-address FROM line (Lob's indicia carries return)
 * - DROP the USPS address guide lines (Lob's zone)
 * - DROP the postmark circle (decorative, in Lob's zone)
 * - Postage stamp stays but lives in the top-right of the SAFE zone
 * (above y=1.625"), not overlapping the auto-print area
 * - QR moves out of the bottom-right (Lob's zone) into a safe spot
 *
 * Real-world bug this fixed: the proof from the first live test send
 * showed our recipient block printed in serif AND Lob's printed below
 * in caps. same address twice. Lob's indicia box overlapped our
 * "M" wax-seal mark. The "FROM: LORI, CHEVY CHASE MD" line at the
 * top was clipped by the print bleed. Bottom barcode collided with
 * our address guide lines. Total visual chaos. forPrint=true gives
 * Lob clear lanes for their auto-print and confines our design to
 * the designer-available space.
 *
 * For in-app preview (default false), keep everything visible so the
 * user sees a complete render of who they're sending to.
 */
 forPrint?: boolean;
};

// v0.7.0.28. Vintage Purist print layout. Used when forPrint=true (the
// off-screen view-shot capture that gets uploaded to Lob). Mirrors the
// design-mockups/postcard-back/C2-vintage-purist-v2.html file exactly.
//
// Coordinate system: everything positioned by INCHES from the top-left
// of the 6.25"×4.25" card. `inch(n)` converts to pixels relative to the
// render width (300px preview, 1875px print). Same component renders
// correctly at any scale.
//
// Zones (in inches):
// Top safe strip: 0–6.25 wide × 0–1.625 tall
// Left safe col: 0–2.69 wide × 1.625–3.625 tall
// Lob owns: everything else (right column from 2.69" + bottom 0.625")
function PostcardBackPrintLayout({
 width,
 height,
 message,
 sender,
 reciprocationUrl,
}: {
 width: number;
 height: number;
 message: string;
 sender?: { name: string; city: string; state: string };
 reciprocationUrl?: string;
}) {
 // Inch-to-pixel scale. 6.25" wide card. 1875px at print, 300px at preview.
 const inch = (n: number) => n * (width / 6.25);
 const senderFirst = sender?.name?.split(/\s+/)[0] || "the sender";
 const senderLoc = sender?.city
 ? `${sender.city} ${sender.state || ""}`.trim()
 : "";

 // QR top-left: 1.04" square at 0.39in,0.29in
 const qrSize = inch(1.04);
 const qrX = inch(0.39);
 const qrY = inch(0.29);

 // Stamp top-right: 1.45" × 1.74" at right=0.29in, top=0.20in
 const stampW = inch(1.45);
 const stampH = inch(1.74);
 const stampRight = inch(0.29);
 const stampTop = inch(0.20);

 // Message: left col, bounded so it can never overflow Lob's zone
 const msgLeft = inch(0.39);
 const msgTop = inch(1.67);
 const msgW = inch(2.30); // 2.30in < 2.69in safe column boundary
 const msgH = inch(1.55); // ends well above the 0.625in IMb zone

 // Postmark just above IMb zone
 const postmarkLeft = inch(0.39);
 const postmarkBottom = inch(0.83); // 0.83in from bottom = above IMb zone

 return (
 <>
 {/* ---- TOP-LEFT: QR + sender first-name caption ---- */}
 {reciprocationUrl ? (
 <View style={{ position: "absolute", left: qrX, top: qrY, flexDirection: "row", alignItems: "flex-start", gap: inch(0.12) }}>
 <View
 style={{
 width: qrSize, height: qrSize,
 backgroundColor: "#FFFDF7",
 borderColor: "#17223B", borderWidth: 1,
 padding: inch(0.05),
 }}
 >
 <QRCode
 value={reciprocationUrl}
 size={qrSize - inch(0.1)}
 color="#17223B"
 backgroundColor="#FFFDF7"
 ecl="M"
 />
 </View>
 <View style={{ maxWidth: inch(1.7), paddingTop: inch(0.08) }}>
 <Text
 style={{
 fontFamily: fonts.serifItalic,
 fontSize: inch(0.15),
 lineHeight: inch(0.2),
 color: "#17223B",
 fontWeight: "500",
 }}
 numberOfLines={3}
 >
 Respond to {senderFirst} with a postcard for free.
 </Text>
 <Text
 style={{
 fontFamily: fonts.mono,
 fontSize: inch(0.09),
 color: "rgba(23, 34, 59, 0.55)",
 marginTop: inch(0.08),
 letterSpacing: 0.5,
 }}
 numberOfLines={1}
 >
 {extractClaimSlug(reciprocationUrl)}
 </Text>
 </View>
 </View>
 ) : null}

 {/* ---- TOP-RIGHT: vintage perforated stamp ---- */}
 <View
 style={{
 position: "absolute",
 right: stampRight,
 top: stampTop,
 width: stampW,
 height: stampH,
 transform: [{ rotate: "3deg" }],
 }}
 >
 <VintageStamp width={stampW} height={stampH} />
 </View>

 {/* ---- CENTER DIVIDER: hairline at 2.69" ---- */}
 <View
 style={{
 position: "absolute",
 left: inch(2.69),
 top: inch(0.3),
 bottom: inch(0.75),
 width: 1,
 backgroundColor: "rgba(194, 165, 109, 0.5)",
 }}
 />

 {/* ---- MESSAGE: strictly bounded to left safe column ---- */}
 <View
 style={{
 position: "absolute",
 left: msgLeft, top: msgTop,
 width: msgW, height: msgH,
 overflow: "hidden",
 }}
 >
 <Text
 style={{
 fontFamily: fonts.hand,
 fontSize: inch(0.18),
 lineHeight: inch(0.27),
 color: "#17223B",
 letterSpacing: 0.2,
 }}
 >
 {message || "Your handwritten note appears here…"}
 </Text>
 </View>

 {/* ---- POSTMARK: oval ring + wavy cancellation lines ---- */}
 {senderLoc ? (
 <View
 style={{
 position: "absolute",
 left: postmarkLeft,
 bottom: postmarkBottom,
 flexDirection: "row",
 alignItems: "center",
 gap: inch(0.06),
 }}
 >
 <View
 style={{
 borderColor: "rgba(23, 34, 59, 0.45)",
 borderWidth: 1,
 borderRadius: inch(0.5),
 paddingHorizontal: inch(0.09),
 paddingVertical: inch(0.04),
 }}
 >
 <Text
 style={{
 fontFamily: fonts.mono,
 fontSize: inch(0.08),
 color: "rgba(23, 34, 59, 0.65)",
 letterSpacing: 1.2,
 }}
 numberOfLines={1}
 >
 {senderLoc.toUpperCase()} · {formatPostmarkDate()}
 </Text>
 </View>
 {/* Wavy cancellation lines. repeating dashes (faux pattern). */}
 <View style={{ flexDirection: "row", gap: inch(0.04), opacity: 0.45 }}>
 {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => (
 <View
 key={i}
 style={{
 width: inch(0.06),
 height: inch(0.02),
 backgroundColor: "rgba(23, 34, 59, 0.55)",
 }}
 />
 ))}
 </View>
 </View>
 ) : null}
 </>
 );
}

// Trim "https://" + domain so the URL on the back is short + scannable.
// e.g. "https://mailroomclub.vercel.app/claim?t=ABC123" → "claim/ABC123"
function extractClaimSlug(url: string): string {
 try {
 const u = new URL(url);
 const t = u.searchParams.get("t");
 return t ? `mailroom.app/r/${t}` : url.replace(/^https?:\/\//, "");
 } catch {
 return url.replace(/^https?:\/\//, "");
 }
}

function formatPostmarkDate(): string {
 // "MAY 15 · 2026" style. Real postmarks use day · month · year.
 const d = new Date();
 const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
 return `${months[d.getMonth()]} ${d.getDate()} · ${d.getFullYear()}`;
}

// =========================================================================
// Vintage perforated stamp. postal-red border, balloon photo, 70¢ + 2026.
// Perforated edges via SVG mask circles around the perimeter.
// =========================================================================
const HERO_BALLOON = require("@/assets/onboarding/hero-envelope-balloon.jpg");

function VintageStamp({ width, height }: { width: number; height: number }) {
 const borderW = Math.max(2, width * 0.025);
 const innerInset = borderW + 3;
 return (
 <View style={{ width, height, position: "relative" }}>
 {/* Stamp body. cream paper with thick postal-red border */}
 <View
 style={{
 width, height,
 backgroundColor: "#fdf6e5",
 borderColor: "#B8483A",
 borderWidth: borderW,
 }}
 />
 {/* Inner thin border, slightly inset */}
 <View
 style={{
 position: "absolute",
 left: innerInset, top: innerInset,
 right: innerInset, bottom: innerInset,
 borderColor: "rgba(184, 72, 58, 0.55)",
 borderWidth: 0.5,
 }}
 />
 {/* Content stack */}
 <View
 style={{
 position: "absolute", inset: 0,
 padding: borderW + 5,
 alignItems: "center",
 justifyContent: "space-between",
 }}
 >
 <Image
 source={HERO_BALLOON}
 style={{
 width: width * 0.62,
 height: height * 0.42,
 marginTop: height * 0.06,
 }}
 resizeMode="cover"
 />
 <View style={{ alignItems: "center", marginBottom: height * 0.04 }}>
 <Text
 style={{
 fontFamily: fonts.serifSemi,
 fontSize: width * 0.115,
 color: "#B8483A",
 letterSpacing: 1.2,
 fontWeight: "800",
 }}
 >
 MAILROOM
 </Text>
 <Text
 style={{
 fontFamily: fonts.mono,
 fontSize: width * 0.05,
 color: "rgba(184, 72, 58, 0.75)",
 letterSpacing: 2,
 marginTop: 1,
 }}
 >
 FIRST CLASS
 </Text>
 <Text
 style={{
 fontFamily: fonts.serifSemi,
 fontSize: width * 0.18,
 color: "#B8483A",
 lineHeight: width * 0.18,
 marginTop: 2,
 }}
 >
 70¢
 </Text>
 <Text
 style={{
 fontFamily: fonts.mono,
 fontSize: width * 0.065,
 color: "rgba(184, 72, 58, 0.65)",
 letterSpacing: 2.5,
 marginTop: 2,
 }}
 >
 · 2026 ·
 </Text>
 </View>
 </View>
 </View>
 );
}

export const PostcardBackPreview = forwardRef<View, BackProps>(function PostcardBackPreview(
 { message, recipient, sender, width = DEFAULT_WIDTH, testID, reciprocationUrl, forPrint = false },
 ref,
) {
 const height = width / ASPECT_RATIO;

 // v0.7.0.28: when forPrint=true, render the Vintage Purist v2 layout
 // (matches design-mockups/postcard-back/C2-vintage-purist-v2.html).
 // This is the ONLY thing that ships to Lob's printer. The legacy
 // layout below (the LEFT/RIGHT half split with stamp + recipient
 // block + address guide lines) stays in place for the in-app preview
 // so the user sees a familiar postcard composition during compose.
 if (forPrint) {
 return (
 <View
 ref={ref}
 collapsable={false}
 style={[styles.cardOuter, backStyles.outer, { width, height, backgroundColor: "#FBF4DE" }]}
 testID={testID ?? "postcard-back-preview-print"}
 accessibilityRole="text"
 accessibilityLabel={`Postcard back to ${recipient.name}: ${message}`}
 >
 <PostcardBackPrintLayout
 width={width}
 height={height}
 message={message}
 sender={sender}
 reciprocationUrl={reciprocationUrl}
 />
 </View>
 );
 }

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

 {/* Vertical divider. slightly off-vertical for hand-drawn feel */}
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

 {/* LEFT HALF. message + (preview-only) return address line */}
 <View style={[backStyles.half, backStyles.leftHalf]}>
 {sender && !forPrint ? (
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

 {/* RIGHT HALF. stamp top-right (in the safe top zone) + (preview-
 only) recipient + USPS guide lines + postmark.

 v0.7.0.28: when forPrint=true, render ONLY the postage stamp.
 Everything else gets removed because Lob's auto-print covers
 the right column with the real recipient address, postal
 indicia, and IMb barcode. Our ink fighting Lob's = the
 duplicated-address / clipped-text mess shown in the test
 proof. */}
 <View style={[backStyles.half, backStyles.rightHalf]}>
 {/* Postage stamp. top-right corner. In forPrint mode this is
 the only thing we render on the right half; positioned in
 the top 1.625" safe zone (where Lob allows designer ink). */}
 <View style={backStyles.stampWrap}>
 <PostageStamp size={Math.max(38, width * 0.14)} />
 </View>

 {!forPrint ? (
 <>
 {/* Postmark. circular ink stamp, slightly off-register over the stamp */}
 <View style={[backStyles.postmarkWrap, { width: Math.max(46, width * 0.18) }]}>
 <PostmarkCircle size={Math.max(46, width * 0.18)} />
 </View>

 {/* Recipient address block. centered in the safe area */}
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
 {recipient.zip ? ` ${recipient.zip}` : ""}
 </Text>
 </View>

 {/* USPS address guide lines. bottom 5 lines */}
 <View style={backStyles.addressLines}>
 {[0, 1, 2, 3, 4].map((i) => (
 <View key={i} style={backStyles.addressGuideLine} />
 ))}
 </View>
 </>
 ) : null}

 {/* Reciprocation QR. forPrint mode: skip entirely. even in the
 top zone the QR's caption "Scan to reply free →" would risk
 clipping by Lob's indicia. Preview only. (We can wire a
 forPrint-safe QR back in once we've verified clean prints
 without it.) */}
 {reciprocationUrl && !forPrint ? (
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
// Postage stamp. drawn as SVG with perforation edges + dove motif
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
 {/* Perforated edge ring. small circles around perimeter to simulate stamp cut */}
 <G fill="#F8F1E3">
 {Array.from({ length: 12 }).map((_, i) => {
 const angle = (i / 12) * 360;
 const rad = (angle * Math.PI) / 180;
 const cx = 50 + 47 * Math.cos(rad);
 const cy = 50 + 47 * Math.sin(rad);
 return <Circle key={`p-${i}`} cx={cx} cy={cy} r={3.5} />;
 })}
 </G>
 {/* Inner stamp body. postal red */}
 <Rect x="8" y="8" width="84" height="84" fill={colors.postalRed} stroke="#7A2218" strokeWidth={0.8} />
 {/* Paper texture inside the stamp body */}
 <Rect x="14" y="14" width="72" height="72" fill={colors.postalRed} />
 {/* Mailroom dove motif. simplified flying bird */}
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
// Postmark. circular ink stamp, hand-applied look
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
 // border (~2.4% of width on all four sides). distinct enough to
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
 // Reciprocation QR. bottom-right corner. Sits inside its own white card
 // so contrast against the postal-paper background is high enough to scan
 // cleanly even on cheap printers. The caption is a quiet italic so it
 // reads as an invitation, not a coupon.
 qrWrap: { alignItems: "center", bottom: 6, gap: 2, position: "absolute", right: 6 },
 qrInner: { backgroundColor: "#FFFDF7", borderColor: colors.line, borderRadius: 2, borderWidth: StyleSheet.hairlineWidth },
 qrCaption: { color: colors.mutedInk, fontFamily: fonts.serifItalic, marginTop: 2 },
});
