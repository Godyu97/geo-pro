"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { authClient } from "@/lib/auth/client";
import {
  isValidationKey,
  signInFormSchema,
  signUpSchema,
  type AuthFormValues,
} from "@/lib/auth/validation";

import type { Messages } from "@/lib/i18n/server";
import { createTranslator } from "@/lib/i18n/translate";
import { useLocale } from "@/lib/i18n/client";

type AuthMode = "login" | "signup";

const errorKeys: Record<string, keyof Messages["auth"]> = {
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  USER_ALREADY_EXISTS: "accountExists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "accountExists",
  PASSWORD_TOO_SHORT: "passwordMin",
  PASSWORD_TOO_LONG: "passwordMax",
  TOO_MANY_REQUESTS: "tooManyRequests",
};

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
  initialMode,
  configured,
  messages,
  returnTo,
}: {
  initialMode: AuthMode;
  configured: boolean;
  messages: Messages["auth"];
  returnTo: string;
}) {
  const { locale } = useLocale();
  const t = createTranslator(locale, messages);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [error, setError] = useState<keyof Messages["auth"] | null>(null);
  const router = useRouter();
  const form = useForm<AuthFormValues>({
    resolver: zodResolver(mode === "signup" ? signUpSchema : signInFormSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const pending = form.formState.isSubmitting;

  async function onSubmit(values: AuthFormValues) {
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

      router.replace(returnTo);
      router.refresh();
    } catch {
      setError("networkError");
    }
  }

  return (
    <Tabs
      value={mode}
      onValueChange={(value) => {
        if (value === "login" || value === "signup") {
          setMode(value);
          setError(null);
          form.clearErrors();
        }
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
        {!configured && (
          <p
            role="status"
            className="mb-5 rounded-lg border bg-muted p-3 text-sm leading-6 text-muted-foreground"
          >
            {t("notConfigured")}
          </p>
        )}
        <Form {...form}>
          <form
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
                        disabled={pending || !configured}
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
                      disabled={pending || !configured}
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
                      disabled={pending || !configured}
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
              disabled={pending || !configured}
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
