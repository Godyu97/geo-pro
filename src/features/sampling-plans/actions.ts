"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import {
  arriveAtSamplingWindow,
  pauseExpiredSamplingChannel,
  reviseSamplingPlanBudget,
  saveSamplingPlan,
  saveSamplingTrendThreshold,
  transitionSamplingPlan,
} from "./commands.ts";
import { driveDueSamplingWindow } from "./due-commands.ts";
import {
  arriveSamplingPlanSchema,
  channelIdSchema,
  createSamplingPlanSchema,
  driveDueWindowSchema,
  expireSamplingChannelSchema,
  planPhaseSchema,
  reviseSamplingBudgetSchema,
  setSamplingTrendThresholdSchema,
  slotStatusSchema,
  transitionSamplingPlanSchema,
} from "./contracts.ts";

const plansPath = "/dashboard/monitoring/plans";
const pageErrors = new Set(["NOT_FOUND", "INVALID_INPUT", "PLAN_PHASE_CONFLICT", "VERSION_CONFLICT"]);

function finish(error?: string): never {
  revalidatePath(plansPath);
  redirect(error && pageErrors.has(error) ? `${plansPath}?error=${error}` : plansPath);
}

function whole(value: FormDataEntryValue | null) {
  return typeof value === "string" && /^\d{1,10}$/.test(value) ? Number(value) : value;
}

function thresholdField(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : value.trim();
}

function textList(formData: FormData, name: string) {
  return formData.getAll(name).map((value) => String(value).trim());
}

export async function createSamplingPlanAction(formData: FormData) {
  const session = await requireSession();
  const channels = textList(formData, "channelId");
  const times = textList(formData, "at");
  const statuses = textList(formData, "status");
  const manuals = textList(formData, "manual");
  const costs = textList(formData, "costMinor");
  const slots = channels.flatMap((channelId, index) => {
    const at = times[index] ?? "";
    if (!channelId && !at) return [];
    const status = slotStatusSchema.safeParse(statuses[index]);
    const manual = manuals[index] === "1" ? true : manuals[index] === "0" ? false : manuals[index];
    const cost = /^\d{1,10}$/.test(costs[index] ?? "") ? Number(costs[index]) : costs[index];
    return [{
      id: randomUUID(),
      channelId,
      at,
      status: status.success ? status.data : statuses[index],
      manual,
      costMinor: cost,
    }];
  });
  const threshold = thresholdField(formData.get("trendThresholdPp"));
  const parsed = createSamplingPlanSchema.safeParse({
    action: "create",
    brandId: String(formData.get("brandId") ?? ""),
    phase: String(formData.get("phase") ?? ""),
    currency: String(formData.get("currency") ?? "").trim().toUpperCase(),
    budgetMinor: whole(formData.get("budgetMinor")),
    spentMinor: whole(formData.get("spentMinor")),
    pendingMinor: whole(formData.get("pendingMinor")),
    nextAt: String(formData.get("nextAt") ?? "").trim(),
    ...(threshold === undefined ? {} : { trendThresholdPp: threshold }),
    slots,
  });
  if (!parsed.success) finish("INVALID_INPUT");
  const result = await saveSamplingPlan(getConnection(), session.user.id, parsed.data);
  finish("error" in result ? result.error : undefined);
}

export async function reviseSamplingBudgetAction(formData: FormData) {
  const session = await requireSession();
  const planId = String(formData.get("planId") ?? "");
  const nextAt = String(formData.get("nextAt") ?? "").trim();
  const threshold = thresholdField(formData.get("trendThresholdPp"));
  const parsed = reviseSamplingBudgetSchema.safeParse({
    budgetMinor: whole(formData.get("budgetMinor")),
    ...(nextAt ? { nextAt } : {}),
    ...(threshold === undefined ? {} : { trendThresholdPp: threshold }),
  });
  if (!parsed.success) finish("INVALID_INPUT");
  const result = await reviseSamplingPlanBudget(getConnection(), session.user.id, planId, parsed.data);
  finish("error" in result ? result.error : undefined);
}

export async function saveSamplingTrendThresholdAction(formData: FormData) {
  const session = await requireSession();
  const threshold = thresholdField(formData.get("trendThresholdPp"));
  const parsed = setSamplingTrendThresholdSchema.safeParse({
    planId: String(formData.get("planId") ?? ""),
    trendThresholdPp: threshold === undefined ? 10 : threshold,
  });
  if (!parsed.success) finish("INVALID_INPUT");
  const result = await saveSamplingTrendThreshold(getConnection(), session.user.id, parsed.data);
  finish("error" in result ? result.error : undefined);
}

export async function transitionSamplingPlanAction(formData: FormData) {
  const session = await requireSession();
  const parsed = transitionSamplingPlanSchema.safeParse({
    action: "transition",
    planId: String(formData.get("planId") ?? ""),
    phase: planPhaseSchema.safeParse(String(formData.get("phase") ?? "")).data,
  });
  if (!parsed.success) finish("INVALID_INPUT");
  const result = await transitionSamplingPlan(getConnection(), session.user.id, parsed.data);
  finish("error" in result ? result.error : undefined);
}

export async function arriveSamplingPlanAction(formData: FormData) {
  const session = await requireSession();
  const parsed = arriveSamplingPlanSchema.safeParse({
    action: "arrive",
    planId: String(formData.get("planId") ?? ""),
    nextAt: String(formData.get("nextAt") ?? "").trim(),
  });
  if (!parsed.success) finish("INVALID_INPUT");
  const result = await arriveAtSamplingWindow(getConnection(), session.user.id, parsed.data);
  finish("error" in result ? result.error : undefined);
}

export async function expireSamplingChannelAction(formData: FormData) {
  const session = await requireSession();
  const channel = channelIdSchema.safeParse(String(formData.get("channelId") ?? ""));
  const parsed = expireSamplingChannelSchema.safeParse({
    action: "expire-channel",
    planId: String(formData.get("planId") ?? ""),
    channelId: channel.success ? channel.data : "",
    nextAt: String(formData.get("nextAt") ?? "").trim(),
  });
  if (!parsed.success) finish("INVALID_INPUT");
  const result = await pauseExpiredSamplingChannel(getConnection(), session.user.id, parsed.data);
  finish("error" in result ? result.error : undefined);
}

export async function driveDueSamplingWindowAction(formData: FormData) {
  const session = await requireSession();
  const channelIds = [...new Set(formData.getAll("channelId").map((value) => String(value).trim()).filter(Boolean))];
  const degrade = String(formData.get("degradeChannelId") ?? "").trim();
  const promptIds = String(formData.get("promptIds") ?? "").split(/[\s,]+/).filter(Boolean);
  const parsed = driveDueWindowSchema.safeParse({
    planId: String(formData.get("planId") ?? ""),
    timezone: String(formData.get("timezone") ?? "").trim(),
    now: new Date().toISOString(),
    channels: channelIds.map((channelId) => ({
      channelId,
      state: channelId === degrade ? "degraded" as const : "eligible" as const,
    })),
    promptIds,
  });
  if (!parsed.success) finish("INVALID_INPUT");
  const result = await driveDueSamplingWindow(getConnection(), session.user.id, parsed.data);
  finish("error" in result ? result.error : undefined);
}
