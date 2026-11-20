# Issue 循环执行记录

本文件记录 `scripts/run-issue-loop.py` 这轮人工循环里已经推送到 `origin/main` 的提交。任务是否勾选仍以 [M0](M0.md)、[M1](M1.md)、[M2](M2.md) 为准。勾选对照见 [需求进度记录](delivery-progress.md)。这里写过的 Issue 只表示该增量已经落地，不表示 Issue 已关闭，也不表示阶段验收通过。

选下一轮前先读本文件，再用 `gh issue view` 看最新状态和评论。已有提交的 Issue 不重复做同一增量。GitHub 列表仍显示 open、但本文件已有记录的，跳过。实际已关闭的也不做。

检查在 Node v22.23.4 上执行（仓库要求 Node 24，本环境没有 Node 24）。下表「检查」只列实际跑过且退出码为 0 的命令。没有跑过的不写成通过。

## 已推送

| 轮次 | Issue | 做了什么 | commit | 已 push 到 main | 检查 |
| --- | --- | --- | --- | --- | --- |
| 0 | 工作流提示词 | 按新 session、一轮一件事、验收后才提交，收紧 `FIXED_PROMPT` 与 `.agents/workflows` | `8ccc236a2c374e8f7d6146cdd6f18fd43e1bde26` | 是 | `python3 -m py_compile scripts/run-issue-loop.py` |
| 1 | #41 | 下一时段费用超过剩余预算时暂停未来槽；预算调整产生新版本；消费者题单只标人工 | `2d14f2288146bdcfd546e57bdc29f4753a3669ed` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 2 | #42 | 覆盖不足不宣称品牌下滑；趋势需要两个可比较窗口；告警追加发生记录 | `d92aac5e77ee443aac044ae2909d06ae548a4a9e` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 3 | #43 | 竞品集按版本分段；无序列表不排名；缺席不计入平均位置 | `bd79c37a52837c8357dcb178491f6b719eff78c9` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 4 | #44 | 不可读或失效引用保留且支持性为未知；只换品牌名的 Brief 被拒绝 | `34bdaeabe34dea642cdc1bab63fe7367c823c732` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 5 | #45 | 错误率只显示复核样本；过期或冲突事实不自动判错 | `72bd4f39fb1d5a5cc669f301236e61b4b377da18` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 6 | #46 | 消歧写入新分析版本，旧快照不改；官网修正不直接结束纠错效果 | `a7e1845c97b93d0db94689e5724abd5865d7eaa5` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 7 | #47 | 超过 10 个文件保留失败原因；候选事实不自动批准、不编页码 | `043a207b53001b8dd462a6d8fb2f6bbed5c417ff` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 8 | #48 | 素材撤销保留引用并生成待办；模板不能关闭事实、许可或审核门禁 | `5c9ae7ad777870a56f227a5cf55b777708a96a89` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 9 | #49 | 单个渠道受阻不回滚已核验渠道；导出保留表格 | `ecef3fb31f1a259c00f1e9b1a6b268192dfc6c62` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 10 | #50 | 同一事实的多个页面列出并合成一条维护任务；计划日期不是上线日期 | `6f02209c1ba768dffd43bc6aa964de58716ebcef` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 进度 | 无新 Issue | 对照任务勾选与代码写进度，不写完成比例 | `7c6e36550fcf14e2f0726cc3df2ded0dae39f05a` | 是 | `python3 docs/tools/validate_docs.py` |
| 11 | #51 | 核心题与探索题分开才能冻结；短于 14 天或已登记干预不能冻结 | `bd52a452394607b2fadd0eff5e80723e55e5dbf9` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 12 | #52 | D+7 从生效次日计满才到期；共同题不足保持探索；提前停止保留槽位 | `9c4df6afb4335ed45c744b9e627bbb72543be6a9` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 13 | #53 | 线索导入拒绝直接身份信息和空事件键，同一事件合并证据 | `4084da02c797a72a97f6f1b53dc30acef4486c36` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 14 | #54 | 有效性规则修订产生新版本；原始、有效、成交分开；自报不除以全部访问 | `55cca4705eaf6c8dded1da6fb56d333364cb1637` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 15 | #55 | 最后一位负责人不能退出；无导出授权不能导出；批量请求其他品牌不返回行 | `06030a7bd6117972d5166c091f2107e1d20ba6e4` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 16 | #56 | 事实批准与内容批准分开；作者不能自批；历史单人记录不改 | `62cd4909e0f8af656313a0631ca5782200f2376f` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 17 | #58 | 登录墙或验证码停止辅助采集且不绕过；缺引用保持 partial，确认后也不标完整 | `a8d10c3b4cc2e9c04992713ee0734954d76b7f33` | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 18 | #31 | 官方轨价格不明或能力未核验时不启用；消费者轨即使启用也只标人工，两轨不互相代替 | PENDING_SHA | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 19 | #32 | 缺真实品牌、官方 20 条、消费者 6 条或 4 人独立完成时阶段门禁不通过，函数不生成这些结果 | PENDING_SHA | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 20 | #57 | 没有 200 条分析样本、团队观察和 8 项 M1 任务核对时阶段门禁不通过，不补造样本 | PENDING_SHA | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 21 | #59 | 入口结构变化退回人工且不更换账号；引用不完整时不计算节省时间 | PENDING_SHA | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 22 | #60 | 只有草稿权限不能公开发布；草稿回执不算公开；已受理或结果未知时先对账不再提交 | PENDING_SHA | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 23 | #61 | 通知授权撤销或正文含客户原文时不发送，历史发送记录不删除 | PENDING_SHA | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |
| 24 | #62 | 代理成员身份不能代替品牌委托；委托失效时拒绝访问并停掉排队动作，组合行不展示证据 | PENDING_SHA | 是 | 该轮测试、`pnpm lint`、`pnpm typecheck` |

这些 Issue 在 2026-11-20 用 `gh issue list --state all` 核对时仍是 open，评论只说明阻塞已解除、真实验收不要勾选。本表已有记录，后续轮次不重复。

## 本轮不选

- #21：仍 open。关闭条件的服务端记录已在 [M0-21](M0-21-pilot-admission.md)，本循环不再改同一入口。真实投递和获准试点不能写成已完成。
