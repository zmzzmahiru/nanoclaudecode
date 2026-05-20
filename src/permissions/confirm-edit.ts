import { confirm } from "./confirm.js";

const MAX_DIFF_PREVIEW_LENGTH = 20_000;

function capDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_PREVIEW_LENGTH) {
    return diff;
  }

  return `${diff.slice(0, MAX_DIFF_PREVIEW_LENGTH)}\n... diff truncated`;
}

export async function confirmEdit(filePath: string, diff: string): Promise<boolean> {
  console.log(`\n[edit_file] Proposed changes for ${filePath}:`);
  console.log(capDiff(diff));
  console.log("");

  return confirm("[edit_file] Apply this change?");
}
