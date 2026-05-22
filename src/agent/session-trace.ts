import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Todo } from "./loop.js";
import type { ToolResult } from "../tools/index.js";
import { capAndRedact } from "../redaction.js";

export type SessionStatus = "success" | "stopped" | "error";
export type AgentStepType =
  | "model_message"
  | "tool_call"
  | "tool_result"
  | "permission_decision"
  | "edit_applied"
  | "verification"
  | "final";

export interface SessionTrace {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  userTask: string;
  loadedRulesFile?: string;
  todoEvents: TodoTraceEvent[];
  toolCalls: ToolCallTrace[];
  toolResults: ToolResultTrace[];
  steps: AgentStep[];
  finalAnswer?: string;
  status?: SessionStatus;
  error?: string;
}

export interface AgentStep {
  at: string;
  type: AgentStepType;
  [key: string]: unknown;
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
  source?: "model" | "hook";
  hookName?: string;
}

export interface ToolResultTrace {
  at: string;
  tool: string;
  success: boolean;
  output: string;
  error: string | null;
  source?: "model" | "hook";
  hookName?: string;
}

const TRACE_DIR = ".nanoclaude/sessions";
const MAX_TRACE_TEXT_LENGTH = 4_000;
const MAX_FINAL_ANSWER_LENGTH = 12_000;

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
    steps: [],
  };

  if (input.loadedRulesFile) {
    trace.loadedRulesFile = input.loadedRulesFile;
  }

  return trace;
}

export function recordModelMessage(
  trace: SessionTrace,
  content: string,
  metadata: { maxTextLength?: number } = {},
): void {
  trace.steps.push({
    at: new Date().toISOString(),
    type: "model_message",
    content: capAndRedact(
      content,
      metadata.maxTextLength ?? MAX_FINAL_ANSWER_LENGTH,
    ),
  });
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
  metadata: { source?: "model" | "hook"; hookName?: string } = {},
): void {
  const entry: ToolCallTrace = {
    at: new Date().toISOString(),
    tool,
    args: summarizeArgs(args),
  };

  if (metadata.source) {
    entry.source = metadata.source;
  }

  if (metadata.hookName) {
    entry.hookName = metadata.hookName;
  }

  trace.toolCalls.push(entry);
  trace.steps.push({
    type: "tool_call",
    ...entry,
  });
}

export function recordToolResult(
  trace: SessionTrace,
  tool: string,
  args: unknown,
  result: ToolResult,
  metadata: {
    source?: "model" | "hook";
    hookName?: string;
    maxTextLength?: number;
  } = {},
): void {
  const maxTextLength = metadata.maxTextLength ?? MAX_TRACE_TEXT_LENGTH;
  const entry: ToolResultTrace = {
    at: new Date().toISOString(),
    tool,
    success: result.success,
    output: summarizeToolOutput(tool, args, result.output, maxTextLength),
    error: result.error ? capAndRedact(result.error, maxTextLength) : null,
  };

  if (metadata.source) {
    entry.source = metadata.source;
  }

  if (metadata.hookName) {
    entry.hookName = metadata.hookName;
  }

  trace.toolResults.push(entry);
  trace.steps.push({
    type: "tool_result",
    ...entry,
  });
  recordDerivedToolSteps(trace, tool, result.output, maxTextLength);
}

export function recordFinal(
  trace: SessionTrace,
  input: {
    status: SessionStatus;
    finalAnswer?: string;
    error?: string;
  },
): void {
  const step: AgentStep = {
    at: new Date().toISOString(),
    type: "final",
    status: input.status,
  };

  if (input.finalAnswer) {
    step.content = capAndRedact(input.finalAnswer, MAX_FINAL_ANSWER_LENGTH);
  }

  if (input.error) {
    step.error = capAndRedact(input.error);
  }

  trace.steps.push(step);
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

  recordFinal(trace, input);

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

function summarizeToolOutput(
  tool: string,
  args: unknown,
  output: string,
  maxLength: number = MAX_TRACE_TEXT_LENGTH,
): string {
  if (tool === "read_file" && isSensitiveFileArg(args)) {
    return "<redacted sensitive file output>";
  }

  return capAndRedact(output, maxLength);
}

function isSensitiveFileArg(args: unknown): boolean {
  if (typeof args !== "object" || args === null || !("path" in args)) {
    return false;
  }

  const filePath = String((args as { path?: unknown }).path ?? "");
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return normalized === ".env" || normalized.endsWith("/.env");
}

function recordDerivedToolSteps(
  trace: SessionTrace,
  tool: string,
  output: string,
  maxTextLength: number,
): void {
  if (tool === "bash") {
    const commandResult = parseJsonObject(output);
    if (commandResult) {
      recordPermissionDecision(trace, commandResult, maxTextLength);
    }
    return;
  }

  if (tool !== "edit_file") {
    return;
  }

  const editResult = parseJsonObject(output);
  if (!editResult) {
    return;
  }

  const applied = editResult.applied === true;
  const error =
    typeof editResult.error === "string" ? capAndRedact(editResult.error) : null;
  const outcome = applied
    ? "applied"
    : error === "Edit rejected by user."
      ? "rejected"
      : error
        ? "failed"
        : "no_op";

  trace.steps.push({
    at: new Date().toISOString(),
    type: "edit_applied",
    path: typeof editResult.path === "string" ? editResult.path : "",
    applied,
    outcome,
    reason:
      typeof editResult.reason === "string"
        ? capAndRedact(editResult.reason)
        : "",
    error,
  });

  const verification = getRecord(editResult.verification);
  const results = Array.isArray(verification?.results)
    ? verification.results
    : [];

  for (const verificationResult of results) {
    const record = getRecord(verificationResult);
    if (record) {
      recordPermissionDecision(trace, record, maxTextLength);
      recordVerification(trace, record, maxTextLength);
    }
  }
}

function recordPermissionDecision(
  trace: SessionTrace,
  commandResult: Record<string, unknown>,
  maxTextLength: number,
): void {
  const decision = readString(commandResult.decision);
  const error = readNullableString(commandResult.error, maxTextLength);

  trace.steps.push({
    at: new Date().toISOString(),
    type: "permission_decision",
    command: readString(commandResult.command),
    decision,
    allowed: decision !== "deny" && error !== "Command rejected by user.",
    exitCode: readNullableNumber(commandResult.exitCode),
    timedOut: commandResult.timedOut === true,
    error,
  });
}

function recordVerification(
  trace: SessionTrace,
  verificationResult: Record<string, unknown>,
  maxTextLength: number,
): void {
  const exitCode = readNullableNumber(verificationResult.exitCode);
  const timedOut = verificationResult.timedOut === true;
  const error = readNullableString(verificationResult.error, maxTextLength);
  const passed = exitCode === 0 && !timedOut && error === null;

  trace.steps.push({
    at: new Date().toISOString(),
    type: "verification",
    command: readString(verificationResult.command),
    decision: readString(verificationResult.decision),
    exitCode,
    timedOut,
    passed,
    stdout: readString(verificationResult.stdout, maxTextLength),
    stderr: readString(verificationResult.stderr, maxTextLength),
    error,
  });
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return getRecord(parsed);
  } catch {
    return null;
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown, maxTextLength = MAX_TRACE_TEXT_LENGTH): string {
  return typeof value === "string" ? capAndRedact(value, maxTextLength) : "";
}

function readNullableString(
  value: unknown,
  maxTextLength = MAX_TRACE_TEXT_LENGTH,
): string | null {
  return typeof value === "string" ? capAndRedact(value, maxTextLength) : null;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}
