import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { FactDao } from "../brand-facts/dao.ts";
import { executeFactCommand } from "../brand-facts/service.ts";
import { PromptDao } from "../prompts/dao.ts";
import { executePromptCommand } from "../prompts/service.ts";
import { functionalMockMarker } from "./mode.ts";
import { mockFactFields, mockPromptContent } from "./materials.ts";

type Scope = { ownerId: string; brandId: string };

function failed(error: string) {
  return { ok: false as const, error };
}

/** Writes labeled facts and a frozen prompt set through the existing commands. */
export async function applyMockMaterials(db: DatabaseConnection, scope: Scope) {
  const facts = new FactDao(db, scope);
  const existingFacts = await facts.versions();
  let factId = existingFacts.find((item) => item.state === "approved" && item.fields.title.includes(functionalMockMarker))?.id ?? null;
  if (!factId) {
    const id = randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const created = await executeFactCommand(db, scope, {
      action: "create", id, previousId: null, fields: mockFactFields(today),
    });
    if ("error" in created) return failed(created.error);
    const submitted = await executeFactCommand(db, scope, { action: "submit", id, revision: 1 });
    if ("error" in submitted) return failed(submitted.error);
    const approved = await executeFactCommand(db, scope, {
      action: "approve", id, revision: 1, confirmed: true, conflictId: null, revokeConflict: false,
    });
    if ("error" in approved) return failed(approved.error);
    factId = id;
  }

  const prompts = new PromptDao(db, scope.brandId);
  const versions = await prompts.versions();
  const existingSet = versions.find((item) => item.content.questions.some((question) => question.text.includes(functionalMockMarker)));
  if (existingSet) return { ok: true as const, factId, promptSetId: existingSet.id, reused: true as const };

  const draft = await prompts.draft();
  const base = draft?.baseSetId ? await prompts.version(draft.baseSetId) : null;
  const setId = base?.setId ?? await prompts.familyId() ?? randomUUID();
  const frozen = await executePromptCommand(db, scope, {
    action: "freeze",
    id: randomUUID(),
    revision: draft?.revision ?? null,
    setId,
    baseSetId: draft?.baseSetId ?? null,
    content: mockPromptContent(),
  });
  if ("error" in frozen) return failed(frozen.error);
  return { ok: true as const, factId, promptSetId: frozen.id, reused: false as const };
}
