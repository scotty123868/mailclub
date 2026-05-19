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
  /** Mailing address — required for Lob to ship a card. */
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
   * Sender id — UUID of the user who sent the card. Required for the
   * v0.7 reciprocation badge (gold ring when sender + recipient both
   * exist on the same friend) and the WeeklyJournal&apos;s inbound /
   * outbound rendering.
   *
   * Optional for backward compat with v0.6.x mock postcards that don&apos;t
   * carry it. When undefined, treat as "outbound from the current user"
   * (the historical default — only outbound cards lived in this array
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
  // v0.7.0.19: added "awaiting_address" — the status assigned by
  // send_postcard_via_claim when the sender creates a shareable link but
  // the recipient hasn't filled in their address yet. The client treats
  // this as "queued" / "outbound but pending claim" for journal and
  // Sent-count purposes.
  status: "draft" | "sent" | "delivered" | "awaiting_address";
  message: string;
  sentAt: string;
  placeName?: string;
  photoUri?: string;
  customDescription?: string;
  customTone?: CustomTone;
  referencePhotoUris?: string[];
  /**
   * Claim URL for send-by-link cards. Populated by fetchPostcards via a
   * LEFT JOIN against postcard_claims. Present whenever the card was sent
   * with `to_kind === "claim"`. The card may still be unclaimed
   * (`toFriendId === ""`) or claimed (toFriendId populated) — both cases
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
   * Lob postcard id, populated only after the Lob handoff succeeds.
   * Null/undefined while the card is in flight to Lob OR if the handoff
   * failed silently (the orphan state we built `retry-orphan` to fix).
   * UI uses this to show the "Retry shipping" affordance.
   */
  lobId?: string | null;
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
