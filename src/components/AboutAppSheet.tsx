import { FileText, HelpCircle, Mail, X } from "lucide-react-native";
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stamp } from "@/src/components/Stamp";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

export function AboutAppSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  function openMail() {
    Linking.openURL("mailto:scotty@lasolasvc.com?subject=Mailroom%20feedback").catch(() => undefined);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>About Mailroom</Text>
            <Text style={styles.subtitle}>The small print, lovingly written.</Text>
          </View>
          <Pressable
            onPress={onClose}
            style={styles.closeBtn}
            testID="about-app-close"
            accessibilityRole="button"
            accessibilityLabel="Close about"
          >
            <X color={colors.ink} size={22} strokeWidth={1.5} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.hero}>
            <Text style={styles.brand}>Mailroom</Text>
            <View style={styles.stamp}>
              <Stamp motif="dove" tone="red" cents="1¢" rotate={-7} size="sm" />
            </View>
          </View>

          <Section icon={FileText} title="What this is">
            <Para>
              A private postcard club. You send real, hand-written mail to friends and to strangers in the club.
              Every card you send is a small act of attention in an attention-starved world.
            </Para>
            <Para>
              Mailroom is in beta. Send queueing is local, fulfillment is being wired with a real printer
              partner, and Apple In-App Purchase replaces the demo credit grants in the next release.
            </Para>
          </Section>

          <Section icon={FileText} title="Privacy">
            <Para>
              We store your name, city, and any About-Me details on your device. Nothing is sent to a server in
              beta. When fulfillment ships, we'll add a privacy manifest and walk you through what changes.
            </Para>
            <Para>
              We never ask for your friends' street addresses — recipients claim their card via QR.
            </Para>
          </Section>

          <Section icon={FileText} title="Terms">
            <Para>
              By using Mailroom you agree to be kind. Cards that harass, threaten, or violate someone's
              dignity will be refused at the print queue. We'll show you the refusal so you can revise.
            </Para>
            <Para>
              Mailroom is a hobby project today. Use at your own risk and write things that would make your
              grandmother proud.
            </Para>
          </Section>

          <Section icon={HelpCircle} title="Help & feedback">
            <Para>
              Found a bug or have an idea? Write us — actual humans read it.
            </Para>
            <Pressable
              onPress={openMail}
              style={styles.mailBtn}
              testID="about-app-mail"
              accessibilityRole="button"
              accessibilityLabel="Email Mailroom"
            >
              <Mail color={colors.white} size={16} strokeWidth={1.6} />
              <Text style={styles.mailBtnText}>scotty@lasolasvc.com</Text>
            </Pressable>
          </Section>

          <Text style={styles.version}>Mailroom · beta · made with paper, ink, and code.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.wrap}>
      <View style={sectionStyles.headerRow}>
        <Icon color={colors.postalRed} size={16} strokeWidth={1.6} />
        <Text style={sectionStyles.title}>{title}</Text>
      </View>
      <View style={sectionStyles.body}>{children}</View>
    </View>
  );
}

function Para({ children }: { children: React.ReactNode }) {
  return <Text style={sectionStyles.para}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.paper, flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  header: { alignItems: "flex-start", flexDirection: "row", gap: 12 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 28 },
  subtitle: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 13, marginTop: 4 },
  closeBtn: { backgroundColor: "rgba(155,175,155,0.2)", borderRadius: 18, padding: 8 },
  scroll: { flex: 1, marginTop: 14 },
  scrollContent: { gap: 14, paddingBottom: 40 },
  hero: { alignItems: "center", flexDirection: "row", gap: 12 },
  brand: { color: colors.ink, flex: 1, fontFamily: fonts.script, fontSize: 36 },
  stamp: {},
  mailBtn: { alignItems: "center", alignSelf: "flex-start", backgroundColor: colors.ink, borderRadius: 8, flexDirection: "row", gap: 8, marginTop: 8, paddingHorizontal: 14, paddingVertical: 10 },
  mailBtnText: { color: colors.white, fontFamily: fonts.serifSemi, fontSize: 14, letterSpacing: 0.3 },
  version: { color: colors.mutedInk, fontFamily: fonts.serifItalic, fontSize: 12, marginTop: 12, textAlign: "center" },
});

const sectionStyles = StyleSheet.create({
  wrap: { backgroundColor: colors.white, borderColor: colors.line, borderRadius: 8, borderWidth: 1, gap: 8, padding: 14 },
  headerRow: { alignItems: "center", flexDirection: "row", gap: 8 },
  title: { color: colors.ink, fontFamily: fonts.serifSemi, fontSize: 16 },
  body: { gap: 8 },
  para: { color: colors.ink, fontFamily: fonts.serif, fontSize: 14, lineHeight: 19 },
});
