import en from "../../lib/i18n/messages/en.json" with { type: "json" };
import zhCN from "../../lib/i18n/messages/zh-CN.json" with { type: "json" };
import type { Locale } from "../../lib/i18n/locale.ts";
import { createTranslator } from "../../lib/i18n/translate.ts";
import type { SnapshotCost, SnapshotLabor } from "./cost.ts";

const catalogs = { "zh-CN": zhCN.reports, en: en.reports };

/** Labels come from the message catalog. Status codes stay in the snapshot JSON. */
const laborMessages = { unrecorded: "laborUnrecorded" } as const;

export function presentSnapshotCost(locale: Locale, cost: SnapshotCost, labor: SnapshotLabor) {
  const t = createTranslator(locale, catalogs[locale], catalogs["zh-CN"]);
  const amounts = cost.status === "summarized"
    ? cost.known.map((item) => t("knownAmount", { currency: item.currency, minor: item.minor }))
    : [];
  const known = amounts.length === 0
    ? t("knownCostEmpty")
    : t("knownCost", { amounts: amounts.join(locale === "zh-CN" ? "、" : ", ") });
  const pending = cost.status === "not_applicable"
    ? t("pendingCostNa")
    : new Intl.PluralRules(locale).select(cost.pending_count) === "one"
      ? t("pendingCostOne", { count: cost.pending_count })
      : t("pendingCostOther", { count: cost.pending_count });
  return {
    heading: t("costLaborHeading"),
    known,
    pending,
    reason: cost.status === "not_applicable" ? t("costReasonNoSampling") : null,
    labor: t("laborNa"),
    laborReason: t(laborMessages[labor.reason]),
  };
}
