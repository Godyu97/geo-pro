import { execFileSync } from "node:child_process";

export function publishedRetentionVersion() {
  const output = execFileSync(process.execPath, ["--conditions=react-server", "scripts/ensure-retention-policy.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const version = Number(output.trim().split(/\s+/).at(-1));
  if (!Number.isInteger(version) || version < 1) throw new Error("Retention policy version was not published");
  return version;
}
