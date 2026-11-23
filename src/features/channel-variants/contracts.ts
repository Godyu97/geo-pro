import { z } from "zod";
import { brandIdSchema } from "../brands/contracts.ts";
import { targetChannelSchema } from "../content/contracts.ts";

export const channelProfileErrors = {
  SESSION_REQUIRED: 401,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
} as const;
export type ChannelProfileError = keyof typeof channelProfileErrors;

export const publishChannelProfileSchema = z.strictObject({
  brandId: brandIdSchema,
  channelKey: targetChannelSchema,
  maxCharacters: z.number().int().min(1).max(1_000_000).nullable(),
  note: z.string().trim().min(1).max(2000),
});
export type PublishChannelProfileInput = z.infer<typeof publishChannelProfileSchema>;

export const channelProfileVersionLimit = 200;
