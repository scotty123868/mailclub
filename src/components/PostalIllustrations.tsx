import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { colors } from "@/src/theme/colors";

export { Stamp as StampArt } from "./Stamp";

export function MiniPostcardArt({ variant = "mountain" }: { variant?: "mountain" | "city" | "coast" | "night" }) {
 const palette = {
 mountain: { sky: "#D6CDB0", land: "#5E7A6E", accent: "#B7935A", detail: "#2E2A22" },
 city: { sky: "#CFC2A0", land: "#3C6E8F", accent: "#9BAF9B", detail: "#1F2D44" },
 coast: { sky: "#BFD8D6", land: "#3C6E8F", accent: "#B84A3A", detail: "#21364B" },
 night: { sky: "#0F1A33", land: "#243558", accent: "#D9B46E", detail: "#F2E2B6" },
 }[variant];

 return (
 <View style={styles.postcardArt}>
 <Svg width="100%" height="100%" viewBox="0 0 104 64">
 <Defs>
 <LinearGradient id={`g-${variant}`} x1="0" y1="0" x2="0" y2="1">
 <Stop offset="0" stopColor={palette.sky} />
 <Stop offset="1" stopColor={palette.land} stopOpacity={0.55} />
 </LinearGradient>
 </Defs>
 <Rect width="104" height="64" rx="3" fill={`url(#g-${variant})`} />
 {variant === "mountain" && (
 <G>
 <Path d="M 0 50 L 18 28 L 28 38 L 42 22 L 56 36 L 70 26 L 88 42 L 104 32 L 104 64 L 0 64 Z" fill={palette.land} opacity={0.92} />
 <Path d="M 36 30 L 42 22 L 48 30 Z M 64 32 L 70 26 L 76 32 Z" fill="#FFF8E9" opacity={0.85} />
 <Circle cx={86} cy={14} r={5} fill={palette.accent} />
 <Path d="M 6 50 L 8 44 L 10 50 Z M 14 48 L 16 42 L 18 48 Z" fill={palette.detail} opacity={0.8} />
 </G>
 )}
 {variant === "city" && (
 <G>
 <Path d="M 0 50 L 12 50 L 12 38 L 22 38 L 22 30 L 32 30 L 32 42 L 44 42 L 44 26 L 56 26 L 56 36 L 68 36 L 68 22 L 80 22 L 80 40 L 92 40 L 92 32 L 104 32 L 104 64 L 0 64 Z" fill={palette.land} opacity={0.92} />
 <Path d="M 18 33 L 18 36 M 26 32 L 26 36 M 36 35 L 36 38 M 48 30 L 48 33 M 60 30 L 60 33 M 72 26 L 72 30 M 84 26 L 84 30" stroke="#FFF8E9" strokeWidth={1} opacity={0.7} />
 <Circle cx={84} cy={14} r={4} fill={palette.accent} />
 </G>
 )}
 {variant === "coast" && (
 <G>
 <Path d="M 0 38 Q 26 36, 52 40 T 104 38 L 104 64 L 0 64 Z" fill={palette.land} opacity={0.85} />
 <Path d="M 10 42 Q 24 40, 38 44 M 44 46 Q 60 42, 80 46 M 12 50 Q 30 48, 50 52 M 60 52 Q 78 50, 96 54" stroke="#FFF8E9" strokeWidth={0.7} fill="none" opacity={0.6} />
 <Path d="M 70 28 L 74 16 L 80 28 Z" fill={palette.detail} />
 <Path d="M 76 16 L 76 14 L 84 18 L 76 22 Z" fill={palette.accent} />
 </G>
 )}
 {variant === "night" && (
 <G>
 <Path d="M 60 14 A 8 8 0 1 0 60 30 A 6 6 0 1 1 60 14 Z" fill={palette.accent} />
 {[
 { x: 14, y: 12 }, { x: 30, y: 8 }, { x: 44, y: 16 }, { x: 80, y: 10 }, { x: 94, y: 22 }, { x: 24, y: 22 }, { x: 8, y: 26 },
 ].map((s, i) => (
 <Circle key={i} cx={s.x} cy={s.y} r={i % 3 === 0 ? 1 : 0.6} fill={palette.detail} />
 ))}
 <Path d="M 0 50 L 22 32 L 36 44 L 56 28 L 72 42 L 92 30 L 104 44 L 104 64 L 0 64 Z" fill={palette.land} opacity={0.95} />
 </G>
 )}
 </Svg>
 </View>
 );
}

export function PhoneConnectArt() {
 return (
 <View style={styles.phoneWrap}>
 <Svg width="100%" height="100%" viewBox="0 0 240 150">
 <Defs>
 <LinearGradient id="bg-phone" x1="0" y1="0" x2="0" y2="1">
 <Stop offset="0" stopColor="#F2EAD3" />
 <Stop offset="1" stopColor="#E0D2B5" stopOpacity={0.4} />
 </LinearGradient>
 </Defs>

 {/* Left figure (beanie person) */}
 <G>
 <Path d="M 18 90 Q 22 60, 50 60 Q 74 62, 76 92 L 76 150 L 14 150 Z" fill="#3C5A6F" />
 <Path d="M 24 86 Q 30 76, 50 78 Q 70 76, 76 92" fill="none" stroke="#21364B" strokeWidth={1.2} opacity={0.6} />
 <Path d="M 36 56 Q 36 40, 52 38 Q 70 38, 70 56 Q 70 70, 56 70 Q 42 70, 36 56 Z" fill="#C8A88A" />
 <Path d="M 32 50 Q 32 28, 52 26 Q 74 28, 74 50 L 74 56 Q 60 42, 36 56 Z" fill="#A23F2C" />
 <Path d="M 60 32 Q 64 22, 70 32" fill="none" stroke="#F2E2B6" strokeWidth={1.2} strokeLinecap="round" />
 <Circle cx={70} cy={32} r={2.5} fill="#F2E2B6" />
 </G>

 {/* Right figure (backpack person) */}
 <G>
 <Path d="M 158 92 Q 164 62, 192 60 Q 220 60, 224 92 L 224 150 L 154 150 Z" fill="#7A5A3C" />
 <Path d="M 178 86 Q 196 78, 220 90" fill="none" stroke="#3F2E1F" strokeWidth={1.2} opacity={0.6} />
 <Path d="M 168 86 L 158 110 L 168 134 L 178 124 Z" fill="#5E4630" />
 <Path d="M 176 56 Q 176 40, 192 38 Q 210 38, 210 56 Q 210 70, 196 70 Q 182 70, 176 56 Z" fill="#C8A88A" />
 <Path d="M 172 50 Q 172 26, 196 24 Q 218 28, 216 52 Q 200 36, 178 50 Q 174 46, 172 50 Z" fill="#3F2E1F" />
 </G>

 {/* Phones */}
 <G>
 <Rect x={68} y={70} width={26} height={46} rx={4} fill="#17223B" transform="rotate(-12 81 93)" />
 <Rect x={71} y={73} width={20} height={36} rx={2} fill="#F2EAD3" transform="rotate(-12 81 91)" />
 <Rect x={146} y={68} width={26} height={46} rx={4} fill="#17223B" transform="rotate(12 159 91)" />
 <Rect x={149} y={71} width={20} height={36} rx={2} fill="#F2EAD3" transform="rotate(12 159 89)" />
 </G>

 {/* Mailroom logo radiating between */}
 <G>
 <Path d="M 100 40 Q 120 22, 140 40" stroke="#B84A3A" strokeWidth={1.4} fill="none" strokeDasharray="4 4" opacity={0.85} />
 <Path d="M 100 96 Q 120 110, 140 96" stroke="#B84A3A" strokeWidth={1.4} fill="none" strokeDasharray="4 4" opacity={0.85} />
 <Rect x={100} y={56} width={40} height={28} rx={2} fill="#FFF8E9" stroke="#D9C8AC" strokeWidth={1} />
 <Path d="M 102 60 L 120 72 L 138 60 L 138 82 L 102 82 Z" fill="none" stroke="#17223B" strokeWidth={1.1} />
 <Path d="M 102 60 L 120 72 L 138 60" stroke="#17223B" strokeWidth={1.1} fill="none" />
 <Path d="M 96 50 L 110 50 M 130 50 L 144 50" stroke="#B84A3A" strokeWidth={1} opacity={0.7} />
 <Path d="M 92 70 L 102 70 M 138 70 L 148 70" stroke="#B84A3A" strokeWidth={1} opacity={0.7} />
 </G>
 </Svg>
 </View>
 );
}

const styles = StyleSheet.create({
 postcardArt: { borderColor: colors.line, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, height: 64, overflow: "hidden", width: 100 },
 phoneWrap: { alignSelf: "flex-end", height: 130, marginTop: -56, width: "54%" },
});
