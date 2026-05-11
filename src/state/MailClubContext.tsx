import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { CARD_COSTS, CREDIT_PACKS, FREE_CREDITS } from "@/src/data/credits";
import { currentUser as defaultCurrentUser, friends as initialFriends, milestones, postcards as initialPostcards, routes } from "@/src/data/mock";
import { VOID_REPLY_AUTHORS } from "@/src/data/occasions";
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
  voidReplies: VoidReply[];
  notifications: NotificationPrefs;
  privacy: PrivacyPrefs;
  sendPostcard: (input: SendInput) => Promise<SendResult>;
  sendIntoVoid: (message: string) => Promise<{ ok: boolean; replyPreview?: VoidReply }>;
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

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then((raw) => {
      if (!raw) return;
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
      }
    }).catch(() => undefined);
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
      const reply = VOID_REPLY_AUTHORS[Math.floor(Math.random() * VOID_REPLY_AUTHORS.length)];
      const voidReply: VoidReply = {
        id: `void-${Date.now()}`,
        from: reply.from,
        message: reply.message,
        receivedAt: new Date().toISOString(),
      };
      setVoidReplies((replies) => [voidReply, ...replies]);
      setPostcards((items) => [
        {
          id: `void-out-${Date.now()}`,
          toFriendId: "void",
          fromCity: userInfo.city,
          toCity: "Anywhere",
          category: "handwritten",
          creditCost: 1,
          status: "sent",
          message,
          sentAt: new Date().toISOString(),
        },
        ...items,
      ]);
      return { ok: true, replyPreview: voidReply };
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
    async signOut() {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Reset to defaults so the WelcomeSheet shows again on next render
      setFriends(initialFriends);
      setPostcards(initialPostcards);
      setCredits(FREE_CREDITS);
      setFreeCreditsRemaining(FREE_CREDITS);
      setHasSeenFreeCreditsIntro(false);
      setVoidReplies([]);
      setUserInfo(defaultCurrentUser);
      setNotifications(DEFAULT_NOTIFICATIONS);
      setPrivacy(DEFAULT_PRIVACY);
      await AsyncStorage.removeItem(STORE_KEY);
    },
  }), [friends, postcards, credits, freeCreditsRemaining, hasSeenFreeCreditsIntro, voidReplies, userInfo, notifications, privacy]);

  return <MailClubContext.Provider value={value}>{children}</MailClubContext.Provider>;
}

export function useMailClub() {
  const context = useContext(MailClubContext);
  if (!context) {
    throw new Error("useMailClub must be used inside MailClubProvider");
  }
  return context;
}
