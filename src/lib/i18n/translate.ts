import type { Locale } from "./locale";

export type MessageParams = Record<string, string | number>;

const safeMessages = {
  "zh-CN": "暂时无法显示此内容，请稍后重试。",
  en: "This content is temporarily unavailable. Please try again.",
};

export function createTranslator<T extends Record<string, string>>(
  locale: Locale,
  messages: T,
  fallback?: T,
) {
  return (key: keyof T & string, params: MessageParams = {}): string => {
    const template = messages[key] || fallback?.[key];
    const required = template?.match(/\{\w+\}/g) ?? [];
    if (!messages[key] || required.some((parameter) => !(parameter.slice(1, -1) in params))) {
      // Never log interpolation values: they may contain private user input.
      console.error("i18n: missing message or parameter", { locale, key });
    }
    if (!template || required.some((parameter) => !(parameter.slice(1, -1) in params))) {
      return safeMessages[locale];
    }
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]));
  };
}
