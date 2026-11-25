"use client";

import { startTransition, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { publishChannelProfileAction, type ChannelProfilePublishFeedback } from "./actions";

export function ProfilePublishForm({ brandId, labels, feedback }: {
  brandId: string;
  labels: Record<"channelKey" | "channelKeyHint" | "maxCharacters" | "maxCharactersHint" | "note" | "publish" | "publishing", string>;
  feedback: Record<ChannelProfilePublishFeedback, string>;
}) {
  const [error, submit, pending] = useActionState(publishChannelProfileAction, null);

  return (
    <Card className="max-w-xl">
      <CardContent>
        <form
          action={submit}
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            const data = new FormData(event.currentTarget);
            startTransition(() => submit(data));
          }}
        >
          <input type="hidden" name="brandId" value={brandId} />
          <div className="space-y-1">
            <label htmlFor="profile-channel-key" className="block font-medium">{labels.channelKey}</label>
            <Input id="profile-channel-key" name="channelKey" required pattern={"[a-z0-9][a-z0-9_\\-]*"}
              maxLength={64} readOnly={pending} aria-describedby="profile-channel-key-hint" className="h-10 scroll-mt-24 bg-background" />
            <p id="profile-channel-key-hint" className="text-muted-foreground">{labels.channelKeyHint}</p>
          </div>
          <div className="space-y-1">
            <label htmlFor="profile-character-limit" className="block font-medium">{labels.maxCharacters}</label>
            <Input id="profile-character-limit" name="maxCharacters" type="number" inputMode="numeric" min={1} max={1000000} step={1}
              readOnly={pending} aria-describedby="profile-character-limit-hint" className="h-10 bg-background" />
            <p id="profile-character-limit-hint" className="text-muted-foreground">{labels.maxCharactersHint}</p>
          </div>
          <label className="block space-y-1">
            <span className="block font-medium">{labels.note}</span>
            <textarea name="note" required rows={3} maxLength={2000} readOnly={pending}
              className="w-full min-w-0 rounded-lg border border-input bg-background px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm" />
          </label>
          <Button type="submit" aria-disabled={pending}
            className="min-h-10 whitespace-normal justify-self-start text-center aria-disabled:opacity-60">
            {pending ? labels.publishing : labels.publish}
          </Button>
          <p role="status" className="sr-only">{pending ? labels.publishing : ""}</p>
          <p role="alert" className="rounded-lg border border-destructive/30 bg-card p-3 text-destructive empty:hidden">
            {!pending && error ? feedback[error] : null}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
