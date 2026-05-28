export type CardCategory = "handwritten" | "photo" | "place" | "custom";

export type CustomTone = "playful" | "romantic" | "formal" | "weird";

export type Friend = {
 id: string;
 name: string;
 city: string;
 state: string;
 avatarInitials: string;
 cardsSent: number;
 cardsReceived: number;
 connectionType: "in-person" | "postcard-invite";
 lastInteractionAt: string;
 relationshipSignal?: string;
 signalTone?: "red" | "green" | "blue";
 photoUrl?: string;
 /**
 * Birthday as a free-form short string (e.g. "June 8", "1992-06-08").
 * Optional. We surface birthday reminders in 0.5.x by parsing the
 * month/day pattern; full year is unused. (Added in 0.5.0 Phase 2.6.)
 */
 birthday?: string;
 /** Mailing address. required for Lob to ship a card. */
 addressLine1?: string;
 addressLine2?: string;
 addressCity?: string;
 addressState?: string;
 addressZip?: string;
 addressCountry?: string;
};

/** Subset of Friend fields that capture a deliverable US mailing address. */
export type FriendAddressInput = {
 addressLine1?: string;
 addressLine2?: string;
 addressCity?: string;
 addressState?: string;
 addressZip?: string;
 addressCountry?: string;
};

export type Postcard = {
 id: string;
 /**
 * Sender id. UUID of the user who sent the card. Required for the
 * v0.7 reciprocation badge (gold ring when sender + recipient both
 * exist on the same friend) and the WeeklyJournal&apos;s inbound /
 * outbound rendering.
 *
 * Optional for backward compat with v0.6.x mock postcards that don&apos;t
 * carry it. When undefined, treat as "outbound from the current user"
 * (the historical default. only outbound cards lived in this array
 * before migration 1210).
 */
 senderId?: string;
 /**
 * Recipient id. For "void"/"penpal" cards this is the literal string
 * "void". For "friend" cards it&apos;s the friend&apos;s UUID. For "link"
 * cards (claim-link mode) it&apos;s "" until the recipient claims.
 */
 toFriendId: string;
 fromCity: string;
 toCity: string;
 category: CardCategory;
 creditCost: number;
 // v0.7.0.19: "awaiting_address" is assigned to shareable-link cards
 // before the recipient fills in their address. v0.7.0.61+: "expired"
 // is assigned after the unclaimed link expires and the credit is refunded.
 status: "draft" | "sent" | "delivered" | "awaiting_address" | "expired" | "cancelled";
 message: string;
 sentAt: string;
 placeName?: string;
 photoUri?: string;
 customDescription?: string;
 customTone?: CustomTone;
 referencePhotoUris?: string[];
 /**
 * Claim URL for send-by-link cards. Populated by fetchPostcards via the
 * sender-safe claim RPC fields. Present whenever the card was sent with
 * `to_kind === "claim"`. The card may still be unclaimed
 * (`toFriendId === ""`) or claimed (toFriendId populated). both cases
 * surface the URL so the sender can re-share it forever.
 */
 claimUrl?: string;
 /**
 * v0.7.0.49: claim link expiry timestamp from postcard_claims.expires_at.
 * 30 days from claim creation. Used by PostcardDetailSheet to surface an
 * "expires in N days" indicator on unclaimed cards so the sender knows
 * to reshare before the recipient loses access.
 */
 claimExpiresAt?: string;
 /**
 * v0.7.0.58: recipient name from postcard_claims.claimed_name. Populated
 * after the recipient submits their address via the claim link. Used by
 * the Constellation graph to label the node with the actual recipient
 * instead of the "Awaiting friend" placeholder, and by the postcard
 * detail sheet to surface "To {claimedName}" after redemption.
 */
 claimedName?: string;
 /**
 * v0.7.0.58: recipient city from postcard_claims.claimed_city. Used to
 * surface "To Maya in Denver" once the claim has been redeemed.
 */
 claimedCity?: string;
 /**
 * v0.7.0.59: granular Lob delivery status. Webhook keeps this fresh as the
 * postcard moves through the print pipeline:
 * "received" → "in_production" → "mailed" → "in_transit"
 * → "processed_for_delivery" → "delivered"
 * Used by the postcard sheet to show "PRINTING" / "MAILED" / etc.
 * instead of a single "ON ITS WAY" for everything pre-delivery.
 */
 lobStatus?: string | null;
 /** v0.7.0.59: expected delivery date from Lob, surfaced on the card as
 * "Arrives by Jun 2". */
 lobExpectedDelivery?: string | null;
 /**
 * Lob postcard id, populated only after the Lob handoff succeeds.
 * Null/undefined while the card is in flight to Lob OR if the handoff
 * failed silently (the orphan state we built `retry-orphan` to fix).
 * UI uses this to show the "Retry shipping" affordance.
 */
 lobId?: string | null;
 /**
 * v0.7.0.49 (Codex audit): persisted reason the last Lob send failed.
 * Populated by lob-send-postcard on rejection, by claim/index.ts on
 * missing-secret misconfig, by the lob-submission lease on attempt
 * failure. PostcardDetailSheet can show this to the sender alongside
 * the Retry affordance so they know WHY the original send didn't ship.
 */
 lobError?: string | null;
};

export type MailRoute = {
 id: string;
 from: string;
 to: string;
 date: string;
 miles: number;
 people: string;
};

export type Milestone = {
 id: string;
 title: string;
 date: string;
};

export type CurrentUser = {
 name: string;
 city: string;
 state: string;
 since: string;
 avatarInitials: string;
 tagline: string;
 interests: string;
 sendMe: string;
 birthday: string;
 currentlyInto: string;
 photoUrl?: string;
};
