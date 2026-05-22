import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/permissions/confirm-edit.js", () => ({
  confirmEdit: vi.fn(async () => true),
}));

import { runAfterEditHook } from "../src/agent/hooks.js";
import {
  createSessionTrace,
  recordToolResult,
} from "../src/agent/session-trace.js";
import { editFileTool } from "../src/tools/edit-file.js";
import { globTool } from "../src/tools/glob.js";
import { grepTool } from "../src/tools/grep.js";
import { listFilesTool } from "../src/tools/list-files.js";
import { resolveInsideProject } from "../src/tools/path-safety.js";
import { readFileTool } from "../src/tools/read-file.js";
import { parseCliArgs } from "../src/index.js";

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
});

describe("session trace", () => {
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
    expect(execution.result.success).toBe(false);
    expect(execution.result.error).toBe("Command rejected by user.");
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
        "update",
        "docs",
      ]),
    ).toEqual({
      task: "update docs",
      help: false,
      version: false,
      hooksEnabled: false,
      rulesEnabled: false,
      maxIterations: 12,
    });
  });

  it("keeps the simple positional task workflow", () => {
    expect(parseCliArgs(["explain", "this", "project"])).toMatchObject({
      task: "explain this project",
      hooksEnabled: true,
      rulesEnabled: true,
    });
  });

  it("rejects invalid max iterations", () => {
    expect(() => parseCliArgs(["--max-iterations", "0", "task"])).toThrow(
      "positive integer",
    );
  });
});
