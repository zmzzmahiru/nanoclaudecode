import type { LLMMessage, LLMProvider } from "../llm/openai-compatible.js";
import { runTool } from "../tools/index.js";

export interface AgentLoopInput {
  task: string;
  llm: LLMProvider;
  maxIterations?: number;
  projectRoot?: string;
}

type ModelResponse =
  | {
      type: "final";
      content: string;
    }
  | {
      type: "tool_call";
      tool: string;
      args: unknown;
    };

const SYSTEM_PROMPT = `You are NanoClaude, a minimal coding agent.
You must respond with JSON only. Do not wrap JSON in markdown.

Return a final answer as:
{"type":"final","content":"..."}

Or request a tool call as:
{"type":"tool_call","tool":"read_file","args":{"path":"package.json"}}
{"type":"tool_call","tool":"list_files","args":{"path":"."}}
{"type":"tool_call","tool":"glob","args":{"pattern":"src/**/*.ts"}}
{"type":"tool_call","tool":"grep","args":{"pattern":"OpenAICompatibleProvider","path":"src"}}
{"type":"tool_call","tool":"bash","args":{"command":"npm run build","cwd":"."}}
{"type":"tool_call","tool":"edit_file","args":{"path":"README.md","oldText":"old text","newText":"new text"}}
{"type":"tool_call","tool":"edit_file","args":{"path":"README.md","content":"full new file content"}}

Available tools:
- read_file: read a UTF-8 text file inside the project root.
- list_files: list files and directories directly inside a project directory.
- glob: find files by glob pattern inside the project root. Ignores node_modules and dist.
- grep: search text files under a path for a string pattern. Ignores node_modules and dist.
- bash: run a development command from a project directory after explicit user approval. Avoid destructive or high-risk commands.
- edit_file: propose a replace or overwrite edit, show a unified diff, and write only after explicit user approval.`;

function parseModelResponse(content: string): ModelResponse {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(withoutFence) as Partial<ModelResponse>;

  if (parsed.type === "final" && typeof parsed.content === "string") {
    return {
      type: "final",
      content: parsed.content,
    };
  }

  if (parsed.type === "tool_call" && typeof parsed.tool === "string") {
    return {
      type: "tool_call",
      tool: parsed.tool,
      args: parsed.args ?? {},
    };
  }

  throw new Error("Model response must be a final answer or tool call JSON object.");
}

function formatToolArgs(args: unknown): string {
  try {
    return JSON.stringify(summarizeToolArgs(args ?? {}));
  } catch {
    return "{}";
  }
}

function summarizeToolArgs(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key === "content" || key === "oldText" || key === "newText") {
      return `<${value.length} chars>`;
    }

    return value.length > 240 ? `${value.slice(0, 240)}...` : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => summarizeToolArgs(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        summarizeToolArgs(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

export async function runAgent(input: AgentLoopInput): Promise<string> {
  const maxIterations = input.maxIterations ?? 8;
  const projectRoot = input.projectRoot ?? process.cwd();
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: input.task,
    },
  ];

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const content = await input.llm.complete(messages);
    messages.push({
      role: "assistant",
      content,
    });

    let response: ModelResponse;
    try {
      response = parseModelResponse(content);
    } catch (error: unknown) {
      messages.push({
        role: "user",
        content: JSON.stringify({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Could not parse model response as JSON.",
        }),
      });
      continue;
    }

    if (response.type === "final") {
      return response.content;
    }

    console.log(`[tool_call] ${response.tool} ${formatToolArgs(response.args)}`);
    const result = await runTool(response.tool, response.args, { projectRoot });
    console.log(`[tool_result] success=${result.success}`);

    messages.push({
      role: "user",
      content: JSON.stringify({
        type: "tool_result",
        tool: response.tool,
        result,
      }),
    });
  }

  return `Stopped after ${maxIterations} iterations without a final answer.`;
}
