"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/lib/i18n/locale";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { capabilityChangeSchema, channelKinds, capabilityStatuses, capabilityReasons, citationCapabilities } from "./contracts";

type Snapshot = {
  channelId: string;
  vendorId: string;
  kind: string;
  version: number;
  status: string;
  displayName: string;
  productEntry: string;
  mode: string;
  modelVersion: string;
  availability: string;
  searchRequired: 0 | 1;
  citationCapability: string;
  regionTarget: string;
  regionActual: string;
  limitsSummary: string;
  sopSummary: string;
  verifiedAt: string | null;
  expiresAt: string | null;
  publicVisible: 0 | 1;
};

export function CapabilityEditor({
  actorId, locale, messages, channels,
}: {
  actorId: string;
  locale: Locale;
  messages: Messages["capabilities"];
  channels: Snapshot[];
}) {
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [channelId, setChannelId] = useState("");
  const [status, setStatus] = useState("candidate");
  const [feedback, setFeedback] = useState<"recorded" | "recordFailed" | "error" | null>(null);
  const [error, setError] = useState("");
  const selected = channels.find((item) => item.channelId === channelId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    setError("");
    const data = new FormData(event.currentTarget);
    const payload = {
      action: "record" as const,
      actorId,
      operationId: crypto.randomUUID(),
      expectedVersion: selected ? selected.version : null,
      channelId: selected?.channelId ?? null,
      vendorId: String(data.get("vendorId") ?? ""),
      kind: String(data.get("kind") ?? ""),
      reason: String(data.get("reason") ?? ""),
      status: String(data.get("status") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
      productEntry: String(data.get("productEntry") ?? ""),
      mode: String(data.get("mode") ?? ""),
      modelVersion: String(data.get("modelVersion") ?? ""),
      availability: String(data.get("availability") ?? ""),
      searchRequired: data.get("searchRequired") === "1" ? 1 : 0,
      citationCapability: String(data.get("citationCapability") ?? ""),
      regionTarget: String(data.get("regionTarget") ?? ""),
      regionActual: String(data.get("regionActual") ?? ""),
      limitsSummary: String(data.get("limitsSummary") ?? ""),
      sopSummary: String(data.get("sopSummary") ?? ""),
      verifiedAt: status === "verified" ? new Date().toISOString() : null,
      expiresAt: null,
      publicVisible: data.get("publicVisible") === "1" && status === "verified" ? 1 : 0,
    };
    const parsed = capabilityChangeSchema.safeParse(payload);
    if (!parsed.success) {
      setFeedback("error");
      setError(t("INVALID_INPUT"));
      return;
    }
    try {
      const response = await fetch("/api/maintenance/capabilities", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json() as { error?: { message?: string } };
      if (!response.ok) {
        setFeedback("recordFailed");
        setError(body.error?.message ?? t("recordFailed"));
        return;
      }
      setFeedback("recorded");
      router.refresh();
    } catch {
      setFeedback("recordFailed");
      setError(t("SERVICE_UNAVAILABLE"));
    }
  }

  const field = (name: string, label: string, defaultValue = "", multiline = false) => (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={name}>{label}</Label>
      {multiline ? (
        <textarea id={name} name={name} defaultValue={defaultValue} required
          className="min-h-20 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm" />
      ) : (
        <Input id={name} name={name} defaultValue={defaultValue} required />
      )}
    </div>
  );

  return (
    <form key={channelId || "new"} onSubmit={submit} className="grid min-w-0 gap-3">
      <div className="min-w-0 space-y-1">
        <Label htmlFor="channel">{t("existingChannel")}</Label>
        <select id="channel" className="h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm"
          value={channelId} onChange={(event) => setChannelId(event.target.value)}>
          <option value="">{t("newChannel")}</option>
          {channels.map((item) => (
            <option key={item.channelId} value={item.channelId}>{item.displayName} · v{item.version}</option>
          ))}
        </select>
      </div>
      {field("vendorId", t("vendor"), selected?.vendorId ?? "")}
      <div className="min-w-0 space-y-1">
        <Label htmlFor="kind">{t("kind")}</Label>
        <select id="kind" name="kind" defaultValue={selected?.kind ?? "model_api"}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm">
          {channelKinds.map((kind) => <option key={kind} value={kind}>{t(kind)}</option>)}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="status">{t("status")}</Label>
          <select id="status" name="status" value={status} onChange={(event) => setStatus(event.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm">
            {capabilityStatuses.map((item) => <option key={item} value={item}>{t(item)}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="reason">{t("reason")}</Label>
          <select id="reason" name="reason" defaultValue={selected ? "verification" : "initial-record"}
            className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm">
            {capabilityReasons.map((item) => <option key={item} value={item}>{t(item)}</option>)}
          </select>
        </div>
      </div>
      {field("displayName", t("displayName"), selected?.displayName ?? "")}
      {field("productEntry", t("productEntry"), selected?.productEntry ?? "")}
      {field("mode", t("mode"), selected?.mode ?? "")}
      {field("modelVersion", t("modelVersion"), selected?.modelVersion ?? "unknown")}
      {field("availability", t("availability"), selected?.availability ?? "")}
      {field("regionTarget", t("regionTarget"), selected?.regionTarget ?? "")}
      {field("regionActual", t("regionActual"), selected?.regionActual ?? "unknown")}
      {field("limitsSummary", t("limits"), selected?.limitsSummary ?? "", true)}
      {field("sopSummary", t("sop"), selected?.sopSummary ?? "", true)}
      <div className="space-y-1">
        <Label htmlFor="citationCapability">{t("citation")}</Label>
        <select id="citationCapability" name="citationCapability" defaultValue={selected?.citationCapability ?? "unsupported"}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm">
          {citationCapabilities.map((item) => <option key={item} value={item}>{t(`citation_${item}`)}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="searchRequired" value="1" defaultChecked={selected?.searchRequired === 1} />
        {t("searchRequired")}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="publicVisible" value="1" defaultChecked={selected?.publicVisible === 1} />
        {t("publicVisible")}
      </label>
      {feedback && <p role="status" className="text-sm">{feedback === "error" || feedback === "recordFailed" ? error : t(feedback)}</p>}
      <Button type="submit">{t("record")}</Button>
    </form>
  );
}
