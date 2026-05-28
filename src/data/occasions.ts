import type { CardCategory } from "@/src/types/mail";

export type OccasionId =
 | "travel"
 | "birthday"
 | "party"
 | "memory"
 | "just-note"
 | "saying-hi"
 | "thank-you"
 | "new-friend"
 | "reconnect"
 | "void"
 | "ai-art"
 | "date";

export type Occasion = {
 id: OccasionId;
 title: string;
 blurb: string;
 category: CardCategory;
 message: string;
 photoPrompt?: string;
 tone: "red" | "sage" | "blue" | "gold" | "night";
 icon: string;
 special?: "random-recipient" | "ai-photo";
};

export const OCCASIONS: Occasion[] = [
 {
 id: "travel",
 title: "Trip postcard",
 blurb: "From wherever you are.",
 category: "place",
 message: "Sending greetings from the road. Wish you were here.",
 photoPrompt: "A view from your trip",
 tone: "blue",
 icon: "Plane",
 },
 {
 id: "birthday",
 title: "Birthday card",
 blurb: "Celebrate someone.",
 category: "photo",
 message: "Happy birthday. I'm so glad you're in my life.",
 tone: "red",
 icon: "Cake",
 },
 {
 id: "party",
 title: "Party invitation",
 blurb: "Bring your friends.",
 category: "handwritten",
 message: "You're invited. Saturday, 7pm. Bring nothing but yourself.",
 tone: "gold",
 icon: "PartyPopper",
 },
 {
 id: "memory",
 title: "Shared memory",
 blurb: "Remember when?",
 category: "photo",
 message: "Remember this? I thought of you the moment I saw it.",
 photoPrompt: "A photo from a memory you share",
 tone: "sage",
 icon: "Camera",
 },
 {
 id: "just-note",
 title: "Just a note",
 blurb: "Short and warm.",
 category: "handwritten",
 message: "A short note from a real human, no algorithm involved. Hope your week is gentle.",
 tone: "sage",
 icon: "FileText",
 },
 {
 id: "saying-hi",
 title: "Just saying hi",
 blurb: "No reason needed.",
 category: "handwritten",
 message: "Just thinking of you today. That's the whole message.",
 tone: "blue",
 icon: "Hand",
 },
 {
 id: "thank-you",
 title: "Thank-you",
 blurb: "Real gratitude.",
 category: "handwritten",
 message: "Thank you. Truly. You showed up when it counted and I haven't forgotten.",
 tone: "gold",
 icon: "Heart",
 },
 {
 id: "new-friend",
 title: "New friend follow-up",
 blurb: "After meeting in person.",
 category: "handwritten",
 message: "It was great meeting you. Let's keep this going. coffee next week?",
 tone: "red",
 icon: "Sparkles",
 },
 {
 id: "reconnect",
 title: "Reconnect",
 blurb: "After a long pause.",
 category: "handwritten",
 message: "It's been a while. I've been thinking of you. No agenda. just hello.",
 tone: "sage",
 icon: "Clock",
 },
 {
 id: "date",
 title: "Date invite",
 blurb: "Your move.",
 category: "handwritten",
 message: "Had a great time meeting you. Want to grab coffee next week?",
 tone: "red",
 icon: "HeartHandshake",
 },
 {
 id: "ai-art",
 title: "Imagined postcard",
 blurb: "An art piece for them.",
 category: "custom",
 message: "An imagined scene, made just for you. Hang it on the fridge.",
 photoPrompt: "An AI-imagined illustration",
 tone: "night",
 icon: "Palette",
 special: "ai-photo",
 },
 {
 id: "void",
 title: "Into the void",
 blurb: "A stranger gets it.",
 category: "handwritten",
 message: "I don't know you, but I hope this finds you on a good day. Write back if you want.",
 tone: "night",
 icon: "Send",
 special: "random-recipient",
 },
];

export const VOID_REPLY_AUTHORS = [
 { from: "A stranger in Lisbon", message: "Got your card. It made my Tuesday. Here's mine in return." },
 { from: "Someone in Reykjavík", message: "Hi back. The light here is strange today and I thought of you." },
 { from: "A friend you haven't met", message: "I read your note three times. Thank you for the kindness." },
 { from: "Across the ocean", message: "Mail from a stranger felt like a small miracle. Sending one back." },
 { from: "Mailroom friend", message: "Yours arrived just when I needed it. I hope this finds you the same way." },
];
