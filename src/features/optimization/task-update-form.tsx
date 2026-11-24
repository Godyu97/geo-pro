"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateOptimizationAction, type OptimizationUpdateResult } from "./actions";
import type { TaskStatus } from "./contracts";
import type { taskStatusOptions } from "./task-labels";

const fieldClass = "min-h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

export function TaskUpdateForm({
  brandId,
  taskId,
  initialStatus,
  options,
  labels,
  feedback,
}: {
  brandId: string;
  taskId: string;
  initialStatus: TaskStatus;
  options: ReturnType<typeof taskStatusOptions>;
  labels: Record<"status" | "completionNote" | "dismissReason" | "manualRank" | "reorderReason" | "save" | "saving", string>;
  feedback: Partial<Record<OptimizationUpdateResult, string>> & { saved: string; SERVICE_UNAVAILABLE: string };
}) {
  const [status, setStatus] = useState<string>(initialStatus);
  const [completionNote, setCompletionNote] = useState("");
  const [dismissReason, setDismissReason] = useState("");
  const [manualRank, setManualRank] = useState("");
  const [reorderReason, setReorderReason] = useState("");
  const [result, submit, pending] = useActionState<OptimizationUpdateResult | null, FormData>(
    async (_previous, formData) => {
      const outcome = await updateOptimizationAction(formData);
      if (outcome === "saved") {
        setCompletionNote("");
        setDismissReason("");
        setManualRank("");
        setReorderReason("");
      }
      return outcome;
    },
    null,
  );

  return (
    <form
      action={submit}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => submit(data));
      }}
    >
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="taskId" value={taskId} />
      <fieldset disabled={pending} aria-describedby="task-update-hint" className="min-w-0 space-y-3">
        <label className="block space-y-1 text-sm">
          <span>{labels.status}</span>
          <select name="status" value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span>{labels.completionNote}</span>
          <textarea
            name="completionNote"
            rows={3}
            maxLength={2000}
            value={completionNote}
            onChange={(event) => setCompletionNote(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{labels.dismissReason}</span>
          <textarea
            name="dismissReason"
            rows={2}
            maxLength={1000}
            value={dismissReason}
            onChange={(event) => setDismissReason(event.target.value)}
            className={fieldClass}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <label className="block space-y-1 text-sm">
            <span>{labels.manualRank}</span>
            <Input name="manualRank" type="number" min={1} value={manualRank} onChange={(event) => setManualRank(event.target.value)} className="h-10 bg-background" />
          </label>
          <label className="block space-y-1 text-sm">
            <span>{labels.reorderReason}</span>
            <Input name="reorderReason" maxLength={1000} value={reorderReason} onChange={(event) => setReorderReason(event.target.value)} className="h-10 bg-background" />
          </label>
        </div>
        <Button type="submit" size="lg">{pending ? labels.saving : labels.save}</Button>
      </fieldset>
      <p role="status" className="text-sm">{!pending && result === "saved" ? feedback.saved : null}</p>
      <p role="alert" className="text-sm text-destructive">
        {!pending && result && result !== "saved" ? feedback[result] ?? feedback.SERVICE_UNAVAILABLE : null}
      </p>
    </form>
  );
}
