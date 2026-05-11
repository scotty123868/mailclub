import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";
import { colors } from "@/src/theme/colors";
import { CircularPostmark } from "./PostmarkDecoration";
import { PostalCard } from "./PostalCard";

const CITIES = [
  { name: "Vancouver", x: 70, y: 60, accent: true },
  { name: "San Francisco", x: 60, y: 178, accent: false },
  { name: "Denver", x: 178, y: 152, accent: true },
  { name: "Austin", x: 232, y: 250, accent: false },
  { name: "Chicago", x: 282, y: 112, accent: false },
  { name: "Nashville", x: 322, y: 180, accent: false },
  { name: "New York", x: 414, y: 134, accent: false },
];

const CITY_COORDS: Record<string, { x: number; y: number }> = {
  denver: { x: 178, y: 152 },
  vancouver: { x: 70, y: 60 },
  chicago: { x: 282, y: 112 },
  nashville: { x: 322, y: 180 },
  san_francisco: { x: 60, y: 178 },
  austin: { x: 232, y: 250 },
  new_york: { x: 414, y: 134 },
};

const ROUTES: [string, string][] = [
  ["denver", "vancouver"],
  ["denver", "chicago"],
  ["denver", "nashville"],
  ["denver", "san_francisco"],
  ["denver", "austin"],
  ["chicago", "new_york"],
  ["nashville", "new_york"],
  ["austin", "nashville"],
];

function Pine({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${scale})`}>
      <Path d="M 0 12 L -5 4 L -2 4 L -6 -2 L -2 -2 L -7 -8 L -2 -8 L 0 -14 L 2 -8 L 7 -8 L 2 -2 L 6 -2 L 2 4 L 5 4 Z" fill="#3F5A3A" opacity={0.85} />
      <Rect x={-1} y={11} width={2} height={4} fill="#3F2E1F" />
    </G>
  );
}

function Mountain({ x, y, w, h, color = "#7A8A78" }: { x: number; y: number; w: number; h: number; color?: string }) {
  return (
    <G>
      <Path d={`M ${x} ${y + h} L ${x + w * 0.4} ${y} L ${x + w * 0.55} ${y + h * 0.4} L ${x + w * 0.7} ${y + h * 0.15} L ${x + w} ${y + h} Z`} fill={color} opacity={0.85} />
      <Path d={`M ${x + w * 0.32} ${y + h * 0.18} L ${x + w * 0.4} ${y} L ${x + w * 0.48} ${y + h * 0.18} Z M ${x + w * 0.64} ${y + h * 0.25} L ${x + w * 0.7} ${y + h * 0.15} L ${x + w * 0.76} ${y + h * 0.25} Z`} fill="#FFF8E9" opacity={0.8} />
    </G>
  );
}

export function MapPanel({ compact = false }: { compact?: boolean }) {
  const height = compact ? 176 : 380;
  return (
    <PostalCard style={[styles.card, compact && styles.compactCard]}>
      <Svg width="100%" height={height} viewBox="0 0 470 320" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="ocean" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#CFE0DD" />
            <Stop offset="1" stopColor="#A8C2BD" stopOpacity={0.7} />
          </LinearGradient>
          <LinearGradient id="land" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#F0E2C0" />
            <Stop offset="1" stopColor="#D9C490" stopOpacity={0.85} />
          </LinearGradient>
          <LinearGradient id="paper-bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FBF4DE" />
            <Stop offset="1" stopColor="#F1E5C7" />
          </LinearGradient>
        </Defs>

        <Rect width="470" height="320" fill="url(#paper-bg)" />

        <Path d="M 0 30 Q 10 90, 20 160 Q 30 230, 50 290 L 0 290 Z" fill="url(#ocean)" />
        <Path d="M 432 60 Q 446 130, 442 220 Q 448 270, 432 290 L 470 290 L 470 30 Z" fill="url(#ocean)" />
        <Path d="M 60 18 Q 200 6, 350 14 Q 420 18, 432 30 L 60 30 Z" fill="url(#ocean)" opacity={0.7} />

        <Path d="M 22 32 Q 80 24, 160 26 Q 260 22, 360 30 Q 422 38, 432 80 Q 440 160, 426 230 Q 410 270, 360 280 Q 280 286, 200 280 Q 120 270, 60 250 Q 30 220, 24 160 Q 18 90, 22 32 Z" fill="url(#land)" stroke="#A89060" strokeWidth={0.8} />

        <Path d="M 22 32 Q 80 24, 160 26 Q 260 22, 360 30" stroke="#7A6A40" strokeWidth={0.5} fill="none" opacity={0.5} />
        <Path d="M 24 160 Q 18 200, 28 240" stroke="#7A6A40" strokeWidth={0.5} fill="none" opacity={0.5} />

        <Path d="M 380 200 Q 388 230, 384 260 Q 376 270, 370 256 Q 372 230, 374 210 Z" fill="url(#land)" stroke="#A89060" strokeWidth={0.6} />
        <Path d="M 420 210 Q 460 250, 432 290" stroke="#A89060" strokeWidth={0.5} fill="none" />

        <Mountain x={130} y={80} w={70} h={42} color="#8FA28A" />
        <Mountain x={150} y={130} w={70} h={36} color="#A8B49C" />
        <Mountain x={120} y={180} w={60} h={30} color="#A8B49C" />
        <Mountain x={310} y={120} w={50} h={26} color="#9CAB9C" />
        <Mountain x={340} y={150} w={48} h={24} color="#A8B49C" />

        <Pine x={50} y={100} scale={1.2} />
        <Pine x={70} y={130} />
        <Pine x={90} y={120} scale={0.9} />
        <Pine x={62} y={170} scale={1.1} />
        <Pine x={108} y={210} />
        <Pine x={90} y={250} scale={1.1} />
        <Pine x={290} y={70} />
        <Pine x={320} y={86} scale={0.9} />
        <Pine x={370} y={70} scale={1.1} />
        <Pine x={400} y={90} />

        <Path d="M 268 102 Q 282 96, 296 100 Q 308 108, 296 116 Q 282 116, 270 112 Q 264 108, 268 102 Z" fill="#9FBED4" stroke="#7A99B0" strokeWidth={0.5} opacity={0.85} />

        {ROUTES.map(([fromKey, toKey], i) => {
          const a = CITY_COORDS[fromKey];
          const b = CITY_COORDS[toKey];
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2 - 30;
          return (
            <Path
              key={i}
              d={`M ${a.x} ${a.y} Q ${mx} ${my}, ${b.x} ${b.y}`}
              stroke={colors.postalRed}
              strokeWidth={1.4}
              strokeDasharray="5 4"
              fill="none"
              opacity={0.85}
            />
          );
        })}

        {CITIES.map((c) => (
          <G key={c.name}>
            <Circle cx={c.x} cy={c.y} r={c.accent ? 6 : 4} fill={c.accent ? colors.postalRed : colors.ink} stroke={colors.paper} strokeWidth={1.5} />
            {!compact && (
              <SvgText
                x={c.x + 9}
                y={c.y + 4}
                fill={colors.ink}
                fontSize={11}
                fontFamily="CormorantGaramond_700Bold"
                letterSpacing={0.3}
              >
                {c.name}
              </SvgText>
            )}
          </G>
        ))}

        {!compact && (
          <G>
            <Path d="M 26 264 L 30 248 L 38 264 Z" fill={colors.ink} />
            <Path d="M 32 248 L 32 246 L 42 252 L 32 256 Z" fill={colors.postalRed} />
            <Path d="M 18 268 Q 30 272, 46 268 L 42 274 L 22 274 Z" fill={colors.ink} />
            <Path d="M 14 280 Q 30 278, 50 280" stroke="#7A99B0" strokeWidth={0.7} fill="none" />
          </G>
        )}

        {!compact && (
          <G transform="translate(420 268)">
            <Circle cx={0} cy={0} r={22} stroke={colors.ink} strokeWidth={0.9} fill="none" />
            <Circle cx={0} cy={0} r={14} stroke={colors.ink} strokeWidth={0.5} fill="none" opacity={0.6} />
            <Path d="M 0 -22 L 3 0 L 0 22 L -3 0 Z" fill={colors.ink} />
            <Path d="M -22 0 L 0 3 L 22 0 L 0 -3 Z" fill={colors.ink} opacity={0.4} />
            <SvgText x={0} y={-26} textAnchor="middle" fill={colors.ink} fontSize={9} fontFamily="CormorantGaramond_700Bold">N</SvgText>
            <SvgText x={26} y={3} fill={colors.ink} fontSize={9} fontFamily="CormorantGaramond_700Bold">E</SvgText>
            <SvgText x={0} y={32} textAnchor="middle" fill={colors.ink} fontSize={9} fontFamily="CormorantGaramond_700Bold">S</SvgText>
            <SvgText x={-32} y={3} fill={colors.ink} fontSize={9} fontFamily="CormorantGaramond_700Bold">W</SvgText>
          </G>
        )}
      </Svg>
      {!compact && (
        <View style={styles.postmarkOverlay} pointerEvents="none">
          <CircularPostmark size={100} opacity={0.55} />
        </View>
      )}
    </PostalCard>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", padding: 0 },
  compactCard: { minHeight: 176 },
  postmarkOverlay: { position: "absolute", right: 8, top: 8 },
});
