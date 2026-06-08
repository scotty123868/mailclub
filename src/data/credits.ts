import type { CardCategory } from "@/src/types/mail";

// MVP: every postcard costs 1 credit. The category map is kept for backwards
// compatibility with database rows and tests. the only category sent from the
// app is "photo" (a photo on the front + a handwritten-style message on the
// back). Other categories (handwritten/place/custom) are dormant.
export const CARD_COSTS: Record<CardCategory, number> = {
 handwritten: 1,
 photo: 1,
 place: 1,
 custom: 1,
};

// Starter balance for new accounts. 2026-06-08: dropped to 0 for launch —
// no free first card. Selling convenience, not free; the first send routes
// through a pack purchase (3 for $5).
export const FREE_CREDITS = 0;

export type CreditPack = {
 id: string;
 credits: number;
 priceUsd: number;
 /** True for the headline pack. the UI uses it as the visual anchor
 * of the buy sheet with a "For the regulars" feature line. */
 featured?: boolean;
};

// Three packs, premium positioning ("A magical mail club", not a utility).
// LAUNCH PRICING 2026-06-08 (no free first card). Must stay in sync with
// server-side SERVER_PACKS (create-payment-intent) + PACKS (sms-buy-checkout).
//
// 3 cards · $5 · $1.67/card (entry)
// 8 cards · $10 · $1.25/card (the middle pick)
// 25 cards · $25 · $1.00/card (HEADLINE. for the regulars)
//
// IDs match the dollar amounts (p5, p10, p25).
export const CREDIT_PACKS: CreditPack[] = [
 { id: "p5", credits: 3, priceUsd: 5 },
 { id: "p10", credits: 8, priceUsd: 10 },
 { id: "p25", credits: 25, priceUsd: 25, featured: true },
];

export const CATEGORY_LABELS: Record<CardCategory, string> = {
 handwritten: "Handwritten note",
 photo: "Photo postcard",
 place: "Place postcard",
 custom: "Custom art card",
};

export const CATEGORY_BLURBS: Record<CardCategory, string> = {
 handwritten: "Your words, printed in handwriting.",
 photo: "A photo + a short note on a postcard.",
 place: "A postcard from somewhere. greetings-from style.",
 custom: "You describe it, we craft it with a designer.",
};

export function creditCostFor(category: CardCategory): number {
 return CARD_COSTS[category];
}

// Cost of a single MVP postcard.
export const CARD_COST_PHOTO = 1;
