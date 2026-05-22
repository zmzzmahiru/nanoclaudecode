import type { LLMMessage, LLMProvider } from "../llm/openai-compatible.js";
import { configToPermissionPolicy, loadConfig } from "../config.js";
import { loadProjectRules } from "./project-rules.js";
import {
  createSessionTrace,
  recordModelMessage,
  recordTodoEvent,
  recordToolCall,
  recordToolResult,
  saveSessionTrace,
  type SessionTrace,
} from "./session-trace.js";
import { runTool } from "../tools/index.js";

export interface AgentLoopInput {
  task: string;
  llm: LLMProvider;
  maxIterations?: number;
  projectRoot?: string;
  hooksEnabled?: boolean;
  rulesEnabled?: boolean;
}

export type TodoStatus = "pending" | "in_progress" | "done";

export interface Todo {
  id: string;
  content: string;
  status: TodoStatus;
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
    }
  | {
      type: "todo_list";
      todos: Todo[];
    }
  | {
      type: "todo_update";
      id: string;
      status: TodoStatus;
      content?: string;
    };

const MAX_AGENT_ITERATIONS = 20;
const NEAR_ITERATION_LIMIT_REMAINING = 3;

const SYSTEM_PROMPT = `You are NanoClaude, a minimal coding agent.
You must respond with JSON only. Do not wrap JSON in markdown.

For complex tasks, first produce a short todo list:
{"type":"todo_list","todos":[{"id":"1","content":"Inspect project structure","status":"in_progress"},{"id":"2","content":"Make the requested change","status":"pending"},{"id":"3","content":"Run npm run build","status":"pending"}]}

As you work, update progress before or after using tools:
{"type":"todo_update","id":"1","status":"done"}
{"type":"todo_update","id":"2","status":"in_progress"}

Be concise with tool calls. Do not inspect unnecessary files. When enough information has been gathered, return a final answer.

Return a final answer as:
{"type":"final","content":"..."}

Or request a tool call as:
{"type":"tool_call","tool":"read_file","args":{"path":"package.json"}}
{"type":"tool_call","tool":"list_files","args":{"path":"."}}
{"type":"tool_call","tool":"glob","args":{"pattern":"src/**/*.ts"}}
{"type":"tool_call","tool":"grep","args":{"pattern":"OpenAICompatibleProvider","path":"src"}}
{"type":"tool_call","tool":"bash","args":{"command":"npm run build","cwd":"."}}
{"type":"tool_call","tool":"edit_file","args":{"path":"README.md","oldText":"old text","newText":"new text","reason":"why this edit is needed"}}

Available tools:
- read_file: read a UTF-8 text file inside the project root.
- list_files: list files and directories directly inside a project directory.
- glob: find files by glob pattern inside the project root. Ignores node_modules and dist.
- grep: search text files under a path for a string pattern. Ignores node_modules and dist.
- bash: run a development command from the project root using the allow/confirm/deny permission policy. Confirm-class commands require explicit user approval.
- edit_file: replace exactly one oldText occurrence with newText, show a unified diff, and write only after explicit user approval. Include a short reason.

Hooks:
- After a successful edit_file call, NanoClaude automatically runs configured after-edit verification commands through the bash permission policy. Do not request duplicate verification unless another command is needed.`;

function buildSystemPrompt(rules: Awaited<ReturnType<typeof loadProjectRules>>): string {
  if (!rules) {
    return SYSTEM_PROMPT;
  }

  return `${SYSTEM_PROMPT}

Project rules loaded from ${rules.fileName}:
${rules.content}`;
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === "pending" || value === "in_progress" || value === "done";
}

function parseTodo(value: unknown): Todo {
  if (typeof value !== "object" || value === null) {
    throw new Error("Todo must be an object.");
  }

  const todo = value as Partial<Todo>;

  if (
    typeof todo.id !== "string" ||
    typeof todo.content !== "string" ||
    !isTodoStatus(todo.status)
  ) {
    throw new Error("Todo must include id, content, and a valid status.");
  }

  return {
    id: todo.id,
    content: todo.content,
    status: todo.status,
  };
}

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

  if (parsed.type === "todo_list" && Array.isArray(parsed.todos)) {
    return {
      type: "todo_list",
      todos: parsed.todos.map(parseTodo),
    };
  }

  if (
    parsed.type === "todo_update" &&
    typeof parsed.id === "string" &&
    isTodoStatus(parsed.status)
  ) {
    const update: Extract<ModelResponse, { type: "todo_update" }> = {
      type: "todo_update",
      id: parsed.id,
      status: parsed.status,
    };

    if (typeof parsed.content === "string") {
      update.content = parsed.content;
    }

    return update;
  }

  throw new Error(
    "Model response must be a final answer, todo list, todo update, or tool call JSON object.",
  );
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

function printTodo(todo: Todo): void {
  console.log(`[todo] ${todo.status}: ${todo.content}`);
}

function todoStateMessage(todos: Todo[]): string {
  return JSON.stringify({
    type: "todo_state",
    todos,
  });
}

function nearIterationLimitMessage(remainingIterations: number): string {
  return JSON.stringify({
    type: "iteration_limit_warning",
    remainingIterations,
    instruction:
      "You are near the iteration limit. Summarize with available information instead of continuing to inspect more files unless one final tool call is essential.",
  });
}

function applyTodoList(
  todos: Todo[],
  nextTodos: Todo[],
  trace: SessionTrace,
): Todo[] {
  todos.splice(0, todos.length, ...nextTodos);

  for (const todo of todos) {
    printTodo(todo);
    recordTodoEvent(trace, todo);
  }

  return todos;
}

function applyTodoUpdate(
  todos: Todo[],
  update: Extract<ModelResponse, { type: "todo_update" }>,
  trace: SessionTrace,
): Todo[] {
  const existingTodo = todos.find((todo) => todo.id === update.id);

  if (!existingTodo) {
    const newTodo: Todo = {
      id: update.id,
      content: update.content ?? `Todo ${update.id}`,
      status: update.status,
    };
    todos.push(newTodo);
    printTodo(newTodo);
    recordTodoEvent(trace, newTodo);
    return todos;
  }

  existingTodo.status = update.status;
  if (update.content) {
    existingTodo.content = update.content;
  }
  printTodo(existingTodo);
  recordTodoEvent(trace, existingTodo);

  return todos;
}

export async function runAgent(input: AgentLoopInput): Promise<string> {
  const projectRoot = input.projectRoot ?? process.cwd();
  const config = await loadConfig(projectRoot);
  const maxIterations = input.maxIterations ?? config.agent.maxSteps ?? MAX_AGENT_ITERATIONS;
  const hooksEnabled = input.hooksEnabled ?? true;
  const rulesEnabled = input.rulesEnabled ?? true;
  const toolContext = {
    projectRoot,
    permissionPolicy: configToPermissionPolicy(config),
    maxToolOutputChars: config.agent.maxToolOutputChars,
    commandTimeoutMs: config.verify.timeoutMs,
    verifyAfterEdit: hooksEnabled ? config.verify.afterEdit : [],
  };
  const projectRules = rulesEnabled ? await loadProjectRules(projectRoot) : null;
  if (projectRules) {
    console.log(`[rules] loaded ${projectRules.fileName}`);
  }
  const trace = createSessionTrace(
    projectRules
      ? {
          userTask: input.task,
          loadedRulesFile: projectRules.fileName,
        }
      : {
          userTask: input.task,
        },
  );

  const todos: Todo[] = [];
  const messages: LLMMessage[] = [
    {
      role: "system",
      content: buildSystemPrompt(projectRules),
    },
    {
      role: "user",
      content: input.task,
    },
  ];

  try {
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const remainingIterations = maxIterations - iteration;
      if (remainingIterations === NEAR_ITERATION_LIMIT_REMAINING) {
        messages.push({
          role: "user",
          content: nearIterationLimitMessage(remainingIterations),
        });
      }

      const content = await input.llm.complete(messages);
      messages.push({
        role: "assistant",
        content,
      });
      recordModelMessage(trace, content, {
        maxTextLength: config.agent.maxToolOutputChars,
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
        const tracePath = await saveSessionTrace(projectRoot, trace, {
          status: "success",
          finalAnswer: response.content,
        });
        console.log(`[session] saved ${tracePath}`);
        return response.content;
      }

      if (response.type === "todo_list") {
        applyTodoList(todos, response.todos, trace);
        messages.push({
          role: "user",
          content: todoStateMessage(todos),
        });
        continue;
      }

      if (response.type === "todo_update") {
        applyTodoUpdate(todos, response, trace);
        messages.push({
          role: "user",
          content: todoStateMessage(todos),
        });
        continue;
      }

      console.log(`[tool_call] ${response.tool} ${formatToolArgs(response.args)}`);
      recordToolCall(trace, response.tool, response.args, { source: "model" });
      const result = await runTool(response.tool, response.args, toolContext);
      recordToolResult(trace, response.tool, response.args, result, {
        source: "model",
        maxTextLength: config.agent.maxToolOutputChars,
      });
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

    const stoppedMessage = `Stopped after ${maxIterations} iterations without a final answer.`;
    const tracePath = await saveSessionTrace(projectRoot, trace, {
      status: "stopped",
      finalAnswer: stoppedMessage,
    });
    console.log(`[session] saved ${tracePath}`);
    return stoppedMessage;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const tracePath = await saveSessionTrace(projectRoot, trace, {
      status: "error",
      error: message,
    });
    console.log(`[session] saved ${tracePath}`);
    throw error;
  }
}
