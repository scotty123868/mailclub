import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { CARD_COSTS, CREDIT_PACKS, FREE_CREDITS } from "@/src/data/credits";
import { currentUser as defaultCurrentUser, friends as initialFriends, milestones, postcards as initialPostcards, routes } from "@/src/data/mock";
import type { CardCategory, CurrentUser, CustomTone, Friend, Postcard } from "@/src/types/mail";

const STORE_KEY = "mail-club-v0-3-credits-state";

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

type MailClubState = {
  currentUser: CurrentUser;
  friends: Friend[];
  postcards: Postcard[];
  routes: typeof routes;
  milestones: typeof milestones;
  credits: number;
  freeCreditsRemaining: number;
  hasSeenFreeCreditsIntro: boolean;
  hydrated: boolean;
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
  completeSignup: (input: { name: string; city: string; state: string }) => Promise<void>;
};

const MailClubContext = createContext<MailClubState | null>(null);

function costForCategory(category: CardCategory): number {
  return CARD_COSTS[category];
}

export function MailClubProvider({ children }: PropsWithChildren) {
  const [friends, setFriends] = useState(initialFriends);
  const [postcards, setPostcards] = useState(initialPostcards);
  const [credits, setCredits] = useState(FREE_CREDITS);
  const [freeCreditsRemaining, setFreeCreditsRemaining] = useState(FREE_CREDITS);
  const [hasSeenFreeCreditsIntro, setHasSeenFreeCreditsIntro] = useState(false);
  const [voidReplies, setVoidReplies] = useState<VoidReply[]>([]);
  const [userInfo, setUserInfo] = useState<CurrentUser>(defaultCurrentUser);
  const [notifications, setNotifications] = useState<NotificationPrefs>(DEFAULT_NOTIFICATIONS);
  const [privacy, setPrivacy] = useState<PrivacyPrefs>(DEFAULT_PRIVACY);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then((raw) => {
      if (!raw) {
        setHydrated(true);
        return;
      }
      try {
        const stored = JSON.parse(raw);
        if (stored && typeof stored === "object") {
          if (Array.isArray(stored.friends)) setFriends(stored.friends);
          if (Array.isArray(stored.postcards)) setPostcards(stored.postcards);
          if (typeof stored.credits === "number") setCredits(stored.credits);
          if (typeof stored.freeCreditsRemaining === "number") setFreeCreditsRemaining(stored.freeCreditsRemaining);
          if (typeof stored.hasSeenFreeCreditsIntro === "boolean") setHasSeenFreeCreditsIntro(stored.hasSeenFreeCreditsIntro);
          if (Array.isArray(stored.voidReplies)) setVoidReplies(stored.voidReplies);
          if (stored.currentUser && typeof stored.currentUser === "object") setUserInfo({ ...defaultCurrentUser, ...stored.currentUser });
          if (stored.notifications && typeof stored.notifications === "object") setNotifications({ ...DEFAULT_NOTIFICATIONS, ...stored.notifications });
          if (stored.privacy && typeof stored.privacy === "object") setPrivacy({ ...DEFAULT_PRIVACY, ...stored.privacy });
        }
      } catch {
        // Drop bad data — defaults already loaded
      } finally {
        setHydrated(true);
      }
    }).catch(() => setHydrated(true));
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(
      STORE_KEY,
      JSON.stringify({ friends, postcards, credits, freeCreditsRemaining, hasSeenFreeCreditsIntro, voidReplies, currentUser: userInfo, notifications, privacy })
    ).catch(() => undefined);
  }, [friends, postcards, credits, freeCreditsRemaining, hasSeenFreeCreditsIntro, voidReplies, userInfo, notifications, privacy]);

  const value = useMemo<MailClubState>(() => ({
    currentUser: userInfo,
    friends,
    postcards,
    routes,
    milestones,
    credits,
    freeCreditsRemaining,
    hasSeenFreeCreditsIntro,
    hydrated,
    voidReplies,
    notifications,
    privacy,
    async sendIntoVoid(message) {
      if (credits < 1) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("Not enough credits", "Sending into the void costs 1 credit.");
        return { ok: false };
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCredits((b) => b - 1);
      setFreeCreditsRemaining((b) => Math.max(0, b - 1));
      // NOTE: We do NOT auto-fabricate a "stranger reply" here. Real replies
      // arrive (if ever) via the fulfillment backend, which v0.3 does not have.
      // Inventing replies locally would mislead the user about what's real —
      // Apple Guideline 4.0/5.6.1 prohibits this.
      setPostcards((items) => [
        {
          id: `void-out-${Date.now()}`,
          toFriendId: "void",
          fromCity: userInfo.city || "Somewhere",
          toCity: "Anywhere",
          category: "handwritten",
          creditCost: 1,
          status: "sent",
          message,
          sentAt: new Date().toISOString(),
        },
        ...items,
      ]);
      return { ok: true };
    },
    async sendPostcard(input) {
      const category: CardCategory = input.kind;
      const cost = costForCategory(category);
      const friend = friends.find((item) => item.id === input.friendId) ?? friends[0];
      if (credits < cost) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("Not enough credits", `This card costs ${cost} credit${cost === 1 ? "" : "s"}. Buy more to send it.`);
        return { ok: false, friendName: friend.name };
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCredits((balance) => balance - cost);
      setFreeCreditsRemaining((balance) => Math.max(0, balance - cost));

      const message = input.kind === "custom" ? input.description : input.message;
      const photoUri = input.kind === "photo" || input.kind === "place" ? input.photoUri : undefined;
      const placeName = input.kind === "place" ? input.placeName : undefined;
      const referencePhotoUris = input.kind === "custom" ? input.referencePhotoUris : undefined;
      const customDescription = input.kind === "custom" ? input.description : undefined;
      const customTone = input.kind === "custom" ? input.tone : undefined;
      const status: Postcard["status"] = input.kind === "custom" ? "draft" : "sent";

      const next: Postcard = {
        id: `p-${Date.now()}`,
        toFriendId: friend.id,
        fromCity: userInfo.city,
        toCity: friend.city,
        category,
        creditCost: cost,
        status,
        message,
        sentAt: new Date().toISOString(),
        photoUri,
        placeName,
        referencePhotoUris,
        customDescription,
        customTone,
      };
      setPostcards((items) => [next, ...items]);
      setFriends((items) => items.map((item) => (
        item.id === friend.id ? { ...item, cardsSent: item.cardsSent + 1, lastInteractionAt: new Date().toISOString() } : item
      )));
      return { ok: true, friendName: friend.name, creditsRemaining: credits - cost };
    },
    async purchaseCredits(packId) {
      const pack = CREDIT_PACKS.find((p) => p.id === packId);
      if (!pack) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return { ok: false };
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCredits((b) => b + pack.credits);
      return { ok: true, creditsAdded: pack.credits };
    },
    async markFreeCreditsIntroSeen() {
      setHasSeenFreeCreditsIntro(true);
    },
    async updateAboutMe(patch) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setUserInfo((u) => ({ ...u, ...patch }));
    },
    async removeFriend(id) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFriends((items) => items.filter((item) => item.id !== id));
    },
    async addFriendByAddress(input) {
      const name = input.name.trim();
      const city = input.city.trim();
      const state = input.state.trim();
      if (!name || !city) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return { ok: false };
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      return { ok: true, friend };
    },
    async queueInvitation(name, street, cityLine) {
      if (!name.trim() || !street.trim() || !cityLine.trim()) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return false;
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    },
    async addMayaConnection() {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFriends((items) => items.map((item) => (
        item.id === "maya" ? { ...item, cardsSent: Math.max(item.cardsSent, 0), lastInteractionAt: new Date().toISOString() } : item
      )));
    },
    async updateNotifications(patch) {
      await Haptics.selectionAsync();
      setNotifications((n) => ({ ...n, ...patch }));
    },
    async updatePrivacy(patch) {
      await Haptics.selectionAsync();
      setPrivacy((p) => ({ ...p, ...patch }));
    },
    async completeSignup(input) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const name = input.name.trim() || "Mail Club member";
      const city = input.city.trim() || "Somewhere";
      const state = input.state.trim() || "";
      // Initials from name (e.g., "Jamie River" → "JR", "Pat" → "PA")
      const initials = name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase();
      setUserInfo({
        name,
        city,
        state,
        since: String(new Date().getFullYear()),
        avatarInitials: initials,
        tagline: "",
        interests: "",
        sendMe: "",
        birthday: "",
        currentlyInto: "",
      });
      // Fresh signup starts with no friends, no history. Mock fixtures don't belong here.
      setFriends([]);
      setPostcards([]);
      setVoidReplies([]);
      setHasSeenFreeCreditsIntro(true);
    },
    async signOut() {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Reset to a clean slate. Do NOT repopulate with mock fixtures — the
      // new user shouldn't see Tatiana/Maya/etc as their "friends".
      setFriends([]);
      setPostcards([]);
      setCredits(FREE_CREDITS);
      setFreeCreditsRemaining(FREE_CREDITS);
      setHasSeenFreeCreditsIntro(false);
      setVoidReplies([]);
      setUserInfo({
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
      });
      setNotifications(DEFAULT_NOTIFICATIONS);
      setPrivacy(DEFAULT_PRIVACY);
      await AsyncStorage.removeItem(STORE_KEY);
    },
  }), [friends, postcards, credits, freeCreditsRemaining, hasSeenFreeCreditsIntro, hydrated, voidReplies, userInfo, notifications, privacy]);

  return <MailClubContext.Provider value={value}>{children}</MailClubContext.Provider>;
}

export function useMailClub() {
  const context = useContext(MailClubContext);
  if (!context) {
    throw new Error("useMailClub must be used inside MailClubProvider");
  }
  return context;
}
