import { imagineCard } from "@/src/utils/imagineCard";

describe("imagineCard()", () => {
  it("returns a 'just-note' fallback for empty input", () => {
    const card = imagineCard("");
    expect(card.occasionId).toBe("just-note");
    expect(card.category).toBe("handwritten");
    expect(card.message).toBeTruthy();
  });

  it("matches 'birthday' to the birthday occasion", () => {
    expect(imagineCard("birthday card").occasionId).toBe("birthday");
    expect(imagineCard("BDay coming up").occasionId).toBe("birthday");
    expect(imagineCard("turning 30 next week").occasionId).toBe("birthday");
  });

  it("personalizes birthday message when name is detected", () => {
    const card = imagineCard("birthday card for my mom who loves gardening");
    expect(card.occasionId).toBe("birthday");
    expect(card.message).toMatch(/Mom/i);
  });

  it("matches 'thank you' / gratitude variants", () => {
    expect(imagineCard("thanks for everything").occasionId).toBe("thank-you");
    expect(imagineCard("just want to say thank you").occasionId).toBe("thank-you");
    expect(imagineCard("im grateful for you").occasionId).toBe("thank-you");
  });

  it("matches party / housewarming", () => {
    expect(imagineCard("housewarming next weekend").occasionId).toBe("party");
    expect(imagineCard("having a party").occasionId).toBe("party");
  });

  it("matches travel / trip", () => {
    expect(imagineCard("on vacation in Greece").occasionId).toBe("travel");
    expect(imagineCard("trip to Tokyo").occasionId).toBe("travel");
    expect(imagineCard("on the road again").occasionId).toBe("travel");
  });

  it("matches memory / shared photo", () => {
    expect(imagineCard("remember when we went to Paris").occasionId).toBe("memory");
    expect(imagineCard("an old photo I found").occasionId).toBe("memory");
  });

  it("matches reconnect cues", () => {
    expect(imagineCard("haven't talked in months").occasionId).toBe("reconnect");
    expect(imagineCard("missing my college friend").occasionId).toBe("reconnect");
    expect(imagineCard("long time no see, want to catch up").occasionId).toBe("reconnect");
  });

  it("matches new-friend follow-up", () => {
    expect(imagineCard("just met someone at the bookstore").occasionId).toBe("new-friend");
    expect(imagineCard("nice meeting you the other night").occasionId).toBe("new-friend");
  });

  it("matches the date / ask-out cue", () => {
    expect(imagineCard("ask out the cute coffee guy").occasionId).toBe("date");
    expect(imagineCard("date invite for Saturday").occasionId).toBe("date");
  });

  it("matches the void / random recipient cue", () => {
    expect(imagineCard("send to a random stranger").occasionId).toBe("void");
    expect(imagineCard("anonymous note to someone").occasionId).toBe("void");
  });

  it("matches AI / art occasion", () => {
    expect(imagineCard("an AI generated illustration").occasionId).toBe("ai-art");
    expect(imagineCard("an imagined painting").occasionId).toBe("ai-art");
  });

  it("matches saying-hi as a low-priority fallback", () => {
    expect(imagineCard("just saying hi today").occasionId).toBe("saying-hi");
  });

  it("includes a rationale string for every result", () => {
    expect(imagineCard("birthday for my dad").rationale).toBeTruthy();
    expect(imagineCard("").rationale).toBeTruthy();
    expect(imagineCard("something completely random").rationale).toBeTruthy();
  });

  it("falls back to a friendly note when no keyword matches", () => {
    const card = imagineCard("the moon is purple tonight");
    expect(card.category).toBe("handwritten");
    expect(card.message).toMatch(/moon/i);
  });
});
