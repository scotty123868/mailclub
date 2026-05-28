import { OCCASIONS, type Occasion } from "@/src/data/occasions";
import type { CardCategory } from "@/src/types/mail";

export type ImaginedCard = {
 occasionId: Occasion["id"];
 category: CardCategory;
 message: string;
 photoPrompt?: string;
 rationale: string;
};

const KEYWORDS: { match: RegExp; occasionId: Occasion["id"]; refineMessage?: (prompt: string) => string }[] = [
 {
 match: /\b(birthday|bday|b-day|turning \d+|cake)\b/i,
 occasionId: "birthday",
 refineMessage: (p) => {
 const name = matchName(p);
 if (name) return `Happy birthday, ${name}. I'm so glad you're in my life.`;
 return "Happy birthday. I'm so glad you're in my life.";
 },
 },
 {
 match: /\b(thank|thanks|grateful|gratitude|appreciate)\b/i,
 occasionId: "thank-you",
 },
 {
 match: /\b(party|gathering|invite to|invitation|housewarming)\b/i,
 occasionId: "party",
 },
 {
 match: /\b(travel|trip|vacation|holiday|abroad|on the road|wish you were)\b/i,
 occasionId: "travel",
 },
 {
 match: /\b(memory|remember when|shared|old photo|that time)\b/i,
 occasionId: "memory",
 },
 {
 match: /\b(miss(?:ing|ed)?|haven'?t talked|haven'?t seen|long time|catch up|reconnect)\b/i,
 occasionId: "reconnect",
 },
 {
 match: /\b(ask out|date invite|grab a coffee|get a drink|coffee next week)\b/i,
 occasionId: "date",
 },
 {
 match: /\b(just met|new friend|stay in touch|nice meeting|met (?:them|him|her))\b/i,
 occasionId: "new-friend",
 },
 {
 match: /\b(stranger|random|void|anonymous|whoever)\b/i,
 occasionId: "void",
 },
 {
 match: /\b(art|illustration|painting|imagined|ai|generated)\b/i,
 occasionId: "ai-art",
 },
 {
 match: /\b(hi|hello|hey|just saying)\b/i,
 occasionId: "saying-hi",
 },
];

const RELATION_WORDS = "(mom|mum|mother|dad|father|sister|brother|grandma|grandpa|grandmother|grandfather|aunt|uncle|husband|wife|partner|boyfriend|girlfriend|friend|niece|nephew)";

function matchName(prompt: string): string | null {
 const rel = prompt.match(new RegExp(`\\b(?:to|for|with)\\s+(?:my\\s+)?${RELATION_WORDS}\\b`, "i"));
 if (rel) {
 const w = rel[1].toLowerCase();
 return w.charAt(0).toUpperCase() + w.slice(1);
 }
 const name = prompt.match(/\b(?:to|for)\s+([A-Z][a-z]+)\b/);
 if (name) return name[1];
 return null;
}

export function imagineCard(prompt: string): ImaginedCard {
 const trimmed = prompt.trim();

 if (!trimmed) {
 const fallback = OCCASIONS.find((o) => o.id === "just-note")!;
 return {
 occasionId: fallback.id,
 category: fallback.category,
 message: fallback.message,
 rationale: "Started you with a simple note. Tell me more for something specific.",
 };
 }

 for (const rule of KEYWORDS) {
 if (rule.match.test(trimmed)) {
 const occ = OCCASIONS.find((o) => o.id === rule.occasionId)!;
 const message = rule.refineMessage ? rule.refineMessage(trimmed) : occ.message;
 return {
 occasionId: occ.id,
 category: occ.category,
 message,
 photoPrompt: occ.photoPrompt,
 rationale: `Imagined a ${occ.title.toLowerCase()} from "${trimmed.slice(0, 38)}${trimmed.length > 38 ? "…" : ""}".`,
 };
 }
 }

 const friendly = OCCASIONS.find((o) => o.id === "just-note")!;
 return {
 occasionId: friendly.id,
 category: friendly.category,
 message: `Thinking of you. ${trimmed.charAt(0).toUpperCase() + trimmed.slice(1)}. that's what came to mind.`,
 rationale: "Couldn't peg the occasion, so I made a warm note.",
 };
}
