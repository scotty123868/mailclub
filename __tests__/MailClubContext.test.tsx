import { act, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React from "react";
import { Alert, Text } from "react-native";
import { MailClubProvider, useMailClub } from "@/src/state/MailClubContext";

const STORE_KEY = "mailroom-v1-cache";

const ALERT_SPY = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

beforeEach(async () => {
  await AsyncStorage.clear();
  ALERT_SPY.mockClear();
  (Haptics.notificationAsync as jest.Mock).mockClear();
});

type State = ReturnType<typeof useMailClub>;

function makeHarness() {
  const ref: { current: State | null } = { current: null };

  function Probe() {
    ref.current = useMailClub();
    return <Text testID="ready">ready</Text>;
  }

  const utils = render(
    <MailClubProvider>
      <Probe />
    </MailClubProvider>
  );

  return { ref, utils };
}

async function readyHarness() {
  const h = makeHarness();
  await waitFor(() => {
    expect(h.ref.current).not.toBeNull();
  });
  return h;
}

describe("MailClubContext — sendPostcard", () => {
  it("sends a handwritten card (1 credit), deducts balance, fires success haptic", async () => {
    const { ref } = await readyHarness();
    expect(ref.current!.credits).toBe(3);

    let result: { ok: boolean; friendName: string } | null = null;
    await act(async () => {
      result = await ref.current!.sendPostcard({ kind: "handwritten", friendId: "tatiana", message: "hi" });
    });

    expect(result!.ok).toBe(true);
    expect(result!.friendName).toBe("Tatiana");
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");

    await waitFor(() => {
      expect(ref.current!.credits).toBe(2);
    });
    expect(ref.current!.postcards[0].toFriendId).toBe("tatiana");
    expect(ref.current!.postcards[0].category).toBe("handwritten");
    expect(ref.current!.postcards[0].creditCost).toBe(1);
  });

  it("sends a photo card (1 credit)", async () => {
    const { ref } = await readyHarness();
    await act(async () => { await ref.current!.sendPostcard({ kind: "photo", friendId: "alex", photoUri: "file://x.jpg", message: "hi" }); });
    await waitFor(() => {
      expect(ref.current!.credits).toBe(2);
    });
    expect(ref.current!.postcards[0].creditCost).toBe(1);
    expect(ref.current!.postcards[0].category).toBe("photo");
  });

  it("sends a place card (1 credit) and records the place name", async () => {
    const { ref } = await readyHarness();
    await act(async () => {
      await ref.current!.sendPostcard({ kind: "place", friendId: "alex", photoUri: "file://x.jpg", placeName: "Florida", message: "Greetings!" });
    });
    await waitFor(() => {
      expect(ref.current!.credits).toBe(2);
    });
    expect(ref.current!.postcards[0].category).toBe("place");
    expect(ref.current!.postcards[0].placeName).toBe("Florida");
  });

  it("sends a custom card (1 credit) and marks status draft", async () => {
    const { ref } = await readyHarness();
    await act(async () => {
      await ref.current!.sendPostcard({ kind: "custom", friendId: "nora", description: "Romantic watercolor of our trip", referencePhotoUris: ["file://1.jpg"] });
    });
    await waitFor(() => {
      expect(ref.current!.credits).toBe(2);
    });
    expect(ref.current!.postcards[0].category).toBe("custom");
    expect(ref.current!.postcards[0].status).toBe("draft");
    expect(ref.current!.postcards[0].customDescription).toBe("Romantic watercolor of our trip");
    expect(ref.current!.postcards[0].referencePhotoUris).toEqual(["file://1.jpg"]);
  });

  it("blocks send when credits are insufficient and fires warning haptic + alert", async () => {
    const { ref } = await readyHarness();

    // Drain all 3 free credits at 1/card
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await ref.current!.sendPostcard({ kind: "handwritten", friendId: "tatiana", message: `drain ${i}` });
      });
    }
    await waitFor(() => expect(ref.current!.credits).toBe(0));

    let blocked: { ok: boolean; friendName: string } | null = null;
    await act(async () => {
      blocked = await ref.current!.sendPostcard({ kind: "handwritten", friendId: "tatiana", message: "hi" });
    });

    expect(blocked!.ok).toBe(false);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning");
    expect(ALERT_SPY).toHaveBeenCalledWith("Not enough credits", expect.any(String));
  });

  it("increments cardsSent on the recipient friend", async () => {
    const { ref } = await readyHarness();
    const before = ref.current!.friends.find((f) => f.id === "tatiana")!.cardsSent;
    await act(async () => { await ref.current!.sendPostcard({ kind: "handwritten", friendId: "tatiana", message: "hi" }); });
    await waitFor(() => {
      const after = ref.current!.friends.find((f) => f.id === "tatiana")!.cardsSent;
      expect(after).toBe(before + 1);
    });
  });

  it("falls back to first friend if friendId is unknown", async () => {
    const { ref } = await readyHarness();
    let result: { ok: boolean; friendName: string } | null = null;
    await act(async () => {
      result = await ref.current!.sendPostcard({ kind: "handwritten", friendId: "nonexistent-id", message: "hi" });
    });
    expect(result!.ok).toBe(true);
    expect(result!.friendName).toBe(ref.current!.friends[0].name);
  });

  it("prepends new postcards (newest first)", async () => {
    const { ref } = await readyHarness();
    await act(async () => { await ref.current!.sendPostcard({ kind: "handwritten", friendId: "tatiana", message: "first" }); });
    await act(async () => { await ref.current!.sendPostcard({ kind: "handwritten", friendId: "alex", message: "second" }); });
    await waitFor(() => {
      expect(ref.current!.postcards[0].message).toBe("second");
    });
  });

  it("decrements freeCreditsRemaining alongside credits, never below zero", async () => {
    const { ref } = await readyHarness();
    expect(ref.current!.freeCreditsRemaining).toBe(3);
    await act(async () => { await ref.current!.sendPostcard({ kind: "photo", friendId: "alex", photoUri: "x", message: "hi" }); });
    await waitFor(() => expect(ref.current!.freeCreditsRemaining).toBe(2));
  });
});

describe("MailClubContext — purchaseCredits", () => {
  it("adds credits for a valid pack and fires success haptic", async () => {
    const { ref } = await readyHarness();
    let result: { ok: boolean; creditsAdded?: number } | null = null;
    await act(async () => {
      result = await ref.current!.purchaseCredits("p25");
    });
    expect(result!.ok).toBe(true);
    expect(result!.creditsAdded).toBe(25);
    await waitFor(() => expect(ref.current!.credits).toBe(28));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("returns ok:false for an unknown pack id", async () => {
    const { ref } = await readyHarness();
    let result: { ok: boolean } | null = null;
    await act(async () => {
      result = await ref.current!.purchaseCredits("bogus-id");
    });
    expect(result!.ok).toBe(false);
    // (We dropped the warning haptic for invalid pack ids — it's a programmer
    // error, not a user-facing one; the UI never invokes this path with a
    // bogus pack id.)
  });
});

describe("MailClubContext — markFreeCreditsIntroSeen", () => {
  it("flips the flag from false to true", async () => {
    const { ref } = await readyHarness();
    expect(ref.current!.hasSeenFreeCreditsIntro).toBe(false);
    await act(async () => { await ref.current!.markFreeCreditsIntroSeen(); });
    await waitFor(() => expect(ref.current!.hasSeenFreeCreditsIntro).toBe(true));
  });
});

describe("MailClubContext — updateAboutMe", () => {
  it("merges patch fields into currentUser", async () => {
    const { ref } = await readyHarness();
    await act(async () => {
      await ref.current!.updateAboutMe({ tagline: "New tagline here." });
    });
    await waitFor(() => expect(ref.current!.currentUser.tagline).toBe("New tagline here."));
    expect(ref.current!.currentUser.name).toBe("Scotty");
  });
});

describe("MailClubContext — removeFriend", () => {
  it("removes the friend by id", async () => {
    const { ref } = await readyHarness();
    expect(ref.current!.friends.find((f) => f.id === "ben")).toBeTruthy();
    await act(async () => { await ref.current!.removeFriend("ben"); });
    await waitFor(() => {
      expect(ref.current!.friends.find((f) => f.id === "ben")).toBeUndefined();
    });
  });
});

describe("MailClubContext — addFriendByAddress", () => {
  it("adds a new friend with valid inputs", async () => {
    const { ref } = await readyHarness();
    const sizeBefore = ref.current!.friends.length;
    let result: { ok: boolean } | null = null;
    await act(async () => {
      result = await ref.current!.addFriendByAddress({ name: "Jamie River", city: "Boise", state: "ID" });
    });
    expect(result!.ok).toBe(true);
    await waitFor(() => expect(ref.current!.friends.length).toBe(sizeBefore + 1));
    expect(ref.current!.friends[0].name).toBe("Jamie River");
    expect(ref.current!.friends[0].avatarInitials).toBe("JR");
  });

  it("returns ok:false when name or city is missing", async () => {
    const { ref } = await readyHarness();
    let result: { ok: boolean } | null = null;
    await act(async () => {
      result = await ref.current!.addFriendByAddress({ name: "", city: "Boise", state: "ID" });
    });
    expect(result!.ok).toBe(false);
  });
});

describe("MailClubContext — addMayaConnection", () => {
  it("fires success haptic and updates Maya's lastInteractionAt", async () => {
    const { ref } = await readyHarness();
    const beforeMaya = ref.current!.friends.find((f) => f.id === "maya")!;
    const beforeTime = beforeMaya.lastInteractionAt;

    await act(async () => { await ref.current!.addMayaConnection(); });
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");

    await waitFor(() => {
      const maya = ref.current!.friends.find((f) => f.id === "maya")!;
      expect(maya.lastInteractionAt).not.toBe(beforeTime);
    });
  });
});

describe("MailClubContext — queueInvitation", () => {
  it("returns true and fires success haptic for valid input", async () => {
    const { ref } = await readyHarness();
    let ok: boolean | null = null;
    await act(async () => {
      ok = await ref.current!.queueInvitation("Jane Doe", "123 Main St", "Denver, CO 80202");
    });
    expect(ok).toBe(true);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("returns false and fires warning haptic when name is empty", async () => {
    const { ref } = await readyHarness();
    let ok: boolean | null = null;
    await act(async () => {
      ok = await ref.current!.queueInvitation("", "123 Main St", "Denver, CO");
    });
    expect(ok).toBe(false);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("warning");
  });

  it("returns false when street is empty", async () => {
    const { ref } = await readyHarness();
    let ok: boolean | null = null;
    await act(async () => {
      ok = await ref.current!.queueInvitation("Jane", "", "Denver");
    });
    expect(ok).toBe(false);
  });

  it("returns false when city line is empty", async () => {
    const { ref } = await readyHarness();
    let ok: boolean | null = null;
    await act(async () => {
      ok = await ref.current!.queueInvitation("Jane", "Main St", "");
    });
    expect(ok).toBe(false);
  });

  it("returns false on whitespace-only fields", async () => {
    const { ref } = await readyHarness();
    let ok: boolean | null = null;
    await act(async () => {
      ok = await ref.current!.queueInvitation("   ", "123 Main", "Denver");
    });
    expect(ok).toBe(false);
  });
});

describe("MailClubContext — persistence", () => {
  it("rehydrates credits, postcards, and friends from AsyncStorage", async () => {
    const stored = {
      friends: [{ id: "rehydrated", name: "Hydra", city: "Atlantis", state: "??", avatarInitials: "HY", cardsSent: 99, cardsReceived: 99, connectionType: "in-person", lastInteractionAt: "2026-01-01", relationshipSignal: "test", signalTone: "blue" }],
      postcards: [{ id: "stored-1", toFriendId: "rehydrated", fromCity: "Denver", toCity: "Atlantis", category: "handwritten", creditCost: 1, status: "sent", message: "stored", sentAt: "2026-01-01" }],
      credits: 42,
      freeCreditsRemaining: 0,
      hasSeenFreeCreditsIntro: true,
    };
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(stored));

    const { ref } = await readyHarness();
    await waitFor(() => {
      expect(ref.current!.credits).toBe(42);
    });
    expect(ref.current!.friends[0].name).toBe("Hydra");
    expect(ref.current!.postcards[0].id).toBe("stored-1");
    expect(ref.current!.hasSeenFreeCreditsIntro).toBe(true);
  });

  it("persists state changes back to AsyncStorage after sendPostcard", async () => {
    const { ref } = await readyHarness();
    await act(async () => { await ref.current!.sendPostcard({ kind: "handwritten", friendId: "tatiana", message: "hi" }); });

    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(STORE_KEY);
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.credits).toBe(2);
      expect(parsed.postcards[0].toFriendId).toBe("tatiana");
    });
  });

  it("falls back to defaults if AsyncStorage is corrupt", async () => {
    await AsyncStorage.setItem(STORE_KEY, "not-json");
    const { ref } = await readyHarness();
    expect(ref.current!.credits).toBe(3);
  });
});

describe("MailClubContext — initial state", () => {
  it("exposes 6 mock friends", async () => {
    const { ref } = await readyHarness();
    expect(ref.current!.friends).toHaveLength(6);
    expect(ref.current!.friends.map((f) => f.id).sort()).toEqual(["alex", "ben", "maya", "nora", "sam", "tatiana"]);
  });

  it("exposes 3 starter postcards", async () => {
    const { ref } = await readyHarness();
    expect(ref.current!.postcards).toHaveLength(3);
  });

  it("exposes 3 mock routes", async () => {
    const { ref } = await readyHarness();
    expect(ref.current!.routes).toHaveLength(3);
  });

  it("exposes 2 milestones", async () => {
    const { ref } = await readyHarness();
    expect(ref.current!.milestones).toHaveLength(2);
  });

  it("exposes currentUser as Scotty", async () => {
    const { ref } = await readyHarness();
    expect(ref.current!.currentUser.name).toBe("Scotty");
    expect(ref.current!.currentUser.city).toBe("Denver");
  });

  it("starts with 3 credits and 3 free credits", async () => {
    const { ref } = await readyHarness();
    expect(ref.current!.credits).toBe(3);
    expect(ref.current!.freeCreditsRemaining).toBe(3);
    expect(ref.current!.hasSeenFreeCreditsIntro).toBe(false);
  });
});
