import "dotenv/config";

import { runAgent } from "./agent/loop.js";
import { createOpenAICompatibleProvider } from "./llm/openai-compatible.js";

function readTask(argv: string[]): string {
  return argv.join(" ").trim();
}

async function main(): Promise<void> {
  const task = readTask(process.argv.slice(2));

  if (!task) {
    console.error('Usage: npm run dev -- "your task here"');
    process.exitCode = 1;
    return;
  }

  const provider = createOpenAICompatibleProvider();
  const response = await runAgent({ task, llm: provider });

  console.log(response);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`NanoClaude failed: ${message}`);
  process.exitCode = 1;
});
