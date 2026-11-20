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
