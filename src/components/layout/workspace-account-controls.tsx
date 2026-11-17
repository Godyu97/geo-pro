"use client";

import { usePathname } from "next/navigation";

import { LanguageSwitcher } from "./language-switcher";
import { SignOutButton } from "./sign-out-button";

export function WorkspaceAccountControls() {
  const pathname = usePathname();
  if (pathname === "/dashboard/settings") return null;

  return (
    <>
      <LanguageSwitcher />
      <SignOutButton />
    </>
  );
}
