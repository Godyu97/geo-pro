import {
  Building2, MessagesSquare, Radar, Link2, UsersRound, WandSparkles,
} from "lucide-react";
import type { Messages } from "@/lib/i18n/server";

// Navigation metadata only. No business data or routes are implied.
export function getModuleLinks(messages: Messages["modules"]) {
  return [
    {
      id: "brands",
      icon: Building2,
      title: messages.brandsTitle,
      description: messages.brandsDescription,
      empty: messages.brandsEmpty,
    },
    {
      id: "monitoring",
      icon: Radar,
      title: messages.monitoringTitle,
      description: messages.monitoringDescription,
      empty: messages.monitoringEmpty,
    },
    {
      id: "prompts",
      icon: MessagesSquare,
      title: messages.promptsTitle,
      description: messages.promptsDescription,
      empty: messages.promptsEmpty,
    },
    {
      id: "citations",
      icon: Link2,
      title: messages.citationsTitle,
      description: messages.citationsDescription,
      empty: messages.citationsEmpty,
    },
    {
      id: "competitors",
      icon: UsersRound,
      title: messages.competitorsTitle,
      description: messages.competitorsDescription,
      empty: messages.competitorsEmpty,
    },
    {
      id: "optimization",
      icon: WandSparkles,
      title: messages.optimizationTitle,
      description: messages.optimizationDescription,
      empty: messages.optimizationEmpty,
    },
  ] as const;
}
