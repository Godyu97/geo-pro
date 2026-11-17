"use server";

import { cookies } from "next/headers";
import { z } from "zod";

import { localeCookie, locales } from "./locale";

export async function setLocale(value: unknown) {
  const result = z.enum(locales).safeParse(value);
  if (!result.success) return false;

  (await cookies()).set(localeCookie, result.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return true;
}
