import {
  Building2,
  MessagesSquare,
  Radar,
  Link2,
  UsersRound,
  WandSparkles,
} from "lucide-react";

// Navigation metadata only. No business data or routes are implied.
export const moduleLinks = [
  {
    id: "brands",
    title: "品牌资料",
    icon: Building2,
    description: "整理品牌身份与可核验事实，为后续观察建立起点。",
    empty: "尚未配置品牌资料",
  },
  {
    id: "monitoring",
    title: "AI 监测",
    icon: Radar,
    description: "围绕真实购买问题，留存 AI 回答及其采样条件。",
    empty: "暂无监测数据",
  },
  {
    id: "prompts",
    title: "提示词问题库",
    icon: MessagesSquare,
    description: "从客户的问题出发，逐步形成可复测的题集。",
    empty: "尚未配置监测问题",
  },
  {
    id: "citations",
    title: "网页引用",
    icon: Link2,
    description: "回到回答原文，查看引用页面与来源证据。",
    empty: "暂无引用证据",
  },
  {
    id: "competitors",
    title: "竞品对比",
    icon: UsersRound,
    description: "在明确范围与相同条件下，观察品牌之间的差异。",
    empty: "尚未配置竞品",
  },
  {
    id: "optimization",
    title: "优化建议",
    icon: WandSparkles,
    description: "把有依据的观察，转化为可核验的内容动作。",
    empty: "暂无优化建议",
  },
] as const;
