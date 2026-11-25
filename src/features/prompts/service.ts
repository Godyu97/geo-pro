import "server-only";

import { randomUUID } from "node:crypto";
import { BrandDao } from "../brands/dao.ts";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { promptCommand, promptScope, type DraftContent, type PromptCursor, type PromptScope } from "./contracts.ts";
import { PromptDao, pageSize } from "./dao.ts";
import {
  annotateDraft, budgetInput, changedQuestionIds, defaultCandidates, termList, validateDraft,
  type BriefGap, type BudgetInput, type PromptPreview, type PromptWarning,
} from "./rules.ts";

const clockNow = () => new Date();
const fail = <T extends string>(error: T) => ({ error });

type ReadQuery = { version?: string; after?: PromptCursor };

export async function readPromptWorkspace(db: QueryConnection, scope: PromptScope, query: ReadQuery) {
  const brand = await new BrandDao(db).version(scope.ownerId, scope.brandId);
  if (!brand) return null;
  const dao = new PromptDao(db, scope.brandId);
  const [draft, versions, selected, referenced, family, suggestions] = await Promise.all([
    dao.draft(),
    dao.versions(query.after),
    query.version ? dao.version(query.version) : Promise.resolve(null),
    dao.referencedIds(),
    dao.familyId(),
    dao.suggestions(scope.ownerId),
  ]);
  if (query.version && !selected) return null;
  const base = draft?.baseSetId ? await dao.version(draft.baseSetId) : null;
  const previous = selected ? await dao.versionNumber(selected.setId, selected.version - 1) : null;
  const terms = termList(brand.fields);
  const editor = draft?.content ?? seedContent(brand.fields);
  const annotated = annotateDraft(editor, terms);
  const fallback = { region: brand.fields.region, language: brand.fields.language };
  const selectedExclusion = selected ? changedQuestionIds(previous?.content.questions ?? [], selected.content.questions) : [];
  const draftExclusion = base ? changedQuestionIds(base.content.questions, editor.questions) : [];
    const last = versions[pageSize - 1];
    return {
    brandName: brand.fields.name,
    readOnly: brand.status !== "active",
    brand: fallback,
    terms,
    onboarding: brand.fields.questions.filter((text) => !editor.questions.some((question) => question.text === text)),
    candidates: defaultCandidates(brand.fields.language),
    draft: draft ? { revision: draft.revision, baseSetId: draft.baseSetId, updatedAt: draft.updatedAt } : null,
    editor,
    warnings: annotated.warnings,
    preview: annotated.preview,
    exclusion: draftExclusion,
    gaps: briefFrom(editor),
    referenced,
    suggestions,
    familyId: family,
    versions: {
      items: versions.slice(0, pageSize).map((item) => ({
        id: item.id, version: item.version, createdAt: item.createdAt,
        saved: item.content.questions.filter((question) => question.status !== "inactive").length,
        primary: item.content.questions.filter((question) => question.primary).length,
      })),
      next: versions.length > pageSize && last ? { id: last.id, at: last.createdAt } : null,
    },
    selected: selected && {
      id: selected.id, setId: selected.setId, version: selected.version, createdAt: selected.createdAt,
      region: selected.region, language: selected.language, content: selected.content,
      exclusion: selectedExclusion,
      budget: budgetInput(selected.content.questions, { region: selected.region, language: selected.language }),
    },
    budget: budgetInput(annotated.questions, fallback),
  };
}

function briefFrom(content: DraftContent): BriefGap[] {
  return content.clusters.flatMap((cluster) => {
    const used = content.questions.some((question) => question.clusterId === cluster.id && question.status !== "inactive");
    if (!used) return [];
    const missing = [
      ...(!cluster.primaryPage ? ["primaryPage" as const] : []),
      ...(!cluster.conversionAction ? ["conversionAction" as const] : []),
    ];
    return missing.length ? [{ clusterId: cluster.id, missing }] : [];
  });
}

function seedContent(fields: { region: string; language: string; questions: string[] }): DraftContent {
  const clusterId = randomUUID();
  return {
    clusters: [{ id: clusterId, audience: "", intent: "", primaryPage: "", conversionAction: "" }],
    questions: fields.questions.filter((text) => Array.from(text).length >= 5).slice(0, 10).map((text) => ({
      id: randomUUID(), clusterId, text, source: "manual" as const, sourceNote: "onboarding-draft",
      type: "discovery" as const, stage: "consider" as const, region: fields.region, language: fields.language,
      status: "candidate" as const, acceptSimilar: false, primary: false,
    })),
  };
}

async function writeDraft(
  dao: PromptDao, expected: number | null, expectedBase: string | null, nextBase: string | null, content: DraftContent, now: string,
) {
  const current = await dao.draft();
  if (expected === null) {
    if (current) return fail("conflict");
    await dao.insertDraft(1, nextBase, content, now);
    return { revision: 1 };
  }
  if (!current || current.revision !== expected || current.baseSetId !== expectedBase) return fail("conflict");
  const revision = expected + 1;
  if (!await dao.updateDraft(expected, revision, nextBase, content, now)) throw new Error("prompt draft revision changed");
  return { revision };
}

export async function executePromptCommand(db: DatabaseConnection, inputScope: unknown, input: unknown, clock = clockNow) {
  const scope = promptScope.parse(inputScope);
  const command = promptCommand.safeParse(input);
  if (!command.success) return fail("invalidInput");
  const operation = command.data;
  return db.transaction(async (transaction) => {
    const brands = new BrandDao(transaction);
    if (!await brands.lockOwner(scope.ownerId)) return fail("notFound");
    const brand = await brands.version(scope.ownerId, scope.brandId);
    if (!brand) return fail("notFound");
    if (brand.status !== "active") return fail("readOnly");
    const dao = new PromptDao(transaction, scope.brandId);
    const now = clock().toISOString();
    if (operation.action === "reference") {
      const selected = await dao.version(operation.setVersionId);
      if (!selected) return fail("notFound");
      const questionIds = selected.content.questions.filter((question) => question.status === "confirmed").map((question) => question.id);
      await dao.reference(selected.id, questionIds, operation.consumerId);
      return { id: selected.id, questionIds };
    }

    const referenced = await dao.referencedIds();
    const validated = validateDraft(operation.content, termList(brand.fields), referenced, operation.action === "freeze" ? "freeze" : "save");
    if ("error" in validated) return validated;
    const base = operation.baseSetId ? await dao.version(operation.baseSetId) : null;
    if (operation.baseSetId && !base) return fail("notFound");
    if (operation.action === "saveDraft") {
      const saved = await writeDraft(dao, operation.revision, operation.baseSetId, operation.baseSetId, validated.content, now);
      if ("error" in saved) return saved;
      return {
        ...saved, content: validated.content, warnings: validated.warnings, preview: validated.preview, gaps: validated.gaps,
        exclusion: base ? changedQuestionIds(base.content.questions, validated.content.questions) : [],
      };
    }

    const family = await dao.familyId();
    if ((family && family !== operation.setId) || (base && base.setId !== operation.setId)) return fail("conflict");
    const version = base ? base.version + 1 : 1;
    const existing = await dao.version(operation.id);
    const region = validated.content.questions.find((question) => question.status === "confirmed")?.region ?? brand.fields.region;
    const language = validated.content.questions.find((question) => question.status === "confirmed")?.language ?? brand.fields.language;
    const same = !!existing && existing.setId === operation.setId && existing.version === version &&
      JSON.stringify(existing.content) === JSON.stringify(validated.content);
    if (existing && !same) return fail("conflict");
    const exclusion = changedQuestionIds(base?.content.questions ?? [], validated.content.questions);
    const payload = {
      content: validated.content, warnings: validated.warnings, preview: validated.preview, gaps: validated.gaps, exclusion,
      budget: budgetInput(validated.content.questions, { region, language }),
    };
    if (same) {
      const current = await dao.draft();
      if (!current || current.baseSetId !== operation.id || JSON.stringify(current.content) !== JSON.stringify(validated.content)) return fail("conflict");
      return { id: operation.id, version, revision: current.revision, ...payload };
    }
    const current = await dao.draft();
    if (operation.revision === null ? current !== null : !current || current.revision !== operation.revision || current.baseSetId !== operation.baseSetId) {
      return fail("conflict");
    }
    await dao.insertSet({
      id: operation.id, setId: operation.setId, version, entityVersion: brand.entityVersion,
      region, language, content: validated.content, createdAt: now,
    });
    const saved = await writeDraft(dao, operation.revision, operation.baseSetId, operation.id, validated.content, now);
    if ("error" in saved) throw new Error("prompt draft was not saved with the frozen version");
    return { id: operation.id, version, ...saved, ...payload };
  });
}

export function promptUnavailable() {
  const traceId = randomUUID();
  console.error("prompt-sets-unavailable", { traceId });
  return { error: "unavailable" as const, traceId };
}

export type PromptWorkspace = NonNullable<Awaited<ReturnType<typeof readPromptWorkspace>>>;
export type PromptWarningCode = PromptWarning["code"];
export type { PromptPreview, BudgetInput };
