"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cloneContentTemplateAction, type TemplateCloneFeedback } from "./template-actions";

const gateNames = ["fact", "publicLicense", "review"] as const;

export function TemplateCloneForm({
  brandId,
  templateId,
  labels,
  feedback,
}: {
  brandId: string;
  templateId: string;
  labels: Record<(typeof gateNames)[number] | "name" | "clone" | "cloning", string>;
  feedback: Record<TemplateCloneFeedback, string>;
}) {
  const [name, setName] = useState("");
  const [gates, setGates] = useState({ fact: true, publicLicense: true, review: true });
  const [result, submit, pending] = useActionState(cloneContentTemplateAction, null);
  const error = result && result !== "cloned" ? result : null;

  return (
    <form
      action={submit}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const data = new FormData(event.currentTarget);
        startTransition(() => submit(data));
      }}
    >
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="id" value={templateId} />
      <label className="block max-w-md space-y-1">
        <span className="block text-muted-foreground">{labels.name}</span>
        <Input
          className="min-h-10"
          name="name"
          maxLength={120}
          value={name}
          readOnly={pending}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }}
        />
      </label>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {gateNames.map((gate) => (
          <label key={gate} className="inline-flex min-w-0 items-center gap-2">
            <input
              type="checkbox"
              className="shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              name={gate}
              value="1"
              checked={gates[gate]}
              disabled={pending}
              onChange={(event) => setGates({ ...gates, [gate]: event.target.checked })}
            />
            {labels[gate]}
          </label>
        ))}
      </div>
      <Button type="submit" aria-disabled={pending} className="min-h-10 whitespace-normal text-center aria-disabled:opacity-60">
        {pending ? labels.cloning : labels.clone}
      </Button>
      <p role="status" className={pending ? "sr-only" : "rounded-lg border bg-card p-3 empty:hidden"}>
        {pending ? labels.cloning : result === "cloned" ? feedback.cloned : null}
      </p>
      <p role="alert" className="rounded-lg border border-destructive/30 bg-card p-3 text-destructive empty:hidden">
        {!pending && error ? feedback[error] : null}
      </p>
    </form>
  );
}
