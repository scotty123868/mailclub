import { StyleSheet, View, ViewStyle } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { colors } from "@/src/theme/colors";

export type AvatarLook = "scotty" | "tatiana" | "alex" | "maya" | "nora" | "ben" | "sam";

const LOOKS: Record<AvatarLook, { skin: string; hair: string; cap: string; accent: string }> = {
 scotty: { skin: "#1A2640", hair: "#1A2640", cap: "#1A2640", accent: "#9BB3CB" },
 tatiana: { skin: "#3A2A24", hair: "#1F1410", cap: "#A23F2C", accent: "#D9B46E" },
 alex: { skin: "#2A2030", hair: "#15101A", cap: "#1F2D44", accent: "#9BAF9B" },
 maya: { skin: "#2D1F18", hair: "#0F0A07", cap: "#3C6E8F", accent: "#D9B46E" },
 nora: { skin: "#3A2820", hair: "#221610", cap: "#9BAF9B", accent: "#D9B46E" },
 ben: { skin: "#2B2018", hair: "#15100B", cap: "#3C6E8F", accent: "#B84A3A" },
 sam: { skin: "#1F2435", hair: "#0E1220", cap: "#5E6472", accent: "#D9B46E" },
};

function ScottyScene({ palette }: { palette: typeof LOOKS.scotty }) {
 return (
 <G>
 <Rect x={0} y={64} width={122} height={58} fill="#E5DBC4" />
 <Path d="M -2 100 L 14 78 L 28 92 L 44 70 L 60 88 L 122 102 L 122 122 L -2 122 Z" fill={palette.accent} opacity={0.7} />
 <Path d="M -2 110 L 22 90 L 40 102 L 60 84 L 82 100 L 122 92 L 122 122 L -2 122 Z" fill={palette.cap} />
 <Path d="M 60 50 Q 60 28, 82 28 Q 98 28, 98 50 L 98 64 L 60 64 Z" fill={palette.skin} />
 <Path d="M 56 38 Q 60 18, 82 18 Q 100 18, 102 38 L 102 50 Q 88 36, 60 50 Z" fill={palette.cap} />
 <Path d="M 86 22 Q 92 8, 98 22" fill="none" stroke={palette.accent} strokeWidth={1.5} strokeLinecap="round" />
 <Circle cx={97} cy={22} r={3} fill={palette.accent} />
 <Path d="M 50 78 Q 70 70, 82 70 Q 96 70, 116 80 L 116 122 L 50 122 Z" fill={palette.cap} />
 </G>
 );
}

function GenericPortrait({ palette, look }: { palette: typeof LOOKS.scotty; look: AvatarLook }) {
 return (
 <G>
 <Rect x={0} y={68} width={122} height={56} fill="#EFE5CE" />
 <Path d="M 0 102 L 24 86 L 40 100 L 60 82 L 76 98 L 100 88 L 122 96 L 122 122 L 0 122 Z" fill={palette.cap} opacity={0.55} />
 {look === "tatiana" && (
 <G>
 <Path d="M 56 56 Q 56 32, 80 32 Q 100 32, 100 56 L 100 76 Q 86 70, 60 76 Z" fill={palette.skin} />
 <Path d="M 50 50 Q 50 22, 80 20 Q 110 22, 108 56 Q 102 38, 92 36 Q 86 50, 80 50 Q 70 50, 60 60 Q 56 50, 50 50 Z" fill={palette.hair} />
 <Path d="M 48 38 Q 60 18, 90 22 Q 106 28, 102 42 Q 92 32, 80 32 Q 64 30, 56 42 Z" fill={palette.cap} />
 </G>
 )}
 {look === "alex" && (
 <G>
 <Path d="M 58 56 Q 58 34, 82 34 Q 100 34, 100 56 L 100 76 Q 86 72, 62 76 Z" fill={palette.skin} />
 <Path d="M 56 44 Q 56 26, 84 24 Q 102 26, 100 50 Q 92 38, 82 38 Q 68 38, 60 50 Z" fill={palette.hair} />
 <Path d="M 54 36 Q 60 22, 88 24 Q 104 26, 102 38 Q 96 32, 80 32 Q 66 32, 58 40 Z" fill={palette.cap} />
 </G>
 )}
 {look === "maya" && (
 <G>
 <Path d="M 56 58 Q 56 34, 82 34 Q 100 34, 100 58 L 100 78 Q 84 72, 60 76 Z" fill={palette.skin} />
 <Path d="M 50 56 Q 50 28, 84 26 Q 106 30, 104 56 Q 96 36, 84 36 Q 66 38, 56 56 Z" fill={palette.hair} />
 <Circle cx={102} cy={36} r={9} fill={palette.hair} />
 </G>
 )}
 {look === "nora" && (
 <G>
 <Path d="M 56 56 Q 56 32, 82 32 Q 100 32, 100 56 L 100 78 Q 86 72, 62 76 Z" fill={palette.skin} />
 <Path d="M 48 50 Q 48 24, 84 22 Q 110 26, 108 60 Q 100 84, 86 96 Q 70 86, 60 80 Q 50 70, 48 50 Z" fill={palette.hair} />
 </G>
 )}
 {(look === "ben" || look === "sam") && (
 <G>
 <Path d="M 56 56 Q 56 34, 82 34 Q 100 34, 100 56 L 100 76 Q 86 72, 62 76 Z" fill={palette.skin} />
 <Path d="M 56 44 Q 56 26, 84 24 Q 102 26, 100 50 Q 92 38, 82 38 Q 68 38, 60 50 Z" fill={palette.hair} />
 </G>
 )}
 <Path d="M 46 80 Q 70 70, 82 70 Q 98 70, 118 82 L 118 122 L 46 122 Z" fill={palette.cap} />
 </G>
 );
}

export function IllustratedAvatar({
 look = "scotty",
 size = 64,
 ring = true,
 style,
}: {
 look?: AvatarLook;
 size?: number;
 ring?: boolean;
 style?: ViewStyle;
}) {
 const palette = LOOKS[look as AvatarLook] ?? LOOKS.sam;
 return (
 <View style={[{ width: size, height: size }, style]}>
 <Svg width={size} height={size} viewBox="0 0 122 122">
 <Defs>
 <ClipPath id={`round-${look}-${size}`}>
 <Circle cx={61} cy={61} r={60} />
 </ClipPath>
 <LinearGradient id={`sky-${look}-${size}`} x1="0" y1="0" x2="0" y2="1">
 <Stop offset="0" stopColor="#F2EAD3" />
 <Stop offset="1" stopColor="#E0D2B5" />
 </LinearGradient>
 </Defs>
 <G clipPath={`url(#round-${look}-${size})`}>
 <Rect width={122} height={122} fill={`url(#sky-${look}-${size})`} />
 {look === "scotty" ? (
 <ScottyScene palette={palette} />
 ) : (
 <GenericPortrait palette={palette} look={look} />
 )}
 </G>
 {ring ? <Circle cx={61} cy={61} r={59} stroke={colors.line} strokeWidth={1.5} fill="none" /> : null}
 </Svg>
 </View>
 );
}
