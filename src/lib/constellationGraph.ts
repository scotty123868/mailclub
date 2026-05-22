/**
 * Pure social-graph builder for the constellation.
 *
 * Ported from teteapp's `src/lib/constellationGraph.ts` and adapted for
 * Mailroom&apos;s data model. The shape, simulation parameters, and
 * positional clamping all match the t&ecirc;te version 1:1 — only the
 * data model changes:
 *
 *   teteapp                            mailroom
 *   ──────────────────────────         ─────────────────────────────
 *   LocalMoment                        Postcard
 *   moment.participants[]              (sender_id, recipient_id) — two-party
 *   moment.status === "won"            postcard.status === "sent"|"delivered"
 *   moment.isSolo                      n/a — postcards are always 2-party
 *   moment.privacy === "public"        n/a — defer to v0.7.5 (no FoF for now)
 *
 * Visibility rules (Mailroom v0.7):
 *   - Every postcard with sender_id = self OR recipient_id = self is
 *     visible as an edge (self → other).
 *   - Friend-of-friend edges (postcards between two of your friends that
 *     you can see) are not surfaced in v0.7. The FoF toggle in the UI is
 *     kept for forward compat but currently has no effect.
 *
 * Split from ConstellationScreen.tsx so the graph builder can be unit
 * tested without importing React Native.
 */

import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  SimulationLinkDatum,
  SimulationNodeDatum,
} from "d3-force";

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  color: string;
  isSelf: boolean;
  /** Friend-of-friend flag — kept for forward compat but always false in
   *  v0.7 (no FoF visibility for postcards yet; defer to v0.7.5). */
  isFoF: boolean;
  /** Number of visible postcards this node participates in (sent + received,
   *  between self and them). */
  momentCount: number;
  /** v0.7.0.7: pending-recipient flag. True for synthetic nodes that
   *  stand in for a send-link postcard whose claim hasn&apos;t been
   *  resolved yet. The UI renders these with a dashed edge + dimmed
   *  node so the user gets a tangible "I sent something" feel before
   *  the recipient ever fills in their address. */
  pending?: boolean;
}

export interface GraphEdge extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  /** Number of postcards on this edge (across all time). */
  momentCount: number;
  /** Postcard ids on this edge — drives the line-tap bottom sheet. */
  momentIds: string[];
  /** v0.7 D.3 magical-moment: gold ring on the recipient&apos;s node when
   *  the user has both sent to AND received from them. */
  reciprocated?: boolean;
  /** v0.7.0.7: edge into a pending-recipient (send-link, unclaimed)
   *  node. Rendered as a dashed line so the user sees the connection
   *  forming before the address is filled in. */
  pending?: boolean;
}

/** Canonical pair key so (a,b) and (b,a) accumulate into one edge. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function edgeId(endpoint: string | GraphNode): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

/** Minimal postcard shape the graph builder needs. Maps from the
 *  Postcard + receiver-side rows. */
export interface PostcardForGraph {
  id: string;
  senderId: string;
  recipientId: string | null;
  status: "draft" | "sent" | "delivered" | "queued" | "awaiting_address" | "in_transit" | "returned" | "expired" | "cancelled";
  /** v0.7.0.58: recipient name from postcard_claims.claimed_name. Used to
   *  label claim-mode nodes once the recipient has submitted their
   *  address. Undefined for unclaimed claim cards (placeholder label). */
  claimedName?: string;
}

export interface BuildGraphOpts {
  selfId: string;
  /** Map of friend.id → { name, color } for label/color resolution. */
  friends: Map<string, { name: string; color: string }>;
  cx: number;
  cy: number;
  /** Self-node color from the UI palette. */
  selfColor?: string;
  selfName?: string;
  /** Forward-compat. Default false. No effect in v0.7. */
  includeFoF?: boolean;
}

export function buildSocialGraph(
  postcards: PostcardForGraph[],
  opts: BuildGraphOpts,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const { selfId, friends, cx, cy } = opts;
  const selfColor = opts.selfColor ?? "#D9B46E"; // Mailroom gold
  const selfName = opts.selfName ?? "you";

  const nodes = new Map<string, GraphNode>();
  nodes.set(selfId, {
    id: selfId,
    name: selfName,
    color: selfColor,
    isSelf: true,
    isFoF: false,
    momentCount: 0,
    fx: cx,
    fy: cy,
    x: cx,
    y: cy,
  });

  const edgeMap = new Map<
    string,
    {
      a: string;
      b: string;
      momentCount: number;
      momentIds: string[];
      hasOutbound: boolean;
      hasInbound: boolean;
      pending?: boolean;
    }
  >();

  for (const p of postcards) {
    // Skip drafts.
    if (p.status === "draft") continue;

    // v0.7.0.7: claim-mode postcards have recipientId === null (the
    // postcards table doesn't track the recipient through a friend id;
    // it lives on postcard_claims.claimed_name after redemption).
    //
    // v0.7.0.58: split this branch into "claimed" vs "still awaiting":
    //   - If claimed_name exists (recipient already submitted their
    //     address), label the node with the claimed name and treat the
    //     edge as a real send, not a pending one. The card is en route
    //     to a known person; the graph should say so.
    //   - Otherwise, fall back to the "Awaiting friend" placeholder
    //     with the dashed-edge pending treatment.
    if (!p.recipientId) {
      if (p.senderId !== selfId) continue; // only self-outbound claim cards
      const hasName = !!p.claimedName && p.claimedName.trim().length > 0;
      const pendingId = `pending:${p.id}`;
      const display = hasName
        ? p.claimedName!.trim()
        : "Awaiting friend";
      nodes.set(pendingId, {
        id: pendingId,
        name: display,
        // Claimed-but-no-friend-id recipients get the same warm color as
        // known friends; still-awaiting get the dim placeholder color.
        color: hasName ? "#D6B068" : "rgba(255,255,255,0.42)",
        isSelf: false,
        isFoF: false,
        momentCount: 1,
        // Only flag pending when we genuinely don't know the recipient
        // yet. Once claimed_name is set, the edge solidifies in the UI
        // (dashed → solid) per the constellation render logic.
        pending: !hasName,
      });
      nodes.get(selfId)!.momentCount += 1;
      const key = pairKey(selfId, pendingId);
      edgeMap.set(key, {
        a: selfId,
        b: pendingId,
        momentCount: 1,
        momentIds: [p.id],
        hasOutbound: true,
        hasInbound: false,
        pending: !hasName,
      });
      continue;
    }

    const isOutbound = p.senderId === selfId;
    const isInbound = p.recipientId === selfId;
    if (!isOutbound && !isInbound) {
      // Neither endpoint is self → not visible in v0.7 (no FoF).
      continue;
    }

    const other = isOutbound ? p.recipientId : p.senderId;

    // Ensure both nodes exist.
    if (!nodes.has(other)) {
      const friend = friends.get(other);
      nodes.set(other, {
        id: other,
        name: friend?.name ?? "Someone",
        color: friend?.color ?? "#3C6E8F", // postalBlue default for unknown
        isSelf: false,
        isFoF: false,
        momentCount: 0,
      });
    }
    nodes.get(other)!.momentCount += 1;
    nodes.get(selfId)!.momentCount += 1;

    // Single edge per pair (selfId, other), even though we may add
    // multiple postcards. Track inbound + outbound separately so the
    // reciprocation flag fires only when BOTH directions exist.
    const key = pairKey(selfId, other);
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        a: selfId,
        b: other,
        momentCount: 0,
        momentIds: [],
        hasOutbound: false,
        hasInbound: false,
      });
    }
    const e = edgeMap.get(key)!;
    e.momentCount += 1;
    e.momentIds.push(p.id);
    if (isOutbound) e.hasOutbound = true;
    if (isInbound) e.hasInbound = true;
  }

  const nodeList = Array.from(nodes.values());
  const edgeList: GraphEdge[] = Array.from(edgeMap.values()).map((e) => ({
    source: e.a,
    target: e.b,
    momentCount: e.momentCount,
    momentIds: e.momentIds,
    reciprocated: e.hasOutbound && e.hasInbound,
    pending: e.pending,
  }));

  // Force simulation, parameters lifted from teteapp and re-tuned for
  // the v0.7 use-case where most new users have 1–5 nodes for weeks.
  // The old params (link distance 60, charge -80) made 2-node graphs
  // render with both nodes piled on top of each other in the center
  // because self has fx/fy = (cx, cy) and the friend's repulsion wasn't
  // strong enough to push past the center-pull forces.
  const dense = nodeList.length > 20;
  const sparse = nodeList.length <= 4;
  // For sparse graphs, push everyone way out so the user sees the
  // shape of "you + a friend" at a satisfying scale.
  const baseDistance = dense ? 80 : sparse ? 140 : 90;
  const chargeStrength = dense ? -150 : sparse ? -260 : -120;
  // Weaken the center-pull on sparse graphs so the charge can spread
  // them out properly without being yanked back to the middle.
  const centerStrength = sparse ? 0.02 : 0.08;
  const axisStrength = sparse ? 0.01 : 0.04;
  const sim = forceSimulation<GraphNode>(nodeList)
    .force(
      "link",
      forceLink<GraphNode, GraphEdge>(edgeList)
        .id((n) => n.id)
        .distance((edge) => baseDistance + Math.max(0, 30 - edge.momentCount * 4))
        .strength(0.5),
    )
    .force("charge", forceManyBody<GraphNode>().strength(chargeStrength))
    .force("center", forceCenter(cx, cy).strength(centerStrength))
    .force("x", forceX<GraphNode>(cx).strength(axisStrength))
    .force("y", forceY<GraphNode>(cy).strength(axisStrength))
    .stop();
  const ticks = dense ? 240 : 200;
  for (let i = 0; i < ticks; i++) sim.tick();

  // Clamp non-self nodes inside the stage with a 16px margin.
  const margin = 16;
  const minX = margin;
  const maxX = cx * 2 - margin;
  const minY = margin;
  const maxY = cy * 2 - margin;
  for (const n of nodeList) {
    if (n.isSelf) continue;
    if (n.x != null) n.x = Math.max(minX, Math.min(maxX, n.x));
    if (n.y != null) n.y = Math.max(minY, Math.min(maxY, n.y));
  }

  // Stamp `reciprocated` onto the NODE too (not just the edge) so the
  // gold-ring D.3 magical moment can hit-test by node id without
  // dereferencing the edge.
  for (const edge of edgeList) {
    if (!edge.reciprocated) continue;
    const target = nodeList.find((n) => n.id === (typeof edge.target === "string" ? edge.target : edge.target.id));
    if (target) (target as any).reciprocated = true;
  }

  return { nodes: nodeList, edges: edgeList };
}
