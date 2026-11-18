import { z } from "zod";
import type { FactFields, FactStage, FactVersion } from "./contracts.ts";

export const emptyFields: FactFields = {
  category: "positioning", title: "", claim: "", sourceType: "material", sourceReference: "",
  sourceLocator: "", sourceExcerpt: "", sourceDate: "", permission: "unknown", validity: "unspecified",
  validThrough: "", pasteId: null, pasteSpan: null,
};

export function previewPaste(original: string, limit = 30) {
  const segments = [];
  let count = 0;
  for (const match of original.matchAll(/[^\r\n]+/g)) {
    const line = match[0];
    const text = line.trim();
    if (!text) continue;
    count++;
    if (segments.length >= limit) continue;
    const start = match.index + line.length - line.trimStart().length;
    segments.push({ text, start, end: start + text.length });
  }
  return { segments, more: count > segments.length };
}

const sourceUrl = z.url({ protocol: /^https?$/ }).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password;
});

export function factGaps(fields: FactFields, today: string) {
  const gaps: ("claimMissing" | "sourceMissing" | "permissionMissing" | "validityMissing")[] = [];
  if (!fields.title || !fields.claim) gaps.push("claimMissing");
  if (!fields.sourceReference || !fields.sourceLocator || !fields.sourceExcerpt ||
      !fields.sourceDate || fields.sourceDate > today ||
      (fields.sourceType === "url" && !sourceUrl.safeParse(fields.sourceReference).success)) gaps.push("sourceMissing");
  if (fields.permission !== "public") gaps.push("permissionMissing");
  if (fields.validity === "unspecified" ||
      (fields.validity === "dated" && (!fields.validThrough || fields.validThrough < today))) gaps.push("validityMissing");
  return gaps;
}

export function factStatus(fact: FactVersion, today: string) {
  return fact.state === "approved" && fact.fields.validity === "dated" && fact.fields.validThrough < today
    ? "expired" as const : fact.state;
}

export function reviewDue(fact: FactVersion) {
  if (!fact.confirmedAt) return null;
  const days = fact.fields.category === "price" ? 30 : fact.fields.validity === "longTerm" ? 180 : 0;
  return days ? new Date(Date.parse(fact.confirmedAt) + days * 86_400_000).toISOString() : null;
}

export function dependencyEffect(stage: FactStage, usable: boolean) {
  if (stage === "history") return "historical" as const;
  if (usable) return "valid" as const;
  return stage === "published" ? "needsMaintenance" as const : "invalid" as const;
}
