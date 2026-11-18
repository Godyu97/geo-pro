import { z } from "zod";
import { cursorSchema, type FactCursor } from "./contracts";
import { brandIdSchema } from "../brands/contracts";

const cursorParam = z.string().max(70).transform((input) => {
  const [at, id, extra] = input.split(",");
  return extra === undefined ? { at, id } : null;
}).pipe(cursorSchema);

export const workspaceParams = z.strictObject({
  fact: brandIdSchema.optional(), paste: brandIdSchema.optional(),
  after: cursorParam.optional(), pasteAfter: cursorParam.optional(), impactAfter: brandIdSchema.optional(),
});

export const cursorValue = ({ id, at }: FactCursor) => `${at},${id}`;
