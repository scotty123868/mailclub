import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Defs, G, Line, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";
import { colors, gradients } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { CircularPostmark } from "./PostmarkDecoration";

const nodes = [
  { id: "you", label: "You", x: 205, y: 230, r: 12, labelDx: 0, labelDy: 32 },
  { id: "tatiana", label: "Tatiana", x: 90, y: 110, r: 7, labelDx: 0, labelDy: -14 },
  { id: "alex", label: "Alex", x: 308, y: 110, r: 7, labelDx: 0, labelDy: -14 },
  { id: "maya", label: "Maya", x: 76, y: 268, r: 7, labelDx: -28, labelDy: 4 },
  { id: "ben", label: "Ben", x: 332, y: 228, r: 7, labelDx: 14, labelDy: 4 },
  { id: "sam", label: "Sam", x: 168, y: 340, r: 7, labelDx: -22, labelDy: 4 },
  { id: "nora", label: "Nora", x: 320, y: 326, r: 7, labelDx: 14, labelDy: 4 },
  { id: "a", label: "", x: 162, y: 162, r: 3, labelDx: 0, labelDy: 0 },
  { id: "b", label: "", x: 255, y: 170, r: 3, labelDx: 0, labelDy: 0 },
  { id: "c", label: "", x: 312, y: 168, r: 3, labelDx: 0, labelDy: 0 },
  { id: "d", label: "", x: 110, y: 200, r: 3, labelDx: 0, labelDy: 0 },
];

const edges: [string, string][] = [
  ["you", "tatiana"], ["you", "alex"], ["you", "maya"], ["you", "ben"], ["you", "sam"], ["you", "nora"],
  ["tatiana", "a"], ["a", "alex"], ["alex", "b"], ["b", "c"], ["c", "ben"], ["maya", "sam"], ["sam", "nora"], ["d", "tatiana"], ["d", "you"],
];

function Star({ cx, cy, r, glow = true }: { cx: number; cy: number; r: number; glow?: boolean }) {
  return (
    <G>
      {glow && <Circle cx={cx} cy={cy} r={r + 12} fill="url(#starglow)" opacity={0.7} />}
      <Path
        d={`M ${cx} ${cy - r * 1.6} L ${cx + r * 0.4} ${cy - r * 0.4} L ${cx + r * 1.6} ${cy} L ${cx + r * 0.4} ${cy + r * 0.4} L ${cx} ${cy + r * 1.6} L ${cx - r * 0.4} ${cy + r * 0.4} L ${cx - r * 1.6} ${cy} L ${cx - r * 0.4} ${cy - r * 0.4} Z`}
        fill="#FFE6A6"
      />
      <Circle cx={cx} cy={cy} r={r * 0.4} fill="#FFFFFF" />
    </G>
  );
}

export function ConstellationPanel({ compact = false }: { compact?: boolean }) {
  const height = compact ? 180 : 480;
  const find = (id: string) => nodes.find((n) => n.id === id)!;
  return (
    <LinearGradient colors={gradients.night} style={[styles.panel, { height }]}>
      <Svg width="100%" height="100%" viewBox="0 0 410 420" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="starglow" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor="#FFE6A6" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#FFE6A6" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="vignette" cx="50%" cy="50%" rx="70%" ry="70%">
            <Stop offset="0" stopColor="#000" stopOpacity={0} />
            <Stop offset="1" stopColor="#000" stopOpacity={0.45} />
          </RadialGradient>
        </Defs>

        {Array.from({ length: compact ? 36 : 140 }).map((_, i) => {
          const x = ((i * 73.13) % 400) + 5;
          const y = ((i * 43.7) % 410) + 6;
          const r = i % 9 === 0 ? 1.6 : i % 4 === 0 ? 1 : 0.55;
          const fill = i % 11 === 0 ? colors.gold : "#FFF6D6";
          const op = i % 4 === 0 ? 0.85 : 0.4;
          return <Circle key={i} cx={x} cy={y} r={r} fill={fill} opacity={op} />;
        })}

        {edges.map(([from, to]) => {
          const a = find(from);
          const b = find(to);
          return <Line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#F5D892" strokeWidth={0.8} opacity={0.5} strokeDasharray="2 3" />;
        })}

        {nodes.filter((n) => !n.label).map((n) => (
          <Circle key={n.id} cx={n.x} cy={n.y} r={n.r * 1.2} fill="#FFE6A6" opacity={0.85} />
        ))}

        {nodes.filter((n) => n.label).map((n) => (
          <Star key={n.id} cx={n.x} cy={n.y} r={n.r} glow />
        ))}

        {!compact && nodes.filter((n) => n.label).map((n) => {
          const anchor = n.labelDx < 0 ? "end" : n.labelDx > 0 ? "start" : "middle";
          return (
            <SvgText
              key={`${n.id}-label`}
              x={n.x + n.labelDx}
              y={n.y + n.labelDy}
              textAnchor={anchor}
              fill="#FFE6A6"
              fontSize={n.id === "you" ? 22 : 16}
              fontFamily="CormorantGaramond_500Medium_Italic"
            >
              {n.label}
            </SvgText>
          );
        })}

        <Path d="M 0 360 Q 100 350, 205 358 Q 300 364, 410 350 L 410 420 L 0 420 Z" fill="rgba(0,0,0,0.35)" />

        <Rect width="410" height="420" fill="url(#vignette)" />
      </Svg>

      {!compact && (
        <View style={styles.titleWrap} pointerEvents="none">
          <Text style={styles.poem}>The people who{"\n"}light up your world.</Text>
          <View style={styles.flourish}>
            <Svg width={120} height={10} viewBox="0 0 120 10">
              <Path d="M 0 5 Q 30 1, 58 5 L 60 2 L 62 5 Q 90 9, 120 5" stroke="#D9B46E" strokeWidth={0.9} fill="none" />
            </Svg>
          </View>
        </View>
      )}

      {!compact && (
        <View style={styles.bottomWrap} pointerEvents="none">
          <Svg width={20} height={26} viewBox="0 0 20 26">
            <Path d="M 6 24 Q 0 18, 4 8 Q 8 4, 10 12 Q 12 4, 16 8 Q 20 18, 14 24" stroke="#D9B46E" strokeWidth={1} fill="none" opacity={0.7} />
          </Svg>
          <Text style={styles.earned}>Every star was earned{"\n"}by a real send.</Text>
          <Svg width={20} height={26} viewBox="0 0 20 26">
            <Path d="M 14 24 Q 20 18, 16 8 Q 12 4, 10 12 Q 8 4, 4 8 Q 0 18, 6 24" stroke="#D9B46E" strokeWidth={1} fill="none" opacity={0.7} />
          </Svg>
        </View>
      )}

      {!compact && (
        <View style={styles.postmarkWrap} pointerEvents="none">
          <CircularPostmark size={86} color="#D9B46E" opacity={0.45} />
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 8, overflow: "hidden", paddingTop: 26 },
  titleWrap: { alignItems: "center", paddingTop: 6 },
  poem: { color: "#FFFFFF", fontFamily: fonts.serif, fontSize: 30, lineHeight: 38, textAlign: "center", letterSpacing: 0.3 },
  flourish: { marginTop: 8 },
  bottomWrap: { alignItems: "center", flexDirection: "row", gap: 12, justifyContent: "center", left: 0, position: "absolute", bottom: 24, right: 0 },
  earned: { color: "rgba(255,255,255,0.92)", fontFamily: fonts.serifItalic, fontSize: 16, lineHeight: 22, textAlign: "center" },
  postmarkWrap: { position: "absolute", right: 12, top: 12 },
});
