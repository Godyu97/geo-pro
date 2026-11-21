import type { BrandFields } from "../brands/contracts.ts";
import { functionalMockMarker } from "./mode.ts";

/** Synthetic brand fields. The marker stays in stored text so a row cannot be read as a real pilot brand. */
export const mockBrandFields: BrandFields = {
  name: `${functionalMockMarker} 北湾茶饮`,
  description: `${functionalMockMarker} 功能性 mock 品牌资料，不是获准试点，也不能当作真实监测对象。`,
  website: "",
  aliases: [`${functionalMockMarker} 北湾`],
  region: "CN",
  language: "zh-CN",
  competitors: [`${functionalMockMarker} 对照品牌`],
  questions: [`${functionalMockMarker} 上班族适合买哪种袋泡茶`],
};
