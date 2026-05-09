import * as ImagePicker from "expo-image-picker";
import { Camera, ChevronDown, Edit3, Gift, Heart, Leaf, Send, User } from "lucide-react-native";
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AppShell } from "@/src/components/AppShell";
import { PrimaryButton } from "@/src/components/Buttons";
import { FormatSelector } from "@/src/components/FormatSelector";
import { Header } from "@/src/components/Header";
import { PostalCard } from "@/src/components/PostalCard";
import { CafePostcardArt, PortraitAvatar } from "@/src/components/PostalIllustrations";
import { SuccessModal } from "@/src/components/SuccessModal";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";
import { Postcard } from "@/src/types/mail";

const steps = [
  { title: "Photo", icon: Camera, number: 1 },
  { title: "Note", icon: Edit3, number: 2 },
  { title: "Recipient", icon: User, number: 3 },
  { title: "Send", icon: Send, number: 4 },
];

const templates = [
  { title: "Birthday note", icon: Gift, format: "note" as const, message: "Happy birthday. I’m glad you’re in my life." },
  { title: "Thinking of you", icon: Leaf, format: "photo" as const, message: "This made me think of you. Hope it finds you well." },
  { title: "Date invite", icon: Heart, format: "ask-out" as const, message: "Had a great time meeting you. Want to grab coffee next week?" },
  { title: "Send the photo from tonight", icon: Camera, format: "photo" as const, message: "Sending the photo from tonight. I didn’t want it to disappear into a camera roll." },
];

export default function SendScreen() {
  const { friends, stampBalance, sendPostcard } = useMailClub();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [message, setMessage] = useState("Had a great time meeting you. Want to grab coffee next week?");
  const [format, setFormat] = useState<Postcard["type"]>("ask-out");
  const [recipientIndex, setRecipientIndex] = useState(() => Math.max(0, friends.findIndex((friend) => friend.id === "nora")));
  const [selectedTemplate, setSelectedTemplate] = useState("Date invite");
  const [modal, setModal] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const recipient = friends[recipientIndex] ?? friends[0];

  async function choosePhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.82,
    });
    if (!result.canceled) setImageUri(result.assets[0].uri);
  }

  async function onSend() {
    const result = await sendPostcard(recipient.id, format, message);
    if (!result.ok) return;
    setModalTitle(`Demo postcard queued for ${result.friendName}.`);
    setModal(true);
  }

  return (
    <AppShell>
      <Header title="Send Mail" />
      <View style={styles.stepper}>
        {steps.map((step, index) => {
          return (
            <View key={step.title} style={styles.step}>
              <View style={[styles.stepCircle, index === 0 && styles.stepActive]}>
                <Text style={[styles.stepNumber, index === 0 && styles.stepNumberActive]}>{step.number}</Text>
              </View>
              <Text style={[styles.stepText, index === 0 && styles.stepTextActive]}>{step.title}</Text>
            </View>
          );
        })}
      </View>

      <PostalCard style={styles.composer}>
        <Pressable onPress={choosePhoto} style={styles.photo}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.image} />
          ) : (
            <View style={styles.placeholder}>
              <CafePostcardArt />
              <View style={styles.photoCaption}>
                <Text style={styles.placeholderTitle}>Tonight’s photo</Text>
                <Text style={styles.placeholderBody}>Tap to choose one.</Text>
              </View>
            </View>
          )}
        </Pressable>
        <View style={styles.noteArea}>
          <View style={styles.postmark}>
            <Text style={styles.postmarkText}>MAIL CLUB{"\n"}DELIVERING CONNECTIONS</Text>
          </View>
          <View style={styles.postage}><Text style={styles.postageText}>3¢</Text></View>
          <TextInput
            multiline
            value={message}
            onChangeText={setMessage}
            placeholder="Write a short note..."
            placeholderTextColor="#9A8D76"
            style={styles.noteInput}
          />
        </View>
      </PostalCard>

      <View>
        <Text style={styles.sectionTitle}>Choose your format</Text>
        <FormatSelector selected={format} onSelect={setFormat} />
      </View>

      <Text style={styles.toHeading}>To</Text>
      <Pressable onPress={() => setRecipientIndex((recipientIndex + 1) % friends.length)}>
        <PostalCard style={styles.recipient}>
          <PortraitAvatar initials={recipient.avatarInitials} size={62} />
          <View style={{ flex: 1 }}>
            <Text style={styles.recipientName}>{recipient.name}</Text>
            <Text style={styles.recipientMeta}>{stampBalance} stamps available</Text>
          </View>
          <ChevronDown color={colors.ink} size={22} />
        </PostalCard>
      </Pressable>

      <View>
        <Text style={styles.templateTitle}>Choose a template</Text>
        <View style={styles.templates}>
          {templates.map((template) => {
            const Icon = template.icon;
            const active = selectedTemplate === template.title;
            return (
              <Pressable
                key={template.title}
                onPress={() => {
                  setSelectedTemplate(template.title);
                  setFormat(template.format);
                  setMessage(template.message);
                }}
                style={[styles.templateChip, active && styles.templateChipActive]}
              >
                <Icon color={active ? colors.postalRed : colors.ink} size={21} strokeWidth={1.5} />
                <Text style={[styles.templateText, active && styles.templateTextActive]}>{template.title}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <PrimaryButton title="Send Postcard" icon={Send} onPress={onSend} />

      <SuccessModal
        visible={modal}
        title={modalTitle}
        subtitle="Demo send queued locally. Real fulfillment is not connected in v0.1."
        onClose={() => setModal(false)}
      />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  step: { alignItems: "center", flex: 1, gap: 7 },
  stepCircle: { alignItems: "center", borderColor: colors.line, borderRadius: 23, borderWidth: 1.3, height: 46, justifyContent: "center", width: 46 },
  stepActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  stepNumber: { color: colors.ink, fontFamily: fonts.serif, fontSize: 18 },
  stepNumberActive: { color: colors.white },
  stepText: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 15 },
  stepTextActive: { color: colors.ink, fontWeight: "700" },
  composer: { flexDirection: "row", minHeight: 300, overflow: "hidden", padding: 12 },
  photo: { backgroundColor: colors.paperDark, borderRadius: 7, flex: 0.9, overflow: "hidden" },
  image: { height: "100%", width: "100%" },
  placeholder: { flex: 1 },
  photoCaption: { backgroundColor: "rgba(248,241,227,0.86)", borderRadius: 8, bottom: 12, left: 12, padding: 10, position: "absolute", right: 12 },
  placeholderTitle: { color: colors.ink, fontFamily: fonts.serif, fontSize: 20 },
  placeholderBody: { color: colors.mutedInk, fontFamily: fonts.sans, fontSize: 12, lineHeight: 16, marginTop: 2 },
  postage: { alignItems: "center", backgroundColor: colors.postalRed, borderRadius: 4, height: 48, justifyContent: "center", position: "absolute", right: 10, top: 12, transform: [{ rotate: "8deg" }], width: 40 },
  postageText: { color: colors.paper, fontFamily: fonts.serif, fontSize: 13 },
  noteArea: { flex: 1, paddingHorizontal: 16, paddingTop: 80 },
  postmark: { alignItems: "center", borderColor: colors.line, borderRadius: 44, borderWidth: 1, height: 78, justifyContent: "center", left: 12, position: "absolute", top: 10, width: 94 },
  postmarkText: { color: "#9A8D76", fontFamily: fonts.sans, fontSize: 9, fontWeight: "700", lineHeight: 13, textAlign: "center" },
  noteInput: { color: colors.ink, flex: 1, fontFamily: fonts.serif, fontSize: 23, fontStyle: "italic", lineHeight: 38, minHeight: 178, padding: 0, textAlignVertical: "top" },
  sectionTitle: { color: colors.ink, fontFamily: fonts.serif, fontSize: 22, marginBottom: 10 },
  toHeading: { color: colors.ink, fontFamily: fonts.serif, fontSize: 21, marginBottom: -8 },
  recipient: { alignItems: "center", flexDirection: "row", gap: 12, padding: 14 },
  recipientName: { color: colors.ink, fontFamily: fonts.serif, fontSize: 26 },
  recipientMeta: { color: colors.mutedInk, fontFamily: fonts.serif, fontSize: 15, marginTop: 3 },
  templateTitle: { color: colors.ink, fontFamily: fonts.serif, fontSize: 20, marginBottom: 10 },
  templates: { flexDirection: "row", gap: 8 },
  templateChip: { alignItems: "center", backgroundColor: "rgba(255,253,247,0.72)", borderColor: colors.line, borderRadius: 8, borderWidth: 1, flex: 1, gap: 6, minHeight: 74, paddingHorizontal: 8, paddingVertical: 8 },
  templateChipActive: { borderColor: colors.postalRed, backgroundColor: "rgba(184,74,58,0.06)" },
  templateText: { color: colors.ink, fontFamily: fonts.serif, fontSize: 13, lineHeight: 16, textAlign: "center" },
  templateTextActive: { color: colors.postalRed },
});
