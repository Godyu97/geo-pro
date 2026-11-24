import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { triStateSchema, type TriState } from "./contracts.ts";
import { overviewScopeQuery, type OverviewScope } from "./overview-contracts.ts";

const keywordSchema = z.string().max(500).refine((value) => value.isWellFormed() && !value.includes("\0"));

export const answerListFilterSchema = z.strictObject({
  q: keywordSchema.optional(),
  cluster: brandIdSchema.optional(),
  mentioned: triStateSchema.optional(),
  recommended: triStateSchema.optional(),
  officialSiteCited: triStateSchema.optional(),
});

export type AnswerListFilter = z.infer<typeof answerListFilterSchema>;

export type AnswerCluster = {
  id: string;
  audience: string;
  intent: string;
};

export type ClusterSource = {
  questions: ReadonlyArray<{ id: string; text: string; clusterId: string }>;
  clusters: ReadonlyArray<AnswerCluster>;
};

export type AnswerListMatch = {
  questionText: string;
  answerText: string;
  clusterId: string | null;
  mentioned: TriState;
  recommended: TriState;
  officialSiteCited: TriState;
};

const filterKeys = ["q", "cluster", "mentioned", "recommended", "officialSiteCited"] as const;

function searchValue(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function fold(value: string) {
  return value.toLocaleLowerCase("en-US");
}

export function answerListFiltersFromSearch(params: Record<string, string | string[] | undefined>) {
  const input: Record<string, string> = {};
  for (const key of filterKeys) {
    const value = searchValue(params, key);
    if (value !== undefined) input[key] = value;
  }
  return answerListFilterSchema.safeParse(input);
}

export function answerListFilterActive(filter: AnswerListFilter) {
  return Boolean(filter.q || filter.cluster || filter.mentioned || filter.recommended || filter.officialSiteCited);
}

export function filterAnswerList<T extends AnswerListMatch>(items: readonly T[], filter: AnswerListFilter) {
  const keyword = filter.q ? fold(filter.q) : "";
  return items.filter((item) => {
    if (keyword) {
      const inQuestion = fold(item.questionText).includes(keyword);
      const inAnswer = fold(item.answerText).includes(keyword);
      if (!inQuestion && !inAnswer) return false;
    }
    if (filter.cluster && item.clusterId !== filter.cluster) return false;
    if (filter.mentioned && item.mentioned !== filter.mentioned) return false;
    if (filter.recommended && item.recommended !== filter.recommended) return false;
    if (filter.officialSiteCited && item.officialSiteCited !== filter.officialSiteCited) return false;
    return true;
  });
}

export function clusterForAnswer(
  input: { questionText: string; questionId: string | null; promptSetId: string | null },
  linked: ReadonlyMap<string, ClusterSource>,
  latest: ClusterSource | null,
) {
  const source = input.promptSetId ? linked.get(input.promptSetId) ?? null : latest;
  if (!source) return null;
  const byId = input.questionId
    ? source.questions.find((question) => question.id === input.questionId)
    : undefined;
  const question = byId ?? source.questions.find((item) => item.text.trim() === input.questionText.trim());
  if (!question) return null;
  return source.clusters.find((cluster) => cluster.id === question.clusterId) ?? null;
}

export function clusterLabel(cluster: AnswerCluster, unnamed: string) {
  const parts = [cluster.audience, cluster.intent].map((part) => part.trim()).filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(" · ") : unnamed;
}

export function listClusters(clusters: Iterable<AnswerCluster>) {
  const byId = new Map<string, AnswerCluster>();
  for (const cluster of clusters) {
    if (!byId.has(cluster.id)) byId.set(cluster.id, cluster);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function clusterOptions(
  clusters: readonly AnswerCluster[],
  selected: string | undefined,
  unnamed: (index: number) => string,
) {
  const options = listClusters(clusters).map((cluster, index) => ({
    id: cluster.id,
    label: clusterLabel(cluster, unnamed(index + 1)),
  }));
  if (selected && !options.some((option) => option.id === selected)) {
    options.push({ id: selected, label: unnamed(options.length + 1) });
  }
  return options;
}

export function answerListPath(
  pathname: string,
  scope: Pick<OverviewScope, "brandId" | "sourceMode" | "region" | "requestedNetworkMode" | "from" | "to">,
  filter: AnswerListFilter,
) {
  const params = new URLSearchParams(overviewScopeQuery(scope));
  if (filter.q) params.set("q", filter.q);
  if (filter.cluster) params.set("cluster", filter.cluster);
  if (filter.mentioned) params.set("mentioned", filter.mentioned);
  if (filter.recommended) params.set("recommended", filter.recommended);
  if (filter.officialSiteCited) params.set("officialSiteCited", filter.officialSiteCited);
  return `${pathname}?${params.toString()}`;
}
