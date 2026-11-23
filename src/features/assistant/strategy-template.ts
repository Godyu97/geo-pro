import { saveStrategy } from "./weekly-plan.ts";

export const evidenceStrengths = ["single_observation", "repeated_observation", "insufficient"] as const;
export type EvidenceStrength = (typeof evidenceStrengths)[number];

const guaranteeSentence = /高胜率|必有效|guaranteed\s+improvement/i;

export function evidenceStrengthAllowed(successes: number, strength: EvidenceStrength) {
  if (successes >= 2) return strength === "single_observation" || strength === "repeated_observation";
  if (successes === 1) return strength === "single_observation";
  return strength === "insufficient";
}

/** Drop sentences that promise a return. The remaining text is the only note that can be stored. */
export function stripGuaranteeSentences(text: string) {
  const pieces = text.split(/(?<=[。！？.!?])/u);
  return pieces
    .filter((part) => {
      const sentence = part.trim();
      return sentence.length > 0 && !guaranteeSentence.test(sentence);
    })
    .join("")
    .trim();
}

export function observationMarker(successes: number) {
  const strategy = saveStrategy({ successes });
  return strategy.label === "observation" && strategy.guaranteed === false
    ? { label: "observation" as const, guaranteed: 0 as const }
    : null;
}
