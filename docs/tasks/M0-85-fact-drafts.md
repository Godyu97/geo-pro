# M0-85 按已批准事实起草内容

Issue [#85](https://github.com/Godyu97/geo-pro/issues/85)｜2026-11-22｜对应 R-M0-09 / S-M0-09。软件验收在隔离库和回环 Responses API mock 中验证。不勾选 T-M0-09，不调用真实模型，也不把草稿当成已批准或已发布。

## 范围与关键决定

- 新增 `draftContentFromBrief`：只把 Brief 点名的、调用时点仍批准且可公开的事实文本交给 `createAiResponse`（`store: false`）。`sourceType = internal` 的来源引用不进入提示。Brief 或事实里的「忽略审批」只当数据，状态固定为 `draft`。
- 模型输出用 Zod 解析 `title`、`body`、`claims[{factVersionId,text}]`。事实 ID 不在本次允许集合，或标题、正文、主张里出现允许事实文本之外的数字/价格时，返回 `UNGROUNDED_CLAIM`，不写 `content_version`。
- 成功时写入一条 `draft`。指纹沿用批准指纹，并覆盖本次事实 ID 集合。不写 `content_approval`，不创建交付包。
- 现有 `content_version.batch_unit_id` 非空且外键指向批次单元。每次成功起草因此记一条已完成、不占额度的单篇批次，只为满足该约束；暂停、继续和失败重试不会把它重写成模板稿。
- 事实被撤销后，同一 Brief 的新操作返回 `FACT_INVALID`，不新增版本。已有草稿沿用现有失效规则，本单不改审批历史。
- Brief 页提供双语「生成草稿」。缺适用边界时接口返回 `EVIDENCE_REQUIRED`，测试中的 fetch 不会被调用。非负责人返回 `NOT_FOUND`（404）。

## 修改入口

- `src/features/content/fact-drafts.ts`、`fact-draft-button.tsx`、Brief 页与 `POST /api/content` 的 `draft-from-facts`
- `content` 消息：`generateFactDraft`、`factDraftHint`、`EVIDENCE_REQUIRED`、`UNGROUNDED_CLAIM`

## 实际验证

隔离事实与回环响应明确标为 fixture，不是真实稿件或模型质量验收。

| 命令 | 结果 |
| --- | --- |
| `node --conditions=react-server --test tests/content/*.test.mjs` | 通过。47 项无跳过。缺边界零版本且未调用 fetch；越界价格与越界事实 ID 为零版本并返回 `UNGROUNDED_CLAIM`；合法事实新增 1 条 `draft`，审批表与交付包表不增加；第二用户读取与调用均为 `NOT_FOUND`；撤销后再次起草不新增版本 |
| `pnpm test:ai` | 通过 |
| `pnpm check:i18n` 与 `pnpm test:i18n` | 通过。1396 个消息键与插值参数一致 |
| `pnpm lint` | 通过。仅既有 `tests/competitors/briefs.test.mjs` 未使用变量警告，非本次改动 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |
| `python3 docs/tools/validate_docs.py` | 通过。26 项需求、29 项任务、81 个验收 ID；未运行应用行为或外部通道 |

界面按钮提交到同一 `POST /api/content` 命令。本轮没有在浏览器里点击该按钮。
