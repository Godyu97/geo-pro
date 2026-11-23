import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import { sourceModes } from "./contracts.ts";

const overviewRegionSchema = z.union([
  z.literal("unknown"),
  z.string().regex(/^[A-Z]{2}$/),
]);

export const overviewScopeSchema = z.strictObject({
  brandId: brandIdSchema,
  sourceMode: z.enum(sourceModes),
  region: overviewRegionSchema.optional(),
  requestedNetworkMode: z.enum(networkModes).optional(),
  from: z.iso.datetime({ precision: 3 }).optional(),
  to: z.iso.datetime({ precision: 3 }).optional(),
  hasOfficialWebsite: z.boolean().optional(),
});
export type OverviewScope = z.infer<typeof overviewScopeSchema>;

export const overviewQuerySchema = overviewScopeSchema;
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;

export function canonicalOverviewRegion(value: string | undefined) {
  if (!value) return undefined;
  if (value.toLowerCase() === "unknown") return "unknown";
  return value.toUpperCase();
}

function searchValue(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function overviewScopeFromSearch(
  params: Record<string, string | string[] | undefined>,
  fallback: { brandId?: string; sourceMode?: OverviewScope["sourceMode"] } = {},
) {
  const input: {
    brandId?: string;
    sourceMode?: string;
    region?: string;
    requestedNetworkMode?: string;
    from?: string;
    to?: string;
  } = {
    brandId: searchValue(params, "brandId") ?? fallback.brandId,
    sourceMode: searchValue(params, "sourceMode") ?? fallback.sourceMode ?? "model_api",
  };
  const region = canonicalOverviewRegion(searchValue(params, "region"));
  const requestedNetworkMode = searchValue(params, "requestedNetworkMode");
  const from = searchValue(params, "from");
  const to = searchValue(params, "to");
  if (region) input.region = region;
  if (requestedNetworkMode) input.requestedNetworkMode = requestedNetworkMode;
  if (from) input.from = from;
  if (to) input.to = to;
  return overviewScopeSchema.safeParse(input);
}

export function overviewScopeQuery(scope: Pick<
  OverviewScope,
  "brandId" | "sourceMode" | "region" | "requestedNetworkMode" | "from" | "to"
>) {
  const params = new URLSearchParams();
  params.set("brandId", scope.brandId);
  params.set("sourceMode", scope.sourceMode);
  if (scope.region) params.set("region", scope.region);
  if (scope.requestedNetworkMode) params.set("requestedNetworkMode", scope.requestedNetworkMode);
  if (scope.from) params.set("from", scope.from);
  if (scope.to) params.set("to", scope.to);
  return params.toString();
}

export function overviewScopeForReturn(
  params: Record<string, string | string[] | undefined>,
  fallback: { brandId: string; sourceMode: OverviewScope["sourceMode"] },
) {
  const attempts = [
    params,
    { ...params, from: undefined, to: undefined },
    {
      brandId: fallback.brandId,
      sourceMode: params.sourceMode,
      region: params.region,
      requestedNetworkMode: params.requestedNetworkMode,
    },
    { brandId: fallback.brandId, sourceMode: fallback.sourceMode },
  ];
  for (const attempt of attempts) {
    const parsed = overviewScopeFromSearch(attempt, fallback);
    if (parsed.success && parsed.data.brandId === fallback.brandId) return parsed.data;
  }
  return fallback;
}

export function overviewScopePath(
  pathname: string,
  scope: Pick<OverviewScope, "brandId" | "sourceMode" | "region" | "requestedNetworkMode" | "from" | "to">,
) {
  return `${pathname}?${overviewScopeQuery(scope)}`;
}
