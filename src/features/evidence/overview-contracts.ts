import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import { channelIdSchema } from "../sampling-plans/contracts.ts";
import { sourceModes } from "./contracts.ts";

const overviewRegionSchema = z.union([
  z.literal("unknown"),
  z.string().regex(/^[A-Z]{2}$/),
]);

export const unknownOfficialChannel = "unknown";
export const officialChannelScopeSchema = z.string().max(81).refine((value) => {
  if (value === unknownOfficialChannel) return true;
  const [id, version, extra] = value.split("@");
  return extra === undefined && id === id.trim() && channelIdSchema.safeParse(id).success
    && /^[1-9]\d*$/.test(version ?? "") && Number.isSafeInteger(Number(version));
});

export function officialChannelKey(channelId: string | null, version: number | null) {
  return channelId && version ? `${channelId}@${version}` : unknownOfficialChannel;
}

export const overviewScopeSchema = z.strictObject({
  brandId: brandIdSchema,
  sourceMode: z.enum(sourceModes),
  channel: officialChannelScopeSchema.optional(),
  region: overviewRegionSchema.optional(),
  requestedNetworkMode: z.enum(networkModes).optional(),
  from: z.iso.datetime({ precision: 3 }).optional(),
  to: z.iso.datetime({ precision: 3 }).optional(),
  hasOfficialWebsite: z.boolean().optional(),
}).refine((scope) => scope.sourceMode === "model_api" || scope.channel === undefined);
export type OverviewScope = z.infer<typeof overviewScopeSchema>;
export type OverviewUrlScope = Omit<OverviewScope, "hasOfficialWebsite">;

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
  const sourceMode = searchValue(params, "sourceMode") ?? fallback.sourceMode ?? "model_api";
  return overviewScopeSchema.safeParse({
    brandId: searchValue(params, "brandId") ?? fallback.brandId,
    sourceMode,
    channel: sourceMode === "model_api" ? searchValue(params, "channel") : undefined,
    region: canonicalOverviewRegion(searchValue(params, "region")),
    requestedNetworkMode: searchValue(params, "requestedNetworkMode"),
    from: searchValue(params, "from"),
    to: searchValue(params, "to"),
  });
}

export function overviewScopeQuery(scope: OverviewUrlScope) {
  const params = new URLSearchParams();
  params.set("brandId", scope.brandId);
  params.set("sourceMode", scope.sourceMode);
  if (scope.sourceMode === "model_api" && scope.channel) params.set("channel", scope.channel);
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
      channel: params.channel,
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

export function overviewScopePath(pathname: string, scope: OverviewUrlScope) {
  return `${pathname}?${overviewScopeQuery(scope)}`;
}
