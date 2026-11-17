import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .max(254, "邮箱地址过长")
    .pipe(z.email("请输入有效的邮箱地址")),
  password: z
    .string()
    .min(8, "密码至少需要 8 个字符")
    .max(128, "密码最多 128 个字符"),
});

export const signUpSchema = loginSchema.extend({
  name: z.string().trim().min(1, "请输入称呼").max(80, "称呼最多 80 个字符"),
});

export const signInFormSchema = loginSchema.extend({ name: z.string() });

export type AuthFormValues = z.infer<typeof signUpSchema>;
