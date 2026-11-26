import "server-only";

import { headers } from "next/headers";
import { getConnection } from "@/lib/db/connection";
import type { Locale } from "@/lib/i18n/locale";
import { getMessages } from "@/lib/i18n/server";
import { brandExportAllowed } from "@/features/brands/intake";
import { DataExportForm } from "./export-form";
import { getExportSummary } from "./service";

export async function DataExportPanel({ userId, locale }: { userId: string; locale: Locale }) {
  const messages = getMessages(locale).dataExports;
  const brandsAllowed = brandExportAllowed(await headers());
  let summary;
  try {
    summary = await getExportSummary(getConnection(), userId);
  } catch {
    console.error("data-export-status-unavailable");
    return <p role="alert" className="text-sm leading-6 text-destructive">{messages.unavailable}</p>;
  }
  return <DataExportForm key={userId} userId={userId} messages={messages} brandsAllowed={brandsAllowed} initialSummary={summary} />;
}
