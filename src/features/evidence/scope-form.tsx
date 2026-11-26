import { Button } from "@/components/ui/button";
import type { AnswerListFilter } from "./answer-list";
import { KeywordField } from "./keyword-field";
import type { OverviewPayload } from "./overview-cache";
import { unknownOfficialChannel, type OverviewUrlScope } from "./overview-contracts";

type ScopeTranslator = ((key:
  | "track"
  | "trackApi"
  | "trackConsumer"
  | "officialChannelVersion"
  | "unknownOfficialChannelVersion"
  | "automaticChannelVersion"
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
  | "applyFilters") => string)
  & ((key: "channelVersionOption", params: { name: string; version: string }) => string);

const fieldClass = "h-10 w-full min-w-0 rounded-md border bg-background px-3 sm:w-auto";

export type AnswerListForm = {
  filter: AnswerListFilter;
  clusters: ReadonlyArray<{ id: string; label: string }>;
  labels: {
    keyword: string;
    keywordHint: string;
    cluster: string;
    clusterAny: string;
    mentioned: string;
    recommended: string;
    officialSiteCited: string;
    any: string;
    yes: string;
    no: string;
    unknown: string;
  };
};

function JudgmentField({
  id,
  name,
  label,
  value,
  labels,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  labels: Pick<AnswerListForm["labels"], "any" | "yes" | "no" | "unknown">;
}) {
  return (
    <label className="min-w-0 max-w-full break-words text-sm" htmlFor={id}>
      <span className="mb-1 block text-muted-foreground">{label}</span>
      <select id={id} name={name} key={value || "any"} defaultValue={value} className={fieldClass}>
        <option value="">{labels.any}</option>
        <option value="true">{labels.yes}</option>
        <option value="false">{labels.no}</option>
        <option value="unknown">{labels.unknown}</option>
      </select>
    </label>
  );
}

export function OverviewScopeForm({
  scope,
  t,
  list,
  channelOptions = [],
}: {
  scope: OverviewUrlScope;
  t: ScopeTranslator;
  list?: AnswerListForm;
  channelOptions?: OverviewPayload["channelOptions"];
}) {
  const options = scope.channel && !channelOptions.some((option) => option.value === scope.channel)
    ? [...channelOptions, { value: scope.channel, displayName: null }]
    : channelOptions;

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
      {scope.sourceMode === "model_api" && options.length > 0 ? (
        <label className="min-w-0 max-w-full break-words text-sm" htmlFor="overview-channel">
          <span className="mb-1 block text-muted-foreground">{t("officialChannelVersion")}</span>
          <select
            id="overview-channel"
            name="channel"
            key={scope.channel ?? ""}
            defaultValue={scope.channel ?? ""}
            className={`${fieldClass} sm:max-w-64`}
          >
            <option value="">{t("automaticChannelVersion")}</option>
            {options.map(({ value, displayName }) => {
              const [id, version] = value.split("@");
              const label = value === unknownOfficialChannel
                ? t("unknownOfficialChannelVersion")
                : t("channelVersionOption", { name: displayName ?? id, version });
              return <option key={value} value={value}>{label}</option>;
            })}
          </select>
        </label>
      ) : null}
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
      {list ? (
        <>
          <label className="min-w-0 max-w-full break-words text-sm sm:max-w-xs" htmlFor="answer-keyword">
            <span className="mb-1 block text-muted-foreground">{list.labels.keyword}</span>
            <KeywordField
              key={list.filter.q ?? ""}
              id="answer-keyword"
              name="q"
              defaultValue={list.filter.q ?? ""}
              hintId="answer-keyword-hint"
              className={`${fieldClass} sm:w-64`}
            />
          </label>
          <label className="min-w-0 max-w-full break-words text-sm" htmlFor="answer-cluster">
            <span className="mb-1 block text-muted-foreground">{list.labels.cluster}</span>
            <select id="answer-cluster" name="cluster" key={list.filter.cluster ?? "all"} defaultValue={list.filter.cluster ?? ""} className={`${fieldClass} sm:max-w-xs`}>
              <option value="">{list.labels.clusterAny}</option>
              {list.clusters.map((cluster) => (
                <option key={cluster.id} value={cluster.id}>{cluster.label}</option>
              ))}
            </select>
          </label>
          <JudgmentField id="answer-mentioned" name="mentioned" label={list.labels.mentioned} value={list.filter.mentioned ?? ""} labels={list.labels} />
          <JudgmentField id="answer-recommended" name="recommended" label={list.labels.recommended} value={list.filter.recommended ?? ""} labels={list.labels} />
          <JudgmentField id="answer-cited" name="officialSiteCited" label={list.labels.officialSiteCited} value={list.filter.officialSiteCited ?? ""} labels={list.labels} />
        </>
      ) : null}
      <div className="flex items-end">
        <Button type="submit" variant="outline" className="h-auto max-w-full whitespace-normal">{t("applyFilters")}</Button>
      </div>
      {list ? <p id="answer-keyword-hint" className="basis-full break-words text-xs leading-5 text-muted-foreground">{list.labels.keywordHint}</p> : null}
      <p id="overview-region-hint" className="basis-full break-words text-xs leading-5 text-muted-foreground">{t("regionHint")}</p>
      <p id="overview-time-hint" className="basis-full break-words text-xs leading-5 text-muted-foreground">{t("timeHint")}</p>
    </form>
  );
}
