import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { Mail } from "lucide-react-native";
import React, { useMemo, useRef, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line } from "react-native-svg";
import { CreditsSheet } from "@/src/components/CreditsSheet";
import { FriendDetailSheet } from "@/src/components/FriendDetailSheet";
import {
  PostcardDetailSheet,
  type PostcardDetailSheetRef,
} from "@/src/components/PostcardDetailSheet";
import {
  PostcardPreviewSheet,
  type PostcardPreviewSheetRef,
} from "@/src/components/PostcardPreviewSheet";
import {
  buildSocialGraph,
  edgeId,
  type GraphEdge,
  type GraphNode,
  type PostcardForGraph,
} from "@/src/lib/constellationGraph";
import { useMailClub } from "@/src/state/MailClubContext";
import { colors } from "@/src/theme/colors";
import { fonts } from "@/src/theme/typography";

/**
 * ConstellationScreen — v0.7 full-screen force-directed social graph.
 *
 * Ported from teteapp's `src/screens/ConstellationScreen.tsx`. The
 * graph builder lives in `src/lib/constellationGraph.ts` (also ported).
 * The teteapp original is 850 lines with deep navigation + bottom-sheet
 * trees that depended on the t&ecirc;te theme system; this Mailroom
 * version keeps the architectural core (force-directed layout, pan+pinch,
 * tap-node-for-detail) and renders in Mailroom&apos;s palette.
 *
 * What lands in v0.7.0:
 *   - Full-screen dark "sky" background (no header chrome — the brand
 *     wordmark + credits pill float over the top-right corner)
 *   - SVG graph: self in the center (gold), friends as colored nodes,
 *     edges weighted by postcard count
 *   - Pan (two-finger) + pinch zoom + double-tap reset
 *   - Tap a node → FriendDetailSheet opens (existing component)
 *   - Gold ring + faint halo on reciprocated nodes (the D.3 magical
 *     moment)
 *
 * Deferred to v0.7.5:
 *   - Friend-of-friend edges (currently always off; toggle UI parked)
 *   - Bottom-sheet drawer of postcards-on-this-edge when an edge is
 *     tapped (just opens FriendDetailSheet for the other endpoint
 *     today)
 *
 * The simulation is settled offline (180 ticks for &le;20 nodes, 240
 * for denser graphs) inside buildSocialGraph, so positions are stable
 * per-render. No frame loop on the JS thread.
 */

const FRIEND_COLORS = [
  "#C24A45", // postal red
  "#3C6E8F", // postal blue
  "#9BAF9B", // sage
  "#D9B46E", // gold
  "#B89A60", // earth
  "#607A55", // dark sage
];

function colorForFriend(id: string): string {
  // Stable hash → color so the same friend gets the same color
  // every time, but the palette is distributed.
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return FRIEND_COLORS[Math.abs(h) % FRIEND_COLORS.length];
}

const AnimatedView = Animated.createAnimatedComponent(View);

export default function ConstellationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentUser, friends, postcards, credits, authedUserId } = useMailClub();
  const [creditsOpen, setCreditsOpen] = useState(false);
  const sheetRef = useRef<PostcardPreviewSheetRef>(null);
  // v0.7.0.7: detail sheet for pending-recipient nodes — tapping the
  // dashed edge or the placeholder node opens the postcard directly so
  // the sender can re-share the claim URL.
  const detailRef = useRef<PostcardDetailSheetRef>(null);

  // Stage size: square inset from screen width, capped at 360.
  const { width: screenW, height: screenH } = Dimensions.get("window");
  const stageSize = Math.min(screenW - 24, screenH - 200, 360);
  const cx = stageSize / 2;
  const cy = stageSize / 2;

  // Build the graph. selfId falls back to a deterministic string when
  // unauthenticated (tests, dev) so the layout still renders.
  const selfId = authedUserId ?? "local-self";

  // Friends map for color + name lookup.
  const friendsMap = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    for (const f of friends) {
      m.set(f.id, { name: f.name.split(" ")[0] ?? f.name, color: colorForFriend(f.id) });
    }
    return m;
  }, [friends]);

  // Convert postcards into graph-ready PostcardForGraph rows.
  // v0.7.1: senderId is now exposed on Postcard. Real inbound edges
  // surface in the graph (the reciprocation gold ring fires when a
  // friend has BOTH outbound + inbound cards with the user).
  // voidReplies are anonymous-sender — they can&apos;t be graphed since
  // we don&apos;t know the other endpoint&apos;s userId.
  const graphPostcards = useMemo<PostcardForGraph[]>(() => {
    // v0.7.0.24: build a Set of *visible* friend IDs so we can detect
    // postcards that point to a hidden friend (e.g. the "(me)" self
    // friend created by welcome-flow self-sends). Those shouldn't
    // appear as a separate node — they collapse into the self node.
    // Without this, the constellation showed a "Someone" stranger
    // node for every self-send that couldn't be tapped into.
    const visibleFriendIds = new Set(friends.map((f) => f.id));
    const rows: PostcardForGraph[] = [];
    for (const p of postcards) {
      // Pen-pal cards (void) stay out of the graph.
      if (p.toFriendId === "void") continue;
      // Pending send-link cards: recipientId: null synthesizes a placeholder.
      if (p.toFriendId === "") {
        rows.push({
          id: p.id,
          senderId: p.senderId ?? selfId,
          recipientId: null,
          status: p.status,
        });
        continue;
      }
      if (!p.toFriendId) continue;
      // Self-send detection: the recipient friend was filtered out of
      // the visible friends list (build 34's "(me)" filter). Skip the
      // postcard entirely — the user is the self node, sending to
      // themselves doesn't add a constellation node.
      if (!visibleFriendIds.has(p.toFriendId)) continue;
      rows.push({
        id: p.id,
        senderId: p.senderId ?? selfId,
        recipientId: p.toFriendId,
        status: p.status,
      });
    }
    return rows;
  }, [postcards, selfId, friends]);

  const { nodes, edges } = useMemo(
    () =>
      buildSocialGraph(graphPostcards, {
        selfId,
        friends: friendsMap,
        cx,
        cy,
        selfColor: colors.gold,
        selfName: currentUser.name.split(" ")[0] || "you",
      }),
    [graphPostcards, selfId, friendsMap, cx, cy, currentUser.name],
  );

  // Tap-node state → opens the FriendDetailSheet.
  const [activeFriendId, setActiveFriendId] = useState<string | null>(null);
  const activeFriend = friends.find((f) => f.id === activeFriendId) ?? null;

  // ----- Pan + pinch gestures --------------------------------------------
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const sx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sy = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .minPointers(2)
    .maxPointers(2)
    .onUpdate((e) => {
      tx.value = sx.value + e.translationX;
      ty.value = sy.value + e.translationY;
    })
    .onEnd(() => {
      sx.value = tx.value;
      sy.value = ty.value;
    });

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const next = savedScale.value * e.scale;
      scale.value = Math.max(0.6, Math.min(3, next));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(1, { duration: 250 });
      savedScale.value = 1;
      tx.value = withTiming(0, { duration: 250 });
      sx.value = 0;
      ty.value = withTiming(0, { duration: 250 });
      sy.value = 0;
    });

  const composedGesture = Gesture.Simultaneous(
    panGesture,
    Gesture.Exclusive(doubleTapGesture, pinchGesture),
  );

  const stageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  function onTapNode(node: GraphNode) {
    if (node.isSelf) {
      // Tapping yourself clears any active drilldown.
      setActiveFriendId(null);
      return;
    }
    // v0.7.0.7: pending node → open the postcard detail sheet so the
    // sender can re-share the claim URL. The pending node id has the
    // form "pending:<postcardId>".
    if (node.pending && node.id.startsWith("pending:")) {
      const postcardId = node.id.slice("pending:".length);
      detailRef.current?.open(postcardId);
      return;
    }
    setActiveFriendId(node.id);
  }

  return (
    <BottomSheetModalProvider>
    <View style={styles.root} testID="constellation-screen">
      {/* Dark sky background — full bleed under everything */}
      <View style={styles.sky} pointerEvents="none" />

      {/* v0.7.0.2: custom dark-themed header. The shared <Header /> renders
          ink-on-paper which is invisible against the night sky, and it
          doesn&apos;t respect safe-area top on a full-bleed dark screen so
          the status bar overlapped the title. This dedicated header sits
          below the status bar, uses paper-light text + a paper-light
          credits pill that contrasts cleanly on the dark sky. */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.headerTitle}>Constellation</Text>
        <Pressable
          onPress={() => setCreditsOpen(true)}
          style={({ pressed }) => [styles.creditsPill, pressed && { opacity: 0.7 }]}
          accessibilityRole="button"
          accessibilityLabel={`${credits} ${credits === 1 ? "stamp" : "stamps"}. Tap to buy more.`}
          testID="header-credits-pill"
          hitSlop={8}
        >
          <Mail color={colors.ink} size={15} strokeWidth={1.8} />
          <Text style={styles.creditsCount}>{credits}</Text>
        </Pressable>
      </View>

      <View style={styles.stageWrap}>
        <GestureDetector gesture={composedGesture}>
          <AnimatedView style={[styles.stage, { width: stageSize, height: stageSize }, stageStyle]}>
            <Svg width={stageSize} height={stageSize} style={StyleSheet.absoluteFill}>
              {/* Edges first so they render under nodes. v0.7.0.4: edges
                  are tappable — opens the PostcardPreviewSheet scoped to
                  the friend on the other end of that edge. Wider hit
                  region via an invisible thicker stroke layered behind. */}
              {edges.map((edge: GraphEdge) => {
                const sourceId = edgeId(edge.source);
                const targetId = edgeId(edge.target);
                const a = nodes.find((n) => n.id === sourceId);
                const b = nodes.find((n) => n.id === targetId);
                if (!a || !b || a.x == null || a.y == null || b.x == null || b.y == null) return null;
                const isPending = !!edge.pending;
                const thickness = isPending
                  ? 1.4
                  : Math.min(2.2, 0.6 + edge.momentCount * 0.18);
                const edgeColor = isPending
                  ? "rgba(255,255,255,0.48)" // dimmer for pending
                  : edge.reciprocated
                    ? "rgba(217,180,110,0.78)" // gold for reciprocated
                    : "rgba(255,255,255,0.22)";
                // The "other side" is whichever endpoint isn't self.
                const otherId = a.isSelf ? b.id : a.id;
                const otherName = a.isSelf ? b.name : a.name;
                const onEdgePress = () => {
                  if (otherId === selfId) return;
                  // v0.7.0.7: pending nodes carry the postcard id in their
                  // synthetic id ("pending:<postcardId>") — open the detail
                  // sheet directly so the user can re-share the claim URL.
                  if (isPending && otherId.startsWith("pending:")) {
                    const postcardId = otherId.slice("pending:".length);
                    detailRef.current?.open(postcardId);
                    return;
                  }
                  sheetRef.current?.open({
                    kind: "friend",
                    friendId: otherId,
                    friendName: otherName,
                  });
                };
                return (
                  <React.Fragment key={`${sourceId}-${targetId}`}>
                    {/* Wide invisible stroke for hit target */}
                    <Line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke="transparent"
                      strokeWidth={Math.max(thickness, 12)}
                      strokeLinecap="round"
                      onPress={onEdgePress}
                    />
                    {/* Visible line — dashed for pending claims */}
                    <Line
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={edgeColor}
                      strokeWidth={thickness}
                      strokeLinecap="round"
                      strokeDasharray={isPending ? "4,5" : undefined}
                      onPress={onEdgePress}
                    />
                  </React.Fragment>
                );
              })}

              {/* Nodes */}
              {nodes.map((node) => {
                if (node.x == null || node.y == null) return null;
                const isPending = !!node.pending;
                const radius = node.isSelf
                  ? 13
                  : isPending
                    ? 8
                    : 9 + Math.min(6, node.momentCount * 1.5);
                const isReciprocated = (node as any).reciprocated === true;
                return (
                  <Circle
                    key={node.id}
                    cx={node.x}
                    cy={node.y}
                    r={radius}
                    fill={isPending ? "rgba(248,241,227,0.18)" : node.color}
                    stroke={
                      node.isSelf
                        ? "rgba(255,255,255,0.7)"
                        : isReciprocated
                          ? "#D9B46E"
                          : isPending
                            ? "rgba(255,255,255,0.55)"
                            : "rgba(255,255,255,0.4)"
                    }
                    strokeWidth={node.isSelf ? 2 : isReciprocated ? 2.4 : 1.4}
                    strokeDasharray={isPending ? "3,3" : undefined}
                    onPress={() => onTapNode(node)}
                  />
                );
              })}
            </Svg>

            {/* Labels: rendered as RN text so they antialias correctly */}
            {nodes.map((node) => {
              if (node.x == null || node.y == null) return null;
              const radius = node.isSelf ? 13 : 9 + Math.min(6, node.momentCount * 1.5);
              return (
                <Pressable
                  key={`label-${node.id}`}
                  onPress={() => onTapNode(node)}
                  style={[
                    styles.label,
                    {
                      left: node.x - 40,
                      top: node.y + radius + 4,
                    },
                  ]}
                  hitSlop={8}
                  testID={`constellation-node-${node.id}`}
                >
                  <Text
                    style={[
                      styles.labelText,
                      node.isSelf && styles.labelTextSelf,
                    ]}
                    numberOfLines={1}
                  >
                    {node.name}
                  </Text>
                </Pressable>
              );
            })}
          </AnimatedView>
        </GestureDetector>
      </View>

      {/* Empty-state hint */}
      {nodes.length <= 1 ? (
        <View style={styles.emptyHint} pointerEvents="none">
          <Text style={styles.emptyHintText}>
            Mail a card to see your{"\n"}constellation light up.
          </Text>
        </View>
      ) : null}

      {/* Hint chip — pan + pinch instructions */}
      {nodes.length > 1 ? (
        <View style={styles.hintChip} pointerEvents="none">
          <Text style={styles.hintText}>
            two-finger drag · pinch to zoom · double-tap to reset
          </Text>
        </View>
      ) : null}

      <FriendDetailSheet
        friend={activeFriend}
        visible={activeFriend !== null}
        onClose={() => setActiveFriendId(null)}
        onSend={(_friendId) => {
          setActiveFriendId(null);
          router.push("/send");
        }}
      />

      <CreditsSheet visible={creditsOpen} onClose={() => setCreditsOpen(false)} />

      {/* v0.7.0.4: tap an edge → bottom sheet of postcards exchanged
          on that line. Same component the Map uses for pin taps. */}
      <PostcardPreviewSheet ref={sheetRef} />

      {/* v0.7.0.7: tap a pending node or pending edge → postcard detail
          sheet with the claim URL + Share Again button. */}
      <PostcardDetailSheet ref={detailRef} />
    </View>
    </BottomSheetModalProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0B0F1A",
    position: "relative",
  },
  sky: {
    position: "absolute",
    inset: 0,
    backgroundColor: "#0B0F1A",
  },

  // Dark-themed inline header. Paper-cream credits pill + serif title in
  // gold for legibility on the dark sky. Padding respects safe-area top.
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingBottom: 8,
    zIndex: 10,
  },
  headerTitle: {
    color: colors.paper,
    fontFamily: fonts.serifSemi,
    fontSize: 28,
    letterSpacing: -0.3,
  },
  creditsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.paper,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  creditsCount: {
    color: colors.ink,
    fontFamily: fonts.serifSemi,
    fontSize: 15,
    includeFontPadding: false,
    lineHeight: 18,
    minWidth: 10,
    textAlign: "center",
  },

  stageWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  stage: {
    position: "relative",
  },
  label: {
    position: "absolute",
    width: 80,
    alignItems: "center",
  },
  labelText: {
    color: "rgba(255,255,255,0.78)",
    fontFamily: fonts.script,
    fontSize: 13,
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  labelTextSelf: {
    color: colors.gold,
    fontFamily: fonts.serifSemi,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  emptyHint: {
    position: "absolute",
    bottom: 120,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  emptyHintText: {
    color: "rgba(255,255,255,0.55)",
    fontFamily: fonts.serifItalic,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  hintChip: {
    position: "absolute",
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  hintText: {
    color: "rgba(255,255,255,0.4)",
    fontFamily: fonts.sans,
    fontSize: 11,
    letterSpacing: 0.4,
  },
});
