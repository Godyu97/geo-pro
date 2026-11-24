"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, LoaderCircle } from "lucide-react";
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
  useFormField,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { accountAccessPath } from "@/features/account/email/contracts";
import { authClient } from "@/lib/auth/client";
import { safeReturnTo } from "@/lib/auth/return-to";
import {
  isValidationKey,
  signInFormSchema,
  signUpSchema,
  type AuthFormValues,
} from "@/lib/auth/validation";

import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { useLocale } from "@/lib/i18n/client";

const errorKeys: Record<string, keyof Messages["auth"]> = {
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  INVALID_EMAIL: "emailInvalid",
  USER_ALREADY_EXISTS: "accountExists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "accountExists",
  PASSWORD_TOO_SHORT: "passwordMin",
  PASSWORD_TOO_LONG: "passwordMax",
  TOO_MANY_REQUESTS: "tooManyRequests",
  INVALID_ORIGIN: "originUnavailable",
};

function loginReturnTo(returnTo: string, fragment: string) {
  const target = new URL(safeReturnTo(returnTo), window.location.origin);
  if (!target.hash) target.hash = fragment;
  return safeReturnTo(`${target.pathname}${target.search}${target.hash}`);
}

function subscribeToHashChange(update: () => void) {
  window.addEventListener("hashchange", update);
  return () => window.removeEventListener("hashchange", update);
}

export function LoginRecoveryLink({ returnTo, resumeFragment, children }: {
  returnTo: string;
  resumeFragment: boolean;
  children: string;
}) {
  // The browser inherits the protected page fragment after an HTTP redirect.
  const fragment = useSyncExternalStore(subscribeToHashChange, () => window.location.hash, () => "");
  const target = resumeFragment && fragment ? loginReturnTo(returnTo, fragment) : returnTo;
  return (
    <Link href={accountAccessPath("forgot", target)} prefetch={false}
      className="mt-5 block text-center text-sm underline underline-offset-4">
      {children}
    </Link>
  );
}

function AuthFormMessage({ messages }: { messages: Messages["auth"] }) {
  const { error } = useFormField();
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  return (
    <FormMessage>
      {error ? t(isValidationKey(error.message) ? error.message : "unavailable") : null}
    </FormMessage>
  );
}

export function AuthForm({
  configured,
  unavailable = false,
  messages,
  returnTo,
}: {
  configured: boolean;
  unavailable?: boolean;
  messages: Messages["auth"];
  returnTo: string;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const mode = useSearchParams().get("mode") === "signup" ? "signup" : "login";
  const [error, setError] = useState<keyof Messages["auth"] | null>(null);
  const router = useRouter();
  const form = useForm<AuthFormValues>({
    resolver: zodResolver(mode === "signup" ? signUpSchema : signInFormSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const pending = form.formState.isSubmitting;
  const disabled = pending || !configured || unavailable;

  async function onSubmit(values: AuthFormValues) {
    if (disabled) return;
    setError(null);

    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({
              name: values.name,
              email: values.email,
              password: values.password,
            })
          : await authClient.signIn.email({
              email: values.email,
              password: values.password,
            });

      if (result.error) {
        setError(
          result.error.status === 429
            ? "tooManyRequests"
            : errorKeys[result.error.code ?? ""] ?? "unavailable",
        );
        return;
      }

      // Replace the document to clear credentials and private router caches.
      window.location.replace(loginReturnTo(returnTo, window.location.hash));
    } catch {
      setError("networkError");
    }
  }

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        if (value !== "login" && value !== "signup") return;
        const target = new URL(window.location.href);
        const currentMode = target.searchParams.get("mode") === "signup" ? "signup" : "login";
        if (value === currentMode) return;
        if (value === "signup") target.searchParams.set("mode", value);
        else target.searchParams.delete("mode");
        window.history.pushState(null, "", target);
        setError(null);
        form.clearErrors();
      }}
    >
      <TabsList className="mb-5 h-10 w-full" aria-label={t("operations")}>
        <TabsTrigger value="login" disabled={pending}>
          {t("login")}
        </TabsTrigger>
        <TabsTrigger value="signup" disabled={pending}>
          {t("signup")}
        </TabsTrigger>
      </TabsList>
      <TabsContent value={mode}>
        {(!configured || unavailable) && (
          <p
            role="status"
            className="mb-5 rounded-lg border bg-muted p-3 text-sm leading-6 text-muted-foreground"
          >
            {t(unavailable ? "unavailable" : "notConfigured")}
            <Button type="button" variant="outline" className="mt-3 flex" onClick={() => router.refresh()}>
              {t("retry")}
            </Button>
          </p>
        )}
        <Form {...form}>
          <form
            method="post"
            onSubmit={form.handleSubmit(onSubmit)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing) {
                event.preventDefault();
              }
            }}
            noValidate
            className="space-y-5"
            aria-busy={pending}
          >
            {mode === "signup" && (
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("name")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder={t("namePlaceholder")}
                        autoComplete="name"
                        maxLength={160}
                        disabled={disabled}
                        className="h-11 bg-white"
                      />
                    </FormControl>
                    <FormDescription className="sr-only">
                      {t("nameDescription")}
                    </FormDescription>
                    <AuthFormMessage messages={messages} />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("email")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder={t("emailPlaceholder")}
                      autoComplete="email"
                      maxLength={254}
                      disabled={disabled}
                      className="h-11 bg-white"
                    />
                  </FormControl>
                  <FormDescription className="sr-only">
                    {t("emailDescription")}
                  </FormDescription>
                  <AuthFormMessage messages={messages} />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("password")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      placeholder={t("passwordPlaceholder")}
                      autoComplete={
                        mode === "signup" ? "new-password" : "current-password"
                      }
                      maxLength={128}
                      disabled={disabled}
                      className="h-11 bg-white"
                    />
                  </FormControl>
                  <FormDescription>
                    {mode === "signup"
                      ? t("signupPasswordHint")
                      : t("loginPasswordHint")}
                  </FormDescription>
                  <AuthFormMessage messages={messages} />
                </FormItem>
              )}
            />
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm leading-6 text-destructive"
              >
                {t(error)}
              </p>
            )}
            <Button
              type="submit"
              className="h-11 w-full"
              disabled={disabled}
            >
              {pending ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                  {t(mode === "signup" ? "creating" : "signingIn")}
                </>
              ) : (
                <>
                  {mode === "signup"
                    ? t("signupSubmit")
                    : t("loginSubmit")}
                  <ArrowRight aria-hidden="true" />
                </>
              )}
            </Button>
          </form>
        </Form>
      </TabsContent>
    </Tabs>
  );
}
