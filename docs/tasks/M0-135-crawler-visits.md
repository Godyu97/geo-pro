# M0-135 爬虫访问

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M1-07](../specs/M1.md#s-m1-07) · [S-M2-04](../specs/M2.md#s-m2-04)

市场运营从「复测与报告」进入 `/dashboard/reports/crawler-visits`，可从页首聚焦品牌字段、前往品牌资料或重新载入。登记使用既有表单和接口。访问记录分别显示核验标记确定的状态、回答引用数及 UTC 观察时间。

基线 `bdb8ec297c72a285ceef53f4a734d51d8dfcf75e` 在隔离 Chrome 中文 375 像素下复现。用 Enter 从报告区打开页面后找不到「开始登记」，断言期望 1 个入口，实际为 0。可在本地 `.cache/issue-135/crawler-visits/baseline-zh-CN-375.png` 复查。

## 隔离验收

Chrome 使用从开发服务创建并迁移的临时回环 PostgreSQL、合成品牌和临时账号。登记和回读走实际应用接口。读取故障由应用副本注入，保存故障由浏览器拦截返回 HTTP 503。未导入真实日志或访问外部连接器。

| 场景 | 实际结果 |
| --- | --- |
| 路由与双语布局 | 空态、已有记录和无品牌在 `zh-CN` / `en` 的 375、768、1440 像素下显示正确的页面标题与报告区位置，只有一个主内容区，主要操作完整位于视口，无页面横向溢出。首屏可以看到无记录提示。用 Enter 聚焦品牌字段，焦点环可见。长品牌名在记录卡片内换行。原生品牌下拉框收起时，长值仍会截断。 |
| 校验与保存回读 | 中文窄屏输入负引用数时由原生校验阻止，读回仍为空。仅有爬虫声明、没有核验标记时保存为 `unverified`，引用数为 0。带核验标记的合成记录为 `verified`，引用数为 1,234。页面复查与列表、单条 API 读取一致，两个记录的 `calledIncluded` 均为 `false`。覆盖 AC-M1-07-3 与 AC-M2-04-2 的页面和隔离数据场景。 |
| 保存失败与语言切换 | 合成 503 后保留引用数、核验标记和保存按钮焦点。切换英语保留输入并更新错误文案，持久化记录不变。切回中文并用 Enter 再保存后，成功状态可读取，表单恢复默认值，焦点保留。 |
| 加载、读取失败与隔离 | 双语窄屏可见加载提示。读取品牌名称失败时保留标题和重新载入，品牌、表单、记录及内部错误不显示。清除故障后用 Enter 恢复，API 回读前后一致。第二账号读取该记录或给对应品牌新增记录均返回 404，自己的列表为空。通过数据库回读确认临时账号、品牌、版本和访问记录均已清理，隔离库随后清除。 |

十九张交付截图保存在本地 `.cache/issue-135/crawler-visits/`，包含中英文空态、已有记录、无品牌、加载、读取失败和中文字段焦点。浏览器用例可重建。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3167 个消息键、7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，17 项。 |
| `node --conditions=react-server --test tests/data-connections/crawlers.test.mjs` | 通过，共 4 项、零跳过，含 SQLite3 与 PostgreSQL。 |
| `pnpm exec playwright test tests/e2e/crawler-visits.spec.ts tests/e2e/lead-quality.spec.ts tests/e2e/m0-flow.spec.ts` | 隔离库 3 项通过。增量后首次运行的新用例在测试辅助函数从末尾链接按 Tab 时焦点离开文档，修正焦点路径后整组复跑通过。 |
| `pnpm exec playwright test tests/e2e/crawler-visits.spec.ts` | 配置的回环开发库 1 项通过。复用已发布的开发保留策略，使用合成品牌，清理后重新查询账号、品牌、品牌版本及访问记录均为空。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 通过，开发预检 15 项，文档校验 81 个验收 ID 和 843 个本地链接。 |

隔离浏览器运行时，以 `tests/maintenance/helpers.mjs` 的 `testDatabase("postgresql")` 建立临时库，将返回的 `env` 交给 Playwright 进程。两项邮件 Mock 均开启。Playwright 结束后调用 `cleanup()`。

## 剩余验收

#135 保持开放。下一步可从 `/dashboard/reports/connector-events` 走查记录列表、空态、登记和失败恢复，补充双语及视口证据。爬虫访问的真实授权日志、数据连接及阶段验收仍待对应条件具备后核验。
