import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function messageParameters(message) {
  return [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
}

export function validateCatalogs(catalogs) {
  const [baseline, ...others] = Object.entries(catalogs);
  if (!baseline || !others.length) throw new Error("At least two message catalogs are required");
  function flatten(value, prefix = "") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, message]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof message === "string") {
        if (!message.trim()) throw new Error(`Empty message: ${path}`);
        return [[path, message]];
      }
      if (!message || Array.isArray(message) || typeof message !== "object") {
        throw new Error(`Invalid message: ${path}`);
      }
      return Object.entries(flatten(message, path));
    }));
  }
  const expected = flatten(baseline[1]);
  for (const [locale, catalog] of others) {
    const actual = flatten(catalog);
    if (JSON.stringify(Object.keys(actual).sort()) !== JSON.stringify(Object.keys(expected).sort())) {
      throw new Error(`Message keys differ: ${locale}`);
    }
    for (const key of Object.keys(expected)) {
      if (JSON.stringify(messageParameters(expected[key])) !== JSON.stringify(messageParameters(actual[key]))) {
        throw new Error(`Message parameters differ: ${locale}.${key}`);
      }
    }
  }
  return Object.keys(expected).length;
}

export async function checkMessages() {
  const catalogs = Object.fromEntries(await Promise.all(["zh-CN", "en"].map(async (locale) => [
    locale, JSON.parse(await readFile(new URL(`../src/lib/i18n/messages/${locale}.json`, import.meta.url), "utf8")),
  ])));
  const fatal = JSON.parse(await readFile(new URL("../src/lib/i18n/messages/fatal.json", import.meta.url), "utf8"));
  return validateCatalogs(catalogs) + validateCatalogs(fatal);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(`PASS: ${await checkMessages()} message keys and interpolation parameters match in zh-CN / en`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
