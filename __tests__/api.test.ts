/**
 * Smoke tests for the Supabase api.ts wrapper. The supabase client itself is
 * mocked in jest.setup.ts; here we replace specific methods per-test to drive
 * branches.
 */
import * as api from "@/src/services/api";
import { supabase } from "@/src/services/supabase";

const sb = supabase as any;

afterEach(() => {
  jest.clearAllMocks();
});

describe("api.fetchProfile", () => {
  it("returns null when no profile exists", async () => {
    sb.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const result = await api.fetchProfile();
    expect(result).toBeNull();
  });

  it("maps a profile row into the app's CurrentUser shape", async () => {
    sb.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: "u1",
          name: "Pat",
          city: "Boise",
          state: "ID",
          since: "2026",
          avatar_initials: "PA",
          tagline: "",
          interests: "",
          send_me: "",
          birthday: "",
          currently_into: "",
          credits: 5,
          free_credits_remaining: 5,
          has_seen_free_credits_intro: false,
          has_completed_signup: true,
          notifications: { cardDelivered: true, replyReceived: true, birthdays: true },
          privacy: { whoCanSendToMe: "anyone" },
        },
        error: null,
      }),
    });
    const result = await api.fetchProfile();
    expect(result?.currentUser.name).toBe("Pat");
    expect(result?.currentUser.city).toBe("Boise");
    expect(result?.currentUser.avatarInitials).toBe("PA");
    expect(result?.credits).toBe(5);
    expect(result?.hasCompletedSignup).toBe(true);
  });
});

describe("api.completeSignup", () => {
  it("calls the complete_signup RPC with trimmed inputs", async () => {
    sb.rpc.mockResolvedValue({
      data: {
        id: "u1", name: "Pat", city: "Boise", state: "ID", since: "2026",
        avatar_initials: "PA", tagline: "", interests: "", send_me: "",
        birthday: "", currently_into: "", credits: 5, free_credits_remaining: 5,
        has_seen_free_credits_intro: true, has_completed_signup: true,
        notifications: { cardDelivered: true, replyReceived: true, birthdays: true },
        privacy: { whoCanSendToMe: "anyone" },
      },
      error: null,
    });
    const result = await api.completeSignup({ name: "  Pat ", city: " Boise ", state: "ID" });
    expect(sb.rpc).toHaveBeenCalledWith("complete_signup", {
      p_name: "  Pat ", p_city: " Boise ", p_state: "ID",
    });
    expect(result.currentUser.name).toBe("Pat");
  });

  it("throws on RPC error", async () => {
    sb.rpc.mockResolvedValue({ data: null, error: { message: "not authenticated" } });
    await expect(api.completeSignup({ name: "Pat", city: "", state: "" })).rejects.toMatchObject({ message: "not authenticated" });
  });
});

describe("api.sendPostcard", () => {
  it("calls send_postcard RPC with the right params for a handwritten send", async () => {
    sb.rpc.mockImplementation((fn: string) => {
      if (fn === "send_postcard") {
        return Promise.resolve({
          data: {
            id: "p1", to_kind: "friend", to_friend_id: "f1",
            from_city: "Denver", to_city: "Boise", category: "handwritten",
            credit_cost: 1, status: "sent", message: "hi", place_name: null,
            photo_uri: null, custom_description: null, custom_tone: null,
            reference_photo_uris: [], sent_at: "2026-01-01T00:00:00Z",
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
    sb.from.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const { postcard } = await api.sendPostcard({ kind: "handwritten", friendId: "f1", message: "hi" });
    expect(postcard.category).toBe("handwritten");
    expect(postcard.creditCost).toBe(1);
    expect(sb.rpc).toHaveBeenCalledWith("send_postcard", expect.objectContaining({
      p_to_kind: "friend",
      p_to_friend_id: "f1",
      p_category: "handwritten",
      p_message: "hi",
    }));
  });

  it("surfaces RPC errors", async () => {
    sb.rpc.mockResolvedValue({ data: null, error: { message: "insufficient credits" } });
    await expect(api.sendPostcard({ kind: "handwritten", friendId: "f1", message: "hi" })).rejects.toMatchObject({ message: "insufficient credits" });
  });
});

describe("api.sendIntoVoid", () => {
  it("calls send_postcard with to_kind=void", async () => {
    sb.rpc.mockResolvedValue({
      data: {
        id: "v1", to_kind: "void", to_friend_id: null,
        from_city: "Denver", to_city: "Anywhere", category: "handwritten",
        credit_cost: 1, status: "sent", message: "hi",
        place_name: null, photo_uri: null, custom_description: null,
        custom_tone: null, reference_photo_uris: [], sent_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    });
    const result = await api.sendIntoVoid("hi");
    expect(result.toFriendId).toBe("void");
    expect(sb.rpc).toHaveBeenCalledWith("send_postcard", expect.objectContaining({
      p_to_kind: "void",
      p_to_friend_id: null,
    }));
  });
});

describe("api.purchaseCredits", () => {
  it("calls purchase_credits RPC with pack id", async () => {
    sb.rpc.mockResolvedValue({
      data: {
        id: "u1", name: "Pat", city: "Boise", state: "ID", since: "2026",
        avatar_initials: "PA", tagline: "", interests: "", send_me: "",
        birthday: "", currently_into: "", credits: 15, free_credits_remaining: 5,
        has_seen_free_credits_intro: true, has_completed_signup: true,
        notifications: { cardDelivered: true, replyReceived: true, birthdays: true },
        privacy: { whoCanSendToMe: "anyone" },
      },
      error: null,
    });
    const result = await api.purchaseCredits("p10");
    expect(sb.rpc).toHaveBeenCalledWith("purchase_credits", { p_pack_id: "p10" });
    expect(result.credits).toBe(15);
  });
});

describe("api.addFriend", () => {
  it("derives initials from a name like 'Jamie River'", async () => {
    sb.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const insertChain = {
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: "f1", name: "Jamie River", city: "Boise", state: "ID",
          avatar_initials: "JR", cards_sent: 0, cards_received: 0,
          connection_type: "postcard-invite", last_interaction_at: "2026-01-01T00:00:00Z",
          relationship_signal: "Just added", signal_tone: "blue",
        },
        error: null,
      }),
    };
    sb.from.mockReturnValue({ insert: jest.fn().mockReturnValue(insertChain) });
    const friend = await api.addFriend({ name: "Jamie River", city: "Boise", state: "ID" });
    expect(friend.avatarInitials).toBe("JR");
    expect(friend.name).toBe("Jamie River");
  });

  it("rejects empty names", async () => {
    sb.auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    await expect(api.addFriend({ name: "  ", city: "Boise", state: "" })).rejects.toMatchObject({ message: "name required" });
  });
});

describe("api.signInWithEmail / signUpWithEmail / signOut", () => {
  it("forwards email + password to supabase.auth.signInWithPassword", async () => {
    sb.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: "u1" }, session: null }, error: null });
    await api.signInWithEmail("a@b.com", "secret123");
    expect(sb.auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@b.com", password: "secret123" });
  });

  it("throws when sign-in fails", async () => {
    sb.auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { message: "Invalid login" } });
    await expect(api.signInWithEmail("a@b.com", "bad")).rejects.toMatchObject({ message: "Invalid login" });
  });

  it("signs out", async () => {
    sb.auth.signOut.mockResolvedValue({ error: null });
    await api.signOut();
    expect(sb.auth.signOut).toHaveBeenCalled();
  });
});
