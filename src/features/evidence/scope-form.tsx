import { Button } from "@/components/ui/button";
import type { OverviewScope } from "./overview-contracts";

type ScopeTranslator = (key:
  | "track"
  | "trackApi"
  | "trackConsumer"
  | "region"
  | "regionHint"
  | "regionPlaceholder"
  | "requestedNetwork"
  | "scopeAny"
  | "networkOn"
  | "networkOff"
  | "networkUnknown"
  | "from"
  | "to"
  | "timeHint"
  | "applyFilters") => string;

const fieldClass = "h-10 w-full min-w-0 rounded-md border bg-background px-3 sm:w-auto";

export function OverviewScopeForm({
  scope,
  t,
}: {
  scope: Pick<OverviewScope, "brandId" | "sourceMode" | "region" | "requestedNetworkMode" | "from" | "to">;
  t: ScopeTranslator;
}) {
  return (
    <form className="flex min-w-0 max-w-full flex-wrap items-end gap-3 rounded-2xl border bg-secondary/40 p-4" method="get">
      <input type="hidden" name="brandId" value={scope.brandId} />
      <label className="min-w-0 max-w-full break-words text-sm" htmlFor="overview-source-mode">
        <span className="mb-1 block text-muted-foreground">{t("track")}</span>
        <select
          id="overview-source-mode"
          name="sourceMode"
          defaultValue={scope.sourceMode}
          className={fieldClass}
        >
          <option value="model_api">{t("trackApi")}</option>
          <option value="consumer_ui">{t("trackConsumer")}</option>
        </select>
      </label>
      <label className="min-w-0 max-w-full break-words text-sm" htmlFor="overview-region">
        <span className="mb-1 block text-muted-foreground">{t("region")}</span>
        <input
          id="overview-region"
          name="region"
          defaultValue={scope.region ?? ""}
          maxLength={7}
          placeholder={t("regionPlaceholder")}
          autoComplete="off"
          aria-describedby="overview-region-hint"
          className={`${fieldClass} sm:w-36`}
        />
      </label>
      <label className="min-w-0 max-w-full break-words text-sm" htmlFor="overview-network">
        <span className="mb-1 block text-muted-foreground">{t("requestedNetwork")}</span>
        <select
          id="overview-network"
          name="requestedNetworkMode"
          defaultValue={scope.requestedNetworkMode ?? ""}
          className={fieldClass}
        >
          <option value="">{t("scopeAny")}</option>
          <option value="on">{t("networkOn")}</option>
          <option value="off">{t("networkOff")}</option>
          <option value="unknown">{t("networkUnknown")}</option>
        </select>
      </label>
      <label className="min-w-0 max-w-full break-words text-sm sm:max-w-xs" htmlFor="overview-from">
        <span className="mb-1 block text-muted-foreground">{t("from")}</span>
        <input
          id="overview-from"
          name="from"
          defaultValue={scope.from ?? ""}
          placeholder="2026-11-20T00:00:00.000Z"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="overview-time-hint"
          className={`${fieldClass} sm:w-72`}
        />
      </label>
      <label className="min-w-0 max-w-full break-words text-sm sm:max-w-xs" htmlFor="overview-to">
        <span className="mb-1 block text-muted-foreground">{t("to")}</span>
        <input
          id="overview-to"
          name="to"
          defaultValue={scope.to ?? ""}
          placeholder="2026-11-20T23:59:59.999Z"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="overview-time-hint"
          className={`${fieldClass} sm:w-72`}
        />
      </label>
      <div className="flex items-end">
        <Button type="submit" variant="outline" className="h-auto max-w-full whitespace-normal">{t("applyFilters")}</Button>
      </div>
      <p id="overview-region-hint" className="basis-full break-words text-xs leading-5 text-muted-foreground">{t("regionHint")}</p>
      <p id="overview-time-hint" className="basis-full break-words text-xs leading-5 text-muted-foreground">{t("timeHint")}</p>
    </form>
  );
}
