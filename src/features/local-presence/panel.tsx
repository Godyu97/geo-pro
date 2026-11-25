"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginPath } from "@/lib/auth/return-to";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import {
  localObservationErrors,
  registerLocalObservationSchema,
  unknownSampledPlace,
  type LocalObservationError,
  type LocalObservationView,
} from "./contracts.ts";

type Copy = Messages["localObservations"];
type Notice = { kind: "status" | "alert"; text: string };

const actionClass = "h-auto min-h-10 max-w-full whitespace-normal text-center aria-disabled:opacity-60";
const wrapBadgeClass = "h-auto max-w-full whitespace-normal rounded-xl px-3 py-1 text-left leading-5 [overflow-wrap:anywhere]";
const selectClass = "box-border block h-10 w-full min-w-0 max-w-full truncate rounded-lg border border-input bg-background px-3 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const emptySurfaceClass = "rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]";
const returnPath = "/dashboard/brands/local-observations";

function isLocalObservationError(code: string): code is LocalObservationError {
  return Object.hasOwn(localObservationErrors, code);
}

function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.kind}
      className={notice.kind === "alert"
        ? "rounded-xl border border-destructive/30 bg-card px-4 py-3 text-sm leading-6 text-destructive"
        : "rounded-xl border bg-card px-4 py-3 text-sm leading-6 text-foreground"}
    >
      {notice.text}
    </p>
  );
}

export function LocalObservationsPanel({ brands, observations, labels, locale, messages }: {
  brands: { id: string }[];
  observations: LocalObservationView[];
  labels: { brandId: string; name: string }[];
  locale: Locale;
  messages: Copy;
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const labelFor = (brandId: string) => labels.find((label) => label.brandId === brandId)?.name ?? brandId;
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [targetCity, setTargetCity] = useState("");
  const [sampledCity, setSampledCity] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();
  const inFlightRef = useRef(false);

  function begin() {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    setPending(true);
    setNotice(null);
    return true;
  }

  function finish() {
    inFlightRef.current = false;
    setPending(false);
  }

  function noticeFrom(payload: unknown) {
    if (!payload || typeof payload !== "object" || !("error" in payload)) return t("SERVICE_UNAVAILABLE");
    const error = payload.error;
    if (!error || typeof error !== "object" || !("code" in error) || typeof error.code !== "string") return t("SERVICE_UNAVAILABLE");
    return isLocalObservationError(error.code) ? t(error.code) : t("SERVICE_UNAVAILABLE");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlightRef.current) return;
    const parsed = registerLocalObservationSchema.safeParse({
      brandId,
      targetCity,
      sampledCity: sampledCity.trim() ? sampledCity : null,
    });
    if (!parsed.success) {
      setNotice({ kind: "alert", text: t("INVALID_INPUT") });
      return;
    }
    if (!begin()) return;
    startTransition(async () => {
      try {
        const response = await fetch("/api/brands/local-observations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 401) {
            window.location.replace(loginPath(returnPath, "session-required"));
            return;
          }
          setNotice({ kind: "alert", text: noticeFrom(payload) });
          return;
        }
        setTargetCity("");
        setSampledCity("");
        setNotice({ kind: "status", text: t("saved") });
        router.refresh();
      } catch {
        setNotice({ kind: "alert", text: t("SERVICE_UNAVAILABLE") });
      } finally {
        finish();
      }
    });
  }

  return (
    <div className="min-w-0 space-y-6">
      <NoticeBanner notice={notice} />
      {brands.length > 0 ? (
        <Card id="local-observation-form" className="min-w-0 scroll-mt-24">
          <CardHeader>
            <CardTitle>
              <h2 className="[overflow-wrap:anywhere]">{t("registerTitle")}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid min-w-0 gap-4">
              {brands.length > 1 ? (
                <div className="flex min-w-0 flex-col gap-2">
                  <Label htmlFor="local-observation-brand">{t("brand")}</Label>
                  <select
                    id="local-observation-brand"
                    value={brandId}
                    onChange={(event) => setBrandId(event.target.value)}
                    className={selectClass}
                  >
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>{labelFor(brand.id)}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="local-observation-target">{t("targetCity")}</Label>
                <Input
                  id="local-observation-target"
                  value={targetCity}
                  maxLength={80}
                  autoComplete="off"
                  onChange={(event) => setTargetCity(event.target.value)}
                  className="h-10 bg-background"
                />
                <p className="text-sm leading-6 text-muted-foreground">{t("targetHint")}</p>
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <Label htmlFor="local-observation-sampled">{t("sampledCity")}</Label>
                <Input
                  id="local-observation-sampled"
                  value={sampledCity}
                  maxLength={80}
                  autoComplete="off"
                  onChange={(event) => setSampledCity(event.target.value)}
                  className="h-10 bg-background"
                />
                <p className="text-sm leading-6 text-muted-foreground">{t("sampledHint")}</p>
              </div>
              <div>
                <Button type="submit" aria-disabled={pending} className={actionClass}>
                  {pending ? t("registering") : t("registerAction")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
      {observations.length === 0 ? <p className={emptySurfaceClass}>{t("empty")}</p> : (
        <div id="local-observation-list" tabIndex={-1} className="min-w-0 scroll-mt-24 space-y-4 outline-none focus-visible:outline-2 focus-visible:outline-ring">
          <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{t("listTitle")}</h2>
          {observations.map((observation) => {
            const place = observation.actualStatus === unknownSampledPlace ? t("unknownPlace") : observation.sampledCity;
            return (
              <Card key={observation.id} className="min-w-0">
                <CardHeader>
                  <CardTitle>
                    <h3 className="[overflow-wrap:anywhere]">{labelFor(observation.brandId)}</h3>
                  </CardTitle>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    {observation.actualStatus === unknownSampledPlace ? (
                      <Badge variant="outline" className={wrapBadgeClass}>{t("unknownPlace")}</Badge>
                    ) : null}
                    <Badge variant="secondary" className={wrapBadgeClass}>{t("unranked")}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm leading-6 [overflow-wrap:anywhere]">{t("targetLine", { city: observation.targetCity })}</p>
                  <p className="text-sm leading-6 [overflow-wrap:anywhere]">{t("actualLine", { place: place ?? t("unknownPlace") })}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{t("recordedAt", { time: when.format(new Date(observation.recordedAt)) })}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
