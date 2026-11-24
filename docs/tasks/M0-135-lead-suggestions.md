# M0-135 下轮问题建议

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M1-07](../specs/M1.md#s-m1-07)

市场运营从「复测与报告」进入 `/dashboard/reports/lead-suggestions`，先确认活动品牌，再填写线索汇总或审核待处理草稿。页首入口聚焦汇总框或最近的待处理草稿标题。接受和丢弃完成后，焦点回到该卡片的状态标题。

基线 `20667fc910b65bb6cf5fc958463fc5b482a7e7a8` 在隔离 Chrome 中文 375 像素下复现。报告入口能打开下轮问题建议，页首缺少「填写线索汇总」。基线截图在本地 `.cache/issue-135/lead-suggestions/baseline-zh-CN.png`。

## 隔离验收

Chrome 使用回环开发 PostgreSQL、合成品牌和临时账号。浏览器通过真实应用接口写入和回读。模型请求由回环 Responses API mock 响应，读取故障由隔离源码副本注入。

| 场景 | 实际结果 |
| --- | --- |
| 报告入口与响应式 | 从复测与报告用 Enter 进入。空态、待处理、已处理和无品牌都在中文及英文的 375、768、1440 像素检查。页面显示报告区位置和唯一主内容区，页首主要操作完整位于视口，无横向溢出。长品牌名、模型名和问句在所属区域换行。 |
| 草稿生成和重试 | 中文 375 像素用 Enter 聚焦汇总框。含邮箱的合成输入被拒绝，输入保留，无模型调用。首次合规提交遇到回环模型 HTTP 502，保留输入和焦点，列表仍为空。重试及另一次生成各保存一条草稿，API 回读保留问题及 `frozen: false`。 |
| 审核与持久化 | 从页首聚焦卡片标题后，用 Tab 和 Enter 接受。第二条用键盘丢弃。焦点回到相应的新状态标题，API 回读分别为 `accepted` 和 `discarded`。再次处理返回 409。操作前后品牌修订号与题集、监测运行及额度记录计数一致。 |
| 读取失败和归属 | 中文和英文在 375 像素下注入读取失败，保留标题及重新载入，隐藏品牌、草稿、表单与内部错误。清除故障后用 Enter 重新载入，回读一致。列表返回 `NOT_FOUND` 分支在英文窄屏显示建档入口。第二账号读取、生成和处理原品牌草稿均返回 404。 |
| 请求和清理 | 共三次回环 `POST /v1/responses`，均带 `store: false`。回读确认两个临时账号、品牌、版本和草稿均已清理。 |

十二张交付截图保存在本地 `.cache/issue-135/lead-suggestions/`，覆盖两种语言的空态、待处理、审核焦点、已处理、读取失败和无品牌。可用浏览器命令重建。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。初次类型检查报告 TS2339，列表结果的错误分支未完整收窄。修正判断后重跑通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3163 个消息键、7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，17 项。 |
| `node --conditions=react-server --test tests/business-feedback/suggestions.test.mjs` | 通过，SQLite3 和 PostgreSQL 共 3 项、零跳过。 |
| `pnpm exec playwright test tests/e2e/lead-suggestions.spec.ts tests/e2e/lead-quality.spec.ts tests/e2e/business-leads.spec.ts tests/e2e/m0-flow.spec.ts` | 三项回归通过。新用例首次因审核按钮的测试定位范围错误而失败，修正定位后单独复跑。 |
| `pnpm exec playwright test tests/e2e/lead-suggestions.spec.ts` | 通过，1 项隔离 Chrome 验收。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过，开发预检 15 项，文档校验 81 个验收 ID 和 839 个本地链接。 |

## 剩余验收

#135 保持开放。下一步可从 `/dashboard/reports/crawler-visits` 开始，用临时账号在两种语言和三种宽度下核对空态、登记、访问可信度和回读。获准真实线索和正式阶段验收尚待对应阶段实测。
