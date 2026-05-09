import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { createContext, PropsWithChildren, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { currentUser, friends as initialFriends, milestones, postcards as initialPostcards, routes } from "@/src/data/mock";
import { Friend, Postcard } from "@/src/types/mail";

const STORE_KEY = "mail-club-v0-2-mail-card-state";

type Format = Postcard["type"];

type MailClubState = {
  currentUser: typeof currentUser;
  friends: Friend[];
  postcards: Postcard[];
  routes: typeof routes;
  milestones: typeof milestones;
  stampBalance: number;
  sendPostcard: (friendId: string, format: Format, message: string) => Promise<{ ok: boolean; friendName: string }>;
  addMayaConnection: () => Promise<void>;
  queueInvitation: (name: string, street: string, cityLine: string) => Promise<boolean>;
};

const MailClubContext = createContext<MailClubState | null>(null);

export function MailClubProvider({ children }: PropsWithChildren) {
  const [friends, setFriends] = useState(initialFriends);
  const [postcards, setPostcards] = useState(initialPostcards);
  const [stampBalance, setStampBalance] = useState(5);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then((raw) => {
      if (!raw) return;
      const stored = JSON.parse(raw) as Pick<MailClubState, "friends" | "postcards" | "stampBalance">;
      setFriends(stored.friends ?? initialFriends);
      setPostcards(stored.postcards ?? initialPostcards);
      setStampBalance(stored.stampBalance ?? 5);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(STORE_KEY, JSON.stringify({ friends, postcards, stampBalance })).catch(() => undefined);
  }, [friends, postcards, stampBalance]);

  const value = useMemo<MailClubState>(() => ({
    currentUser,
    friends,
    postcards,
    routes,
    milestones,
    stampBalance,
    async sendPostcard(friendId, format, message) {
      const costs: Record<Format, number> = { note: 1, photo: 3, keepsake: 5, "ask-out": 3 };
      const stampCost = costs[format];
      const friend = friends.find((item) => item.id === friendId) ?? friends[0];
      if (stampBalance < stampCost) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("Not enough stamps", "This demo account needs more stamps for that format.");
        return { ok: false, friendName: friend.name };
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStampBalance((balance) => balance - stampCost);
      setPostcards((items) => [
        {
          id: `p-${Date.now()}`,
          toFriendId: friend.id,
          fromCity: "Denver",
          toCity: friend.city,
          type: format,
          stampCost,
          status: "sent",
          message,
          sentAt: new Date().toISOString(),
        },
        ...items,
      ]);
      setFriends((items) => items.map((item) => (
        item.id === friend.id ? { ...item, cardsSent: item.cardsSent + 1, lastInteractionAt: new Date().toISOString() } : item
      )));
      return { ok: true, friendName: friend.name };
    },
    async addMayaConnection() {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFriends((items) => items.map((item) => (
        item.id === "maya" ? { ...item, cardsSent: Math.max(item.cardsSent, 0), lastInteractionAt: new Date().toISOString() } : item
      )));
    },
    async queueInvitation(name, street, cityLine) {
      if (!name.trim() || !street.trim() || !cityLine.trim()) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return false;
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    },
  }), [friends, postcards, stampBalance]);

  return <MailClubContext.Provider value={value}>{children}</MailClubContext.Provider>;
}

export function useMailClub() {
  const context = useContext(MailClubContext);
  if (!context) {
    throw new Error("useMailClub must be used inside MailClubProvider");
  }
  return context;
}
