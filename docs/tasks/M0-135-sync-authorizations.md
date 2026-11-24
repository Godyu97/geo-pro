# M0-135 同步授权

2026-11-24。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [视觉验收清单](../08-验收场景与样例.md#ui-visual-checks) · [S-M2-04](../specs/M2.md#s-m2-04)

品牌负责人从「账户设置」打开 `/dashboard/settings/sync-authorizations`。页首可跳到登记表单、有效授权或撤销后的历史。无可登记品牌时可打开品牌资料，读取失败时可在原路由重新载入。撤销前确认来源和影响。记录卡片展示授权状态、保留行数、下一次拉取条件和历史尝试。

基线 `025182ab64661fb4aee3dfa7e2bfdcad1a65cdba` 在隔离 Chrome 中文 375 像素下复现。账户设置链接可用，进入页面后「开始登记」的首屏断言因找不到该链接失败。截图在本地 `.cache/issue-135/sync-authorizations/baseline-zh-CN-375.png`。

## 隔离验收

Chrome 使用新建并迁移的回环 PostgreSQL、两个临时账号和合成品牌。读失败由应用副本注入，登记和撤销失败由浏览器模拟 HTTP 503。

| 场景 | 实际结果 |
| --- | --- |
| 入口、布局和状态 | 有品牌无授权、有效授权、仅剩已撤销授权和无品牌均核对 `zh-CN` / `en` 的 375、768、1440 像素。当前位置可辨认，主内容区唯一，页首操作完整位于视口，无页面横向溢出。长来源名和品牌名在容器内换行。原生品牌下拉框收起时会截断长值。 |
| 登记与恢复 | 中文窄屏按 Enter 聚焦品牌字段，焦点环可见。负行数被表单阻止，数据库无写入。登记 503 后输入及按钮焦点保留，切换英文后错误文案随语言变化。按 Enter 重试返回 200，显示登记回执并清空表单。数据库回读核对来源原文、品牌、未撤销状态和 1,234 个合成保留行。 |
| 撤销确认和历史回读 | 中英文窄屏确认框显示来源和影响，初始焦点落在取消。按 Escape 返回撤销按钮，数据库保持原样。撤销 503 时焦点留在确认按钮，数据库未改变。重试成功后焦点回到授权标题，按 Tab 和 Enter 可执行下一次本地尝试。撤销前后各留下一个尝试，结果分别为 `allowed` 与 `stopped`。保留行数始终是 1,234，历史删除标志为 0。重复撤销回读相同记录和两次尝试。 |
| 读取恢复和归属 | 双语窄屏可见加载提示。读取失败时保留标题和「重新载入」，品牌、表单、授权与内部异常不出现在主内容区。恢复后回读一致。第二个账号看不到授权，通过接口登记原品牌、撤销或拉取原授权均返回 404。临时账号、品牌、版本、授权和尝试已清理并回读确认。 |

21 张交付截图和 1 张基线截图位于本地 `.cache/issue-135/sync-authorizations/`。交付截图可由浏览器用例重建。初次整组运行时 Node 的 JSON 导入方式阻止用例加载，改用文件读取后，连接预览与 M0 主流程通过。新用例随后在品牌下拉框定位时失败，改为按语义角色及已核实的可访问名称定位后，单独重跑和整组复跑均通过。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过，3188 个消息键、7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，17 项。 |
| `node --conditions=react-server --test tests/data-connections/revocations.test.mjs` | 通过，SQLite3 和 PostgreSQL 共 4 项、零跳过。 |
| `pnpm exec playwright test tests/e2e/sync-authorizations.spec.ts` | 新建及迁移的回环 PostgreSQL 隔离库通过 1 项。 |
| `pnpm exec playwright test tests/e2e/sync-authorizations.spec.ts tests/e2e/data-connections.spec.ts tests/e2e/m0-flow.spec.ts` | 隔离 Chrome 整组复跑通过，3 项。 |
| `pnpm env:check`、`python3 docs/tools/validate_docs.py` | 开发预检 15 项通过，文档核对 81 个验收 ID 和 852 个本地链接。 |

隔离浏览器通过 `tests/maintenance/helpers.mjs` 的 `testDatabase("postgresql")` 创建临时库，将该库的配置交给 Playwright，开启两项邮件 Mock，结束后调用 `cleanup()`。加载和读取故障仅注入 Playwright 的应用副本。

## 开发库走查

配置的回环开发 PostgreSQL 用合成品牌与两个临时账号运行 `pnpm exec playwright test tests/e2e/sync-authorizations.spec.ts`，通过 1 项。登记、撤销前允许、撤销后停止、尝试历史及保留行数在数据库回读一致。临时数据已清理并回读确认。

## 剩余验收

#135 继续跟踪全站路由和状态覆盖。同步授权浏览器场景使用单一活动品牌，多个活动品牌及归档品牌仅存历史授权的场景待走查。下一步可从「账户设置 → 通知端点」用临时账号核对登记、撤销、其后发送状态与历史回读，以及中英文和三个视口下的焦点和读取恢复。

本轮对应 AC-M2-04-3 的本地部分。真实站点、日志或业务系统的授权、同步和保留策略管理待获准数据源与最小字段范围具备后核验。M2 阶段验收还需对应运行条件。
