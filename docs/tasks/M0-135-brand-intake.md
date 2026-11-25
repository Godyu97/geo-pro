# Issue #135 建立品牌

2026-11-25。 [Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [全站视觉验收](../08-验收场景与样例.md#ui-visual-checks) · [B04 品牌建档](B04-brand-onboarding.md) · [S-M0-01](../specs/M0.md#s-m0-01)

品牌负责人从品牌资料进入 `/dashboard/brands/new` 后，先看到建立品牌的下一步。没有草稿时，页首动作是开始填写，键盘激活后焦点落在品牌名称。已有草稿时，页首显示草稿中的品牌名称，动作是继续填写，焦点落在当前步骤的输入。已有活跃品牌时不显示表单，页首动作是查看该品牌。读取失败时保留标题，隐藏草稿名称和表单，并用键盘重新载入。

## 范围

- 页首按空表单、已有草稿和已有活跃品牌给出一个主要动作，并保留相关入口。
- 长品牌名称在内容区内换行。保存期间提交按钮显示「正在保存…」并带 `aria-disabled`，在途守卫拦截第二次提交。
- 路由补了加载骨架。读取失败使用原生重新载入链接，并显示追踪编号。

## 验收

隔离浏览器使用合成品牌。名称是 59 字且没有空格。临时账号已清理。

| 场景 | 实际结果 |
| --- | --- |
| 空表单 | `zh-CN` 与 `en` 在 375、768、1440 像素只有一个 `main`。页首可见任务说明，「开始填写」在视口内，页面无横向溢出。中文 375 像素从品牌资料用键盘进入。两种语言在 375 像素用键盘激活后，焦点落在品牌名称。 |
| 慢速下一步 | 中文 375 像素填入长名称和业务说明后，对「下一步」连续按两次 Enter。按钮变为「正在保存…」且 `aria-disabled="true"`，只发出 1 个 `POST /api/brands`，随后进入关注范围并显示草稿已保存。 |
| 继续草稿 | 两种语言和三种宽度都显示草稿名称和「继续草稿」，不显示「开始填写」。375 像素键盘激活后焦点落在目标地区；返回上一步后，品牌名称仍是该合成名称。页面无横向溢出。 |
| 已有活跃品牌 | 两种语言和三种宽度都显示次数上限和品牌名称，主要动作是查看该品牌，页面没有品牌名称输入框，且无横向溢出。 |
| 其他账号 | 英文 375 像素打开同一地址，看到自己的空表单和「开始填写」，看不到原账号的品牌名称。 |
| 读取失败 | 中英文 375 像素先看到加载骨架，再看到安全错误和「重新载入」。失败页不显示品牌名称、输入框和内部异常。清除故障后用键盘重新载入，恢复品牌名称和查看品牌，仍然没有输入框。 |

10 张 375 像素截图保存在本地 `.cache/issue-135/brand-intake/`，可由 `tests/e2e/brand-intake.spec.ts` 重新生成。

## 验证命令

| 命令 | 实际结果 |
| --- | --- |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。构建包含 `/dashboard/brands/new`。 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过。3394 个消息键，7 项测试。 |
| `node --test tests/layout/workspace-landmark.test.mjs tests/layout/workspace-location.test.mjs` | 通过，27 项。 |
| `GEO_BRAND_INTAKE_SCREENSHOTS=.cache/issue-135/brand-intake pnpm exec playwright test tests/e2e/brand-intake.spec.ts` | 通过。配置开发 PostgreSQL、fixture 服务与本机 Chrome，1 项，9.2s。 |
| `pnpm exec playwright test tests/e2e/brand-onboarding.spec.ts tests/e2e/m0-flow.spec.ts` | M0 主流程 1 项通过，29.6s。建档走查 15 项中 9 项通过，6 项在保存品牌并切换语言后失败：开发库已有正式通道，详情页显示「打开监测能力」或 `Open monitoring capabilities`，不再显示空通道提示。加载、草稿恢复、编辑归档和删除恢复通过。 |
| `pnpm env:check` | 通过，15 项。 |
| `python3 docs/tools/validate_docs.py` | 通过。170 个活跃文档、940 个本地链接、26 项需求、29 项任务、81 个验收 ID。 |

## 剩余

Issue #135 仍保持开放及 `status:in-progress`。下一轮可继续对照 `src/app/` 剩余未对齐路由（如 `/dashboard/brands/questions`、`/dashboard/assistant`）完成 `ui-visual-v1` 对齐、加载骨架、读取故障恢复与三视口走查后复核关单条件。正式品牌准入仍按 B04 的阶段前置核验。
