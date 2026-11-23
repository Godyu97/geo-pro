import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const orderListLimit = 100;
export const orderAmountMax = 2_000_000_000;
export const orderStatuses = ["draft", "awaiting_payment"] as const;

const currencySchema = z.string().regex(/^[A-Z]{3}$/);

export const registerOrderSchema = z.strictObject({
  brandId: brandIdSchema,
  quoted: z.boolean(),
  amount: z.number().int().min(0).max(orderAmountMax),
  currency: currencySchema,
});

export const orderErrors = {
  SESSION_REQUIRED: 401,
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type OrderError = keyof typeof orderErrors;
export type RegisterOrderInput = z.infer<typeof registerOrderSchema>;
export type OrderStatus = (typeof orderStatuses)[number];

export type OrderView = {
  id: string;
  brandId: string;
  quoted: 0 | 1;
  status: OrderStatus;
  paid: 0;
  amount: number;
  currency: string;
  createdAt: string;
};

export type OrderWorkspace = {
  orders: OrderView[];
  brands: { id: string; name: string }[];
};

// Amount and currency are stored values. Interface language does not convert them.
export function formatOrderMoney(amount: number, currency: string) {
  return `${amount} ${currency}`;
}

// A request that declares a connector or a collected payment never becomes an insert.
export function orderRegistrationInput(body: unknown): { error: "INVALID_INPUT" } | { input: RegisterOrderInput } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "INVALID_INPUT" };
  const record = body as Record<string, unknown>;
  if ("paid" in record || "paymentConnected" in record || "status" in record) return { error: "INVALID_INPUT" };
  const parsed = registerOrderSchema.safeParse(body);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  return { input: parsed.data };
}
