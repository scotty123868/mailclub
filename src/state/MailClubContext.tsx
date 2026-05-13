import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { CARD_COSTS, CREDIT_PACKS, FREE_CREDITS } from "@/src/data/credits";
import { currentUser as defaultCurrentUser, friends as initialFriends, milestones, postcards as initialPostcards, routes } from "@/src/data/mock";
import * as api from "@/src/services/api";
import { signInWithApple as appleSignInService, type AppleAuthResult } from "@/src/services/apple-auth";
import { mailboxThunk } from "@/src/services/mailboxThunk";
import { clearPendingInvite, consumePendingInvite } from "@/src/state/pendingInvite";
import { SUPABASE_CONFIGURED, supabase } from "@/src/services/supabase";
import type { CardCategory, CurrentUser, CustomTone, Friend, Postcard } from "@/src/types/mail";

const STORE_KEY = "mailroom-v1-cache";

// Optional `friend` is the canonical reference when the caller created the
// friend in the same event-loop tick (e.g. address-mode send creates the
// friend via addFriendByAddress and then sends immediately). Avoids stale-
// closure lookups on the friends array. (codex Phase 6 P1.)
export type SendInput =
  | { kind: "handwritten"; friendId: string; message: string; friend?: Friend }
  | { kind: "photo"; friendId: string; photoUri: string; message: string; friend?: Friend }
  | { kind: "place"; friendId: string; photoUri: string; placeName: string; message: string; friend?: Friend }
  | { kind: "custom"; friendId: string; description: string; tone?: CustomTone; referencePhotoUris: string[]; friend?: Friend };

export type VoidReply = {
  id: string;
  from: string;
  message: string;
  receivedAt: string;
};

export type CreditsPurchaseResult = { ok: boolean; creditsAdded?: number };
export type SendResult = { ok: boolean; friendName: string; creditsRemaining?: number; postcardId?: string };
export type SendViaLinkResult = {
  ok: boolean;
  claimUrl?: string;
  postcardId?: string;
  error?: string;
};
export type AddFriendResult = { ok: boolean; friend?: Friend };

export type NotificationPrefs = {
  cardDelivered: boolean;
  replyReceived: boolean;
  birthdays: boolean;
};

export type PrivacyPrefs = {
  whoCanSendToMe: "anyone" | "friends" | "no-one";
};

export const DEFAULT_NOTIFICATIONS: NotificationPrefs = {
  cardDelivered: true,
  replyReceived: true,
  birthdays: true,
};

export const DEFAULT_PRIVACY: PrivacyPrefs = {
  whoCanSendToMe: "anyone",
};

const DEFAULT_USER: CurrentUser = defaultCurrentUser;
const EMPTY_USER: CurrentUser = {
  name: "",
  city: "",
  state: "",
  since: String(new Date().getFullYear()),
  avatarInitials: "",
  tagline: "",
  interests: "",
  sendMe: "",
  birthday: "",
  currentlyInto: "",
};

type MailClubState = {
  currentUser: CurrentUser;
  friends: Friend[];
  postcards: Postcard[];
  routes: typeof routes;
  milestones: typeof milestones;
  credits: number;
  freeCreditsRemaining: number;
  hasSeenFreeCreditsIntro: boolean;
  hasCompletedSignup: boolean;
  /**
   * v0.7: forced signup→send flow requires the user to mail a card to enter
   * the app. This flag is set true the first time `sendPostcardAction`
   * resolves successfully. WelcomeGate gates on
   * (hasSeenFreeCreditsIntro && hasCompletedSignup && hasSentFirstCard) so
   * a user who closes the app mid-signup-send returns to the same step,
   * not the empty app shell.
   *
   * Backward-compat: existing v0.6.x users get this set to true on first
   * launch of v0.7 (they're past onboarding; we infer it from
   * `postcards.length > 0 || hasCompletedSignup`).
   */
  hasSentFirstCard: boolean;
  hydrated: boolean;
  authedUserId: string | null;
  voidReplies: VoidReply[];
  notifications: NotificationPrefs;
  privacy: PrivacyPrefs;
  sendPostcard: (input: SendInput) => Promise<SendResult>;
  sendPostcardViaLink: (input: {
    category: CardCategory;
    message: string;
    photoUri?: string;
    placeName?: string;
  }) => Promise<SendViaLinkResult>;
  sendIntoVoid: (message: string) => Promise<{ ok: boolean }>;
  purchaseCredits: (packId: string) => Promise<CreditsPurchaseResult>;
  refreshProfile: () => Promise<void>;
  markFreeCreditsIntroSeen: () => Promise<void>;
  updateAboutMe: (patch: Partial<CurrentUser>) => Promise<void>;
  removeFriend: (id: string) => Promise<void>;
  addFriendByAddress: (input: {
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
  }) => Promise<AddFriendResult>;
  queueInvitation: (name: string, street: string, cityLine: string) => Promise<boolean>;
  addMayaConnection: () => Promise<void>;
  updateNotifications: (patch: Partial<NotificationPrefs>) => Promise<void>;
  updatePrivacy: (patch: Partial<PrivacyPrefs>) => Promise<void>;
  signOut: () => Promise<void>;
  completeSignup: (input: { name: string; city: string; state: string; birthday?: string; email?: string; password?: string }) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signInWithApple: () => Promise<AppleAuthResult>;
  resetPassword: (email: string) => Promise<{ ok: boolean; error?: string }>;
  deleteAccount: () => Promise<{ ok: boolean; error?: string }>;
};

const MailClubContext = createContext<MailClubState | null>(null);

function costForCategory(category: CardCategory): number {
  return CARD_COSTS[category];
}

type CacheShape = {
  currentUser: CurrentUser;
  friends: Friend[];
  postcards: Postcard[];
  voidReplies: VoidReply[];
  credits: number;
  freeCreditsRemaining: number;
  hasSeenFreeCreditsIntro: boolean;
  hasCompletedSignup: boolean;
  hasSentFirstCard: boolean;
  notifications: NotificationPrefs;
  privacy: PrivacyPrefs;
};

export function MailClubProvider({ children }: PropsWithChildren) {
  // Initial state uses mock fixtures so tests + dev see populated data on
  // first render. In production, WelcomeSheet → completeSignup clears them
  // when a new user signs up, and the AsyncStorage hydrate / Supabase fetch
  // effects overwrite them for returning users.
  const [friends, setFriends] = useState<Friend[]>(initialFriends);
  const [postcards, setPostcards] = useState<Postcard[]>(initialPostcards);
  const [voidReplies, setVoidReplies] = useState<VoidReply[]>([]);
  const [credits, setCredits] = useState(FREE_CREDITS);
  const [freeCreditsRemaining, setFreeCreditsRemaining] = useState(FREE_CREDITS);
  const [hasSeenFreeCreditsIntro, setHasSeenFreeCreditsIntro] = useState(false);
  const [hasCompletedSignup, setHasCompletedSignup] = useState(false);
  const [hasSentFirstCard, setHasSentFirstCard] = useState(false);
  const [userInfo, setUserInfo] = useState<CurrentUser>(defaultCurrentUser);
  const [notifications, setNotifications] = useState<NotificationPrefs>(DEFAULT_NOTIFICATIONS);
  const [privacy, setPrivacy] = useState<PrivacyPrefs>(DEFAULT_PRIVACY);
  const [hydrated, setHydrated] = useState(false);
  const [authedUserId, setAuthedUserId] = useState<string | null>(null);
  // Suppress write-through to cache while initial hydration runs
  const initialLoadDone = useRef(false);

  // ---- 1. Hydrate from AsyncStorage cache for instant cold-start UI -----
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then((raw) => {
      if (!raw) {
        setHydrated(true);
        initialLoadDone.current = true;
        return;
      }
      try {
        const stored = JSON.parse(raw) as Partial<CacheShape>;
        if (Array.isArray(stored.friends)) setFriends(stored.friends);
        if (Array.isArray(stored.postcards)) setPostcards(stored.postcards);
        if (Array.isArray(stored.voidReplies)) setVoidReplies(stored.voidReplies);
        if (typeof stored.credits === "number") setCredits(stored.credits);
        if (typeof stored.freeCreditsRemaining === "number") setFreeCreditsRemaining(stored.freeCreditsRemaining);
        if (typeof stored.hasSeenFreeCreditsIntro === "boolean") setHasSeenFreeCreditsIntro(stored.hasSeenFreeCreditsIntro);
        if (typeof stored.hasCompletedSignup === "boolean") setHasCompletedSignup(stored.hasCompletedSignup);
        // v0.7 backward-compat: existing v0.6.x users won't have the
        // hasSentFirstCard field in their stored state. Infer it from the
        // postcard history — if they've sent anything, they've already done
        // the "first send" by definition.
        if (typeof stored.hasSentFirstCard === "boolean") {
          setHasSentFirstCard(stored.hasSentFirstCard);
        } else if (Array.isArray(stored.postcards) && stored.postcards.length > 0) {
          setHasSentFirstCard(true);
        } else if (stored.hasCompletedSignup === true) {
          // Edge case: user completed v0.6 signup but hasn't sent yet. We
          // can't force them through the v0.7 send flow on update without
          // surprise. Grandfather them in.
          setHasSentFirstCard(true);
        }
        if (stored.currentUser && typeof stored.currentUser === "object") setUserInfo({ ...DEFAULT_USER, ...stored.currentUser });
        if (stored.notifications) setNotifications({ ...DEFAULT_NOTIFICATIONS, ...stored.notifications });
        if (stored.privacy) setPrivacy({ ...DEFAULT_PRIVACY, ...stored.privacy });
      } catch {
        // bad cache → use defaults
      } finally {
        setHydrated(true);
        initialLoadDone.current = true;
      }
    }).catch(() => {
      setHydrated(true);
      initialLoadDone.current = true;
    });
  }, []);

  // ---- 2. Write through to cache on every state change -----
  useEffect(() => {
    if (!initialLoadDone.current) return;
    const cache: CacheShape = {
      currentUser: userInfo,
      friends,
      postcards,
      voidReplies,
      credits,
      freeCreditsRemaining,
      hasSeenFreeCreditsIntro,
      hasCompletedSignup,
      hasSentFirstCard,
      notifications,
      privacy,
    };
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(cache)).catch(() => undefined);
  }, [userInfo, friends, postcards, voidReplies, credits, freeCreditsRemaining, hasSeenFreeCreditsIntro, hasCompletedSignup, hasSentFirstCard, notifications, privacy]);

  // ---- 3. Auth session subscription (Supabase only) -----
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    let cancelled = false;
    api.getCurrentUserId().then((id) => {
      if (!cancelled) setAuthedUserId(id);
    }).catch(() => undefined);
    const unsub = api.onAuthStateChange((id) => {
      if (cancelled) return;
      setAuthedUserId(id);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // ---- 4. On signed-in, fetch fresh data from Supabase -----
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    if (!authedUserId) return;
    let cancelled = false;
    (async () => {
      try {
        const [profile, fetchedFriends, fetchedPostcards, fetchedReplies] = await Promise.all([
          api.fetchProfile(),
          api.fetchFriends(),
          api.fetchPostcards(),
          api.fetchVoidReplies(),
        ]);
        if (cancelled) return;
        if (profile) {
          setUserInfo(profile.currentUser);
          setCredits(profile.credits);
          setFreeCreditsRemaining(profile.freeCreditsRemaining);
          setHasSeenFreeCreditsIntro(profile.hasSeenFreeCreditsIntro);
          setHasCompletedSignup(profile.hasCompletedSignup);
          setNotifications(profile.notifications);
          setPrivacy(profile.privacy);
        }
        setFriends(fetchedFriends);
        setPostcards(fetchedPostcards);
        setVoidReplies(fetchedReplies);
        // v0.7: server is the truth for postcard history. If they have any
        // postcard rows server-side, they&apos;ve done the first send.
        if (fetchedPostcards.length > 0 || fetchedReplies.length > 0) {
          setHasSentFirstCard(true);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Initial Supabase fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authedUserId]);

  // ---- 4b. Supabase Realtime: live postcard updates -------------------
  // v0.7.0.5: subscribe to the `postcards` table so the Lob webhook
  // updates flow into the app live. When a card&apos;s status flips
  // (in_transit / delivered / returned), the Map pins + journal
  // re-render without the user needing to swipe to refresh.
  //
  // Scoped via RLS: the subscription only fires for rows the user can
  // see (their own sent + the inbound rows enabled by migration 1210).
  //
  // Channel lifecycle: opens on sign-in, tears down on sign-out or
  // unmount. Errors are caught silently; the worst case is "Map
  // updates lag until tab focus" which is the v0.6.x behavior anyway.
  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return;
    if (!authedUserId) return;

    const channel = supabase
      .channel(`postcards:${authedUserId}`)
      .on(
        "postgres_changes" as any,
        { event: "*", schema: "public", table: "postcards" },
        async () => {
          // Re-fetch on any change. Cheaper than reconciling row-by-row,
          // and the postcards list is small (<100 rows for most users).
          try {
            const fresh = await api.fetchPostcards();
            setPostcards(fresh);
          } catch {
            // ignore — next fetch on tab focus picks it up
          }
        },
      )
      .subscribe();

    return () => {
      try {
        channel.unsubscribe();
      } catch {
        // ignore
      }
    };
  }, [authedUserId]);

  // ---- Actions ----------------------------------------------------------

  const sendPostcardAction = useCallback(async (input: SendInput): Promise<SendResult> => {
    const category: CardCategory = input.kind;
    const cost = costForCategory(category);
    // codex Phase 6 P1: address-mode sends create a friend via addFriendByAddress
    // and then immediately call sendPostcard with the new friend's id. The
    // friends array closure in this callback may not include the freshly-
    // created friend yet (state updates async). Fallback to friends[0] in
    // that case crashes when the user has zero friends, and returns the
    // wrong friend otherwise. Accept the friend object on the input as the
    // authoritative reference. Lookup falls back to the array, then to the
    // input.friend if provided, in that order.
    const friend =
      friends.find((f) => f.id === input.friendId) ??
      (input as { friend?: Friend }).friend ??
      friends[0];

    if (credits < cost) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Not enough credits", `This card costs ${cost} credit${cost === 1 ? "" : "s"}. Buy more to send it.`);
      return { ok: false, friendName: friend?.name ?? "" };
    }

    if (!SUPABASE_CONFIGURED || !authedUserId) {
      // Local-only fallback (used by tests + offline / unauthenticated)
      return sendPostcardLocal(input, cost, friend);
    }

    // Optimistic local update. We capture EVERY mutated piece of state so
    // the catch handler can fully restore on failure. The previous version
    // forgot `freeCreditsRemaining`, which silently burned a free credit
    // every time Lob upload or the RPC failed mid-send. Fixed now: any
    // throw below the deduct rolls all four pieces back to pre-send state.
    const prevCredits = credits;
    const prevFreeCreditsRemaining = freeCreditsRemaining;
    const prevPostcards = postcards;
    const prevFriends = friends;
    setCredits((c) => c - cost);
    setFreeCreditsRemaining((b) => Math.max(0, b - cost));

    try {
      // Upload photo first if present
      let photoUri: string | undefined;
      let refUris: string[] = [];
      if (input.kind === "photo" || input.kind === "place") {
        const path = await api.uploadPostcardPhoto(input.photoUri, `${input.kind}.jpg`);
        photoUri = path ?? undefined;
      } else if (input.kind === "custom" && input.referencePhotoUris.length > 0) {
        const paths: string[] = [];
        for (const uri of input.referencePhotoUris) {
          const p = await api.uploadPostcardPhoto(uri, `ref-${paths.length}.jpg`);
          if (p) paths.push(p);
        }
        refUris = paths;
      }
      const rpcInput: any = (() => {
        if (input.kind === "photo") return { kind: "photo", friendId: input.friendId, photoUri: photoUri ?? "", message: input.message };
        if (input.kind === "place") return { kind: "place", friendId: input.friendId, photoUri: photoUri ?? "", placeName: input.placeName, message: input.message };
        if (input.kind === "custom") return { kind: "custom", friendId: input.friendId, description: input.description, tone: input.tone, referencePhotoUris: refUris };
        return { kind: "handwritten", friendId: input.friendId, message: input.message };
      })();
      const { postcard, creditsRemaining } = await api.sendPostcard(rpcInput);
      setPostcards((cards) => [postcard, ...cards]);
      setFriends((items) => items.map((f) => (
        f.id === friend.id ? { ...f, cardsSent: f.cardsSent + 1, lastInteractionAt: new Date().toISOString() } : f
      )));
      setCredits(creditsRemaining);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { ok: true, friendName: friend.name, creditsRemaining, postcardId: postcard.id };
    } catch (err: any) {
      // Revert ALL optimistic mutations. Critical: freeCreditsRemaining
      // gets restored here too — without it, a Lob/RPC failure permanently
      // burns the user's free credit even though no postcard was sent.
      setCredits(prevCredits);
      setFreeCreditsRemaining(prevFreeCreditsRemaining);
      setPostcards(prevPostcards);
      setFriends(prevFriends);
      Alert.alert("Couldn't send", err?.message ?? "Try again in a moment.");
      return { ok: false, friendName: friend.name };
    }
  }, [authedUserId, credits, freeCreditsRemaining, friends, postcards]);

  function sendPostcardLocal(input: SendInput, cost: number, friend: Friend | undefined): SendResult {
    const category: CardCategory = input.kind;
    setCredits((c) => c - cost);
    setFreeCreditsRemaining((b) => Math.max(0, b - cost));
    const message = input.kind === "custom" ? input.description : input.message;
    const photoUri = input.kind === "photo" || input.kind === "place" ? input.photoUri : undefined;
    const next: Postcard = {
      id: `p-${Date.now()}`,
      toFriendId: friend?.id ?? "",
      // Empty string when the user hasn't filled in their city. The old
      // "Somewhere" fallback was printing literally on postcards as a
      // fake placeholder city, which looked broken. Empty is cleaner —
      // the back-of-card renderer hides the sender-city line entirely
      // when this is empty.
      fromCity: userInfo.city || "",
      toCity: friend?.city ?? "",
      category,
      creditCost: cost,
      status: category === "custom" ? "draft" : "sent",
      message,
      sentAt: new Date().toISOString(),
      photoUri,
      placeName: input.kind === "place" ? input.placeName : undefined,
      customDescription: input.kind === "custom" ? input.description : undefined,
      customTone: input.kind === "custom" ? input.tone : undefined,
      referencePhotoUris: input.kind === "custom" ? input.referencePhotoUris : undefined,
    };
    setPostcards((items) => [next, ...items]);
    if (friend) {
      setFriends((items) => items.map((f) => (
        f.id === friend.id ? { ...f, cardsSent: f.cardsSent + 1, lastInteractionAt: new Date().toISOString() } : f
      )));
    }
    // v0.7: any successful send unlocks the rest of the app. WelcomeGate
    // gates on this flag. Idempotent — re-flipping a true flag is a no-op.
    if (!hasSentFirstCard) setHasSentFirstCard(true);
    // v0.7.1 D.5: layered thud-then-tap haptic for the mailbox-thunk
    // moment. mailboxThunk is fire-and-forget; never await it.
    mailboxThunk();
    return { ok: true, friendName: friend?.name ?? "", creditsRemaining: credits - cost };
  }

  const sendPostcardViaLinkAction = useCallback(async (input: {
    category: CardCategory;
    message: string;
    photoUri?: string;
    placeName?: string;
  }): Promise<SendViaLinkResult> => {
    const cost = costForCategory(input.category);
    if (credits < cost) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Not enough credits", `This card costs ${cost} credit${cost === 1 ? "" : "s"}. Buy more to send it.`);
      return { ok: false, error: "INSUFFICIENT_CREDITS" };
    }

    if (!SUPABASE_CONFIGURED || !authedUserId) {
      Alert.alert("Sign in first", "You need an account to send a link postcard so we can deliver it.");
      return { ok: false, error: "NOT_SIGNED_IN" };
    }

    try {
      let photoPath: string | undefined;
      if ((input.category === "photo" || input.category === "place") && input.photoUri) {
        const path = await api.uploadPostcardPhoto(input.photoUri, `${input.category}.jpg`);
        photoPath = path ?? undefined;
      }
      const result = await api.sendPostcardViaLink({
        category: input.category,
        message: input.message,
        photoUri: photoPath,
        placeName: input.placeName,
      });
      // Refresh credits + postcards from server so UI reflects the new state
      setCredits(result.creditsRemaining);
      try {
        const fresh = await api.fetchPostcards();
        setPostcards(fresh);
      } catch { /* non-fatal */ }
      // v0.7: send-via-link COUNTS as the first send. The card queues
      // immediately and the user is unlocked into the app, even if the
      // recipient never fills in their address. Matches user spec:
      // "if they send someone a link to get their address that is a
      // sent card, regardless of if the person fills in the address."
      if (!hasSentFirstCard) setHasSentFirstCard(true);
      mailboxThunk();
      return { ok: true, claimUrl: result.claimUrl, postcardId: result.postcardId };
    } catch (err: any) {
      Alert.alert("Couldn't create the link", err?.message ?? "Try again in a moment.");
      return { ok: false, error: err?.message ?? "Unknown error" };
    }
  }, [authedUserId, credits, hasSentFirstCard]);

  const sendIntoVoidAction = useCallback(async (message: string) => {
    if (credits < 1) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Not enough credits", "Sending into the void costs 1 credit.");
      return { ok: false };
    }
    if (!SUPABASE_CONFIGURED || !authedUserId) {
      // Local-only fallback
      setCredits((b) => b - 1);
      setFreeCreditsRemaining((b) => Math.max(0, b - 1));
      const next: Postcard = {
        id: `void-${Date.now()}`,
        toFriendId: "void",
        // Empty when user hasn't set a city. Don't fall back to a fake
        // placeholder — see the same rationale at the local-path version.
        fromCity: userInfo.city || "",
        toCity: "Anywhere",
        category: "handwritten",
        creditCost: 1,
        status: "sent",
        message,
        sentAt: new Date().toISOString(),
      };
      setPostcards((items) => [next, ...items]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { ok: true };
    }
    const prevCredits = credits;
    const prevFreeCreditsRemaining = freeCreditsRemaining;
    const prevPostcards = postcards;
    setCredits((c) => c - 1);
    setFreeCreditsRemaining((b) => Math.max(0, b - 1));
    try {
      const postcard = await api.sendIntoVoid(message);
      setPostcards((items) => [postcard, ...items]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { ok: true };
    } catch (err: any) {
      // Restore both credit counters — the previous version reverted
      // setCredits but left freeCreditsRemaining drained.
      setCredits(prevCredits);
      setFreeCreditsRemaining(prevFreeCreditsRemaining);
      setPostcards(prevPostcards);
      Alert.alert("Couldn't send", err?.message ?? "Try again.");
      return { ok: false };
    }
  }, [authedUserId, credits, freeCreditsRemaining, postcards, userInfo.city]);

  const purchaseCreditsAction = useCallback(async (packId: string): Promise<CreditsPurchaseResult> => {
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) return { ok: false };
    if (!SUPABASE_CONFIGURED || !authedUserId) {
      setCredits((c) => c + pack.credits);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { ok: true, creditsAdded: pack.credits };
    }
    try {
      const profile = await api.purchaseCredits(packId);
      setCredits(profile.credits);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { ok: true, creditsAdded: pack.credits };
    } catch (err: any) {
      Alert.alert("Purchase failed", err?.message ?? "Try again.");
      return { ok: false };
    }
  }, [authedUserId]);

  const refreshProfileAction = useCallback(async () => {
    if (!SUPABASE_CONFIGURED || !authedUserId) return;
    try {
      const profile = await api.fetchProfile();
      if (profile) {
        setCredits(profile.credits);
        setFreeCreditsRemaining(profile.freeCreditsRemaining);
        setUserInfo(profile.currentUser);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("refreshProfile failed", err);
    }
  }, [authedUserId]);

  const markFreeCreditsIntroSeenAction = useCallback(async () => {
    setHasSeenFreeCreditsIntro(true);
    if (SUPABASE_CONFIGURED && authedUserId) {
      api.markFreeCreditsIntroSeen().catch(() => undefined);
    }
  }, [authedUserId]);

  const updateAboutMeAction = useCallback(async (patch: Partial<CurrentUser>) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Local update happens immediately so the UI feels instant.
    setUserInfo((u) => ({ ...u, ...patch }));
    if (!SUPABASE_CONFIGURED || !authedUserId) return;
    // If the photo is a local file:// URI, upload it to Storage first and
    // swap the local URI for the remote one before syncing to the profile.
    let resolvedPatch = patch;
    if (typeof patch.photoUrl === "string" && patch.photoUrl.startsWith("file://")) {
      try {
        const remoteUrl = await api.uploadProfilePhoto(patch.photoUrl);
        resolvedPatch = { ...patch, photoUrl: remoteUrl };
        setUserInfo((u) => ({ ...u, photoUrl: remoteUrl }));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("uploadProfilePhoto failed", err);
        // Keep the local URI in client state so the user still sees their pick;
        // we just won't sync this field server-side this round.
        resolvedPatch = { ...patch, photoUrl: undefined };
      }
    }
    api.updateProfile(resolvedPatch).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("updateProfile sync failed", err);
    });
  }, [authedUserId]);

  const removeFriendAction = useCallback(async (id: string) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const prev = friends;
    setFriends((items) => items.filter((item) => item.id !== id));
    if (SUPABASE_CONFIGURED && authedUserId) {
      try {
        await api.removeFriend(id);
      } catch (err: any) {
        setFriends(prev);
        Alert.alert("Couldn't remove", err?.message ?? "Try again.");
      }
    }
  }, [authedUserId, friends]);

  const addFriendByAddressAction = useCallback(async (input: {
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
  }): Promise<AddFriendResult> => {
    const name = input.name.trim();
    const city = input.city.trim();
    const state = input.state.trim();
    if (!name || !city) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return { ok: false };
    }
    const birthday = input.birthday?.trim() || undefined;
    const addressFields = {
      addressLine1: input.addressLine1?.trim() || undefined,
      addressLine2: input.addressLine2?.trim() || undefined,
      addressCity: input.addressCity?.trim() || undefined,
      addressState: input.addressState?.trim() || undefined,
      addressZip: input.addressZip?.trim() || undefined,
      addressCountry: input.addressCountry?.trim() || undefined,
    };
    if (!SUPABASE_CONFIGURED || !authedUserId) {
      const id = `friend-${Date.now()}`;
      const friend: Friend = {
        id,
        name,
        city,
        state,
        avatarInitials: name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase(),
        cardsSent: 0,
        cardsReceived: 0,
        connectionType: "postcard-invite",
        lastInteractionAt: new Date().toISOString(),
        relationshipSignal: "Just added",
        signalTone: "blue",
        birthday,
        ...addressFields,
      };
      setFriends((items) => [friend, ...items]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { ok: true, friend };
    }
    try {
      // Pass birthday through to the API. addFriend() only writes the column
      // when birthday is non-empty, so a 0.4.x schema (no birthday column)
      // still succeeds. A 0.5.1 migration adds the column, after which the
      // value persists round-trip.
      const friend = await api.addFriend({ name, city, state, birthday, ...addressFields });
      // Belt-and-suspenders: if the server happens to be on the old schema
      // and dropped birthday silently, merge it onto the local copy so the
      // rolodex shows it this session.
      const friendWithBirthday: Friend = birthday && !friend.birthday
        ? { ...friend, birthday }
        : friend;
      setFriends((items) => [friendWithBirthday, ...items]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { ok: true, friend: friendWithBirthday };
    } catch (err: any) {
      Alert.alert("Couldn't add friend", err?.message ?? "Try again.");
      return { ok: false };
    }
  }, [authedUserId]);

  const queueInvitationAction = useCallback(async (name: string, street: string, cityLine: string) => {
    if (!name.trim() || !street.trim() || !cityLine.trim()) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return false;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return true;
  }, []);

  const addMayaConnectionAction = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFriends((items) => items.map((item) => (
      item.id === "maya" ? { ...item, cardsSent: Math.max(item.cardsSent, 0), lastInteractionAt: new Date().toISOString() } : item
    )));
  }, []);

  const updateNotificationsAction = useCallback(async (patch: Partial<NotificationPrefs>) => {
    await Haptics.selectionAsync();
    setNotifications((n) => {
      const next = { ...n, ...patch };
      if (SUPABASE_CONFIGURED && authedUserId) {
        api.updateNotificationPrefs(next).catch(() => undefined);
      }
      return next;
    });
  }, [authedUserId]);

  const updatePrivacyAction = useCallback(async (patch: Partial<PrivacyPrefs>) => {
    await Haptics.selectionAsync();
    setPrivacy((p) => {
      const next = { ...p, ...patch };
      if (SUPABASE_CONFIGURED && authedUserId) {
        api.updatePrivacyPrefs(next).catch(() => undefined);
      }
      return next;
    });
  }, [authedUserId]);

  function resetLocalState() {
    setFriends([]);
    setPostcards([]);
    setVoidReplies([]);
    setCredits(FREE_CREDITS);
    setFreeCreditsRemaining(FREE_CREDITS);
    setHasSeenFreeCreditsIntro(false);
    setHasCompletedSignup(false);
    setHasSentFirstCard(false);
    setUserInfo(EMPTY_USER);
    setNotifications(DEFAULT_NOTIFICATIONS);
    setPrivacy(DEFAULT_PRIVACY);
  }

  const signOutAction = useCallback(async () => {
    // v0.6.1 codex Phase 6.5 P0: previously this awaited Haptics first and
    // threw on iOS simulators / devices where the haptic engine is
    // unavailable. The throw bubbled up to SettingsSheet's Alert callback
    // and silently aborted everything after it — the local state never
    // cleared and the user saw nothing happen. "Sign out failed" from the
    // user's POV. Defensive: each step is independently caught so one
    // failure doesn't cascade. Local state reset is the contract that
    // matters; everything else is best-effort cleanup.
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // simulators / devices without a haptic engine
    }
    resetLocalState();
    try {
      await AsyncStorage.removeItem(STORE_KEY);
    } catch {
      // storage failure — local state is in-memory reset already
    }
    // Phase 3.5: clear any pending invite so it doesn't carry across user
    // identities. If a different user signs in next, they shouldn't
    // inherit the previous user's pre-signup QR scan.
    try {
      await clearPendingInvite();
    } catch {
      // ignore
    }
    if (SUPABASE_CONFIGURED) {
      try {
        await api.signOut();
      } catch {
        // ignore — local state is already cleared
      }
    }
  }, []);

  const completeSignupAction = useCallback(async (input: { name: string; city: string; state: string; birthday?: string; email?: string; password?: string }) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const trimmedName = input.name.trim() || "Mailroom member";
    // Empty when not provided — don't fake "Somewhere" into the user profile.
    const trimmedCity = input.city.trim();
    const trimmedState = input.state.trim();
    const trimmedBirthday = (input.birthday ?? "").trim();
    const initials = trimmedName.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase() || trimmedName.slice(0, 2).toUpperCase();

    // codex Phase 6 P1: previously this set hasCompletedSignup = true
    // BEFORE the backend operations and never rolled back on failure. A
    // user could land on a screen where the app thinks they're done but
    // no profile row exists server-side. Now: set local user info early
    // (so the UI doesn't flash an empty state) but DEFER the completion
    // flags until the server-side flow succeeds.
    setUserInfo({
      ...EMPTY_USER,
      name: trimmedName,
      city: trimmedCity,
      state: trimmedState,
      birthday: trimmedBirthday,
      since: String(new Date().getFullYear()),
      avatarInitials: initials,
    });
    setFriends([]);
    setPostcards([]);
    setVoidReplies([]);

    if (!SUPABASE_CONFIGURED) {
      // Dev/test path with no backend — set flags locally and move on.
      setHasSeenFreeCreditsIntro(true);
      setHasCompletedSignup(true);
      return;
    }

    // If an email + password were provided AND we're not authed, sign up first
    if (input.email && input.password && !authedUserId) {
      try {
        await api.signUpWithEmail(input.email, input.password);
      } catch (err: any) {
        // Maybe the account already exists — try signing in
        try {
          await api.signInWithEmail(input.email, input.password);
        } catch (signinErr: any) {
          // eslint-disable-next-line no-console
          console.warn("Auth failed during completeSignup", signinErr?.message ?? err?.message);
          // codex Phase 6 P1: throw instead of silently returning with
          // signup flags already flipped. The WelcomeSheet catches and
          // shows an error; the user stays on the signup screen and can
          // retry instead of getting stuck in a "completed" state with no
          // backend profile.
          throw new Error(signinErr?.message ?? err?.message ?? "Sign in failed");
        }
      }
    }

    // After auth (or if already authed), call the server RPC
    try {
      const profile = await api.completeSignup({ name: trimmedName, city: trimmedCity, state: trimmedState });
      // The complete_signup RPC doesn't take birthday — patch it on after.
      // The column already exists in profiles; updateProfile handles it.
      if (trimmedBirthday) {
        try {
          await api.updateProfile({ birthday: trimmedBirthday });
        } catch (err: any) {
          // eslint-disable-next-line no-console
          console.warn("Failed to save birthday on signup:", err?.message);
        }
      }
      setUserInfo({ ...profile.currentUser, birthday: trimmedBirthday || profile.currentUser.birthday });
      setCredits(profile.credits);
      setFreeCreditsRemaining(profile.freeCreditsRemaining);
      setHasSeenFreeCreditsIntro(profile.hasSeenFreeCreditsIntro);
      setHasCompletedSignup(profile.hasCompletedSignup);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn("complete_signup RPC failed", err?.message);
      // codex Phase 6 P1: re-throw so the WelcomeSheet shows the error
      // and the user can retry. Previously this swallowed the failure,
      // leaving hasCompletedSignup at whatever it was before (often false)
      // but the UI was already past the signup screen. Throwing keeps the
      // signup loop honest.
      throw new Error(err?.message ?? "Couldn't save your profile. Try again?");
    }

    // Phase 3.5: consume any pending invite from a pre-signup QR scan.
    await attemptConsumePendingInvite();
  }, [authedUserId]);

  /**
   * Phase 3.5 helper — drain the pendingInvite stash. If a token is
   * present, fire `record_reciprocation_scan` so the sender shows up in
   * the user's rolodex and the postcard lands in their Received map.
   * Idempotent: pendingInvite.consume() removes-then-returns so a second
   * call returns null; the server-side RPC is also first-scan-wins, so
   * even double-fires are safe. Called from completeSignup AND every
   * sign-in path so brand-new and returning users both get the seed.
   */
  async function attemptConsumePendingInvite(): Promise<void> {
    try {
      const pendingToken = await consumePendingInvite();
      if (!pendingToken) return;
      const scan = await api.recordReciprocationScan(pendingToken);
      if (scan.ok && !scan.already_scanned) {
        // Refresh friends list so the new sender appears in the rolodex
        // immediately without waiting for the next pull.
        try {
          const friendsList = await api.fetchFriends();
          setFriends(friendsList);
        } catch {
          // best-effort refresh, ignore
        }
      }
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn("consumePendingInvite failed:", err?.message);
    }
  }

  const signInWithEmailAction = useCallback(async (email: string, password: string) => {
    if (!SUPABASE_CONFIGURED) return { ok: false, error: "Backend not configured" };
    try {
      await api.signInWithEmail(email, password);
      // Phase 3.5: consume any pending QR-scan token now that we're authed.
      // Idempotent — consume returns null if there's nothing pending or
      // we already consumed it earlier.
      await attemptConsumePendingInvite();
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "Sign in failed" };
    }
  }, []);

  const signUpWithEmailAction = useCallback(async (email: string, password: string) => {
    if (!SUPABASE_CONFIGURED) return { ok: false, error: "Backend not configured" };
    try {
      await api.signUpWithEmail(email, password);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "Sign up failed" };
    }
  }, []);

  /**
   * Trigger the Apple sign-in sheet, then reconcile the resulting session
   * with local state. If Apple gave us a display name (only on first sign-in),
   * it's already been persisted to the profile by the service. The WelcomeSheet
   * advances to the identity step when `isNewUser: true` so the user can
   * complete city + state.
   */
  const signInWithAppleAction = useCallback(async (): Promise<AppleAuthResult> => {
    const result = await appleSignInService();
    if (result.ok && result.fullName) {
      // Optimistic mirror into local userInfo so the next render reflects
      // Apple's name immediately, even before the profile fetch returns.
      setUserInfo((u) => ({ ...u, name: result.fullName ?? u.name }));
    }
    if (result.ok && !result.isNewUser) {
      // Returning user: consume the QR-scan token directly here. For new
      // users completeSignup handles the consume after they fill in city +
      // state; calling here too is idempotent if both fire.
      await attemptConsumePendingInvite();
    }
    return result;
  }, []);

  const resetPasswordAction = useCallback(async (email: string) => {
    if (!SUPABASE_CONFIGURED) return { ok: false, error: "Backend not configured" };
    try {
      await api.resetPassword(email);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "Reset failed" };
    }
  }, []);

  const deleteAccountAction = useCallback(async () => {
    if (!SUPABASE_CONFIGURED) return { ok: false, error: "Backend not configured" };
    try {
      await api.deleteMyAccount();
      resetLocalState();
      await AsyncStorage.removeItem(STORE_KEY);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? "Delete failed" };
    }
  }, []);

  const value = useMemo<MailClubState>(() => ({
    currentUser: userInfo,
    friends,
    postcards,
    routes,
    milestones,
    credits,
    freeCreditsRemaining,
    hasSeenFreeCreditsIntro,
    hasCompletedSignup,
    hasSentFirstCard,
    hydrated,
    authedUserId,
    voidReplies,
    notifications,
    privacy,
    sendPostcard: sendPostcardAction,
    sendPostcardViaLink: sendPostcardViaLinkAction,
    sendIntoVoid: sendIntoVoidAction,
    purchaseCredits: purchaseCreditsAction,
    refreshProfile: refreshProfileAction,
    markFreeCreditsIntroSeen: markFreeCreditsIntroSeenAction,
    updateAboutMe: updateAboutMeAction,
    removeFriend: removeFriendAction,
    addFriendByAddress: addFriendByAddressAction,
    queueInvitation: queueInvitationAction,
    addMayaConnection: addMayaConnectionAction,
    updateNotifications: updateNotificationsAction,
    updatePrivacy: updatePrivacyAction,
    signOut: signOutAction,
    completeSignup: completeSignupAction,
    signInWithEmail: signInWithEmailAction,
    signUpWithEmail: signUpWithEmailAction,
    signInWithApple: signInWithAppleAction,
    resetPassword: resetPasswordAction,
    deleteAccount: deleteAccountAction,
  }), [
    userInfo, friends, postcards, credits, freeCreditsRemaining, hasSeenFreeCreditsIntro, hasCompletedSignup, hasSentFirstCard,
    hydrated, authedUserId, voidReplies, notifications, privacy,
    sendPostcardAction, sendPostcardViaLinkAction, sendIntoVoidAction, purchaseCreditsAction, refreshProfileAction, markFreeCreditsIntroSeenAction,
    updateAboutMeAction, removeFriendAction, addFriendByAddressAction, queueInvitationAction,
    addMayaConnectionAction, updateNotificationsAction, updatePrivacyAction, signOutAction,
    completeSignupAction, signInWithEmailAction, signUpWithEmailAction, signInWithAppleAction,
    resetPasswordAction, deleteAccountAction,
  ]);

  return <MailClubContext.Provider value={value}>{children}</MailClubContext.Provider>;
}

export function useMailClub() {
  const context = useContext(MailClubContext);
  if (!context) {
    throw new Error("useMailClub must be used inside MailClubProvider");
  }
  return context;
}
