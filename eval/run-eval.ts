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
  verification: string;
  summaryPath: string;
  tracePath: string | null;
  error: string | null;
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
): Promise<CheckerResult> {
  const command = checkerPath.endsWith(".js") ? process.execPath : "sh";
  const args = checkerPath.endsWith(".js") ? [checkerPath] : [checkerPath];

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
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

export function formatResultTable(results: EvalResult[]): string {
  const rows = [
    ["Task", "Result", "Steps", "Verification"],
    ...results.map((result) => [
      result.taskId,
      result.result,
      result.steps === null ? "-" : String(result.steps),
      result.verification,
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

  const checker = await runChecker(input.task.checkerPath, workspace);
  const tracePath = await findLatestSessionTrace(workspace);
  const steps = await extractTraceStepCount(tracePath);
  const result = parsePassFail(checker);
  const summaryPath = path.join(input.runRoot, `${input.task.id}.summary.json`);

  await writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        taskId: input.task.id,
        result,
        steps,
        verification: input.task.checkerName,
        workspace,
        tracePath,
        agentOutput: capAndRedact(agentOutput, MAX_CAPTURE_CHARS),
        agentError: agentError ? capAndRedact(agentError, MAX_CAPTURE_CHARS) : null,
        agentLog: capAndRedact(logs.join("\n"), MAX_CAPTURE_CHARS),
        checker,
        autoApproveEdits: true,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    taskId: input.task.id,
    result,
    steps,
    verification: input.task.checkerName,
    summaryPath,
    tracePath,
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

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) : "";
if (process.argv[1] && entryPath === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[eval] failed: ${message}`);
    process.exitCode = 1;
  });
}
