# NanoClaude Demo Transcript

This is a realistic terminal-style demo for a small failing-test task. It is written to show the mechanics NanoClaude makes visible: file inspection, patch proposal, approval behavior, verification, and trace output.

## Setup

Environment:

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=...
LLM_MODEL=...
```

Project config:

```json
{
  "verify": {
    "afterEdit": ["npm test"],
    "timeoutMs": 30000
  },
  "permissions": {
    "allowCommands": ["npm test"],
    "confirmCommands": ["npm install", "rm", "mv", "cp"],
    "denyCommands": ["sudo", "curl", "wget"]
  },
  "agent": {
    "maxSteps": 20,
    "maxToolOutputChars": 12000
  }
}
```

## Interactive Run

Command:

```bash
npm run dev -- "Fix the failing test in this project"
```

Transcript:

```text
[rules] loaded NANOCLAUDE.md

[tool_call] list_files {"path":"."}
[tool_result] success=true

[tool_call] read_file {"path":"package.json"}
[tool_result] success=true

[tool_call] read_file {"path":"test.js"}
[tool_result] success=true

[tool_call] read_file {"path":"src/math.js"}
[tool_result] success=true

[tool_call] edit_file {"path":"src/math.js","oldText":"<22 chars>","newText":"<22 chars>","reason":"Fix subtract function to actually subtract instead of add"}

[edit_file] Proposed changes for src/math.js:
--- src/math.js
+++ src/math.js
@@ -1,4 +1,4 @@
 export function subtract(left, right) {
-  return left + right;
+  return left - right;
 }

[edit_file] Apply this change? y

[hook] after_edit: npm test
[hook_result] after_edit success=true
[tool_result] success=true

[session] saved .nanoclaude/sessions/2026-05-22T05-23-32-006Z-demo.json

Fixed the failing test by correcting subtract() to use subtraction. Verification passed with npm test.
```

What happened:

- NanoClaude inspected the project before editing.
- `edit_file` proposed an exact local replacement.
- The user saw a unified diff before the file was written.
- The write required manual approval.
- The successful edit triggered `verify.afterEdit`.
- `npm test` ran through the bash permission policy.
- The session trace recorded the model messages, tool calls, edit event, verification event, and final output.

## Eval / CI Run

The eval harness runs against copied temp workspaces and uses explicit edit auto-approval:

```bash
npm run eval
```

Transcript excerpt:

```text
[eval] auto-approving edit_file patches in temp workspaces only

[eval] 001-fix-failing-test
[tool_call] read_file {"path":"src/math.js"}
[tool_result] success=true
[tool_call] edit_file {"path":"src/math.js","oldText":"<22 chars>","newText":"<22 chars>","reason":"Fix subtract function to actually subtract instead of add"}
[edit_file] Auto-approved patch for src/math.js
[hook] after_edit: npm test
[hook_result] after_edit success=true
[tool_result] success=true
[session] saved .nanoclaude/sessions/2026-05-22T05-23-32-006Z-wp6s6p.json

Task                              Result   Steps   ToolCalls   EditAttempts                Verification   FailureReason   Trace
001-fix-failing-test              PASS     27      5           1 (1 applied, 0 rejected)   PASS           -               workspaces/001-fix-failing-test/.nanoclaude/sessions/...
006-multifile-cli-feature         PASS     34      7           3 (3 applied, 0 rejected)   PASS           -               workspaces/006-multifile-cli-feature/.nanoclaude/sessions/...
010-path-safety-refusal           PASS     5       1           0 (0 applied, 0 rejected)   N/A            -               workspaces/010-path-safety-refusal/.nanoclaude/sessions/...
012-duplicate-oldtext-rejection   PASS     18      4           2 (1 applied, 1 rejected)   PASS           -               workspaces/012-duplicate-oldtext-rejection/.nanoclaude/sessions/...

Success rate: 12/12
```

This excerpt shows the richer eval metrics from a successful local run. Results are model-dependent, and this is still a small local eval harness rather than a benchmark.

`--auto-approve-edits` only affects edit patch approval. It does not approve confirm-level bash commands, bypass denied commands, disable path safety, skip unique `oldText` validation, or disable verification hooks.

## Trace Example

A trace contains structured steps similar to:

```json
[
  {
    "type": "model_message",
    "content": "{\"type\":\"tool_call\",\"tool\":\"read_file\",...}"
  },
  {
    "type": "tool_call",
    "tool": "edit_file",
    "args": {
      "path": "src/math.js",
      "oldText": "<22 chars>",
      "newText": "<22 chars>",
      "reason": "Fix subtract function"
    }
  },
  {
    "type": "edit_applied",
    "path": "src/math.js",
    "applied": true,
    "approvalMode": "manual",
    "approved": true,
    "outcome": "applied"
  },
  {
    "type": "verification",
    "command": "npm test",
    "decision": "allow",
    "exitCode": 0,
    "timedOut": false,
    "passed": true
  },
  {
    "type": "final",
    "status": "success",
    "content": "Fixed the failing test..."
  }
]
```

Trace text is capped and redacted to reduce accidental leakage of API keys, bearer tokens, passwords, and `.env`-style values.

## Demo Talking Points

- The model does not get arbitrary filesystem access; it must use tools.
- File writes are patch-style exact replacements, not broad overwrites.
- The diff is visible before the write.
- Manual approval is the default.
- Eval auto-approval is explicit and scoped to copied temp workspaces.
- Bash commands are policy-controlled.
- Verification runs after successful real edits.
- Traces provide evidence for what happened without storing huge raw outputs.
