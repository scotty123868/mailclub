import { useLocalSearchParams, useRouter } from "expo-router";
import { Camera, ChevronDown, Edit3, Send, Sparkles, UserPlus, User } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { AIPromptCard } from "@/src/components/AIPromptCard";
import { IllustratedAvatar, AvatarLook } from "@/src/components/Avatar";
import { PrimaryButton } from "@/src/components/Buttons";
import { CategoryCompose, ComposeState } from "@/src/components/CategoryCompose";
import { CategoryPicker } from "@/src/components/CategoryPicker";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { Header } from "@/src/components/Header";
import { OccasionGrid } from "@/src/components/OccasionGrid";
import { PostalCard } from "@/src/components/PostalCard";
import { CircularPostmark } from "@/src/components/PostmarkDecoration";
import { SuccessModal } from "@/src/components/SuccessModal";
import { CARD_COSTS } from "@/src/data/credits";
import type { Occasion, OccasionId } from "@/src/data/occasions";
import { OCCASIONS } from "@/src/data/occasions";
import { SendInput, useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import type { CardCategory } from "@/src/types/mail";

const steps = [
  { title: "Pick", icon: Sparkles, number: 1 },
  { title: "Compose", icon: Edit3, number: 2 },
  { title: "Recipient", icon: User, number: 3 },
  { title: "Send", icon: Send, number: 4 },
];

const INITIAL_STATE: ComposeState = {
  category: "photo",
  message: "Had a great time meeting you. Want to grab coffee next week?",
  imageUri: null,
  placeName: "",
  customTone: undefined,
  customPhotos: [],
};

export default function SendScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ occasion?: string; friendId?: string }>();
  const { friends, credits, sendPostcard, sendIntoVoid } = useMailClub();
  const [state, setState] = useState<ComposeState>(INITIAL_STATE);
  const [recipientIndex, setRecipientIndex] = useState(() => Math.max(0, friends.findIndex((friend) => friend.id === "nora")));
  const [activeOccasion, setActiveOccasion] = useState<OccasionId | null>("date");
  const [voidMode, setVoidMode] = useState(false);
  const [modal, setModal] = useState({ visible: false, title: "", subtitle: "" });
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [seededOccasion, setSeededOccasion] = useState<string | undefined>(undefined);
  const [seededFriend, setSeededFriend] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);

  // Seed from ?occasion=... when nav'd from My Card / Constellation / Map
  useEffect(() => {
    const occasionParam = params?.occasion as string | undefined;
    if (!occasionParam || seededOccasion === occasionParam) return;
    const occ = OCCASIONS.find((o) => o.id === occasionParam);
    if (!occ) return;
    setActiveOccasion(occ.id);
    setState((prev) => ({ ...prev, category: occ.category, message: occ.message }));
    setVoidMode(occ.special === "random-recipient");
    setSeededOccasion(occasionParam);
  }, [params?.occasion, seededOccasion]);

  // Seed recipient from ?friendId=... when nav'd from a FriendDetailSheet
  useEffect(() => {
    const friendParam = params?.friendId as string | undefined;
    if (!friendParam || seededFriend === friendParam) return;
    const idx = friends.findIndex((f) => f.id === friendParam);
    if (idx >= 0) setRecipientIndex(idx);
    setSeededFriend(friendParam);
  }, [params?.friendId, friends, seededFriend]);

  const hasFriends = friends.length > 0;
  const recipient = hasFriends ? (friends[recipientIndex] ?? friends[0]) : null;
  const costForChoice = CARD_COSTS[state.category];
  const cantAfford = credits < costForChoice;

  function patch(p: Partial<ComposeState>) {
    setState((prev) => ({ ...prev, ...p }));
  }

  function applyOccasion(occ: Occasion) {
    setActiveOccasion(occ.id);
    patch({ category: occ.category, message: occ.message });
    setVoidMode(occ.special === "random-recipient");
  }

  function setCategory(category: CardCategory) {
    patch({ category });
    setActiveOccasion(null);
  }

  function buildSendInput(): SendInput {
    const friendId = recipient?.id ?? "";
    if (state.category === "photo") {
      return { kind: "photo", friendId, photoUri: state.imageUri ?? "", message: state.message };
    }
    if (state.category === "place") {
      return { kind: "place", friendId, photoUri: state.imageUri ?? "", placeName: state.placeName || "Wherever you are", message: state.message };
    }
    if (state.category === "custom") {
      return { kind: "custom", friendId, description: state.message, tone: state.customTone, referencePhotoUris: state.customPhotos };
    }
    return { kind: "handwritten", friendId, message: state.message };
  }

  async function onSend() {
    if (sending) return;
    setSending(true);
    try {
      if (voidMode) {
        const result = await sendIntoVoid(state.message);
        if (!result.ok) return;
        setModal({
          visible: true,
          title: "Sent into the void.",
          subtitle: result.replyPreview
            ? `${result.replyPreview.from}: "${result.replyPreview.message}"`
            : "Someone, somewhere, will receive it.",
        });
        return;
      }

      const result = await sendPostcard(buildSendInput());
      if (!result.ok) return;
      setModal({
        visible: true,
        title: state.category === "custom"
          ? `Your custom card is in the designer queue for ${result.friendName}.`
          : `Your postcard is on its way to ${result.friendName}.`,
        subtitle: state.category === "custom"
          ? "Our designer + AI will draft 2 versions within 48h. (v0.1: manual queue.)"
          : "Demo send queued locally. Real fulfillment is not connected in v0.1.",
      });
    } finally {
      setSending(false);
    }
  }

  const sendLabel = sending
    ? "Sending..."
    : voidMode
      ? "Send into the void"
      : state.category === "custom"
        ? "Queue custom card"
        : "Send Postcard";

  return (
    <AppShell>
      <Header title="Send Mail" />
      <View style={styles.stepper}>
        {steps.map((step, index) => (
          <View key={step.title} style={styles.step}>
            <View style={[styles.stepCircle, index === 0 && styles.stepActive]}>
              <Text style={[styles.stepNumber, index === 0 && styles.stepNumberActive]}>{step.number}</Text>
            </View>
            <Text style={[styles.stepText, index === 0 && styles.stepTextActive]}>{step.title}</Text>
          </View>
        ))}
      </View>

      <CategoryPicker selected={state.category} onSelect={setCategory} />

      <CategoryCompose state={state} onChange={patch} />

      <AIPromptCard
        onImagined={(card) => {
          setActiveOccasion(card.occasionId);
          patch({ category: card.category, message: card.message });
          setVoidMode(card.occasionId === "void");
        }}
      />

      <OccasionGrid selectedId={activeOccasion} onSelect={applyOccasion} />

      <Text style={styles.toHeading}>To</Text>
      {voidMode ? (
        <PostalCard style={styles.voidRecipient}>
          <View style={styles.voidIconWrap}>
            <Sparkles color="#F2E2B6" size={26} strokeWidth={1.6} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.voidName}>Someone in Mail Club</Text>
            <Text style={styles.voidMeta}>A stranger will receive your card · 1 credit</Text>
          </View>
          <Pressable onPress={() => setVoidMode(false)} style={styles.voidExit}>
            <Text style={styles.voidExitText}>Cancel</Text>
          </Pressable>
        </PostalCard>
      ) : !hasFriends ? (
        <PostalCard style={styles.emptyRecipient} testID="recipient-empty">
          <View style={styles.emptyIconWrap}>
            <UserPlus color={colors.postalRed} size={24} strokeWidth={1.6} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.emptyTitle}>No friends to send to yet.</Text>
            <Text style={styles.emptyBody}>Add a friend or send into the void.</Text>
          </View>
          <Pressable
            onPress={() => router.push("/friends")}
            style={styles.emptyAddBtn}
            testID="recipient-empty-add"
            accessibilityRole="button"
            accessibilityLabel="Add a friend"
          >
            <Text style={styles.emptyAddText}>Add</Text>
          </Pressable>
        </PostalCard>
      ) : (
        <Pressable
          onPress={() => setRecipientIndex((recipientIndex + 1) % friends.length)}
          testID="recipient-cycler"
          accessibilityRole="button"
          accessibilityLabel={`Recipient: ${recipient!.name}. Tap to cycle.`}
        >
          <PostalCard style={styles.recipient}>
            <IllustratedAvatar look={recipient!.id as AvatarLook} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={styles.recipientName}>{recipient!.name}</Text>
              <Text style={[styles.recipientMeta, cantAfford && styles.recipientMetaWarn]}>
                {credits} credits · this card costs {costForChoice}
                {cantAfford ? " · need more" : ""}
              </Text>
              {cantAfford ? (
                <Pressable onPress={() => setCreditsOpen(true)} style={styles.buyInline} testID="recipient-buy-credits">
                  <Text style={styles.buyInlineText}>Buy {costForChoice - credits} more credit{costForChoice - credits === 1 ? "" : "s"}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={styles.recipientPostmark}>
              <CircularPostmark size={56} topText="STAY CURIOUS" bottomText="KEEP WRITING" centerYear="" />
            </View>
            <ChevronDown color={colors.ink} size={22} />
          </PostalCard>
        </Pressable>
      )}

      {(!hasFriends && !voidMode) ? null : (
        <PrimaryButton title={sendLabel} icon={voidMode ? Sparkles : Send} onPress={onSend} />
      )}

      <SuccessModal
        visible={modal.visible}
        title={modal.title}
        subtitle={modal.subtitle}
        onClose={() => setModal({ visible: false, title: "", subtitle: "" })}
      />

      <CreditsSheet visible={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  step: { alignItems: "center", flex: 1, gap: 7 },
  stepCircle: { alignItems: "center", borderColor: colors.line, borderRadius: 23, borderWidth: 1.3, height: 46, justifyContent: "center", width: 46 },
  stepActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  stepNumber: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 18 },
  stepNumberActive: { color: colors.white },
  stepText: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 14 },
  stepTextActive: { color: colors.ink, fontFamily: fonts.serifBold },
  toHeading: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 22, marginBottom: -10, marginTop: 4 },
  recipient: { alignItems: "center", flexDirection: "row", gap: 12, padding: 14 },
  recipientName: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 26 },
  recipientMeta: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 12, fontWeight: "700", letterSpacing: 0.4, marginTop: 4 },
  recipientMetaWarn: { color: colors.postalRed },
  buyInline: { alignSelf: "flex-start", backgroundColor: colors.postalRed, borderRadius: 6, marginTop: 8, paddingHorizontal: 10, paddingVertical: 5 },
  buyInlineText: { color: colors.white, fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.5 },
  emptyRecipient: { alignItems: "center", backgroundColor: "rgba(184,74,58,0.05)", borderColor: "rgba(184,74,58,0.3)", borderWidth: 1, flexDirection: "row", gap: 12, padding: 14 },
  emptyIconWrap: { alignItems: "center", backgroundColor: "rgba(184,74,58,0.12)", borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  emptyTitle: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 17 },
  emptyBody: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 2 },
  emptyAddBtn: { backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  emptyAddText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 14 },
  recipientPostmark: { opacity: 0.55 },
  voidRecipient: { alignItems: "center", backgroundColor: "rgba(17, 26, 51, 0.92)", borderColor: "#D9B46E", borderWidth: 1, flexDirection: "row", gap: 14, padding: 14 },
  voidIconWrap: { alignItems: "center", backgroundColor: "rgba(217, 180, 110, 0.18)", borderRadius: 24, height: 48, justifyContent: "center", width: 48 },
  voidName: { color: "#F2E2B6", fontFamily: fonts.serifSemi, fontSize: 20 },
  voidMeta: { color: "rgba(242, 226, 182, 0.78)", fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 2 },
  voidExit: { borderColor: "rgba(242, 226, 182, 0.35)", borderRadius: 6, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  voidExitText: { color: "#F2E2B6", fontFamily: fonts.sansBold, fontSize: 11, letterSpacing: 0.5 },
});
