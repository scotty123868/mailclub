import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { PostalCard } from "./PostalCard";

const cities = [
  { name: "VANCOUVER", x: 49, y: 45 },
  { name: "SAN FRANCISCO", x: 47, y: 177 },
  { name: "DENVER", x: 165, y: 147 },
  { name: "AUSTIN", x: 224, y: 248 },
  { name: "CHICAGO", x: 278, y: 104 },
  { name: "NASHVILLE", x: 316, y: 182 },
  { name: "NEW YORK", x: 416, y: 131 },
];

export function MapPanel({ compact = false }: { compact?: boolean }) {
  return (
    <PostalCard style={[styles.card, compact && styles.compactCard]}>
      <Svg width="100%" height={compact ? 176 : 420} viewBox="0 0 470 320">
        <Path d="M12 35 C80 5, 150 20, 216 38 C300 62, 350 34, 452 68 L445 254 C354 286, 254 281, 170 270 C92 260, 36 239, 14 192 Z" fill="#EBDDBC" stroke="#C7B99D" strokeWidth="1" />
        <Path d="M2 48 C27 84, 28 141, 21 196 C16 231, 35 272, 70 302" stroke="#B7D0D3" strokeWidth="44" opacity="0.45" fill="none" />
        <Path d="M428 62 C453 121, 447 202, 420 279" stroke="#B7D0D3" strokeWidth="48" opacity="0.45" fill="none" />
        <Path d="M165 147 C195 70, 244 69, 278 104" stroke={colors.postalRed} strokeDasharray="6 5" strokeWidth="2" fill="none" />
        <Path d="M165 147 C224 139, 272 151, 316 182" stroke={colors.postalRed} strokeDasharray="6 5" strokeWidth="2" fill="none" />
        <Path d="M224 248 C276 268, 310 225, 316 182" stroke={colors.postalRed} strokeDasharray="6 5" strokeWidth="2" fill="none" />
        <Path d="M49 45 C105 68, 136 111, 165 147" stroke={colors.postalRed} strokeDasharray="6 5" strokeWidth="2" fill="none" />
        <Path d="M316 182 C337 145, 374 130, 416 131" stroke={colors.postalRed} strokeDasharray="6 5" strokeWidth="2" fill="none" />
        <Path d="M165 147 C168 210, 190 239, 224 248" stroke={colors.postalRed} strokeDasharray="6 5" strokeWidth="2" fill="none" />
        {cities.map((city) => (
          <Circle key={city.name} cx={city.x} cy={city.y} r="6" fill={city.name === "VANCOUVER" ? colors.postalRed : colors.ink} stroke={colors.paper} strokeWidth="2" />
        ))}
        {cities.map((city) => (
          <SvgText key={`${city.name}-label`} x={city.x + 9} y={city.y + 3} fill="#1C2130" fontSize="13" fontWeight="700">{city.name}</SvgText>
        ))}
      </Svg>
      {!compact ? <Text style={styles.compass}>N</Text> : null}
    </PostalCard>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden", padding: 0 },
  compactCard: { minHeight: 176 },
  compass: { bottom: 26, color: colors.postalBlue, fontFamily: fonts.serif, fontSize: 24, left: 36, position: "absolute" },
});
