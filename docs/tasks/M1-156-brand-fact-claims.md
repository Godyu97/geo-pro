# M1-156 品牌核验题主张比对

Issue [#156](https://github.com/Godyu97/geo-pro/issues/156)｜2026-11-26｜对应 R-M1-03 / S-M1-03 第 1、2 条与 AC-M1-03-2。软件验收使用隔离库夹具。不勾选 T-M1-03，不把夹具当成真实品牌样本。

## 范围与关键决定

- `/dashboard/brands/[id]/entity-reviews` 读取当前品牌已保存、且题型为 `brand_fact` 的回答。题目类型来自该次运行钉住的题集版本。自然发现题和其他品牌的回答不进入清单。
- 主张与该品牌最新事实版本比对。有效已批准事实上的数值冲突记为冲突，人工确认后才能写入 `entity_review`。只对上过期事实、缺证据、两份有效事实互相冲突，或仅有表述差异时，不能直接记成确认错误。
- 页面上的「提取主张」调用 Responses API，只返回待确认草案。模型不能把过期事实改成可确认错误。提取不插入 `entity_review`，也不新增 `answer_analysis_version`。
- 看板口径不变：确认错误数/复核数，以及复核覆盖。不返回总体错误率。
- 没有新增表。观察查询沿用 `answer_observation_owner_idx`、`monitoring_slot_brand_idx`、`monitoring_run_brand_recent_idx` 和 `answer_analysis_brand_idx`。SQLite 对最多 30 行的排序使用临时 B-tree，不为这条复核清单再加索引。

## 修改入口

- `src/features/entity-accuracy/claims.ts`、`claim-read.ts`、`claim-extract.ts`
- `src/features/entity-accuracy/dao.ts`、`commands.ts`、`contracts.ts`、`api.ts`
- `src/features/entity-accuracy/reviews-page.tsx`、`reviews-workspace.tsx`
- `src/app/api/brands/[id]/entity-reviews/claims/route.ts`
- `src/lib/i18n/messages/zh-CN.json`、`en.json`

## 实际验证

隔离夹具：2 条品牌核验题回答、1 条有效价格事实、1 条过期价格事实，另有 1 条自然发现题。不是真实监测样本。

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm check:i18n` | 通过。3697 个消息键与插值参数一致 |
| `pnpm check:feature-map` | 通过。69 个页面，445 条代码路径 |
| `pnpm test:continued-operations` | 通过。78 项，无跳过。SQLite 与 PostgreSQL 都给出冲突 / 缺证据，过期事实确认错误被拒绝；写入后看板为 `2/10` 与 `10/50`，`populationRate` 为 null，响应不含 `4%`。回环 mock 提取过期回答时模型返回冲突，结果仍是缺证据且不写复核或分析版本。另一账号读取和提取均为 `NOT_FOUND`，响应不含回答原文 |
| `pnpm build` | 通过。已生成 `/dashboard/brands/[id]/entity-reviews` 与 `/api/brands/[id]/entity-reviews/claims` |
| `python3 docs/tools/validate_docs.py` | 通过。26 项需求、29 项任务、81 个验收 ID；190 个 Markdown 文件与 1033 个本地链接。未运行应用行为或外部通道 |

本轮没有在浏览器里登录并打开抽样页。主张清单由页面把上述比对结果交给 `ReviewsWorkspace` 渲染。
