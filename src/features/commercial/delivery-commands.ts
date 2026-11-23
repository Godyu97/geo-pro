import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryConnection } from "../../lib/db/connection.ts";
import type { DeliveryView, DeliveryWorkspace, RegisterDeliveryInput } from "./delivery-contracts.ts";
import { DeliveryDao } from "./delivery-dao.ts";
import { acceptDelivery, disputeDelivery, registerDeliveryState, type DeliveryState } from "./delivery.ts";

function clock() {
  return new Date().toISOString();
}

function stateOf(delivery: DeliveryView): DeliveryState {
  return { status: delivery.status, disputeReason: delivery.disputeReason };
}

export async function listBrandDeliveries(db: QueryConnection, ownerId: string) {
  const deliveries = await new DeliveryDao(db).deliveriesForOwner(ownerId);
  return { deliveries };
}

export async function loadDeliveryWorkspace(db: QueryConnection, ownerId: string): Promise<DeliveryWorkspace> {
  const dao = new DeliveryDao(db);
  const deliveries = await dao.deliveriesForOwner(ownerId);
  const brands = await dao.ownedBrands(ownerId);
  return { deliveries, brands };
}

export async function readBrandDelivery(db: QueryConnection, ownerId: string, deliveryId: string): Promise<
  { error: "NOT_FOUND" } | { delivery: DeliveryView }
> {
  const delivery = await new DeliveryDao(db).deliveryForOwner(deliveryId, ownerId);
  if (!delivery) return { error: "NOT_FOUND" };
  return { delivery };
}

export async function registerBrandDelivery(
  db: QueryConnection,
  actorId: string,
  input: RegisterDeliveryInput,
  now = clock(),
): Promise<{ error: "INVALID_INPUT" | "NOT_FOUND" } | { delivery: DeliveryView }> {
  const state = registerDeliveryState();
  if (state.status !== "pending" || state.disputeReason !== null) return { error: "INVALID_INPUT" };
  const id = randomUUID();
  const inserted = await new DeliveryDao(db).insertPending({
    id,
    brandId: input.brandId,
    ownerId: actorId,
    title: input.title,
    state,
    createdAt: now,
  });
  if (!inserted) return { error: "NOT_FOUND" };
  return {
    delivery: {
      id,
      brandId: input.brandId,
      title: input.title,
      status: state.status,
      disputeReason: state.disputeReason,
      createdAt: now,
    },
  };
}

async function applyTransition(
  db: QueryConnection,
  actorId: string,
  deliveryId: string,
  decide: (current: DeliveryState) => { ok: true; state: DeliveryState } | { ok: false; error: "CONFLICT" },
): Promise<{ error: "NOT_FOUND" | "CONFLICT" } | { delivery: DeliveryView }> {
  const dao = new DeliveryDao(db);
  const current = await dao.deliveryForOwner(deliveryId, actorId);
  if (!current) return { error: "NOT_FOUND" };
  const decision = decide(stateOf(current));
  if (!decision.ok) return { error: "CONFLICT" };
  const updated = await dao.applyAllowedTransition(deliveryId, actorId, decision.state);
  if (updated) return { delivery: updated };
  const again = await dao.deliveryForOwner(deliveryId, actorId);
  return again ? { error: "CONFLICT" } : { error: "NOT_FOUND" };
}

export function acceptBrandDelivery(db: QueryConnection, actorId: string, deliveryId: string) {
  return applyTransition(db, actorId, deliveryId, acceptDelivery);
}

export function disputeBrandDelivery(db: QueryConnection, actorId: string, deliveryId: string, reason: string) {
  return applyTransition(db, actorId, deliveryId, (current) => disputeDelivery(current, reason));
}
