import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { colors, gradients } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

const nodes = [
  { id: "you", label: "You", x: 195, y: 220, r: 10 },
  { id: "tatiana", label: "Tatiana", x: 88, y: 96, r: 7 },
  { id: "alex", label: "Alex", x: 286, y: 98, r: 7 },
  { id: "maya", label: "Maya", x: 112, y: 268, r: 7 },
  { id: "ben", label: "Ben", x: 352, y: 232, r: 7 },
  { id: "sam", label: "Sam", x: 190, y: 324, r: 7 },
  { id: "nora", label: "Nora", x: 314, y: 324, r: 7 },
  { id: "a", label: "", x: 162, y: 143, r: 4 },
  { id: "b", label: "", x: 255, y: 160, r: 4 },
  { id: "c", label: "", x: 337, y: 168, r: 4 },
  { id: "d", label: "", x: 73, y: 174, r: 4 },
];

const edges = [["you", "tatiana"], ["you", "alex"], ["you", "maya"], ["you", "ben"], ["you", "sam"], ["you", "nora"], ["tatiana", "a"], ["a", "alex"], ["alex", "b"], ["b", "c"], ["c", "ben"], ["maya", "sam"], ["sam", "nora"], ["d", "tatiana"], ["d", "you"]];

export function ConstellationPanel({ compact = false }: { compact?: boolean }) {
  const height = compact ? 180 : 500;
  const find = (id: string) => nodes.find((node) => node.id === id)!;
  return (
    <LinearGradient colors={gradients.night} style={[styles.panel, { height }]}>
      <Text style={styles.poem}>The people who{"\n"}light up your world.</Text>
      <Svg width="100%" height="100%" viewBox="0 0 410 420" style={StyleSheet.absoluteFill}>
        {Array.from({ length: compact ? 32 : 90 }).map((_, index) => (
          <Circle key={index} cx={(index * 47) % 400 + 5} cy={(index * 83) % 390 + 12} r={index % 7 === 0 ? 1.4 : 0.7} fill={index % 5 === 0 ? colors.gold : "#FFF6D6"} opacity={index % 4 === 0 ? 0.7 : 0.35} />
        ))}
        {edges.map(([from, to]) => {
          const a = find(from);
          const b = find(to);
          return <Line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#F5D892" strokeWidth="1" opacity="0.55" />;
        })}
        {nodes.map((node) => (
          <Circle key={node.id} cx={node.x} cy={node.y} r={node.r + 8} fill={colors.gold} opacity={node.id === "you" ? 0.2 : 0.1} />
        ))}
        {nodes.map((node) => (
          <Circle key={`${node.id}-core`} cx={node.x} cy={node.y} r={node.r} fill="#FFE6A6" />
        ))}
        {!compact && nodes.filter((node) => node.label).map((node) => (
          <SvgText key={`${node.id}-label`} x={node.x + 13} y={node.y + 7} fill="#FFE6A6" fontSize={node.id === "you" ? 19 : 17} fontFamily="Georgia">{node.label}</SvgText>
        ))}
      </Svg>
      {!compact ? <View style={styles.horizon} /> : null}
      {!compact ? <Text style={styles.earned}>Every star was earned{"\n"}by a real send.</Text> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: 8, overflow: "hidden", paddingTop: 34 },
  poem: { color: colors.white, fontFamily: fonts.serif, fontSize: 25, lineHeight: 33, textAlign: "center", zIndex: 1 },
  horizon: { backgroundColor: "rgba(0,0,0,0.18)", bottom: 0, height: 80, left: 0, position: "absolute", right: 0 },
  earned: { bottom: 24, color: colors.white, fontFamily: fonts.serif, fontSize: 17, left: 0, lineHeight: 23, position: "absolute", right: 0, textAlign: "center" },
});
