import { spawnSync } from "node:child_process";

const result = spawnSync("node", ["test.js"], {
  cwd: process.cwd(),
  encoding: "utf8",
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
