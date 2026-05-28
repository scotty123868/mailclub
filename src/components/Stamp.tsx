import { StyleSheet, View, ViewStyle } from "react-native";
import Svg, { Circle, Defs, G, Mask, Path, Rect, Text as SvgText } from "react-native-svg";
import { colors } from "@/src/theme/colors";

type Motif = "dove" | "botanical" | "mountain" | "lighthouse" | "moon" | "compass";
type Tone = "red" | "sage" | "blue" | "gold" | "night";

const PALETTES: Record<Tone, { paper: string; ink: string; accent: string }> = {
 red: { paper: "#F1D7C9", ink: "#8C2A1F", accent: "#3C2A24" },
 sage: { paper: "#D9DEC4", ink: "#4A5A38", accent: "#3F2E1F" },
 blue: { paper: "#CEDBE3", ink: "#23475F", accent: "#3F2E1F" },
 gold: { paper: "#E8D7B0", ink: "#7A5A1B", accent: "#3F2E1F" },
 night: { paper: "#22324A", ink: "#E5D8B0", accent: "#F2E2B6" },
};

function Perforation({ width, height, fill }: { width: number; height: number; fill: string }) {
 // Build a clip path with circular notches around the rect to simulate perforations
 const step = 6;
 const r = 2.4;
 const cuts: { cx: number; cy: number }[] = [];
 for (let x = step / 2; x < width; x += step) {
 cuts.push({ cx: x, cy: 0 });
 cuts.push({ cx: x, cy: height });
 }
 for (let y = step / 2; y < height; y += step) {
 cuts.push({ cx: 0, cy: y });
 cuts.push({ cx: width, cy: y });
 }
 return (
 <G>
 <Rect width={width} height={height} fill={fill} />
 {cuts.map((c, i) => (
 <Circle key={i} cx={c.cx} cy={c.cy} r={r} fill={colors.paper} />
 ))}
 </G>
 );
}

function Motif({ motif, palette, w, h }: { motif: Motif; palette: typeof PALETTES.red; w: number; h: number }) {
 const cx = w / 2;
 const cy = h / 2 - 4;
 const ink = palette.ink;
 switch (motif) {
 case "dove":
 return (
 <G>
 <Path d={`M ${cx - 16} ${cy + 4} Q ${cx - 6} ${cy - 14}, ${cx + 8} ${cy - 6} L ${cx + 16} ${cy - 8} L ${cx + 12} ${cy - 1} L ${cx + 18} ${cy + 1} L ${cx + 9} ${cy + 5} Q ${cx} ${cy + 9}, ${cx - 16} ${cy + 4} Z`} fill={ink} />
 <Path d={`M ${cx - 6} ${cy + 1} Q ${cx - 14} ${cy - 8}, ${cx - 22} ${cy - 4} Q ${cx - 14} ${cy - 2}, ${cx - 7} ${cy + 4} Z`} fill={ink} opacity={0.85} />
 <Circle cx={cx + 13} cy={cy - 6} r={0.9} fill={palette.paper} />
 </G>
 );
 case "botanical":
 return (
 <G stroke={ink} strokeWidth={1.1} fill="none" strokeLinecap="round">
 <Path d={`M ${cx} ${cy + 18} L ${cx} ${cy - 16}`} />
 {[-12, -7, -2, 3, 8].map((dy, i) => {
 const side = i % 2 === 0 ? -1 : 1;
 const len = 10 - Math.abs(dy) * 0.25;
 return (
 <Path key={dy} d={`M ${cx} ${cy + dy} Q ${cx + side * len * 0.5} ${cy + dy - 3}, ${cx + side * len} ${cy + dy - 6}`} />
 );
 })}
 <Circle cx={cx} cy={cy - 18} r={1.6} fill={ink} stroke="none" />
 </G>
 );
 case "mountain":
 return (
 <G>
 <Path d={`M ${cx - 22} ${cy + 14} L ${cx - 6} ${cy - 10} L ${cx + 2} ${cy - 2} L ${cx + 12} ${cy - 16} L ${cx + 24} ${cy + 14} Z`} fill={ink} />
 <Path d={`M ${cx - 9} ${cy - 6} L ${cx - 6} ${cy - 10} L ${cx - 3} ${cy - 6} Z M ${cx + 9} ${cy - 12} L ${cx + 12} ${cy - 16} L ${cx + 15} ${cy - 12} Z`} fill={palette.paper} />
 <Circle cx={cx + 16} cy={cy - 18} r={3} fill={palette.accent} opacity={0.55} />
 </G>
 );
 case "lighthouse":
 return (
 <G>
 <Path d={`M ${cx - 5} ${cy + 16} L ${cx - 4} ${cy - 6} L ${cx + 4} ${cy - 6} L ${cx + 5} ${cy + 16} Z`} fill={ink} />
 <Rect x={cx - 6} y={cy - 8} width={12} height={2.5} fill={ink} />
 <Path d={`M ${cx - 4} ${cy - 8} L ${cx - 4} ${cy - 14} L ${cx + 4} ${cy - 14} L ${cx + 4} ${cy - 8} Z`} fill={palette.paper} stroke={ink} strokeWidth={0.8} />
 <Path d={`M ${cx - 3} ${cy - 14} L ${cx} ${cy - 18} L ${cx + 3} ${cy - 14} Z`} fill={ink} />
 <Path d={`M ${cx - 14} ${cy + 16} Q ${cx} ${cy + 12}, ${cx + 14} ${cy + 16}`} stroke={ink} strokeWidth={0.9} fill="none" opacity={0.5} />
 </G>
 );
 case "moon":
 return (
 <G>
 <Path d={`M ${cx + 10} ${cy - 12} A 14 14 0 1 0 ${cx + 10} ${cy + 16} A 11 11 0 1 1 ${cx + 10} ${cy - 12} Z`} fill={ink} />
 <Circle cx={cx - 14} cy={cy - 12} r={1.1} fill={ink} />
 <Circle cx={cx - 18} cy={cy + 4} r={0.9} fill={ink} />
 <Circle cx={cx - 8} cy={cy + 14} r={0.9} fill={ink} />
 </G>
 );
 case "compass":
 return (
 <G>
 <Circle cx={cx} cy={cy} r={14} stroke={ink} strokeWidth={1.1} fill="none" />
 <Path d={`M ${cx} ${cy - 14} L ${cx + 3} ${cy} L ${cx} ${cy + 14} L ${cx - 3} ${cy} Z`} fill={ink} />
 <Path d={`M ${cx - 14} ${cy} L ${cx} ${cy + 3} L ${cx + 14} ${cy} L ${cx} ${cy - 3} Z`} fill={ink} opacity={0.4} />
 <Circle cx={cx} cy={cy} r={1.5} fill={palette.paper} stroke={ink} strokeWidth={0.6} />
 </G>
 );
 }
}

export function Stamp({
 motif = "dove",
 tone = "red",
 cents = "5¢",
 size = "md",
 rotate = -4,
 style,
}: {
 motif?: Motif;
 tone?: Tone;
 cents?: string;
 size?: "sm" | "md" | "lg";
 rotate?: number;
 style?: ViewStyle;
}) {
 const palette = PALETTES[tone];
 const dims = size === "sm" ? { w: 44, h: 56 } : size === "lg" ? { w: 78, h: 96 } : { w: 60, h: 76 };
 const padding = 6;
 const innerW = dims.w - padding * 2;
 const innerH = dims.h - padding * 2;

 return (
 <View style={[{ transform: [{ rotate: `${rotate}deg` }] }, styles.shadow, style]}>
 <Svg width={dims.w} height={dims.h} viewBox={`0 0 ${dims.w} ${dims.h}`}>
 <Defs>
 <Mask id="perf">
 <Rect width={dims.w} height={dims.h} fill="white" />
 {Array.from({ length: Math.ceil(dims.w / 6) + 1 }).map((_, i) => (
 <Circle key={`t${i}`} cx={i * 6 + 3} cy={0} r={2.4} fill="black" />
 ))}
 {Array.from({ length: Math.ceil(dims.w / 6) + 1 }).map((_, i) => (
 <Circle key={`b${i}`} cx={i * 6 + 3} cy={dims.h} r={2.4} fill="black" />
 ))}
 {Array.from({ length: Math.ceil(dims.h / 6) + 1 }).map((_, i) => (
 <Circle key={`l${i}`} cx={0} cy={i * 6 + 3} r={2.4} fill="black" />
 ))}
 {Array.from({ length: Math.ceil(dims.h / 6) + 1 }).map((_, i) => (
 <Circle key={`r${i}`} cx={dims.w} cy={i * 6 + 3} r={2.4} fill="black" />
 ))}
 </Mask>
 </Defs>
 <G mask="url(#perf)">
 <Rect width={dims.w} height={dims.h} fill={palette.paper} />
 <Rect x={padding - 1} y={padding - 1} width={innerW + 2} height={innerH + 2} stroke={palette.ink} strokeWidth={0.6} fill="none" />
 <Rect x={padding + 1} y={padding + 1} width={innerW - 2} height={innerH - 2} stroke={palette.ink} strokeWidth={0.4} fill="none" opacity={0.5} />
 <G transform={`translate(${padding} ${padding})`}>
 <Motif motif={motif} palette={palette} w={innerW} h={innerH} />
 </G>
 <SvgText
 x={dims.w / 2}
 y={dims.h - 9}
 textAnchor="middle"
 fontSize={size === "sm" ? 6.5 : 9}
 fill={palette.ink}
 fontWeight="700"
 fontFamily="Inter_700Bold"
 letterSpacing={size === "sm" ? 0.15 : 0.4}
 >
 MAILROOM
 </SvgText>
 <SvgText
 x={padding + 4}
 y={padding + 11}
 fontSize={size === "sm" ? 9 : 10}
 fill={palette.ink}
 fontWeight="700"
 fontFamily="CormorantGaramond_700Bold"
 >
 {cents}
 </SvgText>
 </G>
 </Svg>
 </View>
 );
}

const styles = StyleSheet.create({
 shadow: {
 shadowColor: "#2B2115",
 shadowOffset: { width: 1, height: 2 },
 shadowOpacity: 0.18,
 shadowRadius: 3,
 },
});
