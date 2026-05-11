import { CurrentUser, Friend, MailRoute, Milestone, Postcard } from "@/src/types/mail";

export const currentUser: CurrentUser = {
  name: "Scotty",
  city: "Denver",
  state: "CO",
  since: "2026",
  avatarInitials: "SL",
  tagline: "For the friends you love and the ones you just met.",
  interests: "skiing, concerts, weird diners, cooking, books",
  sendMe: "mountain photos, strange signs, concert memories",
  birthday: "March 12",
  currentlyInto: "tennis, road trips, old cameras",
};

export const friends: Friend[] = [
  { id: "tatiana", name: "Tatiana", city: "Paris", state: "France", avatarInitials: "TA", cardsSent: 7, cardsReceived: 5, connectionType: "in-person", lastInteractionAt: "2026-05-14", relationshipSignal: "Birthday in 3 days", signalTone: "red" },
  { id: "alex", name: "Alex", city: "Portland", state: "OR", avatarInitials: "AX", cardsSent: 4, cardsReceived: 4, connectionType: "postcard-invite", lastInteractionAt: "2026-05-06", relationshipSignal: "Sent 2 days ago", signalTone: "green" },
  { id: "maya", name: "Maya", city: "Austin", state: "TX", avatarInitials: "MY", cardsSent: 8, cardsReceived: 7, connectionType: "in-person", lastInteractionAt: "2026-05-10", relationshipSignal: "Met in Austin", signalTone: "blue" },
  { id: "nora", name: "Nora", city: "Vancouver", state: "BC", avatarInitials: "NO", cardsSent: 1, cardsReceived: 5, connectionType: "in-person", lastInteractionAt: "2026-05-08", relationshipSignal: "First card sent!", signalTone: "green" },
  { id: "ben", name: "Ben", city: "Nashville", state: "TN", avatarInitials: "BN", cardsSent: 2, cardsReceived: 1, connectionType: "in-person", lastInteractionAt: "2026-03-18", relationshipSignal: "Write back", signalTone: "red" },
  { id: "sam", name: "Sam", city: "Chicago", state: "IL", avatarInitials: "SM", cardsSent: 4, cardsReceived: 4, connectionType: "postcard-invite", lastInteractionAt: "2026-02-22", relationshipSignal: "Winter card", signalTone: "blue" },
];

export const postcards: Postcard[] = [
  { id: "p1", toFriendId: "tatiana", fromCity: "Denver", toCity: "Nashville", category: "photo", creditCost: 2, status: "sent", message: "Wish you were here. This made me think of you.", sentAt: "2026-05-14" },
  { id: "p2", toFriendId: "alex", fromCity: "Austin", toCity: "New York", category: "handwritten", creditCost: 1, status: "delivered", message: "A tiny note from the road.", sentAt: "2026-05-10" },
  { id: "p3", toFriendId: "nora", fromCity: "Denver", toCity: "Vancouver", category: "handwritten", creditCost: 1, status: "sent", message: "Had a great time meeting you. Want to grab coffee next week?", sentAt: "2026-05-08" },
];

export const routes: MailRoute[] = [
  { id: "r1", from: "Denver", to: "Nashville", date: "May 12, 2026", miles: 612, people: "Scotty & Jamie" },
  { id: "r2", from: "Austin", to: "New York", date: "May 8, 2026", miles: 1512, people: "Scotty & Taylor" },
  { id: "r3", from: "Vancouver", to: "Denver", date: "May 3, 2026", miles: 1049, people: "Jamie & Morgan" },
];

export const milestones: Milestone[] = [
  { id: "m1", title: "First card to Tatiana", date: "May 14, 2026" },
  { id: "m2", title: "5-card friendship with Alex", date: "April 2, 2026" },
];
