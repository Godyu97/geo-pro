"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { loginPath } from "@/lib/auth/return-to";
import { useLocale } from "@/lib/i18n/client";
import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { isDisplayNameError, profileSessionHeader, profileUpdateSchema } from "./profile";

type Feedback = "saved" | "saveFailed" | "sessionChanged";

export function ProfileForm({
  userId,
  name,
  messages,
}: {
  userId: string;
  name: string;
  messages: Messages["settings"];
}) {
  const { locale, t: common } = useLocale();
  const t = createTranslator(locale, messages);
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const form = useForm({
    resolver: zodResolver(profileUpdateSchema),
    defaultValues: { name },
  });
  const pending = form.formState.isSubmitting;

  async function save(values: { name: string }) {
    setFeedback(null);

    try {
      const result = await authClient.updateUser({
        name: values.name,
        fetchOptions: { headers: { [profileSessionHeader]: userId } },
      });

      if (result.error?.status === 401) {
        const { pathname, search, hash } = window.location;
        window.location.replace(loginPath(`${pathname}${search}${hash}`, "session-required"));
        return;
      }

      const code = result.error?.code;
      if (isDisplayNameError(code)) {
        form.setError("name", { message: code }, { shouldFocus: true });
        return;
      }

      if (result.error || result.data?.status !== true) {
        setFeedback(code === "PROFILE_SESSION_CHANGED" ? "sessionChanged" : "saveFailed");
        return;
      }

      form.reset(values);
      setFeedback("saved");
      router.refresh();
    } catch {
      setFeedback("saveFailed");
    }
  }

  return (
    <Form {...form}>
      <form
        method="post"
        onSubmit={form.handleSubmit(save, () => setFeedback(null))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
        }}
        noValidate
        aria-busy={pending}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="name"
          render={({ field, fieldState }) => {
            const error = fieldState.error?.message;
            return (
              <FormItem>
                <FormLabel>{t("displayName")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="name"
                    readOnly={pending}
                    onChange={(event) => {
                      setFeedback(null);
                      field.onChange(event);
                    }}
                    className="h-11"
                  />
                </FormControl>
                <FormDescription>{t("nameHint")}</FormDescription>
                {isDisplayNameError(error) && <FormMessage>{t(error)}</FormMessage>}
              </FormItem>
            );
          }}
        />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" disabled={pending} className="min-h-10">{t(pending ? "saving" : "save")}</Button>
          {feedback === "saved" && <p role="status" className="text-sm">{t("saved")}</p>}
        </div>
        {feedback && feedback !== "saved" && (
          <div className="space-y-2">
            <p role="alert" className="text-sm leading-6 text-destructive">{t(feedback)}</p>
            {feedback === "sessionChanged" && (
              <Button type="button" variant="outline" onClick={() => window.location.reload()}>
                {common("retry")}
              </Button>
            )}
          </div>
        )}
      </form>
    </Form>
  );
}
