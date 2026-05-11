import type { CardCategory } from "@/src/types/mail";

export const CARD_COSTS: Record<CardCategory, number> = {
  handwritten: 1,
  photo: 2,
  place: 2,
  custom: 5,
};

export const FREE_CREDITS = 5;

export type CreditPack = { id: string; credits: number; priceUsd: number };

export const CREDIT_PACKS: CreditPack[] = [
  { id: "p5", credits: 5, priceUsd: 5 },
  { id: "p10", credits: 10, priceUsd: 10 },
  { id: "p25", credits: 25, priceUsd: 25 },
  { id: "p50", credits: 50, priceUsd: 50 },
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
