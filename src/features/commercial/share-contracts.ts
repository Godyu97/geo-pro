import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const shareListLimit = 100;
export const shareSampleMax = 2_000_000_000;
const token = (max: number) => z.string().regex(new RegExp(`^[a-z0-9_]{1,${max}}$`));
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine((value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
});

export const registerShareSchema = z.strictObject({
  brandId: brandIdSchema,
  track: token(64),
  sampleSize: z.number().int().min(0).max(shareSampleMax),
  grade: token(32),
  expiresAt: instant,
});

export const shareErrors = {
  SESSION_REQUIRED: 401,
  INVALID_INPUT: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ShareError = keyof typeof shareErrors;
export type RegisterShareInput = z.infer<typeof registerShareSchema>;

export type ShareAccess = {
  id: string;
  visitorId: string;
  accessedAt: string;
};

export type ShareView = {
  id: string;
  brandId: string;
  track: string;
  sampleSize: number;
  grade: string;
  expiresAt: string;
  revoked: 0 | 1;
  createdAt: string;
  accesses: ShareAccess[];
};

export type ShareRead = {
  id: string;
  brandId: string;
  track: string;
  sampleSize: number;
  grade: string;
  expiresAt: string;
  revoked: 0;
  createdAt: string;
};

export type ShareWorkspace = {
  shares: ShareView[];
  brands: { id: string; name: string }[];
};

const guaranteeKeys = ["guarantee", "guaranteeText", "effectGuarantee", "promise", "claim", "effect", "promisedEffect"];
const guaranteeCopy = /效果保证|保证效果|保证提升|承诺效果|effect guarantee|guaranteed/i;

// Sample size is a stored integer. Interface language does not regroup or translate it.
export function formatShareSample(sampleSize: number) {
  return String(sampleSize);
}

// A request that carries an effect-guarantee claim never becomes a share row.
export function shareRegistrationInput(body: unknown): { error: "INVALID_INPUT" } | { input: RegisterShareInput } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "INVALID_INPUT" };
  const record = body as Record<string, unknown>;
  if (guaranteeKeys.some((key) => key in record)) return { error: "INVALID_INPUT" };
  if (guaranteeCopy.test(JSON.stringify(record))) return { error: "INVALID_INPUT" };
  const parsed = registerShareSchema.safeParse(body);
  if (!parsed.success) return { error: "INVALID_INPUT" };
  return { input: parsed.data };
}
