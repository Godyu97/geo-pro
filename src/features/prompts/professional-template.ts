import type { PromptQuestion } from "./contracts.ts";

export const professionalTemplateNote = "template:professional-v1";
export const quickActiveLimit = 10;
export const professionalActiveLimit = 60;

type TemplateRow = {
  key: string;
  text: string;
  type: PromptQuestion["type"];
  stage: PromptQuestion["stage"];
};

const chinese: TemplateRow[] = [
  ["discovery", "awareness", "公开资料里，这个品类的适用对象和排除对象通常怎么划分？"],
  ["discovery", "awareness", "选型初期，容量上限、并发峰值和扩容方式要分开核对什么？"],
  ["discovery", "awareness", "接口说明中，输入格式、错误码和幂等行为分别看哪一段？"],
  ["discovery", "awareness", "网络隔离场景下，账号来源、访问边界和审计出口怎么列明？"],
  ["discovery", "awareness", "替换旧系统前，历史档案迁出范围和回滚点要确认什么？"],
  ["discovery", "awareness", "多网点同时启用时，角色分层、值班交接和本地覆盖怎么描述？"],
  ["discovery", "awareness", "合规抽查前，日志留存期限、导出字段和脱敏规则看什么？"],
  ["discovery", "awareness", "采购清单上，实施周期、培训场次和验收样本怎么分开写？"],
  ["discovery", "awareness", "巡检准备时，告警阈值、静默窗口和升级路径要核对什么？"],
  ["discovery", "awareness", "跨地区落地时，界面语言、本地节假日和工作时段怎么写进需求？"],
  ["scenario", "consider", "早班交接时，未关闭的工单和临时授权要先看哪些记录？"],
  ["scenario", "consider", "促销高峰当天，排队长度和备用通道怎么提前约定？"],
  ["scenario", "consider", "新员工独立操作前，演练数据和回退步骤要准备什么？"],
  ["scenario", "consider", "夜间无人值守时，自动处置和次日复核怎么衔接？"],
  ["scenario", "consider", "门店短暂断网时，本地缓存和恢复后补传怎么安排？"],
  ["scenario", "consider", "季度盘点期间，冻结库存和继续接单的边界怎么定？"],
  ["scenario", "consider", "外包团队进场当天，可见范围和离开时的交接清单是什么？"],
  ["scenario", "consider", "设备返厂维修期间，替代流程和客户告知由谁执行？"],
  ["scenario", "consider", "法规临时更新后，哪些操作要暂停、哪些可以继续？"],
  ["scenario", "consider", "多品牌共用仓库时，货位、标签和责任人怎么避免混放？"],
  ["constraint", "consider", "年度预算封顶后，哪些功能可以延后、哪些必须保留？"],
  ["constraint", "consider", "只能内网部署时，更新包、时钟源和许可证怎么获取？"],
  ["constraint", "decide", "账号必须对接现有目录时，组和角色的映射限制是什么？"],
  ["constraint", "decide", "数据不能出境时，备份位置、日志节点和客服座席怎么选？"],
  ["constraint", "decide", "停机窗口只有两小时时，切换顺序和失败回退怎么排？"],
  ["constraint", "decide", "合同期短于一年时，退出资料、导出频率和费用怎么约定？"],
  ["constraint", "consider", "现场没有专职运维时，远程协助和本地值守怎么分工？"],
  ["constraint", "consider", "硬件型号已停产时，替代配件和兼容测试要卡哪些条件？"],
  ["constraint", "decide", "只能使用指定浏览器时，插件、证书和打印组件有什么限制？"],
  ["constraint", "decide", "客服只在工作日在线时，夜间故障的响应等级怎么写？"],
  ["comparison", "compare", "两套方案的报价结构里，实施费和后续维护费怎么对照？"],
  ["comparison", "compare", "交付周期上，试点上线和全量切换分别差在哪一步？"],
  ["comparison", "compare", "售后响应里，远程处理和现场到场的覆盖范围怎么区分？"],
  ["comparison", "compare", "迁移工作量上，历史数据、账号和报表各要投入什么？"],
  ["comparison", "compare", "合同弹性上，增减席位、暂停服务和到期退出怎么写？"],
  ["brand_fact", "decide", "该品牌已发布的服务区域和暂不覆盖地区是什么？"],
  ["brand_fact", "decide", "该品牌文档列出的标准集成对象有哪些？"],
  ["brand_fact", "decide", "该品牌公开说明里，可选择的部署形态是什么？"],
  ["brand_fact", "decide", "该品牌公布的人工支持时段和联系入口是什么？"],
  ["brand_fact", "decide", "该品牌对客户数据的保存位置和删除方式怎么表述？"],
  ["exploration", "awareness", "相邻品类里，最近出现了哪些还没进入主清单的问法？"],
  ["exploration", "consider", "试点门店反馈中，哪些长尾场景值得下轮单独观察？"],
  ["exploration", "consider", "如果只服务流动摊位，现有题库还缺哪类限制？"],
  ["exploration", "awareness", "季节性展会期间，临时租赁和短期账号要不要单列？"],
  ["exploration", "compare", "只读查看和可执行操作如果拆开，会多出什么问题？"],
  ["exploration", "consider", "合作方代操作时，责任边界有哪些主清单没覆盖的说法？"],
  ["exploration", "decide", "旧合同仍在履行时，新条款能否只对新增门店生效？"],
  ["exploration", "consider", "语音值守和文字工单并用时，记录口径会分叉在哪里？"],
  ["exploration", "awareness", "社区团购渠道如果加入，履约时限要额外问什么？"],
  ["exploration", "decide", "只保留审计导出、关闭日常功能时，还要确认什么？"],
].map(([type, stage, text], index) => ({
  key: `professional-v1-zh-${index + 1}`,
  text,
  type: type as PromptQuestion["type"],
  stage: stage as PromptQuestion["stage"],
}));

const english: TemplateRow[] = [
  ["discovery", "awareness", "Which included and excluded buyers appear in public category notes?"],
  ["discovery", "awareness", "Where are capacity ceilings, peak concurrency, and expansion steps listed?"],
  ["discovery", "awareness", "Which section covers payload formats, error codes, and idempotent retries?"],
  ["discovery", "awareness", "How are account sources, access edges, and audit exits described for isolated networks?"],
  ["discovery", "awareness", "What archive scope and rollback point should be confirmed before replacing an old system?"],
  ["discovery", "awareness", "How do role layers, shift handoff, and local overrides get written for many sites?"],
  ["discovery", "awareness", "Which retention period, export fields, and masking rules matter in a compliance review?"],
  ["discovery", "awareness", "How are rollout duration, training sessions, and acceptance samples split on a purchase list?"],
  ["discovery", "awareness", "What alarm threshold, quiet window, and escalation path should be checked before inspections?"],
  ["discovery", "awareness", "How do interface language, local holidays, and working hours enter a multi-region request?"],
  ["scenario", "consider", "At morning handoff, which open tickets and temporary grants should be read first?"],
  ["scenario", "consider", "On a promotion peak day, how are queue length and a spare lane agreed in advance?"],
  ["scenario", "consider", "Before a new hire works alone, what drill data and rollback steps are prepared?"],
  ["scenario", "consider", "During an unattended night, how do automatic actions connect to the next-day review?"],
  ["scenario", "consider", "When a shop loses connectivity briefly, how are local cache and later catch-up arranged?"],
  ["scenario", "consider", "During a quarterly count, where is the line between frozen stock and new orders?"],
  ["scenario", "consider", "On a contractor's first day, what visibility ends when the exit checklist is signed?"],
  ["scenario", "consider", "While equipment is away for repair, who runs the substitute flow and tells customers?"],
  ["scenario", "consider", "After a sudden rule change, which actions pause and which ones may continue?"],
  ["scenario", "consider", "When several labels share one warehouse, how are bins and owners kept from mixing?"],
  ["constraint", "consider", "Once the yearly budget is capped, which capabilities wait and which ones stay?"],
  ["constraint", "consider", "If deployment stays on a private network, where do update packages, clocks, and licenses come from?"],
  ["constraint", "decide", "When accounts must join an existing directory, what group and role mapping limits apply?"],
  ["constraint", "decide", "If data cannot leave the country, how are backup sites, log nodes, and support seats chosen?"],
  ["constraint", "decide", "With only a two-hour outage window, how are cutover order and failed rollback sequenced?"],
  ["constraint", "decide", "For a contract shorter than one year, how are exit files, export cadence, and fees written?"],
  ["constraint", "consider", "Without an on-site operator, how are remote help and local watch divided?"],
  ["constraint", "consider", "When a hardware model is discontinued, which spare parts and compatibility checks remain?"],
  ["constraint", "decide", "If only one browser is allowed, what plugin, certificate, and print limits apply?"],
  ["constraint", "decide", "When support is online on weekdays only, how is the night-fault response level written?"],
  ["comparison", "compare", "In two quotes, how do implementation fees differ from later maintenance fees?"],
  ["comparison", "compare", "On delivery timing, where do a pilot launch and a full cutover diverge?"],
  ["comparison", "compare", "For after-sales response, how do remote handling and on-site arrival differ in coverage?"],
  ["comparison", "compare", "For migration effort, what separate work do archives, accounts, and reports require?"],
  ["comparison", "compare", "In contract flexibility, how are seat changes, pauses, and exit at expiry written?"],
  ["brand_fact", "decide", "Which service areas has this brand published, and which areas are still excluded?"],
  ["brand_fact", "decide", "Which standard integrations does this brand's documentation list?"],
  ["brand_fact", "decide", "Which deployment forms does this brand's public note say can be selected?"],
  ["brand_fact", "decide", "What staffed support hours and contact entry does this brand publish?"],
  ["brand_fact", "decide", "How does this brand describe where customer data is stored and how it is deleted?"],
  ["exploration", "awareness", "Which new phrasings in a neighboring category are still outside the main list?"],
  ["exploration", "consider", "Which long-tail situations from pilot shops deserve a separate look next round?"],
  ["exploration", "consider", "If service is limited to mobile stalls, which constraint is still missing from the bank?"],
  ["exploration", "awareness", "During a seasonal fair, should short rentals and temporary accounts be listed apart?"],
  ["exploration", "compare", "If view-only access is split from actions that change data, what extra question appears?"],
  ["exploration", "consider", "When a partner operates on behalf of the buyer, which responsibility lines are not on the main list?"],
  ["exploration", "decide", "While an old contract is still running, can new terms apply only to newly added shops?"],
  ["exploration", "consider", "When voice watch and written tickets run together, where do the records diverge?"],
  ["exploration", "awareness", "If a community group-buy lane is added, what fulfillment timing question is extra?"],
  ["exploration", "decide", "If only audit export stays and everyday features close, what still needs confirmation?"],
].map(([type, stage, text], index) => ({
  key: `professional-v1-en-${index + 1}`,
  text,
  type: type as PromptQuestion["type"],
  stage: stage as PromptQuestion["stage"],
}));

export function isProfessionalDraft(questions: readonly { sourceNote: string }[]) {
  return questions.some((question) => question.sourceNote === professionalTemplateNote);
}

export function activeQuestionLimit(questions: readonly { sourceNote: string }[]) {
  return isProfessionalDraft(questions) ? professionalActiveLimit : quickActiveLimit;
}

export function professionalTemplate(language: string): Array<TemplateRow & {
  source: "generated";
  sourceNote: typeof professionalTemplateNote;
}> {
  const rows = language.toLowerCase().startsWith("zh") ? chinese : english;
  return rows.map((row) => ({ ...row, source: "generated" as const, sourceNote: professionalTemplateNote }));
}

export function professionalCategoryPreview(questions: readonly {
  status: string;
  type: string;
  brandTerm?: boolean;
  primary?: boolean;
}[]) {
  const active = questions.filter((question) => question.status !== "inactive");
  const count = (type: string) => active.filter((question) => question.type === type).length;
  const nonBrandCore = count("discovery") + count("scenario") + count("constraint");
  return {
    nonBrandCore,
    comparison: count("comparison"),
    brandFact: count("brand_fact"),
    exploration: count("exploration"),
    primary: active.filter((question) => (
      (question.type === "discovery" || question.type === "scenario" || question.type === "constraint") && !question.brandTerm
    )).length,
    confirmedPrimary: active.filter((question) => question.primary).length,
  };
}
