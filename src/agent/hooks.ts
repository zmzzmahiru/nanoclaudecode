import { runTool, type ToolResult } from "../tools/index.js";
import type { ToolContext } from "../tools/read-file.js";

export interface HookToolExecution {
  hookName: "after_edit";
  tool: "bash";
  args: {
    command: string;
    cwd: string;
  };
  result: ToolResult;
}

export type HookContext = ToolContext;

export async function runAfterEditHook(
  context: HookContext,
): Promise<HookToolExecution> {
  const args = {
    command: "npm run build",
    cwd: ".",
  };

  console.log(`[hook] after_edit: ${args.command}`);
  const result = await runTool("bash", args, { projectRoot: context.projectRoot });

  return {
    hookName: "after_edit",
    tool: "bash",
    args,
    result,
  };
}
