import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";
import { colors } from "@/src/theme/colors";

export function PostmarkDecoration({ compact = false }: { compact?: boolean }) {
  const width = compact ? 84 : 116;
  const height = compact ? 22 : 56;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Path d={`M2 ${height / 2} C18 ${height / 2 - 7}, 30 ${height / 2 + 7}, 46 ${height / 2}`} stroke={colors.postalRed} strokeWidth={1.2} fill="none" />
      <Path d={`M2 ${height / 2 + 6} C18 ${height / 2 - 1}, 30 ${height / 2 + 13}, 46 ${height / 2 + 6}`} stroke={colors.postalRed} strokeWidth={1.2} fill="none" />
      <Circle cx={compact ? 62 : 78} cy={height / 2} r={compact ? 13 : 20} stroke={colors.postalRed} strokeWidth={1.1} fill="none" strokeDasharray="3 3" />
      <SvgText x={compact ? 55 : 67} y={height / 2 + 5} fill={colors.postalRed} fontSize={compact ? 9 : 11} fontFamily="Georgia">MC</SvgText>
    </Svg>
  );
}
