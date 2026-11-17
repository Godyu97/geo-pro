import Link from "next/link";
import { ScanLine } from "lucide-react";

import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="GeoPro 首页"
      className={cn("inline-flex items-center gap-2.5 rounded-md", className)}
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <ScanLine className="size-5" aria-hidden="true" />
      </span>
      <span className="text-xl font-semibold tracking-tight">
        GeoPro<span className="text-primary">.</span>
      </span>
    </Link>
  );
}
