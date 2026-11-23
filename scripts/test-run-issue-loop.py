#!/usr/bin/env python3
"""Run the dispatcher against a temporary Git origin and stand-ins for gh and Cursor."""

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


LOOP = Path(__file__).with_name("run-issue-loop.py").resolve()

FAKE_CLI = r'''
from datetime import datetime, timezone
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

control = Path(os.environ["ISSUE_LOOP_TEST_CONTROL"])
scenario = os.environ["ISSUE_LOOP_TEST_SCENARIO"]
state_file = control / "github.json"
state = json.loads(state_file.read_text())

if Path(sys.argv[0]).name == "gh":
    if sys.argv[1] == "api":
        # The first page only contains a PR. The open Issue must come from page two.
        print(json.dumps([[{"pull_request": {}}], state["open"]]))
    elif sys.argv[1:4] == ["issue", "view", "131"]:
        print(json.dumps(state["target"]))
    else:
        sys.exit(2)
    sys.exit(0)

if sys.argv[1] == "create-chat":
    print("test-session")
    sys.exit(0)

prompt = sys.argv[-1]
with (control / "rounds").open("a") as rounds:
    rounds.write(("backlog" if "最多新建 Issue：" in prompt else "dev") + "\n")
(control / "agent.pid").write_text(str(os.getpid()))
print("null", flush=True)
if scenario == "slow":
    time.sleep(30)
if scenario == "orphan-helper":
    helper = """
import signal
import sys
import time
from pathlib import Path

control = Path(sys.argv[1])
def stop(*_):
    (control / 'helper.stopped').touch()
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stop)
(control / 'helper.ready').touch()
time.sleep(30)
"""
    subprocess.Popen([sys.executable, "-c", helper, str(control)])
    deadline = time.monotonic() + 5
    while not (control / "helper.ready").exists() and time.monotonic() < deadline:
        time.sleep(0.01)


def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()


marker = re.search(r"<!-- geopro-loop:[0-9a-f]+ -->", prompt)[0]
fields = {"issue": "#131", "result": "done", "commit": "none", "verified": "fixture check",
          "evidence": "none", "remaining": "none", "unblock": "none"}
if "最多新建 Issue：" in prompt:
    fields.update(issue="none", result="backlog", issues_created="none")
    if scenario in {"backlog-created", "backlog-foreign", "backlog-reopened"}:
        opened = {
            "number": 132, "title": "fixture issue", "labels": [{"name": "status:ready"}],
            "created_at": ("2020-01-01T00:00:00Z" if scenario == "backlog-reopened"
                           else datetime.now(timezone.utc).isoformat()),
            "body": "someone else's issue" if scenario == "backlog-foreign" else marker,
        }
        state["open"].append(opened)
        fields["issues_created"] = "#132"
else:
    if scenario in {"pushed", "unpushed"}:
        Path("change.txt").write_text("fixture change")
        git("add", "change.txt")
        git("commit", "-m", "feat: fixture change (#131)")
        if scenario == "pushed":
            git("push", "origin", "main")
    if scenario in {"pushed", "unpushed", "claim-sync"}:
        fields.update(result="progressed", commit=git("rev-parse", "HEAD"), remaining="second slice")
    elif scenario == "acceptance-progress":
        fields.update(result="progressed", remaining="second verification")
    else:
        state["open"] = []
        state["target"]["state"] = "OPEN" if scenario == "not-closed" else "CLOSED"
        state["target"]["stateReason"] = "NOT_PLANNED" if scenario == "closed-not-planned" else "COMPLETED"
    if scenario == "dirty":
        Path("unfinished.txt").write_text("uncommitted agent work")
    if scenario == "wrong-issue":
        fields["issue"] = "#999"
    if scenario == "stale-comment":
        marker = "<!-- geopro-loop:old -->"

    fields["evidence"] = "https://example.test/owner/repo/issues/131#issuecomment-1"
    state["target"]["comments"] = [{"url": fields["evidence"], "body": marker + "\n" + git("rev-parse", "HEAD")}]

state_file.write_text(json.dumps(state))
receipt = "loop-round:\n" + "\n".join(f"{name}: {value}" for name, value in fields.items())
if scenario == "duplicate-field":
    receipt += "\nresult: done"
print(json.dumps({"type": "result", "subtype": "success", "result": receipt}), end="", flush=True)
'''


class IssueLoopTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="geopro-issue-loop-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.workspace = self.root / "checkout"
        self.logs = self.root / "logs"
        self.origin = self.root / "origin.git"
        self.env = {
            **os.environ,
            "PATH": f"{self.root}{os.pathsep}{os.environ['PATH']}",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_AUTHOR_NAME": "Fixture",
            "GIT_AUTHOR_EMAIL": "fixture@example.test",
            "GIT_COMMITTER_NAME": "Fixture",
            "GIT_COMMITTER_EMAIL": "fixture@example.test",
            "ISSUE_LOOP_TEST_CONTROL": str(self.root),
        }
        self.git("init", "--bare", "-b", "main", str(self.origin), cwd=self.root)
        self.git("clone", str(self.origin), str(self.workspace), cwd=self.root)
        (self.workspace / ".gitignore").write_text("/tmp\n")
        self.git("add", ".gitignore")
        self.git("commit", "-m", "Fixture baseline")
        self.git("push", "origin", "main")

        for name in ("gh", "fake-agent"):
            executable = self.root / name
            executable.write_text(f"#!{sys.executable}\n" + FAKE_CLI, encoding="utf-8")
            executable.chmod(0o700)
        labels = [{"name": "status:ready"}, {"name": "milestone:M0"}]
        (self.root / "github.json").write_text(json.dumps({
            "open": [{"number": 131, "title": "Fixture", "labels": labels, "created_at": "2020-01-01T00:00:00Z"}],
            "target": {"number": 131, "state": "OPEN", "stateReason": "REOPENED", "labels": labels, "comments": []},
        }), encoding="utf-8")

    def git(self, *args, cwd=None):
        return subprocess.run(
            ["git", *args], cwd=cwd or self.workspace, env=self.env,
            check=True, capture_output=True, text=True, timeout=10,
        ).stdout.strip()

    def command(self, *args):
        return [
            sys.executable, str(LOOP), "--workspace", str(self.workspace),
            "--agent-bin", str(self.root / "fake-agent"), "--log-dir", str(self.logs),
            "--skip-preflight", "--max-rounds", "1", "--max-consecutive-failures", "1", *args,
        ]

    def summary(self):
        return json.loads(max(self.logs.glob("loop-summary-*.json")).read_text())

    def run_loop(self, scenario, *args, expected_exit=0):
        proc = subprocess.run(
            self.command(*args), env={**self.env, "ISSUE_LOOP_TEST_SCENARIO": scenario},
            capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(proc.returncode, expected_exit, proc.stdout + proc.stderr)
        return proc

    def test_accepts_pushed_issue_commit_with_current_evidence(self):
        proc = self.run_loop("pushed", "--target-dev-commits", "1")
        summary = self.summary()
        self.assertIn("timeout=不限时", proc.stdout)
        self.assertEqual(summary["dev_commits"], 1)
        self.assertEqual(summary["rounds"][0]["after_head"], self.git("rev-parse", "origin/main"))

    def test_sync_alone_does_not_count_as_development(self):
        upstream = self.root / "upstream"
        self.git("clone", str(self.origin), str(upstream), cwd=self.root)
        self.git("commit", "--allow-empty", "-m", "Upstream delivery (#131)", cwd=upstream)
        self.git("push", "origin", "main", cwd=upstream)
        self.run_loop("claim-sync", expected_exit=1)
        summary = self.summary()
        self.assertEqual(summary["dev_commits"], 0)
        self.assertEqual(summary["rounds"][0]["before_head"], self.git("rev-parse", "HEAD"))

    def test_unpushed_commit_is_preserved_and_stops_dispatch(self):
        self.run_loop("unpushed", "--max-rounds", "3", expected_exit=1)
        summary = self.summary()
        self.assertEqual(summary["dev_commits"], 0)
        self.assertEqual(len(summary["rounds"]), 1)
        self.assertIn("尚未包含申报提交", summary["rounds"][0]["error_reason"])
        self.assertNotEqual(self.git("rev-parse", "HEAD"), self.git("rev-parse", "origin/main"))

    def test_accepts_completed_pure_verification_without_commit(self):
        self.run_loop("acceptance")
        summary = self.summary()
        self.assertEqual(summary["dev_commits"], 0)
        self.assertEqual(summary["rounds"][0]["issues_closed"], [131])

    def test_accepts_partial_verification_and_rotates_at_issue_limit(self):
        self.run_loop("acceptance-progress", "--prompt-mode", "dev",
                      "--max-same-issue-rounds", "1", "--max-rounds", "2")
        summary = self.summary()
        result, = summary["rounds"]
        self.assertTrue(result["success"])
        self.assertEqual(result["parsed_outcome"], "progressed")
        self.assertIn("131", summary["skipped_issues"])

    def test_rejects_disappearance_without_confirmed_closure(self):
        self.run_loop("not-closed", expected_exit=1)
        self.assertEqual(self.summary()["rounds"][0]["issues_closed"], [])

    def test_rejects_noncompletion_closure(self):
        self.run_loop("closed-not-planned", expected_exit=1)
        self.assertEqual(self.summary()["rounds"][0]["issues_closed"], [])

    def test_rejects_wrong_issue(self):
        self.run_loop("wrong-issue", expected_exit=1)
        self.assertIn("与派发目标不一致", self.summary()["rounds"][0]["error_reason"])

    def test_rejects_duplicate_receipt_field(self):
        self.run_loop("duplicate-field", expected_exit=1)
        self.assertIn("重复", self.summary()["rounds"][0]["error_reason"])

    def test_rejects_old_comment_as_current_evidence(self):
        self.run_loop("stale-comment", expected_exit=1)
        self.assertIn("本轮标记", self.summary()["rounds"][0]["error_reason"])

    def test_counts_only_verified_backlog_issues(self):
        self.run_loop("backlog-created", "--prompt-mode", "backlog")
        self.assertEqual(self.summary()["rounds"][0]["issues_created"], [132])

    def test_rejects_issues_created_by_other_work(self):
        self.run_loop("backlog-foreign", "--prompt-mode", "backlog", expected_exit=1)
        self.assertEqual(self.summary()["issues_created_total"], 0)

    def test_rejects_reopened_issue_as_new(self):
        self.run_loop("backlog-reopened", "--prompt-mode", "backlog", expected_exit=1)
        self.assertEqual(self.summary()["issues_created_total"], 0)

    def test_empty_backlog_attempt_does_not_starve_ready_issue(self):
        self.run_loop("acceptance", "--min-backlog", "2", "--max-replenishes", "1", "--max-rounds", "2")
        summary = self.summary()
        self.assertEqual(summary["backlog_attempts"], 1)
        self.assertEqual([row["mode"] for row in summary["rounds"]], ["backlog", "dev"])

    def test_stops_at_existing_local_changes(self):
        pending = self.workspace / "keep.txt"
        pending.write_text("user work")
        self.run_loop("acceptance", "--allow-dirty-start", expected_exit=2)
        self.assertEqual(pending.read_text(), "user work")
        self.assertFalse((self.root / "rounds").exists())

    def test_preserves_agent_changes_by_default(self):
        self.run_loop("dirty", "--max-rounds", "3", expected_exit=1)
        self.assertTrue((self.workspace / "unfinished.txt").is_file())
        self.assertEqual(len(self.summary()["rounds"]), 1)
        self.assertEqual(self.git("stash", "list"), "")

    def test_quarantines_changes_only_when_enabled(self):
        self.run_loop("dirty", "--quarantine-dirty", expected_exit=1)
        summary = self.summary()
        label = summary["rounds"][0]["quarantine_stash"]
        self.assertIn(label, self.git("stash", "list"))
        self.assertIn(label, summary["skipped_issues"]["131"])
        self.assertFalse((self.workspace / "unfinished.txt").exists())

    def test_run_logs_can_live_in_ignored_workspace_directory(self):
        log_dir = self.workspace / "tmp"
        self.run_loop("acceptance", "--log-dir", str(log_dir))
        self.assertTrue(list(log_dir.glob("loop-summary-*.json")))
        self.assertFalse(self.git("status", "--porcelain"))

    def test_cleans_up_helper_when_agent_exits(self):
        self.run_loop("orphan-helper")
        self.assertTrue((self.root / "helper.stopped").exists())

    def test_explicit_timeout_terminates_agent(self):
        self.run_loop("slow", "--round-timeout", "1", expected_exit=1)
        self.assertIn("超过 1 秒", self.summary()["rounds"][0]["error_reason"])
        with self.assertRaises(ProcessLookupError):
            os.kill(int((self.root / "agent.pid").read_text()), 0)

    def assert_stops_agent_and_releases_lock(self, signum):
        with subprocess.Popen(
            self.command(), env={**self.env, "ISSUE_LOOP_TEST_SCENARIO": "slow"},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True,
        ) as running:
            try:
                pid_file = self.root / "agent.pid"
                deadline = time.monotonic() + 8
                while not pid_file.exists() and running.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertTrue(pid_file.exists())
                self.assertIsNone(self.summary()["overall_exit"])
                duplicate = self.run_loop("acceptance", expected_exit=2)
                self.assertIn("已经有 Issue 循环在运行", duplicate.stderr)
                running.send_signal(signum)
                output, _ = running.communicate(timeout=8)
                self.assertEqual(running.returncode, 128 + signum, output)
                summary = self.summary()
                self.assertEqual(summary["overall_exit"], 128 + signum)
                self.assertEqual(summary["rounds"][0]["interrupt_signal"], signum)
                self.assertTrue(Path(summary["rounds"][0]["log_file"]).exists())
                with self.assertRaises(ProcessLookupError):
                    os.kill(int(pid_file.read_text()), 0)
            finally:
                if running.poll() is None:
                    running.send_signal(signal.SIGINT)
                    running.wait(timeout=8)
        self.run_loop("acceptance")

    def test_ctrl_c_terminates_agent_and_releases_workspace_lock(self):
        self.assert_stops_agent_and_releases_lock(signal.SIGINT)

    def test_sigterm_terminates_agent_and_releases_workspace_lock(self):
        self.assert_stops_agent_and_releases_lock(signal.SIGTERM)


if __name__ == "__main__":
    unittest.main()
