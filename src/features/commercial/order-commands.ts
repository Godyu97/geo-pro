import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryConnection } from "../../lib/db/connection.ts";
import { recordOrder } from "./billing.ts";
import type { OrderView, OrderWorkspace, RegisterOrderInput } from "./order-contracts.ts";
import { OrderDao } from "./order-dao.ts";

function clock() {
  return new Date().toISOString();
}

export async function listServiceOrders(db: QueryConnection, ownerId: string) {
  const orders = await new OrderDao(db).ordersForOwner(ownerId);
  return { orders };
}

export async function loadOrderWorkspace(db: QueryConnection, ownerId: string): Promise<OrderWorkspace> {
  const dao = new OrderDao(db);
  const orders = await dao.ordersForOwner(ownerId);
  const brands = await dao.ownedBrands(ownerId);
  return { orders, brands };
}

export async function readServiceOrder(db: QueryConnection, ownerId: string, orderId: string): Promise<
  { error: "NOT_FOUND" } | { order: OrderView }
> {
  const order = await new OrderDao(db).orderForOwner(orderId, ownerId);
  if (!order) return { error: "NOT_FOUND" };
  return { order };
}

export async function registerServiceOrder(
  db: QueryConnection,
  actorId: string,
  input: RegisterOrderInput,
  now = clock(),
): Promise<{ error: "INVALID_INPUT" | "NOT_FOUND" } | { order: OrderView }> {
  const decision = recordOrder({ paymentConnected: false, quoted: input.quoted });
  if (decision.state !== "draft" && decision.state !== "awaiting_payment") return { error: "INVALID_INPUT" };
  const quoted = input.quoted ? 1 : 0;
  const id = randomUUID();
  const inserted = await new OrderDao(db).insertForOwner({
    id,
    brandId: input.brandId,
    ownerId: actorId,
    quoted,
    status: decision.state,
    amount: input.amount,
    currency: input.currency,
    createdAt: now,
  });
  if (!inserted) return { error: "NOT_FOUND" };
  return {
    order: {
      id,
      brandId: input.brandId,
      quoted,
      status: decision.state,
      paid: 0,
      amount: input.amount,
      currency: input.currency,
      createdAt: now,
    },
  };
}
