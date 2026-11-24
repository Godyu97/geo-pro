import Link from "next/link";

import { taskDisplayLabels, type TaskLabelMessages } from "./task-labels.ts";
import type { TaskStatus } from "./contracts.ts";

export function TaskSummaryList({
  items,
  messages,
  empty,
}: {
  items: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    priorityBucket: "urgent" | "normal";
    href: string;
  }>;
  messages: TaskLabelMessages;
  empty: string;
}) {
  if (items.length === 0) {
    return (
      <p className="break-words rounded-xl border border-dashed bg-card px-4 py-5 text-sm leading-6 text-muted-foreground">
        {empty}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const labels = taskDisplayLabels(messages, item);
        return (
          <li key={item.id} className="min-w-0 rounded-xl border bg-card px-4 py-3 text-sm">
            <Link href={item.href} prefetch={false} className="break-words font-medium underline-offset-4 hover:underline">
              {item.title}
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              {labels.priority} · {labels.status}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
