import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Todo } from "./loop.js";
import type { ToolResult } from "../tools/index.js";

export type SessionStatus = "success" | "stopped" | "error";

export interface SessionTrace {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  userTask: string;
  loadedRulesFile?: string;
  todoEvents: TodoTraceEvent[];
  toolCalls: ToolCallTrace[];
  toolResults: ToolResultTrace[];
  finalAnswer?: string;
  status?: SessionStatus;
  error?: string;
}

export interface TodoTraceEvent {
  at: string;
  id: string;
  content: string;
  status: Todo["status"];
}

export interface ToolCallTrace {
  at: string;
  tool: string;
  args: unknown;
}

export interface ToolResultTrace {
  at: string;
  tool: string;
  success: boolean;
  output: string;
  error: string | null;
}

const TRACE_DIR = ".nanoclaude/sessions";
const MAX_TRACE_TEXT_LENGTH = 4_000;
const MAX_FINAL_ANSWER_LENGTH = 12_000;
const SECRET_ENV_NAMES = [
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPSEEK_API_KEY",
];

export function createSessionTrace(input: {
  userTask: string;
  loadedRulesFile?: string;
}): SessionTrace {
  const startedAt = new Date().toISOString();
  const sessionId = `${startedAt.replace(/[:.]/g, "-")}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const trace: SessionTrace = {
    sessionId,
    startedAt,
    userTask: capAndRedact(input.userTask, MAX_FINAL_ANSWER_LENGTH),
    todoEvents: [],
    toolCalls: [],
    toolResults: [],
  };

  if (input.loadedRulesFile) {
    trace.loadedRulesFile = input.loadedRulesFile;
  }

  return trace;
}

export function recordTodoEvent(trace: SessionTrace, todo: Todo): void {
  trace.todoEvents.push({
    at: new Date().toISOString(),
    id: todo.id,
    content: capAndRedact(todo.content),
    status: todo.status,
  });
}

export function recordToolCall(
  trace: SessionTrace,
  tool: string,
  args: unknown,
): void {
  trace.toolCalls.push({
    at: new Date().toISOString(),
    tool,
    args: summarizeArgs(args),
  });
}

export function recordToolResult(
  trace: SessionTrace,
  tool: string,
  args: unknown,
  result: ToolResult,
): void {
  trace.toolResults.push({
    at: new Date().toISOString(),
    tool,
    success: result.success,
    output: summarizeToolOutput(tool, args, result.output),
    error: result.error ? capAndRedact(result.error) : null,
  });
}

export async function saveSessionTrace(
  projectRoot: string,
  trace: SessionTrace,
  input: {
    status: SessionStatus;
    finalAnswer?: string;
    error?: string;
  },
): Promise<string> {
  trace.endedAt = new Date().toISOString();
  trace.status = input.status;

  if (input.finalAnswer) {
    trace.finalAnswer = capAndRedact(input.finalAnswer, MAX_FINAL_ANSWER_LENGTH);
  }

  if (input.error) {
    trace.error = capAndRedact(input.error);
  }

  const sessionDirectory = path.join(projectRoot, TRACE_DIR);
  await mkdir(sessionDirectory, { recursive: true });

  const tracePath = path.join(sessionDirectory, `${trace.sessionId}.json`);
  await writeFile(tracePath, `${JSON.stringify(trace, null, 2)}\n`, "utf8");

  return path.join(TRACE_DIR, `${trace.sessionId}.json`).split(path.sep).join("/");
}

function summarizeArgs(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key === "content" || key === "oldText" || key === "newText") {
      return `<${value.length} chars>`;
    }

    return capAndRedact(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => summarizeArgs(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        summarizeArgs(entryValue, entryKey),
      ]),
    );
  }

  return value;
}

function summarizeToolOutput(tool: string, args: unknown, output: string): string {
  if (tool === "read_file" && isSensitiveFileArg(args)) {
    return "<redacted sensitive file output>";
  }

  return capAndRedact(output);
}

function isSensitiveFileArg(args: unknown): boolean {
  if (typeof args !== "object" || args === null || !("path" in args)) {
    return false;
  }

  const filePath = String((args as { path?: unknown }).path ?? "");
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return normalized === ".env" || normalized.endsWith("/.env");
}

function capAndRedact(
  value: string,
  maxLength: number = MAX_TRACE_TEXT_LENGTH,
): string {
  const redacted = redactSecrets(value);

  if (redacted.length <= maxLength) {
    return redacted;
  }

  return `${redacted.slice(0, maxLength)}\n... trace content truncated`;
}

function redactSecrets(value: string): string {
  let redacted = value;

  for (const envName of SECRET_ENV_NAMES) {
    const secret = process.env[envName];
    if (secret && secret.length > 3) {
      redacted = redacted.split(secret).join("<redacted>");
    }
  }

  redacted = redacted.replace(
    /\b([A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*[^\s]+/gi,
    "$1=<redacted>",
  );
  redacted = redacted.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer <redacted>");

  return redacted;
}
