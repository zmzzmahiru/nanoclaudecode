# NanoClaude Architecture

NanoClaude is organized as a small set of TypeScript modules. The goal is to make each agent concept easy to find, reason about, and replace.

## LLM Provider Layer

The provider lives in `src/llm/openai-compatible.ts`. It wraps the OpenAI SDK against any OpenAI-compatible endpoint using:

- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

The rest of the agent depends on a small `LLMProvider` interface, not on provider-specific details.

## Agent Loop

The main loop lives in `src/agent/loop.ts`.

Its job is to:

- build the system prompt
- load project rules
- send conversation messages to the model
- parse JSON responses
- execute tools
- update todos
- run hooks
- save a session trace
- stop on final answer or iteration limit

The default iteration limit is intentionally finite to prevent runaway loops.

## JSON Protocol

NanoClaude does not use official function calling yet. The model must reply with JSON:

```json
{
  "type": "final",
  "content": "..."
}
```

```json
{
  "type": "tool_call",
  "tool": "read_file",
  "args": {
    "path": "package.json"
  }
}
```

Planning uses:

```json
{
  "type": "todo_update",
  "id": "1",
  "status": "done"
}
```

This keeps the protocol inspectable and easy to test.

## Tool Registry

The registry lives in `src/tools/index.ts`.

It maps tool names to implementations:

- `read_file`
- `list_files`
- `glob`
- `grep`
- `bash`
- `edit_file`

All tools return:

```json
{
  "success": true,
  "output": "...",
  "error": null
}
```

## Permission System

Permission prompts live in `src/permissions`.

`bash` asks before running commands. `edit_file` performs one exact `oldText` to `newText` replacement, asks before writing files after showing a unified diff, and rejects missing or duplicate matches. Non-interactive runs default to rejection, which is safer for tests and automation.

## Path Safety

Path safety lives in `src/tools/path-safety.ts`.

Tools resolve paths against the project root and reject attempts to escape it. Search tools ignore `node_modules` and `dist` by default. Symlink and real-path checks reduce accidental access outside the intended workspace.

## Plan Mode

Plan Mode is implemented in memory inside the agent loop.

The model can create a todo list and update items as it works. The CLI prints updates:

```text
[todo] in_progress: Inspect project structure
[todo] done: Run npm run build
```

Todos are not stored in a database; they exist for one run and are also recorded in the session trace.

## Project Rules Loading

Project rules are loaded by `src/agent/project-rules.ts`.

NanoClaude checks the project root in this priority order:

1. `NANOCLAUDE.md`
2. `AGENTS.md`
3. `CLAUDE.md`

Only the first match is loaded, and content is capped before being injected into the system prompt.

## Session Traces

Session traces are implemented in `src/agent/session-trace.ts`.

Each run writes a JSON file under `.nanoclaude/sessions` containing:

- session metadata
- user task
- loaded rules file
- todo events
- tool calls
- capped tool results
- final answer or error status

Trace logging redacts common secret-looking content and avoids storing raw `.env` output.

## Hooks

Hooks live in `src/agent/hooks.ts`.

The current hook is hardcoded:

- after a successful `edit_file`, propose `npm run build`

The hook reuses the `bash` tool, so it does not bypass approval. Hook-triggered tool calls are marked in the session trace with `source: "hook"`.

## Testing Strategy

Tests live in `tests/core.test.ts` and use Vitest.

The suite avoids real LLM calls and focuses on deterministic logic:

- path safety
- read/list/search tools
- edit validation
- trace redaction
- hook behavior
- CLI argument parsing

Filesystem tests use temporary directories so they do not depend on the repository state.
