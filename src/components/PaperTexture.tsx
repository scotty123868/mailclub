import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";

export function PaperTexture({ density = 1 }: { density?: number }) {
  // Procedural paper grain — small darker speckles distributed pseudo-randomly
  const seeds = Array.from({ length: 220 * density }).map((_, i) => {
    const x = (i * 173.13) % 400;
    const y = (i * 271.7 + Math.floor(i / 19) * 11) % 700;
    const r = ((i * 17) % 7) / 7 < 0.6 ? 0.4 : 0.8;
    const opacity = 0.04 + ((i * 31) % 10) / 200;
    return { x, y, r, opacity };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="xMidYMid slice" viewBox="0 0 400 700">
        <Defs>
          <Pattern id="paper-fibers" x="0" y="0" width="200" height="200" patternUnits="userSpaceOnUse">
            <Rect width="200" height="200" fill="#F8F1E3" />
            {seeds.slice(0, 80).map((s, i) => (
              <Circle key={i} cx={(s.x * 0.5) % 200} cy={(s.y * 0.3) % 200} r={s.r} fill="#3F2E1F" opacity={s.opacity} />
            ))}
          </Pattern>
        </Defs>
        <Rect width="400" height="700" fill="url(#paper-fibers)" />
        {seeds.map((s, i) => (
          <Circle key={i} cx={s.x} cy={s.y} r={s.r * 1.4} fill="#3F2E1F" opacity={s.opacity * 0.6} />
        ))}
      </Svg>
    </View>
  );
}
