import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function StampArt({ cents = "5¢", color = colors.postalRed }: { cents?: string; color?: string }) {
  return (
    <View style={[styles.stamp, { backgroundColor: color }]}>
      <Text style={styles.stampText}>{cents}</Text>
    </View>
  );
}

export function MiniPostcardArt({ variant = "mountain" }: { variant?: "mountain" | "city" | "coast" | "night" }) {
  const palette = {
    mountain: ["#C9D5C7", "#3C6E8F", "#D9B46E"],
    city: ["#D8C7A6", "#3C6E8F", "#9BAF9B"],
    coast: ["#BFD8D6", "#3C6E8F", "#B84A3A"],
    night: ["#111A33", "#D9B46E", "#9BAF9B"],
  }[variant];

  return (
    <View style={styles.postcardArt}>
      <Svg width="100%" height="100%" viewBox="0 0 104 64">
        <Rect width="104" height="64" rx="4" fill={palette[0]} />
        <Path d="M0 46 L23 25 L38 39 L55 18 L104 57 L104 64 L0 64 Z" fill={palette[1]} opacity="0.9" />
        <Path d="M24 26 L31 34 L18 34 Z M55 19 L63 30 L47 30 Z" fill="#FFF8E9" opacity="0.8" />
        <Circle cx="82" cy="14" r="6" fill={palette[2]} />
      </Svg>
    </View>
  );
}

export function PhoneConnectArt() {
  return (
    <View style={styles.phoneWrap}>
      <Svg width="100%" height="100%" viewBox="0 0 220 126">
        <Circle cx="67" cy="47" r="23" fill="#D8C7A6" />
        <Path d="M41 75 C58 61, 77 61, 95 75 L99 126 L35 126 Z" fill="#3C6E8F" opacity="0.82" />
        <Path d="M43 39 C52 18, 77 16, 91 36 C77 27, 60 31, 49 48 Z" fill="#8B4D2F" />
        <Rect x="86" y="55" width="30" height="52" rx="5" fill="#17223B" transform="rotate(-10 101 81)" />
        <Rect x="90" y="60" width="22" height="42" rx="3" fill="#F8F1E3" transform="rotate(-10 101 81)" />
        <Circle cx="155" cy="45" r="22" fill="#B78961" />
        <Path d="M134 74 C150 61, 171 61, 188 75 L194 126 L129 126 Z" fill="#9BAF9B" opacity="0.85" />
        <Path d="M139 35 C151 15, 179 20, 178 46 C167 30, 151 30, 139 43 Z" fill="#17223B" />
        <Rect x="121" y="57" width="30" height="52" rx="5" fill="#17223B" transform="rotate(10 136 83)" />
        <Rect x="125" y="62" width="22" height="42" rx="3" fill="#F8F1E3" transform="rotate(10 136 83)" />
        <Path d="M104 44 C116 34, 130 34, 142 44" stroke="#B84A3A" strokeWidth="2" strokeDasharray="4 5" fill="none" />
        <Rect x="95" y="35" width="39" height="26" rx="3" fill="#F8F1E3" stroke="#D9C8AC" />
        <Path d="M103 47 L114 53 L126 47" stroke="#17223B" strokeWidth="1.4" fill="none" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  stamp: { alignItems: "center", borderRadius: 4, height: 55, justifyContent: "center", transform: [{ rotate: "7deg" }], width: 46 },
  stampText: { color: colors.paper, fontFamily: fonts.serif, fontSize: 14 },
  postcardArt: { borderColor: colors.line, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, height: 58, overflow: "hidden", width: 92 },
  phoneWrap: { alignSelf: "flex-end", height: 132, marginTop: -90, width: "58%" },
});
