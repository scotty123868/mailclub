import { render } from "@testing-library/react-native";
import { FriendRow } from "@/src/components/FriendRow";
import type { Friend } from "@/src/types/mail";

const mkFriend = (overrides: Partial<Friend> = {}): Friend => ({
  id: "tatiana",
  name: "Tatiana",
  city: "Paris",
  state: "France",
  avatarInitials: "TA",
  cardsSent: 7,
  cardsReceived: 5,
  connectionType: "in-person",
  lastInteractionAt: "2026-05-14",
  relationshipSignal: "Birthday in 3 days",
  signalTone: "red",
  ...overrides,
});

describe("FriendRow", () => {
  it("renders name + city/state", () => {
    const { getByText } = render(<FriendRow friend={mkFriend()} />);
    expect(getByText("Tatiana")).toBeTruthy();
    expect(getByText("Paris, France")).toBeTruthy();
  });

  it("shows total cards (sent + received)", () => {
    const { getByText } = render(<FriendRow friend={mkFriend({ cardsSent: 7, cardsReceived: 5 })} />);
    expect(getByText("12")).toBeTruthy();
  });

  it("shows 'new' label when no cards exchanged", () => {
    const { getByText } = render(<FriendRow friend={mkFriend({ cardsSent: 0, cardsReceived: 0 })} />);
    expect(getByText("new")).toBeTruthy();
  });

  it("shows the relationship signal", () => {
    const { getByText } = render(<FriendRow friend={mkFriend()} />);
    expect(getByText("Birthday in 3 days")).toBeTruthy();
  });

  it("renders for green signal tone", () => {
    const { getByText } = render(<FriendRow friend={mkFriend({ signalTone: "green", relationshipSignal: "Sent 2 days ago" })} />);
    expect(getByText("Sent 2 days ago")).toBeTruthy();
  });

  it("renders for blue signal tone", () => {
    const { getByText } = render(<FriendRow friend={mkFriend({ signalTone: "blue", relationshipSignal: "Met in Austin" })} />);
    expect(getByText("Met in Austin")).toBeTruthy();
  });
});
