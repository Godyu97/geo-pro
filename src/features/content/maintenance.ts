import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection, TransactionConnection } from "../../lib/db/connection.ts";
import { FactDao } from "../brand-facts/dao.ts";
import { factStatus } from "../brand-facts/rules.ts";
import { BrandDao } from "../brands/dao.ts";
import { calendarRow, impactSurface, settleChannels } from "../channel-variants/rules.ts";
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

async function ownedBrand(db: TransactionConnection | DatabaseConnection, ownerId: string, brandId: string) {
  const brand = await new BrandDao(db).owned(ownerId, brandId);
  return brand && brand.status === "active" ? brand : null;
}

function pageChannel(declaration: string, targetChannel: string) {
  if (targetChannelSchema.safeParse(declaration).success) return declaration;
  if (targetChannelSchema.safeParse(targetChannel).success) return targetChannel;
  return null;
}

export async function openContentMaintenance(
  db: DatabaseConnection,
  ownerId: string,
  input: OpenMaintenanceInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return db.transaction(async (transaction) => {
    if (!await new BrandDao(transaction).lockOwner(ownerId)) return denied("NOT_FOUND");
    if (!await ownedBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
    const now = clock();
    const fact = await new FactDao(transaction, { ownerId, brandId: input.brandId }).version(input.factVersionId);
    if (!fact) return denied("NOT_FOUND");
    const today = now.slice(0, 10);
    if (input.reason === "revoked" ? fact.state !== "revoked" : factStatus(fact, today) !== "expired") {
      return denied("FACT_INVALID");
    }

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
      pages: stored.map(presentMaintenancePage),
    };
  });
}

export async function settleContentMaintenance(
  db: DatabaseConnection,
  ownerId: string,
  input: SettleMaintenanceInput,
  clock: Clock = () => new Date().toISOString(),
) {
  return db.transaction(async (transaction) => {
    if (!await new BrandDao(transaction).lockOwner(ownerId)) return denied("NOT_FOUND");
    if (!await ownedBrand(transaction, ownerId, input.brandId)) return denied("NOT_FOUND");
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
      pages: stored.map(presentMaintenancePage),
    };
  });
}

export async function readContentCalendar(
  db: DatabaseConnection,
  ownerId: string,
  query: CalendarQuery,
) {
  if (!await ownedBrand(db, ownerId, query.brandId)) return denied("NOT_FOUND");
  const dao = new ContentDao(db);
  const tasks = await dao.listMaintenanceTasks(ownerId, query.brandId, query.factVersionId, taskCap);
  const pages = await dao.listMaintenancePages(ownerId, tasks.map((task) => task.id));
  return {
    tasks: tasks.map((task) => ({
      id: task.id,
      factVersionId: task.factVersionId,
      status: task.status,
      reason: task.reason,
      pages: pages.filter((page) => page.taskId === task.id).map(presentMaintenancePage),
    })),
  };
}
