# NanoClaude

NanoClaude is a lightweight AI coding agent framework written in TypeScript.

This first version is intentionally small: it provides a Node.js + TypeScript project, a CLI entry point, an OpenAI-compatible LLM provider, and a minimal JSON-based agent loop with read-only filesystem tools.

## Quick Start

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Set your model provider values in `.env`:

```bash
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=your_api_key_here
LLM_MODEL=gpt-4.1-mini
```

Run a task:

```bash
npm run dev -- "Explain how to create a small TypeScript CLI"
```

NanoClaude sends the task to the configured model and prints the response.

## v1 Tool Calling

NanoClaude v1 uses a simple JSON protocol instead of official OpenAI function calling. The model can either return a final answer:

```json
{
  "type": "final",
  "content": "..."
}
```

Or request one read-only tool call:

```json
{
  "type": "tool_call",
  "tool": "read_file",
  "args": {
    "path": "package.json"
  }
}
```

```json
{
  "type": "tool_call",
  "tool": "list_files",
  "args": {
    "path": "."
  }
}
```

NanoClaude executes the tool, appends a JSON tool result back into the conversation, and continues until the model returns `type: "final"` or the loop reaches 8 iterations.

Example:

```bash
npm run dev -- "List the project files, then summarize what this project does"
```

## v2 Codebase Search

NanoClaude v2 adds codebase search tools so the agent can explore before reading specific files.

Find files with `glob`:

```json
{
  "type": "tool_call",
  "tool": "glob",
  "args": {
    "pattern": "src/**/*.ts"
  }
}
```

Search text files with `grep`:

```json
{
  "type": "tool_call",
  "tool": "grep",
  "args": {
    "pattern": "OpenAICompatibleProvider",
    "path": "src"
  }
}
```

Both tools stay inside the project root, ignore `node_modules` and `dist` by default, and return `{ success, output, error }`.

Examples:

```bash
npm run dev -- "Find where the OpenAI-compatible provider is implemented"
npm run dev -- "Use glob to list TypeScript source files, then summarize the project layout"
```

## v3 Permission-Controlled Bash

NanoClaude v3 adds a `bash` tool for development commands. Before any command runs, NanoClaude prints the command and asks for approval with `y/N`.

```json
{
  "type": "tool_call",
  "tool": "bash",
  "args": {
    "command": "npm run build",
    "cwd": "."
  }
}
```

If the command is rejected, the tool returns:

```json
{
  "success": false,
  "output": "",
  "error": "Command rejected by user."
}
```

The tool keeps `cwd` inside the project root, rejects obvious high-risk commands, times out long-running commands, and caps stdout/stderr before returning results to the model.

Example:

```bash
npm run dev -- "Run the build and explain any TypeScript errors"
```

## Project Structure

```text
src/
  index.ts
  llm/openai-compatible.ts
  agent/loop.ts
  tools/read-file.ts
  tools/list-files.ts
  tools/glob.ts
  tools/grep.ts
  tools/bash.ts
  tools/index.ts
  permissions/confirm.ts
```

## Roadmap

- Add richer conversation state and tracing.
- Add more filesystem and shell tools.
- Add explicit permission checks before side effects.
- Add streaming model responses.
- Add tests for providers, CLI parsing, and agent loop behavior.
- Package the CLI for direct execution.
