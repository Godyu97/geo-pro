import {
  Building2, FilePenLine, MessagesSquare, Radar, Link2, UsersRound, WandSparkles, ChartNoAxesCombined,
} from "lucide-react";
import type { Messages } from "@/lib/i18n/server";

export const workspaceEntryHrefs = {
  brands: "/dashboard/brands",
  monitoring: "/dashboard/monitoring/overview",
  prompts: "/dashboard/brands/questions",
  citations: "/dashboard/monitoring/answers",
  competitors: "/dashboard/monitoring/competitors",
  optimization: "/dashboard/optimization",
  content: "/dashboard/content",
  reports: "/dashboard/reports",
} as const;

export function getModuleLinks(messages: Messages["modules"]) {
  return [
    {
      id: "brands",
      icon: Building2,
      title: messages.brandsTitle,
      description: messages.brandsDescription,
    },
    {
      id: "monitoring",
      icon: Radar,
      title: messages.monitoringTitle,
      description: messages.monitoringDescription,
    },
    {
      id: "prompts",
      icon: MessagesSquare,
      title: messages.promptsTitle,
      description: messages.promptsDescription,
    },
    {
      id: "citations",
      icon: Link2,
      title: messages.citationsTitle,
      description: messages.citationsDescription,
    },
    {
      id: "competitors",
      icon: UsersRound,
      title: messages.competitorsTitle,
      description: messages.competitorsDescription,
    },
    {
      id: "optimization",
      icon: WandSparkles,
      title: messages.optimizationTitle,
      description: messages.optimizationDescription,
    },
    {
      id: "content",
      icon: FilePenLine,
      title: messages.contentTitle,
      description: messages.contentDescription,
    },
    {
      id: "reports",
      icon: ChartNoAxesCombined,
      title: messages.reportsTitle,
      description: messages.reportsDescription,
    },
  ] as const;
}
