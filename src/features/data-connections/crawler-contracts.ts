import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";

export const crawlerObservationListLimit = 50;
export const crawlerIdentities = ["unverified", "verified"] as const;
export const citationCountSchema = z.number().int().min(0).max(1_000_000_000);

export const registerCrawlerVisitSchema = z.strictObject({
  brandId: brandIdSchema,
  userAgentClaimsAi: z.boolean(),
  identityVerified: z.boolean(),
  answerCitations: citationCountSchema,
});

export const crawlerVisitErrors = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type CrawlerVisitError = keyof typeof crawlerVisitErrors;
export type RegisterCrawlerVisitInput = z.infer<typeof registerCrawlerVisitSchema>;
export type CrawlerIdentity = (typeof crawlerIdentities)[number];

export type CrawlerObservationView = {
  id: string;
  brandId: string;
  identity: CrawlerIdentity;
  citations: number;
  calledIncluded: false;
  observedAt: string;
};

export type CrawlerObservationList = {
  brands: { id: string }[];
  observations: CrawlerObservationView[];
};
