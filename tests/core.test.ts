import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/permissions/confirm-edit.js", () => ({
  confirmEdit: vi.fn(async () => true),
}));

import { confirmEdit } from "../src/permissions/confirm-edit.js";
import { runAfterEditHook } from "../src/agent/hooks.js";
import { runAgent } from "../src/agent/loop.js";
import {
  createSessionTrace,
  recordToolCall,
  recordToolResult,
} from "../src/agent/session-trace.js";
import {
  configToPermissionPolicy,
  DEFAULT_CONFIG,
  loadConfig,
} from "../src/config.js";
import { bashTool, decideCommand } from "../src/tools/bash.js";
import { editFileTool } from "../src/tools/edit-file.js";
import { globTool } from "../src/tools/glob.js";
import { grepTool } from "../src/tools/grep.js";
import { listFilesTool } from "../src/tools/list-files.js";
import { resolveInsideProject } from "../src/tools/path-safety.js";
import { readFileTool } from "../src/tools/read-file.js";
import { parseCliArgs } from "../src/index.js";
import {
  createTaskWorkspace,
  discoverEvalTasks,
  evalAgentOptions,
  extractTraceStepCount,
  formatResultTable,
  parsePassFail,
  runChecker,
  type EvalResult,
} from "../eval/run-eval.js";

const tempRoots: string[] = [];

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "nanoclaude-test-"));
  tempRoots.push(root);
  return root;
}

async function writeProjectFile(
  projectRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const filePath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function parseToolOutput(output: string): Record<string, unknown> {
  return JSON.parse(output) as Record<string, unknown>;
}

function allowNodePolicy() {
  return {
    allow: ["node"],
    confirm: [],
    deny: [],
  };
}

afterEach(async () => {
  vi.restoreAllMocks();

  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

describe("path safety", () => {
  it("rejects outside-root paths", async () => {
    const projectRoot = await createTempProject();

    await expect(resolveInsideProject(projectRoot, "../outside.txt")).rejects.toThrow(
      "outside the project root",
    );
  });
});

describe("filesystem tools", () => {
  it("read_file rejects outside-root paths", async () => {
    const projectRoot = await createTempProject();
    const result = await readFileTool(
      { path: "../outside.txt" },
      { projectRoot },
    );

    expect(result).toMatchObject({
      success: false,
      output: "",
    });
    expect(result.error).toContain("outside the project root");
  });

  it("list_files works on a temp project", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "# Test\n");
    await mkdir(path.join(projectRoot, "src"));

    const result = await listFilesTool({ path: "." }, { projectRoot });

    expect(result.success).toBe(true);
    expect(result.output.split("\n")).toEqual(["README.md", "src/"]);
    expect(result.error).toBeNull();
  });

  it("glob ignores node_modules and dist", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "src/app.ts", "export const app = true;\n");
    await writeProjectFile(projectRoot, "node_modules/pkg/index.ts", "ignored\n");
    await writeProjectFile(projectRoot, "dist/app.ts", "ignored\n");

    const result = await globTool({ pattern: "**/*.ts" }, { projectRoot });

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/app.ts");
    expect(result.output).not.toContain("node_modules");
    expect(result.output).not.toContain("dist");
  });

  it("grep finds matching lines", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "src/index.ts",
      "const name = 'NanoClaude';\nconsole.log(name);\n",
    );

    const result = await grepTool(
      { pattern: "NanoClaude", path: "src" },
      { projectRoot },
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("src/index.ts:1:");
    expect(result.output).toContain("NanoClaude");
  });

  it("edit_file replace mode applies a successful single replacement", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "README.md",
      "before\nold text\nafter\n",
    );

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "old text",
        newText: "new text",
        reason: "exercise exact replacement",
      },
      { projectRoot },
    );

    const output = parseToolOutput(result.output);

    expect(result.success).toBe(true);
    expect(output).toMatchObject({
      path: "README.md",
      applied: true,
      reason: "exercise exact replacement",
      error: null,
    });
    expect(output.diff).toContain("-old text");
    expect(output.diff).toContain("+new text");
    await expect(readFile(path.join(projectRoot, "README.md"), "utf8")).resolves.toBe(
      "before\nnew text\nafter\n",
    );
  });

  it("edit_file still rejects by default when approval is not granted", async () => {
    const projectRoot = await createTempProject();
    vi.mocked(confirmEdit).mockResolvedValueOnce(false);
    await writeProjectFile(projectRoot, "README.md", "old\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "old",
        newText: "new",
        reason: "default approval should still be required",
      },
      { projectRoot },
    );
    const output = parseToolOutput(result.output);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Edit rejected by user.");
    expect(output.approval).toMatchObject({
      mode: "manual",
      approved: false,
    });
    await expect(readFile(path.join(projectRoot, "README.md"), "utf8")).resolves.toBe(
      "old\n",
    );
  });

  it("auto-approve edits applies a valid patch", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "old\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "old",
        newText: "new",
        reason: "eval auto approval",
      },
      {
        projectRoot,
        autoApproveEdits: true,
      },
    );
    const output = parseToolOutput(result.output);

    expect(result.success).toBe(true);
    expect(output).toMatchObject({
      applied: true,
      approval: {
        mode: "auto",
        approved: true,
      },
    });
    await expect(readFile(path.join(projectRoot, "README.md"), "utf8")).resolves.toBe(
      "new\n",
    );
  });

  it("edit_file replace mode rejects missing oldText", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "hello world\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "missing",
        newText: "replacement",
        reason: "test missing oldText",
      },
      { projectRoot },
    );

    const output = parseToolOutput(result.output);

    expect(result.success).toBe(false);
    expect(result.error).toBe("oldText was not found in the file.");
    expect(output).toMatchObject({
      path: "README.md",
      applied: false,
      reason: "test missing oldText",
      error: "oldText was not found in the file.",
    });
    await expect(readFile(path.join(projectRoot, "README.md"), "utf8")).resolves.toBe(
      "hello world\n",
    );
  });

  it("edit_file replace mode rejects duplicate oldText", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "hello\nhello\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "hello",
        newText: "hi",
        reason: "test duplicate oldText",
      },
      { projectRoot },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("oldText appears multiple times");

    await expect(readFile(path.join(projectRoot, "README.md"), "utf8")).resolves.toBe(
      "hello\nhello\n",
    );
  });

  it("edit_file rejects absolute paths", async () => {
    const projectRoot = await createTempProject();
    const absolutePath = path.join(projectRoot, "README.md");
    await writeProjectFile(projectRoot, "README.md", "hello\n");

    const result = await editFileTool(
      {
        path: absolutePath,
        oldText: "hello",
        newText: "hi",
        reason: "absolute path should be rejected",
      },
      { projectRoot },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Absolute paths are not allowed");
    await expect(readFile(absolutePath, "utf8")).resolves.toBe("hello\n");
  });

  it("edit_file rejects path traversal", async () => {
    const projectRoot = await createTempProject();

    const result = await editFileTool(
      {
        path: "../outside.txt",
        oldText: "hello",
        newText: "hi",
        reason: "path traversal should be rejected",
      },
      { projectRoot },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("outside the project root");
  });

  it("auto-approve edits does not bypass path traversal protection", async () => {
    const projectRoot = await createTempProject();

    const result = await editFileTool(
      {
        path: "../outside.txt",
        oldText: "old",
        newText: "new",
        reason: "path traversal should remain blocked",
      },
      {
        projectRoot,
        autoApproveEdits: true,
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("outside the project root");
  });

  it("auto-approve edits does not bypass missing or duplicate oldText validation", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "same\nsame\n");

    const missing = await editFileTool(
      {
        path: "README.md",
        oldText: "missing",
        newText: "new",
        reason: "missing oldText remains invalid",
      },
      {
        projectRoot,
        autoApproveEdits: true,
      },
    );
    const duplicate = await editFileTool(
      {
        path: "README.md",
        oldText: "same",
        newText: "new",
        reason: "duplicate oldText remains invalid",
      },
      {
        projectRoot,
        autoApproveEdits: true,
      },
    );

    expect(missing.success).toBe(false);
    expect(missing.error).toBe("oldText was not found in the file.");
    expect(duplicate.success).toBe(false);
    expect(duplicate.error).toContain("oldText appears multiple times");
    await expect(readFile(path.join(projectRoot, "README.md"), "utf8")).resolves.toBe(
      "same\nsame\n",
    );
  });

  it("edit_file preserves unrelated file content", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "src/app.ts",
      "const keep = true;\nconst target = 'old';\nconst alsoKeep = true;\n",
    );

    const result = await editFileTool(
      {
        path: "src/app.ts",
        oldText: "const target = 'old';",
        newText: "const target = 'new';",
        reason: "update target value only",
      },
      { projectRoot },
    );

    expect(result.success).toBe(true);
    await expect(readFile(path.join(projectRoot, "src/app.ts"), "utf8")).resolves.toBe(
      "const keep = true;\nconst target = 'new';\nconst alsoKeep = true;\n",
    );
  });

  it("edit_file runs configured verification after a successful edit", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "old\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "old",
        newText: "new",
        reason: "verify after edit",
      },
      {
        projectRoot,
        verifyAfterEdit: [`node -e "console.log('verified')"`],
        permissionPolicy: allowNodePolicy(),
      },
    );
    const output = parseToolOutput(result.output);
    const verification = output.verification as {
      ran: boolean;
      passed: boolean;
      results: Array<Record<string, unknown>>;
    };

    expect(result.success).toBe(true);
    expect(verification.ran).toBe(true);
    expect(verification.passed).toBe(true);
    expect(verification.results[0]).toMatchObject({
      command: `node -e "console.log('verified')"`,
      decision: "allow",
      exitCode: 0,
      timedOut: false,
      error: null,
    });
    expect(String(verification.results[0]?.stdout)).toContain("verified");
  });

  it("edit_file uses configured afterEdit commands", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "old\n");
    await writeProjectFile(
      projectRoot,
      "nanoclaude.config.json",
      JSON.stringify({
        verify: {
          afterEdit: [`node -e "console.log('from-config')"`],
        },
        permissions: {
          allowCommands: ["node"],
        },
      }),
    );
    const config = await loadConfig(projectRoot);

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "old",
        newText: "new",
        reason: "use configured command",
      },
      {
        projectRoot,
        verifyAfterEdit: config.verify.afterEdit,
        permissionPolicy: configToPermissionPolicy(config),
      },
    );
    const output = parseToolOutput(result.output);
    const verification = output.verification as {
      results: Array<Record<string, unknown>>;
    };

    expect(verification.results).toHaveLength(1);
    expect(verification.results[0]?.command).toBe(
      `node -e "console.log('from-config')"`,
    );
  });

  it("edit_file does not run verification when afterEdit is empty", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "old\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "old",
        newText: "new",
        reason: "empty verification",
      },
      {
        projectRoot,
        verifyAfterEdit: [],
        permissionPolicy: allowNodePolicy(),
      },
    );
    const output = parseToolOutput(result.output);

    expect(result.success).toBe(true);
    expect(output.verification).toMatchObject({
      ran: false,
      results: [],
      passed: true,
      message: "No verification configured.",
    });
  });

  it("edit_file does not run verification after missing oldText", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "old\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "missing",
        newText: "new",
        reason: "missing oldText",
      },
      {
        projectRoot,
        verifyAfterEdit: [`node -e "require('fs').writeFileSync('marker.txt','ran')"`],
        permissionPolicy: allowNodePolicy(),
      },
    );
    const output = parseToolOutput(result.output);

    expect(result.success).toBe(false);
    expect(output.verification).toMatchObject({ ran: false, results: [] });
    await expect(readFile(path.join(projectRoot, "marker.txt"), "utf8")).rejects.toThrow();
  });

  it("edit_file does not run verification after duplicate oldText", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "old\nold\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "old",
        newText: "new",
        reason: "duplicate oldText",
      },
      {
        projectRoot,
        verifyAfterEdit: [`node -e "require('fs').writeFileSync('marker.txt','ran')"`],
        permissionPolicy: allowNodePolicy(),
      },
    );
    const output = parseToolOutput(result.output);

    expect(result.success).toBe(false);
    expect(output.verification).toMatchObject({ ran: false, results: [] });
    await expect(readFile(path.join(projectRoot, "marker.txt"), "utf8")).rejects.toThrow();
  });

  it("edit_file does not run verification after a no-op edit", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "same\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "same",
        newText: "same",
        reason: "no-op edit",
      },
      {
        projectRoot,
        verifyAfterEdit: [`node -e "require('fs').writeFileSync('marker.txt','ran')"`],
        permissionPolicy: allowNodePolicy(),
      },
    );
    const output = parseToolOutput(result.output);

    expect(result.success).toBe(true);
    expect(output).toMatchObject({ applied: false });
    expect(output.verification).toMatchObject({ ran: false, results: [] });
    await expect(readFile(path.join(projectRoot, "marker.txt"), "utf8")).rejects.toThrow();
  });

  it("edit_file includes failing verification result", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "old\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "old",
        newText: "new",
        reason: "failing verification",
      },
      {
        projectRoot,
        verifyAfterEdit: [`node -e "console.error('bad'); process.exit(2)"`],
        permissionPolicy: allowNodePolicy(),
      },
    );
    const output = parseToolOutput(result.output);
    const verification = output.verification as {
      passed: boolean;
      results: Array<Record<string, unknown>>;
    };

    expect(result.success).toBe(false);
    expect(result.error).toContain("Verification failed for command");
    expect(verification.passed).toBe(false);
    expect(verification.results[0]).toMatchObject({
      exitCode: 2,
      timedOut: false,
      error: "Command exited with code 2.",
    });
    expect(String(verification.results[0]?.stderr)).toContain("bad");
  });

  it("edit_file does not execute denied verification commands", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "README.md", "old\n");

    const result = await editFileTool(
      {
        path: "README.md",
        oldText: "old",
        newText: "new",
        reason: "denied verification",
      },
      {
        projectRoot,
        verifyAfterEdit: ["sudo npm test"],
      },
    );
    const output = parseToolOutput(result.output);
    const verification = output.verification as {
      passed: boolean;
      results: Array<Record<string, unknown>>;
    };

    expect(result.success).toBe(false);
    expect(verification.passed).toBe(false);
    expect(verification.results[0]).toMatchObject({
      command: "sudo npm test",
      decision: "deny",
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: "Command denied by policy.",
    });
  });

});

describe("session trace", () => {
  it("records tool_call and tool_result steps", () => {
    const trace = createSessionTrace({ userTask: "test" });

    recordToolCall(trace, "grep", { pattern: "NanoClaude", path: "src" });
    recordToolResult(trace, "grep", { pattern: "NanoClaude", path: "src" }, {
      success: true,
      output: "src/index.ts:1:NanoClaude",
      error: null,
    });

    expect(trace.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call",
          tool: "grep",
        }),
        expect.objectContaining({
          type: "tool_result",
          tool: "grep",
          success: true,
        }),
      ]),
    );
  });

  it("records bash permission decisions", () => {
    const trace = createSessionTrace({ userTask: "test" });

    recordToolResult(trace, "bash", { command: "sudo npm test" }, {
      success: false,
      output: JSON.stringify({
        command: "sudo npm test",
        decision: "deny",
        exitCode: null,
        stdout: "",
        stderr: "",
        timedOut: false,
        error: "Command denied by policy.",
      }),
      error: "Command denied by policy.",
    });

    expect(trace.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "permission_decision",
          command: "sudo npm test",
          decision: "deny",
          allowed: false,
          error: "Command denied by policy.",
        }),
      ]),
    );
  });

  it("records edit_applied after a successful edit", () => {
    const trace = createSessionTrace({ userTask: "test" });

    recordToolResult(trace, "edit_file", { path: "README.md" }, {
      success: true,
      output: JSON.stringify({
        path: "README.md",
        applied: true,
        reason: "update docs",
        diff: "--- README.md\n+++ README.md",
        approval: { mode: "auto", approved: true },
        verification: { ran: false, results: [], passed: true },
        error: null,
      }),
      error: null,
    });

    expect(trace.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "edit_applied",
          path: "README.md",
          applied: true,
          approvalMode: "auto",
          approved: true,
          outcome: "applied",
          reason: "update docs",
          error: null,
        }),
      ]),
    );
  });

  it("records verification events after edit hooks run", () => {
    const trace = createSessionTrace({ userTask: "test" });

    recordToolResult(trace, "edit_file", { path: "README.md" }, {
      success: true,
      output: JSON.stringify({
        path: "README.md",
        applied: true,
        reason: "update docs",
        diff: "",
        approval: { mode: "auto", approved: true },
        verification: {
          ran: true,
          passed: true,
          results: [
            {
              command: "npm test",
              decision: "allow",
              exitCode: 0,
              stdout: "passed",
              stderr: "",
              timedOut: false,
              error: null,
            },
          ],
        },
        error: null,
      }),
      error: null,
    });

    expect(trace.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "verification",
          command: "npm test",
          decision: "allow",
          exitCode: 0,
          timedOut: false,
          passed: true,
          stdout: "passed",
        }),
      ]),
    );
  });

  it("records verification failures from edit hooks", () => {
    const trace = createSessionTrace({ userTask: "test" });

    recordToolResult(trace, "edit_file", { path: "README.md" }, {
      success: false,
      output: JSON.stringify({
        path: "README.md",
        applied: true,
        reason: "update docs",
        diff: "",
        approval: { mode: "auto", approved: true },
        verification: {
          ran: true,
          passed: false,
          results: [
            {
              command: "npm run build",
              decision: "allow",
              exitCode: 2,
              stdout: "",
              stderr: "bad",
              timedOut: false,
              error: "Command exited with code 2.",
            },
          ],
        },
        error: "Verification failed for command: npm run build",
      }),
      error: "Verification failed for command: npm run build",
    });

    expect(trace.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "verification",
          command: "npm run build",
          exitCode: 2,
          passed: false,
          stderr: "bad",
          error: "Command exited with code 2.",
        }),
      ]),
    );
  });

  it("redacts .env output and API-key-like content", () => {
    const trace = createSessionTrace({ userTask: "test" });

    recordToolResult(
      trace,
      "read_file",
      { path: ".env" },
      {
        success: true,
        output: "LLM_API_KEY=secret-value\n",
        error: null,
      },
    );
    recordToolResult(
      trace,
      "grep",
      { pattern: "API_KEY", path: "." },
      {
        success: true,
        output: "src/config.ts:1: LLM_API_KEY=secret-value",
        error: null,
      },
    );

    expect(trace.toolResults[0]?.output).toBe("<redacted sensitive file output>");
    expect(trace.toolResults[1]?.output).toContain("LLM_API_KEY=<redacted>");
    expect(trace.toolResults[1]?.output).not.toContain("secret-value");
  });

  it("redacts obvious API keys, tokens, and password values in trace steps", () => {
    const trace = createSessionTrace({ userTask: "test" });

    recordToolResult(trace, "bash", { command: "node secret.js" }, {
      success: true,
      output: JSON.stringify({
        command: "node secret.js",
        decision: "allow",
        exitCode: 0,
        stdout:
          "LLM_API_KEY=abc123\nAuthorization: Bearer token-secret-1234567890\nPASSWORD=hunter2\nvalue=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN1234",
        stderr: "",
        timedOut: false,
        error: null,
      }),
      error: null,
    });

    const serialized = JSON.stringify(trace);
    expect(serialized).toContain("LLM_API_KEY=<redacted>");
    expect(serialized).toContain("Bearer <redacted>");
    expect(serialized).toContain("PASSWORD=<redacted>");
    expect(serialized).toContain("<redacted-secret-like-value>");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("token-secret-1234567890");
  });

  it("truncates long tool output in trace", () => {
    const trace = createSessionTrace({ userTask: "test" });

    recordToolResult(
      trace,
      "grep",
      { pattern: "x", path: "." },
      {
        success: true,
        output: "x".repeat(80),
        error: null,
      },
      { maxTextLength: 20 },
    );

    expect(trace.toolResults[0]?.output).toBe(
      "x".repeat(20) + "\n... trace content truncated",
    );
  });
});

describe("hooks", () => {
  it("after_edit hook invokes bash through the hook path", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "package.json",
      JSON.stringify({ scripts: { build: "node -e \"console.log('ok')\"" } }),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const execution = await runAfterEditHook({ projectRoot });

    expect(execution).toMatchObject({
      hookName: "after_edit",
      tool: "bash",
      args: {
        command: "npm run build",
        cwd: ".",
      },
    });
    expect(execution.result.success).toBe(true);
    expect(parseToolOutput(execution.result.output)).toMatchObject({
      command: "npm run build",
      decision: "allow",
      exitCode: 0,
      timedOut: false,
      error: null,
    });
  });
});

describe("bash permission policy", () => {
  it("classifies allowed commands", () => {
    expect(decideCommand("npm run build")).toBe("allow");
    expect(decideCommand("npm test -- --runInBand")).toBe("allow");
    expect(decideCommand("ls -la")).toBe("allow");
  });

  it("classifies confirm commands", () => {
    expect(decideCommand("npm install")).toBe("confirm");
    expect(decideCommand("git reset --hard")).toBe("confirm");
  });

  it("classifies denied commands", () => {
    expect(decideCommand("sudo npm test")).toBe("deny");
    expect(decideCommand("curl https://example.com")).toBe("deny");
  });

  it("defaults unknown commands to confirm", () => {
    expect(decideCommand("python script.py")).toBe("confirm");
  });

  it("gives deny rules priority over allow rules", () => {
    expect(decideCommand("sudo npm test")).toBe("deny");
  });

  it("does not execute denied commands", async () => {
    const projectRoot = await createTempProject();
    const result = await bashTool(
      { command: "sudo npm test", cwd: "." },
      { projectRoot },
    );
    const output = parseToolOutput(result.output);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Command denied by policy.");
    expect(output).toMatchObject({
      command: "sudo npm test",
      decision: "deny",
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: "Command denied by policy.",
    });
  });

  it("runs allowed commands with project root as cwd", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "package.json",
      JSON.stringify({
        scripts: {
          build: "node -e \"console.log(process.cwd())\"",
        },
      }),
    );
    await mkdir(path.join(projectRoot, "nested"));

    const result = await bashTool(
      { command: "npm run build", cwd: "nested" },
      { projectRoot },
    );
    const output = parseToolOutput(result.output);

    expect(result.success).toBe(true);
    expect(output).toMatchObject({
      command: "npm run build",
      decision: "allow",
      exitCode: 0,
      timedOut: false,
      error: null,
    });
    expect(String(output.stdout)).toContain(projectRoot);
    expect(String(output.stdout)).not.toContain(path.join(projectRoot, "nested"));
  });

  it("returns structured output for confirm rejection", async () => {
    const projectRoot = await createTempProject();
    const result = await bashTool(
      { command: "python script.py", cwd: "." },
      { projectRoot },
    );
    const output = parseToolOutput(result.output);

    expect(result.success).toBe(false);
    expect(output).toMatchObject({
      command: "python script.py",
      decision: "confirm",
      exitCode: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      error: "Command rejected by user.",
    });
  });

  it("auto-approve edits does not auto-approve confirm-level bash commands", async () => {
    const projectRoot = await createTempProject();
    const result = await bashTool(
      { command: "python script.py", cwd: "." },
      {
        projectRoot,
        autoApproveEdits: true,
      },
    );
    const output = parseToolOutput(result.output);

    expect(result.success).toBe(false);
    expect(output).toMatchObject({
      command: "python script.py",
      decision: "confirm",
      error: "Command rejected by user.",
    });
  });
});

describe("config loader", () => {
  it("uses defaults when config is missing", async () => {
    const projectRoot = await createTempProject();

    await expect(loadConfig(projectRoot)).resolves.toEqual(DEFAULT_CONFIG);
  });

  it("merges partial config with defaults", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "nanoclaude.config.json",
      JSON.stringify({
        agent: {
          maxSteps: 7,
        },
        permissions: {
          allowCommands: ["echo"],
        },
      }),
    );

    const config = await loadConfig(projectRoot);

    expect(config.agent.maxSteps).toBe(7);
    expect(config.agent.maxToolOutputChars).toBe(
      DEFAULT_CONFIG.agent.maxToolOutputChars,
    );
    expect(config.permissions.allowCommands).toEqual(["echo"]);
    expect(config.permissions.confirmCommands).toEqual(
      DEFAULT_CONFIG.permissions.confirmCommands,
    );
    expect(config.verify).toEqual(DEFAULT_CONFIG.verify);
  });

  it("returns a helpful error for malformed JSON", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "nanoclaude.config.json", "{ nope");

    await expect(loadConfig(projectRoot)).rejects.toThrow("malformed JSON");
  });

  it("returns a helpful error for invalid field types", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "nanoclaude.config.json",
      JSON.stringify({
        permissions: {
          allowCommands: "npm test",
        },
      }),
    );

    await expect(loadConfig(projectRoot)).rejects.toThrow(
      "allowCommands must be an array of strings",
    );
  });

  it("converts permission config into a bash PermissionPolicy", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "nanoclaude.config.json",
      JSON.stringify({
        permissions: {
          allowCommands: ["echo"],
          confirmCommands: ["python"],
          denyCommands: ["npm test"],
        },
      }),
    );

    const config = await loadConfig(projectRoot);
    const policy = configToPermissionPolicy(config);

    expect(policy).toEqual({
      allow: ["echo"],
      confirm: ["python"],
      deny: ["npm test"],
    });
  });

  it("custom allow, confirm, and deny commands affect decideCommand", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "nanoclaude.config.json",
      JSON.stringify({
        permissions: {
          allowCommands: ["echo"],
          confirmCommands: ["python"],
          denyCommands: ["npm test"],
        },
      }),
    );

    const policy = configToPermissionPolicy(await loadConfig(projectRoot));

    expect(decideCommand("echo hello", policy)).toBe("allow");
    expect(decideCommand("python script.py", policy)).toBe("confirm");
    expect(decideCommand("npm test", policy)).toBe("deny");
  });

  it("agent.maxSteps is read from config", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "nanoclaude.config.json",
      JSON.stringify({
        agent: {
          maxSteps: 1,
        },
      }),
    );
    const llm = {
      complete: async () =>
        JSON.stringify({
          type: "todo_update",
          id: "1",
          status: "in_progress",
          content: "Keep working",
        }),
    };
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      runAgent({
        task: "test config max steps",
        llm,
        projectRoot,
        hooksEnabled: false,
        rulesEnabled: false,
      }),
    ).resolves.toBe("Stopped after 1 iterations without a final answer.");
  });
});

describe("CLI option parsing", () => {
  it("parses task and CLI options", () => {
    expect(
      parseCliArgs([
        "--max-iterations",
        "12",
        "--no-hooks",
        "--no-rules",
        "--auto-approve-edits",
        "update",
        "docs",
      ]),
    ).toEqual({
      task: "update docs",
      help: false,
      version: false,
      hooksEnabled: false,
      rulesEnabled: false,
      autoApproveEdits: true,
      maxIterations: 12,
    });
  });

  it("keeps the simple positional task workflow", () => {
    expect(parseCliArgs(["explain", "this", "project"])).toMatchObject({
      task: "explain this project",
      hooksEnabled: true,
      rulesEnabled: true,
      autoApproveEdits: false,
    });
  });

  it("rejects invalid max iterations", () => {
    expect(() => parseCliArgs(["--max-iterations", "0", "task"])).toThrow(
      "positive integer",
    );
  });
});

describe("eval harness", () => {
  it("discovers eval tasks", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "tasks/001-demo/task.md", "Do a thing\n");
    await writeProjectFile(projectRoot, "tasks/001-demo/check.js", "process.exit(0);\n");
    await writeProjectFile(projectRoot, "tasks/001-demo/repo/README.md", "# Demo\n");

    const tasks = await discoverEvalTasks(path.join(projectRoot, "tasks"));

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "001-demo",
      checkerName: "check.js",
    });
  });

  it("copies a task repo into a workspace", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(projectRoot, "tasks/001-demo/task.md", "Do a thing\n");
    await writeProjectFile(projectRoot, "tasks/001-demo/check.js", "process.exit(0);\n");
    await writeProjectFile(projectRoot, "tasks/001-demo/repo/src/app.js", "ok\n");
    const [task] = await discoverEvalTasks(path.join(projectRoot, "tasks"));

    const workspace = await createTaskWorkspace(
      task!,
      path.join(projectRoot, "results", "run"),
    );

    await expect(readFile(path.join(workspace, "src/app.js"), "utf8")).resolves.toBe(
      "ok\n",
    );
  });

  it("runs check.js and parses PASS/FAIL", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "check.js",
      "console.log('checker passed'); process.exit(0);\n",
    );

    const result = await runChecker(path.join(projectRoot, "check.js"), projectRoot);

    expect(result.passed).toBe(true);
    expect(result.stdout).toContain("checker passed");
    expect(parsePassFail(result)).toBe("PASS");
  });

  it("formats a final result table", () => {
    const results: EvalResult[] = [
      {
        taskId: "001-fix-failing-test",
        result: "PASS",
        steps: 8,
        verification: "check.js",
        summaryPath: "summary.json",
        tracePath: "trace.json",
        error: null,
      },
      {
        taskId: "002-add-cli-flag",
        result: "FAIL",
        steps: null,
        verification: "check.js",
        summaryPath: "summary.json",
        tracePath: null,
        error: "failed",
      },
    ];

    const table = formatResultTable(results);

    expect(table).toContain("Task");
    expect(table).toContain("001-fix-failing-test");
    expect(table).toContain("PASS");
    expect(table).toContain("Success rate: 1/2");
  });

  it("extracts trace step counts", async () => {
    const projectRoot = await createTempProject();
    await writeProjectFile(
      projectRoot,
      "trace.json",
      JSON.stringify({
        steps: [{ type: "tool_call" }, { type: "tool_result" }],
      }),
    );

    await expect(
      extractTraceStepCount(path.join(projectRoot, "trace.json")),
    ).resolves.toBe(2);
  });

  it("uses auto-approved edits for eval agent runs", () => {
    expect(evalAgentOptions()).toEqual({
      autoApproveEdits: true,
    });
  });
});
