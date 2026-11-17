import { z } from "zod";

// Stable codes keep validation rules independent of the interface language.
export const validationKeys = [
  "emailMax", "emailInvalid", "passwordMin", "passwordMax", "nameRequired", "nameMax",
] as const;
export type ValidationKey = (typeof validationKeys)[number];

export function isValidationKey(value: unknown): value is ValidationKey {
  return validationKeys.some((key) => key === value);
}

export const loginSchema = z.object({
  email: z.string().trim().max(254, "emailMax").pipe(z.email("emailInvalid")),
  password: z.string().min(8, "passwordMin").max(128, "passwordMax"),
});

export const displayNameSchema = z.string({ error: "nameRequired" }).trim()
  .min(1, "nameRequired")
  .refine((value) => Array.from(value).length <= 80, "nameMax");

export const signUpSchema = loginSchema.extend({ name: displayNameSchema });

export const signInFormSchema = loginSchema.extend({ name: z.string() });
export type AuthFormValues = z.infer<typeof signUpSchema>;
