import Svg, { Circle, G, Path, Text as SvgText, TextPath, Defs } from "react-native-svg";
import { colors } from "@/src/theme/colors";

export function PostmarkDecoration({ compact = false }: { compact?: boolean }) {
  const width = compact ? 84 : 116;
  const height = compact ? 22 : 56;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Path d={`M2 ${height / 2} C18 ${height / 2 - 7}, 30 ${height / 2 + 7}, 46 ${height / 2}`} stroke={colors.postalRed} strokeWidth={1.2} fill="none" opacity={0.85} />
      <Path d={`M2 ${height / 2 + 6} C18 ${height / 2 - 1}, 30 ${height / 2 + 13}, 46 ${height / 2 + 6}`} stroke={colors.postalRed} strokeWidth={1.2} fill="none" opacity={0.85} />
      <Circle cx={compact ? 62 : 78} cy={height / 2} r={compact ? 13 : 20} stroke={colors.postalRed} strokeWidth={1.1} fill="none" strokeDasharray="3 3" opacity={0.85} />
      <SvgText x={compact ? 55 : 67} y={height / 2 + 5} fill={colors.postalRed} fontSize={compact ? 9 : 11} fontFamily="CormorantGaramond_700Bold">MC</SvgText>
    </Svg>
  );
}

export function CircularPostmark({
  size = 90,
  topText = "MAILROOM",
  bottomText = "DELIVERING CONNECTIONS",
  centerYear = "EST · 2026",
  color = "#9A8D76",
  opacity = 0.6,
}: {
  size?: number;
  topText?: string;
  bottomText?: string;
  centerYear?: string;
  color?: string;
  opacity?: number;
}) {
  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ opacity }}>
      <Defs>
        <Path id={`pm-top-${size}`} d={`M ${cx - r + 6} ${cy} A ${r - 6} ${r - 6} 0 0 1 ${cx + r - 6} ${cy}`} fill="none" />
        <Path id={`pm-bot-${size}`} d={`M ${cx - r + 6} ${cy} A ${r - 6} ${r - 6} 0 0 0 ${cx + r - 6} ${cy}`} fill="none" />
      </Defs>
      <Circle cx={cx} cy={cy} r={r} stroke={color} strokeWidth={1.1} fill="none" />
      <Circle cx={cx} cy={cy} r={r - 6} stroke={color} strokeWidth={0.7} fill="none" strokeDasharray="2 3" />
      <SvgText fill={color} fontSize={size * 0.1} fontFamily="Inter_700Bold" letterSpacing={1.2}>
        <TextPath href={`#pm-top-${size}`} startOffset="50%" textAnchor="middle">
          {topText}
        </TextPath>
      </SvgText>
      <SvgText fill={color} fontSize={size * 0.085} fontFamily="Inter_500Medium" letterSpacing={1.5}>
        <TextPath href={`#pm-bot-${size}`} startOffset="50%" textAnchor="middle">
          {bottomText}
        </TextPath>
      </SvgText>
      <SvgText x={cx} y={cy + 3} textAnchor="middle" fill={color} fontSize={size * 0.13} fontFamily="CormorantGaramond_700Bold" letterSpacing={1}>
        {centerYear}
      </SvgText>
      <G stroke={color} strokeWidth={0.6} opacity={0.5}>
        <Path d={`M ${cx - r * 0.5} ${cy - 12} L ${cx + r * 0.5} ${cy - 12}`} />
        <Path d={`M ${cx - r * 0.5} ${cy + 13} L ${cx + r * 0.5} ${cy + 13}`} />
      </G>
    </Svg>
  );
}

export function CancellationWave({ width = 90, height = 30, color = "#9A8D76" }: { width?: number; height?: number; color?: string }) {
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {[6, 12, 18, 24].map((y) => (
        <Path
          key={y}
          d={`M 0 ${y} Q ${width * 0.2} ${y - 4}, ${width * 0.4} ${y} T ${width * 0.8} ${y} T ${width} ${y}`}
          stroke={color}
          strokeWidth={0.9}
          fill="none"
          opacity={0.55}
        />
      ))}
    </Svg>
  );
}
