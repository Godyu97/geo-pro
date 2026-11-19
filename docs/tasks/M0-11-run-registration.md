# M0-11 确认监测范围并登记排队运行

> Issue [#11](https://github.com/Godyu97/geo-pro/issues/11)｜2026-11-19｜R-M0-05 的受理部分。完整 [T-M0-05](M0.md#t-m0-05) 保持未完成，执行与 AC-M0-05-2/3 留在后续任务。

## 范围与关键决定

- 负责人按冻结题集、通道版本和采样协议预览题数 × 通道数 × 重复次数（1–3）。官方 API 与消费者人工分别确认。
- 正式登记持久 queued Run/Slot。API 按逻辑槽位预留采样额度；消费者路径不产生平台付费，也不写预留。
- 同一操作和同一签名输入返回原运行与原预留。改输入冲突。预览超过 15 分钟、版本变化、无可信上界、额度不足或未验证邮箱时拒绝并给出下一步。
- 未知供应商下界保持未知，不记为 0。试点客户应付固定为 0。queued 不表示采样完成。
- 旧的通道资格检查仍返回 `RUN_NOT_OPEN`，不创建运行。真实供应商执行和价格核验不在本次范围。

## 修改入口

领域在 `src/features/monitoring/`。确认页仍由 `src/app/(dashboard)/dashboard/monitoring/new/` 挂载，详情在 `dashboard/monitoring/runs/[runId]/`。接口为 `src/app/api/monitoring/runs/`。双方言表为 `monitoring_run` 与 `monitoring_slot`。专项测试为 `pnpm test:monitoring`。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| `pnpm test:monitoring` | 通过。SQLite 与 PostgreSQL 覆盖 AC-M0-05-1、分轨、邮箱、越权、过期预览、额度不足和列表索引 |
| `pnpm db:ddl:check` | 通过 |
| `pnpm check:i18n`、`pnpm test:i18n` | 通过 |
| `pnpm lint`、`pnpm typecheck`、`pnpm build` | 通过。生产构建包含 `/dashboard/monitoring/new` 与 `/dashboard/monitoring/runs/[runId]` |
| `pnpm verify:capabilities` | 通过。双方言生产服务在 375/768/1440 下仍通过旧运行确认页的双语检查，未创建模拟成功 |
| 新登记表单的浏览器逐项点击 | 未单独走查。登记行为由 `pnpm test:monitoring` 覆盖；页面已进入生产构建 |
| 真实供应商执行 | 未验证，留在 #12 与 #31 |

隔离验收使用合成题集、通道和调用方确认的费用上界。没有真实采样结果。
