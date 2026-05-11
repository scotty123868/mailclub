import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { CARD_COSTS, CREDIT_PACKS, FREE_CREDITS } from "@/src/data/credits";
import { currentUser as defaultCurrentUser, friends as initialFriends, milestones, postcards as initialPostcards, routes } from "@/src/data/mock";
import * as api from "@/src/services/api";
import { SUPABASE_CONFIGURED, supabase } from "@/src/services/supabase";
import type { CardCategory, CurrentUser, CustomTone, Friend, Postcard } from "@/src/types/mail";

const STORE_KEY = "mail-club-v1-cache";

export type SendInput =
  | { kind: "handwritten"; friendId: string; message: string }
  | { kind: "photo"; friendId: string; photoUri: string; message: string }
  | { kind: "place"; friendId: string; photoUri: string; placeName: string; message: string }
  | { kind: "custom"; friendId: string; description: string; tone?: CustomTone; referencePhotoUris: string[] };

export type VoidReply = {
  id: string;
  from: string;
  message: string;
  receivedAt: string;
};

export type CreditsPurchaseResult = { ok: boolean; creditsAdded?: number };
export type SendResult = { ok: boolean; friendName: string; creditsRemaining?: number };
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
  hydrated: boolean;
  authedUserId: string | null;
  voidReplies: VoidReply[];
  notifications: NotificationPrefs;
  privacy: PrivacyPrefs;
  sendPostcard: (input: SendInput) => Promise<SendResult>;
  sendIntoVoid: (message: string) => Promise<{ ok: boolean }>;
  purchaseCredits: (packId: string) => Promise<CreditsPurchaseResult>;
  markFreeCreditsIntroSeen: () => Promise<void>;
  updateAboutMe: (patch: Partial<CurrentUser>) => Promise<void>;
  removeFriend: (id: string) => Promise<void>;
  addFriendByAddress: (input: { name: string; city: string; state: string }) => Promise<AddFriendResult>;
  queueInvitation: (name: string, street: string, cityLine: string) => Promise<boolean>;
  addMayaConnection: () => Promise<void>;
  updateNotifications: (patch: Partial<NotificationPrefs>) => Promise<void>;
  updatePrivacy: (patch: Partial<PrivacyPrefs>) => Promise<void>;
  signOut: () => Promise<void>;
  completeSignup: (input: { name: string; city: string; state: string; email?: string; password?: string }) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
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
      notifications,
      privacy,
    };
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(cache)).catch(() => undefined);
  }, [userInfo, friends, postcards, voidReplies, credits, freeCreditsRemaining, hasSeenFreeCreditsIntro, hasCompletedSignup, notifications, privacy]);

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
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Initial Supabase fetch failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authedUserId]);

  // ---- Actions ----------------------------------------------------------

  const sendPostcardAction = useCallback(async (input: SendInput): Promise<SendResult> => {
    const category: CardCategory = input.kind;
    const cost = costForCategory(category);
    const friend = friends.find((f) => f.id === input.friendId) ?? friends[0];

    if (credits < cost) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Not enough credits", `This card costs ${cost} credit${cost === 1 ? "" : "s"}. Buy more to send it.`);
      return { ok: false, friendName: friend?.name ?? "" };
    }

    if (!SUPABASE_CONFIGURED || !authedUserId) {
      // Local-only fallback (used by tests + offline / unauthenticated)
      return sendPostcardLocal(input, cost, friend);
    }

    // Optimistic local update
    const prevCredits = credits;
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
      return { ok: true, friendName: friend.name, creditsRemaining };
    } catch (err: any) {
      // Revert
      setCredits(prevCredits);
      setPostcards(prevPostcards);
      setFriends(prevFriends);
      Alert.alert("Couldn't send", err?.message ?? "Try again in a moment.");
      return { ok: false, friendName: friend.name };
    }
  }, [authedUserId, credits, friends, postcards]);

  function sendPostcardLocal(input: SendInput, cost: number, friend: Friend | undefined): SendResult {
    const category: CardCategory = input.kind;
    setCredits((c) => c - cost);
    setFreeCreditsRemaining((b) => Math.max(0, b - cost));
    const message = input.kind === "custom" ? input.description : input.message;
    const photoUri = input.kind === "photo" || input.kind === "place" ? input.photoUri : undefined;
    const next: Postcard = {
      id: `p-${Date.now()}`,
      toFriendId: friend?.id ?? "",
      fromCity: userInfo.city || "Somewhere",
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
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    return { ok: true, friendName: friend?.name ?? "", creditsRemaining: credits - cost };
  }

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
        fromCity: userInfo.city || "Somewhere",
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
    const prevPostcards = postcards;
    setCredits((c) => c - 1);
    setFreeCreditsRemaining((b) => Math.max(0, b - 1));
    try {
      const postcard = await api.sendIntoVoid(message);
      setPostcards((items) => [postcard, ...items]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { ok: true };
    } catch (err: any) {
      setCredits(prevCredits);
      setPostcards(prevPostcards);
      Alert.alert("Couldn't send", err?.message ?? "Try again.");
      return { ok: false };
    }
  }, [authedUserId, credits, postcards, userInfo.city]);

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

  const markFreeCreditsIntroSeenAction = useCallback(async () => {
    setHasSeenFreeCreditsIntro(true);
    if (SUPABASE_CONFIGURED && authedUserId) {
      api.markFreeCreditsIntroSeen().catch(() => undefined);
    }
  }, [authedUserId]);

  const updateAboutMeAction = useCallback(async (patch: Partial<CurrentUser>) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setUserInfo((u) => ({ ...u, ...patch }));
    if (SUPABASE_CONFIGURED && authedUserId) {
      api.updateProfile(patch).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("updateProfile sync failed", err);
      });
    }
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

  const addFriendByAddressAction = useCallback(async (input: { name: string; city: string; state: string }): Promise<AddFriendResult> => {
    const name = input.name.trim();
    const city = input.city.trim();
    const state = input.state.trim();
    if (!name || !city) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return { ok: false };
    }
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
      };
      setFriends((items) => [friend, ...items]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { ok: true, friend };
    }
    try {
      const friend = await api.addFriend({ name, city, state });
      setFriends((items) => [friend, ...items]);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { ok: true, friend };
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
    setUserInfo(EMPTY_USER);
    setNotifications(DEFAULT_NOTIFICATIONS);
    setPrivacy(DEFAULT_PRIVACY);
  }

  const signOutAction = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    resetLocalState();
    await AsyncStorage.removeItem(STORE_KEY);
    if (SUPABASE_CONFIGURED) {
      try {
        await api.signOut();
      } catch {
        // ignore — local state is already cleared
      }
    }
  }, []);

  const completeSignupAction = useCallback(async (input: { name: string; city: string; state: string; email?: string; password?: string }) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const trimmedName = input.name.trim() || "Mail Club member";
    const trimmedCity = input.city.trim() || "Somewhere";
    const trimmedState = input.state.trim();
    const initials = trimmedName.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase() || trimmedName.slice(0, 2).toUpperCase();

    // Optimistic local set first
    setUserInfo({
      ...EMPTY_USER,
      name: trimmedName,
      city: trimmedCity,
      state: trimmedState,
      since: String(new Date().getFullYear()),
      avatarInitials: initials,
    });
    setFriends([]);
    setPostcards([]);
    setVoidReplies([]);
    setHasSeenFreeCreditsIntro(true);
    setHasCompletedSignup(true);

    if (!SUPABASE_CONFIGURED) return;

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
          return;
        }
      }
    }

    // After auth (or if already authed), call the server RPC
    try {
      const profile = await api.completeSignup({ name: trimmedName, city: trimmedCity, state: trimmedState });
      setUserInfo(profile.currentUser);
      setCredits(profile.credits);
      setFreeCreditsRemaining(profile.freeCreditsRemaining);
      setHasSeenFreeCreditsIntro(profile.hasSeenFreeCreditsIntro);
      setHasCompletedSignup(profile.hasCompletedSignup);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn("complete_signup RPC failed", err?.message);
    }
  }, [authedUserId]);

  const signInWithEmailAction = useCallback(async (email: string, password: string) => {
    if (!SUPABASE_CONFIGURED) return { ok: false, error: "Backend not configured" };
    try {
      await api.signInWithEmail(email, password);
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
    hydrated,
    authedUserId,
    voidReplies,
    notifications,
    privacy,
    sendPostcard: sendPostcardAction,
    sendIntoVoid: sendIntoVoidAction,
    purchaseCredits: purchaseCreditsAction,
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
    resetPassword: resetPasswordAction,
    deleteAccount: deleteAccountAction,
  }), [
    userInfo, friends, postcards, credits, freeCreditsRemaining, hasSeenFreeCreditsIntro, hasCompletedSignup,
    hydrated, authedUserId, voidReplies, notifications, privacy,
    sendPostcardAction, sendIntoVoidAction, purchaseCreditsAction, markFreeCreditsIntroSeenAction,
    updateAboutMeAction, removeFriendAction, addFriendByAddressAction, queueInvitationAction,
    addMayaConnectionAction, updateNotificationsAction, updatePrivacyAction, signOutAction,
    completeSignupAction, signInWithEmailAction, signUpWithEmailAction,
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
