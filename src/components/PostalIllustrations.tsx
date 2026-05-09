import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Ellipse, Line, Path, Rect } from "react-native-svg";
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
        <Rect width="104" height="64" rx="4" fill="#F8F1E3" />
        <Rect x="4" y="4" width="96" height="56" rx="3" fill={palette[0]} />
        <Path d="M4 45 L24 24 L39 39 L58 16 L100 55 L100 60 L4 60 Z" fill={palette[1]} opacity="0.88" />
        <Path d="M25 25 L31 33 L18 33 Z M58 17 L65 28 L49 28 Z" fill="#FFF8E9" opacity="0.86" />
        <Path d="M8 52 C31 45, 47 52, 68 47 C82 44, 91 46, 99 42" stroke="#F8F1E3" strokeWidth="1.2" opacity="0.55" fill="none" />
        <Circle cx="82" cy="14" r="6" fill={palette[2]} />
        <Rect x="76" y="42" width="18" height="14" rx="1.5" fill="#F8F1E3" opacity="0.72" />
        <Line x1="80" y1="47" x2="91" y2="47" stroke="#7B6B55" strokeWidth="0.8" opacity="0.6" />
      </Svg>
    </View>
  );
}

export function PortraitAvatar({ initials, size = 70 }: { initials?: string; size?: number }) {
  const key = initials ?? "SL";
  const variant = key.charCodeAt(0) % 4;
  const hair = ["#17223B", "#6C3E2B", "#27221C", "#8B4D2F"][variant];
  const coat = ["#3C6E8F", "#9BAF9B", "#17223B", "#B84A3A"][variant];
  const skin = ["#C98F67", "#B97854", "#D6A27A", "#8F5E41"][variant];
  return (
    <View style={[styles.portraitWrap, { height: size, width: size, borderRadius: size / 2 }]}>
      <Svg width="100%" height="100%" viewBox="0 0 100 100">
        <Circle cx="50" cy="50" r="50" fill="#EFE2CC" />
        <Path d="M0 74 C19 50, 34 58, 50 42 C65 27, 77 39, 100 23 L100 100 L0 100 Z" fill="#C8D5C8" opacity="0.75" />
        <Path d="M0 83 C22 62, 38 72, 55 49 C73 27, 85 47, 100 35 L100 100 L0 100 Z" fill="#3C6E8F" opacity="0.72" />
        <Path d="M28 88 C31 70, 43 61, 55 61 C69 62, 79 73, 82 90 Z" fill={coat} />
        <Circle cx="52" cy="44" r="19" fill={skin} />
        <Path d="M32 43 C30 23, 48 16, 66 22 C78 27, 75 45, 70 56 C62 42, 49 37, 34 48 Z" fill={hair} />
        <Path d="M38 24 C45 13, 63 13, 70 26 C60 22, 49 22, 38 30 Z" fill={variant === 0 ? "#17223B" : "#8B4D2F"} />
        <Path d="M37 51 C43 57, 54 59, 64 53" stroke="#6B3B2A" strokeWidth="1.4" fill="none" opacity="0.55" />
        <Circle cx="45" cy="44" r="1.5" fill="#17223B" />
        <Circle cx="61" cy="44" r="1.5" fill="#17223B" />
      </Svg>
    </View>
  );
}

export function CafePostcardArt() {
  return (
    <View style={styles.cafeArt}>
      <Svg width="100%" height="100%" viewBox="0 0 220 280" preserveAspectRatio="xMidYMid slice">
        <Rect width="220" height="280" fill="#17223B" />
        <Path d="M0 198 C54 168, 102 174, 220 144 L220 280 L0 280 Z" fill="#8B5E3C" />
        <Path d="M0 42 C54 23, 107 18, 220 4 L220 124 C138 107, 64 124, 0 154 Z" fill="#2F3B45" />
        {Array.from({ length: 11 }).map((_, index) => (
          <Circle key={index} cx={18 + index * 20} cy={48 + (index % 2) * 12} r={4.3} fill="#F5D892" opacity="0.92" />
        ))}
        <Ellipse cx="80" cy="216" rx="58" ry="20" fill="#D7B180" opacity="0.45" />
        <Ellipse cx="81" cy="202" rx="37" ry="13" fill="#F8F1E3" />
        <Ellipse cx="81" cy="198" rx="29" ry="10" fill="#9A6844" />
        <Path d="M57 198 C69 189, 90 189, 104 199 C92 205, 69 205, 57 198 Z" fill="#E6C8A8" opacity="0.75" />
        <Path d="M113 200 C139 197, 142 225, 113 222" stroke="#F8F1E3" strokeWidth="6" fill="none" />
        <Rect x="126" y="134" width="9" height="66" rx="4" fill="#607A55" />
        <Path d="M131 134 C118 115, 125 92, 139 78 C154 102, 151 126, 131 134 Z" fill="#9BAF9B" />
        <Path d="M129 134 C143 117, 158 110, 178 111 C170 135, 151 145, 129 134 Z" fill="#9BAF9B" />
        <Circle cx="184" cy="205" r="13" fill="#D9B46E" opacity="0.95" />
        <Circle cx="184" cy="205" r="22" fill="#D9B46E" opacity="0.18" />
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
  portraitWrap: { borderColor: colors.white, borderWidth: 3, overflow: "hidden", shadowColor: colors.shadow, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.18, shadowRadius: 9 },
  cafeArt: { height: "100%", width: "100%" },
  phoneWrap: { alignSelf: "flex-end", height: 132, marginTop: -90, width: "58%" },
});
