export type Mention = { answerId: string; brandId: string };
export type MentionState = "true" | "false" | "unknown";

export type CompetitorMentionInput = {
  observationId: string;
  questionId: string | null;
  questionText?: string | null;
  brandId: string;
  mentionState: MentionState;
};

export type CompetitorShareRow = {
  brandId: string;
  equalWeightShare: number | null;
  equalWeightQuestions: number;
  coveredQuestions: number;
  pooledCount: number;
  pooledDenominator: number;
  pooledShare: number | null;
};

export type QuestionCompetitorShare = {
  questionId: string;
  questionText: string | null;
  status: "ready" | "zero_mentions" | "excluded";
  answerCount: number;
  excludedAnswerCount: number;
  totalMentions: number;
  brands: Array<{
    brandId: string;
    count: number;
    denominator: number;
    share: number | null;
  }>;
};

export type MissingQuestionAnswer = {
  observationId: string;
  questionText: string | null;
  mentionedBrands: string[];
};

export type ExcludedCompetitorAnswer = {
  observationId: string;
  questionId: string | null;
  questionText: string | null;
  unknownBrands: string[];
};

export type CompetitorShareBreakdown = {
  rows: CompetitorShareRow[];
  questions: QuestionCompetitorShare[];
  missingQuestionAnswers: MissingQuestionAnswer[];
  excludedAnswers: ExcludedCompetitorAnswer[];
  summary: {
    equalWeightQuestions: number;
    coveredQuestions: number;
    zeroMentionQuestions: number;
    excludedQuestions: number;
    commonAnswerCount: number;
    excludedAnswerCount: number;
    missingQuestionAnswerCount: number;
    pooledDenominator: number;
  };
};

function mergeMentionState(existing: MentionState | undefined, incoming: MentionState): MentionState {
  if (existing === "unknown" || incoming === "unknown") return "unknown";
  if (existing === "true" || incoming === "true") return "true";
  return "false";
}

/**
 * Computes both question-equal-weighted and pooled shares on the common judgable subset
 * (answers where no fixed-set member is unknown). Each brand counts at most once per answer.
 */
export function competitorShareBreakdown(
  competitors: readonly string[],
  mentions: readonly CompetitorMentionInput[],
): CompetitorShareBreakdown {
  if (competitors.length === 0) {
    return {
      rows: [],
      questions: [],
      missingQuestionAnswers: [],
      excludedAnswers: [],
      summary: {
        equalWeightQuestions: 0,
        coveredQuestions: 0,
        zeroMentionQuestions: 0,
        excludedQuestions: 0,
        commonAnswerCount: 0,
        excludedAnswerCount: 0,
        missingQuestionAnswerCount: 0,
        pooledDenominator: 0,
      },
    };
  }

  const allowed = new Set(competitors);
  const byObservation = new Map<string, {
    observationId: string;
    questionId: string | null;
    questionText: string | null;
    states: Map<string, MentionState>;
  }>();

  for (const mention of mentions) {
    if (!allowed.has(mention.brandId)) continue;
    let entry = byObservation.get(mention.observationId);
    if (!entry) {
      entry = {
        observationId: mention.observationId,
        questionId: mention.questionId ?? null,
        questionText: mention.questionText ?? null,
        states: new Map<string, MentionState>(),
      };
      byObservation.set(mention.observationId, entry);
    } else {
      if (entry.questionId === null && mention.questionId !== null) entry.questionId = mention.questionId;
      if (!entry.questionText && mention.questionText) entry.questionText = mention.questionText;
    }
    entry.states.set(mention.brandId, mergeMentionState(entry.states.get(mention.brandId), mention.mentionState));
  }

  const pooledCounts = new Map<string, number>();
  const questionTextById = new Map<string, string | null>();
  const excludedCountByQuestion = new Map<string, number>();
  const questionBuckets = new Map<string, { answerCount: number; counts: Map<string, number> }>();
  const missingQuestionAnswers: MissingQuestionAnswer[] = [];
  const excludedAnswers: ExcludedCompetitorAnswer[] = [];
  let commonAnswerCount = 0;

  for (const obs of byObservation.values()) {
    if (obs.questionId !== null && !questionTextById.has(obs.questionId)) {
      questionTextById.set(obs.questionId, obs.questionText);
    }
    const unknownBrands = competitors.filter((brandId) => obs.states.get(brandId) === "unknown");
    if (unknownBrands.length > 0) {
      excludedAnswers.push({
        observationId: obs.observationId,
        questionId: obs.questionId,
        questionText: obs.questionText,
        unknownBrands,
      });
      if (obs.questionId !== null) {
        excludedCountByQuestion.set(obs.questionId, (excludedCountByQuestion.get(obs.questionId) ?? 0) + 1);
      }
      continue;
    }

    commonAnswerCount += 1;
    const mentionedBrands = competitors.filter((brandId) => obs.states.get(brandId) === "true");
    for (const brandId of mentionedBrands) {
      pooledCounts.set(brandId, (pooledCounts.get(brandId) ?? 0) + 1);
    }

    if (obs.questionId === null) {
      missingQuestionAnswers.push({
        observationId: obs.observationId,
        questionText: obs.questionText,
        mentionedBrands,
      });
      continue;
    }

    let bucket = questionBuckets.get(obs.questionId);
    if (!bucket) {
      bucket = { answerCount: 0, counts: new Map<string, number>() };
      questionBuckets.set(obs.questionId, bucket);
    }
    bucket.answerCount += 1;
    for (const brandId of mentionedBrands) {
      bucket.counts.set(brandId, (bucket.counts.get(brandId) ?? 0) + 1);
    }
  }

  const allQuestionIds = [...new Set([...questionBuckets.keys(), ...excludedCountByQuestion.keys()])]
    .sort((left, right) => left.localeCompare(right));

  const equalWeightSums = new Map<string, number>();
  const questions: QuestionCompetitorShare[] = [];
  let equalWeightQuestions = 0;
  let coveredQuestions = 0;
  let zeroMentionQuestions = 0;
  let excludedQuestions = 0;

  for (const questionId of allQuestionIds) {
    const bucket = questionBuckets.get(questionId);
    const excludedAnswerCount = excludedCountByQuestion.get(questionId) ?? 0;
    const questionText = questionTextById.get(questionId) ?? null;

    if (!bucket) {
      excludedQuestions += 1;
      questions.push({
        questionId,
        questionText,
        status: "excluded",
        answerCount: 0,
        excludedAnswerCount,
        totalMentions: 0,
        brands: competitors.map((brandId) => ({ brandId, count: 0, denominator: 0, share: null })),
      });
      continue;
    }

    coveredQuestions += 1;
    const totalMentions = competitors.reduce((sum, brandId) => sum + (bucket.counts.get(brandId) ?? 0), 0);
    if (totalMentions === 0) {
      zeroMentionQuestions += 1;
      questions.push({
        questionId,
        questionText,
        status: "zero_mentions",
        answerCount: bucket.answerCount,
        excludedAnswerCount,
        totalMentions: 0,
        brands: competitors.map((brandId) => ({ brandId, count: 0, denominator: 0, share: null })),
      });
      continue;
    }

    equalWeightQuestions += 1;
    const brands = competitors.map((brandId) => {
      const count = bucket.counts.get(brandId) ?? 0;
      const share = count / totalMentions;
      equalWeightSums.set(brandId, (equalWeightSums.get(brandId) ?? 0) + share);
      return { brandId, count, denominator: totalMentions, share };
    });

    questions.push({
      questionId,
      questionText,
      status: "ready",
      answerCount: bucket.answerCount,
      excludedAnswerCount,
      totalMentions,
      brands,
    });
  }

  const pooledDenominator = competitors.reduce((sum, brandId) => sum + (pooledCounts.get(brandId) ?? 0), 0);
  const rows: CompetitorShareRow[] = competitors.map((brandId) => {
    const pooledCount = pooledCounts.get(brandId) ?? 0;
    return {
      brandId,
      equalWeightShare: equalWeightQuestions === 0 ? null : (equalWeightSums.get(brandId) ?? 0) / equalWeightQuestions,
      equalWeightQuestions,
      coveredQuestions,
      pooledCount,
      pooledDenominator,
      pooledShare: pooledDenominator === 0 ? null : pooledCount / pooledDenominator,
    };
  });

  return {
    rows,
    questions,
    missingQuestionAnswers,
    excludedAnswers,
    summary: {
      equalWeightQuestions,
      coveredQuestions,
      zeroMentionQuestions,
      excludedQuestions,
      commonAnswerCount,
      excludedAnswerCount: excludedAnswers.length,
      missingQuestionAnswerCount: missingQuestionAnswers.length,
      pooledDenominator,
    },
  };
}

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

export type OrderedMentionInput = {
  observationId: string;
  questionId?: string | null;
  questionText?: string | null;
  brandId: string;
  mentionState: MentionState;
  ordered: 0 | 1;
  position: number | null;
};

export type OrderedRankRow = {
  brandId: string;
  judgableCount: number;
  appearedCount: number;
  firstPlaceCount: number;
  absentCount: number;
  unknownCount: number;
  appearanceRate: number | null;
  firstPlaceRate: number | null;
  conditionalMeanPosition: number | null;
};

export type OrderedObservationEntry = {
  observationId: string;
  questionId: string | null;
  questionText: string | null;
  brands: Array<{
    brandId: string;
    mentionState: MentionState;
    position: number | null;
  }>;
};

export type OrderedRankBreakdown = {
  ranked: boolean;
  orderedObservations: number;
  unorderedObservations: number;
  mean: number | null;
  excludedAbsent: string[];
  rows: OrderedRankRow[];
  observations: OrderedObservationEntry[];
};

/**
 * Computes appearance rate, first-place rate, and conditional mean position
 * on explicitly ordered observations only. Unordered observations are excluded
 * regardless of answer text, and absent brands never enter the mean as 0 or tail.
 */
export function orderedRankBreakdown(
  competitors: readonly string[],
  mentions: readonly OrderedMentionInput[],
): OrderedRankBreakdown {
  if (competitors.length === 0) {
    return {
      ranked: false,
      orderedObservations: 0,
      unorderedObservations: 0,
      mean: null,
      excludedAbsent: [],
      rows: [],
      observations: [],
    };
  }

  const allowed = new Set(competitors);
  const byObservation = new Map<string, {
    observationId: string;
    questionId: string | null;
    questionText: string | null;
    anyOrdered: boolean;
    states: Map<string, { mentionState: MentionState; ordered: 0 | 1; position: number | null }>;
  }>();

  for (const mention of mentions) {
    if (!allowed.has(mention.brandId)) continue;
    let entry = byObservation.get(mention.observationId);
    if (!entry) {
      entry = {
        observationId: mention.observationId,
        questionId: mention.questionId ?? null,
        questionText: mention.questionText ?? null,
        anyOrdered: mention.ordered === 1,
        states: new Map(),
      };
      byObservation.set(mention.observationId, entry);
    } else {
      if (entry.questionId === null && mention.questionId !== null && mention.questionId !== undefined) {
        entry.questionId = mention.questionId;
      }
      if (!entry.questionText && mention.questionText) entry.questionText = mention.questionText;
      if (mention.ordered === 1) entry.anyOrdered = true;
    }

    const previous = entry.states.get(mention.brandId);
    if (!previous) {
      entry.states.set(mention.brandId, {
        mentionState: mention.mentionState,
        ordered: mention.ordered,
        position: mention.position,
      });
    } else {
      const mergedState = mergeMentionState(previous.mentionState, mention.mentionState);
      const mergedOrdered: 0 | 1 = previous.ordered === 1 || mention.ordered === 1 ? 1 : 0;
      const mergedPosition = mergedState === "true" && mergedOrdered === 1
        ? previous.position ?? mention.position
        : null;
      entry.states.set(mention.brandId, {
        mentionState: mergedState,
        ordered: mergedOrdered,
        position: mergedPosition,
      });
    }
  }

  const stats = new Map(competitors.map((brandId) => [brandId, {
    judgableCount: 0,
    appearedCount: 0,
    firstPlaceCount: 0,
    absentCount: 0,
    unknownCount: 0,
    positionSum: 0,
  }]));
  const observations: OrderedObservationEntry[] = [];
  const allPositions: number[] = [];
  let orderedObservations = 0;
  let unorderedObservations = 0;

  for (const obs of byObservation.values()) {
    if (!obs.anyOrdered) {
      unorderedObservations += 1;
      continue;
    }
    orderedObservations += 1;
    const brands: OrderedObservationEntry["brands"] = [];
    for (const brandId of competitors) {
      const bucket = stats.get(brandId)!;
      const record = obs.states.get(brandId);
      if (!record) {
        bucket.judgableCount += 1;
        bucket.absentCount += 1;
        brands.push({ brandId, mentionState: "false", position: null });
        continue;
      }
      if (record.mentionState === "unknown") {
        bucket.unknownCount += 1;
        brands.push({ brandId, mentionState: "unknown", position: null });
        continue;
      }
      if (record.mentionState === "true" && record.ordered === 1 && record.position !== null && record.position > 0) {
        bucket.judgableCount += 1;
        bucket.appearedCount += 1;
        bucket.positionSum += record.position;
        allPositions.push(record.position);
        if (record.position === 1) bucket.firstPlaceCount += 1;
        brands.push({ brandId, mentionState: "true", position: record.position });
        continue;
      }
      bucket.judgableCount += 1;
      bucket.absentCount += 1;
      brands.push({ brandId, mentionState: "false", position: null });
    }
    observations.push({
      observationId: obs.observationId,
      questionId: obs.questionId,
      questionText: obs.questionText,
      brands,
    });
  }

  const ranked = orderedObservations > 0;
  const rows: OrderedRankRow[] = competitors.map((brandId) => {
    const bucket = stats.get(brandId)!;
    return {
      brandId,
      judgableCount: bucket.judgableCount,
      appearedCount: bucket.appearedCount,
      firstPlaceCount: bucket.firstPlaceCount,
      absentCount: bucket.absentCount,
      unknownCount: bucket.unknownCount,
      appearanceRate: bucket.judgableCount === 0 ? null : bucket.appearedCount / bucket.judgableCount,
      firstPlaceRate: bucket.judgableCount === 0 ? null : bucket.firstPlaceCount / bucket.judgableCount,
      conditionalMeanPosition: bucket.appearedCount === 0 ? null : bucket.positionSum / bucket.appearedCount,
    };
  });

  const excludedAbsent = ranked
    ? rows.filter((row) => row.appearedCount === 0 && row.absentCount > 0).map((row) => row.brandId)
    : [...competitors];
  const mean = allPositions.length === 0
    ? null
    : allPositions.reduce((sum, pos) => sum + pos, 0) / allPositions.length;

  return {
    ranked,
    orderedObservations,
    unorderedObservations,
    mean,
    excludedAbsent,
    rows,
    observations,
  };
}
