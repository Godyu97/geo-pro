import { z } from "zod";

import { displayNameSchema } from "@/lib/auth/validation";

export const profileUpdateSchema = z.strictObject({ name: displayNameSchema });
export const profileSessionHeader = "x-geo-profile-user";

export function isDisplayNameError(code: unknown): code is "nameRequired" | "nameMax" {
  return code === "nameRequired" || code === "nameMax";
}
