import "server-only";

import { randomUUID } from "node:crypto";
import { cache } from "react";
import type { DatabaseConnection, QueryConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { FactDao } from "../brand-facts/dao.ts";
import { factStatus } from "../brand-facts/rules.ts";
import { BrandDao } from "../brands/dao.ts";
import { calendarRow, impactSurface, settleChannels } from "../channel-variants/rules.ts";
import { authorizeBrandActor } from "../team-access/brand-scope.ts";
import { TeamAccessDao } from "../team-access/dao.ts";
import { authorizePlatformAdmin } from "../team-access/platform-role.ts";
import { brandDutyAllows } from "../team-access/rules.ts";
import {
  targetChannelSchema,
  type CalendarQuery,
  type ContentError,
  type OpenMaintenanceInput,
  type SettleMaintenanceInput,
} from "./contracts.ts";
import { ContentDao, type MaintenancePageRow } from "./dao.ts";

type Clock = () => string;
type Failure = { error: ContentError };
const pageCap = 100;
const taskCap = 50;

function denied(error: ContentError): Failure {
  return { error };
}

export class ContentMaintenanceAbort extends Error {
  readonly code: ContentError;

  constructor(code: ContentError) {
    super(code);
    this.name = "ContentMaintenanceAbort";
    this.code = code;
  }
}

export function presentMaintenancePage(row: MaintenancePageRow) {
  const calendar = calendarRow({
    plannedOn: row.plannedOn,
    verifiedOn: row.verifiedOn,
    blocked: row.status === "blocked",
  });
  const published = row.plannedOn !== null && row.verifiedOn === null ? false : calendar.published;
  return {
    id: row.id,
    pageId: row.pageId,
    draftId: row.draftId,
    pageUrl: row.pageUrl,
    channel: row.channel,
    plannedOn: calendar.plannedOn,
    verifiedOn: calendar.verifiedOn,
    status: row.status,
    published,
    blocked: calendar.blocked,
  };
}

async function ownedBrand(db: QueryConnection, ownerId: string, brandId: string) {
  const brand = await new BrandDao(db).owned(ownerId, brandId);
  return brand && brand.status === "active" ? brand : null;
}

export const readMaintenanceAccess = cache(async (db: QueryConnection, actorId: string, brandId: string) => {
  const scope = await authorizeBrandActor(db, actorId, brandId, "read");
  if (scope && await ownedBrand(db, scope.ownerId, brandId)) {
    return { ownerId: scope.ownerId, canWrite: brandDutyAllows(scope.role, "write") };
  }
  if (await authorizePlatformAdmin(db, actorId)) {
    const brand = await new TeamAccessDao(db).brandActor(actorId, brandId);
    if (brand?.status === "active" && !brand.frozenAt) return { ownerId: brand.ownerId, canWrite: false };
  }
  return null;
});

async function lockMaintenanceWrite(db: TransactionConnection, actorId: string, brandId: string) {
  const scope = await authorizeBrandActor(db, actorId, brandId, "write");
  if (!scope) return denied(await readMaintenanceAccess(db, actorId, brandId) ? "FORBIDDEN" : "NOT_FOUND");
  if (!await new BrandDao(db).lockOwner(scope.ownerId)) return denied("NOT_FOUND");
  const current = await authorizeBrandActor(db, actorId, brandId, "write");
  if (current?.ownerId !== scope.ownerId) {
    return denied(await readMaintenanceAccess(db, actorId, brandId) ? "FORBIDDEN" : "NOT_FOUND");
  }
  return current;
}

function pageChannel(declaration: string, targetChannel: string) {
  if (targetChannelSchema.safeParse(declaration).success) return declaration;
  if (targetChannelSchema.safeParse(targetChannel).success) return targetChannel;
  return null;
}

function factAllowsMaintenance(
  reason: OpenMaintenanceInput["reason"],
  fact: Parameters<typeof factStatus>[0],
  today: string,
) {
  if (reason === "revoked") return fact.state === "revoked";
  if (reason === "expired") return factStatus(fact, today) === "expired";
  return true;
}

async function presentPages(dao: ContentDao, ownerId: string, rows: MaintenancePageRow[]) {
  const links = await dao.listVariantLinks(ownerId, [...new Set(rows.map((row) => row.draftId))]);
  const variants = new Map(links.map((link) => [`${link.contentVersionId}:${link.channel}`, link.id]));
  return rows.map((row) => ({
    ...presentMaintenancePage(row),
    taskId: row.taskId,
    variantId: variants.get(`${row.draftId}:${row.channel}`) ?? null,
  }));
}

export async function openContentMaintenance(
  db: DatabaseConnection,
  actorId: string,
  input: OpenMaintenanceInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return db.transaction(async (transaction) => {
    const scope = await lockMaintenanceWrite(transaction, actorId, input.brandId);
    if ("error" in scope) return scope;
    return openMaintenanceForBrand(transaction, scope.ownerId, input, clock);
  });
}

async function openMaintenanceWithin(
  transaction: TransactionConnection,
  ownerId: string,
  input: OpenMaintenanceInput,
  clock: Clock,
) {
    if (!await new BrandDao(transaction).lockOwner(ownerId)) return denied("NOT_FOUND");
    if (!await ownedBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
  return openMaintenanceForBrand(transaction, ownerId, input, clock);
}

async function openMaintenanceForBrand(
  transaction: TransactionConnection,
  ownerId: string,
  input: OpenMaintenanceInput,
  clock: Clock,
) {
    const now = clock();
    const fact = await new FactDao(transaction, { ownerId, brandId: input.brandId }).version(input.factVersionId);
    if (!fact) return denied("NOT_FOUND");
    const today = now.slice(0, 10);
    if (!factAllowsMaintenance(input.reason, fact, today)) return denied("FACT_INVALID");

    const dao = new ContentDao(transaction);
    const publications = await dao.listFactPublications(ownerId, input.brandId, input.factVersionId);
    if (publications.length > pageCap) return denied("INVALID_INPUT");
    const pages = [];
    for (const publication of publications) {
      const channel = pageChannel(publication.channelDeclaration, publication.targetChannel);
      if (!channel) return denied("INVALID_INPUT");
      pages.push({
        pageId: publication.pageId,
        draftId: publication.draftId,
        channel,
        pageUrl: publication.pageUrl,
      });
    }
    const surface = impactSurface({ factId: input.factVersionId, pages });
    if (surface.taskCount === 0) {
      return {
        taskId: null,
        factVersionId: input.factVersionId,
        reason: input.reason,
        taskCount: 0,
        created: false,
        pageCount: 0,
        pages: [],
      };
    }
    if (surface.taskCount !== 1) return denied("INVALID_INPUT");

    const schedules = new Map(input.schedules.map((schedule) => [schedule.pageId, schedule]));
    for (const pageId of schedules.keys()) {
      if (!surface.pages.some((page) => page.pageId === pageId)) return denied("NOT_FOUND");
    }

    const existing = await dao.findOpenMaintenanceTask(ownerId, input.brandId, input.factVersionId);
    const created = !existing;
    const taskId = existing?.id ?? randomUUID();
    const urls = new Map(pages.map((page) => [page.pageId, page.pageUrl]));
    const pageRows: MaintenancePageRow[] = [];
    for (const page of surface.pages) {
      const pageUrl = urls.get(page.pageId);
      if (!pageUrl) return denied("INVALID_INPUT");
      const schedule = schedules.get(page.pageId);
      const verifiedOn = schedule?.verifiedOn ?? null;
      pageRows.push({
        id: randomUUID(),
        taskId,
        brandId: input.brandId,
        ownerId,
        pageId: page.pageId,
        draftId: page.draftId,
        pageUrl,
        channel: page.channel,
        plannedOn: schedule?.plannedOn ?? null,
        verifiedOn,
        status: verifiedOn ? "verified" as const : "planned" as const,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!existing) {
      await dao.insertMaintenanceTask({
        id: taskId,
        brandId: input.brandId,
        ownerId,
        factVersionId: input.factVersionId,
        status: "open",
        reason: input.reason,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await dao.touchMaintenanceTask(ownerId, taskId, now);
    }
    await dao.insertMaintenancePages(pageRows);
    const stored = await dao.listMaintenancePages(ownerId, [taskId]);
    return {
      taskId,
      factVersionId: input.factVersionId,
      reason: input.reason,
      taskCount: surface.taskCount,
      created,
      pageCount: stored.length,
      pages: await presentPages(dao, ownerId, stored),
    };
}

export async function settleContentMaintenance(
  db: DatabaseConnection,
  actorId: string,
  input: SettleMaintenanceInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return db.transaction(async (transaction) => {
    const scope = await lockMaintenanceWrite(transaction, actorId, input.brandId);
    if ("error" in scope) return scope;
    const { ownerId } = scope;
    const dao = new ContentDao(transaction);
    const task = await dao.getMaintenanceTask(ownerId, input.taskId);
    if (!task || task.brandId !== input.brandId || task.status !== "open") return denied("NOT_FOUND");
    const pages = await dao.listMaintenancePages(ownerId, [task.id]);
    const byChannel = new Map<string, MaintenancePageRow[]>();
    for (const row of pages) {
      const list = byChannel.get(row.channel);
      if (list) list.push(row);
      else byChannel.set(row.channel, [row]);
    }

    const requested = new Map(input.channels.map((change) => [change.channel, change]));
    const projected: { channel: string; state: "verified" | "blocked" }[] = [];
    for (const [channel, rows] of byChannel) {
      const change = requested.get(channel);
      const current = rows[0];
      if (!current) continue;
      if (change) {
        projected.push({ channel, state: change.state });
        continue;
      }
      if (current.status === "verified" || current.status === "blocked") {
        projected.push({ channel, state: current.status });
      }
    }
    const settled = settleChannels(projected);
    if (settled.rolledBack.length > 0) return denied("OPERATION_CONFLICT");

    const writes: { channel: string; status: "verified" | "blocked"; verifiedOn: string | null }[] = [];
    for (const change of input.channels) {
      const rows = byChannel.get(change.channel);
      if (!rows || rows.length === 0) return denied("NOT_FOUND");
      if (change.state === "blocked") {
        writes.push({ channel: change.channel, status: "blocked", verifiedOn: null });
        continue;
      }
      const verifiedOn = change.verifiedOn ?? rows.find((row) => row.verifiedOn)?.verifiedOn ?? null;
      if (!verifiedOn) return denied("INVALID_INPUT");
      writes.push({ channel: change.channel, status: "verified", verifiedOn });
    }

    const now = clock();
    for (const write of writes) {
      await dao.settleMaintenanceChannel({
        ownerId,
        taskId: task.id,
        channel: write.channel,
        status: write.status,
        verifiedOn: write.verifiedOn,
        updatedAt: now,
      });
    }
    await dao.touchMaintenanceTask(ownerId, task.id, now);
    const stored = await dao.listMaintenancePages(ownerId, [task.id]);
    return {
      taskId: task.id,
      verified: settled.verified,
      blocked: settled.blocked,
      rolledBack: settled.rolledBack,
      pages: await presentPages(dao, ownerId, stored),
    };
  });
}

export async function readContentCalendar(
  db: DatabaseConnection,
  actorId: string,
  query: CalendarQuery,
) {
  const access = await readMaintenanceAccess(db, actorId, query.brandId);
  if (!access) return denied("NOT_FOUND");
  const { ownerId } = access;
  const dao = new ContentDao(db);
  const tasks = await dao.listMaintenanceTasks(ownerId, query.brandId, query.factVersionId, taskCap);
  const pages = await presentPages(dao, ownerId, await dao.listMaintenancePages(ownerId, tasks.map((task) => task.id)));
  return {
    canWrite: access.canWrite,
    canOpenPublication: access.canWrite && ownerId === actorId,
    tasks: tasks.map((task) => ({
      id: task.id,
      factVersionId: task.factVersionId,
      status: task.status,
      reason: task.reason,
      pages: pages.filter((page) => page.taskId === task.id),
    })),
  };
}

const scanCap = 50;

export async function scanExpiredContentMaintenance(
  db: DatabaseConnection,
  actorId: string,
  brandId: string,
  clock: Clock = () => new Date().toISOString(),
) {
  try {
    return await db.transaction(async (transaction) => {
      const scope = await lockMaintenanceWrite(transaction, actorId, brandId);
      if ("error" in scope) return scope;
      const { ownerId } = scope;
      const ids = await new ContentDao(transaction).listPublicationFactVersionIds(ownerId, brandId, scanCap);
      const now = clock();
      const today = now.slice(0, 10);
      const expired = ids.length === 0
        ? []
        : (await new FactDao(transaction, { ownerId, brandId }).versionsById(ids)).filter((fact) => factStatus(fact, today) === "expired");
      const tasks = [];
      let opened = 0;
      for (const fact of expired) {
        const result = await openMaintenanceForBrand(transaction, ownerId, {
          action: "open-maintenance",
          brandId,
          factVersionId: fact.id,
          reason: "expired",
          schedules: [],
        }, () => now);
        if ("error" in result) throw new ContentMaintenanceAbort(result.error);
        if (result.created) opened += 1;
        if (result.taskId) {
          tasks.push({
            taskId: result.taskId,
            factVersionId: fact.id,
            created: result.created,
            pageCount: result.pageCount,
          });
        }
      }
      return { scanned: expired.length, opened, tasks };
    });
  } catch (error) {
    if (error instanceof ContentMaintenanceAbort) return denied(error.code);
    throw error;
  }
}

export async function openRevokedFactMaintenance(
  db: TransactionConnection,
  ownerId: string,
  brandId: string,
  factVersionId: string,
  at: string,
) {
  const opened = await openMaintenanceWithin(db, ownerId, {
    action: "open-maintenance",
    brandId,
    factVersionId,
    reason: "revoked",
    schedules: [],
  }, () => at);
  if ("error" in opened) throw new ContentMaintenanceAbort(opened.error);
}

export async function openLinkedPublicationMaintenance(
  db: TransactionConnection,
  ownerId: string,
  brandId: string,
  contentVersionId: string,
  reason: "mismatch" | "removed",
  at: string,
) {
  const factIds = [...new Set(await new FactDao(db, { ownerId, brandId }).usedVersionIds(contentVersionId))];
  for (const factVersionId of factIds) {
    const opened = await openMaintenanceWithin(db, ownerId, {
      action: "open-maintenance",
      brandId,
      factVersionId,
      reason,
      schedules: [],
    }, () => at);
    if ("error" in opened) throw new ContentMaintenanceAbort(opened.error);
  }
}
