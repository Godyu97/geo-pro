import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { networkModes } from "../capabilities/contracts.ts";
import { sourceModes } from "./contracts.ts";

export const overviewScopeSchema = z.strictObject({
  brandId: brandIdSchema,
  sourceMode: z.enum(sourceModes),
  region: z.string().length(2).optional(),
  requestedNetworkMode: z.enum(networkModes).optional(),
  from: z.iso.datetime({ precision: 3 }).optional(),
  to: z.iso.datetime({ precision: 3 }).optional(),
  hasOfficialWebsite: z.boolean().optional(),
});
export type OverviewScope = z.infer<typeof overviewScopeSchema>;

export const overviewQuerySchema = overviewScopeSchema;
export type OverviewQuery = z.infer<typeof overviewQuerySchema>;
