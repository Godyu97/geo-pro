# Issue #135 全站视觉基线

[Issue #135](https://github.com/Godyu97/geo-pro/issues/135) · [ui-visual-v1](../04-产品功能规格-SPEC.md#interface-visual-style) · [设计规范](../ui-design/README.md)

本轮交付共享视觉基线，以及官网、账号入口和工作台壳层的当前位置。业务页会继承颜色、圆角和组件状态。页面构图、全站 375/768/1440 走查和登录后的业务回归仍未完成，Issue 保持开放。

## 使用与设计

- `:root` 使用浅蓝紫基底 `#f4f6fb`、白色表面、紫蓝主色 `#4f46c5`、浅色选中态和同色焦点环。按钮、输入、卡片、表格、弹窗和侧栏继续读取这些变量。主按钮悬停为 `primary/90`，白色文字对比度保持在 4.5:1 以上。
- 官网、登录和找回密码使用 `visual-canvas`。工作台顶栏显示当前分区，侧栏同步标出总览、每周行动、维护、账户设置，以及品牌、监测、优化、内容和报告。报价订单只在顶栏标出，侧栏没有对应入口。
- 工作台首页的通道说明改为标签列固定、数值列换行。长限制说明不再把“厂商”等标签挤成单字列。
- 致命错误页不能依赖样式表，内联颜色与 `:root` 保持同一组值。

## 执行记录

| 检查 | 结果 |
| --- | --- |
| 分区解析 | `node --test tests/layout/workspace-location.test.mjs` 通过。2 项。总览只匹配 `/dashboard`，监测、设置子路径和商务三条路径分开，`/dashboard/brand` 不误判为品牌。 |
| 消息 | `pnpm check:i18n` 通过，2807 个 key 与参数一致。`pnpm test:i18n` 7 项通过。 |
| 静态与构建 | `pnpm lint` 通过，仅余既有竞品测试未使用变量告警。`pnpm typecheck` 与 `pnpm build` 通过。 |
| 环境 | `pnpm env:check` 14 项通过。开发 PostgreSQL、Redis 与 S3 探针完成。邮件 Mock 保持开启。 |
| 文档 | `python3 docs/tools/validate_docs.py` 通过。26 项需求、29 项任务、640 个本地链接。 |
| 浏览器 | 本机 Chrome 打开 `next start` 的 `127.0.0.1:3125`。主按钮计算色为 `rgb(79, 70, 197)`。官网 375/768 无横向溢出。登录空提交显示邮箱与密码校验。中文下总览、监测、账户设置、内容、报告、维护、报价订单、每周行动、优化和品牌的顶栏分区与预期一致；侧栏对有入口的分区设置 `aria-current=page`。375 宽打开监测导航，当前项为 AI 监测。切换英文后顶栏为 `Current location: AI monitoring`，分区仍是 monitoring。通道标签横向可读。临时账号 `visual-135-*@example.invalid` 已删除。 |

正式阶段验收和其余业务页的双语视口未执行。长期运行的开发服务器在检查开始前已占用 3000 端口，本轮浏览器证据来自独立的生产构建端口。
