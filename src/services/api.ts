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
  to_kind: "friend" | "void";
  to_friend_id: string | null;
  from_city: string;
  to_city: string;
  category: CardCategory;
  credit_cost: number;
  status: "draft" | "sent" | "delivered";
  message: string;
  place_name: string | null;
  photo_uri: string | null;
  custom_description: string | null;
  custom_tone: CustomTone | null;
  reference_photo_uris: string[];
  sent_at: string;
};

function postcardFromRow(row: PostcardRow): Postcard {
  return {
    id: row.id,
    toFriendId: row.to_kind === "void" ? "void" : (row.to_friend_id ?? ""),
    fromCity: row.from_city,
    toCity: row.to_city,
    category: row.category,
    creditCost: row.credit_cost,
    status: row.status,
    message: row.message,
    sentAt: row.sent_at,
    placeName: row.place_name ?? undefined,
    photoUri: row.photo_uri ?? undefined,
    customDescription: row.custom_description ?? undefined,
    customTone: row.custom_tone ?? undefined,
    referencePhotoUris: row.reference_photo_uris,
  };
}

export async function fetchPostcards(): Promise<Postcard[]> {
  const { data, error } = await supabase
    .from("postcards")
    .select("*")
    .order("sent_at", { ascending: false });
  if (error) throw error;
  return (data as PostcardRow[]).map(postcardFromRow);
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
