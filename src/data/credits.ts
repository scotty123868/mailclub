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

// Starter balance for new accounts. v0.7.0.29: dropped from 3 → 1
// per founder direction. One free card is enough to validate the
// product feel (send your first, see it arrive, share the unboxing
// moment) without giving away enough value that users never convert.
// The second send becomes a stamp purchase, which is the actual
// product feedback loop. Three was too generous — half the users
// never bought a pack.
export const FREE_CREDITS = 1;

export type CreditPack = {
  id: string;
  credits: number;
  priceUsd: number;
  /** True for the headline pack — the UI gives it a "Less than a stamp"
   *  badge and uses it as the visual anchor of the buy sheet. */
  featured?: boolean;
};

// Three packs, three decisions. Each credit buys one "stamp" — one
// printed, addressed, USPS-mailed postcard. v0.7.0.27 pricing matrix
// per founder:
//
//   5 stamps  ·  $5   ·  $1.00/stamp  (entry — pay the convenience markup)
//   25 stamps ·  $20  ·  $0.80/stamp  (HEADLINE — cheaper than a 82¢ USPS stamp)
//   50 stamps ·  $35  ·  $0.70/stamp  (best per-stamp price for power users)
//
// The 50-pack is back. Earlier comment claimed the $20 → $35 leap hurt
// conversion, but the founder restored it for users who want bulk —
// the per-stamp savings vs. the 25-pack is real (70¢ vs 80¢, a 12.5%
// discount), and even committed senders run through 25 stamps faster
// than expected. Headline stays on the 25-pack: $0.80 reads as a
// recognizable "cheaper than a stamp" hook without the $35 commitment.
export const CREDIT_PACKS: CreditPack[] = [
  { id: "p5", credits: 5, priceUsd: 5 },
  { id: "p25", credits: 25, priceUsd: 20, featured: true },
  { id: "p50", credits: 50, priceUsd: 35 },
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
