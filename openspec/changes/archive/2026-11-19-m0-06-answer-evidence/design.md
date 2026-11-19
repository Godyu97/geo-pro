# Design

## Context

#12 已在 `monitoring_attempt.raw_text` 保存采用原文，但可被 updateAttempt 改写，且无 Observation/Citation/AnalysisVersion。S-M0-06 要求不可变原文、引用合同与可追加分析修订。真实通道开通属 #31；本变更用隔离 fixture 验收软件合同。

## Goals / Non-Goals

- Goals：双库 schema、DAO、命令（入证/人工草稿/修订/读取）、API、监测详情入口、AC-M0-06-1/2/3 测试、purge contents 清理、i18n。
- Non-Goals：消费者自动采集、报告快照、优化任务、真实供应商、页面抓取、综合 GEO 分。

## Decisions

1. **新领域 `src/features/evidence/`**：Observation/Citation/AnalysisVersion 同域；`citations/` README 指向该实现，避免半成品双写。
2. **表**：`answer_observation`、`answer_citation`、`answer_analysis_version`；observation 对 slot 唯一（非草稿完成态）；原文与 fingerprint 写入后禁止 UPDATE。
3. **引用完整性**：`citation_set_state` = complete|partial|unsupported|missing；仅 complete（含空数组）计入 C。
4. **分析**：初始版本 `classified`/`needs_review`/`pending`；修订只 INSERT 新行，`revised_from` 指向旧版，状态 `revised` 记在被替代版上可选，新版为最新。
5. **入证路径**：`ingestAdoptedAttempt` 从 adopted attempt 复制原文生成 Observation；人工 `submitManualEvidence`；`reviseAnalysis` 追加版本。
6. **判定规则**：fixture/显式标签优先；启发式仅作初判且可修订；AC 用例用显式标签保证稳定。
7. **方言**：Drizzle 双方言 schema + generate；DAO 用 `queryWithParameters`。
8. **清除**：`PurgeDao.clearContents` 增加按 brand_id 删除三表（子表先删）。

## Risks / Trade-offs

- Attempt.raw_text 仍可变：Observation 复制后以 Observation 为准。
- 自动判定启发式可能误判：强制保留修订入口与 needs_review。

## Migration Plan

`pnpm db:generate` → 审核 SQL → `pnpm db:ddl` / `db:ddl:check` → 测试内 `db:migrate`。

## Open Questions

无；真实能力开通留给后续纵向交付。
