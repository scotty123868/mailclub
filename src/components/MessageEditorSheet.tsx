import { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

// v0.5.0: bumped 250 → 300 per the send-flow gallery decision. Lob's 4×6
// postcard renders cleanly up to ~525 chars; 300 is the sweet spot for
// readability at standard print size (~50 words). Past 280 the counter goes
// red as an early warning before the hard stop.
const MAX_CHARS = 300;
const WARN_CHARS = 280;

/**
 * Slice a string to at most `max` Unicode codepoints (NOT UTF-16 code units).
 * Plain `string.slice(0, n)` operates on UTF-16 code units, so a 4-byte emoji
 * (like 🌹) counts as 2 units and can be split mid-codepoint into a broken
 * surrogate pair. `Array.from(str)` iterates by codepoint, which keeps emoji
 * whole. (Not perfect for ZWJ sequences like 👨‍👩‍👧 — a full grapheme-cluster
 * count needs Intl.Segmenter — but codepoint-safe is the right ~99% fix.)
 */
function sliceCodepoints(s: string, max: number): string {
  const arr = Array.from(s);
  if (arr.length <= max) return s;
  return arr.slice(0, max).join("");
}

function countCodepoints(s: string): number {
  return Array.from(s).length;
}

/**
 * Full-screen message editor — slides up over the postcard preview.
 *
 * Why a sheet and not inline editing on the flipped card:
 *   • The flipped card sits on a rotated transform. Native TextInputs inside
 *     transformed containers have measurement bugs (cursor position,
 *     keyboard avoidance, autocorrect overlay) on both iOS and Android.
 *   • A full-screen sheet is the pattern shown in retro.app screenshots
 *     and matches user expectations from iMessage / Notes.
 *   • Easier to focus the keyboard reliably on open.
 */
export function MessageEditorSheet({
  visible,
  initial,
  onSave,
  onCancel,
}: {
  visible: boolean;
  initial: string;
  onSave: (msg: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);

  // Reset draft only when the sheet TRANSITIONS to visible. Watching
  // `initial` here as a dep would clobber the user's typing if the
  // parent ever re-renders with a freshly-interpolated string.
  useEffect(() => {
    if (visible) setDraft(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const trimmedLength = draft.trim().length;
  const canSave = trimmedLength > 0;
  const charCount = countCodepoints(draft);
  const dirty = draft !== initial;

  function handleChange(t: string) {
    setDraft(sliceCodepoints(t, MAX_CHARS));
  }

  function handleCancel() {
    if (dirty) {
      Alert.alert(
        "Discard your message?",
        "Your changes won't be saved.",
        [
          { text: "Keep editing", style: "cancel" },
          { text: "Discard", style: "destructive", onPress: onCancel },
        ],
      );
      return;
    }
    onCancel();
  }

  function handleSave() {
    if (!canSave) return;
    onSave(draft);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <View style={styles.header}>
            <Pressable
              onPress={handleCancel}
              hitSlop={12}
              testID="msg-cancel"
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.headerBtn}>Cancel</Text>
            </Pressable>
            <Text style={styles.headerTitle}>Add a Message</Text>
            <Pressable
              onPress={handleSave}
              disabled={!canSave}
              hitSlop={12}
              testID="msg-save"
              accessibilityRole="button"
              accessibilityLabel="Save message"
              accessibilityState={{ disabled: !canSave }}
            >
              <Text style={[styles.headerBtn, styles.headerBtnPrimary, !canSave && styles.headerBtnDisabled]}>
                Done
              </Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <TextInput
              value={draft}
              onChangeText={handleChange}
              placeholder="Add a message..."
              placeholderTextColor="#9A8D76"
              style={styles.input}
              multiline
              autoFocus
              // NOTE: deliberately NOT setting RN's `maxLength` — that prop counts
              // UTF-16 code units and can split emoji into broken halves. We
              // enforce MAX_CHARS via our codepoint-safe `handleChange` instead.
              testID="msg-input"
              textAlignVertical="top"
            />

            <View style={styles.footer}>
              <View style={styles.stamp}>
                <CircularPostmark
                  size={86}
                  topText="FEEL GOOD SOCIAL"
                  bottomText="MAILROOM"
                  centerYear=""
                />
              </View>
              <Text
                style={[styles.count, charCount >= WARN_CHARS && styles.countWarn]}
                testID="msg-char-count"
                accessibilityLabel={
                  charCount >= WARN_CHARS
                    ? `${charCount} of ${MAX_CHARS} characters, near limit`
                    : `${charCount} of ${MAX_CHARS} characters`
                }
              >
                {charCount}/{MAX_CHARS}
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.paper, flex: 1 },
  header: { alignItems: "center", borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 14 },
  headerTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17 },
  headerBtn: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 16 },
  headerBtnPrimary: { color: colors.ink, fontFamily: fonts.serifSemi },
  headerBtnDisabled: { color: colors.mutedInk, opacity: 0.45 },
  body: { flex: 1, paddingBottom: 12, paddingHorizontal: 20, paddingTop: 18 },
  input: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 22, lineHeight: 30 },
  footer: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingHorizontal: 4, paddingVertical: 8 },
  stamp: { opacity: 0.4 },
  count: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 14, marginBottom: 6 },
  countWarn: { color: colors.postalRed, fontFamily: fonts.serifSemi },
});
