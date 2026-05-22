import "dotenv/config";

import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runAgent } from "../src/agent/loop.js";
import { createOpenAICompatibleProvider } from "../src/llm/openai-compatible.js";
import { capAndRedact } from "../src/redaction.js";

export interface EvalTask {
  id: string;
  taskDir: string;
  taskPath: string;
  repoPath: string;
  checkerPath: string;
  checkerName: string;
}

export interface CheckerResult {
  passed: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface EvalResult {
  taskId: string;
  result: "PASS" | "FAIL";
  steps: number | null;
  toolCalls: number | null;
  editAttempts: string;
  verification: string;
  failureReason: FailureReason;
  summaryPath: string;
  tracePath: string | null;
  trace: string;
  error: string | null;
}

export type VerificationStatus = "PASS" | "FAIL" | "N/A" | "UNKNOWN";

export type FailureReason =
  | "-"
  | "checker_failed"
  | "model_stopped_early"
  | "verification_failed"
  | "permission_denied"
  | "path_safety_rejection"
  | "duplicate_oldtext_rejection"
  | "no_edit_applied"
  | "unknown";

export interface EvalMetrics {
  steps: number | null;
  toolCalls: number | null;
  editAttempts: {
    total: number;
    applied: number;
    rejected: number;
  } | null;
  verification: VerificationStatus;
}

export function evalAgentOptions(): {
  autoApproveEdits: true;
} {
  return {
    autoApproveEdits: true,
  };
}

const DEFAULT_EVAL_ROOT = path.join(process.cwd(), "eval");
const RESULTS_DIR_NAME = "results";
const CHECK_TIMEOUT_MS = 30_000;
const MAX_CAPTURE_CHARS = 12_000;

export async function discoverEvalTasks(
  tasksRoot = path.join(DEFAULT_EVAL_ROOT, "tasks"),
): Promise<EvalTask[]> {
  const entries = await readdir(tasksRoot, { withFileTypes: true });
  const tasks: EvalTask[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const taskDir = path.join(tasksRoot, entry.name);
    const taskPath = path.join(taskDir, "task.md");
    const repoPath = path.join(taskDir, "repo");
    const checkerPath = await findChecker(taskDir);

    if (!(await exists(taskPath)) || !(await exists(repoPath)) || !checkerPath) {
      continue;
    }

    tasks.push({
      id: entry.name,
      taskDir,
      taskPath,
      repoPath,
      checkerPath,
      checkerName: path.basename(checkerPath),
    });
  }

  return tasks.sort((left, right) => left.id.localeCompare(right.id));
}

export async function createTaskWorkspace(
  task: EvalTask,
  runRoot: string,
): Promise<string> {
  const workspace = path.join(runRoot, "workspaces", task.id);
  await mkdir(path.dirname(workspace), { recursive: true });
  await cp(task.repoPath, workspace, { recursive: true });
  return workspace;
}

export async function runChecker(
  checkerPath: string,
  cwd: string,
  timeoutMs = CHECK_TIMEOUT_MS,
  extraEnv: Record<string, string> = {},
): Promise<CheckerResult> {
  const command = checkerPath.endsWith(".js") ? process.execPath : "sh";
  const args = checkerPath.endsWith(".js") ? [checkerPath] : [checkerPath];

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        passed: false,
        exitCode: null,
        stdout: capAndRedact(stdout, MAX_CAPTURE_CHARS),
        stderr: capAndRedact(stderr, MAX_CAPTURE_CHARS),
        error: error.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        passed: code === 0 && !timedOut,
        exitCode: code,
        stdout: capAndRedact(stdout, MAX_CAPTURE_CHARS),
        stderr: capAndRedact(stderr, MAX_CAPTURE_CHARS),
        error: timedOut ? `Checker timed out after ${timeoutMs}ms.` : null,
      });
    });
  });
}

export async function findLatestSessionTrace(
  workspace: string,
): Promise<string | null> {
  const sessionsDir = path.join(workspace, ".nanoclaude", "sessions");

  if (!(await exists(sessionsDir))) {
    return null;
  }

  const files = await readdir(sessionsDir);
  const jsonFiles = files.filter((file) => file.endsWith(".json"));
  let latest: { path: string; mtimeMs: number } | null = null;

  for (const file of jsonFiles) {
    const filePath = path.join(sessionsDir, file);
    const info = await stat(filePath);
    if (!latest || info.mtimeMs > latest.mtimeMs) {
      latest = { path: filePath, mtimeMs: info.mtimeMs };
    }
  }

  return latest?.path ?? null;
}

export async function extractTraceStepCount(
  tracePath: string | null,
): Promise<number | null> {
  if (!tracePath) {
    return null;
  }

  try {
    const parsed = JSON.parse(await readFile(tracePath, "utf8")) as {
      steps?: unknown[];
      toolCalls?: unknown[];
    };
    if (Array.isArray(parsed.steps)) {
      return parsed.steps.length;
    }

    if (Array.isArray(parsed.toolCalls)) {
      return parsed.toolCalls.length;
    }
  } catch {
    return null;
  }

  return null;
}

export async function extractEvalMetrics(
  tracePath: string | null,
): Promise<EvalMetrics> {
  if (!tracePath) {
    return emptyMetrics("UNKNOWN");
  }

  try {
    const parsed = JSON.parse(await readFile(tracePath, "utf8")) as {
      steps?: unknown[];
      toolCalls?: unknown[];
    };
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const toolCalls = countToolCalls(steps, parsed.toolCalls);
    const editAttempts = countEditAttempts(steps);

    return {
      steps: steps.length,
      toolCalls,
      editAttempts,
      verification: classifyVerificationStatus(steps),
    };
  } catch {
    return emptyMetrics("UNKNOWN");
  }
}

export function classifyVerificationStatus(steps: unknown[]): VerificationStatus {
  const verificationSteps = steps
    .map(asRecord)
    .filter((step) => step?.type === "verification");

  if (verificationSteps.length === 0) {
    return "N/A";
  }

  return verificationSteps.every((step) => step.passed === true) ? "PASS" : "FAIL";
}

export function classifyFailureReason(input: {
  result: "PASS" | "FAIL";
  metrics: EvalMetrics;
  checker: CheckerResult;
  agentError: string | null;
  traceText?: string;
}): FailureReason {
  if (input.result === "PASS") {
    return "-";
  }

  const traceText = input.traceText ?? "";

  if (input.metrics.verification === "FAIL") {
    return "verification_failed";
  }

  if (/permission_decision[\s\S]*"decision"\s*:\s*"deny"|Command denied by policy/i.test(traceText)) {
    return "permission_denied";
  }

  if (/outside the project root|Absolute paths are not allowed/i.test(traceText)) {
    return "path_safety_rejection";
  }

  if (/oldText appears multiple times/i.test(traceText)) {
    return "duplicate_oldtext_rejection";
  }

  if (input.metrics.editAttempts && input.metrics.editAttempts.applied === 0) {
    return "no_edit_applied";
  }

  if (/Stopped after \d+ iterations/i.test(traceText) || input.agentError) {
    return "model_stopped_early";
  }

  if (!input.checker.passed) {
    return "checker_failed";
  }

  return "unknown";
}

export function formatResultTable(results: EvalResult[]): string {
  const rows = [
    [
      "Task",
      "Result",
      "Steps",
      "ToolCalls",
      "EditAttempts",
      "Verification",
      "FailureReason",
      "Trace",
    ],
    ...results.map((result) => [
      result.taskId,
      result.result,
      result.steps === null ? "-" : String(result.steps),
      result.toolCalls === null ? "-" : String(result.toolCalls),
      result.editAttempts,
      result.verification,
      result.failureReason,
      result.trace,
    ]),
  ];
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  ) ?? [0, 0, 0, 0];

  const lines = rows.map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("   ")
      .trimEnd(),
  );
  const passed = results.filter((result) => result.result === "PASS").length;
  return `${lines.join("\n")}\n\nSuccess rate: ${passed}/${results.length}`;
}

export function parsePassFail(result: CheckerResult): "PASS" | "FAIL" {
  return result.passed ? "PASS" : "FAIL";
}

export function formatEditAttempts(metrics: EvalMetrics): string {
  if (!metrics.editAttempts) {
    return "-";
  }

  return `${metrics.editAttempts.total} (${metrics.editAttempts.applied} applied, ${metrics.editAttempts.rejected} rejected)`;
}

export function buildSummaryPayload(input: {
  taskId: string;
  result: "PASS" | "FAIL";
  metrics: EvalMetrics;
  failureReason: FailureReason;
  checkerName: string;
  workspace: string;
  tracePath: string | null;
  relativeTracePath: string;
  agentOutput: string;
  agentError: string | null;
  agentLog: string;
  checker: CheckerResult;
}): Record<string, unknown> {
  return {
    taskId: input.taskId,
    result: input.result,
    metrics: {
      ...input.metrics,
      editAttempts: input.metrics.editAttempts,
      failureReason: input.failureReason,
    },
    steps: input.metrics.steps,
    toolCalls: input.metrics.toolCalls,
    editAttempts: formatEditAttempts(input.metrics),
    verification: input.metrics.verification,
    failureReason: input.failureReason,
    checkerName: input.checkerName,
    workspace: input.workspace,
    tracePath: input.tracePath,
    relativeTracePath: input.relativeTracePath,
    agentOutput: capAndRedact(input.agentOutput, MAX_CAPTURE_CHARS),
    agentError: input.agentError
      ? capAndRedact(input.agentError, MAX_CAPTURE_CHARS)
      : null,
    agentLog: capAndRedact(input.agentLog, MAX_CAPTURE_CHARS),
    checker: input.checker,
    autoApproveEdits: true,
  };
}

async function runSingleTask(input: {
  task: EvalTask;
  runRoot: string;
}): Promise<EvalResult> {
  const workspace = await createTaskWorkspace(input.task, input.runRoot);
  const taskText = await readFile(input.task.taskPath, "utf8");
  const logs: string[] = [];
  const originalLog = console.log;
  let agentOutput = "";
  let agentError: string | null = null;

  try {
    console.log = (...args: unknown[]) => {
      const line = args.map((arg) => String(arg)).join(" ");
      logs.push(line);
      originalLog(...args);
    };
    agentOutput = await runAgent({
      task: taskText,
      llm: createOpenAICompatibleProvider(),
      projectRoot: workspace,
      ...evalAgentOptions(),
    });
  } catch (error: unknown) {
    agentError = error instanceof Error ? error.message : String(error);
  } finally {
    console.log = originalLog;
  }

  const tracePath = await findLatestSessionTrace(workspace);
  const checker = await runChecker(input.task.checkerPath, workspace, CHECK_TIMEOUT_MS, {
    NANOCLAUDE_TRACE_PATH: tracePath ?? "",
  });
  const metrics = await extractEvalMetrics(tracePath);
  const result = parsePassFail(checker);
  const summaryPath = path.join(input.runRoot, `${input.task.id}.summary.json`);
  const traceText = tracePath ? await readOptionalText(tracePath) : "";
  const failureReason = classifyFailureReason({
    result,
    metrics,
    checker,
    agentError,
    traceText,
  });
  const relativeTracePath = tracePath
    ? path.relative(input.runRoot, tracePath).split(path.sep).join("/")
    : path.basename(summaryPath);

  await writeFile(
    summaryPath,
    `${JSON.stringify(
      buildSummaryPayload({
        taskId: input.task.id,
        result,
        failureReason,
        checkerName: input.task.checkerName,
        workspace,
        tracePath,
        relativeTracePath,
        metrics,
        agentOutput,
        agentError,
        agentLog: logs.join("\n"),
        checker,
      }),
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    taskId: input.task.id,
    result,
    steps: metrics.steps,
    toolCalls: metrics.toolCalls,
    editAttempts: formatEditAttempts(metrics),
    verification: metrics.verification,
    failureReason,
    summaryPath,
    tracePath,
    trace: relativeTracePath,
    error: agentError ?? checker.error,
  };
}

async function main(): Promise<void> {
  const tasks = await discoverEvalTasks();

  if (tasks.length === 0) {
    throw new Error("No eval tasks found under eval/tasks.");
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(DEFAULT_EVAL_ROOT, RESULTS_DIR_NAME, runId);
  await mkdir(runRoot, { recursive: true });

  const results: EvalResult[] = [];
  console.log("[eval] auto-approving edit_file patches in temp workspaces only");
  for (const task of tasks) {
    console.log(`\n[eval] ${task.id}`);
    results.push(await runSingleTask({ task, runRoot }));
  }

  const table = formatResultTable(results);
  await writeFile(path.join(runRoot, "summary.txt"), `${table}\n`, "utf8");
  console.log(`\n${table}`);
  console.log(`\n[eval] results saved ${path.relative(process.cwd(), runRoot)}`);
}

async function findChecker(taskDir: string): Promise<string | null> {
  const jsChecker = path.join(taskDir, "check.js");
  if (await exists(jsChecker)) {
    return jsChecker;
  }

  const shChecker = path.join(taskDir, "check.sh");
  if (await exists(shChecker)) {
    return shChecker;
  }

  return null;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function emptyMetrics(verification: VerificationStatus): EvalMetrics {
  return {
    steps: null,
    toolCalls: null,
    editAttempts: null,
    verification,
  };
}

function countToolCalls(
  steps: unknown[],
  legacyToolCalls: unknown[] | undefined,
): number | null {
  if (steps.length > 0) {
    return steps.filter((step) => asRecord(step)?.type === "tool_call").length;
  }

  return Array.isArray(legacyToolCalls) ? legacyToolCalls.length : null;
}

function countEditAttempts(steps: unknown[]): EvalMetrics["editAttempts"] {
  if (steps.length === 0) {
    return null;
  }

  const editToolCalls = steps.filter((step) => {
    const record = asRecord(step);
    return record?.type === "tool_call" && record.tool === "edit_file";
  }).length;
  const editEvents = steps
    .map(asRecord)
    .filter((step) => step?.type === "edit_applied");
  const applied = editEvents.filter((step) => step.applied === true).length;
  const rejected = editEvents.filter((step) => step.applied !== true).length;

  return {
    total: editToolCalls || editEvents.length,
    applied,
    rejected,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

async function readOptionalText(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (process.argv[1] && entryPath === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[eval] failed: ${message}`);
    process.exitCode = 1;
  });
}
