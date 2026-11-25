import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="min-w-0 space-y-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Skeleton aria-hidden="true" className="h-28 w-full rounded-2xl" />
      <Skeleton aria-hidden="true" className="h-56 w-full rounded-2xl" />
    </div>
  );
}
