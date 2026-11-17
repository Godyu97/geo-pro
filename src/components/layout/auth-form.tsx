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
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient } from "@/lib/auth/client";
import {
  signInFormSchema,
  signUpSchema,
  type AuthFormValues,
} from "@/lib/auth/validation";

type AuthMode = "login" | "signup";

const errorMessages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码不正确，请检查后重试。",
  USER_ALREADY_EXISTS: "暂时无法创建账号。如已有账号，请切换到登录。",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "暂时无法创建账号。如已有账号，请切换到登录。",
  PASSWORD_TOO_SHORT: "密码至少需要 8 个字符。",
  PASSWORD_TOO_LONG: "密码最多 128 个字符。",
  TOO_MANY_REQUESTS: "操作过于频繁，请稍后再试。",
};

export function AuthForm({
  initialMode,
  configured,
}: {
  initialMode: AuthMode;
  configured: boolean;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [error, setError] = useState<string | null>(null);
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
          errorMessages[result.error.code ?? ""] ??
            "认证服务暂不可用，请稍后重试。",
        );
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("暂时无法连接认证服务，请检查网络后重试。");
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
      <TabsList className="mb-5 h-10 w-full" aria-label="账号操作">
        <TabsTrigger value="login" disabled={pending}>
          登录
        </TabsTrigger>
        <TabsTrigger value="signup" disabled={pending}>
          创建账号
        </TabsTrigger>
      </TabsList>
      <TabsContent value={mode}>
        {!configured && (
          <p
            role="status"
            className="mb-5 rounded-lg border bg-muted p-3 text-sm leading-6 text-muted-foreground"
          >
            账号服务尚未配置，请联系维护者完成配置后再试。
          </p>
        )}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
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
                    <FormLabel>称呼</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="你的称呼"
                        autoComplete="name"
                        maxLength={80}
                        disabled={pending || !configured}
                        className="h-11 bg-white"
                      />
                    </FormControl>
                    <FormDescription className="sr-only">
                      用于工作台中的欢迎称呼
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>邮箱</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="name@example.com"
                      autoComplete="email"
                      maxLength={254}
                      disabled={pending || !configured}
                      className="h-11 bg-white"
                    />
                  </FormControl>
                  <FormDescription className="sr-only">
                    使用此邮箱登录账号
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>密码</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      placeholder="请输入密码"
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
                      ? "使用 8–128 个字符，不要与其他网站共用密码。"
                      : "请输入创建账号时设置的密码。"}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-sm leading-6 text-destructive"
              >
                {error}
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
                  正在{mode === "signup" ? "创建账号" : "登录"}…
                </>
              ) : (
                <>
                  {mode === "signup"
                    ? "创建账号并进入工作台"
                    : "登录并进入工作台"}
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
