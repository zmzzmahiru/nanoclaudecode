# NanoClaude Example Prompts

These prompts are safe starting points for trying NanoClaude against this repository.

## Inspect Project Structure

```bash
npm run dev -- "Inspect the project structure and explain the main folders"
```

Expected behavior: the agent will usually call `list_files` or `glob`, then summarize the layout.

## Summarize Available Tools

```bash
npm run dev -- "Find the tool registry and summarize every available tool"
```

Expected behavior: the agent should use `grep` or `read_file` on `src/tools/index.ts`.

## Make A Tiny README Improvement

```bash
npm run dev -- "Add one concise sentence to README.md clarifying that NanoClaude is educational"
```

Expected behavior: the agent should inspect `README.md`, propose an `edit_file` diff, ask for approval, then trigger the `after_edit` build hook.

## Verify Build

```bash
npm run dev -- "Run the TypeScript build and explain the result"
```

Expected behavior: the agent should request the `bash` tool with `npm run build`, ask for approval, and summarize stdout/stderr.

## Explain Agent Loop

```bash
npm run dev -- "Read the agent loop implementation and explain how JSON tool calling works"
```

Expected behavior: the agent should inspect `src/agent/loop.ts` and describe the control flow.

## Try CLI Flags

```bash
npm run dev -- --no-rules "Explain this repository without loading project rules"
npm run dev -- --no-hooks "Propose a documentation edit without auto verification"
npm run dev -- --max-iterations 30 "Explore the codebase and summarize the architecture"
```
