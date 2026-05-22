# NanoClaude Local Eval

This directory contains a small, reproducible local evaluation harness for NanoClaude.
It is intended for engineering demos, not benchmark claims.

Run:

```sh
npm run eval
```

Live runs require `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`. The harness
auto-approves `edit_file` patches only inside copied eval workspaces, while bash
commands still follow the normal allow/confirm/deny permission policy.

The harness discovers tasks in `eval/tasks`, copies each fixture repo into
`eval/results/<run-id>/workspaces/<task-id>`, runs NanoClaude on `task.md`,
executes the task checker, and prints a PASS/FAIL table.

Each task has:

- `task.md`: the instruction given to NanoClaude.
- `repo/`: the starting repository copied into a workspace.
- `check.js`: the deterministic checker run after NanoClaude finishes.

Generated output is saved under `eval/results/`, which is ignored by git.
