# M0-135 站内质量提醒

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M1-01 与 AC-M1-01-2/3](../specs/M1.md#s-m1-01) · [指标与证据合同](../07-指标与证据合同.md)

品牌负责人从采样计划进入站内提醒后，可以读到覆盖不足的原因和每次发生记录，并用键盘确认。基线 `b890acf2a5468652c41729683bc0d0174cfe8973` 把「查看站内提醒」放在计划卡片后部。提醒页已有数据和确认动作，长窗口编号会把窄屏撑出横向滚动。

- `/dashboard/monitoring/plans` 在已有品牌时把站内提醒放进页首操作，和新建计划、返回概览一起换行。计划卡片不再重复这个入口。
- `/dashboard/monitoring/alerts` 先显示当前品牌和提醒卡片。覆盖不足仍写成数据质量，并写明不宣称品牌表现下滑。窗口编号在卡片内换行。发生次数和发生时间列在确认按钮之前。确认和稍后处理沿用既有服务端动作，只改状态，不删除发生记录。
- 没有品牌时保留标题，主要动作是去建档。读取失败保留标题和错误提示，不把失败显示成空列表。提醒仍只在站内显示。

## 开发库实测

`pnpm env:check` 通过 15 项。在只读事务中回读 [#134 的窗口](M1-134-due-windows.md)：计划 `b5aaeac5` 的 `2026-11-23` 窗口时区为 `Asia/Shanghai`，计划 3、合格 3、推荐可判定 0、可比窗口 0，趋势继续等待，覆盖足够，`alertId` 为空。同一品牌的质量提醒列表为 0 条。其他负责人读不到该计划的到期记录。本轮没有向开发库写入合成提醒，也没有请求供应商。

## 隔离验收

Chrome 使用迁移后的临时 PostgreSQL、memory 缓存、回环 S3 和邮件 Mock。品牌和窗口摘要都是合成数据。

| 场景 | 实际结果 |
| --- | --- |
| 从计划进入 | 中文 375 像素下，页首「查看站内提醒」可聚焦，Tab 后返回仍带键盘焦点，Enter 打开 `/dashboard/monitoring/alerts`。当时还没有提醒。 |
| 覆盖不足 | 同一窗口连续登记两次。API 回读为同一条 `data_quality` / `coverage_insufficient`，`claimBrandDecline` 为 false，发生记录 2 条。 |
| 双语和宽度 | `zh-CN` 与 `en` 在 375、768、1440 像素显示原因、完整窗口编号、发生次数和两条发生时间。页面无横向溢出，只有一个 `main`。375 像素首屏能看到原因、次数和确认按钮。 |
| 键盘确认 | 英文 375 像素用 Enter 确认。页面变为已确认，确认按钮消失，发生次数仍是 2。列表 API 回读状态为 `acknowledged`，其余字段与确认前一致。 |
| 其他账号 | 读取和稍后处理都返回 404。英文 375 像素只看到去建档，看不到窗口编号。 |

已复看中英文两张 375 像素截图。浏览器用例可在 `test-results/` 重新生成。临时账号由用例清理，临时库已删除。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3061 个消息键、7 项测试 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，8 项 |
| `node --conditions=react-server --test tests/quality-alerts/*.test.mjs tests/sampling-plans/*.test.mjs` | 通过，12 项、零跳过。质量提醒在 SQLite3 和 PostgreSQL 上覆盖不足不宣称下滑，重复登记只追加发生记录。采样计划回归仍覆盖 AC-M1-01-1/2/3 |
| `pnpm test:e2e tests/e2e/quality-alerts.spec.ts tests/e2e/manual-sheet.spec.ts tests/e2e/m0-flow.spec.ts` | 通过，隔离 Chrome 3 项。提醒卡片上移后，单独重跑 `tests/e2e/quality-alerts.spec.ts` 再次通过 |
| `pnpm env:check`、`python docs/tools/validate_docs.py` | 通过，开发预检 15 项，文档 756 个本地链接 |

## 剩余验收

全站路由、双语视口和状态覆盖仍待继续。质量提醒页尚未注入读取故障的浏览器走查。开发库既有窗口覆盖足够，没有可比趋势，也没有站内提醒。正式持续监测仍待第二个完整可比窗口，阶段验收由对应工单跟踪。
