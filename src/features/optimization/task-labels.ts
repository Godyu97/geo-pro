import type { TaskStatus } from "./contracts.ts";

const statusKeys = {
  todo: "statusTodo",
  doing: "statusDoing",
  blocked: "statusBlocked",
  implemented: "statusImplemented",
  retest_pending: "statusRetestPending",
  closed: "statusClosed",
  dismissed: "statusDismissed",
} as const satisfies Record<TaskStatus, string>;

const priorityKeys = {
  urgent: "priorityUrgent",
  normal: "priorityNormal",
} as const;

export type TaskLabelMessages = {
  [Key in (typeof statusKeys)[TaskStatus] | (typeof priorityKeys)["urgent" | "normal"]]: string;
};

export function taskDisplayLabels(
  messages: TaskLabelMessages,
  task: { status: TaskStatus; priorityBucket: "urgent" | "normal" },
) {
  return {
    priority: messages[priorityKeys[task.priorityBucket]],
    status: messages[statusKeys[task.status]],
  };
}

export function taskStatusOptions(messages: TaskLabelMessages) {
  return (Object.keys(statusKeys) as TaskStatus[]).map((status) => ({
    value: status,
    label: messages[statusKeys[status]],
  }));
}
