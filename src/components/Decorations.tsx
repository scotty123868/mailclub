import { StyleSheet, View, ViewStyle } from "react-native";
import Svg, { G, Path, Rect } from "react-native-svg";
import { colors } from "@/src/theme/colors";

export function AirmailStripe({ vertical = false, length = 220, thickness = 14, style }: { vertical?: boolean; length?: number; thickness?: number; style?: ViewStyle }) {
  const w = vertical ? thickness : length;
  const h = vertical ? length : thickness;
  const stripes: { color: string; offset: number }[] = [];
  const step = 8;
  for (let i = -h; i < w + h; i += step) {
    stripes.push({ color: (Math.floor(i / step) % 2 === 0) ? colors.postalRed : colors.postalBlue, offset: i });
  }
  return (
    <View style={[{ width: w, height: h, overflow: "hidden", borderRadius: 2 }, style]}>
      <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <Rect width={w} height={h} fill={colors.paper} />
        {stripes.map((s, i) => (
          <Path
            key={i}
            d={`M ${s.offset} 0 L ${s.offset + step} 0 L ${s.offset + step - h} ${h} L ${s.offset - h} ${h} Z`}
            fill={s.color}
            opacity={0.92}
          />
        ))}
      </Svg>
    </View>
  );
}

export function AirmailDivider() {
  return (
    <View style={{ height: 6, marginVertical: 4, overflow: "hidden", borderRadius: 3 }}>
      <AirmailStripe length={500} thickness={6} />
    </View>
  );
}

export function HandHeart({ size = 36, color = "#B84A3A" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <G stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round">
        <Path d="M 8 22 Q 12 12, 22 16 Q 26 18, 24 24 Q 28 16, 36 18 Q 42 22, 38 30 Q 32 38, 24 42 Q 16 36, 10 28 Q 6 24, 8 22 Z" />
        <Path d="M 14 28 Q 22 32, 28 28" />
      </G>
    </Svg>
  );
}

export function WaveLines({ width = 80, height = 16, color = "#5E6472" }: { width?: number; height?: number; color?: string }) {
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {[3, 8, 13].map((y) => (
        <Path
          key={y}
          d={`M 0 ${y} Q ${width * 0.25} ${y - 2}, ${width * 0.5} ${y} T ${width} ${y}`}
          stroke={color}
          strokeWidth={0.9}
          fill="none"
          opacity={0.6}
        />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({});
