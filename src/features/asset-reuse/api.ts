import "server-only";

import { getConnection } from "@/lib/db/connection";
import { requireSession } from "@/lib/auth/session";
import { allowsOptionalApiOrigin } from "@/lib/http/web-cors";
import { getTranslator } from "@/lib/i18n/server";
import { readSourceOriginal } from "./commands.ts";
import { sourceErrors, type SourceError } from "./contracts.ts";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Accept-Language" };

async function errorResponse(code: SourceError) {
  const t = await getTranslator("sources");
  return Response.json({
    error: { code, message: t(code), retryable: sourceErrors[code] === 503 },
  }, { status: sourceErrors[code], headers });
}

function attachmentName(fileName: string) {
  const cleaned = fileName.replace(/["\r\n\\]/g, "");
  let ascii = "";
  for (const char of cleaned) {
    const code = char.codePointAt(0) ?? 0;
    ascii += code >= 32 && code <= 126 ? char : "_";
  }
  const fallback = ascii || "original";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(cleaned || "original")}`;
}

export async function sourceOriginalResponse(request: Request, brandId: string, id: string) {
  if (!allowsOptionalApiOrigin(request)) return errorResponse("FORBIDDEN");
  const session = await requireSession().catch(() => null);
  if (!session) return errorResponse("SESSION_REQUIRED");
  const loaded = await readSourceOriginal(getConnection(), session.user.id, { brandId, id });
  if ("error" in loaded) return errorResponse(loaded.error);
  const bytes = new Uint8Array(loaded.body.byteLength);
  bytes.set(loaded.body);
  return new Response(bytes.buffer, {
    headers: {
      ...headers,
      "Content-Type": loaded.contentType,
      "Content-Disposition": attachmentName(loaded.fileName),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    },
  });
}
