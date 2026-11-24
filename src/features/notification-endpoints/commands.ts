import "server-only";

import { randomUUID } from "node:crypto";
import type { DatabaseConnection } from "../../lib/db/connection.ts";
import { BrandDao } from "../brands/dao.ts";
import { notifyNext } from "../external-connections/rules.ts";
import {
  registerNotificationEndpointSchema,
  requestNotificationDeliverySchema,
  type NotificationDeliveryView,
  type NotificationEndpointList,
  type NotificationEndpointView,
} from "./contracts.ts";
import {
  NotificationEndpointDao,
  type NotificationDeliveryRecord,
  type NotificationEndpointRecord,
} from "./dao.ts";
import { classifyNoticeBody } from "./rules.ts";

type Clock = () => string;
type EndpointResult = { endpoint: NotificationEndpointView } | { error: "NOT_FOUND" | "INVALID_INPUT" };
type DeliveryResult = { endpoint: NotificationEndpointView; delivery: NotificationDeliveryView } | { error: "NOT_FOUND" | "INVALID_INPUT" };
type RegisterResult = { endpoint: NotificationEndpointView } | { error: "NOT_FOUND" | "INVALID_INPUT" };

const systemClock: Clock = () => new Date().toISOString();

function bit(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

function toDelivery(row: NotificationDeliveryRecord): NotificationDeliveryView {
  return {
    id: row.id,
    sent: row.sent === 1,
    bodyHasCustomerText: row.bodyHasCustomerText === 1,
    bodyHash: row.bodyHash,
    createdAt: row.createdAt,
  };
}

function toEndpoint(row: NotificationEndpointRecord, deliveries: readonly NotificationDeliveryRecord[]): NotificationEndpointView {
  return {
    id: row.id,
    brandId: row.brandId,
    label: row.label,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deliveries: deliveries.filter((delivery) => delivery.endpointId === row.id).map(toDelivery),
  };
}

async function ownedEndpoint(dao: NotificationEndpointDao, brands: BrandDao, ownerId: string, endpointId: string, lock: boolean) {
  const endpoint = await dao.endpointForOwner(ownerId, endpointId, lock);
  if (!endpoint) return null;
  const owned = await brands.owned(ownerId, endpoint.brandId);
  return owned ? endpoint : null;
}

export async function listNotificationEndpoints(db: DatabaseConnection, ownerId: string): Promise<NotificationEndpointList> {
  return db.transaction(async (tx) => {
    const dao = new NotificationEndpointDao(tx);
    const brands = await dao.activeBrandIds(ownerId);
    const endpoints = await dao.endpointsForOwner(ownerId);
    const deliveries = await dao.deliveriesForEndpoints(ownerId, endpoints.map((row) => row.id));
    return { brands, endpoints: endpoints.map((row) => toEndpoint(row, deliveries)) };
  });
}

export async function getNotificationEndpoint(db: DatabaseConnection, ownerId: string, endpointId: string): Promise<EndpointResult> {
  return db.transaction(async (tx) => {
    const dao = new NotificationEndpointDao(tx);
    const endpoint = await ownedEndpoint(dao, new BrandDao(tx), ownerId, endpointId, false);
    if (!endpoint) return { error: "NOT_FOUND" as const };
    const deliveries = await dao.deliveriesForEndpoint(ownerId, endpoint.id);
    return { endpoint: toEndpoint(endpoint, deliveries) };
  });
}

export async function registerNotificationEndpoint(
  db: DatabaseConnection,
  ownerId: string,
  input: unknown,
  clock: Clock = systemClock,
): Promise<RegisterResult> {
  const parsed = registerNotificationEndpointSchema.safeParse(input);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  return db.transaction(async (tx) => {
    const owned = await new BrandDao(tx).owned(ownerId, parsed.data.brandId);
    if (!owned || owned.status !== "active") return { error: "NOT_FOUND" as const };
    const now = clock();
    const row: NotificationEndpointRecord = {
      id: randomUUID(),
      brandId: parsed.data.brandId,
      ownerId,
      label: parsed.data.label,
      status: "verified",
      createdAt: now,
      updatedAt: now,
    };
    await new NotificationEndpointDao(tx).insertEndpoint(row);
    return { endpoint: toEndpoint(row, []) };
  });
}

export async function revokeNotificationEndpoint(
  db: DatabaseConnection,
  ownerId: string,
  endpointId: string,
  clock: Clock = systemClock,
): Promise<EndpointResult> {
  return db.transaction(async (tx) => {
    const dao = new NotificationEndpointDao(tx);
    const current = await ownedEndpoint(dao, new BrandDao(tx), ownerId, endpointId, true);
    if (!current) return { error: "NOT_FOUND" as const };
    if (current.status === "revoked") {
      const deliveries = await dao.deliveriesForEndpoint(ownerId, current.id);
      return { endpoint: toEndpoint(current, deliveries) };
    }
    const now = clock();
    const saved = await dao.markRevoked(ownerId, current.id, now);
    if (!saved) return { error: "NOT_FOUND" as const };
    const deliveries = await dao.deliveriesForEndpoint(ownerId, current.id);
    return { endpoint: toEndpoint({ ...current, status: "revoked", updatedAt: now }, deliveries) };
  });
}

export async function requestNotificationDelivery(
  db: DatabaseConnection,
  ownerId: string,
  endpointId: string,
  input: unknown,
  clock: Clock = systemClock,
): Promise<DeliveryResult> {
  const parsed = requestNotificationDeliverySchema.safeParse(input);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  return db.transaction(async (tx) => {
    const dao = new NotificationEndpointDao(tx);
    const endpoint = await ownedEndpoint(dao, new BrandDao(tx), ownerId, endpointId, true);
    if (!endpoint) return { error: "NOT_FOUND" as const };
    const classified = classifyNoticeBody(parsed.data.body);
    const decision = notifyNext({
      revoked: endpoint.status === "revoked",
      bodyHasCustomerText: classified.bodyHasCustomerText,
    });
    const delivery: NotificationDeliveryRecord = {
      id: randomUUID(),
      endpointId: endpoint.id,
      brandId: endpoint.brandId,
      ownerId,
      sent: bit(decision.send && !decision.historyDeleted),
      bodyHasCustomerText: bit(classified.bodyHasCustomerText),
      bodyHash: classified.bodyHash,
      createdAt: clock(),
    };
    await dao.insertDelivery(delivery);
    const deliveries = await dao.deliveriesForEndpoint(ownerId, endpoint.id);
    return { endpoint: toEndpoint(endpoint, deliveries), delivery: toDelivery(delivery) };
  });
}
