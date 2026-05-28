import { Sparkles, Wand2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { imagineCard, type ImaginedCard } from "@/src/utils/imagineCard";
import { PostalCard } from "./PostalCard";

const SUGGESTIONS = [
 "Birthday card for my mom who loves gardening",
 "Just saying hi to my grandma",
 "Thank-you to a friend who helped me move",
 "Reconnect with my college roommate",
];

export function AIPromptCard({ onImagined }: { onImagined: (card: ImaginedCard) => void }) {
 const [prompt, setPrompt] = useState("");
 const [lastRationale, setLastRationale] = useState<string | null>(null);

 function generate(text: string) {
 const card = imagineCard(text);
 setLastRationale(card.rationale);
 onImagined(card);
 }

 return (
 <PostalCard style={styles.card}>
 <View style={styles.header}>
 <View style={styles.iconWrap}>
 <Wand2 color={colors.postalRed} size={20} strokeWidth={1.6} />
 </View>
 <View style={{ flex: 1 }}>
 <Text style={styles.title}>Describe your postcard</Text>
 <Text style={styles.subtitle}>Tell us the occasion. We'll fill in the words.</Text>
 </View>
 </View>

 <View style={styles.inputRow}>
 <TextInput
 value={prompt}
 onChangeText={setPrompt}
 placeholder="e.g. Birthday card for my dad who loves jazz"
 placeholderTextColor="#9A8D76"
 multiline
 style={styles.input}
 />
 </View>

 <View style={styles.actionRow}>
 <Pressable
 onPress={() => generate(prompt)}
 disabled={!prompt.trim()}
 style={({ pressed }) => [styles.imagineBtn, pressed && styles.imagineBtnPressed, !prompt.trim() && styles.imagineBtnDisabled]}
 testID="imagine-button"
 >
 <Sparkles color={prompt.trim() ? colors.white : "#A89060"} size={18} strokeWidth={1.7} />
 <Text style={[styles.imagineBtnText, !prompt.trim() && styles.imagineBtnTextDisabled]}>Imagine my postcard</Text>
 </Pressable>
 </View>

 {lastRationale && (
 <View style={styles.rationaleRow}>
 <Svg width={14} height={14} viewBox="0 0 14 14">
 <Path d="M 7 1 L 9 5 L 13 7 L 9 9 L 7 13 L 5 9 L 1 7 L 5 5 Z" fill={colors.gold} />
 </Svg>
 <Text style={styles.rationale} numberOfLines={2}>{lastRationale}</Text>
 </View>
 )}

 <View style={styles.suggestionsRow}>
 {SUGGESTIONS.map((s) => (
 <Pressable
 key={s}
 onPress={() => { setPrompt(s); generate(s); }}
 style={styles.suggestion}
 testID={`suggestion-${s.slice(0, 12)}`}
 >
 <Text style={styles.suggestionText} numberOfLines={1}>{s}</Text>
 </Pressable>
 ))}
 </View>
 </PostalCard>
 );
}

const styles = StyleSheet.create({
 card: { padding: 18, gap: 12 },
 header: { alignItems: "center", flexDirection: "row", gap: 12 },
 iconWrap: { alignItems: "center", backgroundColor: "rgba(184,74,58,0.08)", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
 title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 19 },
 subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 2 },
 inputRow: { backgroundColor: "rgba(255,253,247,0.85)", borderColor: colors.line, borderRadius: 8, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
 input: { color: colors.ink, fontFamily: fonts.serif, fontSize: 15, minHeight: 44, lineHeight: 20, padding: 0, textAlignVertical: "top" },
 actionRow: { flexDirection: "row" },
 imagineBtn: { alignItems: "center", backgroundColor: colors.ink, borderRadius: 8, flexDirection: "row", gap: 8, justifyContent: "center", paddingHorizontal: 18, paddingVertical: 12 },
 imagineBtnPressed: { opacity: 0.85 },
 imagineBtnDisabled: { backgroundColor: "rgba(94,100,114,0.15)" },
 imagineBtnText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 15, letterSpacing: 0.3 },
 imagineBtnTextDisabled: { color: "#A89060" },
 rationaleRow: { alignItems: "center", flexDirection: "row", gap: 8, paddingHorizontal: 4 },
 rationale: { color: colors.mutedInk, flex: 1, fontFamily: fonts.serifItalic, fontSize: 13, lineHeight: 17 },
 suggestionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
 suggestion: { backgroundColor: "rgba(155,175,155,0.18)", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
 suggestionText: { color: "#4A5A38", fontFamily: fonts.serif, fontSize: 12, maxWidth: 220 },
});
