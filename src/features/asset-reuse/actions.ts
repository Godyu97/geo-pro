"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getConnection } from "@/lib/db/connection";
import { brandIdSchema } from "../brands/contracts.ts";
import { importSourceOriginals, setSourceOriginalRights } from "./commands.ts";
import { sourceImportLimits, type ImportPage } from "./rules.ts";

const textTypes = new Set(["text/plain", "text/markdown", "application/json"]);
const allowedTypes = new Set([...textTypes, "application/pdf"]);

function extensionType(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "text/markdown";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function pdfLooksEncrypted(body: Uint8Array) {
  const sample = body.subarray(0, Math.min(body.byteLength, 65_536));
  let text = "";
  for (const byte of sample) text += String.fromCharCode(byte);
  return text.includes("/Encrypt");
}

function sourcesPath(brandId: string, extra?: Record<string, string>) {
  const params = new URLSearchParams({ brandId, ...extra });
  return `/dashboard/content/sources?${params.toString()}`;
}

export async function importSourcesAction(formData: FormData) {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  if (!brandIdSchema.safeParse(brandId).success) redirect("/dashboard/content/sources?error=INVALID_INPUT");
  const selected = formData.getAll("files").filter((item): item is File => item instanceof File);
  if (selected.length < 1 || selected.length > 20) redirect(sourcesPath(brandId, { error: "INVALID_INPUT" }));

  const files = [];
  for (const file of selected) {
    const name = file.name || "unnamed";
    const declared = allowedTypes.has(file.type) ? file.type : extensionType(name);
    if (file.size > sourceImportLimits.maxBytes) {
      files.push({
        name,
        contentType: declared,
        chars: 0,
        encrypted: false,
        byteSize: Math.min(file.size, 2_147_483_647),
        pages: [] as ImportPage[],
        body: new Uint8Array(),
      });
      continue;
    }
    const body = new Uint8Array(await file.arrayBuffer());
    if (declared === "application/pdf" && pdfLooksEncrypted(body)) {
      files.push({ name, contentType: declared, chars: 0, encrypted: true, pages: [] as ImportPage[], body });
      continue;
    }
    if (textTypes.has(declared)) {
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
        const chars = [...text].length;
        const pages: ImportPage[] = chars > 0 ? [{ page: 1, text: text.slice(0, 1) }] : [{ page: null, text: null }];
        files.push({ name, contentType: declared, chars, encrypted: false, pages, body });
      } catch {
        files.push({
          name,
          contentType: "application/octet-stream",
          chars: 0,
          encrypted: false,
          pages: [] as ImportPage[],
          body,
        });
      }
      continue;
    }
    files.push({
      name,
      contentType: declared,
      chars: 0,
      encrypted: false,
      pages: [{ page: null, text: null }],
      body,
    });
  }

  const result = await importSourceOriginals(getConnection(), session.user.id, { brandId, files });
  revalidatePath("/dashboard/content/sources");
  if ("error" in result) redirect(sourcesPath(brandId, { error: result.error }));
  redirect(sourcesPath(brandId, { batch: result.batchId }));
}

export async function setSourceRightsAction(formData: FormData) {
  const session = await requireSession();
  const brandId = String(formData.get("brandId") ?? "");
  const id = String(formData.get("id") ?? "");
  const rights = formData.get("rights");
  const back = brandIdSchema.safeParse(brandId).success
    ? sourcesPath(brandId, { error: "INVALID_INPUT" })
    : "/dashboard/content/sources?error=INVALID_INPUT";
  if (rights !== "revoked" && rights !== "expired") redirect(back);
  const result = await setSourceOriginalRights(getConnection(), session.user.id, { brandId, id, rights });
  revalidatePath("/dashboard/content/sources");
  if ("error" in result) redirect(sourcesPath(brandId, { error: result.error }));
  redirect(sourcesPath(brandId));
}
