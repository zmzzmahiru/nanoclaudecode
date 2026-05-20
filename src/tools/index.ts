import { bashTool, type BashArgs } from "./bash.js";
import { editFileTool, type EditFileArgs } from "./edit-file.js";
import { globTool, type GlobArgs } from "./glob.js";
import { grepTool, type GrepArgs } from "./grep.js";
import { listFilesTool, type ListFilesArgs } from "./list-files.js";
import {
  readFileTool,
  type ReadFileArgs,
  type ToolContext,
  type ToolResult,
} from "./read-file.js";

export type ToolName =
  | "read_file"
  | "list_files"
  | "glob"
  | "grep"
  | "bash"
  | "edit_file";

export type ToolArgs =
  | ReadFileArgs
  | ListFilesArgs
  | GlobArgs
  | GrepArgs
  | BashArgs
  | EditFileArgs;

export type ToolHandler = (
  args: ToolArgs,
  context: ToolContext,
) => Promise<ToolResult>;

export interface ToolDefinition {
  name: ToolName;
  description: string;
  run: ToolHandler;
}

export const toolRegistry: Record<ToolName, ToolDefinition> = {
  read_file: {
    name: "read_file",
    description: "Read a UTF-8 text file inside the project root.",
    run: (args, context) => readFileTool(args as ReadFileArgs, context),
  },
  list_files: {
    name: "list_files",
    description: "List files and directories directly inside a project directory.",
    run: (args, context) => listFilesTool(args as ListFilesArgs, context),
  },
  glob: {
    name: "glob",
    description: "Find files by glob pattern inside the project root.",
    run: (args, context) => globTool(args as GlobArgs, context),
  },
  grep: {
    name: "grep",
    description: "Search text files under a path for a string pattern.",
    run: (args, context) => grepTool(args as GrepArgs, context),
  },
  bash: {
    name: "bash",
    description: "Run a development command after explicit user approval.",
    run: (args, context) => bashTool(args as BashArgs, context),
  },
  edit_file: {
    name: "edit_file",
    description: "Preview and apply a file edit after explicit user approval.",
    run: (args, context) => editFileTool(args as EditFileArgs, context),
  },
};

function isToolName(name: string): name is ToolName {
  return name in toolRegistry;
}

export async function runTool(
  name: string,
  args: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  if (!isToolName(name)) {
    return {
      success: false,
      output: "",
      error: `Unknown tool: ${name}`,
    };
  }

  const parsedArgs = typeof args === "object" && args !== null ? args : {};
  return toolRegistry[name].run(parsedArgs as ToolArgs, context);
}

export type { ToolContext, ToolResult };
