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

// Starter balance for new accounts. v0.7.0.29: dropped from 3 → 1
// per founder direction. One free card is enough to validate the
// product feel (send your first, see it arrive, share the unboxing
// moment) without giving away enough value that users never convert.
// The second send becomes a stamp purchase, which is the actual
// product feedback loop. Three was too generous. half the users
// never bought a pack.
export const FREE_CREDITS = 1;

export type CreditPack = {
 id: string;
 credits: number;
 priceUsd: number;
 /** True for the headline pack. the UI uses it as the visual anchor
 * of the buy sheet with a "For the regulars" feature line. */
 featured?: boolean;
};

// Three packs, premium positioning ("A magical mail club", not a utility).
// Repriced 2026-05-27 per founder. Must stay in sync with server-side
// SERVER_PACKS (create-payment-intent) + PACKS (sms-buy-checkout).
//
// 4 cards · $5 · $1.25/card (entry)
// 10 cards · $10 · $1.00/card ("ten for ten" clean beat)
// 30 cards · $25 · $0.83/card (HEADLINE. for the regulars)
//
// IDs match the dollar amounts (p5, p10, p25). Retired old p50 and the
// old $20/25 mapping of p25. The "less than a stamp" framing is gone .
// Mailroom is a premium community of magic, not the cheapest stamp.
export const CREDIT_PACKS: CreditPack[] = [
 { id: "p5", credits: 4, priceUsd: 5 },
 { id: "p10", credits: 10, priceUsd: 10 },
 { id: "p25", credits: 30, priceUsd: 25, featured: true },
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
