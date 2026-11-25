"use client";

import type { ComponentProps } from "react";

export function WorkspaceJump({ href, onClick, ...props }: ComponentProps<"a"> & { href: `#${string}` }) {
  return (
    <a {...props} href={href} onClick={(event) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      const target = document.getElementById(href.slice(1));
      if (!target) return;
      event.preventDefault();
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
    }} />
  );
}
