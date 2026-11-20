export type Mention = { answerId: string; brandId: string };

/** Each brand counts at most once per answer. Share uses the fixed set and the visible denominator. */
export function mentionShare(mentions: readonly Mention[], competitors: readonly string[]) {
  const allowed = new Set(competitors);
  const byBrand = new Map<string, Set<string>>();
  const answers = new Set<string>();
  for (const mention of mentions) {
    if (!allowed.has(mention.brandId)) continue;
    answers.add(mention.answerId);
    const seen = byBrand.get(mention.brandId) ?? new Set<string>();
    seen.add(mention.answerId);
    byBrand.set(mention.brandId, seen);
  }
  const denominator = answers.size;
  return competitors.map((brandId) => {
    const count = byBrand.get(brandId)?.size ?? 0;
    return {
      brandId,
      count,
      denominator,
      share: denominator === 0 ? null : count / denominator,
    };
  });
}

export function rankDistribution(input: { ordered: boolean; positions: readonly number[] }) {
  if (!input.ordered) return { ranked: false as const, positions: [] as number[] };
  return { ranked: true as const, positions: [...input.positions] };
}

/** A competitor-set change starts a new segment. Versions are not pooled. */
export function shareBySetVersion(
  mentions: readonly (Mention & { setVersion: number })[],
  competitors: readonly string[],
) {
  const versions = [...new Set(mentions.map((mention) => mention.setVersion))].sort((left, right) => left - right);
  return versions.map((setVersion) => ({
    setVersion,
    rows: mentionShare(mentions.filter((mention) => mention.setVersion === setVersion), competitors),
  }));
}

/** Absent brands are left out of the mean. An unordered list has no rank at all. */
export function conditionalMeanPosition(input: {
  ordered: boolean;
  ranked: readonly { brandId: string; position: number }[];
  absentBrandIds: readonly string[];
}) {
  if (!input.ordered) return { ranked: false as const, mean: null, excludedAbsent: [...input.absentBrandIds] };
  if (input.ranked.length === 0) return { ranked: true as const, mean: null, excludedAbsent: [...input.absentBrandIds] };
  const mean = input.ranked.reduce((sum, item) => sum + item.position, 0) / input.ranked.length;
  return { ranked: true as const, mean, excludedAbsent: [...input.absentBrandIds] };
}
