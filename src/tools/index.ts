import { listFilesTool, type ListFilesArgs } from "./list-files.js";
import {
  readFileTool,
  type ReadFileArgs,
  type ToolContext,
  type ToolResult,
} from "./read-file.js";

export type ToolName = "read_file" | "list_files";

export type ToolArgs = ReadFileArgs | ListFilesArgs;

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
};

export async function runTool(
  name: string,
  args: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  if (name !== "read_file" && name !== "list_files") {
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

