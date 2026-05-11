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
  if (Object.keys(dbPatch).length === 0) return;
  const { error } = await supabase.from("profiles").update(dbPatch).eq("id", (await supabase.auth.getUser()).data.user?.id);
  if (error) throw error;
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

export async function addFriend(input: { name: string; city: string; state: string }): Promise<Friend> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) throw new Error("not authenticated");
  const name = input.name.trim();
  if (!name) throw new Error("name required");
  const initials = name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase();
  const { data, error } = await supabase
    .from("friends")
    .insert({
      owner_id: userId,
      name,
      city: input.city.trim(),
      state: input.state.trim(),
      avatar_initials: initials,
      connection_type: "postcard-invite",
      relationship_signal: "Just added",
      signal_tone: "blue",
    })
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
