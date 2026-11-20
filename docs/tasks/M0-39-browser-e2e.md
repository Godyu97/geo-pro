# M0-39 隔离浏览器主流程

Issue [#39](https://github.com/Godyu97/geo-pro/issues/39)｜2026-11-20｜用 Playwright 覆盖建档到复测快照的隔离主流程，以及 `zh-CN` / `en` 在 375 / 768 / 1440 的兼容检查。合成数据只存在于回环测试库。不勾选 T-M0 任务或 AC-M0-GATE，也不代表 [#31](https://github.com/Godyu97/geo-pro/issues/31) 真实通道、[#32](https://github.com/Godyu97/geo-pro/issues/32) 试点走查或 [#21](https://github.com/Godyu97/geo-pro/issues/21) 生产备份已经通过。

## 范围与关键决定

- 品牌使用合成名称「北岸设备」，竞品「远帆设备」。产品 URL 校验拒绝保留 TLD `.example`，因此官网写成 `https://beian-equipment.example.com`，仍然只作为文档样式主机，不发起真实抓取。
- 监测页继续声明真实供应商未接通，页面不会生成模拟回答。隔离采样由 `scripts/e2e-m0-fixture.mjs` 在回环数据库上调用既有执行器，传输标记 `synthetic: true`。比较题包含「远帆」，连续三次 `safe_failure` 后该槽位失败，其余三题第一次即采纳。结果必须是成功 3、失败 1。
- 通道是平台级记录。脚本只创建 `publicVisible = 0` 的「北岸隔离 API」和「北岸隔离人工」，并在测试 `finally` 中删除网络证据、通道版本、通道和测试用户。
- 内容批次的失败 Brief 输入只在 `GEO_BRANDS_FIXTURE=1` 且请求来自回环品牌入口时渲染。生成成功后跳到批次页，便于看到 2 次成功和 1 次 `fixture_forced_failure`，重试后再变为 3 次成功。
- 复测和报告沿用已有 `POST /api/reports`。没有生效时间的业务闭环保持 `loopCompleted = false`；带已核验发布和 `effectiveAt` 的报告为 `loopCompleted = true`。快照 JSON 字节不随界面语言改变。
- 消费者存证走已有 `POST /api/monitoring/answers`，并打开证据页与 `sourceMode=consumer_ui` 列表。消费者运行本身保持排队，不伪装成已采样。
- 入证前概览是「暂无有效样本」，不出现 `0%`。入证后推荐判定仍为未知，卡片显示「分母为 0，显示 N/A」。`region=US` 过滤掉仅有的 CN 样本后回到空态，仍不出现 `0%`。
- 另一账号打开运行页时看到「找不到这个页面」，且看不到合成原文。该路由有 `loading.tsx`，文档响应在 `notFound()` 替换内容前已经以 200 提交，因此不断言 HTTP 404。
- 英文「Redo analysis」按钮带上完整题目后会在 375px 撑出页面。按钮改为可换行，运行页表格保持在容器内横向滚动。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `pnpm exec playwright test tests/e2e/m0-flow.spec.ts` | 1 passed |
| `pnpm test:e2e` | 74 passed（6.3m），含本流程及既有官网、账号、品牌、导出和维护用例 |
| `pnpm check:i18n` | PASS，1154 个 key 与插值参数一致 |
| `pnpm test:i18n` | 7 passed |
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm build` | 通过 |

同一条浏览器用例覆盖：题集草稿在中英文切换后仍保留且未冻结；内容草稿的组字 Enter 不提交；运行、概览、内容和报告在两种语言、三种宽度下无页面级横向溢出；跳过链接可聚焦；概览 SSR 的 `html lang` 与 cookie 一致；报告 JSON 重复下载及切换英文后字节相同，HTML 含「北岸设备」；个人导出文件名含「个人数据」。无页面 `pageerror`。

无 Schema 变更，未运行 `pnpm db:ddl`。未连接真实模型、真实发布渠道或真实用户。
