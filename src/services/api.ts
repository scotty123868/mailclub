import { supabase } from "@/src/services/supabase";
import type { CardCategory, CurrentUser, CustomTone, Friend, Postcard } from "@/src/types/mail";
import type { NotificationPrefs, PrivacyPrefs, VoidReply } from "@/src/state/MailClubContext";

/**
 * High-level API wrappers over the Supabase client. Each function maps a
 * single MailClubContext action onto one or more SQL operations. The
 * context layer is the only place these are called — UI components stay
 * unaware of Supabase.
 *
 * Row shapes from the DB are snake_case. We translate to the app's
 * camelCase types here so the rest of the codebase never sees DB shapes.
 */

// -----------------------------------------------------------------------------
// Profile
// -----------------------------------------------------------------------------

type ProfileRow = {
  id: string;
  name: string;
  city: string;
  state: string;
  since: string;
  avatar_initials: string;
  tagline: string;
  interests: string;
  send_me: string;
  birthday: string;
  currently_into: string;
  credits: number;
  free_credits_remaining: number;
  has_seen_free_credits_intro: boolean;
  has_completed_signup: boolean;
  notifications: NotificationPrefs;
  privacy: PrivacyPrefs;
  photo_url: string | null;
};

function profileFromRow(row: ProfileRow): {
  currentUser: CurrentUser;
  credits: number;
  freeCreditsRemaining: number;
  hasSeenFreeCreditsIntro: boolean;
  hasCompletedSignup: boolean;
  notifications: NotificationPrefs;
  privacy: PrivacyPrefs;
} {
  return {
    currentUser: {
      name: row.name,
      city: row.city,
      state: row.state,
      since: row.since,
      avatarInitials: row.avatar_initials,
      tagline: row.tagline,
      interests: row.interests,
      sendMe: row.send_me,
      birthday: row.birthday,
      currentlyInto: row.currently_into,
      photoUrl: row.photo_url ?? undefined,
    },
    credits: row.credits,
    freeCreditsRemaining: row.free_credits_remaining,
    hasSeenFreeCreditsIntro: row.has_seen_free_credits_intro,
    hasCompletedSignup: row.has_completed_signup,
    notifications: row.notifications,
    privacy: row.privacy,
  };
}

export async function fetchProfile() {
  const { data, error } = await supabase.from("profiles").select("*").maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return profileFromRow(data as ProfileRow);
}

export async function updateProfile(patch: Partial<CurrentUser>) {
  const dbPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.city !== undefined) dbPatch.city = patch.city;
  if (patch.state !== undefined) dbPatch.state = patch.state;
  if (patch.tagline !== undefined) dbPatch.tagline = patch.tagline;
  if (patch.interests !== undefined) dbPatch.interests = patch.interests;
  if (patch.sendMe !== undefined) dbPatch.send_me = patch.sendMe;
  if (patch.birthday !== undefined) dbPatch.birthday = patch.birthday;
  if (patch.currentlyInto !== undefined) dbPatch.currently_into = patch.currentlyInto;
  if (patch.avatarInitials !== undefined) dbPatch.avatar_initials = patch.avatarInitials;
  // Only sync remote URLs. Local file:// URIs stay client-side until they're
  // uploaded via uploadProfilePhoto() and the caller replaces them with a
  // signed URL.
  if (patch.photoUrl !== undefined) {
    const url = patch.photoUrl;
    if (url === "" || url === null) {
      dbPatch.photo_url = null;
    } else if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      dbPatch.photo_url = url;
    }
  }
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await supabase.from("profiles").update(dbPatch).eq("id", (await supabase.auth.getUser()).data.user?.id);
  if (error) throw error;
}

/**
 * Upload a local image file to the `profile-photos` Storage bucket and return
 * its public URL. The caller is responsible for then calling updateProfile
 * with the returned URL to persist it.
 *
 * Requires the `profile-photos` bucket to exist in Supabase Storage (see
 * `supabase/migrations/2026051204_profile_photo.sql` for the bucket setup).
 */
export async function uploadProfilePhoto(localUri: string): Promise<string> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error("Not signed in.");
  // Read the local file as a blob via fetch — works on RN.
  const response = await fetch(localUri);
  const blob = await response.blob();
  const ext = (localUri.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from("profile-photos")
    .upload(path, blob, { upsert: true, contentType: blob.type || `image/${ext}` });
  if (error) throw error;
  const { data } = supabase.storage.from("profile-photos").getPublicUrl(path);
  return data.publicUrl;
}

export async function updateNotificationPrefs(prefs: NotificationPrefs) {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return;
  const { error } = await supabase.from("profiles").update({ notifications: prefs }).eq("id", userId);
  if (error) throw error;
}

export async function updatePrivacyPrefs(prefs: PrivacyPrefs) {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return;
  const { error } = await supabase.from("profiles").update({ privacy: prefs }).eq("id", userId);
  if (error) throw error;
}

export async function markFreeCreditsIntroSeen() {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) return;
  const { error } = await supabase.from("profiles").update({ has_seen_free_credits_intro: true }).eq("id", userId);
  if (error) throw error;
}

export async function completeSignup(input: { name: string; city: string; state: string }) {
  const { data, error } = await supabase.rpc("complete_signup", {
    p_name: input.name,
    p_city: input.city,
    p_state: input.state,
  });
  if (error) throw error;
  return profileFromRow(data as ProfileRow);
}

// -----------------------------------------------------------------------------
// Friends
// -----------------------------------------------------------------------------

type FriendRow = {
  id: string;
  name: string;
  city: string;
  state: string;
  avatar_initials: string;
  cards_sent: number;
  cards_received: number;
  connection_type: "in-person" | "postcard-invite";
  last_interaction_at: string;
  relationship_signal: string | null;
  signal_tone: "red" | "green" | "blue" | null;
  /**
   * Added in v0.5.0 Phase 2.6. The friends.birthday column ships in the
   * 0.5.1 migration; until then the column is missing and supabase will
   * return null/undefined here. The friend row type allows null so the
   * mapping handles both shapes.
   */
  birthday: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  address_country: string | null;
};

function friendFromRow(row: FriendRow): Friend {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    avatarInitials: row.avatar_initials,
    cardsSent: row.cards_sent,
    cardsReceived: row.cards_received,
    connectionType: row.connection_type,
    lastInteractionAt: row.last_interaction_at,
    relationshipSignal: row.relationship_signal ?? undefined,
    signalTone: row.signal_tone ?? undefined,
    birthday: row.birthday ?? undefined,
    addressLine1: row.address_line1 ?? undefined,
    addressLine2: row.address_line2 ?? undefined,
    addressCity: row.address_city ?? undefined,
    addressState: row.address_state ?? undefined,
    addressZip: row.address_zip ?? undefined,
    addressCountry: row.address_country ?? undefined,
  };
}

export async function fetchFriends(): Promise<Friend[]> {
  const { data, error } = await supabase
    .from("friends")
    .select("*")
    .order("last_interaction_at", { ascending: false });
  if (error) throw error;
  return (data as FriendRow[]).map(friendFromRow);
}

export type AddFriendInput = {
  name: string;
  city: string;
  state: string;
  birthday?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressCity?: string;
  addressState?: string;
  addressZip?: string;
  addressCountry?: string;
};

export async function addFriend(input: AddFriendInput): Promise<Friend> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error("not authenticated");
  const name = input.name.trim();
  if (!name) throw new Error("name required");
  const initials = name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase();
  const row: Record<string, unknown> = {
    owner_id: userId,
    name,
    city: input.city.trim(),
    state: input.state.trim(),
    avatar_initials: initials,
    connection_type: "postcard-invite",
    relationship_signal: "Just added",
    signal_tone: "blue",
  };
  // Optional birthday. The friends.birthday column ships in the 0.5.1
  // migration; once that lands this write succeeds. Until then PostgREST
  // returns "column friends.birthday does not exist" and the catch in
  // MailClubContext.addFriendByAddressAction surfaces a friendly message.
  // We omit the field here when undefined so the insert succeeds on a
  // schema without the column.
  if (input.birthday?.trim()) row.birthday = input.birthday.trim();
  // Optional mailing address — only set non-blank fields so we don't write
  // empty strings (which would still count as "address present" and confuse
  // the can-send check).
  if (input.addressLine1?.trim()) row.address_line1 = input.addressLine1.trim();
  if (input.addressLine2?.trim()) row.address_line2 = input.addressLine2.trim();
  if (input.addressCity?.trim()) row.address_city = input.addressCity.trim();
  if (input.addressState?.trim()) row.address_state = input.addressState.trim();
  if (input.addressZip?.trim()) row.address_zip = input.addressZip.trim();
  row.address_country = (input.addressCountry?.trim() || "US").toUpperCase();
  const { data, error } = await supabase
    .from("friends")
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return friendFromRow(data as FriendRow);
}

export async function removeFriend(id: string) {
  const { error } = await supabase.from("friends").delete().eq("id", id);
  if (error) throw error;
}

// -----------------------------------------------------------------------------
// Postcards
// -----------------------------------------------------------------------------

type PostcardRow = {
  id: string;
  // v0.7.1: sender_id is the canonical column after migration 1209. The
  // postcardFromRow mapper exposes it on the client-side Postcard type
  // so the WeeklyJournal + Constellation can distinguish inbound from
  // outbound cards (gold reciprocation ring + accurate Received count).
  sender_id?: string | null;
  to_kind: "friend" | "void" | "claim";
  to_friend_id: string | null;
  from_city: string;
  to_city: string;
  category: CardCategory;
  credit_cost: number;
  // codex Phase 6 P2: status union was missing the runtime values added by
  // migrations 1208/1209 ('queued', 'awaiting_address', 'in_transit',
  // 'returned'). TS was lying about the row shape.
  status: "draft" | "sent" | "delivered" | "queued" | "awaiting_address" | "in_transit" | "returned";
  message: string;
  place_name: string | null;
  // codex Phase 6 P2: column renamed from photo_uri → photo_path in
  // migration 1209. The old name is read with a fallback so a schema not
  // yet on 1209 still returns photo data; the new name is canonical.
  photo_path?: string | null;
  photo_uri?: string | null;
  custom_description: string | null;
  custom_tone: CustomTone | null;
  reference_photo_uris: string[];
  sent_at: string;
};

function postcardFromRow(row: PostcardRow): Postcard {
  // status type used by the rest of the app is narrower; coerce.
  const narrowStatus: "draft" | "sent" | "delivered" =
    row.status === "delivered" ? "delivered" : row.status === "draft" ? "draft" : "sent";
  // v0.7.0.7: build the claim URL from the embedded postcard_claims row,
  // if any. fetchPostcards LEFT JOINs postcard_claims so send-link cards
  // (to_kind === "claim") expose their share URL on the Postcard type.
  // Past cards in the gallery can then surface the URL for re-share.
  let claimUrl: string | undefined;
  const claimRow = (row as any).postcard_claims;
  const claimToken: string | undefined = Array.isArray(claimRow)
    ? claimRow[0]?.claim_token
    : claimRow?.claim_token;
  if (claimToken) {
    const supabaseUrl =
      (typeof process !== "undefined" && (process.env as any)?.EXPO_PUBLIC_SUPABASE_URL) ||
      "https://nlwnmgwylmmnaemdnzlq.supabase.co";
    const functionsBase = supabaseUrl.replace(".supabase.co", ".functions.supabase.co");
    claimUrl = `${functionsBase}/claim?t=${claimToken}`;
  }
  return {
    id: row.id,
    senderId: row.sender_id ?? undefined,
    toFriendId: row.to_kind === "void" ? "void" : (row.to_friend_id ?? ""),
    fromCity: row.from_city,
    toCity: row.to_city,
    category: row.category,
    creditCost: row.credit_cost,
    status: narrowStatus,
    message: row.message,
    sentAt: row.sent_at,
    placeName: row.place_name ?? undefined,
    // Prefer photo_path (the post-1209 column name), fall back to photo_uri
    // so unmigrated environments still surface the photo. codex Phase 6 P2.
    photoUri: row.photo_path ?? row.photo_uri ?? undefined,
    customDescription: row.custom_description ?? undefined,
    customTone: row.custom_tone ?? undefined,
    referencePhotoUris: row.reference_photo_uris,
    claimUrl,
    lobId: (row as any).lob_id ?? null,
  };
}

export async function fetchPostcards(): Promise<Postcard[]> {
  // v0.7.0.7: LEFT JOIN postcard_claims so each send-link card carries
  // its claim_token (→ shareable URL) into the client. Lets the gallery
  // surface "Share again" on past pending cards.
  const { data, error } = await supabase
    .from("postcards")
    .select("*, postcard_claims(claim_token)")
    .order("sent_at", { ascending: false });
  if (error) throw error;
  const cards = (data as PostcardRow[]).map(postcardFromRow);

  // v0.7.0.11 CRITICAL FIX: photoUri at this point is whatever was stored
  // in photo_path. That can be:
  //   1. null — no photo on the card
  //   2. full https:// URL — already renderable (e.g. lob-send-postcard
  //      writes the public postcard-renders URL after successful Lob
  //      submission)
  //   3. legacy file:// URI — leftover from a pre-v0.6.x code path
  //   4. Storage object path "<user>/<ts>-<name>.jpg" — uploaded to the
  //      PRIVATE postcard-photos bucket. NEEDS a signed URL to render.
  //
  // The journal tile renders blank for case (4) because `<Image source={{
  // uri: "<user>/<ts>-photo.jpg" }}>` can't load a relative path. The
  // audit on build 17 showed every welcome-flow send is hitting (4).
  // Resolve in parallel here so the gallery has working URLs.
  const SIGNED_URL_EXPIRY = 60 * 60 * 24; // 24h
  const needsSigning = (uri?: string) =>
    !!uri && !uri.startsWith("http") && !uri.startsWith("file://");
  await Promise.all(
    cards.map(async (card) => {
      if (!needsSigning(card.photoUri)) return;
      try {
        const { data: signed } = await supabase.storage
          .from("postcard-photos")
          .createSignedUrl(card.photoUri!, SIGNED_URL_EXPIRY);
        if (signed?.signedUrl) card.photoUri = signed.signedUrl;
      } catch {
        // Couldn't sign — leave the raw path so the Image at least
        // tries (will silently fail, but not crash).
      }
    }),
  );

  return cards;
}

export type SendPostcardInput =
  | { kind: "handwritten"; friendId: string; message: string }
  | { kind: "photo"; friendId: string; photoUri: string; message: string }
  | { kind: "place"; friendId: string; photoUri: string; placeName: string; message: string }
  | { kind: "custom"; friendId: string; description: string; tone?: CustomTone; referencePhotoUris: string[] };

export async function sendPostcard(input: SendPostcardInput): Promise<{ postcard: Postcard; creditsRemaining: number }> {
  const category = input.kind as CardCategory;
  const params: Record<string, unknown> = {
    p_to_kind: "friend",
    p_to_friend_id: input.friendId,
    p_category: category,
    p_message: input.kind === "custom" ? input.description : input.message,
    p_photo_uri: input.kind === "photo" || input.kind === "place" ? input.photoUri : null,
    p_place_name: input.kind === "place" ? input.placeName : null,
    p_custom_description: input.kind === "custom" ? input.description : null,
    p_custom_tone: input.kind === "custom" ? (input.tone ?? null) : null,
    p_reference_photo_uris: input.kind === "custom" ? input.referencePhotoUris : [],
  };
  const { data, error } = await supabase.rpc("send_postcard", params);
  if (error) throw error;
  const postcard = postcardFromRow(data as PostcardRow);
  const profile = await fetchProfile();
  return { postcard, creditsRemaining: profile?.credits ?? 0 };
}

/**
 * "Send a Link" flow — sender doesn't know the recipient's address. We
 * create a postcard in awaiting_address status with a magic-link claim;
 * sender shares the URL with the recipient who then fills in their address
 * via the claim Edge Function page.
 */
export type SendViaLinkInput = {
  category: CardCategory;
  message: string;
  photoUri?: string;
  placeName?: string;
};

export type SendViaLinkResult = {
  postcardId: string;
  claimToken: string;
  claimUrl: string;
  creditsRemaining: number;
};

export async function sendPostcardViaLink(input: SendViaLinkInput): Promise<SendViaLinkResult> {
  const { data, error } = await supabase.rpc("send_postcard_via_claim", {
    p_category: input.category,
    p_message: input.message,
    p_photo_path: input.photoUri ?? null,
    p_place_name: input.placeName ?? null,
  });
  if (error) throw error;
  const row = data as {
    postcard_id: string;
    claim_id: string;
    claim_token: string;
    credits_remaining: number;
  };
  const supabaseUrl = (typeof process !== "undefined" && (process.env as any)?.EXPO_PUBLIC_SUPABASE_URL)
    || "https://nlwnmgwylmmnaemdnzlq.supabase.co";
  // The Functions URL is the same project ref under .functions.supabase.co
  const functionsBase = supabaseUrl.replace(".supabase.co", ".functions.supabase.co");
  return {
    postcardId: row.postcard_id,
    claimToken: row.claim_token,
    claimUrl: `${functionsBase}/claim?t=${row.claim_token}`,
    creditsRemaining: row.credits_remaining,
  };
}

// ---------------------------------------------------------------------------
// Reciprocation tokens (Phase 3 — QR on the printed postcard back).
// Every direct-address postcard mints a reciprocation token at send time.
// The token's URL is rendered as a QR on the back so the receiver can scan
// and join Mailroom with the sender pre-loaded as a friend.
// ---------------------------------------------------------------------------

/**
 * Build the public reciprocation URL for a token. Used to render the QR on
 * the back of the postcard AND to construct fallback share links.
 *
 * Hosting strategy:
 *   • Default: the Supabase Edge Function URL (no custom domain needed).
 *     iOS Universal Links won't fire on functions.supabase.co — when the
 *     user owns mailroom.app, swap the host and host AASA at
 *     mailroom.app/.well-known/apple-app-site-association.
 *   • When EXPO_PUBLIC_RECIPROCATION_HOST is set (e.g. https://mailroom.app),
 *     prefix that instead. Universal Links work for any path under it that
 *     matches the AASA entries.
 */
export function reciprocationUrl(token: string): string {
  const host = (typeof process !== "undefined" &&
    (process.env as any)?.EXPO_PUBLIC_RECIPROCATION_HOST) as string | undefined;
  if (host && host.startsWith("http")) {
    return `${host.replace(/\/$/, "")}/r/${encodeURIComponent(token)}`;
  }
  const supabaseUrl = (typeof process !== "undefined" && (process.env as any)?.EXPO_PUBLIC_SUPABASE_URL)
    || "https://nlwnmgwylmmnaemdnzlq.supabase.co";
  const functionsBase = supabaseUrl.replace(".supabase.co", ".functions.supabase.co");
  return `${functionsBase}/welcome-mail?t=${encodeURIComponent(token)}`;
}

/**
 * Mint a reciprocation token for a postcard we just created. Called by the
 * send flow between sendPostcard (which writes the postcard row) and the
 * offscreen Lob render (which draws the QR). Idempotent — returns the
 * existing token if one was already minted for this postcard.
 */
export async function createReciprocationToken(postcardId: string): Promise<{
  token: string;
  reused: boolean;
  url: string;
}> {
  const { data, error } = await supabase.rpc("create_reciprocation_token", {
    p_postcard_id: postcardId,
  });
  if (error) throw error;
  const row = data as { token: string; reused: boolean; claim_id?: string };
  return {
    token: row.token,
    reused: row.reused ?? false,
    url: reciprocationUrl(row.token),
  };
}

export type ReciprocationLookup = {
  ok: true;
  flavor: "address_collection" | "reciprocation";
  sender_name: string;
  sender_city: string;
  message_preview: string;
  category: string;
  photo_path?: string;
  sent_at?: string;
  lob_status?: string;
  already_scanned: boolean;
} | {
  ok: false;
  reason: "NOT_FOUND" | "EXPIRED" | string;
};

/**
 * Public lookup: returns sender info + postcard preview for a scanned
 * token. Anyone can call this (anon key); the welcome-mail edge function
 * also uses it to render the HTML web fallback.
 */
export async function lookupReciprocation(token: string): Promise<ReciprocationLookup> {
  const { data, error } = await supabase.rpc("lookup_reciprocation", {
    p_token: token,
  });
  if (error) throw error;
  return data as ReciprocationLookup;
}

export type ReciprocationScanResult = {
  ok: true;
  already_scanned: boolean;
  friend_id: string;
  sender_id?: string;
  sender_name?: string;
  sender_city?: string;
  postcard?: {
    id: string;
    message: string;
    category: string;
    photo_path?: string;
    sent_at?: string;
  };
} | {
  ok: false;
  reason: "NOT_FOUND" | "EXPIRED" | "OWN_CARD" | "ALREADY_SCANNED_BY_OTHER" | string;
};

/**
 * Authenticated scan: marks the token consumed by the current user, inserts
 * the sender into the user's friends rolodex, and returns the seed payload
 * for the welcome hero screen. First scan wins per token.
 */
export async function recordReciprocationScan(
  token: string,
): Promise<ReciprocationScanResult> {
  const { data, error } = await supabase.rpc("record_reciprocation_scan", {
    p_token: token,
  });
  if (error) throw error;
  return data as ReciprocationScanResult;
}

// ---------------------------------------------------------------------------
// Receiver feed — Phase 3.5
// The postcards a user has received (via QR scan on a printed card). Drives
// the Map tab's "Received" filter, the Constellation tab's friend list, and
// any future "Inbox" surface.
// ---------------------------------------------------------------------------

export type ReceivedPostcard = {
  postcardId: string;
  claimId: string;
  senderId: string;
  senderName: string;
  senderCity: string;
  message: string;
  category: string;
  photoPath?: string;
  sentAt: string;
  scannedAt: string;
};

export async function fetchReceivedPostcards(): Promise<ReceivedPostcard[]> {
  const { data, error } = await supabase.rpc("fetch_received_postcards");
  if (error) throw error;
  type Row = {
    postcard_id: string;
    claim_id: string;
    sender_id: string;
    sender_name: string | null;
    sender_city: string | null;
    message: string;
    category: string;
    photo_path: string | null;
    sent_at: string;
    scanned_at: string | null;
  };
  return ((data as Row[]) ?? []).map((r) => ({
    postcardId: r.postcard_id,
    claimId: r.claim_id,
    senderId: r.sender_id,
    senderName: r.sender_name ?? "Mailroom friend",
    senderCity: r.sender_city ?? "",
    message: r.message,
    category: r.category,
    photoPath: r.photo_path ?? undefined,
    sentAt: r.sent_at,
    scannedAt: r.scanned_at ?? r.sent_at,
  }));
}

export async function sendIntoVoid(message: string): Promise<Postcard> {
  const { data, error } = await supabase.rpc("send_postcard", {
    p_to_kind: "void",
    p_to_friend_id: null,
    p_category: "handwritten",
    p_message: message,
    p_photo_uri: null,
    p_place_name: null,
    p_custom_description: null,
    p_custom_tone: null,
    p_reference_photo_uris: [],
  });
  if (error) throw error;
  return postcardFromRow(data as PostcardRow);
}

export async function purchaseCredits(packId: string) {
  const { data, error } = await supabase.rpc("purchase_credits", { p_pack_id: packId });
  if (error) throw error;
  return profileFromRow(data as ProfileRow);
}

// -----------------------------------------------------------------------------
// Void replies (read-only client side; server populates them when delivery
// pipeline ships)
// -----------------------------------------------------------------------------

type VoidReplyRow = {
  id: string;
  from_label: string;
  message: string;
  received_at: string;
};

export async function fetchVoidReplies(): Promise<VoidReply[]> {
  const { data, error } = await supabase
    .from("void_replies")
    .select("*")
    .order("received_at", { ascending: false });
  if (error) throw error;
  return (data as VoidReplyRow[]).map((r) => ({
    id: r.id,
    from: r.from_label,
    message: r.message,
    receivedAt: r.received_at,
  }));
}

// -----------------------------------------------------------------------------
// Storage — postcard photos
// -----------------------------------------------------------------------------

/**
 * Upload a local image file (from expo-image-picker) to the user's storage
 * folder and return a signed URL. The local URI looks like
 * `file:///var/.../photo.jpg`. We read it as a Blob and upload.
 */
export async function uploadPostcardPhoto(localUri: string, filename: string): Promise<string | null> {
  try {
    const userId = (await supabase.auth.getUser()).data.user?.id;
    if (!userId) return null;
    const response = await fetch(localUri);
    const blob = await response.blob();
    const path = `${userId}/${Date.now()}-${filename}`;
    const { error: uploadErr } = await supabase.storage.from("postcard-photos").upload(path, blob, {
      contentType: blob.type || "image/jpeg",
      upsert: false,
    });
    if (uploadErr) throw uploadErr;
    // Return the storage path. Caller signs URLs on demand via getSignedPhotoUrl().
    return path;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("uploadPostcardPhoto failed", err);
    return null;
  }
}

export async function getSignedPhotoUrl(path: string, expiresIn = 60 * 60): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("postcard-photos").createSignedUrl(path, expiresIn);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * v0.7.0.11: retry the Lob handoff for an "orphan" postcard — one where
 * the DB row exists with status='sent' but lob_id is null because the
 * original view-shot capture failed (the build 15-18 Modal-hosted bug).
 * Server validates ownership, then forwards to lob-send-postcard with
 * server-side HTML render mode. Works for both friend-mode and
 * claim-mode orphans.
 */
export async function retryOrphanShipping(postcardId: string): Promise<{ ok: boolean; error?: string; lobId?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke("retry-orphan", {
      body: { postcard_id: postcardId },
    });
    if (error) return { ok: false, error: error.message };
    if (!data || data.ok !== true) {
      return { ok: false, error: data?.error ?? "Retry failed" };
    }
    return { ok: true, lobId: data.lob_id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "Retry threw" };
  }
}

// -----------------------------------------------------------------------------
// Auth
// -----------------------------------------------------------------------------

export async function signUpWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signInWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: "mailroom://auth/reset",
  });
  if (error) throw error;
}

/**
 * Deletes the signed-in user's account. Apple Guideline 5.1.1(v) requires
 * any account-creation app to expose a delete-account flow inside the app.
 *
 * Server-side: a SECURITY DEFINER RPC `delete_my_account()` calls
 * auth.admin.delete_user(auth.uid()) which cascades through ON DELETE CASCADE
 * to wipe profile, friends, postcards, void_replies, credit_transactions.
 */
export async function deleteMyAccount() {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  // Local cleanup happens in the context after this resolves.
  await supabase.auth.signOut();
}

export function onAuthStateChange(cb: (userId: string | null) => void) {
  const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user?.id ?? null);
  });
  return () => sub.subscription.unsubscribe();
}

export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
