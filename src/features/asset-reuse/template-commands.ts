import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, QueryConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { brandOwnedBy } from "./dao.ts";
import { cloneTemplate, templateAllowsInvention } from "./rules.ts";
import type {
  CloneContentTemplateInput,
  ExportContentTemplateInput,
  TemplateClone,
  TemplateExport,
  TemplateList,
  TemplateUpdate,
  TemplateView,
  UpdateContentTemplateInput,
} from "./template-contracts.ts";
import {
  insertContentTemplateClone,
  listBrandTemplates,
  listSystemTemplates,
  loadContentTemplate,
  updateOwnedContentTemplate,
  type ContentTemplateRow,
  type LoadedContentTemplate,
} from "./template-dao.ts";

function clock() {
  return new Date().toISOString();
}

function toView(row: ContentTemplateRow): TemplateView {
  return {
    id: row.id,
    name: row.name,
    system: row.system === 1,
    status: row.status,
    asksToInventCaseStudy: row.asksToInventCaseStudy === 1,
    gates: {
      fact: row.factGate === 1,
      publicLicense: row.publicLicenseGate === 1,
      review: row.reviewGate === 1,
    },
    sourceTemplateId: row.sourceTemplateId,
    readOnly: row.system === 1,
  };
}

function visible(row: LoadedContentTemplate, actorId: string, brandId: string) {
  if (row.system === 1) return true;
  return row.ownerId === actorId && row.brandId === brandId;
}

async function ownedBrand(db: QueryConnection, actorId: string, brandId: string) {
  const brand = await brandOwnedBy(db, actorId, brandId);
  if (!brand || brand.status !== "active" || brand.frozenAt) return null;
  return brand;
}

export async function listContentTemplates(db: QueryConnection, actorId: string, brandId: string): Promise<TemplateList> {
  if (!await ownedBrand(db, actorId, brandId)) return { error: "NOT_FOUND" };
  const [systemRows, ownRows] = await Promise.all([
    listSystemTemplates(db),
    listBrandTemplates(db, actorId, brandId),
  ]);
  return { templates: [...systemRows, ...ownRows].map(toView) };
}

export async function cloneContentTemplate(
  db: DatabaseConnection,
  actorId: string,
  input: CloneContentTemplateInput,
  now = clock(),
): Promise<TemplateClone> {
  return db.transaction(async (tx) => {
    if (!await new BrandDao(tx).lockOwner(actorId)) return { error: "NOT_FOUND" };
    if (!await ownedBrand(tx, actorId, input.brandId)) return { error: "NOT_FOUND" };
    const source = await loadContentTemplate(tx, input.id);
    if (!source || !visible(source, actorId, input.brandId)) return { error: "NOT_FOUND" };
    const decision = cloneTemplate({
      system: source.system === 1,
      gates: {
        fact: input.gates.fact && source.factGate === 1,
        publicLicense: input.gates.publicLicense && source.publicLicenseGate === 1,
        review: input.gates.review && source.reviewGate === 1,
      },
    });
    if (!decision.cloned) return { error: "GATE_REQUIRED", reason: decision.reason };
    const inserted = await insertContentTemplateClone(tx, {
      id: randomUUID(),
      brandId: input.brandId,
      ownerId: actorId,
      sourceTemplateId: source.id,
      asksToInventCaseStudy: source.asksToInventCaseStudy,
      name: input.name ?? source.name,
      createdAt: now,
    });
    return { template: toView(inserted), readOnlySource: decision.readOnlySource };
  });
}

export async function exportContentTemplate(
  db: QueryConnection,
  actorId: string,
  input: ExportContentTemplateInput,
): Promise<TemplateExport> {
  if (!await ownedBrand(db, actorId, input.brandId)) return { error: "NOT_FOUND" };
  const source = await loadContentTemplate(db, input.id);
  if (!source || !visible(source, actorId, input.brandId)) return { error: "NOT_FOUND" };
  const decision = templateAllowsInvention({ asksToInventCaseStudy: source.asksToInventCaseStudy === 1 });
  return { allowed: false, reason: decision.reason };
}

export async function updateContentTemplate(
  db: DatabaseConnection,
  actorId: string,
  input: UpdateContentTemplateInput,
  now = clock(),
): Promise<TemplateUpdate> {
  return db.transaction(async (tx) => {
    if (!await new BrandDao(tx).lockOwner(actorId)) return { error: "NOT_FOUND" };
    if (!await ownedBrand(tx, actorId, input.brandId)) return { error: "NOT_FOUND" };
    const current = await loadContentTemplate(tx, input.id);
    if (!current || !visible(current, actorId, input.brandId)) return { error: "NOT_FOUND" };
    if (current.system === 1) return { error: "SYSTEM_READONLY" };
    const decision = cloneTemplate({ system: false, gates: input.gates });
    if (!decision.cloned) return { error: "GATE_REQUIRED", reason: decision.reason };
    const updated = await updateOwnedContentTemplate(tx, {
      id: current.id,
      brandId: input.brandId,
      ownerId: actorId,
      name: input.name,
      status: input.status,
      updatedAt: now,
    });
    if (!updated) return { error: "NOT_FOUND" };
    return { template: toView(updated) };
  });
}
