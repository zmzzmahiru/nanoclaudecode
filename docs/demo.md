# NanoClaude Demo Transcript

This transcript is illustrative. It shows the kind of interaction NanoClaude is designed to make visible: rules, tool calls, approvals, hooks, traces, and final summary.

## Command

```bash
npm run dev -- "Add one sentence to README.md explaining that NanoClaude is educational, then verify the build"
```

## Transcript

```text
[rules] loaded NANOCLAUDE.md
[todo] in_progress: Inspect README
[todo] pending: Edit README
[todo] pending: Verify build

[tool_call] read_file {"path":"README.md"}
[tool_result] success=true

[todo] done: Inspect README
[todo] in_progress: Edit README

[tool_call] edit_file {"path":"README.md","oldText":"<93 chars>","newText":"<151 chars>","reason":"Add educational positioning"}

[edit_file] Proposed changes for README.md:
--- README.md
+++ README.md
@@ -1,5 +1,5 @@
 # NanoClaude

-A lightweight TypeScript AI coding-agent framework with JSON tool calling, approval-gated edits, session traces, and a packaged CLI.
+A lightweight TypeScript AI coding-agent framework with JSON tool calling, approval-gated edits, session traces, and a packaged CLI. The project is intentionally small so the core agent mechanics are easy to study.

 NanoClaude is a small, readable implementation of the core ideas behind coding agents: an LLM loop, tools, permissions, project rules, planning, verification hooks, and test coverage.

[edit_file] Apply this change? y
[tool_result] success=true

[hook] after_edit: npm run build
[bash] Run command in C:\path\to\nanoclaude: npm run build y/N y

> nanoclaude@1.0.0 build
> tsc

[hook_result] after_edit success=true

[todo] done: Edit README
[todo] done: Verify build

[session] saved .nanoclaude/sessions/2026-05-21T00-00-00-000Z-demo01.json

Updated README.md with a short educational-positioning sentence and verified the TypeScript build.
```

## What To Point Out In A Demo

- Rules are loaded before the model acts.
- Tool calls are visible.
- File edits show a unified diff before writing.
- The user approves side effects.
- The `after_edit` hook suggests verification without bypassing approval.
- A redacted JSON trace is saved for auditability.
