export type CardCategory = "handwritten" | "photo" | "place" | "custom";

export type CustomTone = "playful" | "romantic" | "formal" | "weird";

export type Friend = {
  id: string;
  name: string;
  city: string;
  state: string;
  avatarInitials: string;
  cardsSent: number;
  cardsReceived: number;
  connectionType: "in-person" | "postcard-invite";
  lastInteractionAt: string;
  relationshipSignal?: string;
  signalTone?: "red" | "green" | "blue";
};

export type Postcard = {
  id: string;
  toFriendId: string;
  fromCity: string;
  toCity: string;
  category: CardCategory;
  creditCost: number;
  status: "draft" | "sent" | "delivered";
  message: string;
  sentAt: string;
  placeName?: string;
  photoUri?: string;
  customDescription?: string;
  customTone?: CustomTone;
  referencePhotoUris?: string[];
};

export type MailRoute = {
  id: string;
  from: string;
  to: string;
  date: string;
  miles: number;
  people: string;
};

export type Milestone = {
  id: string;
  title: string;
  date: string;
};

export type CurrentUser = {
  name: string;
  city: string;
  state: string;
  since: string;
  avatarInitials: string;
  tagline: string;
  interests: string;
  sendMe: string;
  birthday: string;
  currentlyInto: string;
};
