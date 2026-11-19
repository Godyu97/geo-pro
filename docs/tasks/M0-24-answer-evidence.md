# M0-24 回答证据、人工存证与独立判定

Issue [#24](https://github.com/Godyu97/geo-pro/issues/24)｜2026-11-19｜对应 R-M0-06 / S-M0-06 / T-M0-06。AC-M0-06-1/2/3 已在隔离双库用显式双轨 fixture 验证。真实消费者自动采集与正式供应商通道仍由后续纵向交付（如 #31）负责，本项不勾选完整 T-M0-06 以外的下游任务。

## 范围与关键决定

- 新增 `answer_observation` / `answer_citation` / `answer_analysis_version`，原文指纹只追加，分析修订只 INSERT 新版本。
- API 轨从 adopted Attempt 入证；消费者人工可保存草稿；完整空引用计入 C，missing/partial/unsupported 不计入 C。
- 监测运行详情提供入证入口；证据详情页支持纠正判定。
- 品牌 purge contents 删除证据正文；冻结品牌拒绝写入。
- Out-of-Scope：页面抓取、报告快照、优化任务、真实供应商。

## 修改入口

- `src/features/evidence/`、`src/lib/db/evidence-schema(.sqlite).ts`
- `src/app/api/monitoring/answers/`、`src/app/(dashboard)/dashboard/monitoring/evidence/`
- `src/features/brands/purge-dao.ts`、`src/features/monitoring/detail-page.tsx`
- 专项测试：`pnpm test:evidence`

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm test:evidence` | 通过（sqlite + postgresql，覆盖 AC-M0-06-1/2/3、越权、冻结、清除、adopted 入证） |
| `pnpm db:ddl:check` | 通过 |
| `pnpm check:i18n` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 通过（无 error） |
| `pnpm build` | 见提交前执行记录 |

隔离验收使用合成原文与显式标签，不代表真实供应商或试点投递结果。
