#!/usr/bin/env python3
"""
串行循环调用 cursor-agent 的自主 Issue 开发脚本。

特性：
- 串行执行，最多运行 20 轮（可通过 --max-rounds 覆盖）。
- 每轮调用前通过 `cursor-agent create-chat` 创建全新 session，并使用 `--resume <session_id>` 启动。
- 仅当上一轮执行成功（进程退出码为 0，且 stream-json 结果事件为 success 且 is_error=false）才进入下一轮；任一轮失败立即中止。
- 默认模型为 `grok-4.7-high`（CLI 显示名 Grok 4.7 256K High，非 Fast）。
- 日志默认写入工作区 `./tmp`。
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

MAX_ROUNDS = 20
# cursor-agent models 中的非 Fast 变体；init 事件显示为 "Grok 4.7 256K High"。
DEFAULT_MODEL = "grok-4.7-high"

FIXED_PROMPT = """# GEO Agent Issue 自主开发工作流

你是 GEO 项目的全自主 Coding Agent，负责从 GitHub Issues 获取任务，自主完成代码同步、调研、解阻、需求开发、验证、代码提交和状态更新。

**核心铁律：**
- **禁止提问**：严禁向用户提问、请求确认或等待人工输入。遇到任何不确定性，必须自行调研并做出最优工程决策。
- **必须推进**：每次执行只处理一个 Issue，完成后退出。只要仓库中存在可推进的任务，就必须选定并开始开发，禁止轻易跳过或空跑退出。

---

## 1. 同步最新代码

在排查 Issue 和开始开发前，必须先将本地仓库同步到远程最新状态：

1. 检查当前分支与工作区状态（`git status`）。若存在非本次任务的未提交残留变更，先安全清理或暂存（`git stash`），确保工作区干净。
2. 执行 `git pull --rebase`（或 `git pull --ff-only`）拉取当前分支最新代码，避免产生多余的 Merge Commit。
3. 若拉取失败或出现异常冲突，先尝试自主排查修复；无法恢复时记录原因并退出，禁止在过期代码上开发。

## 2. 获取 Issue 与自动解阻

使用 `gh` 获取当前仓库所有 `open` 状态的 Issue，按创建时间升序排查：

1. **筛选与解阻策略**：
   - 跳过明确处于活跃开发中的 Issue。
   - **自动评估 Blocked Issue**：遇到带有阻塞标签（如 `blocked`）或状态为 Blocked 的 Issue 时，**不要直接跳过**。必须阅读其描述、历史评论及关联 Issue/PR，并结合**最新同步的代码库状态**判断是否已具备开发条件：
     - 若前置依赖已完成、环境/代码问题已解决，或阻塞原因可通过自主调研/顺带修复消除：**自动移除阻塞标签/状态，将其恢复为正常待开发状态**，在评论中注明解阻依据，并纳入本次开发候选。
     - 仅当存在 Agent 绝对无法独立解决的硬阻塞（如缺失外部私有密钥、未授权的第三方付费服务等）时，才跳过并继续检查下一个 Issue。
2. **锁定目标**：从可执行队列中选取创建时间最早的一个 Issue。仅当所有 Open Issue 均在活跃开发中或全部为不可逾越的硬阻塞时，才记录原因并退出。

## 3. 更新状态

将选中的 Issue 状态更新为 `In Progress`（优先更新 GitHub Projects Status，未配置时使用 Issue Labels）。

## 4. 自主调研与信息补全

在动手编码前，主动收集并补全所有缺失的上下文，**绝不因 Issue 描述简略而停滞**：

- 按需阅读 `AGENTS.md`、`.agents/` 项目治理规范、`docs/` 产品需求、现有 OpenSpec 规格、相关源码、组件、测试及近期 Git 提交历史。
- 若 Issue 缺少细节、设计方案或验收标准：结合项目现有架构、业务逻辑与行业最佳实践，**自行补全需求定义、边界条件与验收标准**，并将补全后的调研结论与假设简要记录在 Issue 评论（或 OpenSpec）中，直接进入开发。

## 5. 需求开发

严格遵循项目现有架构、代码规范和设计系统，优先复用已有实现，按 Issue 类型执行：

- **Feature / 新需求**：
  - 使用项目已有的 OpenSpec 工作流管理需求开发。
  - 基于调研结果明确需求、设计方案与实施任务，按规格实现功能并同步维护文档。
  - 完成后按 OpenSpec 规范验证并归档。
- **Bug / Refactor / Chore**：
  - 直接定位根因并实施修改，避免不必要的文档与流程开销。
  - 仅在涉及重要业务行为或架构变更时使用 OpenSpec。

## 6. 验证与自修复

开发完成后，依次执行适用的质量检查：

- TypeScript 类型检查
- ESLint 检查
- 相关自动化测试
- Next.js 生产构建
- Issue 验收条件（含自主补全的验收项）逐条验证

遇到任何报错或失败，自主定位并修复，直至全部通过。

## 7. Commit & Push

验证全部通过后：

1. 检查 `git status` 与 `git diff`，确认仅包含当前 Issue 相关变更。
2. 使用 Conventional Commits 规范提交，并在 Commit Message 中关联 Issue 编号（如 `feat: ... (#123)`）。
3. 直接在当前 Git 分支执行 `commit` 和 `push`；若远端有新提交导致 Push 被拒，先执行 `git pull --rebase` 并重新跑通关键验证后再 Push。

> 约束：不创建或切换分支，不创建 PR。

## 8. 完成 Issue

确认 Push 成功后：

- 将 Issue 状态更新为 `Done`。
- 在 Issue 评论中记录：Commit SHA、实现内容、自主补全的决策/调研要点及验证结果。
- 使用 `gh` 关闭 Issue。

## 9. 异常处理

遇到代码同步、编译、测试或 Push 失败时，先尝试自主排查与修复。仅在多次尝试仍无法恢复的情况下：保留本地工作成果，在 Issue 评论中详细记录根因与已尝试的方案，不关闭 Issue，结束本轮执行。

## 10. 执行结果输出

任务结束时简要输出：

- Issue 编号及标题（若涉及解阻，注明已自动解阻）
- 调研补全与核心实现内容
- OpenSpec 变更（如有）
- 测试与构建结果
- Git 分支及 Commit SHA
- Push 与 Issue 最终状态

**执行链路**：`git pull` 同步最新代码 → 扫描并自动解阻最早 Issue → `In Progress` → 自主调研补全 → 需求开发（Feature 用 OpenSpec）→ 验证自修 → Commit & Push → `Done` & Close → 退出。

现在立即开始执行。"""


@dataclass
class RoundResult:
    round_index: int
    session_id: str
    success: bool
    exit_code: int
    duration_sec: float
    error_reason: str | None = None
    result_text: str | None = None
    log_file: Path | None = None


def resolve_cursor_agent_bin(explicit_bin: str | None) -> str:
    if explicit_bin:
        return explicit_bin
    found = shutil.which("cursor-agent")
    if found:
        return found
    fallback = Path.home() / ".local" / "bin" / "cursor-agent"
    if fallback.is_file():
        return str(fallback)
    raise FileNotFoundError(
        "未找到 cursor-agent 可执行文件，请将其加入 PATH 或通过 --agent-bin 指定路径。"
    )


def create_new_session(agent_bin: str, workspace: Path) -> str:
    proc = subprocess.run(
        [agent_bin, "create-chat"],
        cwd=workspace,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"cursor-agent create-chat 失败 (exit={proc.returncode}): {proc.stderr.strip() or proc.stdout.strip()}"
        )
    lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("cursor-agent create-chat 未返回 session_id")
    return lines[-1]


def run_round(
    *,
    round_index: int,
    agent_bin: str,
    workspace: Path,
    log_dir: Path,
    model: str,
    round_timeout: int | None,
    approve_mcps: bool,
) -> RoundResult:
    started_at = time.monotonic()
    session_id = create_new_session(agent_bin, workspace)
    log_file = log_dir / f"round-{round_index:02d}-{session_id}.jsonl"

    cmd = [
        agent_bin,
        "-p",
        "--force",
        "--trust",
        "--workspace",
        str(workspace),
        "--resume",
        session_id,
        "--output-format",
        "stream-json",
        "--model",
        model,
    ]
    if approve_mcps:
        cmd.append("--approve-mcps")
    cmd.append(FIXED_PROMPT)

    print(
        f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"=== 第 {round_index} 轮开始 | session={session_id} | model={model} ===",
        flush=True,
    )

    result_event: dict | None = None
    non_json_tail: list[str] = []
    timed_out = threading.Event()

    proc = subprocess.Popen(
        cmd,
        cwd=workspace,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    assert proc.stdout is not None

    def _on_timeout() -> None:
        timed_out.set()
        if proc.poll() is None:
            proc.kill()

    timer: threading.Timer | None = (
        threading.Timer(round_timeout, _on_timeout)
        if round_timeout is not None
        else None
    )
    if timer is not None:
        timer.daemon = True
        timer.start()

    try:
        with log_file.open("w", encoding="utf-8") as fp:
            for raw_line in proc.stdout:
                fp.write(raw_line)
                fp.flush()
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    non_json_tail.append(line)
                    if len(non_json_tail) > 20:
                        non_json_tail.pop(0)
                    print(f"[round {round_index}] {line}", flush=True)
                    continue

                ev_type = event.get("type")
                if ev_type == "assistant":
                    content = (
                        event.get("message", {}).get("content", [])
                        if isinstance(event.get("message"), dict)
                        else []
                    )
                    for item in content:
                        if isinstance(item, dict) and item.get("type") == "text":
                            text = item.get("text", "")
                            if text:
                                print(text, flush=True)
                elif ev_type == "result":
                    result_event = event

        exit_code = proc.wait()
    except KeyboardInterrupt:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        raise
    finally:
        if timer is not None:
            timer.cancel()

    duration_sec = time.monotonic() - started_at

    if timed_out.is_set():
        return RoundResult(
            round_index=round_index,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            error_reason=f"第 {round_index} 轮执行超过 {round_timeout} 秒，已超时终止",
            log_file=log_file,
        )

    if exit_code != 0:
        err_detail = (
            " | ".join(non_json_tail[-5:])
            if non_json_tail
            else f"exit_code={exit_code}"
        )
        return RoundResult(
            round_index=round_index,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            error_reason=f"cursor-agent 进程非零退出 ({err_detail})",
            log_file=log_file,
        )

    if result_event is None:
        return RoundResult(
            round_index=round_index,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            error_reason="未收到 stream-json 的 result 事件，无法确认执行结果",
            log_file=log_file,
        )

    subtype = result_event.get("subtype")
    is_error = bool(result_event.get("is_error", False))
    result_text = result_event.get("result")

    if is_error or subtype != "success":
        return RoundResult(
            round_index=round_index,
            session_id=session_id,
            success=False,
            exit_code=exit_code,
            duration_sec=duration_sec,
            error_reason=f"result 事件标记失败 (subtype={subtype}, is_error={is_error})",
            result_text=result_text if isinstance(result_text, str) else None,
            log_file=log_file,
        )

    return RoundResult(
        round_index=round_index,
        session_id=session_id,
        success=True,
        exit_code=exit_code,
        duration_sec=duration_sec,
        result_text=result_text if isinstance(result_text, str) else None,
        log_file=log_file,
    )


def parse_args() -> argparse.Namespace:
    default_workspace = Path(__file__).resolve().parent.parent

    parser = argparse.ArgumentParser(
        description="串行循环调用 cursor-agent 执行 GEO Issue 自主开发工作流"
    )
    parser.add_argument(
        "--max-rounds",
        type=int,
        default=MAX_ROUNDS,
        help=f"最大调用轮数（默认 {MAX_ROUNDS}）",
    )
    parser.add_argument(
        "--workspace",
        type=Path,
        default=default_workspace,
        help=f"工作区根目录（默认 {default_workspace}）",
    )
    parser.add_argument(
        "--agent-bin",
        type=str,
        default=None,
        help="cursor-agent 可执行文件路径（默认自动从 PATH 或 ~/.local/bin 查找）",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL,
        help=f"cursor-agent 模型（默认 {DEFAULT_MODEL}，即 Grok 4.7 256K High，非 Fast）",
    )
    parser.add_argument(
        "--round-timeout",
        type=int,
        default=None,
        help="可选：单轮最大超时秒数（默认不限制）",
    )
    parser.add_argument(
        "--approve-mcps",
        action="store_true",
        help="自动批准所有 MCP servers（传递给 cursor-agent --approve-mcps）",
    )
    parser.add_argument(
        "--log-dir",
        type=Path,
        default=None,
        help="每轮 stream-json 日志输出目录（默认 <workspace>/tmp）",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.max_rounds < 1:
        print("--max-rounds 必须 >= 1", file=sys.stderr)
        return 2

    workspace = args.workspace.resolve()
    if not workspace.is_dir():
        print(f"工作区目录不存在: {workspace}", file=sys.stderr)
        return 2

    try:
        agent_bin = resolve_cursor_agent_bin(args.agent_bin)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    log_dir = (
        args.log_dir.resolve()
        if args.log_dir is not None
        else workspace / "tmp"
    )
    log_dir.mkdir(parents=True, exist_ok=True)

    print(
        f"启动 GEO cursor-agent 串行循环 | max_rounds={args.max_rounds} | "
        f"model={args.model} | workspace={workspace} | agent_bin={agent_bin} | "
        f"log_dir={log_dir}",
        flush=True,
    )

    results: list[RoundResult] = []
    overall_exit = 0

    for round_index in range(1, args.max_rounds + 1):
        try:
            res = run_round(
                round_index=round_index,
                agent_bin=agent_bin,
                workspace=workspace,
                log_dir=log_dir,
                model=args.model,
                round_timeout=args.round_timeout,
                approve_mcps=args.approve_mcps,
            )
        except KeyboardInterrupt:
            print("\n收到中断信号，停止后续轮次。", file=sys.stderr, flush=True)
            overall_exit = 130
            break
        except Exception as exc:
            print(
                f"\n[第 {round_index} 轮] 启动或运行异常，停止后续轮次: {exc}",
                file=sys.stderr,
                flush=True,
            )
            overall_exit = 1
            break

        results.append(res)
        status_label = "成功" if res.success else "失败"
        print(
            f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
            f"=== 第 {res.round_index} 轮{status_label} | "
            f"session={res.session_id} | 耗时={res.duration_sec:.1f}s | "
            f"日志={res.log_file} ===",
            flush=True,
        )

        if not res.success:
            print(
                f"失败原因: {res.error_reason}\n"
                "根据串行失败即停策略，不再开始下一轮调用。",
                file=sys.stderr,
                flush=True,
            )
            overall_exit = 1
            break

    print(
        f"\n=== 执行汇总: 共完成 {len(results)} / {args.max_rounds} 轮，"
        f"成功 {sum(1 for r in results if r.success)} 轮 ===",
        flush=True,
    )
    return overall_exit


if __name__ == "__main__":
    raise SystemExit(main())
