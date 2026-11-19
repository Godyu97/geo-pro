import { z } from "zod";
import { cursorSchema, type PromptCursor } from "./contracts";
import { brandIdSchema } from "../brands/contracts";

const cursorParam = z.string().max(80).transform((input) => {
  const separator = input.lastIndexOf(",");
  if (separator <= 0) return null;
  return { at: input.slice(0, separator), id: input.slice(separator + 1) };
}).pipe(cursorSchema);

export const workspaceParams = z.strictObject({
  version: brandIdSchema.optional(),
  after: cursorParam.optional(),
});

export const cursorValue = ({ id, at }: PromptCursor) => `${at},${id}`;
