import type { CardCategory } from "@/src/types/mail";

// MVP: every postcard costs 1 credit. The category map is kept for backwards
// compatibility with database rows and tests — the only category sent from the
// app is "photo" (a photo on the front + a handwritten-style message on the
// back). Other categories (handwritten/place/custom) are dormant.
export const CARD_COSTS: Record<CardCategory, number> = {
  handwritten: 1,
  photo: 1,
  place: 1,
  custom: 1,
};

// Starter balance for new accounts. Quiet gift — not framed as a
// time-limited "welcome offer" or a behavioral reward. Just what you
// have, like a fresh notebook. 3 is enough to feel like a real gift
// and gets the user to the second send (which converts into a pack).
export const FREE_CREDITS = 3;

export type CreditPack = {
  id: string;
  credits: number;
  priceUsd: number;
  /** True for the headline pack — the UI gives it a "Less than a stamp"
   *  badge and uses it as the visual anchor of the buy sheet. */
  featured?: boolean;
};

// Two packs, two decisions. Each credit buys one "stamp" — one printed,
// addressed, USPS-mailed postcard. The matrix is intentionally tight:
//
//   5 stamps  ·  $5   ·  $1.00/stamp  (entry — pay the convenience markup)
//   25 stamps ·  $20  ·  $0.80/stamp  (HEADLINE — cheaper than a real stamp)
//
// We dropped the 10-pack (same per-stamp price as the 5, no reason to exist)
// and the 50-pack (slightly better per-stamp but the leap from $20 → $35 was
// hurting conversion on the only pack that delivers the brand promise).
// Two-option choice architecture: try it small, or commit to the better deal.
export const CREDIT_PACKS: CreditPack[] = [
  { id: "p5", credits: 5, priceUsd: 5 },
  { id: "p25", credits: 25, priceUsd: 20, featured: true },
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
  place: "A postcard from somewhere — greetings-from style.",
  custom: "You describe it, we craft it with a designer.",
};

export function creditCostFor(category: CardCategory): number {
  return CARD_COSTS[category];
}

// Cost of a single MVP postcard.
export const CARD_COST_PHOTO = 1;
