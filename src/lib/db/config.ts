import { z } from "zod";

const databaseConfigSchema = z.discriminatedUnion("DATABASE_PROVIDER", [
  z.object({
    DATABASE_PROVIDER: z.literal("postgresql"),
    DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:\/\//.test(value)),
  }),
  z.object({
    DATABASE_PROVIDER: z.literal("sqlite"),
    SQLITE_PATH: z.string().min(1).refine((value) => value !== ":memory:"),
  }),
]);

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;

// Pure parser shared by server-only runtime and local database tools.
export function parseDatabaseConfig(source: Record<string, string | undefined>) {
  return databaseConfigSchema.safeParse({
    ...source,
    DATABASE_PROVIDER: source.DATABASE_PROVIDER ?? "postgresql",
  });
}
